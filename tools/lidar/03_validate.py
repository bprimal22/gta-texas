"""Step 3: empirical alignment checks.

Horizontal: overlap of class-6 (building) LiDAR cells with campus.json footprints,
searched over shifts of +-6 m (global) and +-3 m (per building).
Vertical: 1 m LiDAR DTM (observed ground only) vs public/data/terrain.json nodes and the baked
offline terrain vertices. Writes tools/lidar/work/alignment.json.
"""
import gzip
import json
import struct

import numpy as np
from scipy.ndimage import binary_dilation
from skimage.draw import polygon as fill_poly

from common import (DATA, GNX, GNZ, GX0, GZ0, LANE, NOMINAL_Y_OFFSET, RES, WORK, load_json)

r = np.load(WORK / 'rasters.npz')
bld = np.isfinite(r['bld'])
dtm1, gc1 = r['dtm1'], r['gcount1']
campus = load_json(DATA / 'campus.json')


def footprint_mask(rings, shape=(GNZ, GNX)):
    m = np.zeros(shape, bool)
    for k, ring in enumerate(rings):
        a = np.asarray(ring, float)
        rr, cc = fill_poly((a[:, 1] - GZ0) / RES - 0.5, (a[:, 0] - GX0) / RES - 0.5, shape)
        if k == 0:
            m[rr, cc] = True
        else:
            m[rr, cc] = False
    return m


F = np.zeros((GNZ, GNX), bool)
for b in campus['buildings']:
    F |= footprint_mask(b['rings'])


def best_shift(Fm, Bm, rad):
    best = None
    scores = {}
    for sz in range(-rad, rad + 1):
        Bz = np.roll(Bm, sz, axis=0)
        for sx in range(-rad, rad + 1):
            Bs = np.roll(Bz, sx, axis=1)
            inter = np.count_nonzero(Fm & Bs)
            union = np.count_nonzero(Fm | Bs)
            iou = inter / max(union, 1)
            scores[(sz, sx)] = iou
            if best is None or iou > best[0]:
                best = (iou, sz, sx)
    iou, sz, sx = best

    def parab(a, b, c):
        d = a - 2 * b + c
        return 0.0 if d == 0 else 0.5 * (a - c) / d

    fx = sx + (parab(scores.get((sz, sx - 1), iou), iou, scores.get((sz, sx + 1), iou)) if abs(sx) < rad else 0)
    fz = sz + (parab(scores.get((sz - 1, sx), iou), iou, scores.get((sz + 1, sx), iou)) if abs(sz) < rad else 0)
    return {'dx': fx * RES, 'dz': fz * RES, 'iou': iou, 'iou0': scores[(0, 0)]}


# Global: restrict to the bbox of footprints to save time.
glob = best_shift(F, bld, 12)
print('global shift', glob, flush=True)

per = []
for b in campus['buildings']:
    a = np.asarray(b['rings'][0], float)
    x0, x1 = a[:, 0].min() - 8, a[:, 0].max() + 8
    z0, z1 = a[:, 1].min() - 8, a[:, 1].max() + 8
    i0, i1 = int((x0 - GX0) / RES), int((x1 - GX0) / RES)
    j0, j1 = int((z0 - GZ0) / RES), int((z1 - GZ0) / RES)
    if i0 < 0 or j0 < 0 or i1 >= GNX or j1 >= GNZ:
        continue
    fm = footprint_mask(b['rings'])[j0:j1, i0:i1]
    if fm.sum() * RES * RES < 600:
        continue
    bm = bld[j0:j1, i0:i1] & binary_dilation(fm, iterations=10)
    if bm.sum() < 0.5 * fm.sum():
        continue
    s = best_shift(fm, bm, 6)
    if s['iou'] < 0.6:
        continue
    s['id'] = b['id']
    per.append(s)
dxs = np.array([s['dx'] for s in per])
dzs = np.array([s['dz'] for s in per])
perStats = {'n': len(per), 'meanDx': float(dxs.mean()), 'meanDz': float(dzs.mean()),
            'medianDx': float(np.median(dxs)), 'medianDz': float(np.median(dzs)),
            'stdDx': float(dxs.std()), 'stdDz': float(dzs.std()),
            'medianIouAtZero': float(np.median([s['iou0'] for s in per])),
            'medianIouBest': float(np.median([s['iou'] for s in per]))}
print('per-building', perStats, flush=True)

# Vertical: observed-ground 1 m cells away from footprints.
F1 = F[:dtm1.shape[0] * 2, :dtm1.shape[1] * 2].reshape(dtm1.shape[0], 2, dtm1.shape[1], 2).any(axis=(1, 3))
F1 = binary_dilation(F1, iterations=4)
obs = (gc1 > 0) & ~F1


def sample_dtm(xs, zs):
    fx = (xs - GX0) / 1.0 - 0.5
    fz = (zs - GZ0) / 1.0 - 0.5
    i = np.round(fx).astype(int)
    j = np.round(fz).astype(int)
    good = (i >= 0) & (j >= 0) & (i < dtm1.shape[1]) & (j < dtm1.shape[0])
    v = np.full(len(xs), np.nan)
    o = np.zeros(len(xs), bool)
    v[good] = dtm1[j[good], i[good]]
    o[good] = obs[j[good], i[good]]
    return v, o


def stats(res):
    res = res[np.isfinite(res)]
    q = np.percentile(res, [5, 25, 50, 75, 95])
    return {'n': int(len(res)), 'median': float(q[2]), 'p5': float(q[0]), 'p25': float(q[1]),
            'p75': float(q[3]), 'p95': float(q[4]), 'mad': float(np.median(np.abs(res - q[2]))),
            'meanAbsAfterMedian': float(np.mean(np.abs(res - q[2])))}


t = load_json(DATA / 'terrain.json')
H = np.asarray(t['heights'], float).reshape(t['nz'], t['nx'])
jz, ix = np.mgrid[0:t['nz'], 0:t['nx']]
tx = t['x0'] + ix.ravel() * t['step']
tz = t['z0'] + jz.ravel() * t['step']
lv, lo = sample_dtm(tx, tz)
res_t = H.ravel()[lo] - (lv[lo] + NOMINAL_Y_OFFSET)
terrStats = stats(res_t)
print('terrain.json residual (campusY - (navd88-165))', terrStats, flush=True)

raw = gzip.open(LANE / 'public/assets/campus/offline-terrain-61.bin.gz').read()
count = struct.unpack_from('<I', raw, 8)[0]
pos = np.frombuffer(raw, dtype='<f4', count=count * 3, offset=20).reshape(-1, 3)
# vertices are triangle-soup (shared); dedupe roughly
uniq = np.unique(np.round(pos, 2), axis=0)
bv, bo = sample_dtm(uniq[:, 0], uniq[:, 2])
res_b = uniq[bo, 1] - (bv[bo] + NOMINAL_Y_OFFSET)
bakedStats = stats(res_b)
print('baked terrain residual', bakedStats, flush=True)

out = {'horizontal': {'global': glob, 'perBuilding': perStats,
                      'convention': 'shift (metres) to ADD to LiDAR campus x,z to best match campus.json footprints'},
       'vertical': {'terrainJson': terrStats, 'bakedTerrain': bakedStats,
                    'convention': 'residual = campusY - (NAVD88_m - 165) at observed-ground cells >=4 m from footprints'}}
json.dump(out, open(WORK / 'alignment.json', 'w'), indent=1)
