#!/usr/bin/env python3
"""Bake the James D. Pfluger Pedestrian & Bicycle Bridge (Lady Bird Lake, beside Lamar Blvd) into authored runtime
constants: lib/campus/extension/downtown/pfluger-bridge.json (read by pfluger-bridge.ts). Evidence import, not a survey.

Identification: City of Austin Planimetrics Impervious Cover 2023, FEATURE 'Bridge', OBJECTID 9608 (x -1880.8..-1729.8,
z 2152.7..2383.4 campus metres, 3313 m2): double-curve plan, forks at both ends, north double helix around a garden
(polygon hole 1) and the 2011 north connector over Cesar Chavez. (OBJECTID 411834, the straight diagonal band east of
it, is the Union Pacific rail bridge.)

References (form only; no images are used or shipped):
  * Carter Design Associates, https://www.carterdesign.net/pfluger-bridge - architect photos (H_0141-2 deck view,
    B&W aerial): tinted tan/pink concrete deck with broad dusty-red curved bands, grey rails with vertical mesh infill,
    tall grey lamp poles with double saucer caps on square plinths, planters on the deck; plan shape and forks.
  * AIA Austin guide, https://guidetoaustinarchitecture.com/places/james-d-pfluger-pedestrian-bridge/ - concrete deck on
    curved weathering-steel plate girders, curved concrete piers, ~700 ft, double-hourglass plan, double-helix ramp
    around a native-plant garden on the north shore, lampposts / benches / planters.
  * Wikipedia, https://en.wikipedia.org/wiki/James_D._Pfluger_Pedestrian_and_Bicycle_Bridge (and its two Commons
    photos) - 812 ft, width 23-42 ft, longest span 124 ft, 12 in reinforced concrete slab, steel plate girders with
    reverse curvature, cast-in-place concrete bents (twin curved columns flaring into the cap), north connector 2010-11.

Heights: USGS 3DEP LiDAR (TX_Central_B1_2017 EPT depth-10 subset) class 13/1 deck returns. The deck is a SMOOTH
structural profile: per branch centreline (BRANCHES below, authored from the polygon's medial axis), 1 m bin medians of
the deck returns are fitted by a second-difference-regularised least-squares profile in arc length (robust two-pass,
outliers > 0.45 m dropped); branches are tied at forks/junctions; zero crossfall; the north landing is tied to the
downtown terrain and the helix junction to the helix top. The helix grade is a robust line fitted to the visible top
turn and continued to the shore trail. Pier stations, girder depth and railing details are reference-guided estimates.

Run (venv with tools/lidar/requirements.txt):
  python -I tools/extension/bake-pfluger-bridge.py [--raw .work/claude-downtown/raw/impervious-cover-2023.json]
      [--lidar .work/claude-downtown/ept/downtown-lidar-ept-depth10.npz] [--asset public/assets/extension/downtown-v1.bin.gz]
      [--out lib/campus/extension/downtown/pfluger-bridge.json]
Deterministic: identical inputs give a byte-identical JSON. Re-run after a terrain re-bake of downtown-v1.bin.gz.
"""
from __future__ import annotations

import argparse
import gzip
import json
import math
import struct
from pathlib import Path

import numpy as np
import shapely
from scipy.spatial import cKDTree
from shapely.geometry import LineString, Point, Polygon, box

ROOT = Path(__file__).resolve().parents[2]
SX, SZ, LON0, LAT0, NAVD_TO_CAMPUS = 96126.8152981172, 110851.0, -97.73716, 30.2861, -165.0
OID = 9608
SLAB = 0.30            # 12 in concrete deck (Wikipedia)
BAND = 1.6             # dusty-red edge band width (Carter Design photo)
PHI_TOP = 92.0         # helix top (deg, plan angle) where it merges into the main deck
CELL = 2.5             # deck surface mesh: band/centre polygons cut by a 2.5 m grid (small facets follow the profile)
LAMBDA = 4000.0        # second-difference weight of the deck profile fit (1 m knots, unit-weight bin medians)

