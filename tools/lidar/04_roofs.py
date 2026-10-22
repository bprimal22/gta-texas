"""Step 4: per-building roof measurements -> public/data/derived/roofs-lidar.json (CONTRACT schema)."""
import json
import math

import numpy as np
from scipy.ndimage import (binary_dilation, correlate, distance_transform_edt, label, median_filter)
from shapely import contains_xy
from shapely.affinity import translate
from shapely.geometry import MultiPolygon, Polygon
from skimage.measure import find_contours

from common import (DATA, DERIVED, GNX, GNZ, GX0, GZ0, RES, WORK, load_json)

DERIVED.mkdir(parents=True, exist_ok=True)
r = np.load(WORK / 'rasters.npz')
dsm, bld, gnd, dtm = r['dsm'], r['bld'], r['gnd'], r['dtm']
vegn, vegmr = r['vegn'], r['vegmr']
align = load_json(WORK / 'alignment.json')
campus = load_json(DATA / 'campus.json')
CAL = load_json(WORK / 'calibration.json')
YOFF = CAL['campusMinusNavd88m']
SDX, SDZ = CAL['shiftX'], CAL['shiftZ']  # add to LiDAR coords to reach campus/footprint frame

TIER_MIN_AREA = 60.0
TIER_MIN_STEP = 3.0
CELL_AREA = RES * RES
MIN_CELLS = int(TIER_MIN_AREA / CELL_AREA)

# Raster of all footprints (LiDAR frame), dilated 1 m, used to keep ground rings off neighbours.
from skimage.draw import polygon as fill_poly
allF = np.zeros((GNZ, GNX), bool)
for b in campus['buildings']:
    a = np.asarray(b['rings'][0], float)
    rr, cc = fill_poly((a[:, 1] - SDZ - GZ0) / RES - 0.5, (a[:, 0] - SDX - GX0) / RES - 0.5, allF.shape)
    allF[rr, cc] = True
allF = binary_dilation(allF, iterations=2)


def rnd(v, k=1):
    return None if v is None or not np.isfinite(v) else round(float(v), k)


