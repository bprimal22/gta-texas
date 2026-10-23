#!/usr/bin/env python3
"""Bake the West Campus additions asset (public/assets/extension/west-campus-v1.json). Authoring only.

Contents (all positions in campus metres, Y = NAVD88 m - 165):
  * Deep West canopy (x, z, height, crown radius, distance to the nearest footprint): 2017 USGS LiDAR (EPT depth-10 subset, class 5 high vegetation) canopy-height peaks inside the
    deep-west union (x < -762; the campus canopy owns x >= -760). Trunks are kept >= 1.2 m from every 2023 City footprint
    in the extension (and the new towers) and off mapped roads / alleys / sidewalks / pavement (nudged <= 2.5 m, else
    dropped). Crown radius = extent of canopy above 60 % of the peak (same method as the downtown bake), capped so the
    crown centre stays clear of walls. Positions are 2017; trees removed since then are not known.
  * Two post-2023 towers with their footprints, base and height evidence (towers.ts interprets the facades).

Fetch the inputs with tools/extension/fetch-west-campus.py (West Campus envelopes; the downtown fetchers' defaults do NOT
cover West Campus). Inputs: --lidar <npz from fetch-west-campus.py --lidar>, --city <City 2023 footprints JSON>, --osm <Overpass buildings JSON>,
public/assets/extension/deep-west-v1.bin.gz (buildings, surface polygons), public/data/campus.json.
Requires numpy, scipy, shapely (tools/extension/requirements.txt). Run:
  python -I tools/extension/bake-west-campus.py --lidar .work/claude-west-campus/ept-root/downtown-lidar-ept-depth10.npz \
     --city .work/claude-west-campus/raw/building-footprints-2023.json --osm .work/claude-west-campus/raw/osm-buildings.json
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import struct
from pathlib import Path

import numpy as np
import shapely
from scipy import ndimage
from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
SX, SZ, LON0, LAT0 = 96126.8152981172, 110851.0, -97.73716, 30.2861
US_FOOT = 1200 / 3937
NAVD_TO_CAMPUS = -165.0
RES = 1.0
TREE_X1 = -762.0           # campus canopy (canopy-trees.json) owns x >= -760
UNION_ID, UNION_OSM, VILLAS_OSM = 470235, 1208654798, 1341073412
UNION_OSM_HEIGHT = 97.536    # OSM way 1208654798 height tag (community-sourced, 320 ft)
PAVED = ('Paved Road', 'Paved Alley', 'Sidewalk', 'Pavement')


def P(lon, lat):
    return ((lon - LON0) * SX, (LAT0 - lat) * SZ)


def sha(path: Path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def ring_ccw(ring):
    """Exterior ring with positive shoelace area in (x, z) (the extension convention), closing point dropped."""
    r = [(round(x, 3), round(z, 3)) for x, z in ring]
    if r[0] == r[-1]:
        r = r[:-1]
    a = sum(r[i][0] * r[(i + 1) % len(r)][1] - r[(i + 1) % len(r)][0] * r[i][1] for i in range(len(r)))
    return r if a > 0 else r[::-1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--lidar', type=Path, required=True)
    ap.add_argument('--city', type=Path, required=True)
    ap.add_argument('--osm', type=Path, required=True)
    ap.add_argument('--out', type=Path, default=ROOT / 'public/assets/extension/west-campus-v1.json')
    a = ap.parse_args()

    raw = gzip.decompress((ROOT / 'public/assets/extension/deep-west-v1.bin.gz').read_bytes())
    meta = json.loads(raw[20:20 + struct.unpack_from('<I', raw, 8)[0]])
    U = meta['union']

    # ---------------------------------------------------------------- towers
    city = json.loads(a.city.read_text())
    if (city.get('sourceHeightModelInfo') or {}).get('heightUnit') != 'us-foot':
        raise SystemExit('City footprint heights are not declared in US survey feet')
    rec = next(f for f in city['features'] if f['attributes']['OBJECTID'] == UNION_ID)
    if len(rec['geometry']['rings']) != 1:
        raise SystemExit('Union on 24th: expected one ring')
    union_ring = ring_ccw([P(*p) for p in rec['geometry']['rings'][0]])
    at = rec['attributes']
    union_h = at['MAX_HEIGHT'] * US_FOOT
    union_base = at['BASE_ELEVATION'] * US_FOOT + NAVD_TO_CAMPUS
    osm = json.loads(a.osm.read_text())
    ways = {e['id']: e for e in osm['elements'] if e['type'] == 'way' and 'geometry' in e}
    for wid, name in ((UNION_OSM, 'Union on 24th'), (VILLAS_OSM, 'Villas on 24th')):
        if ways.get(wid, {}).get('tags', {}).get('name') != name:
            raise SystemExit(f'OSM way {wid} is not {name}')
    if abs(float(ways[UNION_OSM]['tags'].get('height', 0)) - UNION_OSM_HEIGHT) > 1e-3:
        raise SystemExit('OSM Union on 24th height tag changed; review UNION_OSM_HEIGHT')
    villas_ring = ring_ccw([P(g['lon'], g['lat']) for g in ways[VILLAS_OSM]['geometry']])
    union_poly, villas_poly = Polygon(union_ring), Polygon(villas_ring)
    if Polygon([P(g['lon'], g['lat']) for g in ways[UNION_OSM]['geometry']]).intersection(union_poly).area < .9 * union_poly.area:
        raise SystemExit('OSM Union on 24th outline does not cover City 470235')

    # Villas must not overlap any remaining (non-demolished) campus building: trim against campus.json rings.
    campus = json.loads((ROOT / 'public/data/campus.json').read_text())
    demolished = {'614399'}   # old Cain & Abel's (b12 context.json exclude: replaced by Villas on 24th)
    overlaps = []
    for b in campus['buildings']:
        if str(b['id']).split(':')[0] in demolished:
            continue
        p = Polygon(b['rings'][0]).buffer(0)
        if p.intersects(villas_poly):
            overlaps.append({'id': b['id'], 'area': round(p.intersection(villas_poly).area, 2)})
            villas_poly = villas_poly.difference(p.buffer(.15))
    if villas_poly.geom_type != 'Polygon':
        villas_poly = max(villas_poly.geoms, key=lambda g: g.area)
    villas_poly = shapely.simplify(villas_poly, .05)
    villas_ring = ring_ccw(list(villas_poly.exterior.coords))

    # ---------------------------------------------------------------- LiDAR rasters
    d = np.load(a.lidar)
    lx, lz, le, lc = d['x'].astype(float), d['z'].astype(float), d['elevation_navd88_m'].astype(float) + NAVD_TO_CAMPUS, d['classification']
    X0, X1, Z0, Z1 = U['xmin'], U['xmax'] + 40, U['zmin'], U['zmax']
    W, H = int((X1 - X0) / RES), int((Z1 - Z0) / RES)
    inside = (lx >= X0) & (lx < X1) & (lz >= Z0) & (lz < Z1)
    ci = ((lx - X0) / RES).astype(int).clip(0, W - 1)
    cj = ((lz - Z0) / RES).astype(int).clip(0, H - 1)
    gm = inside & (lc == 2)
    gsum = np.bincount(cj[gm] * W + ci[gm], le[gm], W * H)
    gcnt = np.bincount(cj[gm] * W + ci[gm], None, W * H)
    ground = np.where(gcnt > 0, gsum / np.maximum(gcnt, 1), np.nan).reshape(H, W)
    idx = ndimage.distance_transform_edt(np.isnan(ground), return_distances=False, return_indices=True)
    ground = ground[tuple(idx)]
    ground = ndimage.uniform_filter(ground, 3)
    vm = inside & (lc == 5)
    veg = np.full(W * H, -np.inf)
    np.maximum.at(veg, cj[vm] * W + ci[vm], le[vm] - ground[cj[vm], ci[vm]])
    veg = veg.reshape(H, W)
    veg[~np.isfinite(veg)] = 0
    veg[veg < 2] = 0

    def ground_at(x, z):
        return float(ground[min(H - 1, max(0, int((z - Z0) / RES))), min(W - 1, max(0, int((x - X0) / RES)))])

    villas_ground = [ground_at(x, z) for x, z in shapely.segmentize(Polygon(villas_ring).buffer(1.5).exterior, 2).coords]
    union_ground = [ground_at(x, z) for x, z in shapely.segmentize(Polygon(union_ring).buffer(1.5).exterior, 2).coords]

    # ---------------------------------------------------------------- trees
    blds = [Polygon(r[0]).buffer(0) for r in (b['rings'] for b in meta['buildings'])] + [Polygon(union_ring)]
    btree = shapely.STRtree(blds)
    paved = unary_union([Polygon(rr[0], rr[1:]).buffer(0) for k in PAVED for rr in meta['map']['surfaces'].get(k, [])])
    paved_p = shapely.prepared.prep(paved) if hasattr(shapely, 'prepared') else None
    sm = ndimage.gaussian_filter(veg, 1.5)
    peaks = (sm == ndimage.maximum_filter(sm, size=7)) & (veg > 4.0)
    pj, pi = np.nonzero(peaks)
    counts = {'peaks': int(len(pj)), 'outside': 0, 'tooTall': 0, 'building': 0, 'paved': 0, 'nudged': 0, 'spacing': 0, 'kept': 0}
    trees = []
    kept_pts = []

    def bdist(x, z):
        pt = Point(x, z)
        near = btree.query(pt.buffer(16))
        return min([blds[k].distance(pt) for k in near] or [99.0])

    def is_paved(x, z):
        return paved.contains(Point(x, z)) if paved_p is None else paved_p.contains(Point(x, z))

    order = np.argsort(-veg[pj, pi])
    for k in order:
        j, i = pj[k], pi[k]
        x, z = X0 + (i + .5) * RES, Z0 + (j + .5) * RES
        if not (U['xmin'] + 4 <= x <= TREE_X1 and U['zmin'] + 4 <= z <= U['zmax'] - 4):
            counts['outside'] += 1
            continue
        h = float(veg[j, i])
        if h > 30:
            counts['tooTall'] += 1
            continue
        win = veg[max(0, j - 5):j + 6, max(0, i - 5):i + 6]
        rad = max(1.8, min(9.0, math.sqrt((win > .6 * h).sum() * RES * RES / math.pi)))
        pos = None
        for r in (0, 1.25, 2.5):
            for s in range(1 if r == 0 else 8):
                ang = s * math.pi / 4
                tx, tz = x + r * math.cos(ang), z + r * math.sin(ang)
                if not (U['xmin'] + 2 <= tx <= TREE_X1 and U['zmin'] + 2 <= tz <= U['zmax'] - 2):
                    continue
                if bdist(tx, tz) < 1.2 or is_paved(tx, tz):
                    continue
                pos = (tx, tz, r)
                break
            if pos:
                break
        if not pos:
            if bdist(x, z) < 1.2:
                counts['building'] += 1
            else:
                counts['paved'] += 1
            continue
        tx, tz, moved = pos
        if any(math.hypot(tx - px, tz - pz) < max(3.2, .6 * rad) for px, pz in kept_pts):
            counts['spacing'] += 1
            continue
        if moved:
            counts['nudged'] += 1
        kept_pts.append((tx, tz))
        trees.append([round(tx, 2), round(tz, 2), round(h, 2), round(rad, 2), round(min(15.0, bdist(tx, tz)), 2)])
    trees.sort()
    counts['kept'] = len(trees)
    print('trees', counts)

    def r3(ring):
        return [[round(x, 3), round(z, 3)] for x, z in ring]

    doc = {
        'format': 'ut-west-campus', 'version': 1,
        'claims': 'Deep West tree positions/heights/crowns from 2017 USGS LiDAR canopy peaks (2017 trees, not a tree survey); '
                  'Union on 24th = City of Austin 2023 footprint + OSM community-sourced overall height 97.5 m (City 2023 89.8 m kept as an older bound); Villas on 24th = OpenStreetMap outline (ODbL) + '
                  'published 30 storeys / 312 ft; tower facades, podium/tower split and crown layout are photo-interpreted estimates.',
        'trees': {'fields': ['x', 'z', 'height', 'crownRadius', 'buildingClearance'], 'ownedX': [U['xmin'], TREE_X1], 'data': [v for t in trees for v in t], 'counts': counts},
        'towers': [
            {'key': 'coa-2023:470235', 'name': 'Union on 24th', 'address': '701 W 24th St', 'ring': r3(union_ring),
             'baseY': round(union_base, 3), 'heightM': UNION_OSM_HEIGHT, 'topY': round(union_base + UNION_OSM_HEIGHT, 3),
             'cityHeightM': round(union_h, 3), 'cityTopY': round(union_base + union_h, 3),
             'groundLidar2017': [round(min(union_ground), 2), round(float(np.median(union_ground)), 2), round(max(union_ground), 2)],
             'footprint': 'City of Austin Building Footprints 2023 OBJECTID 470235 (single ring; the podium covers it, the H-shaped residential floors sit inside it)',
             'height': 'COMMUNITY-SOURCED ESTIMATE: OSM way 1208654798 height 97.536 m (320 ft, 29 levels) above the City BASE_ELEVATION 588.94 ft (y 14.51), crown and roof plant counted inside it; '
                       'the City 2023 MAX_HEIGHT 89.79 m is an older measured snapshot (possibly mid-construction) kept as cityHeightM / cityTopY',
             'identity': 'OSM way 1208654798 name/address over the City ring; Perkins&Will (29 storeys); Datum Engineers (H-shaped residential floors, 4 above-grade parking levels, level-6 amenity, level-29 pool)'},
            {'key': 'osm:1341073412', 'name': 'Villas on 24th', 'address': '2313 Rio Grande St', 'ring': r3(villas_ring),
             'baseY': round(float(np.median(villas_ground)), 3), 'heightM': 95.1,
             'topY': round(float(np.median(villas_ground)) + 95.1, 3),
             'groundLidar2017': [round(min(villas_ground), 2), round(float(np.median(villas_ground)), 2), round(max(villas_ground), 2)],
             'footprint': 'OpenStreetMap way 1341073412 (ODbL; tagged building=construction), trimmed against remaining campus.json rings',
             'trimmedAgainst': overlaps,
             'height': '312 ft (Austin American-Statesman 2023-09-15) = 95.10 m overall incl. the glass amenity crown; 30 storeys (DCI Engineers)',
             'identity': 'owner villas-sh.com (delivered 2025, 2313 Rio Grande); DCI Engineers / Rhode Partners; replaces demolished City record 614399'},
        ],
        'inputs': {p.name: sha(p) for p in (a.lidar, a.city, a.osm, ROOT / 'public/assets/extension/deep-west-v1.bin.gz', ROOT / 'public/data/campus.json')},
        'sources': [
            'USGS 3DEP LiDAR TX_Central_B1_2017 (EPT, public domain): https://usgs-lidar-public.s3.us-west-2.amazonaws.com/USGS_LPC_TX_Central_B1_2017_LAS_2019/',
            'City of Austin Planimetrics 2023 Building Footprints: https://maps.austintexas.gov/arcgis/rest/services/Shared/PlanimetricsSurvey_1/MapServer/0',
            'OpenStreetMap contributors (ODbL 1.0), ways 1208654798 and 1341073412 via Overpass',
            'https://perkinswill.com/project/union-on-24th/ (photos, research only)',
            'https://www.dci-engineers.com/work/villas-on-24th ; https://villas-sh.com/project/ (photos/text, research only)',
        ],
    }
    a.out.write_text(json.dumps(doc, separators=(',', ':')))
    print('wrote', a.out, a.out.stat().st_size, 'bytes; towers', [(t['name'], t['baseY'], t['topY'], len(t['ring'])) for t in doc['towers']])


if __name__ == '__main__':
    main()
