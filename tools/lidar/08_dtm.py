"""Step 8 (optional product): 1 m bare-earth DTM in campus Y -> public/data/derived/dtm-1m.bin.gz + dtm-1m.json.
Little-endian int16, campus Y in 5 cm units, row-major, rows = +z (south), cols = +x (east).
Value at (col i, row j) is the mean ground at cell centre x = x0 + (i + 0.5) * step, z = z0 + (j + 0.5) * step.
Cells without class-2 returns (under buildings/water) are linearly interpolated. Not integrated in the game.
"""
import gzip
import json

import numpy as np

from common import BOUNDS, DERIVED, GX0, GZ0, WORK, load_json

r = np.load(WORK / 'rasters.npz')
dtm1, gc1 = r['dtm1'], r['gcount1']
cal = load_json(WORK / 'calibration.json')
west, north, east, south = BOUNDS
# crop the LiDAR-frame 1 m grid to campus bounds (integer-metre offset from the margin)
i0, j0 = int(west - GX0), int(north - GZ0)
nx, nz = int(east - west), int(south - north)
g = dtm1[j0:j0 + nz, i0:i0 + nx] + cal['campusMinusNavd88m']
obs = gc1[j0:j0 + nz, i0:i0 + nx] > 0
cm = np.round(g / 0.05).astype('<i2')  # 5 cm units (max quantisation error 2.5 cm)
raw = cm.tobytes()
(DERIVED / 'dtm-1m.bin.gz').write_bytes(gzip.compress(raw, 9, mtime=0))
hdr = {'format': 'int16 little-endian, campus Y in 0.05 m units (Y = value * scale), row-major (rows south +z, cols east +x), gzip',
       'x0': round(west + cal['shiftX'], 3), 'z0': round(north + cal['shiftZ'], 3), 'step': 1.0, 'nx': nx, 'nz': nz,
       'sample': 'cell centre = (x0 + (i + 0.5) * step, z0 + (j + 0.5) * step)',
       'scale': 0.05, 'observedFraction': round(float(obs.mean()), 3),
       'minY': round(float(g.min()), 2), 'maxY': round(float(g.max()), 2),
       'source': 'USGS 3DEP TX_Central_B1_2017 class-2 ground returns; gaps linearly interpolated; 2017 vintage',
       'status': 'reference only; not integrated'}
(DERIVED / 'dtm-1m.json').write_text(json.dumps(hdr, indent=1))
print(hdr, (DERIVED / 'dtm-1m.bin.gz').stat().st_size)
