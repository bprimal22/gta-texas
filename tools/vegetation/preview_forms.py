"""Offline painter's-algorithm preview of tree form LODs (no browser/WebGL).
Approximate: flat-shaded wood, alpha-composited textured foliage cards."""
import json, sys, math
import numpy as np
from PIL import Image, ImageDraw
forms = json.load(open(sys.argv[1])); atlas = Image.open(sys.argv[2]).convert('RGBA'); out = sys.argv[3]
mode = sys.argv[4] if len(sys.argv) > 4 else 'side'
bark = np.array([92, 82, 70], np.float32); sun = np.array([.45, .75, .35]); sun /= np.linalg.norm(sun)
AW = atlas.size[0]

def render(lod, size, project, sky=(196, 214, 236)):
    img = Image.new('RGBA', size, sky + (255,)); d = ImageDraw.Draw(img)
    items = []
    p = np.array(lod['wood']['p']).reshape(-1, 3); n = np.array(lod['wood']['n']).reshape(-1, 3); idx = np.array(lod['wood']['i']).reshape(-1, 3)
    P, Z = project(p)
    for t in idx:
        z = Z[t].mean()
        if np.isnan(z): continue
        nn = n[t].mean(0); l = .45 + .55 * max(0, float(nn @ sun))
        items.append((z, 'w', [tuple(P[k]) for k in t], tuple(int(c) for c in bark * l)))
    lp = np.array(lod['leaf']['p']).reshape(-1, 3); ln = np.array(lod['leaf']['n']).reshape(-1, 3); uv = np.array(lod['leaf']['uv']).reshape(-1, 2); col = np.array(lod['leaf']['c']).reshape(-1, 3)
    LP, LZ = project(lp)
    for q in range(len(lp) // 4):
        k = slice(q * 4, q * 4 + 4); z = LZ[k].mean()
        if np.isnan(z): continue
        nn = ln[q * 4]; l = (.5 + .6 * max(0, float(nn @ sun))) * col[q * 4].mean()
        items.append((z, 'l', LP[k], uv[k], l))
    items.sort(key=lambda it: -it[0])
    for it in items:
        if it[1] == 'w': d.polygon(it[2], fill=it[3])
        else:
            pts, uvs, l = it[2], it[3], it[4]
            xs, ys = pts[:, 0], pts[:, 1]
            x0, y0, x1, y1 = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
            if x1 - x0 < 2 or y1 - y0 < 2 or x1 - x0 > 2000: continue
            u0, v0 = uvs[:, 0].min(), uvs[:, 1].min()
            tile = atlas.crop((int(u0 * AW), int((1 - v0 - .5) * AW), int((u0 + .5) * AW), int((1 - v0) * AW)))
            # Map tile corners (uv order: (0,0),(1,0),(1,1),(0,1)) -> screen quad. QUAD wants src corners for dst box.
            # Use inverse: build dst-sized image via perspective-free affine of 3 corners.
            src = np.array([[0, tile.size[1]], [tile.size[0], tile.size[1]], [tile.size[0], 0]], np.float64)
            dst = pts[:3] - np.array([x0, y0])
            A = np.c_[dst, np.ones(3)]
            try: coef = np.linalg.solve(A, src)
            except np.linalg.LinAlgError: continue
            w = tile.transform((x1 - x0, y1 - y0), Image.AFFINE, tuple(coef[:, 0]) + tuple(coef[:, 1]), Image.BILINEAR)
            arr = np.array(w).astype(np.float32); arr[..., :3] *= l * 1.25; arr[..., 3] = np.where(arr[..., 3] > 110, 255, 0)
            img.alpha_composite(Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)), (x0, y0))
    return img

