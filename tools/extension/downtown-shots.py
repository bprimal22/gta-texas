#!/usr/bin/env python3
"""Named downtown review shots -> lib/campus/extension/downtown/shots.json (deterministic).
Cameras/targets are set from the actual baked downtown terrain (asset) or the campus terrain.json grid (campus
positions, same diagonal as terrain.ts), never from guesses. Run after bake-downtown.py:
  python -I tools/extension/downtown-shots.py
"""
import gzip
import json
import struct
from pathlib import Path

import numpy as np
from shapely.geometry import Point, Polygon

ROOT = Path(__file__).resolve().parents[2]
blob = gzip.decompress((ROOT / 'public/assets/extension/downtown-v1.bin.gz').read_bytes())
ml = struct.unpack('<I', blob[8:12])[0]
meta = json.loads(blob[16:16 + ml])
sec = {s['name']: s for s in meta['sections']}
H = np.frombuffer(blob, '<f4', sec['heights']['count'], 16 + ml + sec['heights']['byteOffset']).reshape(meta['grid']['nz'], meta['grid']['nx'])
R, STEP = meta['rect'], meta['step']
T = json.loads((ROOT / 'public/data/terrain.json').read_text())
TH = np.array(T['heights']).reshape(T['nz'], T['nx'])
S = json.loads((ROOT / 'lib/campus/blocks/b14-capitol/strip-ground.json').read_text())
SH = (np.frombuffer(__import__('base64').b64decode(S['heights']), '<i2').astype(np.float64) * S['unit']).astype(np.float32).reshape(S['nz'], S['nx'])
G = S['grounds']


def in_grounds(x, z):
    c, s_ = np.cos(G['rotation']), np.sin(G['rotation'])
    u = (x - G['center'][0]) * c + (z - G['center'][1]) * s_
    v = -(x - G['center'][0]) * s_ + (z - G['center'][1]) * c
    return G['u'][0] <= u <= G['u'][1] and G['v'][0] <= v <= G['v'][1]


def tri(h, nx, nz, fx, fz):
    fx = min(max(fx, 0), nx - 1.000001); fz = min(max(fz, 0), nz - 1.000001)
    i, j = int(fx), int(fz); u, v = fx - i, fz - j
    a, b, c, e = h[j, i], h[j, i + 1], h[j + 1, i], h[j + 1, i + 1]
    return float(a + (b - a) * u + (c - a) * v if u + v <= 1 else e + (c - e) * (1 - u) + (b - e) * (1 - v))


def ground(x, z):
    if R['xmin'] <= x <= R['xmax'] and R['zmin'] <= z <= R['zmax']:
        return tri(H, meta['grid']['nx'], meta['grid']['nz'], (x - R['xmin']) / STEP, (z - R['zmin']) / STEP), 'downtown terrain (baked asset)'
    if z > 1288:
        if in_grounds(x, z):
            raise SystemExit(f'shot ground at ({x},{z}) is on the authored Capitol grounds; pick another spot')
        return tri(SH, S['nx'], S['nz'], (x - S['x0']) / S['step'], (z - S['z0']) / S['step']), 'Capitol strip patch (strip-ground.json)'
    return tri(TH, T['nx'], T['nz'], (x - T['x0']) / T['step'], (z - T['z0']) / T['step']), 'campus terrain.json'


lm = {}
for b in meta['buildings']:
    if b.get('lm') and (b['src'] == 'landmark' or b.get('heightPolicy')):
        p = Polygon(b['tiers'][0]['r'][0]).centroid
        lm[b['lm']] = (p.x, p.y, b['g'][0])
play = Polygon(meta['playable'][0])


def shore(x, inward=14.0):
    """A point `inward` metres inside the shoreline wall nearest the vertical line at x (north bank)."""
    best = None
    for ax, az, bx, bz in meta['walls']:
        if min(ax, bx) <= x <= max(ax, bx) and abs(bx - ax) > 1e-6:
            z = az + (bz - az) * (x - ax) / (bx - ax)
            if z > meta['seam']['z'] + 300 and (best is None or z < best):
                best = z
    z = best - inward
    while not play.contains(Point(x, z)):
        z -= 1
    return x, z


shots = []
cm = np.frombuffer(blob, np.uint8, sec['classMap']['count'], 16 + ml + sec['classMap']['byteOffset']).reshape(meta['classMap']['h'], meta['classMap']['w'])
feet = [Polygon(t['r'][0]).buffer(1.0) for b in meta['buildings'] for t in b['tiers']]
from shapely.strtree import STRtree
feet_tree = STRtree(feet)