# Branch centrelines (campus x, z), authored from the polygon's medial axis; smoothed (Chaikin) and resampled at 1 m.
# A: north landing -> connector -> north-west fork -> trunk -> south-west landing; B: south fork -> south landing;
# C: helix junction -> north-east landing -> north fork (joins A); D: north-west <-> north-east link at the shore.
BRANCHES = {
    'A': [[-1736.6, 2154.6], [-1747.2, 2177.0], [-1757.8, 2198.2], [-1759.6, 2210.0], [-1762.0, 2224.0], [-1767.5, 2236.0],
          [-1770.8, 2249.2], [-1782.3, 2267.2], [-1796.0, 2286.5], [-1809.8, 2305.7], [-1827.3, 2332.2], [-1846.3, 2345.7],
          [-1865.3, 2359.2], [-1879.6, 2364.6]],
    'B': [[-1827.3, 2332.2], [-1829.0, 2342.0], [-1833.5, 2353.0], [-1838.0, 2366.0], [-1840.6, 2382.6]],
    'C': [[-1742.0, 2225.1], [-1744.0, 2228.3], [-1747.3, 2230.5], [-1755.0, 2238.5], [-1763.3, 2246.2], [-1770.8, 2249.2]],
    'D': [[-1762.0, 2224.0], [-1755.8, 2225.4], [-1750.3, 2227.0], [-1745.5, 2229.6]],
}
TIPS = {'north': (-1736.6, 2154.6), 'southwest': (-1879.6, 2364.6), 'south': (-1840.6, 2382.6)}
# Pier stations (estimates; spans <= ~34 m, longest published span 38 m): approximate plan points, projected onto the
# owning branch; each bent is laid across the deck at that station.
PIERS = {'A': [(-1746.7, 2176.0), (-1759.0, 2201.3), (-1762.8, 2228.9), (-1772.2, 2251.9), (-1790.9, 2279.1), (-1810.3, 2307.0),
               (-1827.7, 2332.1), (-1854.4, 2351.6)], 'B': [(-1835.5, 2359.2)], 'C': [(-1757.0, 2240.3)]}


def xy(lon, lat):
    return ((lon - LON0) * SX, (LAT0 - lat) * SZ)


def poly_from_esri(rings):
    ext, holes = [], []
    for r in rings:
        pts = [tuple(map(float, xy(p[0], p[1]))) for p in r]
        (ext if shapely.is_ccw(Polygon(pts).exterior) else holes).append(pts)
    out = []
    for e in ext:
        p = Polygon(e)
        out.append(Polygon(p.exterior.coords, [h for h in holes if p.contains(Polygon(h).representative_point())]))
    return out


def chaikin(pts, n=3):
    p = np.array(pts, float)
    for _ in range(n):
        q = [p[0]]
        for a, b in zip(p[:-1], p[1:]):
            q += [.75 * a + .25 * b, .25 * a + .75 * b]
        q.append(p[-1]); p = np.array(q)
    return p


def resample(p, step=1.0):
    ls = LineString(p)
    n = max(2, int(math.ceil(ls.length / step)) + 1)
    return np.array([ls.interpolate(i / (n - 1), normalized=True).coords[0] for i in range(n)]), ls.length


