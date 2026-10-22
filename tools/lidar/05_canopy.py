"""Step 5: canopy height model -> individual tree tops/crowns -> public/data/derived/canopy-trees.json."""
import json

import numpy as np
from scipy import ndimage as ndi
from skimage.draw import polygon as fill_poly
from skimage.segmentation import watershed

from common import (BOUNDS, DATA, DERIVED, GNX, GNZ, GX0, GZ0, RES, WORK, load_json)

r = np.load(WORK / 'rasters.npz')
veg, dtm, bld, vegn, vegmr = r['veg'], r['dtm'], r['bld'], r['vegn'], r['vegmr']
CAL = load_json(WORK / 'calibration.json')
YOFF, SDX, SDZ = CAL['campusMinusNavd88m'], CAL['shiftX'], CAL['shiftZ']
campus = load_json(DATA / 'campus.json')

# Exclusion: 2023 footprints (+1 m) and 2017 class-6 building cells (+1 m).
F = np.zeros((GNZ, GNX), bool)
for b in campus['buildings']:
    a = np.asarray(b['rings'][0], float)
    rr, cc = fill_poly((a[:, 1] - SDZ - GZ0) / RES - 0.5, (a[:, 0] - SDX - GX0) / RES - 0.5, F.shape)
    F[rr, cc] = True
excl = ndi.binary_dilation(F, iterations=2) | ndi.binary_dilation(np.isfinite(bld), iterations=2)

chm = np.where(np.isfinite(veg), veg - dtm, 0.0).astype(np.float32)
chm[excl] = 0.0
chm[chm < 3.0] = 0.0
chm = np.minimum(chm, 45.0)
# fill single-cell pits/gaps inside crowns (0.5 m cells, ~1.7 pts per cell)
chm_c = ndi.grey_closing(chm, size=(3, 3))
chm_c[excl] = 0.0
chm_s = ndi.gaussian_filter(chm_c, sigma=1.0)
chm_s[chm_c < 3.0] = 0.0

# Height-adaptive local maxima: window radius r(h) = clamp(0.5 + 0.25 h, 2, 6) m (square window).
radii = np.arange(2.0, 6.01, 0.5)
rad_of = np.clip(0.5 + 0.25 * chm_s, 2.0, 6.0)
tops = np.zeros(chm_s.shape, bool)
for rr_ in radii:
    k = int(round(rr_ / RES)) * 2 + 1
    mf = ndi.maximum_filter(chm_s, size=k)
    sel = (np.abs(rad_of - rr_) <= 0.25) & (chm_s >= 3.0) & (chm_s >= mf - 1e-4)
    tops |= sel
lab_t, nt = ndi.label(tops, structure=np.ones((3, 3)))
cent = ndi.center_of_mass(tops, lab_t, np.arange(1, nt + 1))
markers = np.zeros(chm_s.shape, np.int32)
for i, (cz, cx) in enumerate(cent, start=1):
    markers[int(round(cz)), int(round(cx))] = i
print('tops', nt, flush=True)
mask = chm_c >= 2.0
seg = watershed(-chm_s, markers, mask=mask)
idx = np.arange(1, nt + 1)
top_h = ndi.maximum(chm_c, seg, idx)
# crown = segment cells >= 50% of its top height
top_of_cell = np.zeros(nt + 1, np.float32)
top_of_cell[1:] = top_h
crown = (seg > 0) & (chm_c >= 0.5 * top_of_cell[seg])
crown_lab = np.where(crown, seg, 0)
area = ndi.sum(crown, crown_lab, idx) * RES * RES
cc = ndi.center_of_mass(crown, crown_lab, idx)
seg_n = ndi.sum(vegn, seg, idx)
seg_mr = ndi.sum(vegmr, seg, idx)
mrf = seg_mr / np.maximum(seg_n, 1)

west, north, east, south = BOUNDS
trees = []
dropped = {'small': 0, 'lowMultiReturn': 0, 'outside': 0}
for i in range(nt):
    h = float(top_h[i])
    a = float(area[i])
    if not np.isfinite(h) or h < 3.0 or a < 3.0:
        dropped['small'] += 1
        continue
    if mrf[i] < 0.1 and a < 15:
        dropped['lowMultiReturn'] += 1
        continue
    tz_, tx_ = cent[i]
    czc, cxc = cc[i]
    # position: crown (>=50 %) centroid, a better trunk proxy than the apex for broad crowns
    px = GX0 + (cxc + 0.5) * RES + SDX
    pz = GZ0 + (czc + 0.5) * RES + SDZ
    if not (west <= px <= east and north <= pz <= south):
        dropped['outside'] += 1
        continue
    apx = GX0 + (tx_ + 0.5) * RES + SDX
    apz = GZ0 + (tz_ + 0.5) * RES + SDZ
    gy = float(dtm[int(round(czc)), int(round(cxc))]) + YOFF
    crad = float(np.sqrt(a / np.pi))
    # confidence: taller, broader, multi-return (porous) crowns are more certainly trees
    c_h = min(max((h - 3) / 12, 0), 1)
    c_a = min(a / 60, 1)
    c_m = min(mrf[i] / 0.6, 1)
    conf = 0.15 + 0.85 * (0.35 * c_h + 0.3 * c_a + 0.35 * c_m)
    trees.append({'x': round(px, 1), 'z': round(pz, 1), 'groundY': round(gy, 1), 'height': round(h, 1),
                  'crownRadius': round(crad, 1), 'confidence': round(conf, 2),
                  '_apex': (round(apx, 1), round(apz, 1)), '_mr': float(mrf[i])})
print('trees', len(trees), dropped, flush=True)
json.dump({'trees': trees, 'dropped': dropped}, open(WORK / 'canopy-raw.json', 'w'))
out = {'source': 'USGS 3DEP Lidar Point Cloud TX_Central_B1_2017 (StratMap 2017 50cm, flown 2017-01-28..2017-03-22, leaf-off season); '
                 'canopy height model 0.5 m, height-adaptive local maxima + watershed crowns; public domain',
       'trees': [{k: v for k, v in t.items() if not k.startswith('_')} for t in trees]}
DERIVED.mkdir(parents=True, exist_ok=True)
txt = json.dumps(out, separators=(',', ':'))
(DERIVED / 'canopy-trees.json').write_text(txt)
np.save(WORK / 'chm.npy', chm_c)
print('bytes', len(txt))