if mode == 'side':
    tiles = []
    for f in forms:
        lod = f[int(sys.argv[5]) if len(sys.argv) > 5 else 0]
        def proj(p, s=14, W=360, H=240):
            return np.c_[W / 2 + p[:, 0] * s, H - 8 - p[:, 1] * s], p[:, 2]
        tiles.append(render(lod, (360, 240), proj))
    sheet = Image.new('RGB', (360 * 4, 240 * 2))
    for i, t in enumerate(tiles): sheet.paste(t.convert('RGB'), ((i % 4) * 360, (i // 4) * 240))
    sheet.save(out)
elif mode == 'ped':
    # Pedestrian view: eye at 1.6 m, 9 m south of trunk of form 0, looking north and up 18 deg.
    f = forms[int(sys.argv[5]) if len(sys.argv) > 5 else 0][0]
    W, H, fov = 960, 600, 70
    eye = np.array([1.5, 1.6, 12.0]); pitch = math.radians(16)
    def proj(p):
        r = p - eye
        # camera looks toward -z, pitched up
        y = r[:, 1] * math.cos(pitch) + r[:, 2] * math.sin(pitch)
        z = -r[:, 2] * math.cos(pitch) + r[:, 1] * math.sin(pitch)
        fpx = W / 2 / math.tan(math.radians(fov / 2))
        zz = np.where(z > .2, z, np.nan)
        return np.c_[W / 2 + r[:, 0] / zz * fpx, H / 2 - y / zz * fpx], zz
    render(f, (W, H), proj).convert('RGB').save(out)

if mode == 'scene':
    sc = json.load(open(sys.argv[5]))
    W, H, fov = 1280, 720, 55
    eye = np.array(sc['eye']); tgt = np.array(sc['target'])
    fwd = tgt - eye; fwd /= np.linalg.norm(fwd)
    right = np.cross(fwd, [0, 1, 0]); right /= np.linalg.norm(right); upv = np.cross(right, fwd)
    fpx = H / 2 / math.tan(math.radians(fov / 2))
    def proj(p):
        r = p - eye
        x, y, z = r @ right, r @ upv, r @ fwd
        zz = np.where(z > .3, z, np.nan)
        return np.c_[W / 2 + x / zz * fpx, H / 2 - y / zz * fpx], zz
    # Merge instances into one pseudo-LOD for painter sorting.
    lod = {'wood': {'p': [], 'n': [], 'i': []}, 'leaf': {'p': [], 'n': [], 'uv': [], 'c': []}}
    for t in sc['trees']:
        src = forms[t['form']][t['lod']]
        c, s_ = math.cos(t['rot']), math.sin(t['rot'])
        R = np.array([[c, 0, s_], [0, 1, 0], [-s_, 0, c]])
        for part, keys in (('wood', ('p', 'n', 'i')), ('leaf', ('p', 'n', 'uv', 'c'))):
            P = np.array(src[part]['p']).reshape(-1, 3)
            N = np.array(src[part]['n']).reshape(-1, 3)
            base = len(lod[part]['p']) // 3
            Pw = (P @ R.T) * t['s'] + np.array([t['x'], t['y'], t['z']])
            lod[part]['p'] += Pw.ravel().tolist(); lod[part]['n'] += (N @ R.T).ravel().tolist()
            if part == 'wood': lod[part]['i'] += (np.array(src[part]['i']) + base).tolist()
            else: lod[part]['uv'] += src[part]['uv']; lod[part]['c'] += src[part]['c']
    img = render(lod, (W, H), proj)
    # Ground under the horizon (drawn behind trees).
    bg = Image.new('RGBA', (W, H), (196, 214, 236, 255)); d = ImageDraw.Draw(bg)
    horizon = H / 2 - (0 - fwd[1]) * fpx
    d.rectangle([0, horizon, W, H], fill=(112, 124, 90, 255))
    arr = np.array(img); sky = (arr[..., 0] == 196) & (arr[..., 1] == 214) & (arr[..., 2] == 236)
    out_arr = np.where(sky[..., None], np.array(bg), arr)
    Image.fromarray(out_arr.astype(np.uint8)).convert('RGB').save(out)
