#!/usr/bin/env python3
"""Bake the downtown Austin extension (Capitol strip seam z=1536 south to Lady Bird Lake) into
same-origin runtime assets. Evidence import, not a survey.

Sources (fetched by tools/extension/fetch-downtown.py and fetch-downtown-lidar.py, kept outside the build):
  * City of Austin Planimetrics 2023: Building Footprints 2023 (MAX_HEIGHT, US survey ft), Impervious Cover 2023
  * City of Austin "City of Austin Parks"
  * USGS 3DEP bare-earth DEM (hydro-flattened; lake surface 130.53 m NAVD88)
  * USGS 3DEP LiDAR TX_Central_B1_2017 (public EPT mirror, depth-10 subset ~1.8 m): roof tiers, canopy, bridge decks
  * OpenStreetMap (ODbL) building outlines/tags: identities and footprints of towers completed after the 2023 aerials
  * lib/campus/extension/downtown/landmarks.json: authored, reference-cited landmark tower profiles
Reads (repo, read-only): lib/campus/blocks/b14-capitol/strip-ground.json (seam row z=1536)
Writes:
  public/assets/extension/downtown-v1.bin.gz        runtime asset (single file)
  public/assets/extension/downtown-v1.manifest.json provenance / inclusion report
  public/assets/extension/downtown-sources.json     licences and source URLs

Run (venv with tools/lidar/requirements.txt):
  python -I tools/extension/bake-downtown.py --raw .work/claude-downtown/raw --osm .work/claude-downtown/raw-osm/buildings.json \
      --lidar .work/claude-downtown/ept/downtown-lidar-ept-depth10.npz [--preview .work/claude-downtown/preview]
Deterministic: identical inputs give a byte-identical asset (no timestamps inside the asset).
"""
from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import json
import math
import struct
from pathlib import Path

import numpy as np
import shapely
from PIL import Image, ImageDraw
from scipy import ndimage
from shapely.geometry import LineString, MultiPolygon, Polygon, box, mapping
from shapely.ops import unary_union
from skimage.measure import find_contours

ROOT = Path(__file__).resolve().parents[2]
OUT_ASSET = ROOT / 'public' / 'assets' / 'extension'
LIB = ROOT / 'lib' / 'campus' / 'extension' / 'downtown'

SX, SZ = 96126.8152981172, 110851.0
LON0, LAT0 = -97.73716, 30.2861
US_FOOT = 1200 / 3937
NAVD_TO_CAMPUS = -165.0
MAGIC = 0x54445455  # 'UTDT'
VERSION = 1

# Region (campus metres). North edge = Capitol strip seam; the strip grid is x0=-760, 4 m, last row z=1536.
# Rendered rectangle (terrain grid, class map, visual-only context beyond the playable edge):
XMIN, XMAX, ZMIN, ZMAX = -1760.0, 520.0, 1536.0, 3520.0
STEP = 4.0
SEAM_Z = 1536.0
SEAM_X0, SEAM_X1 = -760.0, 444.0       # span shared with the strip (open, no wall)
# Playable region before water: west/north rectangle edges, south cut at z=3440 (Rainey/Holly), east edge 12 m
# east of the I-35 southbound frontage-road centreline (City CTN "N IH 35 SVRD SB", sampled every 100 m), i.e.
# frontage road playable, main lanes visual-only context.
REGION = [(-1760.0, 1536.0), (444.0, 1536.0), (429, 1600), (379, 1700), (350, 1800), (320, 1900), (286, 2000),
          (251, 2100), (217, 2200), (200, 2300), (161, 2400), (139, 2500), (100, 2600), (62, 2700), (42, 2800),
          (-3, 2900), (-36, 3000), (-49, 3100), (-41, 3200), (-7, 3300), (8, 3440), (-1760.0, 3440.0)]
INLET_OPEN = 20.0                      # water channels narrower than ~2x this (creek mouths) are inlets, not boundary
SEAM_BLEND = 40.0                      # DEM -> strip seam offset fades over 40 m (same as the strip's own seam)
CHUNK = 256.0
CLASS_RES = 1.0                        # ground class map metres / pixel
WATER_NAVD = 130.53                    # hydro-flattened lake surface in the DEM (mode of 50k samples)
WATER_Y = WATER_NAVD + NAVD_TO_CAMPUS
SHORE_Y = WATER_Y + 0.3                # playable land is terrain above this contour

