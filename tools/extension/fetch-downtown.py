#!/usr/bin/env python3
"""Fetch the public source data for the downtown Austin extension (authoring only; nothing here ships).

Downloads, with provenance (URL, retrieval time, sha256) written to <out>/provenance.json:
  * City of Austin Planimetrics 2023: Building Footprints 2023 (layer 0), Impervious Cover 2023 (layer 1)
  * City of Austin Environmental_1 layer 6 "Lakes" (Lady Bird Lake shoreline)
  * City of Austin Infrastructure_2 layer 0 "City of Austin Parks"
  * City of Austin Transportation_1 layer 22 "Comprehensive Transportation Network" (street names)
  * City of Austin Environmental_1 layer 5 "Creek Centerlines"
  * USGS 3DEP bare-earth DEM (The National Map elevation ImageServer exportImage, float32 TIFF)

Usage (standard library only):
  python3 -I tools/extension/fetch-downtown.py --out .work/claude-downtown/raw
Re-running overwrites the raw files; the bake records each file's sha256 so a changed upstream is visible.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

# Authoring envelope (WGS84). Campus frame: x = (lon + 97.73716) * 96126.8, z = (30.2861 - lat) * 110851.
# lon -97.7570..-97.7310 -> x ~ -1782..+717 ; lat 30.2745..30.2525 -> z ~ 1286..3725 (incl. south bank band).
BBOX = (-97.7570, 30.2525, -97.7310, 30.2745)
CITY = 'https://maps.austintexas.gov/arcgis/rest/services/Shared'
LAYERS = {
    'building-footprints-2023': f'{CITY}/PlanimetricsSurvey_1/MapServer/0',
    'impervious-cover-2023': f'{CITY}/PlanimetricsSurvey_1/MapServer/1',
    'lakes': f'{CITY}/Environmental_1/MapServer/6',
    'creek-centerlines': f'{CITY}/Environmental_1/MapServer/5',
    'parks': f'{CITY}/Infrastructure_2/MapServer/0',
    'streets-ctn': f'{CITY}/Transportation_1/MapServer/22',
}
DEM = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage'


def get(url: str, tries: int = 4) -> bytes:
    last = None
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'gta-texas-authoring/1 (offline game data bake)'})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 - retried, then re-raised
            last = e
            time.sleep(2 + 3 * k)
    raise SystemExit(f'fetch failed: {url}: {last}')


def query_all(layer: str, envelope=BBOX):
    """All features intersecting the envelope (paged), WGS84 output, every attribute."""
    meta = json.loads(get(layer + '?f=json'))
    page = int(meta.get('maxRecordCount') or 1000)
    features, offset, urls = [], 0, []
    while True:
        q = {
            'f': 'json', 'where': '1=1', 'geometry': ','.join(map(str, envelope)), 'geometryType': 'esriGeometryEnvelope',
            'inSR': 4326, 'spatialRel': 'esriSpatialRelIntersects', 'outFields': '*', 'outSR': 4326,
            'returnGeometry': 'true', 'orderByFields': meta.get('objectIdField') or 'OBJECTID',
            'resultOffset': offset, 'resultRecordCount': page,
        }
        url = layer + '/query?' + urllib.parse.urlencode(q)
        data = json.loads(get(url))
        if 'error' in data:
            raise SystemExit(f'{layer}: {data["error"]}')
        urls.append(url)
        got = data.get('features', [])
        features += got
        if not got or not data.get('exceededTransferLimit'):
            break
        offset += len(got)
    return {'layer': layer, 'name': meta.get('name'), 'description': meta.get('description'),
            'copyrightText': meta.get('copyrightText'), 'fields': meta.get('fields'),
            'spatialReference': meta.get('sourceSpatialReference') or meta.get('extent', {}).get('spatialReference'),
            'sourceHeightModelInfo': meta.get('sourceHeightModelInfo'),
            'editingInfo': meta.get('editingInfo'), 'features': features}, urls


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--dem-size', type=int, default=0, help='DEM pixels across (default ~0.75 m/px)')
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    prov = {'bbox': BBOX, 'retrievedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'files': {}}
    for name, layer in LAYERS.items():
        data, urls = query_all(layer)
        path = out / f'{name}.json'
        raw = json.dumps(data).encode()
        path.write_bytes(raw)
        prov['files'][path.name] = {'source': layer, 'queries': urls, 'features': len(data['features']),
                                    'sha256': hashlib.sha256(raw).hexdigest(), 'copyrightText': data['copyrightText']}
        print(name, len(data['features']))
    # DEM: float32 GeoTIFF in WGS84; ~0.75 m pixels so the 4 m bake can take cell means.
    w = a.dem_size or round((BBOX[2] - BBOX[0]) * 96126.8 / 0.75)
    h = round(w * (BBOX[3] - BBOX[1]) * 110851 / ((BBOX[2] - BBOX[0]) * 96126.8))
    tiles = []
    # The ImageServer caps exports (~4000 px); fetch a grid of sub-images.
    nx, ny = -(-w // 3000), -(-h // 3000)
    for j in range(ny):
        for i in range(nx):
            x0 = BBOX[0] + (BBOX[2] - BBOX[0]) * i / nx
            x1 = BBOX[0] + (BBOX[2] - BBOX[0]) * (i + 1) / nx
            y1 = BBOX[3] - (BBOX[3] - BBOX[1]) * j / ny
            y0 = BBOX[3] - (BBOX[3] - BBOX[1]) * (j + 1) / ny
            tw, th = round(w / nx), round(h / ny)
            q = {'bbox': f'{x0},{y0},{x1},{y1}', 'bboxSR': 4326, 'imageSR': 4326, 'size': f'{tw},{th}', 'format': 'tiff',
                 'pixelType': 'F32', 'noDataInterpretation': 'esriNoDataMatchAny', 'interpolation': 'RSP_BilinearInterpolation',
                 'renderingRule': json.dumps({'rasterFunction': 'None'}), 'f': 'json'}
            url = DEM + '?' + urllib.parse.urlencode(q)
            info = json.loads(get(url))
            if 'href' not in info:
                raise SystemExit(f'DEM export failed: {info}')
            tif = get(info['href'])
            name = f'dem-{j}-{i}.tif'
            (out / name).write_bytes(tif)
            tiles.append({'file': name, 'request': url, 'extent': info.get('extent'), 'width': info.get('width'),
                          'height': info.get('height'), 'sha256': hashlib.sha256(tif).hexdigest()})
            print(name, info.get('width'), info.get('height'))
    prov['dem'] = {'service': DEM, 'license': 'Public domain (U.S. Government work). Credit: U.S. Geological Survey.',
                   'tiles': tiles}
    (out / 'provenance.json').write_text(json.dumps(prov, indent=1))


if __name__ == '__main__':
    main()
