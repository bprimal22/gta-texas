#!/usr/bin/env python3
"""Fetch the public source data for the visual-only downtown backdrop (authoring only; nothing here ships).
Same City of Austin layers as fetch-downtown.py (Building Footprints 2023, Impervious Cover 2023, Parks) plus a 2 m
USGS 3DEP bare-earth DEM, for the wider WGS84 box (-97.762, 30.2525, -97.7195, 30.2811). Provenance (queries, sha256,
retrieval time) -> <out>/provenance.json. Promoted from the root review's .work/claude-downtown/fetch-background.py.

Usage (standard library only):  python3 -I tools/extension/fetch-downtown-background.py --out <dir>
"""
import argparse
import datetime
import hashlib
import importlib.util
import json
import urllib.parse
from pathlib import Path

BBOX = (-97.762, 30.2525, -97.7195, 30.2811)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True, type=Path)
    a = ap.parse_args()
    spec = importlib.util.spec_from_file_location('fetch_downtown', Path(__file__).resolve().parent / 'fetch-downtown.py')
    f = importlib.util.module_from_spec(spec); spec.loader.exec_module(f)
    out = a.out; out.mkdir(parents=True, exist_ok=True)
    prov = {'bbox': BBOX, 'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'files': {}}
    for name in ['building-footprints-2023', 'impervious-cover-2023', 'parks']:
        data, urls = f.query_all(f.LAYERS[name], BBOX)
        b = json.dumps(data).encode(); (out / (name + '.json')).write_bytes(b)
        prov['files'][name + '.json'] = {'source': f.LAYERS[name], 'queries': urls, 'features': len(data['features']),
                                         'sha256': hashlib.sha256(b).hexdigest(), 'copyrightText': data['copyrightText']}
        print(name, len(data['features']), flush=True)
    w = round((BBOX[2] - BBOX[0]) * 96126.8 / 2); h = round((BBOX[3] - BBOX[1]) * 110851 / 2)
    q = {'bbox': ','.join(map(str, BBOX)), 'bboxSR': 4326, 'imageSR': 4326, 'size': f'{w},{h}', 'format': 'tiff', 'pixelType': 'F32',
         'noDataInterpretation': 'esriNoDataMatchAny', 'interpolation': 'RSP_BilinearInterpolation',
         'renderingRule': json.dumps({'rasterFunction': 'None'}), 'f': 'json'}
    url = f.DEM + '?' + urllib.parse.urlencode(q)
    info = json.loads(f.get(url))
    if 'href' not in info:
        raise SystemExit(f'DEM export failed: {info}')
    b = f.get(info['href']); (out / 'dem-background.tif').write_bytes(b)
    prov['dem'] = {'service': f.DEM, 'license': 'Public domain (U.S. Government work). Credit: U.S. Geological Survey.',
                   'tiles': [{'file': 'dem-background.tif', 'request': url, 'extent': info['extent'], 'width': info['width'],
                              'height': info['height'], 'sha256': hashlib.sha256(b).hexdigest()}]}
    (out / 'provenance.json').write_text(json.dumps(prov, indent=1))
    print('DEM', len(b), info['width'], info['height'])


if __name__ == '__main__':
    main()
