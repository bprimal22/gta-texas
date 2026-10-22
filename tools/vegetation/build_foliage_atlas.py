"""Build the live-oak foliage spray atlas from ambientCG LeafSet022 (CC0).

Reference-guided authoring, not a botanical scan: individual photographed
leaves (CC0) are recoloured toward the dark olive green of Quercus virginiana,
scaled to ~4-8 cm and stamped along procedurally drawn twigs. Four 512 px tiles,
each representing a ~1.0 m spray card:
  0,1,2: open sprays with sky holes (near/mid cards)
  3:     dense clump (far cards), keeps distant crowns from going see-through
Usage: .venv/bin/python tools/vegetation/build_foliage_atlas.py <LeafSet022 dir> <out dir>
"""
import math, random, sys, json, hashlib, os
from PIL import Image, ImageDraw, ImageFilter
import numpy as np

src, out = sys.argv[1], sys.argv[2]
color = Image.open(os.path.join(src, 'LeafSet022_1K-PNG_Color.png')).convert('RGB')
opacity = Image.open(os.path.join(src, 'LeafSet022_1K-PNG_Opacity.png')).convert('L')
normal = Image.open(os.path.join(src, 'LeafSet022_1K-PNG_NormalGL.png')).convert('RGB')

# Segment the 3x2 source grid into individual leaves (bbox of opacity).
leaves = []
op = np.array(opacity)
for row in range(2):
    for col in range(3):
        x0, x1, y0, y1 = col * 1024 // 3, (col + 1) * 1024 // 3, row * 512, (row + 1) * 512
        cell = op[y0:y1, x0:x1] > 40
        ys, xs = np.nonzero(cell)
        if len(xs) < 500: continue
        box = (x0 + xs.min(), y0 + ys.min(), x0 + xs.max() + 1, y0 + ys.max() + 1)
        c, a, n = color.crop(box), opacity.crop(box), normal.crop(box)
        rgb = np.array(c).astype(np.float32) / 255
        lum = rgb @ np.array([.2126, .7152, .0722], np.float32)
        m = np.array(a) > 128
        leaves.append((c, a, n, float(lum[m].mean())))
print('source leaves', len(leaves))

S = 2  # supersampling
T = 512 * S
# Follow-up 2: brighter, more varied greens (sunlit glossy uppers, olive older
# leaves, a few grey-green undersides) — the first atlas read too dark/flat.
palette = [(74, 96, 42), (86, 108, 48), (64, 86, 38), (98, 118, 54), (80, 100, 50), (108, 120, 62), (118, 126, 84), (90, 104, 66), (70, 92, 46)]

def stamp(canvas_c, canvas_a, canvas_n, leaf, cx, cy, length, angle_deg, shade, rnd):
    c, a, n, mean = leaf
    w, h = c.size
    scale = length / h
    width_squash = .72 + rnd.random() * .12  # live-oak leaves are narrower than the source
    size = (max(2, int(w * scale * width_squash)), max(2, int(length)))
    c2, a2, n2 = c.resize(size, Image.LANCZOS), a.resize(size, Image.LANCZOS), n.resize(size, Image.LANCZOS)
    rgb = np.array(c2).astype(np.float32) / 255
    lum = rgb @ np.array([.2126, .7152, .0722], np.float32)
    detail = np.clip(lum / max(mean, 1e-3), .55, 1.45)[..., None]
    base = np.array(palette[rnd.randrange(len(palette))], np.float32) / 255
    tinted = np.clip(detail * base * shade * 255, 0, 255).astype(np.uint8)
    c3 = Image.fromarray(tinted)
    # Rotate normals' xy with the image rotation (PIL rotates CCW, y up visually).
    nn = np.array(n2).astype(np.float32) / 127.5 - 1
    t = math.radians(angle_deg)
    nx = nn[..., 0] * math.cos(t) - nn[..., 1] * math.sin(t)
    ny = nn[..., 0] * math.sin(t) + nn[..., 1] * math.cos(t)
    nn[..., 0], nn[..., 1] = nx, ny
    n3 = Image.fromarray(np.clip((nn + 1) * 127.5, 0, 255).astype(np.uint8))
    c3, a3, n3 = (im.rotate(angle_deg, resample=Image.BICUBIC, expand=True) for im in (c3, a2, n3))
    # Leaf images point "up" with the petiole at the bottom; anchor the petiole at (cx, cy).
    off = (int(cx - c3.size[0] / 2 + math.sin(t) * length / 2), int(cy - c3.size[1] / 2 - math.cos(t) * length / 2))
    canvas_c.paste(c3, off, a3)
    canvas_n.paste(n3, off, a3)
    canvas_a.paste(Image.new('L', a3.size, 255), off, a3)

def twig(points, draw, width, fill=(74, 62, 50)):
    draw.line(points, fill=fill, width=width, joint='curve')