def on_street(x, z):
    """Nearest mapped asphalt/sidewalk/plaza pixel (CoA 2023 class map) at least 1 m from every footprint."""
    for r in range(0, 60):
        for k in range(max(1, 8 * r)):
            a = 2 * np.pi * k / max(1, 8 * r)
            px, pz = x + r * np.cos(a), z + r * np.sin(a)
            i, j = int(px - R['xmin']), int(pz - R['zmin'])
            if 0 <= i < cm.shape[1] and 0 <= j < cm.shape[0] and cm[j, i] in (1, 2, 3) and play.contains(Point(px, pz)) \
                    and not any(feet[q].contains(Point(px, pz)) for q in feet_tree.query(Point(px, pz))):
                return round(px, 2), round(pz, 2)
    raise SystemExit(f'no street pixel near {x},{z}')


def add(sid, label, kind, cam, target, fov, note, eye=None, tgt_agl=None, snap=True):
    cx, cz = cam[0], cam[2]
    if kind == 'street' and R['zmin'] < cz and snap:
        cx, cz = on_street(cx, cz)
    g, src = ground(cx, cz)
    cy = g + eye if eye is not None else cam[1]
    tx, tz = target[0], target[2]
    ty = target[1] if tgt_agl is None else ground(tx, tz)[0] + tgt_agl
    shots.append({'id': sid, 'label': label, 'kind': kind, 'position': [round(cx, 2), round(cy, 2), round(cz, 2)],
                  'target': [round(tx, 2), round(ty, 2), round(tz, 2)], 'fov': fov, 'groundY': round(g, 3), 'groundSource': src,
                  'focus': [round(tx, 2), round(ty, 2), round(tz, 2)] if kind != 'street' else None, 'note': note})


wl, sg, fr, b185, aus, ind = (lm[k] for k in ('waterline', 'sixth-guadalupe', 'frost', 'block185', 'austonian', 'independent'))
core = (-700, 110, 2300)
add('dt-skyline-southmall-street', 'Downtown skyline from the South Mall (street level)', 'street', (-62, 0, 330), core, 50,
    'Campus eye height on the South Mall lawn looking south past the Capitol to the skyline (~2 km).', eye=1.75)
add('dt-skyline-campus-100m', 'Downtown skyline from campus at the 100 m flight ceiling', 'aerial', (-60, 0, 120), (-650, 90, 2400), 50,
    'Camera 100 m above campus terrain (the flight cap) over the Main Mall looking south.', eye=100)
add('dt-skyline-north-campus-street', 'Skyline from north campus (Dean Keeton) at street level', 'street', (-30, 0, -560), (-650, 130, 2400), 40,
    'Longest campus sight line (~3 km): skyline through haze above campus roofs.', eye=1.75)
add('dt-capitol-congress-approach', 'Congress Avenue south from the Capitol grounds', 'street', (-418, 0, 1580), (-700, 40, 2480), 55,
    'Downtown street level on Congress Avenue just south of the strip seam, looking toward the river.', eye=1.75)
add('dt-seam-congress-flight', 'Seam: Capitol south grounds to downtown, low flight', 'aerial', (-480, 0, 1512), (-600, 20, 1820), 55,
    'Over the Capitol strip looking across the z=1536 seam into downtown (terrain/strip continuity).', eye=35)
add('dt-oblique-northeast', 'Downtown skyline oblique from the northeast', 'aerial', (380, 0, 1640), core, 50,
    'Aerial over the I-35 frontage looking southwest across the core.', eye=180)
add('dt-oblique-southwest', 'Downtown skyline from across Lady Bird Lake (southwest)', 'aerial', (-1250, 0, 2900), (-600, 110, 2150), 50,
    'Over the south bank (visual-only context) looking north-east at the skyline and the river.', eye=120)
add('dt-oblique-southeast', 'Rainey and Waterline from the southeast', 'aerial', (-520, 0, 3400), (wl[0], 150, wl[1]), 50,
    'Over the river south of Rainey looking north at Waterline and the Rainey towers.', eye=110)
add('dt-oblique-west', 'Skyline from the west (Lamar / Shoal Creek)', 'aerial', (-1740, 0, 2050), (-700, 120, 2200), 50,
    'West edge looking east along the river front: Independent, 360, Block 185 in front of the core.', eye=140)
