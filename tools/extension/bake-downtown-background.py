#!/usr/bin/env python3
"""Bake the VISUAL-ONLY measured backdrop around the playable world (never collidable, never a travel target):
the west notch between deep west and downtown (x -1760..-760, z 570..1536), the strips west of Lamar, east of the
campus/downtown edges and south of the downtown rectangle, inside the WGS84 box (-97.762, 30.2525, -97.7195, 30.2811).

Sources (fetched by tools/extension/fetch-downtown-background.py, kept outside the build):
  City of Austin Planimetrics 2023 Building Footprints / Impervious Cover, City of Austin Parks, USGS 3DEP 2 m DEM.
Writes public/assets/extension/downtown-background-v1.bin.gz (+ .manifest.json).

Low detail by design: 8 m terrain (lowered 1.2 m and reaching one cell under the playable worlds, so it never shows
through or z-fights with them), 2 m ground classes, one height per City footprint (MAX_HEIGHT), rule-based facades.
Run (venv with tools/lidar/requirements.txt):
  python -I tools/extension/bake-downtown-background.py --raw .work/claude-downtown/background-raw
"""
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
from shapely.geometry import Polygon, box
from shapely.ops import unary_union
from skimage.measure import find_contours

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('bake_downtown', HERE / 'bake-downtown.py')
bd = importlib.util.module_from_spec(spec); spec.loader.exec_module(bd)

MAGIC = 0x47425455  # 'UTBG'
VERSION = 1
STEP = 8.0
XMIN, XMAX, ZMIN, ZMAX = -2376.0, 1688.0, 560.0, 3712.0   # on the campus 8 m lattice (x -760 + 8k, z -864 + 8k)
CLASS_RES = 2.0
LOWER = 1.2        # backdrop sits this far below the measured surface (8 m grid vs 4 m neighbours)
TUCK = 3.5         # extra drop of vertices inside a playable world (under its edge)
CHUNK = 1024.0
# Playable / already-modelled worlds (game.ts bounds incl. the Capitol strip, deep west, downtown rectangle).
COVERED = [(-760.0, -864.0, 1296.0, 1536.0), (-1570.0, -510.0, -760.0, 570.0), (-1760.0, 1536.0, 520.0, 3520.0)]


