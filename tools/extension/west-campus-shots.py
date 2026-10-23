#!/usr/bin/env python3
"""Named West Campus review shots -> lib/campus/extension/west-campus/shots.json (deterministic).
Grounds come from the baked deep-west terrain triangles (x < -760) or the campus terrain.json grid (same diagonal as
terrain.ts); street cameras snap to the nearest City 2023 road / sidewalk polygon (deep-west asset) or stay on mapped
campus streets; every camera is checked to be outside all footprints (City 2023, campus.json and the two new towers).
  python -I tools/extension/west-campus-shots.py
"""
import gzip
import json
import struct
from pathlib import Path

import numpy as np
from shapely.geometry import Point, Polygon
from shapely.ops import nearest_points, unary_union

ROOT = Path(__file__).resolve().parents[2]
raw = gzip.decompress((ROOT / 'public/assets/extension/deep-west-v1.bin.gz').read_bytes())
ml = struct.unpack_from('<I', raw, 8)[0]
meta = json.loads(raw[20:20 + ml])
sec = {s['name']: s for s in meta['sections']}
P0 = 20 + ml
pos = np.frombuffer(raw, '<f4', sec['terrain.position']['count'], P0 + sec['terrain.position']['byteOffset']).reshape(-1, 3)
idx = np.frombuffer(raw, '<u4', sec['terrain.index']['count'], P0 + sec['terrain.index']['byteOffset']).reshape(-1, 3)
A, B, Cc = pos[idx[:, 0]], pos[idx[:, 1]], pos[idx[:, 2]]
T = json.loads((ROOT / 'public/data/terrain.json').read_text())
TH = np.array(T['heights']).reshape(T['nz'], T['nx'])
wc = json.loads((ROOT / 'public/assets/extension/west-campus-v1.json').read_text())
campus = json.loads((ROOT / 'public/data/campus.json').read_text())


def tri(h, nx, nz, fx, fz):
    fx = min(max(fx, 0), nx - 1.000001); fz = min(max(fz, 0), nz - 1.000001)
    i, j = int(fx), int(fz); u, v = fx - i, fz - j
    a, b, c, e = h[j, i], h[j, i + 1], h[j + 1, i], h[j + 1, i + 1]
    return float(a + (b - a) * u + (c - a) * v if u + v <= 1 else e + (c - e) * (1 - u) + (b - e) * (1 - v))


def ground(x, z):
    if x < -760:
        d = (B[:, 2] - Cc[:, 2]) * (A[:, 0] - Cc[:, 0]) + (Cc[:, 0] - B[:, 0]) * (A[:, 2] - Cc[:, 2])
        l1 = ((B[:, 2] - Cc[:, 2]) * (x - Cc[:, 0]) + (Cc[:, 0] - B[:, 0]) * (z - Cc[:, 2])) / d
        l2 = ((Cc[:, 2] - A[:, 2]) * (x - Cc[:, 0]) + (A[:, 0] - Cc[:, 0]) * (z - Cc[:, 2])) / d
        l3 = 1 - l1 - l2
        k = np.nonzero((l1 >= -1e-7) & (l2 >= -1e-7) & (l3 >= -1e-7))[0][0]
        return float(l1[k] * A[k, 1] + l2[k] * B[k, 1] + l3[k] * Cc[k, 1]), 'deep-west terrain (baked asset)'
    return tri(TH, T['nx'], T['nz'], (x - T['x0']) / T['step'], (z - T['z0']) / T['step']), 'campus terrain.json'


feet = [Polygon(b['rings'][0]).buffer(0) for b in meta['buildings']] + [Polygon(b['rings'][0]).buffer(0) for b in campus['buildings']]
feet += [Polygon(t['ring']) for t in wc['towers']]
blocked = unary_union(feet).buffer(1.5)
paved = unary_union([Polygon(r[0], r[1:]).buffer(0) for k in ('Paved Road',) for r in meta['map']['surfaces'][k]])


def on_street(x, z):
    """Nearest point on a deep-west City 2023 road polygon, nudged 0.5 m inside it."""
    p = Point(x, z)
    if paved.contains(p):
        return x, z
    q = nearest_points(paved, p)[0]
    d = np.array([q.x - x, q.y - z]); d /= np.linalg.norm(d)
    return float(q.x + d[0] * .5), float(q.y + d[1] * .5)


