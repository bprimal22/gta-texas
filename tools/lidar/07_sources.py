"""Step 7: provenance -> public/data/derived/sources.json (raw tile url/bytes/sha256 + derived file hashes)."""
import hashlib
import json

from common import DERIVED, WORK, load_json

man = load_json(WORK / 'extract-manifest.json')
cal = load_json(WORK / 'calibration.json')
al = load_json(WORK / 'alignment.json')


def sha(p):
    h = hashlib.sha256()
    h.update(p.read_bytes())
    return h.hexdigest()


derived = []
for name in ('roofs-lidar.json', 'canopy-trees.json', 'dtm-1m.bin.gz', 'dtm-1m.json'):
    p = DERIVED / name
    if p.exists():
        derived.append({'file': f'public/data/derived/{name}', 'bytes': p.stat().st_size, 'sha256': sha(p),
                        'license': 'Public domain (derived from USGS 3DEP data)'})
out = {
    'dataset': 'USGS Lidar Point Cloud TX_Central_B1_2017 (StratMap 2017 50cm), LAS 2019 delivery',
    'publisher': 'U.S. Geological Survey 3D Elevation Program (3DEP); TNRIS/StratMap acquisition',
    'license': 'Public domain (U.S. Government work, USGS 3DEP). Credit: U.S. Geological Survey.',
    'catalog': 'https://www.sciencebase.gov/catalog/item/5dcbcdc2e4b06957975eccdb (tile 3097433a3; others analogous)',
    'acquisition': '2017-01-28 .. 2017-03-22 (from USGS tile metadata; leaf-off season for deciduous trees)',
    'crs': man['crs'][:200] + '...',
    'calibration': cal,
    'alignment': al,
    'classCountsInCampusBounds': man['classCounts'],
    'rawTiles': man['tiles'],
    'rawTilesShipped': False,
    'derived': derived,
    'tools': 'tools/lidar/01_extract.py .. 07_sources.py (Python 3.13, laspy+lazrs, pyproj, numpy, scipy, shapely, scikit-image)',
}
(DERIVED / 'sources.json').write_text(json.dumps(out, indent=1))
print(json.dumps(derived, indent=1))