def covered(x, z, inset=0.0):
    x, z = np.asarray(x), np.asarray(z)
    m = np.zeros(np.broadcast(x, z).shape, bool)
    for x0, z0, x1, z1 in COVERED:
        m |= (x > x0 + inset) & (x < x1 - inset) & (z > z0 + inset) & (z < z1 - inset)
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--raw', required=True, type=Path)
    a = ap.parse_args()
    prov = json.loads((a.raw / 'provenance.json').read_text())
    inputs = {}

    def load(name):
        b = (a.raw / name).read_bytes(); inputs[name] = hashlib.sha256(b).hexdigest(); return json.loads(b)

    t = prov['dem']['tiles'][0]
    grid, ext = bd.read_tiff(a.raw / t['file'])
    inputs[t['file']] = hashlib.sha256((a.raw / t['file']).read_bytes()).hexdigest()
    if inputs[t['file']] != t['sha256']:
        raise SystemExit('DEM does not match its provenance sha256')
    dem = bd.Dem([(grid, ext)])
    xs = XMIN + STEP * np.arange(int((XMAX - XMIN) / STEP) + 1)
    zs = ZMIN + STEP * np.arange(int((ZMAX - ZMIN) / STEP) + 1)
    X, Z = np.meshgrid(xs, zs)
    acc = np.zeros_like(X)
    for dx in (-STEP / 3, 0, STEP / 3):
        for dz in (-STEP / 3, 0, STEP / 3):
            acc += dem(X + dx, Z + dz)
    H = acc / 9 - LOWER
    # Tuck band: vertices inside a playable world (its first 8 m cell) dive TUCK m further so the backdrop slopes
    # under the neighbour's edge; campus contour terrain differs from the DEM by up to ~3 m there.
    H = np.where(covered(X, Z, inset=0.01), H - TUCK, H)
    # Campus west edge (x = -760, z <= 1536): the rendered campus is the baked contour terrain (offline-terrain-61) and
    # the Capitol strip patch, not the DEM. Backdrop vertices on and inside that edge stay 1.6 m below its exact
    # edge heights, so the backdrop meets the campus edge from below instead of poking through it.
    spec2 = importlib.util.spec_from_file_location('bake_deep_west', HERE / 'bake-deep-west.py')
    dw = importlib.util.module_from_spec(spec2); spec2.loader.exec_module(dw)
    seam, seam_zs, _, _ = dw.offline_seam(bd.ROOT / 'public/assets/campus/offline-terrain-61.bin.gz')
    strip = json.loads((bd.ROOT / 'lib/campus/blocks/b14-capitol/strip-ground.json').read_text())
    sh = (np.frombuffer(__import__('base64').b64decode(strip['heights']), '<i2').astype(np.float64) * strip['unit']).reshape(strip['nz'], strip['nx'])
    raw61 = gzip.decompress((bd.ROOT / 'public/assets/campus/offline-terrain-61.bin.gz').read_bytes())
    cnt = struct.unpack('<I', raw61[8:12])[0]
    pos61 = np.frombuffer(raw61, '<f4', cnt * 3, 20).reshape(-1, 3)
    cols = {}
    for cx in (-760.0, -752.0):
        sel = pos61[np.abs(pos61[:, 0] - cx) < 1e-3]
        zz, inv = np.unique(sel[:, 2], return_inverse=True)
        cols[cx] = (zz, np.array([sel[inv == k, 1].min() for k in range(len(zz))]))
    sz = strip['z0'] + strip['step'] * np.arange(strip['nz'])
    def campus_band_min(z):
        # Lowest campus surface across x in [-760, -752] at z (offline-61 below z 1288, the strip patch above).
        if z <= 1288:
            return min(float(np.interp(z, *cols[cx])) for cx in cols)
        return float(min(np.interp(z, sz, sh[:, k]) for k in range(3)))
    inputs['offline-terrain-61.bin.gz'] = hashlib.sha256((bd.ROOT / 'public/assets/campus/offline-terrain-61.bin.gz').read_bytes()).hexdigest()
    inputs['strip-ground.json'] = hashlib.sha256((bd.ROOT / 'lib/campus/blocks/b14-capitol/strip-ground.json').read_bytes()).hexdigest()
    for j, z in enumerate(zs):
        if z > 1536 or z < -864:
            continue
        for i, x in enumerate(xs):
            if -760 - 1e-6 <= x <= -760 + STEP + 1e-6:
                H[j, i] = min(H[j, i], campus_band_min(z) - 1.6)
    H = H.astype(np.float32)
    if np.isnan(H).any():
        raise SystemExit('DEM nodata inside the backdrop')
    # Cells rendered: not inside a covered world by more than one cell (8 m tuck under its edge).
    CX, CZ = np.meshgrid(xs[:-1] + STEP / 2, zs[:-1] + STEP / 2)
    render = ~covered(CX, CZ, inset=STEP)
    flags = render.astype(np.uint8)

    region = box(XMIN, ZMIN, XMAX, ZMAX)
    cov = unary_union([box(*c) for c in COVERED])
    fill = region.difference(cov)
    # Water: hydro-flattened lake outside the covered worlds.
    low = (acc / 9) < bd.SHORE_Y
    pad = np.pad(np.where(low, -1.0, 1.0), 1, constant_values=1.0)
    water = Polygon()
    for c in find_contours(pad, 0.0):
        pts = [(XMIN + (q[1] - 1) * STEP, ZMIN + (q[0] - 1) * STEP) for q in c]
        if len(pts) >= 4:
            water = water.symmetric_difference(Polygon(pts).buffer(0))
    water = unary_union([p for p in bd.polygons_of(water.buffer(0)) if p.area > 2000]).intersection(region.difference(box(*COVERED[2]))).buffer(0)
    water_tris = []
    for tri in bd.polygons_of(shapely.constrained_delaunay_triangles(water.simplify(1.0, preserve_topology=True))):
        water_tris.append([(x, bd.WATER_Y + .12, z) for x, z in list(tri.exterior.coords)[:3]])

    # Ground classes (2 m).
    W, Hh = int((XMAX - XMIN) / CLASS_RES), int((ZMAX - ZMIN) / CLASS_RES)
    cls = np.full((Hh, W), bd.C_GRASS, np.uint8)
    from PIL import Image, ImageDraw

    def paint(poly, c):
        for p in bd.polygons_of(poly.intersection(region)):
            x0, z0, x1, z1 = p.bounds
            c0, r0 = max(0, int((x0 - XMIN) / CLASS_RES) - 1), max(0, int((z0 - ZMIN) / CLASS_RES) - 1)
            c1, r1 = min(W, int((x1 - XMIN) / CLASS_RES) + 2), min(Hh, int((z1 - ZMIN) / CLASS_RES) + 2)
            if c1 <= c0 or r1 <= r0:
                continue
            im = Image.new('1', (c1 - c0, r1 - r0), 0); d = ImageDraw.Draw(im)
            px = lambda cs: [((x - XMIN) / CLASS_RES - c0, (z - ZMIN) / CLASS_RES - r0) for x, z in cs]
            d.polygon(px(p.exterior.coords), fill=1)
            for h in p.interiors:
                d.polygon(px(h.coords), fill=0)
            cls[r0:r1, c0:c1][np.array(im, bool)] = c
    for f in load('parks.json')['features']:
        for p in bd.poly_from_esri(f['geometry']['rings']):
            paint(p, bd.C_PARK)
    imp = load('impervious-cover-2023.json')
    by = {}
    for f in imp['features']:
        c = bd.IMPERVIOUS_CLASS.get(f['attributes'].get('FEATURE'))
        if c is not None:
            by.setdefault(c, []).extend(bd.poly_from_esri(f['geometry']['rings']))
    for c in bd.PAINT_ORDER:
        for p in by.get(c, []):
            if p.intersects(fill):
                paint(p, c)

    fp = load('building-footprints-2023.json')
    if (fp.get('sourceHeightModelInfo') or {}).get('heightUnit') != 'us-foot':
        raise SystemExit('Footprint heights are not declared in US survey feet')
    pal = json.loads((bd.LIB / 'landmarks.json').read_text())['palettes']
    buildings = []
    for f in sorted(fp['features'], key=lambda f: f['attributes']['OBJECTID']):
        at = f['attributes']
        if not at['MAX_HEIGHT'] or at['MAX_HEIGHT'] <= 0:
            continue
        for k, p in enumerate(bd.poly_from_esri(f['geometry']['rings'])):
            q = p.intersection(fill)
            for part in bd.polygons_of(q.simplify(0.6, preserve_topology=True)):
                if part.area < 25:
                    continue
                paint(part, bd.C_FOOTPRINT)
                cs = np.array(part.exterior.coords)
                g0 = float(np.min(dem(cs[:, 0], cs[:, 1]))) - LOWER
                hgt = at['MAX_HEIGHT'] * bd.US_FOOT
                h = bd_hash(f'{at["OBJECTID"]}:{k}')
                if hgt >= 45:
                    fac, opts = 'balcony', pal['residentialGlass']
                elif hgt >= 16:
                    fac, opts = ('punched', pal['midrise']) if h % 3 else ('ribbon', pal['midrise'])
                else:
                    fac, opts = 'historic', pal['historic']
                o = opts[h % len(opts)]
                c = part.centroid
                buildings.append({'k': f'coa:{at["OBJECTID"]}' + (f':{k}' if k else ''), 'r': bd.rings_of(part, 1), 'g': round(g0, 2),
                                  'y': round(g0 + hgt, 2), 'f': fac, 'w': o['w'], 'a': o['a'],
                                  'c': int(min(3, (c.y - ZMIN) // CHUNK) * 4 + min(3, (c.x - XMIN) // CHUNK))})
    paint(water, bd.C_WATER)
    meta = {'format': 'ut-downtown-background', 'version': VERSION, 'rect': {'xmin': XMIN, 'xmax': XMAX, 'zmin': ZMIN, 'zmax': ZMAX},
            'step': STEP, 'grid': {'nx': len(xs), 'nz': len(zs)}, 'chunk': CHUNK, 'covered': COVERED, 'lowered': LOWER,
            'classMap': {'w': W, 'h': Hh, 'res': CLASS_RES}, 'water': {'surfaceY': round(bd.WATER_Y + .12, 3)},
            'buildings': buildings, 'counts': {'buildings': len(buildings), 'renderCells': int(flags.sum()), 'waterTriangles': len(water_tris)},
            'claims': 'Visual-only backdrop: USGS 3DEP DEM (8 m, lowered 1.2 m), City of Austin 2023 footprints (one MAX_HEIGHT each), impervious cover and parks. Facades and colours are rule-based estimates. No collision, no travel.'}
    sections = [('heights', 'f32', H.ravel()), ('cellFlags', 'u8', flags.ravel()), ('classMap', 'u8', cls.ravel()),
                ('water', 'f32', np.array(water_tris, '<f4').ravel())]
    body, offs = b'', []
    for name, typ, arr in sections:
        raw = arr.astype('<f4' if typ == 'f32' else np.uint8).tobytes()
        offs.append({'name': name, 'type': typ, 'byteOffset': len(body), 'count': int(arr.size)})
        body += raw + b'\0' * ((-len(raw)) % 4)
    meta['sections'] = offs
    mj = json.dumps(meta, separators=(',', ':'), sort_keys=True).encode()
    mj += b' ' * ((-len(mj)) % 4)
    head = mj + body
    blob = struct.pack('<IIII', MAGIC, VERSION, len(mj), bd.fnv_words(head)) + head
    gz = gzip.compress(blob, 9, mtime=0)
    out = bd.OUT_ASSET / 'downtown-background-v1.bin.gz'
    out.write_bytes(gz)
    (bd.OUT_ASSET / 'downtown-background-v1.manifest.json').write_text(json.dumps({
        'asset': out.name, 'bytes': len(blob), 'gzipBytes': len(gz), 'sha256': hashlib.sha256(gz).hexdigest(), 'inputs': inputs,
        'cityQueries': {k: v['queries'] for k, v in prov['files'].items()}, 'dem': prov['dem'], 'counts': meta['counts'],
        'covered': COVERED, 'claims': meta['claims']}, indent=1))
    print('background buildings', len(buildings), 'cells', int(flags.sum()), 'water tris', len(water_tris), 'gzip', len(gz), 'meta', len(mj))


def bd_hash(s):
    h = 2166136261
    for b in s.encode():
        h = ((h ^ b) * 16777619) & 0xFFFFFFFF
    return h


if __name__ == '__main__':
    main()