def plane_slopes(surf):
    """5x5 (2 m) least-squares plane fits; returns slope (deg) and rms per centre, NaN when incomplete."""
    k = 5
    u = (np.arange(k) - k // 2) * RES
    U, V = np.meshgrid(u, u)  # U along x (cols), V along z (rows)
    valid = np.isfinite(surf)
    s0 = np.where(valid, surf, 0.0)
    n = correlate(valid.astype(float), np.ones((k, k)), mode='constant')
    full = n >= k * k - 0.5
    mean = correlate(s0, np.ones((k, k)), mode='constant') / np.maximum(n, 1)
    a = correlate(s0, U, mode='constant') / np.sum(U * U)
    bb = correlate(s0, V, mode='constant') / np.sum(V * V)
    s2 = correlate(s0 * s0, np.ones((k, k)), mode='constant')
    # residual sum of squares for full windows: sum h^2 - n*mean^2 - a^2 SUU - b^2 SVV
    rss = s2 - n * mean ** 2 - a ** 2 * np.sum(U * U) - bb ** 2 * np.sum(V * V)
    rms = np.sqrt(np.maximum(rss, 0) / (k * k))
    slope = np.degrees(np.arctan(np.hypot(a, bb)))
    slope[~full] = np.nan
    rms[~full] = np.nan
    return slope, rms


def fill_nearest(arr, mask):
    """Fill NaNs inside mask with nearest finite value (any distance)."""
    have = np.isfinite(arr)
    if not have.any():
        return arr
    _, (jj, ii) = distance_transform_edt(~have, return_indices=True)
    out = arr.copy()
    m = mask & ~have
    out[m] = arr[jj[m], ii[m]]
    return out


def segment_tiers(hraw, inside):
    """Cluster roof heights into levels >=3 m apart; components >=60 m^2. Returns label raster + heights."""
    hf = median_filter(np.where(inside, hraw, np.nan), size=5, mode='nearest')
    hf = np.where(inside, np.where(np.isfinite(hf), hf, hraw), np.nan)
    vals = hf[inside & np.isfinite(hf)]
    if len(vals) < MIN_CELLS:
        return None, []
    top = max(float(np.nanmax(vals)), 1.0)
    edges = np.arange(-2.0, top + 1.0, 0.5)
    hist, _ = np.histogram(vals, edges)
    centres = 0.5 * (edges[:-1] + edges[1:])
    win = int(1.5 / 0.5)
    mass = np.convolve(hist, np.ones(2 * win + 1), mode='same')
    order = np.argsort(-mass)
    levels = []
    for i in order:
        if mass[i] < MIN_CELLS:
            break
        if hist[i] == 0:
            continue
        if all(abs(centres[i] - l) >= TIER_MIN_STEP for l in levels):
            levels.append(float(centres[i]))
    if not levels:
        levels = [float(np.median(vals))]
    for _ in range(4):
        L = np.asarray(levels)
        lab = np.full(hf.shape, -1, int)
        m = inside & np.isfinite(hf)
        lab[m] = np.argmin(np.abs(hf[m][:, None] - L[None, :]), axis=1)
        # remove small connected pieces -> nearest surviving label
        for _pass in range(3):
            changed = False
            for li in range(len(L)):
                cc, nc = label(lab == li, structure=np.ones((3, 3)))
                if nc == 0:
                    continue
                sizes = np.bincount(cc.ravel())
                small = (sizes < MIN_CELLS)
                small[0] = False
                bad = small[cc]
                if bad.any():
                    lab[bad] = -2
                    changed = True
            if not changed:
                break
            good = lab >= 0
            if not good.any():
                break
            _, (jj, ii) = distance_transform_edt(~good, return_indices=True)
            fixm = lab == -2
            lab[fixm] = lab[jj[fixm], ii[fixm]]
        # recompute level heights, merge close ones
        newL = []
        remap = {}
        stats = []
        for li in range(len(L)):
            sel = (lab == li) & np.isfinite(hraw)
            if sel.sum() == 0:
                continue
            stats.append((li, float(np.median(hraw[sel])), int(sel.sum())))
        stats.sort(key=lambda t: -t[2])
        for li, hgt, cnt in stats:
            tgt = None
            for k, (nh, ncnt) in enumerate(newL):
                if abs(nh - hgt) < TIER_MIN_STEP:
                    tgt = k
                    break
            if tgt is None:
                newL.append((hgt, cnt))
                remap[li] = len(newL) - 1
            else:
                remap[li] = tgt
        merged = len(newL) < len(stats)
        out = np.full(lab.shape, -1, int)
        for li, k in remap.items():
            out[lab == li] = k
        lab = out
        if not merged:
            levels = [h for h, _ in newL]
            break
        # recompute merged-level heights and loop to re-assign
        levels = []
        for k in range(len(newL)):
            sel = (lab == k) & np.isfinite(hraw)
            levels.append(float(np.median(hraw[sel])))
    final = []
    for k in range(len(levels)):
        sel = (lab == k) & np.isfinite(hraw)
        final.append(float(np.median(hraw[sel])) if sel.any() else levels[k])
    return lab, final


def mask_to_polys(mask, i0, j0):
    pad = np.pad(mask.astype(float), 1)
    polys = []
    for cnt in find_contours(pad, 0.5):
        if len(cnt) < 4:
            continue
        xs = GX0 + (i0 + cnt[:, 1] - 1 + 0.5) * RES
        zs = GZ0 + (j0 + cnt[:, 0] - 1 + 0.5) * RES
        p = Polygon(np.c_[xs, zs]).buffer(0)
        if p.area >= 1:
            polys.append(p)
    if not polys:
        return None
    # outer ring only: the largest contour polygon of this component
    return max(polys, key=lambda p: p.area)


buildings = {}
counts = {'measured': 0, 'conflict': 0, 'no-data': 0}
# campus.json has one id split over two records (699766); measure such ids as one multipart footprint.
from shapely.ops import unary_union
groups = {}
for b in campus['buildings']:
    groups.setdefault(str(b['id']), []).append(b)
for bid, parts_b in groups.items():
    b = parts_b[0]
    poly_c = unary_union([Polygon(q['rings'][0], q['rings'][1:]).buffer(0) for q in parts_b])
    poly = translate(poly_c, -SDX, -SDZ)  # LiDAR frame
    x0, z0, x1, z1 = poly.bounds
    M = 18.0
    i0 = max(int((x0 - M - GX0) / RES), 0)
    i1 = min(int((x1 + M - GX0) / RES) + 1, GNX)
    j0 = max(int((z0 - M - GZ0) / RES), 0)
    j1 = min(int((z1 + M - GZ0) / RES) + 1, GNZ)
    X = GX0 + (np.arange(i0, i1) + 0.5) * RES
    Z = GZ0 + (np.arange(j0, j1) + 0.5) * RES
    XX, ZZ = np.meshgrid(X, Z)
    inside = contains_xy(poly, XX, ZZ)
    ninside = int(inside.sum())
    inner_poly = poly.buffer(-0.75)
    inner = contains_xy(inner_poly, XX, ZZ) if not inner_poly.is_empty else inside
    if inner.sum() < 8:
        inner = inside
    sl = (slice(j0, j1), slice(i0, i1))
    B, D, G, T = bld[sl], dsm[sl], gnd[sl], dtm[sl]
    # ground ring: 1.5..8 m outside, not on other footprints
    gsrc = 'ring'
    ground = None
    for rad in (8.0, 16.0):
        ring = contains_xy(poly.buffer(rad), XX, ZZ) & ~contains_xy(poly.buffer(1.5), XX, ZZ) & ~allF[sl] & np.isfinite(G)
        if ring.sum() >= 20:
            ground = float(np.percentile(G[ring], 10))
            break
    if ground is None:
        gsrc = 'dtm'
        ground = float(np.percentile(T[inside], 10)) if ninside else float('nan')
    entry = {'status': 'measured', 'groundY': rnd(ground + YOFF), 'heightP50': 0.0, 'heightP95': 0.0,
             'heightMax': 0.0, 'roofType': 'flat', 'pitchDeg': 0.0, 'coverage': 0.0, 'tiers': [], 'note': ''}
    notes = []
    if gsrc != 'ring':
        notes.append('ground from interpolated DTM (no ground returns around footprint)')
    if ninside == 0 or not np.isfinite(D[inside]).any():
        entry['status'] = 'no-data'
        entry['note'] = 'no LiDAR returns inside footprint'
        counts['no-data'] += 1
        buildings[bid] = entry
        continue
    cov6 = float(np.isfinite(B[inside]).mean())
    covD = float((np.nan_to_num(D[inside], nan=-1e9) - ground > 2.5).mean())
    vn, vm = vegn[sl][inside].sum(), vegmr[sl][inside].sum()
    use6 = cov6 >= 0.3 or cov6 >= 0.6 * covD
    if use6:
        S = B
        coverage = cov6
    else:
        # structure present but not classified as building (e.g. stands, garages) unless it is vegetation
        mr = vm / max(vn, 1)
        if covD >= 0.5 and mr < 0.35:
            S = np.where(D - ground > 2.5, D, np.nan)
            coverage = covD
            notes.append('heights from unclassified first-return surface (few class-6 returns)')
        else:
            S = B
            coverage = cov6
    hgt = S - ground
    hv = hgt[inner & np.isfinite(hgt)]
    if len(hv) < 4:
        hv = hgt[inside & np.isfinite(hgt)]
    if len(hv) == 0:
        entry.update(status='conflict', coverage=rnd(coverage, 2))
        notes.append('no roof returns inside footprint in 2017 (new building or footprint mismatch)')
        entry['note'] = '; '.join(notes)
        counts['conflict'] += 1
        buildings[bid] = entry
        continue
    p50, p95, hmax = np.percentile(hv, 50), np.percentile(hv, 95), float(hv.max())
    entry.update(heightP50=rnd(p50), heightP95=rnd(p95), heightMax=rnd(hmax), coverage=rnd(coverage, 2))
    # roof form
    surf = np.where(inside, S, np.nan)
    surf_f = np.where(inside, fill_nearest(surf, inside), np.nan) if coverage > 0.3 else surf
    slope, rms = plane_slopes(surf_f)
    core = contains_xy(poly.buffer(-1.5), XX, ZZ) if poly.buffer(-1.5).area > 4 else inside
    good = core & np.isfinite(slope) & (rms < 0.15)
    if good.sum() >= 10:
        sv = slope[good]
        steep = sv > 12
        sf = float(steep.mean())
        if sf < 0.2:
            rtype, pitch = 'flat', float(np.median(sv))
        elif sf > 0.55:
            rtype, pitch = 'pitched', float(np.median(sv[steep]))
        else:
            rtype, pitch = 'mixed', float(np.median(sv[steep]))
        entry.update(roofType=rtype, pitchDeg=rnd(pitch))
    else:
        notes.append('roof form undetermined (too few clean plane fits)')
    # conflict tests against campus.json h (2023 footprints)
    h = float(b.get('h') or 0)
    conflict = None
    if coverage < 0.3:
        conflict = f'low 2017 roof coverage {coverage:.2f} inside 2023 footprint'
    elif h > 0 and p95 < 0.5 * h and h - p95 > 8:
        conflict = f'2017 LiDAR P95 {p95:.1f} m far below campus.json h {h:.1f} m (likely built/raised after 2017)'
    elif h > 0 and coverage < 0.6 and abs(p95 - h) > max(8.0, 0.25 * h):
        conflict = (f'partial 2017 coverage {coverage:.2f} and P95 {p95:.1f} m vs campus.json h {h:.1f} m '
                    '(site rebuilt/renovated after 2017)')
    if h > 0 and p95 > 2 * h + 10:
        notes.append(f'LiDAR P95 {p95:.1f} m far above campus.json h {h:.1f} m')
    if conflict:
        entry['status'] = 'conflict'
        notes.append(conflict)
        counts['conflict'] += 1
    else:
        counts['measured'] += 1
        # tiers
        hraw = np.where(inside, hgt, np.nan)
        hfill = np.where(inside, fill_nearest(hraw, inside), np.nan)
        lab, levels = segment_tiers(hfill, inside)
        tiers = []
        if lab is not None:
            for k, lvl in enumerate(levels):
                cc, nc = label(lab == k, structure=np.ones((3, 3)))
                for ci in range(1, nc + 1):
                    comp = cc == ci
                    if comp.sum() < MIN_CELLS:
                        continue
                    hc = hraw[comp & np.isfinite(hraw)]
                    th = float(np.median(hc)) if len(hc) else lvl
                    if th < 2.0:
                        continue  # open/ground-level part of the footprint
                    p = mask_to_polys(comp, i0, j0)
                    if p is None:
                        continue
                    p = p.intersection(poly).simplify(0.5, preserve_topology=True)
                    parts = list(p.geoms) if isinstance(p, MultiPolygon) else [p] if isinstance(p, Polygon) else []
                    for q in parts:
                        if not isinstance(q, Polygon) or q.area < TIER_MIN_AREA:
                            continue
                        q = translate(q, SDX, SDZ)
                        ring = [[round(x, 1), round(z, 1)] for x, z in list(q.exterior.coords)[:-1]]
                        tiers.append({'height': rnd(th), 'area': round(q.area), 'ring': ring})
        tiers.sort(key=lambda t: t['height'])
        entry['tiers'] = tiers
    entry['note'] = '; '.join(notes)
    buildings[bid] = entry

out = {
    'source': 'USGS 3DEP Lidar Point Cloud TX_Central_B1_2017 (StratMap 2017 50cm), tiles 3097433a3/a4/c1/c2; public domain',
    'crs': CAL['crsNote'],
    'verticalOffset': {'campusMinusNavd88m': round(YOFF, 2), 'measuredMedianResidual': round(CAL['measuredMedianResidual'], 2)},
    'buildings': buildings,
}
txt = json.dumps(out, separators=(',', ':'))
(DERIVED / 'roofs-lidar.json').write_text(txt)
print(counts, 'bytes', len(txt))
