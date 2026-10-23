"""Second half of tools/extension/bake-downtown.py: buildings, ground classes, trees, bridges, water, chunks, asset.
Imported by bake-downtown.py only (shares its constants through `g`)."""
from __future__ import annotations

import gzip
import hashlib
import json
import math
from pathlib import Path

import numpy as np
import shapely
from PIL import Image, ImageDraw
from scipy import ndimage
from shapely.geometry import MultiPolygon, Point, Polygon, box
from shapely.ops import unary_union
from skimage.measure import find_contours

LIDAR_RES = 2.0
TIER_MIN_CELLS = 15          # 60 m2 at 2 m
TIER_GAP = 3.0               # metres between distinct roof levels
LIDAR_ROOF_CLASSES = (1, 6)
BRIDGE_CLASSES = (1, 13, 17)
DECK_THICKNESS = 1.4


def stable(n) -> int:
    h = 2166136261
    for b in str(n).encode():
        h = ((h ^ b) * 16777619) & 0xFFFFFFFF
    return h


def run(a, prov, dem, xs, zs, H, seam_info, water, main, inlets, play, context, g):
    polygons_of, rings_of = g['polygons_of'], g['rings_of']
    XMIN, XMAX, ZMIN, ZMAX, STEP = g['XMIN'], g['XMAX'], g['ZMIN'], g['ZMAX'], g['STEP']
    US_FOOT, WATER_Y = g['US_FOOT'], g['WATER_Y']
    gh = lambda x, z: g['grid_height'](xs, zs, H, x, z)
    rect = box(XMIN, ZMIN, XMAX, ZMAX)
    inputs = {}

    def load(path: Path):
        b = path.read_bytes()
        inputs[path.name] = hashlib.sha256(b).hexdigest()
        return json.loads(b)

    # ------------------------------------------------------------------ LiDAR rasters
    lid = np.load(a.lidar)
    inputs[a.lidar.name] = hashlib.sha256(a.lidar.read_bytes()).hexdigest()
    lx, lz, le, lc = lid['x'].astype(np.float64), lid['z'].astype(np.float64), lid['elevation_navd88_m'].astype(np.float64) + g['NAVD_TO_CAMPUS'], lid['classification']
    ZR0 = ZMIN - 250.0   # raster reaches north of the seam for buildings stitched across it
    inr = (lx >= XMIN) & (lx < XMAX) & (lz >= ZR0) & (lz < ZMAX)
    lx, lz, le, lc = lx[inr], lz[inr], le[inr], lc[inr]
    lground = np.where(lz >= ZMIN, gh(lx, lz), dem(lx, lz))
    lh = le - lground
    RW, RH = int((XMAX - XMIN) / LIDAR_RES), int((ZMAX - ZR0) / LIDAR_RES)
    ci = np.clip(((lx - XMIN) / LIDAR_RES).astype(int), 0, RW - 1)
    cj = np.clip(((lz - ZR0) / LIDAR_RES).astype(int), 0, RH - 1)

    def max_raster(mask):
        r = np.full(RH * RW, -np.inf)
        np.maximum.at(r, (cj[mask] * RW + ci[mask]), lh[mask])
        r = r.reshape(RH, RW)
        r[~np.isfinite(r)] = np.nan
        return r

    roof_r = max_raster(np.isin(lc, LIDAR_ROOF_CLASSES) & (lh > 1.5))
    veg_r = max_raster((lc == 5) & (lh > 2.0))

    # ------------------------------------------------------------------ sources
    fp = load(a.raw / 'building-footprints-2023.json')
    shm = fp.get('sourceHeightModelInfo') or {}
    if shm.get('heightUnit') != 'us-foot':
        raise SystemExit('Footprint heights are not declared in US survey feet')
    osm = load(a.osm)
    landmarks_doc = load(g['LIB'] / 'landmarks.json')
    imp = load(a.raw / 'impervious-cover-2023.json')
    parks = load(a.raw / 'parks.json')

    # Seam stitching: b14 (Capitol strip) generated north fragments of City footprints clipped at z=1535.95 inside the
    # open seam span. Downtown owns the whole City footprint (one roof, one facade, one collider) and the game marks
    # the b14 fragment replaced (blocks/context-hooks BLOCK_REPLACES) only after this asset decoded and built.
    b14 = json.loads((g['ROOT'] / 'lib/campus/blocks/b14-capitol/context.json').read_text())
    inputs['b14-context.json'] = hashlib.sha256((g['ROOT'] / 'lib/campus/blocks/b14-capitol/context.json').read_bytes()).hexdigest()
    seam_frag = {}
    for add in b14['add']:
        zs_ = [q[1] for r in add['rings'] for q in r]
        xs_ = [q[0] for r in add['rings'] for q in r]
        m_ = __import__('re').search(r'OBJECTID (\d+)', add['evidence']['source'])
        if m_ and max(zs_) > g['SEAM_Z'] - .1 and min(xs_) < g['SEAM_X1'] and max(xs_) > g['SEAM_X0']:
            seam_frag[int(m_.group(1))] = {'key': f'{add["id"]}:add', 'b14Height': add['h']}
    stitch_box = box(XMIN, ZMIN - 250, XMAX, ZMAX)
    city = []
    for f in fp['features']:
        at = f['attributes']
        if at['MAX_HEIGHT'] is None or at['MAX_HEIGHT'] <= 0:
            continue
        stitched = seam_frag.get(at['OBJECTID'])
        for k, p in enumerate(g['poly_from_esri'](f['geometry']['rings'])):
            if stitched and p.intersects(rect) and p.bounds[1] < ZMIN:
                stitched['crossesSeam'] = True
            p = p.intersection(stitch_box if stitched and p.bounds[1] < ZMIN and p.intersects(rect) else rect)
            for q in polygons_of(p):
                if q.area < 8:
                    continue
                rec = {'key': f'coa:{at["OBJECTID"]}' + (f':{k}' if k else ''), 'src': 'coa2023', 'id': at['OBJECTID'],
                       'poly': q, 'h': at['MAX_HEIGHT'] * US_FOOT}
                if stitched and q.bounds[1] < ZMIN:
                    rec['replaces'] = stitched['key']
                city.append(rec)
    osm_polys = []
    for el in osm['elements']:
        if el['type'] != 'way' or 'geometry' not in el:
            continue
        t = el.get('tags', {})
        pts = [tuple(map(float, g['xy'](n['lon'], n['lat']))) for n in el['geometry']]
        if len(pts) < 4:
            continue
        p = Polygon(pts).buffer(0)
        if p.is_empty or not p.intersects(rect):
            continue
        def num(v):
            try:
                return float(str(v).split()[0].replace('m', ''))
            except Exception:
                return None
        osm_polys.append({'id': el['id'], 'poly': p, 'tags': t, 'height': num(t.get('height')),
                          'levels': num(t.get('building:levels')), 'part': 'building:part' in t and 'building' not in t})
    osm_tree = shapely.STRtree([o['poly'] for o in osm_polys])

    def osm_overlap(p):
        best, area = None, 0.0
        for i in osm_tree.query(p):
            o = osm_polys[i]
            if o['part']:
                continue
            ar = o['poly'].intersection(p).area
            if ar > area:
                best, area = o, ar
        return best if best and area > .4 * min(p.area, best['poly'].area) else None

    # ------------------------------------------------------------------ landmarks + post-2023 reconciliation
    city_tree = shapely.STRtree([c['poly'] for c in city])
    removed, added, report = set(), [], []
    def claim(poly, why):
        hits = []
        for i in city_tree.query(poly):
            c = city[i]
            if c['key'] in removed:
                continue
            ov = c['poly'].intersection(poly).area
            if ov > .3 * c['poly'].area or ov > .5 * poly.area:
                removed.add(c['key'])
                hits.append({'key': c['key'], 'heightM': round(c['h'], 1), 'overlap': round(ov / c['poly'].area, 2)})
        return hits
    osm_by_id = {o['id']: o for o in osm_polys}
    landmark_keys = set()
    city_landmark = {}
    for lm in landmarks_doc['landmarks']:
        o = osm_by_id.get(lm['osm'])
        if not o:
            raise SystemExit(f'Landmark {lm["key"]} OSM way {lm["osm"]} missing from the OSM extract')
        landmark_keys.add(lm['osm'])
        outline = o['poly'].intersection(rect)
        if lm.get('base') == 'city-lidar':
            hits = []
            for i in city_tree.query(outline):
                c = city[i]
                if c['poly'].intersection(outline).area > .3 * c['poly'].area:
                    city_landmark[c['key']] = lm['key']; hits.append(c['key'])
            if not hits:
                raise SystemExit(f'Landmark {lm["key"]}: no City footprint under the OSM outline')
            report.append({'landmark': lm['key'], 'osm': lm['osm'], 'base': 'city-lidar', 'city': hits, 'heightM': lm['heightM']})
            continue
        hits = claim(outline, 'landmark')
        added.append({'key': f'lm:{lm["key"]}', 'src': 'landmark', 'id': lm['osm'], 'poly': outline, 'h': lm['heightM'],
                      'landmark': lm['key'], 'name': lm['name']})
        report.append({'landmark': lm['key'], 'osm': lm['osm'], 'base': 'sections', 'replacedCity': hits, 'heightM': lm['heightM']})
    for oh in landmarks_doc.get('osmHeights', []):
        if oh['osm'] in osm_by_id:
            osm_by_id[oh['osm']]['height'] = oh['heightM']; osm_by_id[oh['osm']]['heightSource'] = oh['source']
    stale = []
    for o in osm_polys:
        if o['part'] or o['id'] in landmark_keys:
            continue
        h = o['height'] or ((o['levels'] or 0) * 3.4 if (o['levels'] or 0) >= 15 else None)
        if not h or h < 45:
            continue
        cityh = max([city[i]['h'] for i in city_tree.query(o['poly']) if city[i]['poly'].intersection(o['poly']).area > .3 * city[i]['poly'].area] or [0])
        if h > cityh + 15:   # built/topped out after the 2023 aerials (or under construction then)
            poly = o['poly'].intersection(rect)
            hits = claim(poly, 'osm-newer')
            added.append({'key': f'osm:{o["id"]}', 'src': 'osm', 'id': o['id'], 'poly': poly, 'h': h,
                          'name': o['tags'].get('name', '')})
            stale.append({'osm': o['id'], 'name': o['tags'].get('name', ''), 'osmHeightM': round(h, 1),
                          'heightBasis': 'osm height tag' if o['height'] else 'osm levels x 3.4 m', 'city2023MaxM': round(cityh, 1), 'replacedCity': hits})
    buildings = [c for c in city if c['key'] not in removed] + added

    # ------------------------------------------------------------------ per-building ground, tiers, style
    def ground_of(p):
        pts = np.array(p.exterior.coords)
        inner = [p.representative_point().coords[0]]
        s = np.vstack([pts, inner])
        y = np.where(s[:, 1] >= ZMIN, gh(s[:, 0], s[:, 1]), dem(s[:, 0], s[:, 1]))
        return float(y.min()), float(y.max())

    def cells_of(p):
        x0, z0, x1, z1 = p.bounds
        i0, i1 = max(0, int((x0 - XMIN) / LIDAR_RES)), min(RW - 1, int((x1 - XMIN) / LIDAR_RES) + 1)
        j0, j1 = max(0, int((z0 - ZR0) / LIDAR_RES)), min(RH - 1, int((z1 - ZR0) / LIDAR_RES) + 1)
        if i1 < i0 or j1 < j0:
            return None
        cx = XMIN + (np.arange(i0, i1 + 1) + .5) * LIDAR_RES
        cz = ZR0 + (np.arange(j0, j1 + 1) + .5) * LIDAR_RES
        X, Z = np.meshgrid(cx, cz)
        m = shapely.contains_xy(p.buffer(-.5) if p.area > 40 else p, X, Z)
        return (slice(j0, j1 + 1), slice(i0, i1 + 1)), m, cx[0], cz[0]

    def mask_polys(mask, x0, z0):
        pad = np.pad(mask.astype(float), 1)
        out = Polygon()
        for c in find_contours(pad, .5):
            pts = [(x0 + (q[1] - 1) * LIDAR_RES, z0 + (q[0] - 1) * LIDAR_RES) for q in c]
            if len(pts) >= 4:
                out = out.symmetric_difference(Polygon(pts).buffer(0))
        return out.buffer(0)

    tier_stats = {'lidarTiered': 0, 'single': 0, 'stale': 0, 'noLidar': 0}

    def tiers_for(b):
        p, hc = b['poly'], b['h']
        if b['src'] != 'coa2023':
            return [(p, hc)], 'osm'
        cm = cells_of(p)
        if not cm:
            tier_stats['noLidar'] += 1
            return [(p, hc)], 'coa'
        sl, m, x0, z0 = cm
        r = roof_r[sl]
        v = r[m]
        if m.sum() < 6 or np.isfinite(v).mean() < .3:
            tier_stats['noLidar'] += 1
            return [(p, hc)], 'coa'
        top = float(np.nanpercentile(v, 99))
        if abs(top - hc) > max(6.0, .15 * hc):
            if not b.get('replaces'):
                tier_stats['stale'] += 1
                return [(p, hc)], 'coa-lidar-disagrees'
            # Seam-stitched (pre-2017, b14-reviewed) buildings: the 2017 LiDAR wins, as in the b14 block's evidence.
            hc = top
            b['h'] = hc
        filled = r.copy()
        bad = ~np.isfinite(filled)
        if bad.any():
            idx = ndimage.distance_transform_edt(bad, return_distances=False, return_indices=True)
            filled = filled[tuple(idx)]
        filled = ndimage.median_filter(filled, 3)
        vals = np.sort(filled[m])
        clusters, start = [], 0
        for k in range(1, len(vals) + 1):
            if k == len(vals) or vals[k] - vals[k - 1] > TIER_GAP * .5:
                clusters.append(vals[start:k]); start = k
        # Merge clusters closer than TIER_GAP and drop small ones into the cluster below.
        levels = []
        for c in clusters:
            if levels and (c[0] - levels[-1][-1] < TIER_GAP or len(c) < TIER_MIN_CELLS):
                levels[-1] = np.concatenate([levels[-1], c])
            else:
                levels.append(c)
        if len(levels) > 1 and len(levels[0]) < TIER_MIN_CELLS:
            levels[1] = np.concatenate([levels[0], levels[1]]); levels.pop(0)
        levels = levels[-4:] if len(levels) > 4 else levels
        if len(levels) == 1:
            tier_stats['single'] += 1
            return [(p, hc)], 'coa+lidar'
        out = []
        for k, lv in enumerate(levels):
            ht = float(np.percentile(lv, 90)) if k < len(levels) - 1 else hc
            if k == 0:
                out.append((p, ht)); continue
            tp = mask_polys(m & (filled >= lv[0] - .25), x0 - LIDAR_RES / 2, z0 - LIDAR_RES / 2)
            tp = tp.simplify(1.0, preserve_topology=True).buffer(0).intersection(p)
            tp = unary_union([q for q in polygons_of(tp) if q.area >= 40])
            if tp.is_empty:
                continue
            out.append((tp, ht))
        tier_stats['lidarTiered'] += 1 if len(out) > 1 else 0
        return out, 'coa+lidar-tiers'

    def osm_kind(p):
        o = osm_overlap(p)
        if not o:
            return None, ''
        return o['tags'].get('building'), o['tags'].get('name', '')

    lm_by_key = {lm['key']: lm for lm in landmarks_doc['landmarks']}
    palettes = landmarks_doc['palettes']

    def pick(pal, h):
        opts = palettes[pal]
        return opts[h % len(opts)]

    def style_for(b, tier_top, top, is_tower_base, kind, h):
        """Facade code + colours. ESTIMATED (rule-based from height, OSM building tag and photo-derived palettes)."""
        if kind in ('parking',) or (is_tower_base and kind not in ('church',)):
            return {'f': 'garage' if kind == 'parking' else 'podium', **pick('podium', h)}
        if top >= 45:
            if kind in ('apartments', 'residential', 'hotel', 'dormitory'):
                return {'f': 'balcony', **pick('residentialGlass', h)}
            if b['src'] == 'osm':
                return {'f': 'balcony', **pick('residentialGlass', h)}
            # Pre-2000 offices (LiDAR-tiered stepped tops) read as granite/precast punched; newer as glass.
            return {'f': 'curtain', **pick('officeGlass', h)} if h % 5 < 3 else {'f': 'punched', **pick('granite', h)}
        if top >= 16:
            return {'f': 'punched', **pick('midrise', h)} if h % 3 else {'f': 'ribbon', **pick('midrise', h)}
        return {'f': 'historic', **pick('historic', h)}

    def obb(poly):
        r = poly.minimum_rotated_rectangle
        c = np.array(r.exterior.coords)[:4]
        e0, e1 = c[1] - c[0], c[2] - c[1]
        l0, l1 = np.linalg.norm(e0), np.linalg.norm(e1)
        u = e0 / l0 if l0 >= l1 else e1 / l1
        # Deterministic axis sign: long axis points to +x (or +z when vertical).
        if u[0] < -1e-9 or (abs(u[0]) < 1e-9 and u[1] < 0):
            u = -u
        v = np.array([-u[1], u[0]])
        return np.mean(c, axis=0), u, v, max(l0, l1), min(l0, l1)

    def rect_poly(cen, u, v, L, W, du=0.0, dv=0.0):
        c = cen + u * du + v * dv
        return Polygon([tuple(c + u * su * L / 2 + v * sv * W / 2) for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1))])

    def landmark_tiers(b, lm):
        outline = b['poly']
        cen, u, v, L, W = obb(outline)
        g0 = b['ground'][0]
        tiers = []
        for sec in lm['sections']:
            spec = sec['poly']
            if spec == 'outline':
                poly = outline
            elif 'osm' in spec:
                poly = osm_by_id[spec['osm']]['poly']
                if spec.get('inset'):
                    poly = poly.buffer(-spec['inset'], join_style=2)
            elif 'rect' in spec:
                poly = rect_poly(cen, u, v, spec['rect'][0], spec['rect'][1], *spec.get('offset', [0, 0]))
            else:
                poly = outline.buffer(-spec['inset'], join_style=2)
            poly = poly.buffer(0)
            base = {'f': sec['f'], 'w': sec['w'], 'a': sec['a']}
            if 'from' in sec:
                base['b'] = round(g0 + sec['from'], 2)
            if 'sail' in sec:
                # Terraced sail: strips across `axis`; height rises low -> to with s**pow, peak on the +axis side
                # (dir 1) or the -axis side (dir -1). Each strip is one terrace (one tier).
                sl = sec['sail']
                pc, pu, pv, pL, pW = obb(poly)
                ax, other, ext = (pv, pu, pW) if sl['axis'] == 'short' else (pu, pv, pL)
                n = max(2, int(math.ceil(ext / sl['step'])))
                for k in range(n):
                    t0, t1 = -ext / 2 + ext * k / n, -ext / 2 + ext * (k + 1) / n
                    sc = (k + 1) / n if sl['dir'] > 0 else (n - k) / n
                    hgt = sl['low'] + (sec['to'] - sl['low']) * sc ** sl['pow']
                    strip = Polygon([tuple(pc + ax * t0 - other * 500), tuple(pc + ax * t1 - other * 500),
                                     tuple(pc + ax * t1 + other * 500), tuple(pc + ax * t0 + other * 500)])
                    for q in polygons_of(poly.intersection(strip)):
                        if q.area > 2:
                            tiers.append({**base, 'r': rings_of(q), 'y': round(g0 + hgt, 2)})
                continue
            if 'chamfer' in sec:
                ch = sec['chamfer']
                pc, pu, pv, pL, pW = obb(poly)
                ax = pv if ch['axis'] == 'short' else pu
                ext = pW if ch['axis'] == 'short' else pL
                ax = ax * ch['dir']
                hi, lo = g0 + sec['to'], g0 + ch['low']
                # top(x,z) = lo + (hi-lo) * ((p - pc).ax + ext/2) / ext  -> plane coefficients
                k = (hi - lo) / ext
                cst = lo + k * (ext / 2 - float(np.dot(pc, ax)))
                base['pl'] = [round(float(k * ax[0]), 6), round(float(k * ax[1]), 6), round(float(cst), 4)]
            for q in polygons_of(poly):
                tiers.append({**base, 'r': rings_of(q), 'y': round(g0 + sec['to'], 2)})
        return tiers

    def fit_height(lm, tiers, g0):
        """Height policy: lm['heightM'] is the published OVERALL height (architectural top incl. crown/spire/mast) above
        the lowest terrain under the footprint. A crown spans [base, overall]: base = min(body top, overall - nominal
        crown) for spires/fins/masts, overall - nominal for frames/parapets; the body is clamped to the crown base.
        Without a crown the top tier is set to the overall height. Returns the crown (or None)."""
        overall = round(g0 + lm['heightM'], 2)
        cr = lm.get('crown')
        if not cr:
            ymax = max(t['y'] for t in tiers)
            for t in tiers:
                if t['y'] >= ymax - 1e-6 or t['y'] > overall:
                    t['y'] = overall
            return None
        body = max(t['y'] for t in tiers)
        fixed = cr['type'] in ('frame', 'parapet')
        base = round(overall - cr['height'] if fixed else min(body, overall - cr['height']), 2)
        for t in tiers:
            if t['y'] > base:
                t['y'] = base
            if t.get('b') is not None and t['b'] >= t['y'] - .5:
                t['b'] = round(t['y'] - .5, 2)
        top = max(tiers, key=lambda t: (t['y'], Polygon(t['r'][0]).area))
        pc, pu, pv, pL, pW = obb(Polygon(top['r'][0]))
        return {'type': cr['type'], 'h': round(overall - base, 2), 'color': cr['color'], 'c': [round(float(pc[0]), 2), round(float(pc[1]), 2)],
                'u': [round(float(pu[0]), 5), round(float(pu[1]), 5)], 'L': round(float(pL), 2), 'W': round(float(pW), 2), 'y': base}

    out_buildings = []
    for b in sorted(buildings, key=lambda b: b['key']):
        p = b['poly']
        if p.is_empty:
            continue
        b['ground'] = ground_of(p)
        lmk = b.get('landmark') or city_landmark.get(b['key'])
        lm = lm_by_key.get(lmk) if lmk else None
        if lm and b['src'] == 'landmark':
            ltiers = landmark_tiers(b, lm)
            rec = {'k': b['key'], 'src': 'landmark', 'id': b['id'], 'g': [round(b['ground'][0], 2), round(b['ground'][1], 2)],
                   'basis': 'reference-sections', 'kind': '', 'name': lm['name'], 'tiers': ltiers, 'lm': lm['key'],
                   'crown': fit_height(lm, ltiers, b['ground'][0]), 'visual': not play.buffer(.5).intersects(p)}
            out_buildings.append(rec)
            continue
        tiers, basis = tiers_for(b)
        top = max(t[1] for t in tiers)
        kind, name = osm_kind(p)
        hsh = stable(b['key'])
        rec = {'k': b['key'], 'src': b['src'], 'id': b['id'], 'g': [round(b['ground'][0], 2), round(b['ground'][1], 2)],
               'basis': basis, 'kind': kind or '', 'name': b.get('name') or name, 'tiers': []}
        if b.get('replaces'):
            rec['replaces'] = b['replaces']
        tall = top >= 60
        for k, (tp, ht) in enumerate(sorted(tiers, key=lambda t: t[1])):
            y = round(b['ground'][0] + ht, 2)
            podium = tall and k == 0 and len(tiers) > 1 and ht < .45 * top
            for q in polygons_of(tp):
                if lm:
                    st = dict(lm['podium'] if podium else lm['tower'])
                else:
                    st = style_for(b, ht, top, podium, kind, hsh)
                t = {'r': rings_of(q), 'y': y}
                t.update(st)
                rec['tiers'].append(t)
        if lm:
            rec['lm'] = lm['key']; rec['name'] = lm['name']
            # Only the landmark's main (tallest) City record carries the published height and crown.
            if top >= .6 * lm['heightM']:
                crown = fit_height(lm, rec['tiers'], b['ground'][0])
                if crown:
                    rec['crown'] = crown
                rec['heightPolicy'] = 'overall'
        rec['visual'] = not play.buffer(.5).intersects(p)
        out_buildings.append(rec)
    print('buildings', len(out_buildings), 'removed city', len(removed), 'added', len(added), tier_stats)
    # Landmark tops (tiers + crown) must equal the published overall height they cite.
    lm_tops = {}
    for r in out_buildings:
        if not r.get('lm') or (r['src'] != 'landmark' and not r.get('heightPolicy')):
            continue
        t = max([x['y'] for x in r['tiers']] + ([r['crown']['y'] + r['crown']['h']] if r.get('crown') else [])) - r['g'][0]
        lm_tops[r['lm']] = round(t, 2)
    for lm in landmarks_doc['landmarks']:
        if abs(lm_tops.get(lm['key'], -1) - lm['heightM']) > .05:
            raise SystemExit(f'Landmark {lm["key"]} top {lm_tops.get(lm["key"])} != published overall {lm["heightM"]}')
    report.append({'landmarkTopsM': lm_tops})

    # ------------------------------------------------------------------ ground class map
    R = g['Raster']()
    for f in parks['features']:
        for p in g['poly_from_esri'](f['geometry']['rings']):
            R.paint(p.intersection(rect), g['C_PARK'])
    by_class = {}
    bridges_src = []
    for f in imp['features']:
        feat = f['attributes'].get('FEATURE')
        if feat == 'Bridge':
            bridges_src += [{'oid': f['attributes']['OBJECTID'], 'poly': p} for p in g['poly_from_esri'](f['geometry']['rings'])]
            continue
        cls = g['IMPERVIOUS_CLASS'].get(feat)
        if cls is None:
            continue
        by_class.setdefault(cls, []).extend(g['poly_from_esri'](f['geometry']['rings']))
    for cls in g['PAINT_ORDER']:
        for p in by_class.get(cls, []):
            if p.intersects(rect):
                R.paint(p.intersection(rect), cls)
    for b in out_buildings:
        for t in b['tiers'][:1]:
            pass
    for bb in buildings:
        R.paint(bb['poly'], g['C_FOOTPRINT'])
    R.paint(water, g['C_WATER'])
    classmap = R.a

    # ------------------------------------------------------------------ trees (LiDAR canopy peaks)
    vr = np.nan_to_num(veg_r, nan=0.0)
    sm = ndimage.gaussian_filter(vr, 1.0)
    peaks = (sm == ndimage.maximum_filter(sm, size=5)) & (vr > 4.0)
    pj, pi = np.nonzero(peaks)
    trees = []
    blds = shapely.STRtree([bb['poly'] for bb in buildings])
    for j, i in zip(pj, pi):
        x, z = XMIN + (i + .5) * LIDAR_RES, ZR0 + (j + .5) * LIDAR_RES
        if z < ZMIN + 1:
            continue
        h = float(vr[j, i])
        if h > 30:
            continue
        cls = classmap[min(classmap.shape[0] - 1, int(z - ZMIN)), min(classmap.shape[1] - 1, int(x - XMIN))]
        if cls in (g['C_ASPHALT'], g['C_WATER'], g['C_FOOTPRINT']):
            continue
        pt = Point(x, z)
        if any(buildings[k]['poly'].distance(pt) < 1.2 for k in blds.query(pt.buffer(2))):
            continue
        # Crown radius: extent of canopy above 60 % of the peak height, capped.
        win = vr[max(0, j - 4):j + 5, max(0, i - 4):i + 5]
        rad = max(1.8, min(7.0, math.sqrt((win > .6 * h).sum() * LIDAR_RES * LIDAR_RES / math.pi)))
        y = float(gh(x, z))
        trees.append((x, y, z, h, rad, 1.0 if play.contains(pt) else 0.0))
    trees.sort()
    print('trees', len(trees), 'playable', sum(1 for t in trees if t[5]))

    # ------------------------------------------------------------------ bridges (City 'Bridge' polygons, LiDAR decks)
    bmask = np.isin(lc, BRIDGE_CLASSES) & (lh > 1.0)
    bx, bz, be = lx[bmask], lz[bmask], le[bmask]
    btree_pts = shapely.points(bx, bz)
    bridge_tris, bridge_col, bridge_report = [], [], []
    for br in sorted(bridges_src, key=lambda b: b['oid']):
        p = br['poly'].intersection(rect)
        for q in polygons_of(p):
            if q.area < 30:
                continue
            inside = shapely.contains(q.buffer(1.0), btree_pts)
            if inside.sum() < 8:
                bridge_report.append({'oid': br['oid'], 'skipped': 'no deck returns'}); continue
            px, pz, pe = bx[inside], bz[inside], be[inside]
            # Robust deck surface: per-point upper envelope in 6 m neighbourhoods (median of the top half).
            tris = shapely.constrained_delaunay_triangles(q.simplify(.3))
            water_frac = q.intersection(main).area / q.area
            collide = water_frac < .05
            def deck(x, z):
                d2 = (px - x) ** 2 + (pz - z) ** 2
                k = np.argsort(d2)[:24]
                return float(np.median(pe[k][pe[k] >= np.median(pe[k])]))
            for tri in polygons_of(tris):
                cs = list(tri.exterior.coords)[:3]
                top = [(x, deck(x, z), z) for x, z in cs]
                centroid = Point(sum(c[0] for c in cs) / 3, sum(c[1] for c in cs) / 3)
                col = collide or play.contains(centroid)
                bridge_tris.append(top); bridge_col.append(1 if col else 0)
            # Fascia (deck edge) around the outline, 1.4 m deep.
            ring = list(shapely.geometry.polygon.orient(q.simplify(.3), 1.0).exterior.coords)
            for (x0, z0), (x1, z1) in zip(ring, ring[1:]):
                y0, y1 = deck(x0, z0), deck(x1, z1)
                quad = [(x0, y0, z0), (x1, y1, z1), (x1, y1 - DECK_THICKNESS, z1), (x0, y0 - DECK_THICKNESS, z0)]
                mid = Point((x0 + x1) / 2, (z0 + z1) / 2)
                col = 1 if (collide or play.contains(mid)) else 0
                bridge_tris += [[quad[0], quad[2], quad[1]], [quad[0], quad[3], quad[2]]]; bridge_col += [col, col]
            bridge_report.append({'oid': br['oid'], 'areaM2': round(q.area), 'deckReturns': int(inside.sum()),
                                  'overWater': round(water_frac, 2), 'collidable': 'all' if collide else 'playable part'})
    print('bridges', sum(1 for r in bridge_report if 'skipped' not in r), 'triangles', len(bridge_tris))

    # ------------------------------------------------------------------ City Lakes cross-check (not used for geometry)
    lakes = load(a.raw / 'lakes.json')
    lake_poly = unary_union([q for f in lakes['features'] for q in g['poly_from_esri'](f['geometry']['rings'])]).buffer(0).intersection(rect)
    inter = water.intersection(lake_poly).area
    lake_check = {'source': 'City of Austin Environmental_1/6 Lakes (SOURCE 2003)', 'cityLakeAreaM2': round(lake_poly.area),
                  'demWaterAreaM2': round(water.area), 'intersectionOverUnion': round(inter / max(1, water.union(lake_poly).area), 3),
                  'meanShoreOffsetM': round(water.symmetric_difference(lake_poly).area / max(1, water.boundary.length), 2),
                  'use': 'cross-check only; geometry = DEM hydro-flattened contour'}
    print('lakes check', lake_check)
    # ------------------------------------------------------------------ water surface
    water_tris = []
    wpoly = water.simplify(.5, preserve_topology=True).buffer(0)
    for tri in polygons_of(shapely.constrained_delaunay_triangles(wpoly)):
        water_tris.append([(x, WATER_Y + .12, z) for x, z in list(tri.exterior.coords)[:3]])

    # ------------------------------------------------------------------ terrain cells (render / collide)
    nx, nz = len(xs), len(zs)
    cx = (xs[:-1] + STEP / 2)
    cz = (zs[:-1] + STEP / 2)
    CX, CZ = np.meshgrid(cx, cz)
    flags = np.ones((nz - 1, nx - 1), np.uint8)               # bit0 render
    play_buf = play.buffer(STEP * 1.5)
    collide = shapely.contains_xy(play_buf, CX, CZ)
    flags |= (collide.astype(np.uint8) << 1)                  # bit1 collide (playable +6 m)
    # Hide cells fully inside a building (+ 0 m) and lake bed far from shore.
    allb = unary_union([bb['poly'].buffer(-.05) for bb in buildings])
    inner = shapely.contains_xy(allb, CX - STEP / 2, CZ - STEP / 2) & shapely.contains_xy(allb, CX + STEP / 2, CZ - STEP / 2) & \
        shapely.contains_xy(allb, CX - STEP / 2, CZ + STEP / 2) & shapely.contains_xy(allb, CX + STEP / 2, CZ + STEP / 2) & \
        shapely.contains_xy(allb, CX, CZ)
    deep = shapely.contains_xy(water.buffer(-12), CX, CZ)
    flags[inner | deep] &= ~np.uint8(1)
    flags[inner] &= ~np.uint8(2)

    # ------------------------------------------------------------------ walls / barriers
    walls = g['wall_segments'](play)
    barriers = []
    for p in polygons_of(inlets):
        cs = list(p.exterior.coords)
        for (ax, az), (bx_, bz_) in zip(cs, cs[1:]):
            mid = Point((ax + bx_) / 2, (az + bz_) / 2)
            if play.buffer(-.5).contains(mid):
                barriers.append([round(ax, 2), round(az, 2), round(bx_, 2), round(bz_, 2)])

    # ------------------------------------------------------------------ chunks
    CH = g['CHUNK']
    ncx, ncz = int(math.ceil((XMAX - XMIN) / CH)), int(math.ceil((ZMAX - ZMIN) / CH))
    for b in out_buildings:
        c = Polygon(b['tiers'][0]['r'][0]).centroid
        b['c'] = int(max(0, min(ncz - 1, (c.y - ZMIN) // CH)) * ncx + max(0, min(ncx - 1, (c.x - XMIN) // CH)))

    meta_sources = json.loads((g['ROOT'] / 'tools/extension/downtown-sources.json').read_text())
    meta = {
        'format': 'ut-downtown', 'version': g['VERSION'],
        'rect': {'xmin': XMIN, 'xmax': XMAX, 'zmin': ZMIN, 'zmax': ZMAX}, 'step': STEP, 'chunk': CH, 'chunks': [ncx, ncz],
        'grid': {'nx': nx, 'nz': nz},
        'seam': {'z': g['SEAM_Z'], 'x0': g['SEAM_X0'], 'x1': g['SEAM_X1'], **{k: (float(v) if isinstance(v, (np.floating,)) else v) for k, v in seam_info.items()}},
        'water': {'y': round(WATER_Y, 3), 'surfaceY': round(WATER_Y + .12, 3), 'navd88': g['WATER_NAVD']},
        'classMap': {'w': R.w, 'h': R.h, 'res': g['CLASS_RES']},
        'playable': rings_of(play), 'walls': walls, 'barriers': barriers, 'barrierTop': round(WATER_Y + 3.2, 2),
        'buildings': out_buildings, 'landmarks': landmarks_doc['landmarks'],
        'counts': {'buildings': len(out_buildings), 'trees': len(trees), 'bridgeTriangles': len(bridge_tris),
                   'waterTriangles': len(water_tris), 'walls': len(walls), 'barriers': len(barriers)},
        'claims': meta_sources['claims'],
    }
    sections = [
        ('heights', 'f32', H.astype('<f4').ravel()),
        ('cellFlags', 'u8', flags.ravel()),
        ('classMap', 'u8', classmap.ravel()),
        ('trees', 'f32', np.array(trees, '<f4').ravel() if trees else np.zeros(0, '<f4')),
        ('bridges', 'f32', np.array(bridge_tris, '<f4').ravel()),
        ('bridgeCollide', 'u8', np.array(bridge_col, np.uint8)),
        ('water', 'f32', np.array(water_tris, '<f4').ravel()),
    ]
    body, offs = b'', []
    for name, typ, arr in sections:
        raw = arr.tobytes()
        pad = (-len(raw)) % 4
        offs.append({'name': name, 'type': typ, 'byteOffset': len(body), 'count': int(arr.size)})
        body += raw + b'\0' * pad
    meta['sections'] = offs
    mj = json.dumps(meta, separators=(',', ':'), sort_keys=True).encode()
    mj += b' ' * ((-len(mj)) % 4)
    head = mj + body
    check = g['fnv_words'](head)
    import struct
    blob = struct.pack('<IIII', g['MAGIC'], g['VERSION'], len(mj), check) + head
    out = g['OUT_ASSET']
    gz = gzip.compress(blob, 9, mtime=0)
    (out / 'downtown-v1.bin.gz').write_bytes(gz)
    manifest = {
        'asset': 'downtown-v1.bin.gz', 'bytes': len(blob), 'gzipBytes': len(gz), 'sha256': hashlib.sha256(gz).hexdigest(),
        'inputs': inputs, 'demTiles': prov['dem']['tiles'], 'cityQueries': {k: v['queries'] for k, v in prov['files'].items()},
        'seam': meta['seam'], 'tiers': tier_stats, 'postAerialTowers': stale, 'landmarks': report, 'bridges': bridge_report,
        'counts': meta['counts'], 'playableAreaM2': round(play.area), 'waterAreaM2': round(water.area), 'lakesCrossCheck': lake_check,
        'seamStitched': {str(k): v for k, v in seam_frag.items()},
        'buildings': [{'k': b['k'], 'src': b['src'], 'basis': b['basis'], 'name': b['name'], 'kind': b['kind'],
                       'top': max(t['y'] for t in b['tiers']) - b['g'][0], 'tiers': len(b['tiers']), 'visualOnly': b['visual']} for b in out_buildings],
    }
    (out / 'downtown-v1.manifest.json').write_text(json.dumps(manifest, indent=1, default=float))
    print('asset bytes', len(blob), 'gzip', len(gz), 'meta', len(mj))
    if a.preview:
        preview(a.preview, g, classmap, out_buildings, trees, play, walls)


def preview(path: Path, g, classmap, buildings, trees, play, walls):
    path.mkdir(parents=True, exist_ok=True)
    pal = np.array([[96, 128, 70], [70, 70, 72], [176, 172, 160], [190, 170, 140], [160, 140, 100], [50, 90, 160],
                    [80, 140, 70], [120, 116, 110], [96, 94, 92]], np.uint8)
    img = Image.fromarray(pal[classmap])
    d = ImageDraw.Draw(img)
    X0, Z0 = g['XMIN'], g['ZMIN']
    for b in buildings:
        top = max(t['y'] for t in b['tiers']) - b['g'][0]
        c = (min(255, int(top * 1.2)), 60, max(0, 220 - int(top)))
        for t in b['tiers']:
            d.polygon([(x - X0, z - Z0) for x, z in t['r'][0]], outline=c)
    for x, y, z, h, r, p in trees:
        d.ellipse([x - X0 - r, z - Z0 - r, x - X0 + r, z - Z0 + r], outline=(20, 200, 20) if p else (200, 200, 20))
    for ax, az, bx, bz in walls:
        d.line([(ax - X0, az - Z0), (bx - X0, bz - Z0)], fill=(255, 0, 0), width=2)
    img.save(path / 'classmap.png')
    img.resize((img.width // 3, img.height // 3)).save(path / 'classmap-small.png')