add('dt-overview-top', 'Downtown overview (high oblique)', 'aerial', (-650, 0, 1300), (-650, 0, 2500), 55,
    'High oblique for map-travel review: street grid, parks, creeks, shoreline, bridges.', eye=650, tgt_agl=0)
add('dt-route-congress-6th', 'Street route: Congress Avenue at 6th Street', 'street', (-505, 0, 1880), (-640, 25, 2300), 60,
    'Pedestrian view south on Congress near 6th Street (historic storefronts, Frost/Austonian ahead).', eye=1.75)
# East 6th Street: City of Austin CTN centreline points of the 300 block (camera) and the 500 block (target), so the
# view runs down the street axis (the earlier z=1916 camera stood a block north, facing a wall).
add('dt-route-6th-street', 'Street route: East 6th Street historic district', 'street', (-261.368, 0, 2091.238), (-54.667, 0, 2156.353), 60,
    'Pedestrian view east along East 6th Street from the 300 block (CoA CTN centreline) toward the 500 block: low-rise historic storefronts.',
    eye=1.75, tgt_agl=4, snap=False)
sx, sz = shore(-610)
add('dt-riverbank-congress', 'Riverbank trail by the Congress Avenue Bridge', 'street', (sx, 0, sz), (-560, -30, 2760), 60,
    'North shore trail (playable edge) looking across the river; the bridge deck is visual-only beyond the shore wall.', eye=1.75)
rx, rz = shore(-300)
add('dt-riverbank-rainey', 'Riverbank near Waller Creek mouth / Rainey', 'street', (rx, 0, rz), (wl[0], 120, wl[1]), 60,
    'North-east bank near the Waller Creek inlet barrier looking at Waterline.', eye=1.75)
add('dt-waterline-street', 'Waterline from Red River / Cesar Chavez', 'street', (wl[0] - 70, 0, wl[1] - 120), (wl[0], 170, wl[1]), 60,
    'Street-level view up the 312 m tower: banded lower shaft, reveal, white grid upper shaft, crown frame.', eye=1.75)
add('dt-frost-crown', 'Frost Bank Tower crown (mid distance)', 'aerial', (fr[0] - 160, 0, fr[1] - 140), (fr[0], 150, fr[1]), 45,
    'Mid-distance view of the folded spire crown at the published 157 m overall height.', eye=110)
add('dt-block185-sail', 'Block 185 sail from the river', 'aerial', (b185[0] + 40, 0, b185[1] + 330), (b185[0], 90, b185[1]), 50,
    'From over the river: terraced sail rising to the north peak (180 m).', eye=40)
add('dt-sixth-guadalupe-street', 'Sixth and Guadalupe from Guadalupe Street', 'street', (sg[0] + 20, 0, sg[1] + 160), (sg[0], 160, sg[1]), 60,
    'Street-level view up the three stacked volumes.', eye=1.75)
# Pfluger bridge shots (pfluger-bridge.ts): the deck camera stands on the bridge deck, not the terrain, so both are
# authored from the deck/plan in pfluger-bridge.json rather than snapped to the class map.
shots.append({'id': 'dt-pfluger-aerial', 'label': 'Pfluger pedestrian bridge from over Lady Bird Lake (southeast, 30 m)', 'kind': 'aerial',
              'position': [-1700, -4.35, 2318], 'target': [-1792, -27, 2272], 'fov': 55, 'groundY': round(ground(-1700, 2318)[0], 3),
              'groundSource': 'downtown terrain (baked asset)', 'focus': [-1792, -27, 2272],
              'note': 'Double-curve deck, weathering-steel girders and curved twin-column bents (pfluger-bridge.ts); most of the span lies west of x=-1760 over the visual backdrop.'})
shots.append({'id': 'dt-pfluger-deck', 'label': 'On the Pfluger bridge north connector looking south along the deck', 'kind': 'street',
              'position': [-1750.5, -23.3, 2184], 'target': [-1806, -24.5, 2300], 'fov': 60, 'groundY': round(ground(-1750.5, 2184)[0], 3),
              'groundSource': 'downtown terrain (baked asset); camera stands 1.7 m above the bridge deck (~-25.0)', 'focus': None,
              'note': 'Eye height on the deck: tinted concrete with dusty-red bands, grey rails with mesh infill, saucer lamps; the helix to the left.'})
out = ROOT / 'lib/campus/extension/downtown/shots.json'
out.write_text(json.dumps(shots, indent=1) + '\n')
print(len(shots), 'shots ->', out)
