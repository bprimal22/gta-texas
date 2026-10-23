#!/usr/bin/env python3
"""Stage 2 of the deep-west bake: add the measured City lots, driveways and patios. Authoring only.

tools/extension/bake-deep-west.py drapes only Sidewalk / Trail / Paved Road / Paved Alley / Pavement / Courtyard (its
filtered road-sidewalk-surfaces input never had the other impervious kinds), so 129.6k m2 of City-mapped parking,
driveways and patios inside the deep-west union rendered as lawn. This stage reads the SHIPPED asset
(public/assets/extension/deep-west-v1.bin.gz), keeps its terrain, buildings and every existing surface triangle
byte-identical, and appends the City of Austin Planimetrics 2023 Impervious Cover polygons of
  Paved Driveway -> section surface.Pavement   (concrete, same material / draw call)
  Patio          -> section surface.Courtyard  (courtyard paving, same material / draw call)
  Paved Parking  -> new section surface.Paved Parking (weathered asphalt; +1 draw call)
with exactly the stage-1 rule: clip to the owned union, remove included building footprints and everything already
surfaced (higher priority), per-record difference in priority order, slivers < 0.3 m opened away, split only on
intersecting terrain triangles (STRtree), constrained Delaunay, y = terrain plane + drape (fading to 0 over the
seam zipper strip). Same format / version / checksum scheme; the strict runtime decoder is unchanged.
Idempotent: refuses an asset that already carries stage-2 metadata unless --from points at a stage-1 asset.

Input (read-only): .work/claude-west-campus/raw/impervious-cover-2023.json (MapServer/1, x -1580..-380, z -520..580,
covers the whole union x -1570..-760, z -510..570). Requires numpy + shapely>=2.1. Run:
  python -I tools/extension/bake-deep-west-paving.py [--from <stage-1 asset>]
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import struct
from pathlib import Path

import numpy as np
import shapely
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
ASSET = ROOT / 'public/assets/extension/deep-west-v1.bin.gz'
MANIFEST = ROOT / 'public/assets/extension/deep-west-v1.manifest.json'
RAW = ROOT / '.work/claude-west-campus/raw/impervious-cover-2023.json'
SX, SZ, LON0, LAT0 = 96126.8152981172, 110851.0, -97.73716, 30.2861
MAGIC, VERSION, SEAM_X = 0x57445455, 1, -760.0
# City kind -> section it joins (priority order: earlier wins where City polygons overlap).
STAGE2 = [('Paved Driveway', 'Pavement'), ('Patio', 'Courtyard'), ('Paved Parking', 'Paved Parking')]


def fnv_words(data: bytes) -> int:
    h = 2166136261
    for w in np.frombuffer(data, '<u4').tolist():
        h = ((h ^ w) * 16777619) & 0xFFFFFFFF
    return h


def metric(ring):
    return [((lon - LON0) * SX, (LAT0 - lat) * SZ) for lon, lat, *_ in ring]


def signed_area(r):
    return sum(r[i][0] * r[(i + 1) % len(r)][1] - r[(i + 1) % len(r)][0] * r[i][1] for i in range(len(r))) / 2


def esri_geom(rings):
    ext, holes = [], []
    for r in rings:
        r = metric(r)
        r = r[:-1] if r[0] == r[-1] else r
        if len(r) >= 3:
            (ext if signed_area(r) > 0 else holes).append(r)
    polys = [[e, []] for e in sorted(ext, key=lambda e: abs(signed_area(e)))]
    orphan = 0
    for h in holes:
        hp = Polygon(h)
        t = next((q for q in polys if Polygon(q[0]).contains(hp.representative_point())), None)
        if t:
            t[1].append(h)
        else:
            orphan += 1
    out = [Polygon(e, hs) for e, hs in polys]
    return unary_union([p if p.is_valid else shapely.make_valid(p) for p in out]) if out else Polygon(), orphan


def polygons_of(g):
    if g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    out = []
    for x in getattr(g, 'geoms', []):
        out += polygons_of(x)
    return out


def ring_list(geom, digits=1):
    out = []
    for p in polygons_of(geom):
        if p.area < 1e-4:
            continue
        p = shapely.geometry.polygon.orient(p, 1.0)
        out.append([[[round(x, digits), round(z, digits)] for x, z in list(r.coords)[:-1]] for r in [p.exterior, *p.interiors]])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--from', dest='src', type=Path, default=ASSET)
    ap.add_argument('--raw', type=Path, default=RAW)
    a = ap.parse_args()
    gz = a.src.read_bytes()
    raw = gzip.decompress(gz)
    magic, version, mlen, plen, checksum = struct.unpack_from('<IIIII', raw, 0)
    if magic != MAGIC or version != VERSION or 20 + mlen + plen != len(raw) or fnv_words(raw[20:]) != checksum:
        raise SystemExit('input is not a valid deep-west v1 asset')
    meta = json.loads(raw[20:20 + mlen])
    if 'paving' in meta:
        raise SystemExit('input already carries stage-2 paving; pass --from <stage-1 asset>')
    pay = raw[20 + mlen:]
    arrays = {}
    for s in meta['sections']:
        arrays[s['name']] = np.frombuffer(pay, '<f4' if s['type'] == 'f32' else '<u4', s['count'], s['byteOffset']).copy()
    U = meta['union']
    union_box = box(U['xmin'], U['zmin'], U['xmax'], U['zmax'])
    drape, fade = meta['drape'], meta['drapeFade']

    # Terrain triangles (the render / collider surface), exactly as stage 1 queries them.
    pos = arrays['terrain.position'].astype(np.float64).reshape(-1, 3)
    tris = arrays['terrain.index'].astype(np.int64).reshape(-1, 3)
    P = pos[tris]
    tpolys = shapely.polygons(P[:, :, [0, 2]])
    ttree = shapely.STRtree(tpolys)
    n = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0])
    A, B = -n[:, 0] / n[:, 1], -n[:, 2] / n[:, 1]
    Cc = P[:, 0, 1] - A * P[:, 0, 0] - B * P[:, 0, 2]

    def drape_at(x):
        return drape * np.clip((SEAM_X - np.asarray(x, np.float64)) / fade, 0.0, 1.0)

    # Already surfaced ground (stage-1 sections, exact triangle union) and included footprints.
    existing = []
    for name, v in arrays.items():
        if name.startswith('surface.'):
            t = v.astype(np.float64).reshape(-1, 3, 3)[:, :, [0, 2]]
            p = shapely.polygons(t)
            existing += list(p[shapely.area(p) > 1e-9])
    surfaced = unary_union(existing).buffer(0)
    footprints = unary_union([Polygon(b['rings'][0], b['rings'][1:]).buffer(0) for b in meta['buildings']])
    static = polygons_of(unary_union([surfaced, footprints]))
    static_tree = shapely.STRtree(static)
    src = json.loads(a.raw.read_text())
    rank = {k: i for i, (k, _) in enumerate(STAGE2)}
    recs, kinds_in_union = [], {}
    for f in src['features']:
        kind, oid = f['attributes']['FEATURE'], f['attributes']['OBJECTID']
        if kind not in rank:
            continue
        g, orphan = esri_geom(f['geometry']['rings'])
        if g.is_empty or not g.intersects(union_box):
            continue
        c = g.intersection(union_box)
        if c.area < .01:
            continue
        recs.append({'key': f'coa-impervious-2023:{oid}', 'kind': kind, 'oid': oid, 'geom': c, 'orphanHoles': orphan,
                     'clippedFraction': round(c.area / g.area, 4) if g.area else 0})
        kinds_in_union[kind] = kinds_in_union.get(kind, 0) + c.area
    recs.sort(key=lambda r: (rank[r['kind']], r['oid']))
    pieces, done = [], []
    for r in recs:
        g = r['geom']
        near = [static[i] for i in static_tree.query(g, predicate='intersects')]
        if done:
            tree = shapely.STRtree([d for d in done])
            near += [done[i] for i in tree.query(g, predicate='intersects')]
        piece = g.difference(unary_union(near)) if near else g
        piece = piece.buffer(-.15, join_style='mitre', mitre_limit=3).buffer(.15, join_style='mitre', mitre_limit=3).intersection(piece)
        piece = unary_union([p for p in polygons_of(piece) if p.area >= .25])
        r['pieceArea'] = round(piece.area, 3)
        if piece.is_empty:
            r['status'] = 'fully covered by stage-1 surfaces / included buildings / earlier records, or sliver'
            continue
        r['status'] = 'draped'
        done.extend(polygons_of(piece))
        pieces.append((r['kind'], piece))

    added = {sec: [] for _, sec in STAGE2}
    section_of = dict(STAGE2)
    for kind, piece in pieces:
        for poly in polygons_of(piece):
            cand = ttree.query(poly, predicate='intersects')
            if not len(cand):
                raise SystemExit('surface outside terrain')
            for t, frag in zip(cand, shapely.intersection(tpolys[cand], poly)):
                for fp in polygons_of(frag):
                    if fp.area < 1e-5:
                        continue
                    for tg in polygons_of(shapely.constrained_delaunay_triangles(fp)):
                        c = np.array(tg.exterior.coords)[:3]
                        if abs(signed_area([tuple(v) for v in c])) < 1e-7:
                            continue
                        ys = A[t] * c[:, 0] + B[t] * c[:, 1] + Cc[t] + drape_at(c[:, 0])
                        v = np.column_stack([c[:, 0], ys, c[:, 1]])
                        if np.cross(v[1] - v[0], v[2] - v[0])[1] < 0:
                            v = v[[0, 2, 1]]
                        added[section_of[kind]].append(v)

    # --- rebuild the payload: terrain + every stage-1 section byte-identical, stage-2 triangles appended -------------
    order = [s['name'] for s in meta['sections']]
    if 'surface.Paved Parking' not in order:
        order.append('surface.Paved Parking')
    sections, blobs, offset = [], [], 0
    stage2_tris = {}
    for name in order:
        kind = name[8:] if name.startswith('surface.') else None
        base = arrays.get(name, np.zeros(0, np.float32))
        extra = np.array(added.get(kind, []), np.float32).reshape(-1) if kind in added else np.zeros(0, np.float32)
        if kind in added:
            stage2_tris[kind] = len(extra) // 9
        typ = 'u32' if name == 'terrain.index' else 'f32'
        data = (base.astype('<u4') if typ == 'u32' else np.concatenate([base.astype('<f4'), extra.astype('<f4')])).tobytes()
        if not len(data):
            continue
        sections.append({'name': name, 'type': typ, 'byteOffset': offset, 'count': len(data) // 4})
        blobs.append(data)
        offset += len(data)
    payload = b''.join(blobs)
    for s in sections:  # prefix of every stage-1 section unchanged
        old = next((o for o in meta['sections'] if o['name'] == s['name']), None)
        if old and pay[old['byteOffset']:old['byteOffset'] + old['count'] * 4] != payload[s['byteOffset']:s['byteOffset'] + old['count'] * 4]:
            raise SystemExit(f"stage-1 section {s['name']} changed")
    surf = {s['name'][8:]: s['count'] // 9 for s in sections if s['name'].startswith('surface.')}
    max_x = max(float(np.frombuffer(payload, '<f4', s['count'], s['byteOffset']).reshape(-1, 3)[:, 0].max())
                for s in sections if s['name'].startswith('surface.'))
    if max_x > SEAM_X:
        raise SystemExit(f'surface east of the seam: {max_x}')

    piece_area = {}
    for kind, piece in pieces:
        piece_area[kind] = piece_area.get(kind, 0) + piece.area
    for kind, _ in STAGE2:
        g = unary_union([p for k, p in pieces if k == kind])
        if not g.is_empty:
            meta['map']['surfaces'][kind] = ring_list(g.simplify(.4, preserve_topology=True), 1)
    meta['sections'] = sections
    meta['counts']['surfaceTriangles'] = surf
    meta['paving'] = {'stage': 2, 'generatedBy': 'tools/extension/bake-deep-west-paving.py',
                      'sectionKinds': {'Pavement': ['Pavement', 'Paved Driveway'], 'Courtyard': ['Courtyard', 'Patio'], 'Paved Parking': ['Paved Parking']}}
    meta_bytes = json.dumps(meta, separators=(',', ':')).encode()
    meta_bytes += b' ' * (-len(meta_bytes) % 4)
    body = meta_bytes + payload
    ck = fnv_words(body)
    asset = gzip.compress(struct.pack('<IIIII', MAGIC, VERSION, len(meta_bytes), len(payload), ck) + body, compresslevel=9, mtime=0)
    ASSET.write_bytes(asset)
    sha = hashlib.sha256(asset).hexdigest()

    def tri_area(v):
        if not len(v):
            return 0.0
        t = np.array(v)
        e1, e2 = t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]
        return float(np.abs(e1[:, 0] * e2[:, 2] - e1[:, 2] * e2[:, 0]).sum() / 2)

    manifest = json.loads(MANIFEST.read_text())
    stage1 = manifest.get('stage1Asset') or {'sha256': manifest['assetSha256'], 'checksumFnv1aWords': manifest['checksumFnv1aWords'], 'bytes': len(gz)}
    manifest['stage1Asset'] = stage1
    manifest['assetSha256'], manifest['checksumFnv1aWords'] = sha, ck
    manifest['inputs']['impervious-cover-2023.json (stage 2)'] = {'sha256': hashlib.sha256(a.raw.read_bytes()).hexdigest(), 'file': 'impervious-cover-2023.json',
                                                                  'source': 'https://maps.austintexas.gov/arcgis/rest/services/Shared/PlanimetricsSurvey_1/MapServer/1'}
    manifest['surfaces']['stage2'] = {
        'generatedBy': 'tools/extension/bake-deep-west-paving.py',
        'why': 'stage 1 never draped City parking, driveways or patios (its filtered input lacked those kinds); they rendered as lawn',
        'kindToSection': dict(STAGE2), 'records': len(recs), 'draped': sum(1 for r in recs if r['status'] == 'draped'),
        'cityAreaInUnionByKind': {k: round(v, 1) for k, v in kinds_in_union.items()},
        'pieceAreaByKind': {k: round(v, 1) for k, v in piece_area.items()},
        'drapedAreaBySection': {k: round(tri_area(v), 1) for k, v in added.items()},
        'addedTrianglesBySection': stage2_tris,
        'details': [{k: r[k] for k in ['key', 'kind', 'status', 'pieceArea', 'clippedFraction', 'orphanHoles']} for r in recs],
        'rule': 'stage-1 rule on the shipped terrain: clip to union, minus included footprints and all stage-1 surfaces, per-record difference in priority order (driveway, patio, parking), slivers < 0.3 m opened away, split on intersecting terrain triangles, constrained Delaunay, y = terrain plane + drape fading to 0 over the seam strip',
        'notDraped': 'Median, Uncovered/Covered Deck, pools, Recreation Court/Ball Field, unpaved kinds, Miscellaneous stay lawn',
    }
    manifest['surfaces']['priority'] = manifest['surfaces']['priority'] + [k for k, _ in STAGE2]
    MANIFEST.write_text(json.dumps(manifest, indent=1) + '\n')
    print(json.dumps({'asset': str(ASSET), 'bytes': len(asset), 'stage1Bytes': len(gz), 'sha256': sha, 'checksum': ck,
                      'surfaceTriangles': surf, 'added': stage2_tris, 'pieceArea': manifest['surfaces']['stage2']['pieceAreaByKind'],
                      'draped': manifest['surfaces']['stage2']['drapedAreaBySection'], 'metaBytes': len(meta_bytes)}, indent=1))


if __name__ == '__main__':
    main()
