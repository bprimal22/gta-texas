"""Debug preview (not shipped): CHM + footprints + LiDAR tiers + detected trees -> work/preview-*.png."""
import json
import sys

import numpy as np
from PIL import Image, ImageDraw

from common import DATA, DERIVED, GX0, GZ0, RES, WORK, load_json

cal = load_json(WORK / 'calibration.json')
chm = np.load(WORK / 'chm.npy')
r = np.load(WORK / 'rasters.npz')
bld = r['bld']
campus = load_json(DATA / 'campus.json')
roofs = load_json(DERIVED / 'roofs-lidar.json')['buildings']
trees = load_json(DERIVED / 'canopy-trees.json')['trees']
inv = load_json(DATA / 'speedway-tree-inventory.json')['trees']
name, x0, z0, x1, z1 = sys.argv[1], *map(float, sys.argv[2:6])
S = 2  # px per metre
W, H = int((x1 - x0) * S), int((z1 - z0) * S)
i0 = int((x0 - cal['shiftX'] - GX0) / RES); j0 = int((z0 - cal['shiftZ'] - GZ0) / RES)
c = chm[j0:j0 + int((z1 - z0) / RES), i0:i0 + int((x1 - x0) / RES)]
b = bld[j0:j0 + c.shape[0], i0:i0 + c.shape[1]]
img = np.zeros(c.shape + (3,), np.uint8)
img[..., 1] = np.clip(c * 10, 0, 255)
img[np.isfinite(b)] = (70, 70, 90)
im = Image.fromarray(img).resize((W, H), Image.NEAREST)
d = ImageDraw.Draw(im)
P = lambda x, z: ((x - x0) * S, (z - z0) * S)
for bb in campus['buildings']:
    e = roofs.get(str(bb['id']))
    for t in (e or {}).get('tiers', []):
        h = t['height']
        col = (255, int(max(0, 255 - h * 6)), 0)
        d.polygon([P(*q) for q in t['ring']], outline=col)
    d.line([P(*q) for q in bb['rings'][0]], fill=(80, 160, 255) if not e or e['status'] == 'measured' else (255, 0, 255), width=1)
for t in trees:
    if x0 <= t['x'] <= x1 and z0 <= t['z'] <= z1:
        rr = t['crownRadius'] * S
        px, pz = P(t['x'], t['z'])
        d.ellipse([px - rr, pz - rr, px + rr, pz + rr], outline=(255, 255, 255))
for t in inv:
    px, pz = P(t['x'], t['z'])
    d.rectangle([px - 2, pz - 2, px + 2, pz + 2], fill=(255, 60, 60))
im.save(WORK / f'preview-{name}.png')
print(WORK / f'preview-{name}.png', im.size)