shots = []


def add(sid, label, kind, x, z, eye, target, fov, note, focus=None, snap=False):
    if snap:
        x, z = on_street(x, z)
    x, z = round(x, 2), round(z, 2)
    if blocked.contains(Point(x, z)):
        raise SystemExit(f'{sid}: camera inside / within 1.5 m of a footprint')
    g, src = ground(x, z)
    shots.append({'id': sid, 'label': label, 'kind': kind, 'position': [x, round(g + eye, 2), z], 'target': [round(v, 2) for v in target],
                  'fov': fov, 'groundY': round(g, 3), 'groundSource': src, 'focus': focus, 'note': note})


u = next(t for t in wc['towers'] if t['name'] == 'Union on 24th')
v = next(t for t in wc['towers'] if t['name'] == 'Villas on 24th')
uc = Polygon(u['ring']).centroid
vc = Polygon(v['ring']).centroid
add('wc-union-24th-street', 'Union on 24th from W 24th St (north side, street level)', 'street', -726.5, -206, 1.75, [uc.x, 58, uc.y], 58,
    'North sidewalk of W 24th (campus.json path 124953234 runs z~-206); Union podium + H legs on the north face.')
add('wc-villas-24th-street', 'Villas on 24th from W 24th at Seton Ave (street level)', 'street', -652, -210, 1.75, [vc.x, 52, vc.y], 60,
    'On the mapped W 24th / Seton footway (path 1206168882); Villas north (24th) face, lobby and garage screen.')
add('wc-rio-grande-between', 'Rio Grande St between Union (left) and Villas (right), looking south', 'street', -726.5, -206, 1.75, [-726, 30, -60], 62,
    'Rio Grande at W 24th (path 223301266 starts at z -202), looking down the gap between the two new towers.')
add('wc-seam-24th-west', 'W 24th St across the deep-west seam, looking west', 'street', -740, -208, 1.75, [-960, 8, -214], 58,
    'Seam crossing x=-760 on W 24th: Union podium on the left, Deep West canopy ahead.')
add('wc-d40-street-facades', 'D40 street: mid/high-rise facades near The Standard', 'street', -880, -128, 1.75, [-830, 22, -100], 60,
    'Street level west of The Standard (726333; charcoal piers, green glass) with 615176 to the north.', snap=True)
add('wc-d38-street-canopy', 'D38 residential street under the 2017 LiDAR canopy', 'street', -1230, 120, 1.75, [-1150, 6, 140], 60,
    'Residential street in D38 (Judges\' Hill / Pemberton side): houses under the Deep West canopy.', snap=True)
add('wc-d39-street-apartments', 'D39 apartment street (storefront bases, accents, canopy)', 'street', -1000, -260, 1.75, [-940, 12, -300], 60,
    'D39 mixed 2-4 storey apartments with the new facade programme and street trees.', snap=True)
add('wc-union-north-aerial', 'Union on 24th H courts from the north (aerial, 140 m)', 'aerial', uc.x, uc.y - 150, 140, [uc.x, 20, uc.y], 55,
    'Looks down into the north court (roof garden) between the dark legs; south pool court beyond.', focus=[uc.x, 15, uc.y])
add('wc-towers-northeast-aerial', 'Union + Villas from the northeast (aerial, 110 m)', 'aerial', -560, -360, 110, [-750, 45, -170], 55,
    'Both new towers with the b12 high-rises and the Deep West canopy behind.', focus=[-740, 15, -170])
add('wc-deep-west-canopy-aerial', 'Deep West canopy and D40 facades from the east (aerial, 80 m)', 'aerial', -700, 60, 80, [-1150, 5, 60], 58,
    'From over b12 looking west across the seam: D40 towers and the D38/D39 tree cover.', focus=[-950, 10, 60])
add('wc-d40-standard-aerial', 'The Standard and 615176 oblique (aerial, 70 m)', 'aerial', -985, -20, 70, [-850, 30, -140], 58,
    'D40 high-rises with profile accents (charcoal / orange-brown piers) and the glazed ground storeys.', focus=[-850, 15, -140])
(ROOT / 'lib/campus/extension/west-campus/shots.json').write_text(json.dumps(shots, indent=1) + '\n')
print(len(shots), [(s['id'], s['position']) for s in shots])