# Ground classes (shader indices; keep in sync with lib/campus/extension/downtown/ground.ts)
C_GRASS, C_ASPHALT, C_SIDEWALK, C_PLAZA, C_TRAIL, C_WATER, C_PARK, C_FOOTPRINT, C_PARKING = 0, 1, 2, 3, 4, 5, 6, 7, 8
IMPERVIOUS_CLASS = {
    'Paved Road': C_ASPHALT, 'Paved Alley': C_ASPHALT, 'Unpaved Road': C_TRAIL,
    'Paved Parking': C_PARKING, 'Paved Driveway': C_SIDEWALK, 'Sidewalk': C_SIDEWALK, 'Pavement': C_SIDEWALK,
    'Median > 10 Feet': C_SIDEWALK, 'Courtyard': C_PLAZA, 'Patio': C_PLAZA, 'Uncovered Deck': C_PLAZA,
    'Covered Deck': C_PLAZA, 'Dock': C_PLAZA, 'Trail': C_TRAIL, 'Unpaved Parking': C_TRAIL, 'Unpaved Driveway': C_TRAIL,
    'Compacted Soil': C_TRAIL, 'Gravel/Sandpit': C_TRAIL, 'Open Storage': C_TRAIL, 'Railroad Ballast': C_TRAIL,
    'Miscellaneous': C_SIDEWALK, 'Recreation Court/Ball Field': C_PLAZA, 'Paved Ditch': C_SIDEWALK,
}
PAINT_ORDER = [C_TRAIL, C_PLAZA, C_SIDEWALK, C_PARKING, C_ASPHALT]


