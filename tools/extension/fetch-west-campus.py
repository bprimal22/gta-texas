#!/usr/bin/env python3
"""Fetch the public source data for the West Campus additions (authoring only; nothing here ships).

  python3 -I tools/extension/fetch-west-campus.py --out .work/claude-west-campus/raw            # City 2023 + OSM
  python3 -I tools/extension/fetch-west-campus.py --lidar --out .work/claude-west-campus/ept-root  # + 2017 LiDAR subset

City of Austin Planimetrics 2023 building footprints / impervious cover and OpenStreetMap buildings (Overpass, ODbL) for
campus x -1580..-380, z -520..580; the LiDAR mode runs tools/extension/fetch-downtown-lidar.py (EPT depth-10 subset of
USGS TX_Central_B1_2017) with the WEST CAMPUS envelope x -1600..-350, z -560..620 instead of its downtown default (the
output file keeps that tool's name, downtown-lidar-ept-depth10.npz). Then run tools/extension/bake-west-campus.py.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import sys
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1].parent
SX, SZ, LON0, LAT0 = 96126.8152981172, 110851.0, -97.73716, 30.2861


def envelope(x0, x1, z0, z1):
    return (LON0 + x0 / SX, LAT0 - z1 / SZ, LON0 + x1 / SX, LAT0 - z0 / SZ)


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), ROOT / 'tools/extension' / f'{name}.py')
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', type=Path, required=True)
    ap.add_argument('--lidar', action='store_true', help='fetch the 2017 LiDAR EPT subset instead of City/OSM vectors')
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    if a.lidar:
        m = load('fetch-downtown-lidar')
        m.BBOX = envelope(-1600, -350, -560, 620)
        sys.argv = [sys.argv[0], '--out', str(a.out)]
        m.main()
        return
    f = load('fetch-downtown')
    bbox = envelope(-1580, -380, -520, 580)
    prov = {'bbox': bbox, 'campusRect': [-1580, -380, -520, 580], 'retrievedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'files': {}}
    for name in ['building-footprints-2023', 'impervious-cover-2023']:
        data, urls = f.query_all(f.LAYERS[name], bbox)
        b = json.dumps(data).encode()
        (a.out / f'{name}.json').write_bytes(b)
        prov['files'][f'{name}.json'] = {'source': f.LAYERS[name], 'queries': len(urls), 'features': len(data['features']), 'sha256': hashlib.sha256(b).hexdigest(), 'copyrightText': data['copyrightText']}
        print(name, len(data['features']), flush=True)
    q = f'[out:json][timeout:90];(way["building"]({bbox[1]},{bbox[0]},{bbox[3]},{bbox[2]});relation["building"]({bbox[1]},{bbox[0]},{bbox[3]},{bbox[2]}););out body geom;'
    b = f.get('https://overpass-api.de/api/interpreter?data=' + urllib.parse.quote(q))
    (a.out / 'osm-buildings.json').write_bytes(b)
    prov['files']['osm-buildings.json'] = {'source': 'OpenStreetMap contributors (ODbL 1.0) via Overpass API', 'query': q, 'sha256': hashlib.sha256(b).hexdigest(), 'elements': len(json.loads(b)['elements'])}
    (a.out / 'provenance.json').write_text(json.dumps(prov, indent=1))
    print('osm', prov['files']['osm-buildings.json']['elements'])


if __name__ == '__main__':
    main()
