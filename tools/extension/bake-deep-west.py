#!/usr/bin/env python3
"""Bake the deep-west campus extension (districts D37-D40, x < -760) into
same-origin runtime assets. Evidence import, not a survey: 2023 City of Austin
planimetric footprints/surfaces and USGS 3DEP bare-earth DEM.

Never mutates the existing world. Reads (read-only):
  <raw>/building-footprints-2023.json, road-sidewalk-surfaces-2023.json,
  buildings-layer.json, usgs-bare-earth-dem.tif, dem-export.json,
  provenance.json, dem-request.json, terrain-candidate.json
  <packets>/D37.json .. D40.json
  public/assets/campus/offline-terrain-61.bin.gz  (seam vertices only)
  public/data/campus.json, public/data/terrain.json (reconciliation, shot ground)
Writes:
  public/assets/extension/deep-west-v1.bin.gz      runtime asset (single file)
  public/assets/extension/deep-west-v1.manifest.json provenance/inclusion report
  public/assets/extension/sources.json             licences and source URLs
  lib/campus/extension/deep-west/ownership.json, shots.json

Requires numpy + shapely>=2.1 (constrained Delaunay). Run:
  python tools/extension/bake-deep-west.py --raw <deep-west-base-data> --packets <packets>
Then ALWAYS run stage 2 (tools/extension/bake-deep-west-paving.py): it appends the City parking lots, driveways and
patios this stage's filtered surface input lacks (they otherwise render as lawn).
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import struct
import sys
from pathlib import Path

import numpy as np
import shapely
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
OUT_ASSET = ROOT / 'public' / 'assets' / 'extension'
OUT_LIB = ROOT / 'lib' / 'campus' / 'extension' / 'deep-west'

# Campus frame (same constants as convert.py / dkr-frontage-plan.json / tools/lidar/common.py).
SX, SZ = 96126.8152981172, 110851.0
LON0, LAT0 = -97.73716, 30.2861
US_FOOT = 1200 / 3937          # US survey foot -> metre (layer sourceHeightModelInfo heightUnit us-foot, NAVD88 ftUS)
NAVD_TO_CAMPUS = -165.0        # derived/sources.json calibration.campusMinusNavd88m
SEAM_X = -760.0
UNION = (-1570.0, -760.0, -510.0, 570.0)   # xmin, xmax, zmin, zmax (packet rectangles)
BLEND = 48.0                   # derived DEM->offline-61 seam transition width (m)
DRAPE = 0.04                   # surface sheets above terrain (m)
DRAPE_FADE = 4.0               # drape fades to 0 over the zipper strip x[-764,-760]: flush with offline-61 at the seam
CLEAR = 3.0                    # packet rule: whole footprint + 3 m inside owned union
VERSION = 1
MAGIC = 0x57445455             # 'UTDW'
SURFACE_PRIORITY = ['Sidewalk', 'Trail', 'Paved Road', 'Paved Alley', 'Pavement', 'Courtyard']
EXCLUDED_SURFACE_KINDS = {'Bridge': 'deck elevation unknown; bare-earth DEM is not a bridge deck'}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fnv_words(data: bytes) -> int:
    """FNV-1a over little-endian 32-bit words (data length multiple of 4)."""
    words = np.frombuffer(data, '<u4')
    h = 2166136261
    for w in words.tolist():
        h = ((h ^ w) * 16777619) & 0xFFFFFFFF
    return h


def metric(ring):
    return [((lon - LON0) * SX, (LAT0 - lat) * SZ) for lon, lat, *_ in ring]


def signed_area(ring) -> float:
    a = 0.0
    for (x0, z0), (x1, z1) in zip(ring, ring[1:] + ring[:1]):
        a += x0 * z1 - x1 * z0
    return a / 2


def rings_to_polygons(rings):
    """ESRI rings -> polygons. Exteriors have positive (x,z) area after the
    z-south flip; holes negative. Holes go to the smallest containing exterior."""
    ext, holes = [], []
    for r in rings:
        open_ring = r[:-1] if r[0] == r[-1] else r
        (ext if signed_area(open_ring) > 0 else holes).append(open_ring)
    polys = [[e, []] for e in sorted(ext, key=lambda e: abs(signed_area(e)))]
    orphan = 0
    for h in holes:
        hp = Polygon(h)
        target = next((q for q in polys if Polygon(q[0]).contains(hp.representative_point())), None)
        if target is None:
            orphan += 1
            continue
        target[1].append(h)
    return [Polygon(e, hs) for e, hs in polys], orphan


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
    if tags[258] != (32,) or tags[259] != (1,) or tags[277] != (1,) or tags.get(339) != (3,):
        raise SystemExit('DEM must be uncompressed single-band float32')
    tw, th = tags[322][0], tags[323][0]
    across = -(-width // tw)
    down = -(-height // th)
    grid = np.empty((down * th, across * tw), '<f4')
    for k, o in enumerate(tags[324]):
        r, c = divmod(k, across)
        grid[r * th:(r + 1) * th, c * tw:(c + 1) * tw] = np.frombuffer(b, '<f4', tw * th, o).reshape(th, tw)
    grid = grid[:height, :width].astype(np.float64)
    if 42113 in tags:
        raise SystemExit('DEM declares a nodata value; refuse to guess its handling')
    if not np.isfinite(grid).all():
        raise SystemExit('DEM contains non-finite samples')
    sx, sy = tags[33550][0], tags[33550][1]
    tie = tags[33922]
    extent = {'xmin': tie[3], 'ymax': tie[4], 'xmax': tie[3] + width * sx, 'ymin': tie[4] - height * sy}
    return grid, extent


class Dem:
    def __init__(self, grid, extent):
        self.g, self.e = grid, extent
        self.h, self.w = grid.shape

    def __call__(self, x, z):
        x = np.asarray(x, np.float64)
        z = np.asarray(z, np.float64)
        lon, lat = LON0 + x / SX, LAT0 - z / SZ
        e = self.e
        u = (lon - e['xmin']) / (e['xmax'] - e['xmin']) * self.w - .5
        v = (e['ymax'] - lat) / (e['ymax'] - e['ymin']) * self.h - .5
        i, j = np.floor(u).astype(int), np.floor(v).astype(int)
        f, g = u - i, v - j
        if (i < 0).any() or (j < 0).any() or (i + 1 >= self.w).any() or (j + 1 >= self.h).any():
            raise SystemExit('Attempted DEM extrapolation')
        r = self.g
        return (r[j, i] * (1 - f) * (1 - g) + r[j, i + 1] * f * (1 - g)
                + r[j + 1, i] * (1 - f) * g + r[j + 1, i + 1] * f * g) + NAVD_TO_CAMPUS


# ----------------------------------------------------------------------------- old seam
def offline_seam(path: Path):
    data = gzip.decompress(path.read_bytes())
    magic, version, count = struct.unpack('<III', data[:12])
    if magic != 0x55544752 or version != 1 or len(data) != 20 + count * 20:
        raise SystemExit('Unexpected offline terrain format')
    pos = np.frombuffer(data, '<f4', count * 3, 20).reshape(-1, 3)
    seam = pos[pos[:, 0] == np.float32(SEAM_X)]
    out = {}
    for _, y, z in seam:
        k = float(z)
        if k in out and out[k] != y:
            raise SystemExit(f'Inconsistent offline seam height at z={k}')
        out[k] = np.float32(y)
    zs = sorted(out)
    if any(abs(b - a - 8) > 1e-6 for a, b in zip(zs, zs[1:])):
        raise SystemExit('Offline seam is not an 8 m vertex column')
    raw = b''.join(struct.pack('<ff', z, out[z]) for z in zs)
    return out, zs, hashlib.sha256(raw).hexdigest(), int((pos[:, 0] < SEAM_X - 1e-4).sum())


# ----------------------------------------------------------------------------- terrain
def build_terrain(dem: Dem, seam: dict, seam_zs: list):
    def edge(z):
        return float(np.interp(z, seam_zs, [float(seam[k]) for k in seam_zs]))

    xs = [UNION[0]] + list(np.arange(-1568.0, SEAM_X + 1, 4.0))
    zs = [UNION[2]] + list(np.arange(-508.0, 568.0 + 1, 4.0)) + [UNION[3]]
    assert xs[-1] == SEAM_X and xs[-2] == SEAM_X - 4
    pos, idx_of = [], {}

    def vertex(i, j, y):
        idx_of[(i, j)] = len(pos)
        pos.append((xs[i], float(np.float32(y)), zs[j]))

    seam_dem = {z: float(dem(SEAM_X, z)) for z in zs}
    max_blend_shift = 0.0
    for j, z in enumerate(zs):
        for i, x in enumerate(xs[:-1]):
            h = float(dem(x, z))
            if x > SEAM_X - BLEND:
                t = (x - (SEAM_X - BLEND)) / BLEND
                w = t * t * (3 - 2 * t)
                shift = (edge(z) - seam_dem[z]) * w
                max_blend_shift = max(max_blend_shift, abs(shift))
                h += shift
            vertex(i, j, h)
    last = len(xs) - 1
    seam_rows = []
    for j, z in enumerate(zs):
        if z % 8 == 0:
            vertex(last, j, seam[float(z)])
            seam_rows.append(j)
        elif j in (0, len(zs) - 1):
            vertex(last, j, edge(z))   # on an old 8 m edge: interpolated, collinear
            seam_rows.append(j)
    tris = []

    def tri(a, b, c):
        pa, pb, pc = (np.array(pos[k]) for k in (a, b, c))
        n = np.cross(pb - pa, pc - pa)
        tris.append((a, b, c) if n[1] > 0 else (a, c, b))

    for i in range(len(xs) - 2):
        for j in range(len(zs) - 1):
            a, b = idx_of[(i, j)], idx_of[(i + 1, j)]
            c, d = idx_of[(i, j + 1)], idx_of[(i + 1, j + 1)]
            tri(a, c, b)
            tri(b, c, d)
    # Zipper strip x in [-764, -760]: no T-junction with the old 8 m seam edges.
    left = [idx_of[(last - 1, j)] for j in range(len(zs))]
    right = [idx_of[(last, j)] for j in seam_rows]
    p = q = 0
    while p < len(left) - 1 or q < len(right) - 1:
        if q == len(right) - 1 or (p < len(left) - 1 and pos[left[p + 1]][2] <= pos[right[q + 1]][2]):
            tri(left[p], left[p + 1], right[q]); p += 1
        else:
            tri(left[p], right[q + 1], right[q]); q += 1
    pos = np.array(pos, np.float64)
    tris = np.array(tris, np.int64)
    return {'xs': xs, 'zs': zs, 'pos': pos, 'tris': tris, 'maxBlendShift': max_blend_shift,
            'seamVertices': len(right)}


class TerrainQuery:
    """Exact height of the baked triangles (the render/collider surface)."""
    def __init__(self, terrain):
        self.pos, self.tris = terrain['pos'], terrain['tris']
        p = self.pos[self.tris]
        self.polys = shapely.polygons(p[:, :, [0, 2]])
        self.tree = shapely.STRtree(self.polys)
        a, b, c = p[:, 0], p[:, 1], p[:, 2]
        n = np.cross(b - a, c - a)
        self.A = -n[:, 0] / n[:, 1]
        self.B = -n[:, 2] / n[:, 1]
        self.C = a[:, 1] - self.A * a[:, 0] - self.B * a[:, 2]

    def plane(self, t, x, z):
        return self.A[t] * x + self.B[t] * z + self.C[t]

    def heights(self, xz):
        xz = np.asarray(xz, np.float64)
        pts = shapely.points(xz)
        pi, ti = self.tree.query(pts, predicate='intersects')
        out = np.full(len(xz), np.nan)
        out[pi] = self.plane(ti, xz[pi, 0], xz[pi, 1])
        return out


# ----------------------------------------------------------------------------- helpers
def drape_at(x):
    """Linear inside the zipper strip, whose west edge x=-764 is a terrain triangle edge (kink on an edge)."""
    return DRAPE * np.clip((SEAM_X - np.asarray(x, np.float64)) / DRAPE_FADE, 0.0, 1.0)


def ring_list(geom, digits=3):
    def r(coords):
        c = list(coords)[:-1]
        return [[round(x, digits), round(z, digits)] for x, z in c]
    polys = [geom] if isinstance(geom, Polygon) else list(getattr(geom, 'geoms', []))
    out = []
    for p in polys:
        if not isinstance(p, Polygon) or p.is_empty or p.area < 1e-4:
            continue
        p = shapely.geometry.polygon.orient(p, 1.0)
        out.append([r(p.exterior.coords)] + [r(h.coords) for h in p.interiors])
    return out


def polygons_of(geom):
    if geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    out = []
    for g in getattr(geom, 'geoms', []):
        out.extend(polygons_of(g))
    return out


def stable_hash(n: int) -> int:
    h = 2166136261
    for byte in str(n).encode():
        h = ((h ^ byte) * 16777619) & 0xFFFFFFFF
    return h


# Generic, ESTIMATED architectural treatment per district. Measured: footprint
# rings, holes and MAX_HEIGHT. Colours/materials/window rhythm are judged from
# the actual reference orbit pixels (eyeballed, not measured) and labelled so.
STYLES = {
    'D37': {'note': 'Brick low-rise apartments with white flat roofs, a few pitched houses (d37 orbit pixels).',
            'walls': [('brownBrick', [150, 92, 72], 5), ('brownBrick', [168, 112, 86], 3), ('siding', [214, 210, 200], 2)],
            'flatRoof': [('membrane', [218, 216, 208])], 'pitchedRoof': [('shingle', [92, 90, 86], 3), ('clayTile', [150, 82, 58], 1)],
            'floor': 2.9, 'bay': 3.2, 'window': [0.42, 0.3, 0.78], 'frame': 0, 'surround': 0},
    'D38': {'note': 'Detached houses, pale siding, dark pitched roofs under dense canopy (d38 orbit pixels).',
            'walls': [('siding', [216, 214, 206], 5), ('siding', [196, 186, 164], 2), ('siding', [168, 176, 182], 2), ('brownBrick', [158, 104, 82], 2)],
            'flatRoof': [('membrane', [170, 168, 162])], 'pitchedRoof': [('shingle', [84, 84, 82], 4), ('shingle', [104, 92, 80], 2)],
            'floor': 3.0, 'bay': 3.6, 'window': [0.38, 0.3, 0.8], 'frame': 2, 'surround': 0},
    'D39': {'note': 'Mixed 2-4 storey apartments, beige/pink stucco and pale brick, grey roofs (d39 orbit pixels).',
            'walls': [('stucco', [208, 184, 160], 4), ('stucco', [212, 196, 178], 3), ('buffBrick', [176, 150, 122], 2), ('siding', [206, 206, 202], 2)],
            'flatRoof': [('membrane', [150, 150, 148]), ('membrane', [196, 194, 188])], 'pitchedRoof': [('shingle', [112, 112, 110], 3), ('clayTile', [158, 104, 84], 1)],
            'floor': 3.0, 'bay': 3.4, 'window': [0.44, 0.3, 0.8], 'frame': 0, 'surround': 1},
    'D40': {'note': 'Dense mid/high-rise housing: white/grey precast, coloured stucco accents, flat roofs (d40 orbit pixels; tile mesh distorted).',
            'walls': [('precast', [214, 214, 208], 4), ('stucco', [218, 204, 176], 2), ('stucco', [186, 112, 76], 1), ('precast', [158, 170, 186], 1), ('brownBrick', [160, 86, 64], 1)],
            'flatRoof': [('membrane', [208, 208, 204])], 'pitchedRoof': [('shingle', [104, 104, 102], 1)],
            'floor': 3.15, 'bay': 3.0, 'window': [0.5, 0.28, 0.82], 'frame': 0, 'surround': 0},
}


def pick(options, h):
    total = sum(o[-1] if len(o) == 3 else 1 for o in options)
    k = h % total
    for o in options:
        w = o[-1] if len(o) == 3 else 1
        if k < w:
            return o[0], o[1]
        k -= w
    return options[0][0], options[0][1]


def obb(poly: Polygon):
    rect = poly.minimum_rotated_rectangle
    c = list(rect.exterior.coords)[:4]
    e0 = np.subtract(c[1], c[0]); e1 = np.subtract(c[2], c[1])
    l0, l1 = np.linalg.norm(e0), np.linalg.norm(e1)
    axis = e0 / l0 if l0 >= l1 else e1 / l1
    return rect, max(l0, l1), min(l0, l1), axis, np.mean(c, axis=0)


# ----------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--raw', required=True, type=Path)
    ap.add_argument('--packets', required=True, type=Path)
    args = ap.parse_args()
    raw, packets = args.raw, args.packets
    inputs = {name: raw / name for name in ['building-footprints-2023.json', 'road-sidewalk-surfaces-2023.json',
                                            'buildings-layer.json', 'usgs-bare-earth-dem.tif', 'dem-export.json',
                                            'dem-request.json', 'provenance.json', 'terrain-candidate.json',
                                            'impervious-layer.json', 'surface-query.json']}
    for d in ['D37', 'D38', 'D39', 'D40']:
        inputs[f'packet-{d}.json'] = packets / f'{d}.json'
    inputs['offline-terrain-61.bin.gz'] = ROOT / 'public/assets/campus/offline-terrain-61.bin.gz'
    inputs['campus.json'] = ROOT / 'public/data/campus.json'
    inputs['terrain.json'] = ROOT / 'public/data/terrain.json'
    hashes = {k: sha256(v) for k, v in inputs.items()}

    # --- vertical unit evidence (documented, checked) -------------------------------
    layer = json.loads(inputs['buildings-layer.json'].read_text())
    ssr = layer['sourceSpatialReference']
    shmi = layer.get('sourceHeightModelInfo') or {}
    unit_evidence = {
        'sourceHeightModelInfo': shmi,
        'sourceSpatialReference': {k: ssr.get(k) for k in ['wkid', 'latestWkid', 'vcsWkid', 'latestVcsWkid']},
        'statement': 'The layer metadata states the unit explicitly: sourceHeightModelInfo = gravity_related_height, '
                     'vertCRS NAVD88_height_(ftUS), heightUnit us-foot (consistent with VCS 105703/6360). '
                     'MAX_HEIGHT = ELEVATION - BASE_ELEVATION holds for every record, so MAX_HEIGHT is a height '
                     'difference in US survey feet. metres = ft * 1200/3937.',
    }
    if (shmi.get('heightUnit') != 'us-foot' or shmi.get('heightModel') != 'gravity_related_height'
            or ssr.get('latestVcsWkid') != 6360):
        raise SystemExit('Unexpected source height model/unit; refuse to convert heights')

    # --- packets / ownership --------------------------------------------------------
    rects = {}
    for d in ['D37', 'D38', 'D39', 'D40']:
        pk = json.loads(inputs[f'packet-{d}.json'].read_text())
        rects[d] = pk['rectangles']
    covered = unary_union([box(r[0], r[2], r[1], r[3]) for rs in rects.values() for r in rs])
    if abs(covered.area - box(UNION[0], UNION[2], UNION[1], UNION[3]).area) > 1e-6 or not covered.equals(box(UNION[0], UNION[2], UNION[1], UNION[3])):
        raise SystemExit('Packet rectangles do not tile the planned union')
    district_box = {d: unary_union([box(r[0], r[2], r[1], r[3]) for r in rs]) for d, rs in rects.items()}

    # --- DEM + seam + terrain -------------------------------------------------------
    grid, extent = read_tiff(inputs['usgs-bare-earth-dem.tif'])
    exported = json.loads(inputs['dem-export.json'].read_text())['extent']
    for k in ['xmin', 'xmax', 'ymin', 'ymax']:
        if abs(exported[k] - extent[k]) > 1e-9:
            raise SystemExit(f'DEM georeference mismatch on {k}')
    dem = Dem(grid, extent)
    cand = json.loads(inputs['terrain-candidate.json'].read_text())
    cx = cand['x0'] + cand['step'] * np.arange(cand['nx'])
    cz = cand['z0'] + cand['step'] * np.arange(cand['nz'])
    gx, gz = np.meshgrid(cx, cz)
    cand_diff = float(np.abs(dem(gx.ravel(), gz.ravel()) - np.array(cand['heights'])).max())
    if cand_diff > 1e-3:
        raise SystemExit(f'DEM reader disagrees with convert.py candidate ({cand_diff})')
    seam, seam_zs, seam_hash, old_west_of_seam = offline_seam(inputs['offline-terrain-61.bin.gz'])
    if old_west_of_seam:
        raise SystemExit('Offline terrain already has vertices west of the seam')
    terrain = build_terrain(dem, seam, seam_zs)
    tq = TerrainQuery(terrain)
    seam_cmp = []
    for z in seam_zs:
        if UNION[2] <= z <= UNION[3]:
            seam_cmp.append(float(dem(SEAM_X, z)) - float(seam[z]))
    seam_cmp = np.array(seam_cmp)

    # --- campus reconciliation ---------------------------------------------------------
    campus = json.loads(inputs['campus.json'].read_text())
    campus_ids = {b['id'] for b in campus['buildings']}
    campus_polys, campus_keys = [], []
    for i, b in enumerate(campus['buildings']):
        try:
            p = Polygon(b['rings'][0], b['rings'][1:])
        except Exception:
            continue
        if p.bounds[0] < -700:
            campus_polys.append(p.buffer(0)); campus_keys.append(f"{b['id']}:{i}")
    campus_tree = shapely.STRtree(campus_polys)

    # --- buildings ------------------------------------------------------------------------
    src = json.loads(inputs['building-footprints-2023.json'].read_text())
    included, excluded = [], []
    for f in src['features']:
        a = f['attributes']
        sid, key = a['OBJECTID'], f"coa-2023:{a['OBJECTID']}"
        rings = [metric(r) for r in f['geometry']['rings']]
        polys, orphan = rings_to_polygons(rings)
        reason = None
        if orphan or len(polys) != 1:
            reason = f'{len(polys)} exterior rings / {orphan} unassigned holes; not a single indivisible footprint'
        poly = polys[0] if polys else None
        if not reason and not poly.is_valid:
            reason = 'invalid source polygon: ' + shapely.is_valid_reason(poly)
        mh, el, be = a.get('MAX_HEIGHT'), a.get('ELEVATION'), a.get('BASE_ELEVATION')
        if not reason and not all(isinstance(v, (int, float)) and math.isfinite(v) for v in (mh, el, be)):
            reason = 'missing height attributes'
        if not reason and abs((el - be) - mh) > 0.05:
            reason = 'MAX_HEIGHT != ELEVATION - BASE_ELEVATION'
        minx, minz, maxx, maxz = poly.bounds if poly is not None else (0, 0, 0, 0)
        if not reason:
            out = []
            if maxx + CLEAR > UNION[1]: out.append('crosses or within 3 m of the east seam x=-760 (existing world owns x>=-760)')
            if minx - CLEAR < UNION[0]: out.append('crosses or within 3 m of the west edge x=-1570')
            if minz - CLEAR < UNION[2]: out.append('crosses or within 3 m of the north edge z=-510')
            if maxz + CLEAR > UNION[3]: out.append('crosses or within 3 m of the south edge z=570')
            if out: reason = '; '.join(out)
        if reason:
            rec = {'key': key, 'sourceId': sid, 'reason': reason,
                   'bbox': [round(minx, 2), round(maxx, 2), round(minz, 2), round(maxz, 2)],
                   'heightMeters': round(mh * US_FOOT, 3) if isinstance(mh, (int, float)) else None}
            if sid in campus_ids:
                rec['existingWorldRecord'] = 'same OBJECTID already in public/data/campus.json (clipped at x=-760); not duplicated'
            excluded.append(rec)
            continue
        hits = campus_tree.query(poly, predicate='intersects')
        if len(hits) or sid in campus_ids:
            excluded.append({'key': key, 'sourceId': sid, 'reason': 'overlaps existing campus.json record ' + ','.join(campus_keys[h] for h in hits)})
            continue
        centroid = poly.centroid
        district = next(d for d, g in district_box.items() if g.covers(centroid))
        height = mh * US_FOOT
        # Ground: densified boundary on the baked terrain triangles.
        samples = []
        for ring in [poly.exterior, *poly.interiors]:
            line = LineString(ring.coords)
            n = max(4, int(math.ceil(line.length)))
            samples += [line.interpolate(t, normalized=True).coords[0] for t in np.linspace(0, 1, n, endpoint=False)]
        g = tq.heights(samples)
        if not np.isfinite(g).all():
            raise SystemExit(f'{key}: footprint ground outside baked terrain')
        gmin, gmax = float(g.min()), float(g.max())
        base_campus = be * US_FOOT + NAVD_TO_CAMPUS
        h = stable_hash(sid)
        style = STYLES[district]
        wall_family, wall_rgb = pick(style['walls'], h)
        top = gmin + height
        # Roof form. MAX_HEIGHT is the measured top; roof SHAPE is unknown.
        rect, long_side, short_side, axis, centre = obb(poly)
        fill = poly.area / rect.area if rect.area else 0
        roof = None
        pitched_ok = (district in ('D37', 'D38', 'D39') and not poly.interiors and poly.area <= 350 and height <= 12.5
                      and fill >= 0.85 and 4.5 <= short_side <= 15)
        if pitched_ok:
            slope = 0.5  # ~26.6 deg, ESTIMATED
            rise = slope * short_side / 2
            eave = top - rise
            if eave - gmax < 2.6:
                eave = gmax + 2.6
                rise = top - eave
                slope = rise / (short_side / 2)
            if rise >= 0.9:
                normal = np.array([-axis[1], axis[0]])
                big = long_side + short_side + 50
                halves = []
                for sign in (1, -1):
                    side = Polygon([tuple(centre - axis * big), tuple(centre + axis * big),
                                    tuple(centre + axis * big + sign * normal * big), tuple(centre - axis * big + sign * normal * big)])
                    halves += ring_list(poly.intersection(side))
                if len(halves) == 2 and abs(sum(Polygon(hh[0]).area for hh in halves) - poly.area) < 0.05:
                    roof_family, roof_rgb = pick(style['pitchedRoof'], h >> 3)
                    roof = {'form': 'gable-estimated', 'ridge': [[round(v, 3) for v in centre], [round(axis[0], 6), round(axis[1], 6)]],
                            'ridgeY': round(top, 3), 'slope': round(slope, 4), 'eaveY': round(eave, 3),
                            'halves': halves, 'family': roof_family, 'rgb': roof_rgb}
        if roof is None:
            roof_family, roof_rgb = pick(style['flatRoof'], h >> 3)
            deck = top - 0.9
            inset = poly.buffer(-0.3, join_style='mitre', mitre_limit=2.0)
            if deck - gmax >= 2.4 and not inset.is_empty and inset.area > 4:
                coping = poly.difference(inset)
                roof = {'form': 'flat-parapet', 'deckY': round(deck, 3), 'topY': round(top, 3),
                        'deck': ring_list(inset), 'coping': ring_list(coping), 'family': roof_family, 'rgb': roof_rgb}
            else:
                roof = {'form': 'flat', 'deckY': round(top, 3), 'topY': round(top, 3), 'family': roof_family, 'rgb': roof_rgb}
        included.append({
            'key': key, 'sourceId': sid, 'district': district,
            'rings': ring_list(shapely.geometry.polygon.orient(poly, 1.0))[0],
            'sourceRingCount': len(f['geometry']['rings']),
            'heightMeters': round(height, 3), 'groundMin': round(gmin, 3), 'groundMax': round(gmax, 3),
            'baseMinusGround': round(base_campus - gmin, 3),
            'wall': {'family': wall_family, 'rgb': wall_rgb},
            'roof': roof,
        })
    included.sort(key=lambda b: b['sourceId'])
    inc_polys = [Polygon(b['rings'][0], b['rings'][1:]) for b in included]
    footprint_union = unary_union(inc_polys)

    # --- surfaces --------------------------------------------------------------------------
    ssrc = json.loads(inputs['road-sidewalk-surfaces-2023.json'].read_text())
    union_box = box(UNION[0], UNION[2], UNION[1], UNION[3])
    records, surface_excluded = [], []
    rank = {k: i for i, k in enumerate(SURFACE_PRIORITY)}
    for f in ssrc['features']:
        a = f['attributes']
        key, kind = f"coa-impervious-2023:{a['OBJECTID']}", a['FEATURE']
        if kind in EXCLUDED_SURFACE_KINDS:
            surface_excluded.append({'key': key, 'kind': kind, 'reason': EXCLUDED_SURFACE_KINDS[kind]}); continue
        if kind not in rank:
            surface_excluded.append({'key': key, 'kind': kind, 'reason': 'unrecognised feature kind'}); continue
        polys, orphan = rings_to_polygons([metric(r) for r in f['geometry']['rings']])
        geom = unary_union([p if p.is_valid else shapely.make_valid(p) for p in polys])
        clipped = geom.intersection(union_box)
        if clipped.is_empty or clipped.area < 0.01:
            surface_excluded.append({'key': key, 'kind': kind, 'reason': 'outside owned union x[-1570,-760] z[-510,570]'}); continue
        records.append({'key': key, 'kind': kind, 'oid': a['OBJECTID'], 'geom': clipped,
                        'sourceRings': len(f['geometry']['rings']), 'orphanHoles': orphan,
                        'clippedFraction': round(clipped.area / geom.area, 4) if geom.area else 0})
    records.sort(key=lambda r: (rank[r['kind']], r['oid']))
    geoms = [r['geom'] for r in records]
    stree = shapely.STRtree(geoms)
    pieces = []
    for k, r in enumerate(records):
        earlier = [i for i in stree.query(r['geom'], predicate='intersects') if i < k]
        piece = r['geom'].difference(unary_union([geoms[i] for i in earlier])) if earlier else r['geom']
        piece = piece.difference(footprint_union)
        r['pieceArea'] = round(piece.area, 3)
        if piece.area < 0.01:
            r['status'] = 'fully covered by higher-priority surface or included building'
            continue
        r['status'] = 'draped'
        pieces.append((r['kind'], piece))

    # Drape: intersect only nearby terrain triangles (STRtree), constrained Delaunay.
    surf = {}
    drape_pairs = 0
    for kind, piece in pieces:
        for poly in polygons_of(piece):
            cand_t = tq.tree.query(poly, predicate='intersects')
            if not len(cand_t):
                raise SystemExit('surface outside terrain')
            drape_pairs += len(cand_t)
            frags = shapely.intersection(tq.polys[cand_t], poly)
            for t, frag in zip(cand_t, frags):
                for fp in polygons_of(frag):
                    if fp.area < 1e-5:
                        continue
                    tri_geom = shapely.constrained_delaunay_triangles(fp)
                    for tg in polygons_of(tri_geom):
                        c = np.array(tg.exterior.coords)[:3]
                        if abs(signed_area([tuple(v) for v in c])) < 1e-7:
                            continue
                        ys = tq.plane(t, c[:, 0], c[:, 1]) + drape_at(c[:, 0])
                        v = np.column_stack([c[:, 0], ys, c[:, 1]])
                        # up-facing winding
                        if np.cross(v[1] - v[0], v[2] - v[0])[1] < 0:
                            v = v[[0, 2, 1]]
                        surf.setdefault(kind, []).append(v)
    surf_arrays = {k: np.array(v, np.float32).reshape(-1, 3) for k, v in surf.items()}
    def tri_area(v):
        t = np.array(v)
        e1, e2 = t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]
        return float(np.abs(e1[:, 0] * e2[:, 2] - e1[:, 2] * e2[:, 0]).sum() / 2)
    surf_area = {k: tri_area(v) for k, v in surf.items()}
    piece_area = {}
    for kind, piece in pieces:
        piece_area[kind] = piece_area.get(kind, 0) + piece.area

    # --- map layer (simplified for the 2D map only) -----------------------------------
    map_surfaces = {}
    for kind in SURFACE_PRIORITY:
        g = unary_union([p for k, p in pieces if k == kind])
        if not g.is_empty:
            map_surfaces[kind] = ring_list(g.simplify(0.4, preserve_topology=True), 1)

    # --- shots: actual reference positions, AGL basis corrected --------------------------
    shots = []
    old_terrain = json.loads(inputs['terrain.json'].read_text())
    for d in ['D37', 'D38', 'D39', 'D40']:
        pk = json.loads(inputs[f'packet-{d}.json'].read_text())
        for o in pk['actualOrbitReferences']:
            cam, tgt = o['actualCameraCampus'], o['actualTargetCampus']
            gc = float(tq.heights([[cam[0], cam[2]]])[0])
            gt = float(tq.heights([[tgt[0], tgt[2]]])[0])
            if not (math.isfinite(gc) and math.isfinite(gt)):
                raise SystemExit(f"{o['captureId']} pose outside extension terrain")
            inside = [b['key'] for b, p in zip(included, inc_polys) if p.contains(Point(cam[0], cam[2]))
                      and gc + 30 < (b['roof']['topY'] if 'topY' in b['roof'] else b['roof']['ridgeY'])]
            shots.append({
                'id': o['captureId'], 'district': d, 'kind': 'aerial',
                'label': f"{d} deep west · {o['captureId'].split('-')[-1]} orbit (reference pose)",
                'position': [round(cam[0], 2), round(gc + 30, 2), round(cam[2], 2)],
                'target': [round(tgt[0], 2), round(gt + 8, 2), round(tgt[2], 2)],
                'fov': round(o['verticalFovDegrees'], 2), 'groundY': round(gc, 3),
                'focus': [round(tgt[0], 2), round(gt, 2), round(tgt[2], 2)],
                'referenceReview': o['visualReview']['status'],
                'note': (f"Reference capture {o['captureId']} horizontal pose. Camera Y = baked extension terrain "
                         f"{gc:.2f} + 30 m (packet used clamped planning terrain {o['height']['sampledPlanningTerrainY']}); "
                         f"target Y = extension terrain + 8 m. Not surveyed AGL."
                         + (f" Camera falls inside footprint(s) {','.join(inside)} below its top." if inside else '')),
            })

    # --- binary --------------------------------------------------------------------------
    sections, blobs, offset = [], [], 0

    def add(name, arr, dtype):
        nonlocal offset
        data = np.ascontiguousarray(arr, dtype).tobytes()
        sections.append({'name': name, 'type': 'f32' if dtype == '<f4' else 'u32', 'byteOffset': offset, 'count': int(np.asarray(arr).size)})
        blobs.append(data)
        offset += len(data)

    add('terrain.position', terrain['pos'], '<f4')
    add('terrain.index', terrain['tris'], '<u4')
    for kind in SURFACE_PRIORITY:
        if kind in surf_arrays:
            add(f'surface.{kind}', surf_arrays[kind], '<f4')
    payload = b''.join(blobs)

    # Float-exactness of the seam column, re-read from what will ship.
    pos32 = terrain['pos'].astype(np.float32)
    seam_rows = pos32[pos32[:, 0] == np.float32(SEAM_X)]
    seam_exact = all(seam_rows[k, 1] == seam[float(seam_rows[k, 2])] for k in range(len(seam_rows)) if float(seam_rows[k, 2]) % 8 == 0)
    if not seam_exact:
        raise SystemExit('Seam column is not float-identical to offline-terrain-61')
    max_x = max(float(pos32[:, 0].max()), *(float(a[:, 0].max()) for a in surf_arrays.values()))
    if max_x > SEAM_X:
        raise SystemExit(f'Extension geometry east of the seam: {max_x}')

    meta = {
        'format': 'ut-deep-west', 'version': VERSION,
        'frame': {'origin': [LON0, LAT0], 'sx': SX, 'sz': SZ, 'verticalTransform': 'campus Y = NAVD88 metres - 165'},
        'union': {'xmin': UNION[0], 'xmax': UNION[1], 'zmin': UNION[2], 'zmax': UNION[3]},
        'districts': {d: {'rectangles': rs, 'style': STYLES[d]['note'], 'floor': STYLES[d]['floor'], 'bay': STYLES[d]['bay'],
                          'window': STYLES[d]['window'], 'frame': STYLES[d]['frame'], 'surround': STYLES[d]['surround']}
                      for d, rs in rects.items()},
        'seam': {'x': SEAM_X, 'blendWidth': BLEND, 'offlineSeamSha256': seam_hash,
                 'vertices': [[float(z), float(seam[z])] for z in seam_zs if UNION[2] - 8 <= z <= UNION[3] + 8]},
        'drape': DRAPE, 'drapeFade': DRAPE_FADE,
        'sections': sections,
        'buildings': included,
        'map': {'surfaces': map_surfaces},
        'counts': {'buildings': len(included), 'excludedBuildings': len(excluded), 'terrainVertices': len(terrain['pos']),
                   'terrainTriangles': len(terrain['tris']),
                   'surfaceTriangles': {k: len(v) // 3 for k, v in surf_arrays.items()}},
    }
    meta_bytes = json.dumps(meta, separators=(',', ':')).encode()
    meta_bytes += b' ' * (-len(meta_bytes) % 4)
    body = meta_bytes + payload
    checksum = fnv_words(body)
    header = struct.pack('<IIIII', MAGIC, VERSION, len(meta_bytes), len(payload), checksum)
    asset = gzip.compress(header + body, compresslevel=9, mtime=0)
    OUT_ASSET.mkdir(parents=True, exist_ok=True)
    OUT_LIB.mkdir(parents=True, exist_ok=True)
    (OUT_ASSET / 'deep-west-v1.bin.gz').write_bytes(asset)
    asset_hash = hashlib.sha256(asset).hexdigest()

    by_district = {}
    for b in included:
        by_district.setdefault(b['district'], []).append(b['key'])
    roof_forms = {}
    for b in included:
        roof_forms[b['roof']['form']] = roof_forms.get(b['roof']['form'], 0) + 1
    base_diff = sorted(b['baseMinusGround'] for b in included)
    manifest = {
        'asset': 'deep-west-v1.bin.gz', 'assetSha256': asset_hash, 'checksumFnv1aWords': checksum,
        'status': 'runtime-integrated evidence extension; not a survey, not current-age, not 1:1',
        'inputs': {k: {'sha256': v, 'file': k} for k, v in hashes.items()},
        'heightUnits': unit_evidence,
        'transforms': {'horizontal': 'x=(lon+97.73716)*96126.8152981172, z=(30.2861-lat)*110851 (campus metres)',
                       'vertical': 'campus Y = NAVD88 m - 165 (derived/sources.json campusMinusNavd88m)',
                       'note': 'LiDAR horizontal calibration shift (~0.2 m, ~1.1 m) is NOT applied to this DEM (4 m grid).'},
        'terrain': {'grid': '4 m nodes x in {-1570,-1568..-760}, z in {-510,-508..568,570}; zipper strip x[-764,-760] onto the old 8 m seam',
                    'source': 'USGS 3DEP bare-earth DEM, bilinear sample at nodes, minus 165',
                    'readerVsConvertCandidateMaxAbs': cand_diff,
                    'seam': {'offlineTerrainSha256': hashes['offline-terrain-61.bin.gz'], 'seamColumnSha256': seam_hash,
                             'seamVerticesCopied': int(sum(1 for z in seam_zs if UNION[2] <= z <= UNION[3])),
                             'demMinusOffline': {'min': float(seam_cmp.min()), 'median': float(np.median(seam_cmp)),
                                                 'max': float(seam_cmp.max()), 'maxAbs': float(np.abs(seam_cmp).max())},
                             'blend': f'derived smoothstep transition over {BLEND} m west of x=-760 (not measured terrain)',
                             'maxBlendShift': terrain['maxBlendShift']}},
        'buildings': {'included': len(included), 'byDistrict': {d: len(v) for d, v in sorted(by_district.items())},
                      'keysByDistrict': by_district, 'roofForms': roof_forms,
                      'baseElevationMinusBakedGround': {'p05': base_diff[len(base_diff) // 20], 'median': base_diff[len(base_diff) // 2],
                                                        'p95': base_diff[-len(base_diff) // 20 - 1], 'min': base_diff[0], 'max': base_diff[-1]},
                      'heightRule': 'top = min baked ground under footprint boundary + MAX_HEIGHT (ft->m). BASE_ELEVATION is not used as an absolute because it differs from the DEM (see baseElevationMinusBakedGround).',
                      'excluded': excluded,
                      'existingWorldNearSeam': [k for k in campus_keys]},
        'surfaces': {'priority': SURFACE_PRIORITY, 'drapeMetres': DRAPE, 'records': len(records),
                     'draped': sum(1 for r in records if r.get('status') == 'draped'),
                     'details': [{k: r[k] for k in ['key', 'kind', 'status', 'pieceArea', 'clippedFraction', 'sourceRings', 'orphanHoles']} for r in records],
                     'excluded': surface_excluded,
                     'pieceAreaByKind': {k: round(v, 2) for k, v in piece_area.items()},
                     'drapedAreaByKind': {k: round(v, 2) for k, v in surf_area.items()},
                     'drapeTrianglePairsQueried': drape_pairs,
                     'rule': 'clip to owned union, remove included building footprints (courtyard holes kept), per-record difference against higher-priority/earlier records, split only on intersecting terrain triangles (STRtree), constrained Delaunay, y = terrain plane + 0.04 m, fading linearly to 0 over x[-764,-760] so surfaces meet the old seam flush'},
        'architecture': {'measured': ['footprint rings and holes (2023)', 'MAX_HEIGHT top'],
                         'estimated': ['wall material family/colour per district from reference pixels (eyeballed)',
                                       'storey height and window bays (shader openings)', 'parapet 0.9 m / 0.3 m inset on flat roofs',
                                       'gable roof form on small near-rectangular D37-D39 houses (ridge at measured top, ~26.6 deg)',
                                       'plinth band'],
                         'styles': {d: s['note'] for d, s in STYLES.items()},
                         'references': 'district orbit contact sheets d37..d40 (research only; never shipped or used as textures)'},
        'shots': [s['id'] for s in shots],
    }
    (OUT_ASSET / 'deep-west-v1.manifest.json').write_text(json.dumps(manifest, indent=1) + '\n')
    prov = json.loads(inputs['provenance.json'].read_text())
    dem_req = json.loads(inputs['dem-request.json'].read_text())
    sources = {
        'deepWestExtension': [
            {'dataset': 'City of Austin Planimetrics 2023 - Building Footprints 2023 (layer 0)',
             'publisher': 'City of Austin', 'query': prov['queryUrl'], 'retrievedAt': prov['retrievedAt'],
             'use': 'footprint rings/holes and MAX_HEIGHT (US survey feet)', 'sha256': hashes['building-footprints-2023.json']},
            {'dataset': 'City of Austin Planimetrics 2023 - Impervious Cover 2023 (layer 1; roads, sidewalks, pavement, courtyards, alleys, trails)',
             'publisher': 'City of Austin', 'use': 'surface polygons (bridges excluded)', 'sha256': hashes['road-sidewalk-surfaces-2023.json']},
            {'dataset': 'USGS 3D Elevation Program (3DEP) bare-earth DEM via the National Map elevation ImageServer',
             'publisher': 'U.S. Geological Survey', 'license': 'Public domain (U.S. Government work). Credit: U.S. Geological Survey.',
             'query': dem_req['url'], 'use': 'extension terrain, NAVD88 m - 165', 'sha256': hashes['usgs-bare-earth-dem.tif']},
        ],
        'limitations': ['2023 footprints are not a current-building survey', 'facade materials, windows, parapets and pitched roofs are generic estimates',
                        'road polygons do not establish permissions or markings', 'no trees or bridges are modelled in the extension'],
    }
    (OUT_ASSET / 'sources.json').write_text(json.dumps(sources, indent=1) + '\n')
    (OUT_LIB / 'ownership.json').write_text(json.dumps({
        'generatedBy': 'tools/extension/bake-deep-west.py', 'union': meta['union'],
        'districts': {d: {'rectangles': rs, 'buildings': by_district.get(d, [])} for d, rs in rects.items()},
        'excludedBuildings': [{'key': e['key'], 'reason': e['reason']} for e in excluded],
    }, indent=1) + '\n')
    (OUT_LIB / 'shots.json').write_text(json.dumps(shots, indent=1) + '\n')
    print(json.dumps({'asset': str(OUT_ASSET / 'deep-west-v1.bin.gz'), 'bytes': len(asset), 'sha256': asset_hash,
                      'checksum': checksum, 'counts': meta['counts'], 'roofForms': roof_forms,
                      'byDistrict': manifest['buildings']['byDistrict'], 'excluded': len(excluded),
                      'seam': manifest['terrain']['seam'], 'surfaceDraped': manifest['surfaces']['draped'],
                      'surfaceAreas': {k: [round(piece_area.get(k, 0), 1), round(surf_area.get(k, 0), 1)] for k in SURFACE_PRIORITY},
                      'metaBytes': len(meta_bytes), 'payloadBytes': len(payload)}, indent=1))


if __name__ == '__main__':
    main()
