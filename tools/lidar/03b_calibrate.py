"""Step 3b: freeze the calibration used by later steps (from work/alignment.json)."""
import json
from common import WORK, NOMINAL_Y_OFFSET, load_json
a = load_json(WORK / 'alignment.json')
per = a['horizontal']['perBuilding']
res = a['vertical']['terrainJson']['median']
cal = {
    # median per-building best shift (280 footprints); applied as LiDAR + shift = campus frame
    'shiftX': round(per['medianDx'], 2), 'shiftZ': round(per['medianDz'], 2),
    # residual vs terrain.json is ~0.02 m, i.e. the contract's nominal -165 is confirmed; keep it.
    'campusMinusNavd88m': NOMINAL_Y_OFFSET if abs(res) < 0.1 else NOMINAL_Y_OFFSET + res,
    'measuredMedianResidual': res,
    'crsNote': ('source EPSG:6343 NAD83(2011)/UTM 14N + EPSG:5703 NAVD88 (Geoid12B) metres -> EPSG:6318 lon/lat -> '
                'campus x=(lon+97.73716)*96182.6, z=-(lat-30.2861)*110851; then empirical shift '
                f"dx={per['medianDx']:+.2f} m, dz={per['medianDz']:+.2f} m to match campus.json 2023 footprints; "
                'campus Y = NAVD88 m - 165'),
}
json.dump(cal, open(WORK / 'calibration.json', 'w'), indent=1)
print(cal)
