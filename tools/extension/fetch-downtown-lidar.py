#!/usr/bin/env python3
"""Fetch the downtown LiDAR evidence subset (authoring only; nothing here ships).

Source: USGS LPC TX_Central_B1_2017 (public domain) through its public Entwine Point Tile (EPT) mirror. Every EPT node
whose XY box intersects the downtown authoring envelope, from the root through depth 10 (~1.8 m EPT grid spacing),
is downloaded whole; points are clipped to the envelope. This is a deliberate spatial SUBSAMPLE of the survey (all
points of the coarser nodes), adequate for ~2 m roof-tier, canopy and bridge-deck evidence; not full LAS density.
(Promoted from the root review's .work/claude-downtown/ept/fetch-subset.py, plus the hierarchy traversal.)

Output <out>/downtown-lidar-ept-depth10.npz: x, z (campus metres), elevation_navd88_m (EPT Z; campus Y = Z - 165,
validated against the USGS DEM by the root review: median ground difference 0.0003 m), classification (uint8);
<out>/subset-provenance.json: node keys, URLs, bytes, sha256.

Run (venv with tools/lidar/requirements.txt):  python -I tools/extension/fetch-downtown-lidar.py --out <dir>
"""
import argparse
import concurrent.futures as cf
import hashlib
import io
import json
import time
import urllib.request
from pathlib import Path

import laspy
import numpy as np
from pyproj import Transformer

URL = 'https://usgs-lidar-public.s3.us-west-2.amazonaws.com/USGS_LPC_TX_Central_B1_2017_LAS_2019/'
BBOX = (-97.757, 30.2525, -97.731, 30.2745)  # lon/lat envelope (same as fetch-downtown.py)
MAX_DEPTH = 10
SX, SZ, LON0, LAT0 = 96126.8152981172, 110851.0, -97.73716, 30.2861


CACHE = None   # --cache: a previous retrieval's directory (ept.json, hierarchy <key>.json pages, data/<key>.laz)


def get(url, tries=4):
    if CACHE is not None and url.startswith(URL):
        rel = url[len(URL):]
        name = rel if rel == 'ept.json' else rel.replace('ept-hierarchy/', '').replace('ept-data/', 'data/')
        if (CACHE / name).exists():
            return (CACHE / name).read_bytes()
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'gta-texas-authoring/1'}), timeout=60) as r:
                return r.read()
        except Exception:
            if k == tries - 1:
                raise
            time.sleep(2 * (k + 1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True, type=Path)
    ap.add_argument('--cache', type=Path, help='previous retrieval: ept.json, hierarchy <key>.json pages, data/<key>.laz (sha256 still recorded)')
    a = ap.parse_args()
    global CACHE
    CACHE = a.cache
    a.out.mkdir(parents=True, exist_ok=True)
    ept = json.loads(get(URL + 'ept.json'))
    if ept['srs']['horizontal'] != '3857':
        raise SystemExit('Unexpected EPT SRS')
    to3857 = Transformer.from_crs(4326, 3857, always_xy=True)
    to4326 = Transformer.from_crs(3857, 4326, always_xy=True)
    bx0, by0 = to3857.transform(BBOX[0], BBOX[1])
    bx1, by1 = to3857.transform(BBOX[2], BBOX[3])
    b = ept['bounds']
    def box(key):
        d, x, y, _ = map(int, key.split('-'))
        sx, sy = (b[3] - b[0]) / 2 ** d, (b[4] - b[1]) / 2 ** d
        return b[0] + x * sx, b[1] + y * sy, b[0] + (x + 1) * sx, b[1] + (y + 1) * sy

    def hits(key):
        q = box(key)
        return int(key.split('-')[0]) <= MAX_DEPTH and q[0] < bx1 and q[2] > bx0 and q[1] < by1 and q[3] > by0

    # Only hierarchy pages whose node box intersects the envelope (depth <= MAX_DEPTH) are read.
    hierarchy, pending = {}, ['0-0-0-0']
    while pending:
        key = pending.pop()
        page = json.loads(get(URL + f'ept-hierarchy/{key}.json'))
        for k, n in page.items():
            if n == -1 and k != key:
                if hits(k):
                    pending.append(k)
            elif n > 0:
                hierarchy[k] = n

    nodes = sorted(k for k in hierarchy if hits(k))
    records = []

    def fetch(key):
        raw = get(URL + f'ept-data/{key}.laz')
        las = laspy.read(io.BytesIO(raw))
        lon, lat = to4326.transform(np.asarray(las.x), np.asarray(las.y))
        m = (lon >= BBOX[0]) & (lon <= BBOX[2]) & (lat >= BBOX[1]) & (lat <= BBOX[3])
        rec = {'key': key, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(), 'source': URL + f'ept-data/{key}.laz', 'pointsInEnvelope': int(m.sum())}
        return rec, ((lon[m] - LON0) * SX, (LAT0 - lat[m]) * SZ, np.asarray(las.z)[m], np.asarray(las.classification, np.uint8)[m])

    with cf.ThreadPoolExecutor(max_workers=4) as pool:
        parts = list(pool.map(fetch, nodes))   # map keeps node order: deterministic output
    records = [p[0] for p in parts]
    arrays = [np.concatenate([p[1][i] for p in parts]) for i in range(4)]
    np.savez_compressed(a.out / 'downtown-lidar-ept-depth10.npz', x=arrays[0].astype(np.float32), z=arrays[1].astype(np.float32),
                        elevation_navd88_m=arrays[2].astype(np.float32), classification=arrays[3])
    (a.out / 'subset-provenance.json').write_text(json.dumps({
        'dataset': URL, 'sourceDataset': 'USGS_LPC_TX_Central_B1_2017_LAS_2019', 'license': 'Public domain (U.S. Government work)',
        'maxDepth': MAX_DEPTH, 'bboxWgs84': BBOX, 'nodes': len(nodes), 'points': int(len(arrays[0])), 'files': records,
        'sampling': 'all points of every EPT node through depth 10 intersecting the envelope; spatial subsample, not full LAS density'}, indent=1))
    print('nodes', len(nodes), 'points', len(arrays[0]), 'bytes', sum(r['bytes'] for r in records))


if __name__ == '__main__':
    main()
