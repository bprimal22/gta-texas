#!/usr/bin/env python3
"""Bake the measured West Campus ground paving for block b12 (lib/campus/blocks/b12-west-campus/paving.json). Authoring only.

Why: the base world draws West Campus ground as the offline terrain (lawn material) plus the mapped road / footway
finishes (public/assets/campus/local-surfaces-61.bin.gz) and generated road infill. Sidewalks, parking lots,
driveways, patios and plazas that the mapped finishes do not cover therefore render as lawn.

What: City of Austin Planimetrics 2023 Impervious Cover (MapServer/1) polygons of the pedestrian / parking kinds
(Sidewalk, Pavement, Courtyard, Patio, Paved Driveway, Paved Parking) plus the curb / gutter band of Paved Road that
the drawn roads leave as lawn (only within GUTTER m of a drawn road), clipped to the b12 rectangle (plus the Guadalupe west sidewalk strip between x = -448 and the
roadway centreline) and to the ground
that is still lawn in the game:
  minus every campus.json footprint in the window (b12 context.json excludes honoured), b12 massing volume rings,
  the West Campus extension tower rings (public/assets/extension/west-campus-v1.json),
  minus the local surface finishes (asphalt / concrete / speedway triangles, exact),
  minus mapped vehicle roads buffered by max(2.5, width) / 2 (the rendered road-infill width),
  minus the Co-op Guadalupe frontage that coop.ts already paves.
Slivers narrower than 0.3 m are opened away; rings are simplified (0.05 m) and quantised to 1 cm.
Medians, unpaved / gravel kinds, decks, pools, recreation courts and Miscellaneous stay lawn (not pedestrian paving).
The runtime (paving.ts) triangulates the rings, splits them on the offline terrain's regular 8 m lattice (this bake
asserts every terrain triangle in the window is a lattice half-cell split on the x + z diagonal) and drapes every
vertex on the baked terrain + coop.ts PAVE_LIFT. Visual only; the terrain stays the physical ground.

Inputs (read-only): .work/claude-west-campus/raw/impervious-cover-2023.json (x -1580..-380, z -520..580),
.work/claude-downtown/background-raw/impervious-cover-2023.json (z >= 554), public/data/campus.json,
public/assets/campus/local-surfaces-61.bin.gz, public/assets/campus/offline-terrain-61.bin.gz,
lib/campus/blocks/b12-west-campus/context.json, public/assets/extension/west-campus-v1.json.
Requires numpy + shapely>=2. Run:  python -I tools/extension/bake-b12-paving.py
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import struct
from pathlib import Path

import numpy as np
import shapely
from shapely.geometry import LineString, Polygon, box
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
SX, SZ, LON0, LAT0 = 96126.8152981172, 110851.0, -97.73716, 30.2861
WINDOW = (-760.0, -480.0, -448.0, 1100.0)  # b12 rect (lib/campus/blocks/ownership.json): xmin, zmin, xmax, zmax
DRAG_EAST = -380.0  # the window also takes the Guadalupe west sidewalk east of x = -448, up to the roadway centreline
GUADALUPE = 'Guadalupe Street'
LATTICE = 8.0
GUTTER = 3.0
VEHICLE = {'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link',
           'tertiary', 'tertiary_link', 'residential', 'unclassified', 'living_street', 'service'}
# Priority (earlier wins where City polygons overlap) and runtime kind names.
KINDS = [('Sidewalk', 'sidewalk'), ('Pavement', 'pavement'), ('Courtyard', 'courtyard'), ('Patio', 'patio'),
         ('Paved Driveway', 'driveway'), ('Paved Parking', 'parking'), ('Paved Road', 'gutter')]
COOP_KEY = '733792:1248'
COOP_ROADWAY = [655414277, 201680476, 1354456442]
DEFAULT_RAW = [ROOT / '.work/claude-west-campus/raw/impervious-cover-2023.json',
               ROOT / '.work/claude-downtown/background-raw/impervious-cover-2023.json']


def metric(ring):
    return [((lon - LON0) * SX, (LAT0 - lat) * SZ) for lon, lat, *_ in ring]


def signed_area(r):
    return sum(r[i][0] * r[(i + 1) % len(r)][1] - r[(i + 1) % len(r)][0] * r[i][1] for i in range(len(r))) / 2


def esri_geom(rings):
    ext, holes = [], []
    for r in rings:
        r = metric(r)
        r = r[:-1] if r[0] == r[-1] else r
        if len(r) >= 3:
            (ext if signed_area(r) > 0 else holes).append(r)
    polys = [[e, []] for e in sorted(ext, key=lambda e: abs(signed_area(e)))]
    for h in holes:
        hp = Polygon(h)
        t = next((q for q in polys if Polygon(q[0]).contains(hp.representative_point())), None)
        if t:
            t[1].append(h)
    out = [Polygon(e, hs) for e, hs in polys]
    return unary_union([p if p.is_valid else shapely.make_valid(p) for p in out]) if out else Polygon()


def polygons_of(g):
    if g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    out = []
    for x in getattr(g, 'geoms', []):
        out += polygons_of(x)
    return out


def tri_union(v, window):
    t = v.reshape(-1, 3, 3)[:, :, [0, 2]].astype(np.float64)
    b = window.bounds
    keep = (t[:, :, 0].max(1) >= b[0]) & (t[:, :, 0].min(1) <= b[2]) & (t[:, :, 1].max(1) >= b[1]) & (t[:, :, 1].min(1) <= b[3])
    p = shapely.polygons(t[keep])
    p = p[shapely.area(p) > 1e-8]
    return unary_union(list(p)).buffer(0)


def sha(path: Path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--raw', type=Path, nargs='*', default=DEFAULT_RAW)
    ap.add_argument('--out', type=Path, default=ROOT / 'lib/campus/blocks/b12-west-campus/paving.json')
    ap.add_argument('--triangles', type=Path, help='optional npz of the 2D paving polygons (analysis)')
    a = ap.parse_args()
    campus = json.loads((ROOT / 'public/data/campus.json').read_text())
    # b12 rectangle plus the strip between x = -448 and the Guadalupe centreline (its west sidewalk; coop.ts already
    # paves that strip at the Co-op). The east (campus) side of the Drag belongs to other blocks and is not touched.
    centre = sorted({(round(x, 3), round(z, 3)) for p in campus['paths'] if p.get('name') == GUADALUPE
                     for x, z in p['points'] if WINDOW[1] - 60 <= z <= WINDOW[3] + 60}, key=lambda q: q[1])
    if len(centre) < 10 or any(b[1] - a[1] > 200 for a, b in zip(centre, centre[1:])):
        raise SystemExit('Guadalupe centreline is not a continuous north-south line through the window')
    west_of = Polygon([(WINDOW[0], centre[0][1]), *centre, (WINDOW[0], centre[-1][1])]).buffer(0)
    W = unary_union([box(*WINDOW), west_of.intersection(box(WINDOW[0], WINDOW[1], DRAG_EAST, WINDOW[3]))])
    inputs = {p.name if i == 0 else f'downtown-background/{p.name}': p for i, p in enumerate(a.raw)}
    campus_path = ROOT / 'public/data/campus.json'
    ls_path = ROOT / 'public/assets/campus/local-surfaces-61.bin.gz'
    terrain_path = ROOT / 'public/assets/campus/offline-terrain-61.bin.gz'
    ctx_path = ROOT / 'lib/campus/blocks/b12-west-campus/context.json'
    wc_path = ROOT / 'public/assets/extension/west-campus-v1.json'

    # --- terrain lattice (the runtime splits on it) -----------------------------------------------------
    d = gzip.decompress(terrain_path.read_bytes())
    count = struct.unpack_from('<I', d, 8)[0]
    tp = np.frombuffer(d, '<f4', count * 3, 20).reshape(-1, 3, 3).astype(np.float64)
    bx0, bz0, bx1, bz1 = W.bounds
    tx, tz = tp[:, :, 0], tp[:, :, 2]
    q = tp[(tx.max(1) > bx0) & (tx.min(1) < bx1) & (tz.max(1) > bz0) & (tz.min(1) < bz1)][:, :, [0, 2]]
    cells, irregular = {}, set()
    for t in q:
        x0, z0 = np.floor(t[:, 0].min() / LATTICE) * LATTICE, np.floor(t[:, 1].min() / LATTICE) * LATTICE
        key = (int(x0), int(z0))
        on = np.all(np.abs(t / LATTICE - np.round(t / LATTICE)) < 1e-6)
        s_ = sorted((round(x - x0), round(z - z0)) for x, z in t) if on else None
        if s_ == [(0, 0), (0, 8), (8, 0)]:
            cells.setdefault(key, []).append('lo')
        elif s_ == [(0, 8), (8, 0), (8, 8)]:
            cells.setdefault(key, []).append('hi')
        else:
            for i in range(int(np.floor(t[:, 0].min() / LATTICE)), int(np.ceil(t[:, 0].max() / LATTICE))):
                for j in range(int(np.floor(t[:, 1].min() / LATTICE)), int(np.ceil(t[:, 1].max() / LATTICE))):
                    irregular.add((i * int(LATTICE), j * int(LATTICE)))
    regular = {k for k, v in cells.items() if sorted(v) == ['hi', 'lo'] and k not in irregular}

    # --- what the game already draws -------------------------------------------------------------------
    ctx = json.loads(ctx_path.read_text())
    excluded = set(ctx.get('exclude', {}))
    blds = []
    for i, b in enumerate(campus['buildings']):
        if f"{b['id']}:{i}" in excluded:
            continue
        try:
            p = Polygon(b['rings'][0], b['rings'][1:]).buffer(0)
        except Exception:
            continue
        if p.intersects(W):
            blds.append(p)
    for spec in ctx.get('massing', {}).values():
        for v in spec['volumes']:
            for r in ([v['ring']] if 'ring' in v else []) + ([v['rings'][0]] if 'rings' in v else []):
                blds.append(Polygon(r).buffer(0))
    wc = json.loads(wc_path.read_text())
    for t in wc['towers']:
        blds.append(Polygon(t['ring']).buffer(0))
    buildings = unary_union(blds)

    s = gzip.decompress(ls_path.read_bytes())
    counts = struct.unpack_from('<3I', s, 8)
    off, finish = 24, []
    for n in counts:
        v = np.frombuffer(s, '<f4', n * 5, off).reshape(-1, 5)[:, :3]
        off += n * 20
        if n:
            finish.append(tri_union(v.ravel(), W.buffer(40)))
    finish = unary_union(finish)
    roads = []
    for p in campus['paths']:
        if p['kind'] in VEHICLE and not p.get('area') and len(p['points']) > 1:
            ls = LineString(p['points'])
            if ls.intersects(W.buffer(40)):
                # Match road-infill.ts exactly: a wider exclusion leaves a false grass ribbon at the curb.
                roads.append(ls.buffer(max(2.5, p['width']) / 2, cap_style='flat', join_style='mitre', mitre_limit=3))
    road_bands = unary_union(roads)
    drawn_roads = unary_union([road_bands, finish])

    # Co-op frontage (coop.ts paveFrontage): ring -> Guadalupe curb (roadway centreline - 7.1 m), ring z-span.
    ci = next(i for i, b in enumerate(campus['buildings']) if f"{b['id']}:{i}" == COOP_KEY)
    coop = Polygon(campus['buildings'][ci]['rings'][0])
    pts = [pt for pid in COOP_ROADWAY for p in campus['paths'] if p['id'] == pid for pt in p['points']]
    cx0, cz0, cx1, cz1 = coop.bounds
    curb = max(x for x, z in pts if cz0 - 10 <= z <= cz1 + 10) - 7.1
    coop_zone = box(cx0, cz0, curb, cz1).difference(coop)

    blocked = unary_union([buildings, drawn_roads, coop_zone])

    # --- City impervious cover ------------------------------------------------------------------------
    feats, seen, kinds_seen = [], set(), {}
    for path in a.raw:
        for f in json.loads(path.read_text())['features']:
            at = f['attributes']
            if at['OBJECTID'] in seen:
                continue
            seen.add(at['OBJECTID'])
            kinds_seen[at['FEATURE']] = kinds_seen.get(at['FEATURE'], 0) + 1
            feats.append(f)
    rank = {k: i for i, (k, _) in enumerate(KINDS)}
    recs = []
    for f in feats:
        kind = f['attributes']['FEATURE']
        if kind not in rank:
            continue
        g = esri_geom(f['geometry']['rings'])
        if g.is_empty or not g.intersects(W):
            continue
        recs.append((rank[kind], f['attributes']['OBJECTID'], g.intersection(W)))
    recs.sort(key=lambda r: (r[0], r[1]))
    taken = blocked
    gutter_reach = drawn_roads.buffer(GUTTER)
    pieces, stats = [], {k: {'records': 0, 'cityM2InWindow': 0.0, 'pavedM2': 0.0} for k, _ in KINDS}
    by_kind = {}
    for r, oid, g in recs:
        kind = KINDS[r][0]
        stats[kind]['records'] += 1
        stats[kind]['cityM2InWindow'] += g.area
        if kind == 'Paved Road':
            g = g.intersection(gutter_reach)
        by_kind.setdefault(r, []).append(g)
    for r in sorted(by_kind):
        g = unary_union(by_kind[r]).difference(taken)
        # Open away slivers (< 0.3 m) without ever growing past the City polygon.
        g = g.buffer(-.15, join_style='mitre', mitre_limit=3).buffer(.15, join_style='mitre', mitre_limit=3).intersection(g)
        g = shapely.set_precision(g.simplify(.05, preserve_topology=True), .01)
        g = unary_union([p for p in polygons_of(g) if p.area >= .5])
        if g.is_empty:
            continue
        taken = unary_union([taken, g])
        for p in polygons_of(g):
            pieces.append((r, p))
        stats[KINDS[r][0]]['pavedM2'] += g.area

    # Every lattice cell a paving piece touches must be a plain two-triangle cell (the runtime drape relies on it).
    touched_bad = 0
    for _, p in pieces:
        x0, z0, x1, z1 = p.bounds
        for i in range(int(np.floor(x0 / LATTICE)), int(np.floor(x1 / LATTICE)) + 1):
            for j in range(int(np.floor(z0 / LATTICE)), int(np.floor(z1 / LATTICE)) + 1):
                k = (i * int(LATTICE), j * int(LATTICE))
                if k not in regular and p.intersection(box(k[0], k[1], k[0] + LATTICE, k[1] + LATTICE)).area > 1e-6:
                    touched_bad += 1
    if touched_bad:
        raise SystemExit(f'{touched_bad} paving piece / lattice cell pairs fall on non-lattice terrain')

    # --- encode ----------------------------------------------------------------------------------------
    def enc(coords):
        c = np.round(np.asarray(coords)[:-1] * 100).astype(np.int64)
        out = [int(c[0, 0]), int(c[0, 1])]
        for k in range(1, len(c)):
            out += [int(c[k, 0] - c[k - 1, 0]), int(c[k, 1] - c[k - 1, 1])]
        return out

    polys, verts, holes = [], 0, 0
    for r, p in sorted(pieces, key=lambda rp: (rp[0], rp[1].bounds[1], rp[1].bounds[0])):
        p = shapely.geometry.polygon.orient(p, 1.0)
        rings = [enc(p.exterior.coords)] + [enc(h.coords) for h in p.interiors]
        verts += sum(len(x) // 2 for x in rings)
        holes += len(p.interiors)
        polys.append([r] + rings)
    total = sum(v['pavedM2'] for v in stats.values())
    out = {
        'generatedBy': 'tools/extension/bake-b12-paving.py',
        'source': 'City of Austin Planimetrics 2023 - Impervious Cover 2023 (PlanimetricsSurvey_1/MapServer/1), City of Austin Watershed Protection Department',
        'basis': 'measured 2023 planimetric polygons, clipped to b12 ground the game still drew as lawn; visual-only drape',
        'window': {'b12Rect': list(WINDOW), 'plus': 'Guadalupe west sidewalk strip: x -448..-380 west of the mapped Guadalupe centreline'}, 'lattice': LATTICE, 'diagonal': 'x+z', 'quantum': .01,
        'kinds': [k for _, k in KINDS], 'cityKinds': [k for k, _ in KINDS],
        'gutterReachM': GUTTER,
        'areaM2': round(total, 1),
        'byKind': {KINDS[rank[k]][1]: {'records': v['records'], 'cityM2InWindow': round(v['cityM2InWindow'], 1), 'pavedM2': round(v['pavedM2'], 1)} for k, v in stats.items()},
        'counts': {'polygons': len(polys), 'vertices': verts, 'holes': holes},
        'inputs': {k: sha(v) for k, v in {**inputs, 'campus.json': campus_path, 'local-surfaces-61.bin.gz': ls_path,
                                           'offline-terrain-61.bin.gz': terrain_path, 'b12 context.json': ctx_path,
                                           'west-campus-v1.json': wc_path}.items()},
        'encoding': 'polygons: [kindIndex, ring, hole...]; ring = [x0, z0, dx1, dz1, ...] integer centimetres (first point absolute, then deltas), exterior CCW in (x, z), closing point dropped',
        'polygons': polys,
    }
    text = json.dumps(out, separators=(',', ':'))
    a.out.write_text(text + '\n')
    if a.triangles:
        tris = []
        for _, p in pieces:
            for tg in polygons_of(shapely.constrained_delaunay_triangles(p)):
                tris.append(np.array(tg.exterior.coords)[:3])
        np.savez_compressed(a.triangles, tri2d=np.array(tris))
    print(json.dumps({'out': str(a.out), 'bytes': len(text), 'areaM2': out['areaM2'], 'byKind': out['byKind'], 'counts': out['counts'],
                      'latticeCells': len(regular), 'irregularCells': len(irregular)}, indent=1))


if __name__ == '__main__':
    main()
