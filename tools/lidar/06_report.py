"""Step 6: validation numbers for README/HANDOFF -> tools/lidar/work/report.json (+ stdout)."""
import json

import numpy as np
from scipy.spatial import cKDTree

from common import DATA, DERIVED, WORK, load_json

campus = load_json(DATA / 'campus.json')
roofs = load_json(DERIVED / 'roofs-lidar.json')['buildings']
canopy = load_json(DERIVED / 'canopy-trees.json')['trees']
raw = load_json(WORK / 'canopy-raw.json')['trees']
byid = {str(b['id']): b for b in campus['buildings']}
rep = {}

st = {}
for k, v in roofs.items():
    st[v['status']] = st.get(v['status'], 0) + 1
rep['statusCounts'] = st
rep['roofTypes'] = {}
for v in roofs.values():
    if v['status'] == 'measured':
        rep['roofTypes'][v['roofType']] = rep['roofTypes'].get(v['roofType'], 0) + 1
rep['tiersTotal'] = sum(len(v['tiers']) for v in roofs.values())
rep['multiTierBuildings'] = sum(1 for v in roofs.values() if len(v['tiers']) >= 2)

# Height agreement with campus.json h (measured only)
h = np.array([byid[k]['h'] for k, v in roofs.items() if v['status'] == 'measured'])
p95 = np.array([v['heightP95'] for v in roofs.values() if v['status'] == 'measured'])
p50 = np.array([v['heightP50'] for v in roofs.values() if v['status'] == 'measured'])
hmax = np.array([v['heightMax'] for v in roofs.values() if v['status'] == 'measured'])


def agree(a, b, name):
    d = a - b
    return {'vs': name, 'n': int(len(d)), 'medianDiff': round(float(np.median(d)), 2),
            'madDiff': round(float(np.median(np.abs(d - np.median(d)))), 2),
            'within2m': round(float(np.mean(np.abs(d) <= 2)), 3), 'within5m': round(float(np.mean(np.abs(d) <= 5)), 3),
            'pearsonR': round(float(np.corrcoef(a, b)[0, 1]), 3),
            'lidarHigherBy10mPlus': int(np.sum(d > 10)), 'lidarLowerBy10mPlus': int(np.sum(d < -10))}


rep['heightAgreement'] = [agree(p95, h, 'heightP95 - campus.h'), agree(p50, h, 'heightP50 - campus.h'),
                          agree(hmax, h, 'heightMax - campus.h')]

ex = {}
want = {'MAI': None, 'GDC': None, 'PCL': None, 'NHB': None, 'WEL': None, 'UNB': None}
for b in campus['buildings']:
    if b['abbr'] in want:
        want[b['abbr']] = str(b['id'])
want.update({'CAP(533822)': '533822', 'NEZ(655373)': '655373', 'SEZ(504014)': '504014'})
for name, bid in want.items():
    v = roofs.get(bid)
    if not v:
        continue
    ex[name] = {'id': bid, 'campusH': byid[bid]['h'], 'status': v['status'], 'groundY': v['groundY'],
                'P50': v['heightP50'], 'P95': v['heightP95'], 'max': v['heightMax'], 'roofType': v['roofType'],
                'pitchDeg': v['pitchDeg'], 'coverage': v['coverage'],
                'tiers': [(t['height'], t['area'], len(t['ring'])) for t in v['tiers']], 'note': v['note']}
rep['examples'] = ex
rep['conflicts'] = [{'id': k, 'abbr': byid[k]['abbr'], 'name': byid[k]['name'], 'h': byid[k]['h'],
                     'P95': v['heightP95'], 'coverage': v['coverage'], 'note': v['note']}
                    for k, v in roofs.items() if v['status'] == 'conflict']

# Tree validation
T = np.array([[t['x'], t['z']] for t in canopy])
A = np.array([t['_apex'] for t in raw])
kd, kda = cKDTree(T), cKDTree(A)
inv = load_json(DATA / 'speedway-tree-inventory.json')['trees']
I = np.array([[t['x'], t['z']] for t in inv])
O = np.array([t['position'] for t in campus['trees']])


def match(ref, tree, crowns=None):
    d, j = tree.query(ref)
    out = {'n': int(len(ref)), 'within3m': round(float(np.mean(d <= 3)), 3), 'within5m': round(float(np.mean(d <= 5)), 3),
           'medianNearest': round(float(np.median(d)), 2)}
    if crowns is not None:
        out['insideNearestCrown'] = round(float(np.mean(d <= crowns[j])), 3)
    # any detected crown covering the ref point
    if crowns is not None:
        cov = [any(np.hypot(*(T[k] - p)) <= crowns[k] for k in tree.query_ball_point(p, 20)) for p in ref]
        out['coveredByAnyCrown'] = round(float(np.mean(cov)), 3)
    return out


cr = np.array([t['crownRadius'] for t in canopy])
rep['treeValidation'] = {
    'speedwayInventory57': {'crownCentroid': match(I, kd, cr), 'apex': match(I, kda)},
    'osmTrees': {'crownCentroid': match(O, kd, cr), 'apex': match(O, kda)},
}
# inventory heights vs lidar heights for matched trees
d, j = kd.query(I)
hm = [(inv[i]['heightMetres'], canopy[j[i]]['height']) for i in range(len(inv)) if d[i] <= 3]
if hm:
    a = np.array(hm)
    rep['treeValidation']['speedwayInventoryHeight'] = {
        'nMatched': len(hm), 'medianLidarMinusInventory': round(float(np.median(a[:, 1] - a[:, 0])), 2)}

rep['canopy'] = {'trees': len(canopy),
                 'heightQuantiles': [round(float(q), 1) for q in np.percentile([t['height'] for t in canopy], [5, 25, 50, 75, 95])],
                 'crownRadiusQuantiles': [round(float(q), 1) for q in np.percentile(cr, [5, 25, 50, 75, 95])],
                 'confidenceQuantiles': [round(float(q), 2) for q in np.percentile([t['confidence'] for t in canopy], [5, 25, 50, 75, 95])]}


def count(x0, x1, z0, z1):
    sel = (T[:, 0] >= x0) & (T[:, 0] <= x1) & (T[:, 1] >= z0) & (T[:, 1] <= z1)
    return int(sel.sum())


rep['corridors'] = {
    'speedway x0..40 z-150..150': count(0, 40, -150, 150),
    'speedway wide x-30..60 z-150..150': count(-30, 60, -150, 150),
    'eastMall z60..75 x-160..130': count(-160, 130, 60, 75),
    'eastMall band z45..90 x-160..130': count(-160, 130, 45, 90),
    'inventoryTreesInSpeedwayBox': int(((I[:, 0] >= 0) & (I[:, 0] <= 40) & (I[:, 1] >= -150) & (I[:, 1] <= 150)).sum()),
    'osmTreesInSpeedwayBox': int(((O[:, 0] >= 0) & (O[:, 0] <= 40) & (O[:, 1] >= -150) & (O[:, 1] <= 150)).sum()),
    'osmTreesInEastMallBox': int(((O[:, 0] >= -160) & (O[:, 0] <= 130) & (O[:, 1] >= 60) & (O[:, 1] <= 75)).sum()),
}
json.dump(rep, open(WORK / 'report.json', 'w'), indent=1)
print(json.dumps(rep, indent=1))