def fit_profile(s_bins, m_bins, n, ties, flat=()):
    """y at knots 0..n-1 (spacing ds): bins (s, median) unit weight + LAMBDA * second differences + heavy ties."""
    rows, rhs = [], []
    ds = (n - 1) and 1.0
    for s, m in zip(s_bins, m_bins):
        k = min(n - 2, int(s)); t = s - k; r = np.zeros(n); r[k] = 1 - t; r[k + 1] = t; rows.append(r); rhs.append(m)
    w = math.sqrt(LAMBDA)
    for k in range(1, n - 1):
        r = np.zeros(n); r[k - 1] = w; r[k] = -2 * w; r[k + 1] = w; rows.append(r); rhs.append(0.0)
    for k, y in ties:
        r = np.zeros(n); r[k] = 1e3; rows.append(r); rhs.append(1e3 * y)
    for k in flat:   # level landing: zero grade over the end knot (beyond the centreline end the deck stays level)
        r = np.zeros(n); r[k] = 1e3; r[k + 1] = -1e3; rows.append(r); rhs.append(0.0)
    sol, *_ = np.linalg.lstsq(np.array(rows), np.array(rhs), rcond=None)
    return sol * ds


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--raw', type=Path, default=ROOT / '.work/claude-downtown/raw/impervious-cover-2023.json')
    ap.add_argument('--lidar', type=Path, default=ROOT / '.work/claude-downtown/ept/downtown-lidar-ept-depth10.npz')
    ap.add_argument('--asset', type=Path, default=ROOT / 'public/assets/extension/downtown-v1.bin.gz')
    ap.add_argument('--out', type=Path, default=ROOT / 'lib/campus/extension/downtown/pfluger-bridge.json')
    a = ap.parse_args()

    raw = json.loads(a.raw.read_text())
    feat = next(f for f in raw['features'] if f['attributes']['OBJECTID'] == OID)
    assert feat['attributes']['FEATURE'] == 'Bridge'
    (P,) = poly_from_esri(feat['geometry']['rings'])
    P = P.buffer(0)
    print('OID', OID, 'area', round(P.area), 'bounds', [round(v, 1) for v in P.bounds], 'holes', len(P.interiors))

    # ---------------------------------------------------------------- LiDAR
    L = np.load(a.lidar)
    lx, lz = L['x'].astype(float), L['z'].astype(float)
    le, lc = L['elevation_navd88_m'].astype(float) + NAVD_TO_CAMPUS, L['classification']
    win = (lx > P.bounds[0] - 30) & (lx < P.bounds[2] + 30) & (lz > P.bounds[1] - 30) & (lz < P.bounds[3] + 30)
    lx, lz, le, lc = lx[win], lz[win], le[win], lc[win]
    water_y = float(np.median(le[lc == 9]))
    ground = lc == 2
    deckpts = np.isin(lc, (1, 13))

    # ---------------------------------------------------------------- downtown terrain (north landing, helix exit)
    buf = gzip.decompress(a.asset.read_bytes())
    ml = struct.unpack_from('<I', buf, 8)[0]
    meta = json.loads(buf[16:16 + ml]); sec = {s['name']: s for s in meta['sections']}
    H = np.frombuffer(buf, '<f4', sec['heights']['count'], 16 + ml + sec['heights']['byteOffset'])
    nx, nz, step = meta['grid']['nx'], meta['grid']['nz'], meta['step']
    X0, Z0 = meta['rect']['xmin'], meta['rect']['zmin']

    def terrain(x, z):
        """DowntownTerrain.height (same triangle split); NaN outside the downtown rectangle."""
        if x < X0 or z < Z0: return float('nan')
        fx, fz = min((x - X0) / step, nx - 1.000001), min((z - Z0) / step, nz - 1.000001)
        i, j = int(fx), int(fz); u, v = fx - i, fz - j; k = j * nx + i
        A_, B_, C_, E_ = H[k], H[k + 1], H[k + nx], H[k + nx + 1]
        return float(A_ + (B_ - A_) * u + (C_ - A_) * v if u + v <= 1 else E_ + (C_ - E_) * (1 - u) + (B_ - E_) * (1 - v))

    def lidar_ground(x, z, rad=6.0):
        s = ground & (np.hypot(lx - x, lz - z) < rad)
        return float(np.median(le[s])) if s.sum() >= 3 else float('nan')

    # ---------------------------------------------------------------- helix
    hole = max(P.interiors, key=lambda h: Polygon(h).area)
    hc = np.array(hole.coords)[:-1]; C = hc.mean(axis=0)
    R_IN = float(np.mean(np.hypot(hc[:, 0] - C[0], hc[:, 1] - C[1])))
    ext = np.array(P.exterior.coords)
    re_ = np.hypot(ext[:, 0] - C[0], ext[:, 1] - C[1]); ang = np.degrees(np.arctan2(ext[:, 1] - C[1], ext[:, 0] - C[0]))
    R_OUT = float(np.median(re_[(re_ > R_IN + 2) & (re_ < R_IN + 6) & (ang > -100) & (ang < 40)]))
    r = np.hypot(lx - C[0], lz - C[1]); pa = np.degrees(np.arctan2(lz - C[1], lx - C[0]))
    ring = deckpts & (r > R_IN + .4) & (r < R_OUT - .4) & (le > -29.5)
    phi = np.where(pa <= PHI_TOP, pa, pa - 360.0)
    sel = ring & (phi < PHI_TOP - 4) & (phi > PHI_TOP - 356)
    bx, by = [], []
    for b0 in np.arange(PHI_TOP - 356, PHI_TOP - 4, 8.0):
        s = sel & (phi >= b0) & (phi < b0 + 8)
        if s.sum() >= 4: bx.append(b0 + 4); by.append(float(np.median(le[s])))
    bx, by = np.array(bx), np.array(by); keep = np.ones(len(bx), bool)
    for _ in range(3):
        slope, icpt = np.polyfit(bx[keep], by[keep], 1)
        keep = np.abs(by - (slope * bx + icpt)) < .25
    hres = (by - (slope * bx + icpt))[keep]
    Y_TOP = float(slope * PHI_TOP + icpt); rm = (R_IN + R_OUT) / 2
    PHI_END = None
    for ph in np.arange(PHI_TOP - 360, PHI_TOP - 1080, -1.0):
        th = math.radians(ph); ty = terrain(C[0] + rm * math.cos(th), C[1] + rm * math.sin(th))
        if slope * ph + icpt <= ty + .02: PHI_END = float(ph); break
    Y_END = float(slope * PHI_END + icpt)
    print('helix c', C.round(2), 'rIn', round(R_IN, 2), 'rOut', round(R_OUT, 2), 'grade m/deg', round(slope, 5), 'rms', round(float(np.sqrt(np.mean(hres ** 2))), 3),
          'top', round(Y_TOP, 2), 'exit', round(Y_END, 2), 'turns', round((PHI_TOP - PHI_END) / 360, 2))

    # ---------------------------------------------------------------- main deck outline (polygon minus helix annulus)
    disc = Point(*C).buffer(R_OUT + .05, 96)
    M = P.difference(disc).buffer(-.6, join_style='mitre').buffer(.6, join_style='mitre').intersection(P).difference(disc)
    M = max([p for p in (M.geoms if hasattr(M, 'geoms') else [M])], key=lambda p: p.area).simplify(.15, preserve_topology=True)

    # ---------------------------------------------------------------- smooth structural deck profile
    paths = {k: resample(chaikin(v))[0] for k, v in BRANCHES.items()}
    lines = {k: LineString(v) for k, v in paths.items()}
    on = deckpts & shapely.contains_xy(M.buffer(.5), lx, lz) & (r > R_OUT + .8)
    px, pz, pe = lx[on], lz[on], le[on]
    pts = shapely.points(px, pz)
    dist = np.array([shapely.distance(lines[k], pts) for k in paths])          # (paths, points)
    owner = np.argmin(dist, axis=0); keys = list(paths)
    north_ground = terrain(*TIPS['north'])
    prof, stats = {}, {}

    def at(k, s):
        y = prof[k]; s = min(max(s, 0), len(y) - 1); i = min(len(y) - 2, int(s)); t = s - i
        return float(y[i] * (1 - t) + y[i + 1] * t)

    def tie_at(k, x, z):
        return lines[k].project(Point(x, z))

    order = ['A', 'B', 'C', 'D']
    for k in order:
        n = len(paths[k]); idx = owner == keys.index(k)
        s = np.array([lines[k].project(Point(x, z)) for x, z in zip(px[idx], pz[idx])]); e = pe[idx]
        ties = []
        if k == 'A': ties = [(0, north_ground + .03)]
        if k == 'B': ties = [(0, at('A', tie_at('A', *paths['B'][0])))]
        if k == 'C':   # starts just outside the helix at its top: tie to the helix height at that plan angle
            ph0 = math.degrees(math.atan2(paths['C'][0][1] - C[1], paths['C'][0][0] - C[0]))
            ties = [(0, float(slope * (ph0 if ph0 <= PHI_TOP else ph0 - 360) + icpt)), (n - 1, at('A', tie_at('A', *paths['C'][-1])))]
        if k == 'D': ties = [(0, at('A', tie_at('A', *paths['D'][0]))), (n - 1, at('C', tie_at('C', *paths['D'][-1])))]
        mask = np.ones(len(e), bool)
        for it in range(2):
            sb, mb = [], []
            for b in range(n - 1):
                q = mask & (s >= b) & (s < b + 1)
                if q.sum() >= 3: sb.append(b + .5); mb.append(float(np.median(e[q])))
            y = fit_profile(sb, mb, n, ties, {'A': (0, n - 2), 'B': (n - 2,)}.get(k, ()))
            res = e - np.interp(s, np.arange(n), y); mask = np.abs(res) < .45
        prof[k] = y
        res = e[mask] - np.interp(s[mask], np.arange(n), y)
        g = np.diff(y); c2 = np.abs(np.diff(y, 2))
        stats[k] = {'lengthM': round(float(lines[k].length), 1), 'points': int(mask.sum()), 'rejected': int((~mask).sum()),
                    'residualRms': round(float(np.sqrt(np.mean(res ** 2))), 3), 'residualP95': round(float(np.percentile(np.abs(res), 95)), 3),
                    'maxGrade': round(float(np.abs(g).max()), 4), 'maxSecondDiff': round(float(c2.max()), 5)}
        print('profile', k, stats[k], 'y', round(float(y.min()), 2), round(float(y.max()), 2))

    def deck_y(x, z):
        d = np.array([lines[k].distance(Point(x, z)) for k in order])
        w = np.exp(-(d - d.min()) / 1.0)
        ys = np.array([at(k, lines[k].project(Point(x, z))) for k in order])
        return float((w * ys).sum() / w.sum())

    def ring_xyz(coords, seg=1.5):
        return [[round(x, 2), round(deck_y(x, z), 3), round(z, 2)] for x, z in list(LineString(coords).segmentize(seg).coords)[:-1]]

    centre = M.buffer(-BAND, join_style='mitre', mitre_limit=2).simplify(.15)
    cparts = [p for p in (centre.geoms if hasattr(centre, 'geoms') else [centre]) if p.area > 8]
    centre_rings = [[ring_xyz(p.exterior.coords)] + [ring_xyz(h.coords) for h in p.interiors if Polygon(h).area > 2] for p in cparts]
    deck_rings = [ring_xyz(M.exterior.coords)] + [ring_xyz(h.coords) for h in M.interiors]

    # Walkable deck surface: band (dusty red) and centre (tan) polygons cut by a CELL grid, each piece constrained-Delaunay
    # triangulated; shared grid-line / ring vertices are identical (rounded keys), so the mesh is conforming.
    centre_poly = shapely.union_all([Polygon([(q[0], q[2]) for q in cr[0]], [[(q[0], q[2]) for q in h] for h in cr[1:]]) for cr in centre_rings]).buffer(0)
    deck_poly = Polygon([(q[0], q[2]) for q in deck_rings[0]], [[(q[0], q[2]) for q in h] for h in deck_rings[1:]]).buffer(0)
    band_poly = deck_poly.difference(centre_poly).buffer(0)
    vid, verts, tris, tcol = {}, [], [], []

    def vkey(x, z):
        k = (round(x, 2), round(z, 2))
        if k not in vid:
            vid[k] = len(verts); verts.append([k[0], round(deck_y(*k), 3), k[1]])
        return vid[k]
    gx0, gz0, gx1, gz1 = deck_poly.bounds
    for colour, poly in ((0, band_poly), (1, centre_poly.intersection(deck_poly))):
        for i in range(int(math.floor(gx0 / CELL)), int(math.ceil(gx1 / CELL))):
            for j in range(int(math.floor(gz0 / CELL)), int(math.ceil(gz1 / CELL))):
                piece = poly.intersection(box(i * CELL, j * CELL, (i + 1) * CELL, (j + 1) * CELL))
                for q in (piece.geoms if hasattr(piece, 'geoms') else [piece]):
                    if q.geom_type != 'Polygon' or q.area < 1e-4: continue
                    for t in shapely.constrained_delaunay_triangles(q).geoms:
                        ids = [vkey(x, z) for x, z in list(t.exterior.coords)[:3]]
                        if len(set(ids)) < 3: continue
                        (ax, _, az), (bx_, _, bz_), (cx_, _, cz_) = (verts[k] for k in ids)
                        if abs((bx_ - ax) * (cz_ - az) - (bz_ - az) * (cx_ - ax)) < 1e-4: continue
                        tris += ids; tcol.append(colour)
    print('deck mesh', len(verts), 'vertices', len(tcol), 'triangles; area', round(deck_poly.area), 'band', round(band_poly.area))

    girders = []
    for off in (1.25, 3.6):
        g = M.buffer(-off, join_style='round').simplify(.2)
        for p in (g.geoms if hasattr(g, 'geoms') else [g]):
            for rr in [p.exterior] + list(p.interiors):
                if rr.length < 25: continue
                girders.append([[round(x, 2), round(deck_y(x, z), 3), round(z, 2)] for x, z in LineString(rr.coords).segmentize(2.5).coords])

    # open (landing) ends and the helix junction
    open_zones = []
    for name, (tx, tz) in TIPS.items():
        tg = terrain(tx, tz)
        open_zones.append({'name': name, 'x': tx, 'z': tz, 'r': 4.5, 'kind': 'ground', 'ground': round(tg if math.isfinite(tg) else lidar_ground(tx, tz, 8), 2)})
    th = math.radians(PHI_TOP - 10)
    open_zones.append({'name': 'helix', 'x': round(C[0] + (R_OUT + .3) * math.cos(th), 2), 'z': round(C[1] + (R_OUT + .3) * math.sin(th), 2), 'r': 3.8, 'kind': 'helix'})

    # piers: bents across the deck at estimated stations
    piers = []
    for k, stations in PIERS.items():
        ls = lines[k]
        for sx, sz in stations:
            s = round(ls.project(Point(sx, sz)), 1)
            p = ls.interpolate(s); q0 = ls.interpolate(max(0, s - 2)); q1 = ls.interpolate(min(ls.length, s + 2))
            tx, tz = q1.x - q0.x, q1.y - q0.y; tl = math.hypot(tx, tz); nxv, nzv = -tz / tl, tx / tl

            def extent(sign):
                for kk in np.arange(0, 12, .1):
                    if not M.contains(Point(p.x + sign * nxv * kk, p.y + sign * nzv * kk)): return float(kk)
                return 12.0
            e0, e1 = extent(1), extent(-1)
            cx, cz = p.x + nxv * (e0 - e1) / 2, p.y + nzv * (e0 - e1) / 2
            tg = terrain(cx, cz); land = tg if math.isfinite(tg) else lidar_ground(cx, cz, 4)
            water = not math.isfinite(land) or land < water_y + .5
            piers.append({'path': k, 's': s, 'x': round(cx, 2), 'z': round(cz, 2), 'dir': [round(nxv, 4), round(nzv, 4)], 'half': round((e0 + e1) / 2, 2),
                          'deck': round(deck_y(cx, cz), 3), 'base': round(water_y - 1.5 if water else land - .4, 2), 'water': bool(water)})

    # LiDAR reference samples (raw medians within 1.6 m, independent of the fit)
    refs = []
    for k in order:
        for s in np.arange(4, lines[k].length - 3, 9):
            p = lines[k].interpolate(s)
            q = on & (np.hypot(lx - p.x, lz - p.y) < 1.6)
            if q.sum() < 5: continue
            v = le[q]; v = v[np.abs(v - np.median(v)) < 1]
            refs.append([round(p.x, 2), round(p.y, 2), round(float(np.median(v)), 2), k])
    for b0, y in list(zip(bx[keep], by[keep]))[::3]:
        t = math.radians(b0)
        refs.append([round(C[0] + rm * math.cos(t), 2), round(C[1] + rm * math.sin(t), 2), round(y, 2), 'helix'])

    doc = {
        'about': 'Generated by tools/extension/bake-pfluger-bridge.py (see its docstring for sources and method). Do not edit by hand.',
        'oid': OID, 'slab': SLAB, 'band': BAND, 'waterY': round(water_y, 2),
        'helix': {'c': [round(float(C[0]), 2), round(float(C[1]), 2)], 'rIn': round(R_IN, 2), 'rOut': round(R_OUT, 2), 'phiTop': PHI_TOP,
                  'phiEnd': round(PHI_END, 1), 'slope': round(float(slope), 6), 'yTop': round(Y_TOP, 3), 'yEnd': round(Y_END, 3)},
        'profile': {'lambda': LAMBDA, 'branches': stats},
        'paths': {k: [[round(float(x), 2), round(at(k, i), 3), round(float(z), 2)] for i, (x, z) in enumerate(paths[k])] for k in order},
        'deck': deck_rings, 'centre': centre_rings,
        'mesh': {'v': [c for v in verts for c in v], 't': tris, 'c': tcol},
        'source': [[[round(x, 2), round(z, 2)] for x, z in list(rr.coords)[:-1]] for rr in [P.simplify(.1).exterior] + list(P.simplify(.1).interiors)],
        'open': open_zones, 'girders': girders, 'piers': piers, 'lidar': refs,
    }
    a.out.write_text(json.dumps(doc, separators=(',', ':')) + '\n')
    print('wrote', a.out, a.out.stat().st_size, 'bytes; piers', len(piers), 'refs', len(refs))


if __name__ == '__main__':
    main()