def spray(seed, dense):
    rnd = random.Random(seed)
    c = Image.new('RGB', (T, T), (60, 76, 38)); a = Image.new('L', (T, T), 0); n = Image.new('RGB', (T, T), (128, 128, 255))
    d = ImageDraw.Draw(c); da = ImageDraw.Draw(a)
    stems = []
    # Main stem from the lower centre, gently crooked.
    x, y, ang = T * (.5 + rnd.uniform(-.05, .05)), T * .97, -90 + rnd.uniform(-12, 12)
    main = [(x, y)]
    for i in range(14):
        ang += rnd.uniform(-14, 14); step = T * .058
        x += math.cos(math.radians(ang)) * step; y += math.sin(math.radians(ang)) * step
        main.append((x, y))
    stems.append(main)
    branches = 12 if dense else 10
    for b in range(branches):
        k = 1 + int((b + rnd.random()) / branches * 11)
        sx, sy = main[k]; side = -1 if b % 2 else 1
        ang = -90 + side * rnd.uniform(30, 80); pts = [(sx, sy)]
        for i in range(rnd.randint(5, 8)):
            ang += rnd.uniform(-16, 16) - side * 4; step = T * .05
            sx += math.cos(math.radians(ang)) * step; sy += math.sin(math.radians(ang)) * step
            sx = min(max(sx, T * .06), T * .94); sy = min(max(sy, T * .05), T * .95)
            pts.append((sx, sy))
        stems.append(pts)
    for s in stems:
        twig(s, d, 5 * S if s is main else 3 * S); twig(s, da, 5 * S if s is main else 3 * S, 255)
    # Leaves: alternate along every stem, denser at tips, darker for interior (drawn first).
    leaf_jobs = []
    for s in stems:
        for i in range(1, len(s)):
            (x0, y0), (x1, y1) = s[i - 1], s[i]
            dirn = math.degrees(math.atan2(y1 - y0, x1 - x0))
            per = 6 if dense else 5
            for j in range(per):
                t = (j + rnd.random()) / per
                px, py = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
                side = 1 if (i * per + j) % 2 else -1
                # Image rotation is CCW; convert the screen direction (y down) to a leaf angle.
                leaf_dir = dirn + side * rnd.uniform(30, 75)
                angle = -(leaf_dir + 90)
                tip_boost = i / len(s)
                leaf_jobs.append((tip_boost + rnd.random() * .5, px, py, angle))
    if dense:
        for i in range(420):
            r, th = T * .42 * math.sqrt(rnd.random()), rnd.random() * math.tau
            leaf_jobs.append((rnd.random(), T / 2 + math.cos(th) * r, T * .48 + math.sin(th) * r * .9, rnd.uniform(0, 360)))
    leaf_jobs.sort()
    for order, px, py, angle in leaf_jobs:
        length = T * rnd.uniform(.06, .095)
        shade = .62 + .45 * min(1, order)
        stamp(c, a, n, leaves[rnd.randrange(len(leaves))], px, py, length, angle, shade, rnd)
    return c, a, n

tiles = [spray(101, False), spray(202, False), spray(303, False), spray(404, True)]
atlas_c = Image.new('RGB', (T * 2, T * 2)); atlas_a = Image.new('L', (T * 2, T * 2)); atlas_n = Image.new('RGB', (T * 2, T * 2))
for i, (c, a, n) in enumerate(tiles):
    off = ((i % 2) * T, (i // 2) * T)
    atlas_c.paste(c, off); atlas_a.paste(a, off); atlas_n.paste(n, off)
atlas_c = atlas_c.resize((1024, 1024), Image.LANCZOS); atlas_a = atlas_a.resize((1024, 1024), Image.LANCZOS)
atlas_n = atlas_n.resize((512, 512), Image.LANCZOS)
# Bleed leaf colour into transparent texels so mip levels do not halo dark/bright.
rgb = np.array(atlas_c).astype(np.float32); al = np.array(atlas_a).astype(np.float32)[..., None] / 255
pre = Image.fromarray(np.clip(rgb * al, 0, 255).astype(np.uint8)); wa = Image.fromarray((al[..., 0] * 255).astype(np.uint8))
blur_c = np.array(pre.filter(ImageFilter.GaussianBlur(6))).astype(np.float32)
blur_a = np.array(wa.filter(ImageFilter.GaussianBlur(6))).astype(np.float32)[..., None] / 255
fill = blur_c / np.maximum(blur_a, 1e-3)
rgb = rgb * al + np.clip(fill, 0, 255) * (1 - al)
final = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).convert('RGBA'); final.putalpha(atlas_a)
os.makedirs(out, exist_ok=True)
final.save(os.path.join(out, 'live-oak-foliage-color.png'), optimize=True)
atlas_n.save(os.path.join(out, 'live-oak-foliage-normal.jpg'), quality=90)
cov = [float((np.array(atlas_a)[(i // 2) * 512:(i // 2 + 1) * 512, (i % 2) * 512:(i % 2 + 1) * 512] > 127).mean()) for i in range(4)]
print('coverage per tile', [round(x, 3) for x in cov])
