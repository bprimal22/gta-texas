#!/usr/bin/env python3
"""Bake the central riverfront extension (Lady Bird Lake south bank: Auditorium Shores / Vic Mathias Shores, Butler
Metro Park, the Butler Hike-and-Bike Trail between the Lamar and South First bridges, the Pfluger bridge crossing, the
Long Center and Palmer Events Center) into one same-origin runtime asset. Evidence import, not a survey.

The asset is BOUND to the shipped downtown asset (downtown-v1.bin.gz): its FNV checksum and wall-list hash are stored
and every riverfront terrain vertex at x >= -1760 is a float-identical copy of the downtown terrain vertex. The runtime
rejects the riverfront (and keeps the original world) on any mismatch.

Sources (all already fetched for the downtown extension; nothing new is downloaded):
  * downtown-v1.bin.gz (repo): 4 m 3DEP terrain, 1 m City ground classes, LiDAR canopy trees, building records, walls
  * .work/claude-downtown/background-raw: 3DEP DEM export (~2 m, 2026-10-23) and City of Austin 2023 Planimetrics
    (building footprints with MAX_HEIGHT, impervious cover) and City parks — west of x = -1760 (Pfluger south landings)
  * .work/claude-downtown/raw/streets-ctn.json: City CTN street centrelines (corridor edges)
  * .work/claude-downtown/ept/downtown-lidar-ept-depth10.npz: USGS 3DEP LiDAR TX_Central_B1_2017 subset (pond outlines
    = LiDAR water voids, pond banks, Long Center ring beam fit, Palmer roof profile, west-of-Lamar trees)
  * lib/campus/extension/downtown/pfluger-bridge.json (repo): Pfluger deck footprint and profile
Reference-only (visual research, nothing shipped): City labeled Butler Park aerial (edims 115490, 2008) for the names
and relative layout of Liz Carpenter Pond, Doug Sahm Hill, Butler Fountain, Willie Wells Field and the children's
garden; the Long Center and BGK (Palmer) project pages for form.

Run:
  .work/claude-downtown/venv/bin/python -I tools/extension/bake-riverfront.py \
      --raw .work/claude-downtown/raw --bg .work/claude-downtown/background-raw \
      --lidar .work/claude-downtown/ept/downtown-lidar-ept-depth10.npz [--preview .work/claude-riverfront/preview]
Deterministic: identical inputs give a byte-identical asset.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import importlib.util
import json
import math
import struct
from pathlib import Path

import numpy as np
import shapely
from PIL import Image, ImageDraw
from scipy import ndimage
from shapely.geometry import LineString, MultiLineString, Point, Polygon, box
from shapely.ops import linemerge, polygonize, unary_union
from skimage.measure import find_contours

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public' / 'assets' / 'extension'
DOWNTOWN = OUT / 'downtown-v1.bin.gz'
PFLUGER_JSON = ROOT / 'lib' / 'campus' / 'extension' / 'downtown' / 'pfluger-bridge.json'

_spec = importlib.util.spec_from_file_location('bake_downtown', Path(__file__).resolve().parent / 'bake-downtown.py')
bd = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bd)  # constants and helpers only (its main() is guarded)

MAGIC = 0x46525455  # 'UTRF'
VERSION = 1
STEP = 4.0
DT_X0, DT_Z0 = -1760.0, 1536.0           # downtown grid origin (shared lattice)
X0, X1, Z0, Z1 = -1924.0, -1000.0, 2100.0, 3088.0
CLASS_RES = 1.0
WATER_Y = bd.WATER_Y                      # -34.47 (shared lake surface, NAVD88 130.53)
SHORE_Y = bd.SHORE_Y
BARRIER_TOP = round(WATER_Y + 3.2, 2)     # same as downtown inlet barriers (water-safety bedTop - 0.3)
SEAM_BLEND = 16.0                         # west DEM -> downtown column x=-1760 offset fades over 16 m
OVERLAP = 8.0                             # flight region reaches this far into downtown land at opened shore walls
OWN_MARGIN = 10.0                         # owned terrain cells reach this far beyond the land edge (banks / lake bed)
DECK_CLEAR = 1.4 + 0.3 + 0.5              # girder + slab + gap: walls under the Pfluger deck stop this far below it
POND_BARRIER = 1.2
C_GRASS, C_ASPHALT, C_SIDEWALK, C_PLAZA, C_TRAIL, C_WATER, C_PARK, C_FOOTPRINT, C_PARKING = range(9)

xy = bd.xy


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def fnv_words(data: bytes) -> int:
    w = np.frombuffer(data, '<u4')
    h = 2166136261
    for v in w.tolist():
        h = ((h ^ v) * 16777619) & 0xFFFFFFFF
    return h


# ----------------------------------------------------------------------------- downtown asset
def load_downtown():
    raw = gzip.decompress(DOWNTOWN.read_bytes())
    magic, ver, ml, ck = struct.unpack('<IIII', raw[:16])
    if magic != 0x54445455 or ver != 1 or fnv_words(raw[16:]) != ck:
        raise SystemExit('downtown asset invalid')
    meta = json.loads(raw[16:16 + ml])
    base = 16 + ml
    sec = {}
    for s in meta['sections']:
        dt = '<f4' if s['type'] == 'f32' else 'u1'
        sec[s['name']] = np.frombuffer(raw, dt, s['count'], base + s['byteOffset'])
    nx, nz = meta['grid']['nx'], meta['grid']['nz']
    return {'meta': meta, 'checksum': ck, 'H': sec['heights'].reshape(nz, nx), 'flags': sec['cellFlags'].reshape(nz - 1, nx - 1),
            'cls': sec['classMap'].reshape(meta['classMap']['h'], meta['classMap']['w']), 'trees': sec['trees'].reshape(-1, 6),
            'bridges': sec['bridges'].reshape(-1, 9), 'gzSha': sha(DOWNTOWN.read_bytes())}


def walls_sum(walls) -> float:
    """Same as riverfront/format.ts wallsSum()."""
    return round(sum(v for w in walls for v in w), 2)


# ----------------------------------------------------------------------------- terrain
def build_grid(dt, dem):
    xs = X0 + STEP * np.arange(int(round((X1 - X0) / STEP)) + 1)
    zs = Z0 + STEP * np.arange(int(round((Z1 - Z0) / STEP)) + 1)
    H = np.zeros((len(zs), len(xs)), np.float64)
    i_dt0 = int(round((X0 - DT_X0) / STEP))
    j_dt0 = int(round((Z0 - DT_Z0) / STEP))
    west = xs < DT_X0 - 1e-9
    X, Zg = np.meshgrid(xs[west], zs)
    acc = np.zeros_like(X)
    for dx in (-STEP / 3, 0, STEP / 3):
        for dz in (-STEP / 3, 0, STEP / 3):
            acc += dem(X + dx, Zg + dz)
    Hw = acc / 9
    if np.isnan(Hw).any():
        raise SystemExit('DEM nodata west of the downtown grid')
    east_i = np.nonzero(~west)[0]
    Hdt = dt['H'][j_dt0:j_dt0 + len(zs), i_dt0 + east_i[0]:i_dt0 + east_i[-1] + 1].astype(np.float64)
    if Hdt.shape != (len(zs), len(east_i)):
        raise SystemExit('riverfront grid exceeds the downtown grid')
    # Seam: the DEM column at x=-1760 vs the downtown column; fade the offset westward.
    seam_dem = dem(np.full(len(zs), DT_X0), zs)
    seam_dem = np.mean([dem(np.full(len(zs), DT_X0 + dx), zs + dz) for dx in (-STEP / 3, 0, STEP / 3) for dz in (-STEP / 3, 0, STEP / 3)], axis=0)
    d = Hdt[:, 0] - seam_dem
    for k, x in enumerate(xs[west]):
        t = (DT_X0 - x) / SEAM_BLEND
        if t < 1:
            Hw[:, k] += d * (1 - t * t * (3 - 2 * t))
    H[:, west] = Hw
    H = H.astype(np.float32)
    H[:, ~west] = dt['H'][j_dt0:j_dt0 + len(zs), i_dt0 + east_i[0]:i_dt0 + east_i[-1] + 1]
    return xs, zs, H, {'maxSeamBlendShift': round(float(np.abs(d).max()), 3), 'dtOffset': [i_dt0, j_dt0]}


def grid_height(xs, zs, H, x, z):
    fx = np.clip((np.asarray(x) - X0) / STEP, 0, len(xs) - 1.000001)
    fz = np.clip((np.asarray(z) - Z0) / STEP, 0, len(zs) - 1.000001)
    i, j = np.floor(fx).astype(int), np.floor(fz).astype(int)
    u, v = fx - i, fz - j
    a, b, c, e = H[j, i], H[j, i + 1], H[j + 1, i], H[j + 1, i + 1]
    return np.where(u + v <= 1, a + (b - a) * u + (c - a) * v, e + (c - e) * (1 - u) + (b - e) * (1 - v))


def water_polygon(xs, zs, H):
    """Lake = connected low area (terrain below SHORE_Y), contoured on the 4 m grid (downtown's method)."""
    low = H < SHORE_Y
    lab, n = ndimage.label(low)
    sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    keep = np.zeros(n + 1, bool)
    keep[1:] = sizes > 2000
    water = keep[lab]
    padded = np.pad(np.where(water, -1.0, 1.0), 1, constant_values=1.0)
    polys = [Polygon([(X0 + (q[1] - 1) * STEP, Z0 + (q[0] - 1) * STEP) for q in c]).buffer(0)
             for c in find_contours(padded, 0.0) if len(c) >= 4]
    wp = Polygon()
    for p in sorted(polys, key=lambda p: -p.area):
        wp = wp.symmetric_difference(p)
    wp = wp.intersection(box(X0, Z0, X1, Z1)).buffer(0)
    return unary_union([p for p in bd.polygons_of(wp) if p.area > 400])


# ----------------------------------------------------------------------------- corridor
def street_lines(raw):
    d = json.loads((raw / 'streets-ctn.json').read_text())
    out = {}
    for f in d['features']:
        n = f['attributes'].get('FULL_STREET_NAME') or ''
        for path in f['geometry']['paths']:
            p = [tuple(map(float, xy(*q))) for q in path]
            out.setdefault(n, []).append(LineString(p))
    return {k: linemerge(MultiLineString(v)) if len(v) > 1 else v[0] for k, v in out.items()}


def extend(line: LineString, d=400.0) -> LineString:
    c = list(line.coords)
    (ax, az), (bx, bz) = c[0], c[1]
    (cx, cz), (ex, ez) = c[-2], c[-1]
    la, le = math.hypot(bx - ax, bz - az), math.hypot(ex - cx, ez - cz)
    return LineString([(ax - (bx - ax) / la * d, az - (bz - az) / la * d)] + c + [(ex + (ex - cx) / le * d, ez + (ez - cz) / le * d)])


def pick(geom, x0, z0, x1, z1):
    """Part of a (multi)line inside a box, merged to one line (CTN centrelines come in segments)."""
    g = geom.intersection(box(x0, z0, x1, z1))
    g = linemerge(g) if g.geom_type == 'MultiLineString' else g
    if g.geom_type != 'LineString':
        raise SystemExit(f'street pick is not one line: {g.geom_type}')
    return g


def corridor(raw, imp, water):
    """Faces of the arrangement of authored edge lines (City centrelines offset to the curb/edge), selected by seeds."""
    S = street_lines(raw)
    # Edge lines: centrelines offset to the curb/edge facing the park (CTN PAVEMENT_WIDTH / 2 + sidewalk), see park_side.
    lamar = pick(S['N LAMAR BLVD'].union(S['S LAMAR BLVD']), -1930, 2140, -1800, 2392)        # north -> south
    riv = pick(S['W RIVERSIDE DR'], -1918, 2385, -1700, 2500)   # Lamar -> railroad (runs ESE)
    rail = [f for f in imp['features'] if f['attributes']['OBJECTID'] == 349792][0]
    rp = bd.poly_from_esri(rail['geometry']['rings'])[0]
    rr = LineString([(-1750.5, 2498.0), (-1786.0, 2568.0), (-1828.0, 2655.0), (-1890.0, 2774.0), (-1908.0, 2807.0)])
    if max(rp.distance(Point(q)) for q in rr.coords) > 3 or rp.area / rr.length > 8:
        raise SystemExit('railroad axis does not follow the City ballast polygon')
    bs = pick(S['BARTON SPRINGS RD'], -1990, 2800, -1240, 3080)  # west -> east
    s1 = pick(S['S 1ST ST'], -1180, 2480, -1000, 2930)          # north -> south
    def park_side(line, off, probe, ext=400.0):
        """Offset to the side of `line` facing the park probe point (signs of offset_curve depend on direction)."""
        a, b = extend(line.offset_curve(off), ext), extend(line.offset_curve(-off), ext)
        return a if Point(probe).distance(a) < Point(probe).distance(b) else b
    lamar_e = park_side(lamar, 13.0, (-1880, 2300))
    riv_s = park_side(riv, 9.0, (-1830, 2470), 120)
    rail_e = park_side(rr, 5.0, (-1790, 2650))
    bs_n = park_side(bs, 10.5, (-1600, 2880))
    s1_w = park_side(s1, 13.5, (-1110, 2720))
    frame = box(X0 + 1, Z0 + 1, X1 - 1, Z1 - 1).exterior
    lines = unary_union([lamar_e, riv_s, rail_e, bs_n, s1_w, frame]).intersection(box(X0, Z0, X1, Z1))
    faces = list(polygonize(lines))
    seeds = [(-1850, 2400), (-1500, 2480), (-1600, 2700), (-1300, 2950), (-1150, 2800), (-1500, 2330)]
    chosen = unary_union([f for f in faces if any(f.contains(Point(s)) for s in seeds)])
    land = chosen.difference(water)
    land = max(bd.polygons_of(land.intersection(box(X0, 2330, X1, Z1))), key=lambda p: p.area)
    # Main river only (downtown's rule): creek-mouth inlets narrower than ~2 x INLET_OPEN stay downtown's (own barriers).
    main = water.buffer(-bd.INLET_OPEN).buffer(bd.INLET_OPEN + 0.5).intersection(water)
    reach = chosen.intersection(main)
    reach = max(bd.polygons_of(reach), key=lambda p: p.area).buffer(0.01).buffer(-0.01)
    edges = {'lamarEast': lamar_e, 'riversideSouth': riv_s, 'railroadEast': rail_e, 'bartonSpringsNorth': bs_n, 's1stWest': s1_w}
    return land, reach, edges


# ----------------------------------------------------------------------------- ponds (LiDAR voids)
POND_SEEDS = {'liz-carpenter': (-1690.0, 2600.0), 'palmer-oval': (-1425.0, 2748.0)}


def ponds_from_lidar(lid, xs, zs, H):
    x, z, e, c = lid['x'], lid['z'], lid['elevation_navd88_m'], lid['classification']
    out = []
    for name, (sx, sz) in POND_SEEDS.items():
        R, W = 1.0, 160
        m = (np.abs(x - sx) < W / 2) & (np.abs(z - sz) < W / 2)
        cnt = np.zeros((W, W), int)
        np.add.at(cnt, (((z[m] - sz + W / 2) / R).astype(int).clip(0, W - 1), ((x[m] - sx + W / 2) / R).astype(int).clip(0, W - 1)), 1)
        void = ndimage.binary_opening(cnt == 0, iterations=1)
        void = ndimage.binary_closing(void, iterations=3)
        lab, n = ndimage.label(void)
        k = lab[W // 2, W // 2]
        if k == 0:
            raise SystemExit(f'pond {name}: seed not in a LiDAR void')
        mask = ndimage.binary_fill_holes(lab == k)
        cs = find_contours(np.pad(mask.astype(float), 1), .5)
        ring = max(cs, key=len)
        poly = Polygon([(sx - W / 2 + (q[1] - 1 + .5) * R, sz - W / 2 + (q[0] - 1 + .5) * R) for q in ring]).buffer(0)
        poly = poly.buffer(1.0).buffer(-1.0)
        poly = max(bd.polygons_of(poly.buffer(-3.0).buffer(3.0)), key=lambda q: q.area).simplify(.5)  # drop thin inflow channels
        # Water level: LiDAR ground returns on the bank ring 0.5..3 m outside the void.
        ringzone = poly.buffer(3.0).difference(poly.buffer(.5))
        g = (c == 2) & m
        pts = [(xx, zz, ee) for xx, zz, ee in zip(x[g], z[g], e[g]) if ringzone.contains(Point(xx, zz))]
        bank = np.array([p[2] for p in pts])
        if len(bank) < 30:
            raise SystemExit(f'pond {name}: too few bank returns ({len(bank)})')
        surface = float(np.percentile(bank, 5)) - 0.25 + bd.NAVD_TO_CAMPUS
        # Never above the rendered 4 m bank along the outline (the water would float over the bank edge).
        edge = np.array(poly.exterior.coords)
        surface = min(surface, float(grid_height(xs, zs, H, edge[:, 0], edge[:, 1]).min()) - 0.08)
        out.append({'name': name, 'poly': poly, 'surfaceY': round(surface, 2), 'bankP5': round(float(np.percentile(bank, 5)) + bd.NAVD_TO_CAMPUS, 2),
                    'bankP50': round(float(np.median(bank)) + bd.NAVD_TO_CAMPUS, 2), 'bankReturns': len(bank), 'areaM2': round(poly.area)})
    return out


# ----------------------------------------------------------------------------- landmarks (measured)
def measure_long_center(lid, footprint: Polygon, ground_at):
    """Ring beam circle fit (centre/radius/top band), City Terrace level (mode of returns inside the ring on the open
    north-east side) and the hall volumes: LiDAR roof returns inside the City footprint, ring annulus removed, split by
    height above the terrace and reduced to oriented boxes (reference: a rectangular hall + stage house behind a glazed
    lobby; the City roof outline's oval ribbon is the ring/canopy, not an office volume)."""
    from scipy import optimize
    x, z, e, c = lid['x'], lid['z'], lid['elevation_navd88_m'] + bd.NAVD_TO_CAMPUS, lid['classification']
    cx, cz = -1325.0, 2858.0
    r = np.hypot(x - cx, z - cz)
    m = (r > 28) & (r < 52) & (e > -25) & (e < -13) & np.isin(c, [1, 6])
    px, pz = x[m], z[m]
    f = lambda p: np.hypot(px - p[0], pz - p[1]) - p[2]
    sol = optimize.least_squares(f, [cx, cz, 40], loss='soft_l1', f_scale=1.0)
    rcx, rcz, rr = (float(v) for v in sol.x)
    rad = np.hypot(x - rcx, z - rcz)
    ang = np.degrees(np.arctan2(z - rcz, x - rcx))
    band = (np.abs(rad - rr) < 1.5) & (e > -17) & (e < -13)
    top = float(np.percentile(e[band], 90))
    # Terrace: the dominant level inside the ring on the open side (north-west .. east).
    tq = (rad > 6) & (rad < rr - 6) & (ang > -120) & (ang < 10) & (c != 7)
    hist, edges_ = np.histogram(e[tq], bins=np.arange(-32, -10, .2))
    terrace = float(edges_[np.argmax(hist)] + .1)
    # Hall volumes.
    roof = np.isin(c, [1, 6]) & shapely.contains_xy(footprint.buffer(2), x, z) & (np.abs(rad - rr) > 3.0)
    RES = 2.0
    x0, z0, x1, z1 = footprint.bounds
    W, H = int((x1 - x0) / RES) + 2, int((z1 - z0) / RES) + 2
    top_r = np.full((H, W), -99.0)
    np.maximum.at(top_r, (((z[roof] - z0) / RES).astype(int).clip(0, H - 1), ((x[roof] - x0) / RES).astype(int).clip(0, W - 1)), e[roof])
    top_r = ndimage.grey_closing(top_r, size=3)
    vols = []
    for name, lo, hi in (('stage', terrace + 25.0, 99), ('hall', terrace + 19.0, 99), ('lobby', terrace + 12.0, 99), ('base', terrace + 5.0, 99)):
        mask = ndimage.binary_opening((top_r >= lo) & (top_r < hi), iterations=2)
        lab, n = ndimage.label(mask)
        if not n:
            continue
        sizes = ndimage.sum(mask, lab, range(1, n + 1))
        k = int(np.argmax(sizes)) + 1
        if sizes[k - 1] * RES * RES < 120:
            continue
        jj, ii = np.nonzero(lab == k)
        pts = shapely.MultiPoint(list(zip(x0 + (ii + .5) * RES, z0 + (jj + .5) * RES)))
        rect = pts.convex_hull.minimum_rotated_rectangle
        if name in ('lobby', 'base'):
            rect = rect.intersection(Point(rcx, rcz).buffer(rr - 2.0))  # inside the ring: the ring is modelled separately
        ys = top_r[jj, ii]
        vols.append({'name': name, 'r': [[round(a, 2), round(b, 2)] for a, b in list(rect.exterior.coords)[:-1]],
                     'top': round(float(np.percentile(ys, 75)), 2), 'areaM2': round(rect.area)})
    g = (c == 2) & (rad < 80)
    return {'ring': {'c': [round(rcx, 2), round(rcz, 2)], 'r': round(rr, 2), 'top': round(top, 2), 'fitPoints': int(m.sum()),
                     'medianResidual': round(float(np.median(np.abs(f(sol.x)))), 2)},
            'ground': round(float(np.median(e[g])), 2), 'terrace': round(terrace, 2), 'volumes': vols}


def measure_palmer(lid, footprint: Polygon):
    """Corners (extreme points of the City footprint along the diagonals), the inward sag of each concave edge, eave
    heights (LiDAR roof returns near the footprint edge), the central plateau and the raised rim around it."""
    x, z, e, c = lid['x'], lid['z'], lid['elevation_navd88_m'] + bd.NAVD_TO_CAMPUS, lid['classification']
    pts = np.array(footprint.exterior.coords)[:-1]
    C = np.array(footprint.centroid.coords[0])
    dirs = {'N': (0, -1), 'E': (1, 0), 'S': (0, 1), 'W': (-1, 0)}
    corners = {k: pts[np.argmax(pts @ np.array(v))] for k, v in dirs.items()}
    order = ['N', 'E', 'S', 'W']
    roof = np.isin(c, [1, 6])
    def p90(q, w=2.5):
        m = (np.hypot(x - q[0], z - q[1]) < w) & roof
        return float(np.percentile(e[m], 90)) if m.sum() > 2 else None
    sags, eaves = [], []
    for k in range(4):
        a, b = corners[order[k]], corners[order[(k + 1) % 4]]
        mid = (a + b) / 2
        inward = C - mid; inward /= np.linalg.norm(inward)
        hit = LineString([mid - inward * 30, mid + inward * 60]).intersection(footprint.exterior)
        hp = [np.array(g.coords[0]) for g in getattr(hit, 'geoms', [hit]) if not g.is_empty]
        sag = float(min(np.dot(q - mid, inward) for q in hp)) if hp else 0.0
        sags.append(round(sag, 2))
        ev = [p90(a + (b - a) * t + inward * (sag * 4 * t * (1 - t) + 3)) for t in (.15, .3, .5, .7, .85)]
        eaves.append([round(v, 2) if v is not None else None for v in ev])
    g = (c == 2) & (np.hypot(x - C[0], z - C[1]) < 130)
    # Rim and plateau: profile from the centre toward each corner.
    rim, plateau = [], []
    for k in order:
        prof = [(t, p90(C + (corners[k] - C) * t, 3)) for t in np.arange(.0, .8, .05)]
        prof = [(t, v) for t, v in prof if v is not None]
        tmax, vmax = max(prof, key=lambda q: q[1])
        rim.append([round(float(tmax), 2), round(vmax, 2)])
        plateau += [v for t, v in prof if t < .25]
    return {'centre': [round(float(C[0]), 2), round(float(C[1]), 2)], 'corners': [[round(float(v), 2) for v in corners[k]] for k in order],
            'sags': sags, 'eaves': eaves, 'rim': rim, 'plateau': round(float(np.median(plateau)), 2),
            'ground': round(float(np.median(e[g])), 2)}


def measure_garage(lid, footprint: Polygon, city_top: float):
    """Palmer/Long Center parking garage (City 1329594): the City footprint carries one MAX_HEIGHT (its peak); the 2017
    LiDAR bulk roof is the dominant return level and three small cores rise above it (stairs/elevators)."""
    x, z, e, c = lid['x'], lid['z'], lid['elevation_navd88_m'] + bd.NAVD_TO_CAMPUS, lid['classification']
    k = shapely.contains_xy(footprint, x, z) & np.isin(c, [1, 6])
    ee = e[k]
    hist, edges_ = np.histogram(ee, bins=np.arange(-30, -5, .5))
    m0 = edges_[np.argmax(hist)]
    roof = float(np.median(ee[(ee >= m0 - .1) & (ee < m0 + .6)]))
    g = (c == 2) & shapely.contains_xy(footprint.buffer(15), x, z) & ~shapely.contains_xy(footprint, x, z)
    ground = float(np.median(e[g]))
    RES = 2.0
    x0, z0, x1, z1 = footprint.bounds
    W, H = int((x1 - x0) / RES) + 1, int((z1 - z0) / RES) + 1
    top = np.full((H, W), -99.0)
    np.maximum.at(top, (((z[k] - z0) / RES).astype(int), ((x[k] - x0) / RES).astype(int)), ee)
    lab, n = ndimage.label(ndimage.binary_opening(top > roof + 2.0, iterations=1))
    cores = []
    for i in range(1, n + 1):
        jj, ii = np.nonzero(lab == i)
        if len(jj) * RES * RES < 40:
            continue
        rect = shapely.MultiPoint(list(zip(x0 + (ii + .5) * RES, z0 + (jj + .5) * RES))).convex_hull.minimum_rotated_rectangle
        rc = np.array(rect.exterior.coords)
        sides = sorted([float(np.hypot(*(rc[1] - rc[0]))), float(np.hypot(*(rc[2] - rc[1])))])
        if sides[0] < 5 or sides[1] / sides[0] > 2.5:
            continue   # thin strips along the edge (parapet/canopy lines), not stair/elevator cores
        cores.append({'r': [[round(a, 2), round(b, 2)] for a, b in list(rect.exterior.coords)[:-1]], 'top': round(float(np.percentile(top[jj, ii], 75)), 2)})
    levels = max(2, round((roof - ground) / 3.1))
    return {'r': bd.rings_of(footprint)[0], 'ground': round(ground, 2), 'roof': round(roof, 2), 'levels': levels, 'cores': cores,
            'lidarReturns': int(k.sum()), 'roofModeReturns': int(hist.max()), 'cityMaxHeightTop': round(city_top, 2)}


def measure_gazebo(footprint: Polygon, ground_at):
    c = footprint.centroid
    r = float(np.sqrt(footprint.area / (2 * math.sqrt(2))))  # regular octagon circumradius from area
    xs, zs = zip(*list(footprint.exterior.coords))
    return {'c': [round(c.x, 2), round(c.y, 2)], 'r': round(r, 2), 'ground': round(float(min(ground_at(np.array(xs), np.array(zs)))), 2)}


# ----------------------------------------------------------------------------- class raster
class Raster:
    def __init__(self, x0, z0, w, h, fill):
        self.x0, self.z0 = x0, z0
        self.a = np.full((h, w), fill, np.uint8)

    def mask(self, poly):
        x0, z0, x1, z1 = poly.bounds
        h, w = self.a.shape
        c0, r0 = max(0, int(x0 - self.x0) - 1), max(0, int(z0 - self.z0) - 1)
        c1, r1 = min(w, int(x1 - self.x0) + 2), min(h, int(z1 - self.z0) + 2)
        if c1 <= c0 or r1 <= r0:
            return None
        im = Image.new('1', (c1 - c0, r1 - r0), 0)
        d = ImageDraw.Draw(im)
        sh = lambda cs: [(u - self.x0 - c0, v - self.z0 - r0) for u, v in cs]
        d.polygon(sh(poly.exterior.coords), fill=1)
        for hh in poly.interiors:
            d.polygon(sh(hh.coords), fill=0)
        return (slice(r0, r1), slice(c0, c1)), np.array(im, bool)

    def paint(self, geom, cls, where=None):
        for p in bd.polygons_of(geom):
            m = self.mask(p)
            if m:
                sl, mk = m
                if where is not None:
                    mk = mk & where[sl]
                self.a[sl][mk] = cls


def seg_list(geom, digits=2):
    out = []
    for g in lines_of(geom):
        cs = list(g.coords)
        for (ax, az), (bx, bz) in zip(cs, cs[1:]):
            if math.hypot(bx - ax, bz - az) > 0.05:
                out.append([round(ax, digits), round(az, digits), round(bx, digits), round(bz, digits)])
    return out


def lines_of(geom):
    if geom.is_empty:
        return []
    if geom.geom_type == 'LineString':
        return [geom]
    if geom.geom_type == 'LinearRing':
        return [LineString(geom.coords)]
    return [l for g in geom.geoms for l in lines_of(g)]


def boundary_lines(poly):
    return [LineString(r.coords) for p in bd.polygons_of(poly) for r in [p.exterior, *p.interiors]]


# ----------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--raw', required=True, type=Path)
    ap.add_argument('--bg', required=True, type=Path)
    ap.add_argument('--lidar', required=True, type=Path)
    ap.add_argument('--preview', type=Path)
    a = ap.parse_args()
    dt = load_downtown()
    dmeta = dt['meta']
    if abs(dmeta['water']['y'] - WATER_Y) > 1e-6 or abs(dmeta['barrierTop'] - BARRIER_TOP) > 1e-6:
        raise SystemExit('downtown water datum differs')
    prov = json.loads((a.bg / 'provenance.json').read_text())
    tiles = [bd.read_tiff(a.bg / t['file']) for t in prov['dem']['tiles']]
    dem = bd.Dem(tiles)
    xs, zs, H, seam = build_grid(dt, dem)
    nx, nz = len(xs), len(zs)
    water = water_polygon(xs, zs, H)
    imp = json.loads((a.bg / 'impervious-cover-2023.json').read_text())
    land, reach, edges = corridor(a.raw, imp, water)
    lid = dict(np.load(a.lidar))
    sel = (lid['x'] > X0 - 10) & (lid['x'] < X1 + 10) & (lid['z'] > Z0 - 10) & (lid['z'] < Z1 + 10)
    lid = {k: v[sel] for k, v in lid.items()}
    ponds = ponds_from_lidar(lid, xs, zs, H)
    for p in ponds:
        if not land.buffer(-5).contains(p['poly']):
            raise SystemExit(f'pond {p["name"]} is not inside the park land')
    # City 2023 'Dock' polygons on or within 5 m of a pond outline; deck height = median LiDAR ground/unclassified
    # return inside the polygon (>= 15 returns), else 0.45 m above the pond surface.
    docks = []
    for f in imp['features']:
        if f['attributes']['FEATURE'] == 'Dock':
            for q in bd.poly_from_esri(f['geometry']['rings']):
                for p in ponds:
                    if q.distance(p['poly']) <= 5.0:
                        k = shapely.contains_xy(q, lid['x'], lid['z']) & np.isin(lid['classification'], [1, 2])
                        y = float(np.median(lid['elevation_navd88_m'][k])) + bd.NAVD_TO_CAMPUS if k.sum() >= 15 else p['surfaceY'] + 0.45
                        if not (p['surfaceY'] + 0.2 < y < p['surfaceY'] + 3.0):
                            raise SystemExit(f'dock {f["attributes"]["OBJECTID"]}: deck height {y:.2f} implausible for the pond')
                        docks.append({'oid': f['attributes']['OBJECTID'], 'pond': p['name'], 'poly': q, 'y': round(y, 2), 'lidarReturns': int(k.sum())})

    # ---------------------------------------------------------------- regions
    dplay = Polygon(dmeta['playable'][0], dmeta['playable'][1:])
    pf = json.loads(PFLUGER_JSON.read_text())
    deck_fp = unary_union([Polygon(r).buffer(0) for r in pf['source']]).buffer(0.3)
    overlap = dplay.intersection(reach.buffer(OVERLAP)).buffer(0)
    r_open = unary_union([land, reach, overlap]).buffer(0.01).buffer(-0.01)
    r_open = max(bd.polygons_of(r_open), key=lambda p: p.area)
    region = unary_union([r_open, deck_fp]).buffer(0.01).buffer(-0.01)
    region = max(bd.polygons_of(region), key=lambda p: p.area).simplify(0.25)
    region = Polygon(region.exterior.coords)  # no holes: interior pond/building holes are handled by water/footprints

    # Deck underside along the bridge (for walls passing under it).
    deck_pts = np.array([q for path in pf['paths'].values() for q in path])
    def under_deck_top(line):
        pts = [line.interpolate(t, normalized=True) for t in np.linspace(0, 1, 9)]
        ys = []
        for p in pts:
            d2 = (deck_pts[:, 0] - p.x) ** 2 + (deck_pts[:, 2] - p.y) ** 2
            near = deck_pts[d2 < 64]
            ys.append(near[:, 1].min() if len(near) else deck_pts[np.argmin(d2), 1])
        return round(float(min(ys)) - DECK_CLEAR, 2)

    walls, edge_list, barriers = [], [], []
    tol = 0.05
    dplay_in = dplay.buffer(-tol)
    # Region boundary pieces: open (inside downtown playable), rail (deck edges), wall (full) / under-deck wall.
    rb = region.exterior
    rcs = list(rb.coords)
    for (ax, az), (bx, bz) in zip(rcs, rcs[1:]):
        s = LineString([(ax, az), (bx, bz)])
        if s.length < 0.05:
            continue
        mid = s.interpolate(.5, normalized=True)
        if dplay.buffer(tol).contains(s) or dplay_in.contains(mid):
            kind = 1                                          # open (shared with downtown)
        elif r_open.buffer(-tol).contains(mid) is False and deck_fp.buffer(tol).contains(mid) and not r_open.exterior.buffer(tol).contains(mid):
            kind = 2                                          # deck edge: the modelled railings bound it
        else:
            kind = 0
        edge_list.append([round(ax, 2), round(az, 2), round(bx, 2), round(bz, 2), kind])
    # Physical walls: r_open boundary pieces that are region walls; pieces inside the deck footprint stop under the deck.
    open_b = r_open.exterior
    for s in seg_list(open_b):
        ls = LineString([s[:2], s[2:]])
        mid = ls.interpolate(.5, normalized=True)
        if dplay_in.contains(mid) or dplay.buffer(tol).contains(ls):
            continue                                          # interior to the union (downtown side)
        for piece, under in ((ls.difference(deck_fp), False), (ls.intersection(deck_fp), True)):
            for l in lines_of(piece):
                for q in seg_list(l):
                    walls.append(q + ([-200.0, under_deck_top(LineString([q[:2], q[2:]])), 1] if under else [-150.0, 150.0, 0]))
    # Downtown replacement walls: original walls minus r_open; deck crossings become under-deck walls.
    dt_walls_new = []
    for w in dmeta['walls']:
        ls = LineString([w[:2], w[2:]])
        rest = ls.difference(r_open.buffer(-tol))
        for l in lines_of(rest):
            for piece, under in ((l.difference(deck_fp), False), (l.intersection(deck_fp), True)):
                for q in (seg_list(x) for x in lines_of(piece)):
                    for s in q:
                        if under:
                            dt_walls_new.append(s + [-200.0, under_deck_top(LineString([s[:2], s[2:]])), 1])
                        else:
                            dt_walls_new.append(s + [-150.0, 150.0, 0])
    # Shoreline barriers: reach boundary pieces strictly inside r_open (south bank + opened north bank).
    shore = reach.boundary.difference(r_open.exterior.buffer(0.3))
    for l in lines_of(shore):
        for q in seg_list(l.simplify(0.3)):
            barriers.append(q + [round(WATER_Y - 2, 2), BARRIER_TOP])
    # Pond barriers (docks keep their landward edge open: the dock deck is walkable over the water).
    dock_u = unary_union([d['poly'] for d in docks]) if docks else Polygon()
    pond_out = []
    for p in ponds:
        water_p = p['poly'].buffer(2.0).difference(dock_u.buffer(0.05)).buffer(0)
        edge = p['poly'].boundary.difference(dock_u.buffer(0.2))
        for l in lines_of(edge):
            for q in seg_list(l.simplify(0.2)):
                barriers.append(q + [round(p['surfaceY'] - 2, 2), round(p['surfaceY'] + POND_BARRIER, 2)])
        # Dock outer edges (over the water) get a low rail barrier.
        for d in docks:
            if d['pond'] != p['name']:
                continue
            for l in lines_of(d['poly'].boundary.intersection(p['poly'].buffer(-0.3))):
                for q in seg_list(l):
                    barriers.append(q + [round(p['surfaceY'] - 2, 2), round(d['y'] + 1.0, 2)])
        pond_out.append({**p, 'water': water_p})

    # Pfluger south approaches: the LiDAR deck (class 13) runs ~8 m past both City-polygon tips and lands at street
    # level (Lamar / Riverside sidewalks). A sloped approach slab continues each arm until the terrain meets it.
    approaches = []
    for arm in ('A', 'B'):
        path = np.array(pf['paths'][arm])
        pa, b = path[-6], path[-1]
        d = np.array([b[0] - pa[0], b[2] - pa[2]]); d /= np.linalg.norm(d)
        n = np.array([-d[1], d[0]])
        probe = LineString([(b[0] - d[0] * 1.5 + n[0] * 8, b[2] - d[1] * 1.5 + n[1] * 8), (b[0] - d[0] * 1.5 - n[0] * 8, b[2] - d[1] * 1.5 - n[1] * 8)])
        half = round(probe.intersection(deck_fp.buffer(-0.3)).length / 2, 2)
        end_t = None
        for t in np.arange(2.0, 30.0, 0.5):
            if float(grid_height(xs, zs, H, b[0] + d[0] * t, b[2] + d[1] * t)) >= b[1] - 0.6:
                end_t = float(t) + 1.0
                break
        if end_t is None or not (1.0 < half < 4.0):
            raise SystemExit(f'Pfluger arm {arm}: no terrain meets the deck (half {half})')
        ex, ez = b[0] + d[0] * end_t, b[2] + d[1] * end_t
        ey = float(grid_height(xs, zs, H, ex, ez)) + 0.03
        approaches.append({'arm': arm, 'from': [round(b[0] - d[0] * .5, 2), round(float(b[1]), 3), round(b[2] - d[1] * .5, 2)],
                           'to': [round(ex, 2), round(ey, 3), round(ez, 2)], 'half': half,
                           'grade': round(abs(b[1] - ey) / end_t, 3)})
        if approaches[-1]['grade'] > 0.18:
            raise SystemExit(f'Pfluger approach {arm} too steep')
        if not land.contains(Point(ex, ez)):
            raise SystemExit(f'Pfluger approach {arm} ends outside the land')

    # ---------------------------------------------------------------- landmark measurements (LiDAR + City footprints)
    replace_ids = {1329477: 'long-center', 27978: 'palmer', 657084: 'gazebo', 1329594: 'garage'}
    gh = lambda px, pz: grid_height(xs, zs, H, px, pz)
    dtb = {b['id']: Polygon(b['tiers'][0]['r'][0]) for b in dmeta['buildings'] if b['src'] == 'coa2023' and b['id'] in replace_ids}
    lc = measure_long_center(lid, dtb[1329477], gh)
    palmer = measure_palmer(lid, dtb[27978])
    gazebo = measure_gazebo(dtb[657084], gh)
    dt_garage = next(b for b in dmeta['buildings'] if b['src'] == 'coa2023' and b['id'] == 1329594)
    garage = measure_garage(lid, dtb[1329594], dt_garage['tiers'][0]['y'])
    hg = (lid['classification'] == 2) & (np.hypot(lid['x'] + 1617, lid['z'] - 2610) < 40)
    k = int(np.argmax(lid['elevation_navd88_m'][hg]))
    hill = {'summitLidar': [round(float(lid['x'][hg][k]), 2), round(float(lid['elevation_navd88_m'][hg][k]) + bd.NAVD_TO_CAMPUS, 2), round(float(lid['z'][hg][k]), 2)]}

    # ---------------------------------------------------------------- cells
    i_dt0, j_dt0 = seam['dtOffset']
    flags = np.zeros((nz - 1, nx - 1), np.uint8)
    own_zone = land.buffer(OWN_MARGIN)
    cx = (xs[:-1] + xs[1:]) / 2
    cz = (zs[:-1] + zs[1:]) / 2
    CX, CZ = np.meshgrid(cx, cz)
    inside = shapely.contains_xy(own_zone, CX, CZ)
    dtf = dt['flags']
    owned_dt = []
    for j in range(nz - 1):
        for i in range(nx - 1):
            if not inside[j, i]:
                continue
            if xs[i] >= DT_X0 - 1e-9:
                gi, gj = i_dt0 + i, j_dt0 + j
                f = dtf[gj, gi]
                if f & 2:
                    continue                                  # already downtown-collidable (north bank overlap)
                if f & 1:
                    owned_dt.append(gj * (dmeta['grid']['nx'] - 1) + gi)
                # else: downtown never drew this cell (under a former building footprint): ours alone, nothing to own
            flags[j, i] = 3
    # Ponds: lower interior vertices under the water surface (only vertices whose every cell is owned).
    pond_edit = []  # terrain-edit vertex indices (ponds, terrace)
    vert_owned = np.zeros((nz, nx), bool)
    own = flags == 3
    vert_owned[:-1, :-1] |= own; vert_owned[1:, :-1] |= own; vert_owned[:-1, 1:] |= own; vert_owned[1:, 1:] |= own
    vert_shared = np.zeros((nz, nx), bool)  # touches a non-owned downtown-rendered cell
    for j in range(nz - 1):
        for i in range(nx - 1):
            if flags[j, i] != 3 and xs[i] >= DT_X0 - 1e-9 and (dtf[j_dt0 + j, i_dt0 + i] & 1):
                vert_shared[j:j + 2, i:i + 2] = True
    VX, VZ = np.meshgrid(xs, zs)
    # Terrain edits: owned vertices lowered under modelled water and floors so neither the 4 m DEM nor its triangles
    # poke through them: the whole pond outline (water drawn 2 m beyond it, hidden by the bank) and the Long Center
    # City Terrace slab (the bare-earth DEM there is the terrace itself, within centimetres of its top).
    edits = []
    for p in ponds:
        edits.append((p['poly'].buffer(1.5), p['surfaceY'] - 0.7))   # the 4 m triangles along the edge too
    hall = next(v for v in lc['volumes'] if v['name'] == 'hall')
    hc = np.mean(np.array(hall['r']), axis=0)
    rc = np.array(lc['ring']['c']); dvec = (hc - rc) / np.linalg.norm(hc - rc)
    terrace_r = lc['ring']['r'] + 1.8
    half = Polygon([tuple(rc - dvec * 6 + np.array([-dvec[1], dvec[0]]) * 200), tuple(rc - dvec * 6 - np.array([-dvec[1], dvec[0]]) * 200),
                    tuple(rc - dvec * 300 - np.array([-dvec[1], dvec[0]]) * 200), tuple(rc - dvec * 300 + np.array([-dvec[1], dvec[0]]) * 200)])
    terrace_poly = Point(*rc).buffer(terrace_r, 128).intersection(half).buffer(1.0)   # under the retaining edge too
    edits.append((terrace_poly, lc['terrace'] - 0.4))
    for poly, bed in edits:
        sel_v = shapely.contains_xy(poly, VX, VZ) & (H > bed)
        if (sel_v & vert_shared).any():
            raise SystemExit('terrain edit touches a downtown-shared vertex')
        for j, i in zip(*np.nonzero(sel_v)):
            pond_edit.append(int(j * nx + i))
            H[j, i] = np.float32(bed)
    # Every vertex shared with a still-downtown cell stays float-identical (checked again at runtime).
    jj, ii = np.nonzero(vert_shared)
    for j, i in zip(jj, ii):
        if H[j, i] != dt['H'][j_dt0 + j, i_dt0 + i]:
            raise SystemExit('shared vertex differs from downtown')

    # ---------------------------------------------------------------- class map
    W, Hh = int(round((X1 - X0) / CLASS_RES)), int(round((Z1 - Z0) / CLASS_RES))
    R = Raster(X0, Z0, W, Hh, C_GRASS)
    # East of x=-1760: downtown's classes verbatim.
    dcol0 = int(round((DT_X0 - X0) / CLASS_RES))
    R.a[:, dcol0:] = dt['cls'][int(Z0 - DT_Z0):int(Z0 - DT_Z0) + Hh, 0:W - dcol0]
    west = np.zeros_like(R.a, bool); west[:, :dcol0] = True
    parks = json.loads((a.bg / 'parks.json').read_text())
    for f in parks['features']:
        for p in bd.poly_from_esri(f['geometry']['rings']):
            R.paint(p, C_PARK, west)
    by = {}
    for f in imp['features']:
        cls = bd.IMPERVIOUS_CLASS.get(f['attributes']['FEATURE'])
        if cls is not None:
            by.setdefault(cls, []).extend(bd.poly_from_esri(f['geometry']['rings']))
    for cls in bd.PAINT_ORDER:
        for p in by.get(cls, []):
            if p.bounds[0] < DT_X0 and p.intersects(box(X0, Z0, DT_X0, Z1)):
                R.paint(p, cls, west)
    # West buildings (City 2023 footprints) — rendered + collidable when inside the land, else left to the backdrop.
    bfp = json.loads((a.bg / 'building-footprints-2023.json').read_text())
    west_buildings = []
    for f in bfp['features']:
        at = f['attributes']
        for p in bd.poly_from_esri(f['geometry']['rings']):
            if p.centroid.x >= DT_X0 or not land.contains(p.centroid) or p.area < 6:
                continue
            hft = at.get('MAX_HEIGHT')
            if not hft:
                continue
            g = grid_height(xs, zs, H, [q[0] for q in p.exterior.coords], [q[1] for q in p.exterior.coords])
            west_buildings.append({'k': f'rf-coa-{at["OBJECTID"]}', 'bg': f'coa:{at["OBJECTID"]}', 'id': at['OBJECTID'], 'r': bd.rings_of(p), 'g': [round(float(g.min()), 2), round(float(g.max()), 2)],
                                   'y': round(float(g.min()) + hft * bd.US_FOOT, 2), 'poly': p})
            R.paint(p, C_FOOTPRINT, west)
    water_west = water.intersection(box(X0, Z0, DT_X0, Z1))
    R.paint(water_west, C_WATER, west)
    for p in pond_out:
        R.paint(p['poly'].difference(dock_u.buffer(0.05)), C_WATER)   # measured outline (the water mesh reaches 2 m further)
    for d in docks:
        R.paint(d['poly'], C_PLAZA)
    classmap = R.a

    bgraw = gzip.decompress((OUT / 'downtown-background-v1.bin.gz').read_bytes())
    bml = struct.unpack('<IIII', bgraw[:16])[2]
    bgmeta = json.loads(bgraw[16:16 + bml])
    bg_suppress = sorted(b['k'] for b in bgmeta['buildings'] if land.buffer(2).contains(Polygon(b['r'][0]).representative_point()))
    # ---------------------------------------------------------------- downtown buildings in the land
    dt_collide, dt_replace = [], []
    for b in dmeta['buildings']:
        p = Polygon(b['tiers'][0]['r'][0])
        if not land.contains(p.representative_point()):
            continue
        if b['src'] == 'coa2023' and b['id'] in replace_ids:
            dt_replace.append({'k': b['k'], 'id': b['id'], 'as': replace_ids[b['id']]})
        elif b['visual']:
            dt_collide.append(b['k'])
    if sorted(r['as'] for r in dt_replace) != ['garage', 'gazebo', 'long-center', 'palmer']:
        raise SystemExit(f'expected the Long Center, Palmer, gazebo and garage downtown records, got {dt_replace}')
    # Downtown bridge-soup triangles over the land (UP rail bridge south approach, Riverside culverts): collide here.
    bsoup = dt['bridges']
    bridge_tris = [t for t in range(len(bsoup)) if land.buffer(-1).contains(Point(float(bsoup[t, 0::3].mean()), float(bsoup[t, 2::3].mean())))]

    # ---------------------------------------------------------------- trees west of x=-1760 (LiDAR canopy, as downtown)
    x, z, e, c = lid['x'], lid['z'], lid['elevation_navd88_m'], lid['classification']
    RES = 2.0
    wx0, wx1 = X0, DT_X0
    m = (x >= wx0) & (x < wx1) & (z >= Z0) & (z < Z1 - RES) & np.isin(c, [3, 4, 5])
    Wv, Hv = int((wx1 - wx0) / RES), int((Z1 - Z0) / RES)
    veg = np.full((Hv, Wv), np.nan)
    gi = ((x[m] - wx0) / RES).astype(int); gj = ((z[m] - Z0) / RES).astype(int)
    np.fmax.at(veg, (gj, gi), e[m] + bd.NAVD_TO_CAMPUS)
    Xc = wx0 + (np.arange(Wv) + .5) * RES; Zc = Z0 + (np.arange(Hv) + .5) * RES
    XX, ZZ = np.meshgrid(Xc, Zc)
    vr = np.nan_to_num(veg - grid_height(xs, zs, H, XX, ZZ), nan=0.0)
    sm = ndimage.gaussian_filter(vr, 1.0)
    peaks = (sm == ndimage.maximum_filter(sm, size=5)) & (vr > 4.0) & (vr < 30)
    trees = []
    wb_union = unary_union([b['poly'] for b in west_buildings]) if west_buildings else Polygon()
    for j, i in zip(*np.nonzero(peaks)):
        px, pz = float(Xc[i]), float(Zc[j])
        if not land.contains(Point(px, pz)) or water.contains(Point(px, pz)) or wb_union.distance(Point(px, pz)) < 1.2:
            continue
        cl = classmap[int(pz - Z0), int(px - X0)]
        if cl in (C_ASPHALT, C_WATER, C_FOOTPRINT):
            continue
        h = float(vr[j, i])
        win = vr[max(0, j - 4):j + 5, max(0, i - 4):i + 5]
        cr = max(1.5, min(9.0, math.sqrt((win > .6 * h).sum() * RES * RES / math.pi)))
        trees.append([round(px, 2), round(float(grid_height(xs, zs, H, px, pz)), 3), round(pz, 2), round(h, 2), round(cr, 2), 1.0])

    # ---------------------------------------------------------------- landmarks, places
    places = [
        {'key': 'auditorium-shores', 'name': 'Auditorium Shores', 'p': [-1560.0, 2500.0]},
        {'key': 'butler-park', 'name': 'Butler Park', 'p': [-1600.0, 2715.0]},
        {'key': 'vic-mathias-shores', 'name': 'Vic Mathias Shores (east lawn)', 'p': [-1235.0, 2640.0]},
        {'key': 'off-leash', 'name': 'Auditorium Shores off-leash area', 'p': [-1560.0, 2480.0]},
        {'key': 'pfluger-south', 'name': 'Pfluger Bridge south landing', 'p': [-1852.0, 2392.0]},
        {'key': 'doug-sahm-hill', 'name': 'Doug Sahm Hill', 'p': [-1617.0, 2610.0]},
        {'key': 'liz-carpenter-pond', 'name': 'Liz Carpenter Pond', 'p': [round(ponds[0]['poly'].centroid.x, 1), round(ponds[0]['poly'].centroid.y, 1)]},
        {'key': 'butler-fountain', 'name': 'Liz Carpenter Fountain (Butler Park)', 'p': [-1655.0, 2672.0]},
        {'key': 'willie-wells-field', 'name': 'Willie Wells Field', 'p': [-1650.0, 2760.0]},
        {'key': 'childrens-garden', 'name': "Alliance Children's Garden", 'p': [-1740.0, 2790.0]},
        {'key': 'long-center', 'name': 'Long Center for the Performing Arts', 'p': [lc['ring']['c'][0], lc['ring']['c'][1]]},
        {'key': 'palmer', 'name': 'Palmer Events Center', 'p': [-1513.0, 2820.0]},
        {'key': 'butler-trail', 'name': 'Butler Hike-and-Bike Trail', 'p': [-1400.0, 2560.0]},
    ]
    for pl in places:
        if not land.contains(Point(pl['p'])):
            raise SystemExit(f'place {pl["key"]} outside the land')

    # ---------------------------------------------------------------- review shots (lib/campus/extension/riverfront/shots.json)
    def g_at(x, z):
        return round(float(grid_height(xs, zs, H, x, z)), 3)
    pa = pf['paths']['A'][len(pf['paths']['A']) // 2]
    def street(sid, label, x, z, target, fov, note, eye=1.75):
        g = g_at(x, z)
        return {'id': sid, 'label': label, 'kind': 'street', 'position': [x, round(g + eye, 2), z], 'target': target, 'fov': fov,
                'groundY': g, 'groundSource': 'riverfront-v1 terrain grid', 'focus': None, 'note': note}
    def aerial(sid, label, pos, target, fov, note):
        return {'id': sid, 'label': label, 'kind': 'aerial', 'position': pos, 'target': target, 'fov': fov,
                'groundY': g_at(pos[0], pos[2]), 'groundSource': 'riverfront-v1 terrain grid', 'focus': target, 'note': note}
    lcc = lc['ring']['c']
    shots = [
        aerial('rf-auditorium-aerial-ne', 'Auditorium Shores from over the lake (north-east), Long Center and Palmer behind', [-1180.0, 30.0, 2440.0], [-1480.0, -26.0, 2720.0], 60,
               'After the AIA Austin / Atelier Wong 2020 aerial: shore lawns, trail and the two landmarks beyond Riverside.'),
        street('rf-auditorium-from-north-bank', 'Auditorium Shores across the water from the downtown trail', -1420.0, 2318.0, [-1460.0, -26.0, 2560.0], 55,
               'North-bank Butler Trail (downtown) looking south over the lake to the park.'),
        aerial('rf-butler-hill-pond', 'Butler Park: Doug Sahm Hill and Liz Carpenter Pond with its docks', [-1790.0, 25.0, 2520.0], [-1655.0, -28.0, 2620.0], 55,
               'From the west over Lee Barton / the railroad: pond, docks and the spiral hill.'),
        street('rf-hill-summit-skyline', 'Doug Sahm Hill summit looking at the downtown skyline', hill['summitLidar'][0], hill['summitLidar'][2], [-1350.0, 40.0, 2150.0], 55,
               'Summit at the highest 2017 LiDAR ground return.'),
        street('rf-long-center-lawn', 'Long Center ring beam and City Terrace from the park lawn (architect hero direction)', round(lcc[0] + 52, 1), round(lcc[1] - 52, 1), [lcc[0], lc['ring']['top'] - 4, lcc[1]], 60,
               'Low view from the north-east lawn toward the terrace, ring and glazed hall front.'),
        street('rf-palmer-ne', 'Palmer Events Center canopy from the north path', -1470.0, 2698.0, [-1510.0, -16.0, 2830.0], 60,
               'Concave tented canopy, deep eave sweep and colonnade.'),
        street('rf-trail-pfluger-arrival', 'Butler Trail at the Pfluger bridge south landing', -1800.0, 2412.0, [-1862.0, -25.0, 2368.0], 60,
               'Trail by the south arms and approach slabs (bridge arrival).'),
        street('rf-pfluger-deck-south', 'Pfluger bridge main span looking south to the park', round(pa[0], 1), round(pa[2], 1), [-1700.0, -26.0, 2520.0], 60,
               'On the walkable deck (eye above the deck, not the lake bed).', eye=1.75 + (pa[1] - g_at(pa[0], pa[2]))),
        street('rf-gazebo-east-shore', 'Fannie Davis Town Lake Gazebo by the east shore', -1124.0, 2648.0, [gazebo['c'][0], gazebo['ground'] + 4.0, gazebo['c'][1]], 55,
               'Octagonal folded canopy with oculus on limestone columns.'),
        street('rf-trail-vic-mathias', 'Butler Trail along Vic Mathias Shores looking west', -1205.0, 2588.0, [-1450.0, -30.0, 2480.0], 60,
               'East lawn (Vic Mathias Shores) and the shoreline trail.'),
    ]
    (ROOT / 'lib' / 'campus' / 'extension' / 'riverfront' / 'shots.json').write_text(json.dumps(shots, indent=1) + '\n')

    # ---------------------------------------------------------------- write
    owned_dt = np.array(sorted(owned_dt), '<u4')
    ponds_meta = [{'name': p['name'], 'surfaceY': p['surfaceY'], 'bankP5': p['bankP5'], 'bankP50': p['bankP50'], 'bankReturns': p['bankReturns'],
                   'areaM2': p['areaM2'], 'ring': bd.rings_of(p['poly'])[0], 'water': [bd.rings_of(q) for q in bd.polygons_of(p['water'])]} for p in pond_out]
    sections, blobs, off = [], [], 0
    def add(name, arr, typ):
        nonlocal off
        b = arr.tobytes()
        pad = (-len(b)) % 4
        sections.append({'name': name, 'type': typ, 'byteOffset': off, 'count': int(arr.size)})
        blobs.append(b + b'\0' * pad)
        off += len(b) + pad
    add('heights', H.astype('<f4').ravel(), 'f32')
    add('cellFlags', flags.ravel(), 'u8')
    add('classMap', classmap.ravel(), 'u8')
    add('ownedDowntownCells', owned_dt, 'u32')
    add('terrainEdits', np.array(sorted(set(pond_edit)), '<u4'), 'u32')
    add('trees', np.array(trees, '<f4').reshape(-1), 'f32')
    meta = {
        'format': 'ut-riverfront', 'version': VERSION,
        'rect': {'xmin': X0, 'xmax': X1, 'zmin': Z0, 'zmax': Z1}, 'step': STEP, 'grid': {'nx': nx, 'nz': nz},
        'downtown': {'checksum': dt['checksum'], 'gzSha256': dt['gzSha'], 'walls': len(dmeta['walls']), 'wallsSum': walls_sum(dmeta['walls']),
                     'gridOffset': [i_dt0, j_dt0], 'gridNx': dmeta['grid']['nx']},
        'seam': {'x': DT_X0, **{k: v for k, v in seam.items() if k != 'dtOffset'}},
        'water': {'y': WATER_Y, 'barrierTop': BARRIER_TOP},
        'classMap': {'w': W, 'h': Hh, 'res': CLASS_RES},
        'land': bd.rings_of(land.simplify(0.25)), 'region': [[q[:2] for q in edge_list]], 'edges': edge_list,
        'walls': walls, 'downtownWalls': dt_walls_new, 'barriers': barriers,
        'ponds': ponds_meta, 'docks': [{'oid': d['oid'], 'pond': d['pond'], 'y': d['y'], 'lidarReturns': d['lidarReturns'], 'r': bd.rings_of(d['poly'])} for d in docks],
        'buildings': [{k: v for k, v in b.items() if k != 'poly'} for b in west_buildings],
        'downtownReplace': dt_replace, 'downtownCollide': sorted(dt_collide), 'downtownBridgeTriangles': bridge_tris,
        'landmarks': {'longCenter': lc, 'palmer': palmer, 'gazebo': gazebo, 'garage': garage, 'hill': hill},
        'backgroundSuppress': bg_suppress,
        'places': places,
        'pfluger': {'open': pf['open'], 'approaches': approaches},
        'counts': {'ownedDowntownCells': int(len(owned_dt)), 'westCells': int((flags[:, :int(round((DT_X0 - X0) / STEP))] == 3).sum()),
                   'cells': int((flags == 3).sum()), 'walls': len(walls), 'downtownWalls': len(dt_walls_new), 'barriers': len(barriers),
                   'edges': len(edge_list), 'terrainEdits': len(set(pond_edit)), 'trees': len(trees), 'buildings': len(west_buildings)},
        'claims': ('Riverfront extension: south-bank terrain = the downtown 4 m USGS 3DEP grid (float-identical) plus the 3DEP '
                   'DEM west of x=-1760; shoreline = DEM water contour (130.53 m NAVD88 + 0.3 m); ponds = 2017 LiDAR water '
                   'voids with the water level 0.25 m under the 5th-percentile bank return; paths and surfaces = City of Austin '
                   '2023 impervious cover; corridor edges = City CTN centrelines offset to the curb. Long Center ring beam '
                   'fitted to LiDAR (centre, radius, top); Long Center and Palmer forms are reference-guided approximations, '
                   'not 1:1. Not a survey.'),
        'sections': sections,
    }
    # The edge list doubles as the region ring (first point of every edge, in order).
    mj = json.dumps(meta, separators=(',', ':')).encode()
    mj += b' ' * ((-len(mj)) % 4)
    body = mj + b''.join(blobs)
    head = struct.pack('<IIII', MAGIC, VERSION, len(mj), fnv_words(body))
    raw = head + body
    gz = gzip.compress(raw, 9, mtime=0)
    (OUT / 'riverfront-v1.bin.gz').write_bytes(gz)
    manifest = {'asset': 'riverfront-v1.bin.gz', 'sha256': sha(gz), 'bytes': len(gz), 'rawBytes': len(raw), 'counts': meta['counts'],
                'downtown': meta['downtown'], 'seam': meta['seam'], 'ponds': [{k: v for k, v in p.items() if k not in ('ring', 'water')} for p in ponds_meta],
                'landmarks': meta['landmarks'], 'landAreaM2': round(land.area), 'reachAreaM2': round(reach.area), 'regionAreaM2': round(region.area),
                'inputs': {'downtownGz': dt['gzSha'], 'backgroundProvenance': sha((a.bg / 'provenance.json').read_bytes()),
                           'streets': sha((a.raw / 'streets-ctn.json').read_bytes()), 'lidarNpz': sha(a.lidar.read_bytes()),
                           'pfluger': sha(PFLUGER_JSON.read_bytes()), 'demTiles': [t['sha256'] for t in prov['dem']['tiles']],
                           'impervious': prov['files']['impervious-cover-2023.json']['sha256'], 'footprints': prov['files']['building-footprints-2023.json']['sha256'],
                           'parks': prov['files']['parks.json']['sha256']},
                'edges': {k: [list(map(lambda v: round(v, 1), q)) for q in v.coords] for k, v in edges.items()},
                'claims': meta['claims']}
    (OUT / 'riverfront-v1.manifest.json').write_text(json.dumps(manifest, indent=1) + '\n')
    print(json.dumps({'bytes': len(gz), **meta['counts'], 'land': round(land.area), 'reach': round(reach.area), 'seam': meta['seam'],
                      'ponds': [(p['name'], p['surfaceY'], p['areaM2'], p['bankReturns']) for p in ponds_meta], 'lc': lc, 'palmer': palmer,
                      'dtReplace': dt_replace, 'dtCollide': len(dt_collide), 'bridgeTris': len(bridge_tris)}, indent=1))
    if a.preview:
        preview(a.preview, xs, zs, H, classmap, land, reach, region, walls, dt_walls_new, barriers, edge_list, ponds, docks, trees, places, flags, pf)


def preview(out: Path, xs, zs, H, classmap, land, reach, region, walls, dtw, barriers, edges, ponds, docks, trees, places, flags, pf):
    out.mkdir(parents=True, exist_ok=True)
    S = 1.5
    pal = np.array([[39, 53, 43], [92, 97, 94], [143, 141, 127], [150, 140, 120], [130, 118, 92], [54, 92, 128], [52, 82, 52], [193, 188, 166], [96, 99, 96]], np.uint8)
    im = Image.fromarray(pal[classmap]).resize((int(classmap.shape[1] * S), int(classmap.shape[0] * S)), Image.NEAREST)
    d = ImageDraw.Draw(im, 'RGBA')
    P = lambda x, z: ((x - X0) * S, (z - Z0) * S)
    for j in range(flags.shape[0]):
        for i in range(flags.shape[1]):
            if flags[j, i] == 3 and (i + j) % 2 == 0:
                d.point(P(xs[i] + 2, zs[j] + 2), fill=(255, 255, 255, 90))
    d.line([P(*q) for q in region.exterior.coords], fill=(0, 255, 255), width=1)
    for e in edges:
        col = [(255, 0, 0), (0, 255, 0), (255, 255, 0)][e[4]]
        d.line([P(e[0], e[1]), P(e[2], e[3])], fill=col, width=3 if e[4] == 0 else 2)
    for w in walls:
        d.line([P(w[0], w[1]), P(w[2], w[3])], fill=(255, 60, 60) if w[6] == 0 else (255, 160, 0), width=2)
    for w in dtw:
        d.line([P(w[0], w[1]), P(w[2], w[3])], fill=(200, 0, 120) if w[6] == 0 else (255, 160, 0), width=2)
    for b in barriers:
        d.line([P(b[0], b[1]), P(b[2], b[3])], fill=(255, 0, 255), width=1)
    for r in pf['source']:
        d.line([P(*q) for q in r] + [P(*r[0])], fill=(255, 255, 255), width=1)
    for t in trees:
        x, z = P(t[0], t[2]); d.ellipse([x - 2, z - 2, x + 2, z + 2], fill=(0, 255, 0))
    for pl in places:
        x, z = P(*pl['p']); d.ellipse([x - 4, z - 4, x + 4, z + 4], fill=(255, 255, 255)); d.text((x + 6, z - 6), pl['name'], fill=(255, 255, 255))
    im.save(out / 'riverfront-plan.png')
    # Hillshade of the riverfront terrain (owned cells) for the hill / pond / seam review.
    gy, gx = np.gradient(H.astype(np.float64), STEP)
    shade = np.clip(0.6 + (-gx * .7 - gy * .7) / np.sqrt(1 + gx * gx + gy * gy) * .8, 0, 1)
    rgb = (np.stack([shade] * 3, -1) * 255).astype(np.uint8)
    hi = np.clip((H - WATER_Y) / 20, 0, 1)
    rgb[..., 0] = (rgb[..., 0] * (.6 + .4 * hi)).astype(np.uint8)
    Image.fromarray(rgb).resize((len(xs) * 3, len(zs) * 3), Image.NEAREST).save(out / 'riverfront-hillshade.png')


if __name__ == '__main__':
    main()