def sha256b(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def fnv_words(data: bytes) -> int:
    words = np.frombuffer(data, '<u4').astype(np.uint64)
    h = 2166136261
    for w in words.tolist():
        h = ((h ^ w) * 16777619) & 0xFFFFFFFF
    return h


def xy(lon, lat):
    return ((np.asarray(lon) - LON0) * SX, (LAT0 - np.asarray(lat)) * SZ)


def poly_from_esri(rings):
    """ESRI rings (lon/lat) -> shapely polygons in campus x/z (exterior/hole by orientation)."""
    ext, holes = [], []
    for r in rings:
        pts = [tuple(map(float, xy(p[0], p[1]))) for p in r]
        if len(pts) < 4:
            continue
        p = Polygon(pts)
        # ESRI exteriors are clockwise in lon/lat; the z flip makes them counter-clockwise in x/z.
        (ext if shapely.is_ccw(p.exterior) else holes).append(pts)
    polys = [Polygon(e) for e in ext]
    polys = [p if p.is_valid else p.buffer(0) for p in polys]
    out = []
    for p in polys:
        hs = [h for h in holes if p.contains(Polygon(h).representative_point())]
        q = Polygon(p.exterior.coords, hs) if isinstance(p, Polygon) else p
        out.append(q if q.is_valid else q.buffer(0))
    return [g for q in out for g in polygons_of(q)]


def polygons_of(geom):
    if geom is None or geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    return [p for g in getattr(geom, 'geoms', []) for p in polygons_of(g)]


def rings_of(poly: Polygon, digits=2):
    poly = shapely.geometry.polygon.orient(poly, 1.0)
    r = lambda cs: [[round(x, digits), round(z, digits)] for x, z in list(cs)[:-1]]
    return [r(poly.exterior.coords)] + [r(h.coords) for h in poly.interiors]


# ----------------------------------------------------------------------------- DEM
def read_tiff(path: Path):
    b = path.read_bytes()
    if b[:4] != b'II*\x00':
        raise SystemExit('DEM is not a little-endian classic TIFF')
    off = struct.unpack('<I', b[4:8])[0]
    n = struct.unpack('<H', b[off:off + 2])[0]
    sizes = {1: 1, 2: 1, 3: 2, 4: 4, 11: 4, 12: 8, 16: 8}
    fmts = {1: 'B', 3: 'H', 4: 'I', 11: 'f', 12: 'd', 16: 'Q'}
    tags = {}
    for i in range(n):
        tag, typ, cnt, val = struct.unpack('<HHI4s', b[off + 2 + i * 12: off + 14 + i * 12])
        size = sizes[typ] * cnt
        raw = val[:size] if size <= 4 else b[struct.unpack('<I', val)[0]: struct.unpack('<I', val)[0] + size]
        tags[tag] = raw if typ == 2 else struct.unpack('<' + fmts[typ] * cnt, raw)
    width, height = tags[256][0], tags[257][0]
    if tags[258] != (32,) or tags[259] != (1,) or tags.get(339) != (3,):
        raise SystemExit('DEM must be uncompressed float32')
    tw, th = tags[322][0], tags[323][0]
    across = -(-width // tw)
    down = -(-height // th)
    grid = np.empty((down * th, across * tw), '<f4')
    for k, o in enumerate(tags[324]):
        r, c = divmod(k, across)
        grid[r * th:(r + 1) * th, c * tw:(c + 1) * tw] = np.frombuffer(b, '<f4', tw * th, o).reshape(th, tw)
    grid = grid[:height, :width].astype(np.float64)
    sx, sy = tags[33550][0], tags[33550][1]
    tie = tags[33922]
    return grid, {'xmin': tie[3], 'ymax': tie[4], 'xmax': tie[3] + width * sx, 'ymin': tie[4] - height * sy}


class Dem:
    """Mosaic of the exported tiles (identical pixel size), bilinear in lon/lat. Pixels < 50 m are nodata."""

    def __init__(self, tiles):
        exts = [e for _, e in tiles]
        self.xmin, self.xmax = min(e['xmin'] for e in exts), max(e['xmax'] for e in exts)
        self.ymin, self.ymax = min(e['ymin'] for e in exts), max(e['ymax'] for e in exts)
        g0, e0 = tiles[0]
        self.dx = (e0['xmax'] - e0['xmin']) / g0.shape[1]
        self.dy = (e0['ymax'] - e0['ymin']) / g0.shape[0]
        W = round((self.xmax - self.xmin) / self.dx)
        H = round((self.ymax - self.ymin) / self.dy)
        self.g = np.full((H, W), np.nan)
        for g, e in tiles:
            c0 = round((e['xmin'] - self.xmin) / self.dx)
            r0 = round((self.ymax - e['ymax']) / self.dy)
            sub = np.where(g < 50, np.nan, g)
            dst = self.g[r0:r0 + g.shape[0], c0:c0 + g.shape[1]]
            np.copyto(dst, sub, where=np.isnan(dst))
        self.nodata = int(np.isnan(self.g).sum())

    def __call__(self, x, z):
        x = np.asarray(x, np.float64)
        z = np.asarray(z, np.float64)
        lon, lat = LON0 + x / SX, LAT0 - z / SZ
        u = (lon - self.xmin) / self.dx - .5
        v = (self.ymax - lat) / self.dy - .5
        i, j = np.floor(u).astype(int), np.floor(v).astype(int)
        f, g = u - i, v - j
        if (i < 0).any() or (j < 0).any() or (i + 1 >= self.g.shape[1]).any() or (j + 1 >= self.g.shape[0]).any():
            raise SystemExit('Attempted DEM extrapolation')
        r = self.g
        val = (r[j, i] * (1 - f) * (1 - g) + r[j, i + 1] * f * (1 - g) + r[j + 1, i] * (1 - f) * g + r[j + 1, i + 1] * f * g)
        return val + NAVD_TO_CAMPUS


def strip_seam_row():
    """Strip patch last row (z=1536) exactly as the runtime decodes it: float32(int16 * unit)."""
    s = json.loads((ROOT / 'lib/campus/blocks/b14-capitol/strip-ground.json').read_text())
    if s['step'] != STEP or s['x0'] != SEAM_X0 or s['z0'] + (s['nz'] - 1) * s['step'] != SEAM_Z:
        raise SystemExit('Strip grid does not end on the planned seam')
    h = np.frombuffer(base64.b64decode(s['heights']), '<i2').astype(np.float64) * s['unit']
    h = h.astype(np.float32).reshape(s['nz'], s['nx'])
    row = h[-1]
    xs = s['x0'] + STEP * np.arange(s['nx'])
    return {float(x): np.float32(y) for x, y in zip(xs, row) if x <= SEAM_X1 + 1e-9}, sha256b(row.tobytes())


def build_terrain(dem: Dem):
    xs = XMIN + STEP * np.arange(int(round((XMAX - XMIN) / STEP)) + 1)
    zs = ZMIN + STEP * np.arange(int(round((ZMAX - ZMIN) / STEP)) + 1)
    X, Z = np.meshgrid(xs, zs)
    # Vertex = mean of a 3x3 sample over its 4 m cell (anti-aliased bare earth).
    acc = np.zeros_like(X)
    for dx in (-STEP / 3, 0, STEP / 3):
        for dz in (-STEP / 3, 0, STEP / 3):
            acc += dem(X + dx, Z + dz)
    H = acc / 9
    if np.isnan(H).any():
        raise SystemExit(f'DEM nodata inside the region ({int(np.isnan(H).sum())} vertices)')
    seam, seam_hash = strip_seam_row()
    shift_max = 0.0
    for i, x in enumerate(xs):
        if SEAM_X0 <= x <= SEAM_X1:
            d = float(seam[float(x)]) - H[0, i]
            shift_max = max(shift_max, abs(d))
            for j, z in enumerate(zs):
                t = (z - SEAM_Z) / SEAM_BLEND
                if t >= 1:
                    break
                w = 1 - t * t * (3 - 2 * t)
                H[j, i] += d * w
    H = H.astype(np.float32)
    for i, x in enumerate(xs):  # seam row float-identical to the strip
        if SEAM_X0 <= x <= SEAM_X1:
            H[0, i] = seam[float(x)]
    return xs, zs, H, {'stripSeamSha256': seam_hash, 'seamVertices': int(sum(1 for x in xs if SEAM_X0 <= x <= SEAM_X1)),
                       'maxSeamBlendShift': round(shift_max, 3)}


def grid_height(xs, zs, H, x, z):
    """Exact height of the rendered triangles (diagonal as terrain.ts: u+v<=1 -> a,b,c)."""
    fx = np.clip((np.asarray(x) - XMIN) / STEP, 0, len(xs) - 1.000001)
    fz = np.clip((np.asarray(z) - ZMIN) / STEP, 0, len(zs) - 1.000001)
    i, j = np.floor(fx).astype(int), np.floor(fz).astype(int)
    u, v = fx - i, fz - j
    a, b, c, e = H[j, i], H[j, i + 1], H[j + 1, i], H[j + 1, i + 1]
    return np.where(u + v <= 1, a + (b - a) * u + (c - a) * v, e + (c - e) * (1 - u) + (b - e) * (1 - v))


# ----------------------------------------------------------------------------- water / land
def water_and_land(xs, zs, H):
    """Water = connected low area (terrain below SHORE_Y) touching the lake; land = region minus water.
    Playable = land pieces connected to the north seam; the rest (south bank) is visual-only context."""
    low = H < SHORE_Y
    lab, n = ndimage.label(low)
    sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    keep = np.zeros(n + 1, bool)
    keep[1:] = sizes > 2000   # the lake (tens of thousands of vertices); creek pools stay land
    water = keep[lab]
    padded = np.pad(np.where(water, -1.0, 1.0), 1, constant_values=1.0)
    region = box(XMIN, ZMIN, XMAX, ZMAX)
    polys = []
    for c in find_contours(padded, 0.0):
        pts = [(XMIN + (q[1] - 1) * STEP, ZMIN + (q[0] - 1) * STEP) for q in c]
        if len(pts) >= 4:
            p = Polygon(pts).buffer(0)
            polys.append(p)
    # Even-odd composition of contour rings (water bodies may contain islands).
    water_poly = Polygon()
    for p in sorted(polys, key=lambda p: -p.area):
        water_poly = water_poly.symmetric_difference(p)
    water_poly = water_poly.intersection(region).buffer(0)
    water_poly = unary_union([p for p in polygons_of(water_poly) if p.area > 400])
    # Main river = water opened by INLET_OPEN (creek mouths fall away); inlets get low barriers instead of walls,
    # so street bridges over them (Cesar Chavez over Shoal Creek, ...) stay continuous.
    opened = water_poly.buffer(-INLET_OPEN).buffer(INLET_OPEN + 0.5).intersection(water_poly)
    main = max(polygons_of(opened), key=lambda p: p.area)
    main = main.buffer(0.01).buffer(-0.01)
    inlets = water_poly.difference(main).buffer(0)
    allowed = Polygon(REGION)
    land = allowed.difference(main).buffer(0)
    pieces = sorted(polygons_of(land), key=lambda p: -p.area)
    seam_line = LineString([(SEAM_X0, SEAM_Z), (SEAM_X1, SEAM_Z)])
    playable = [p for p in pieces if p.distance(seam_line) < 1e-6]
    if len(playable) != 1:
        raise SystemExit(f'Expected one playable land piece touching the seam, got {len(playable)}')
    play = playable[0].simplify(0.6, preserve_topology=True)
    play = Polygon(play.exterior.coords, [h.coords for h in play.interiors if Polygon(h).area > 300])
    inlets = unary_union([p for p in polygons_of(inlets.intersection(play)) if p.area > 50])
    context = region.difference(play).difference(main).buffer(0)   # visual-only land (south bank, I-35, edges)
    return water_poly, main, inlets, play, context


def wall_segments(play: Polygon):
    """Boundary of the playable polygon except the open seam span (shared with the strip)."""
    segs = []
    rings = [play.exterior] + list(play.interiors)
    for ring in rings:
        cs = list(ring.coords)
        for (ax, az), (bx, bz) in zip(cs, cs[1:]):
            if abs(az - SEAM_Z) < 1e-6 and abs(bz - SEAM_Z) < 1e-6:
                # A simplified north boundary can be one edge spanning both the
                # closed western wing and the open join. Subtract the join from
                # that edge rather than requiring the whole edge to fit it.
                lo, hi = sorted((ax, bx))
                for start, end in ((lo, min(hi, SEAM_X0)), (max(lo, SEAM_X1), hi)):
                    if end - start > 1e-3:
                        segs.append([round(start, 2), SEAM_Z, round(end, 2), SEAM_Z])
                continue
            if math.hypot(bx - ax, bz - az) > 1e-3:
                segs.append([round(ax, 2), round(az, 2), round(bx, 2), round(bz, 2)])
    return segs


# ----------------------------------------------------------------------------- class map
class Raster:
    def __init__(self):
        self.w = int(round((XMAX - XMIN) / CLASS_RES))
        self.h = int(round((ZMAX - ZMIN) / CLASS_RES))
        self.a = np.full((self.h, self.w), C_GRASS, np.uint8)

    def px(self, cs):
        return [((x - XMIN) / CLASS_RES, (z - ZMIN) / CLASS_RES) for x, z in cs]

    def mask(self, poly: Polygon):
        x0, z0, x1, z1 = poly.bounds
        c0, r0 = max(0, int((x0 - XMIN) / CLASS_RES) - 1), max(0, int((z0 - ZMIN) / CLASS_RES) - 1)
        c1, r1 = min(self.w, int((x1 - XMIN) / CLASS_RES) + 2), min(self.h, int((z1 - ZMIN) / CLASS_RES) + 2)
        if c1 <= c0 or r1 <= r0:
            return None
        im = Image.new('1', (c1 - c0, r1 - r0), 0)
        d = ImageDraw.Draw(im)
        sh = lambda cs: [(u - c0, v - r0) for u, v in self.px(cs)]
        d.polygon(sh(poly.exterior.coords), fill=1)
        for h in poly.interiors:
            d.polygon(sh(h.coords), fill=0)
        return (slice(r0, r1), slice(c0, c1)), np.array(im, bool)

    def paint(self, poly, cls):
        for p in polygons_of(poly):
            m = self.mask(p)
            if m:
                sl, mk = m
                self.a[sl][mk] = cls


# ----------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--raw', required=True, type=Path)
    ap.add_argument('--osm', required=True, type=Path)
    ap.add_argument('--lidar', required=True, type=Path)
    ap.add_argument('--preview', type=Path)
    ap.add_argument('--stage', default='all')
    a = ap.parse_args()
    prov = json.loads((a.raw / 'provenance.json').read_text())
    tiles = [read_tiff(a.raw / t['file']) for t in prov['dem']['tiles']]
    for (g, e), t in zip(tiles, prov['dem']['tiles']):
        if abs(e['xmin'] - t['extent']['xmin']) > 1e-9 or abs(e['ymax'] - t['extent']['ymax']) > 1e-9:
            raise SystemExit('DEM tile georeference mismatch')
    dem = Dem(tiles)
    xs, zs, H, seam_info = build_terrain(dem)
    water, main, inlets, play, context = water_and_land(xs, zs, H)
    print('terrain', H.shape, 'range', float(H.min()), float(H.max()), seam_info)
    print('playable area m2', round(play.area), 'vertices', len(play.exterior.coords), 'holes', len(play.interiors),
          'water', round(water.area), 'inlets', round(inlets.area), 'context', round(context.area))
    import downtown_bake as stage2  # noqa: E402  (second half lives next to this file)
    stage2.run(a, prov, dem, xs, zs, H, seam_info, water, main, inlets, play, context, globals())


if __name__ == '__main__':
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    main()
