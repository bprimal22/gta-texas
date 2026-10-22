"""Project the UT TreeKeeper public site layer export to campus metres.

Input : UT TreeKeeper public map service export (GeoJSON, EPSG:4326 points,
        properties site_id + tree_type only), captured 2026-09-06.
Output: public/assets/vegetation/tree-sites.json — every site inside the campus
        bounds as [site_id, x, z, tree_type] (x east, z south, metres, 0.01 m).
Only point positions and the numeric type are used. Types 2/3 are shipped for
coverage only; the game instantiates type 1 sites (enum meaning unpublished).
Usage: python3 tools/vegetation/build_tree_sites.py <geojson> <out.json>
"""
import json, math, sys, hashlib, collections
src, out = sys.argv[1], sys.argv[2]
raw = open(src, 'rb').read()
data = json.loads(raw)
LON0, LAT0 = -97.73716, 30.2861
SX, SZ = 111320 * math.cos(math.radians(LAT0)), 110851
W, N, E, S = -760, -864, 1296, 1536
sites, types_all, types_in = [], collections.Counter(), collections.Counter()
for f in data['features']:
    lon, lat = f['geometry']['coordinates'][:2]
    p = f['properties']; t = p.get('tree_type')
    types_all[t] += 1
    x, z = (lon - LON0) * SX, -(lat - LAT0) * SZ
    if not (W <= x <= E and N <= z <= S): continue
    types_in[t] += 1
    sites.append([p['site_id'], round(x, 2), round(z, 2), t])
sites.sort()
doc = {
  'source': 'UT Austin TreeKeeper public map service (Davey Resource Group), layer UofTAustin_CampusTrees, GeoJSON point export captured 2026-09-06',
  'projection': 'x = (lon + 97.73716) * 111320 * cos(30.2861 deg), z = -(lat - 30.2861) * 110851 (campus metres, x east, z south)',
  'fields': ['site_id', 'x', 'z', 'tree_type'],
  'note': 'Inventory SITE positions. tree_type enum is not published; the vendor documents sites as existing trees, stumps or vacant planting sites. Type 2/3 are kept for coverage only.',
  'counts': {'read': len(data['features']), 'inBounds': len(sites), 'typesAll': dict(sorted((str(k), v) for k, v in types_all.items())),
             'typesInBounds': dict(sorted((str(k), v) for k, v in types_in.items()))},
  'inputSha256': hashlib.sha256(raw).hexdigest(), 'inputBytes': len(raw),
  'sites': sites,
}
open(out, 'w').write(json.dumps(doc, separators=(',', ':')))
print(json.dumps(doc['counts']))
