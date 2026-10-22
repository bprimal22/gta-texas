"""Step 1: read the 4 LAZ tiles, reproject EPSG:6343 (NAD83(2011) UTM 14N, NAVD88 m)
to NAD83(2011) lon/lat, then to campus x,z per CONTRACT; crop to campus bounds + margin.
Writes tools/lidar/work/points.npz (float32 x,z,elev_navd88_m; uint8 class/return/nret).
"""
import hashlib
import json
from collections import Counter

import laspy
import numpy as np
from pyproj import Transformer

from common import (BOUNDS, MARGIN, RAW, TILES, URL_BASE, WORK, lonlat_to_campus)

WORK.mkdir(parents=True, exist_ok=True)
tr = Transformer.from_crs('EPSG:6343', 'EPSG:6318', always_xy=True)
west, north, east, south = BOUNDS
parts = {k: [] for k in ('x', 'z', 'e', 'c', 'r', 'n')}
classes = Counter()
manifest = []
for name in TILES:
    path = RAW / name
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for blk in iter(lambda: f.read(1 << 22), b''):
            h.update(blk)
    with laspy.open(path) as f:
        hdr = f.header
        wkt = hdr.parse_crs().to_wkt() if hdr.parse_crs() else ''
        kept = 0
        for pts in f.chunk_iterator(4_000_000):
            ux = np.asarray(pts.x)
            uy = np.asarray(pts.y)
            lon, lat = tr.transform(ux, uy)
            x, z = lonlat_to_campus(lon, lat)
            m = (x >= west - MARGIN) & (x <= east + MARGIN) & (z >= north - MARGIN) & (z <= south + MARGIN)
            if not m.any():
                continue
            cls = np.asarray(pts.classification)[m].astype(np.uint8)
            classes.update(dict(zip(*np.unique(cls, return_counts=True))))
            parts['x'].append(x[m].astype(np.float32))
            parts['z'].append(z[m].astype(np.float32))
            parts['e'].append(np.asarray(pts.z)[m].astype(np.float32))
            parts['c'].append(cls)
            parts['r'].append(np.asarray(pts.return_number)[m].astype(np.uint8))
            parts['n'].append(np.asarray(pts.number_of_returns)[m].astype(np.uint8))
            kept += int(m.sum())
    manifest.append({'file': name, 'url': URL_BASE + name, 'bytes': path.stat().st_size,
                     'sha256': h.hexdigest(), 'pointCount': int(hdr.point_count), 'keptInBounds': kept,
                     'lasVersion': str(hdr.version), 'pointFormat': int(hdr.point_format.id)})
    print(name, hdr.point_count, kept, flush=True)

out = {k: np.concatenate(v) for k, v in parts.items()}
np.savez(WORK / 'points.npz', **out)
json.dump({'tiles': manifest, 'crs': wkt, 'classCounts': {int(k): int(v) for k, v in sorted(classes.items())},
           'total': int(len(out['x']))}, open(WORK / 'extract-manifest.json', 'w'), indent=1)
print('total', len(out['x']), dict(sorted(classes.items())))
