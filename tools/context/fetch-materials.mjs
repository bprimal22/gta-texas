// Build-time download of CC0 Poly Haven PBR sets for the generated context
// architecture. Writes public/assets/materials/context/<key>-{color,normal,rough}.jpg
// plus sources.json (url, license, bytes, sha256, processing, mean colour).
// Usage: node tools/context/fetch-materials.mjs   (requires network + ImageMagick `magick`)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const out = resolve(root, 'public/assets/materials/context');
const cache = resolve(root, '.work/material-cache');
mkdirSync(out, { recursive: true });
mkdirSync(cache, { recursive: true });

/** key -> Poly Haven asset, real-world tile size (m) and processing. */
export const SETS = {
  buffBrick: { id: 'brick_wall_003', note: 'tan running-bond brick, clean joints (stand-in for UT buff "Texas blend" brick)' },
  brownBrick: { id: 'yellow_brick', note: 'mixed brown/tan brick (1960s-80s apartments and labs)' },
  limestone: { id: 'sandstone_blocks_08', note: 'smooth large ashlar blocks (stand-in for cream Texas limestone)' },
  precast: { id: 'concrete_wall_008', note: 'smooth precast panels with joints' },
  stucco: { id: 'beige_wall_001', note: 'smooth exterior plaster / stucco' },
  siding: { id: 'white_planks_clean', note: 'painted boards, rotated 90 degrees to read as horizontal lap siding', rotate: 90 },
  metal: { id: 'corrugated_iron_03', note: 'ribbed metal panel; desaturated for neutral tinting', modulate: '100,20' },
  clayTile: { id: 'clay_roof_tiles_02', note: 'red clay barrel tile; courses run along texture v' },
  shingle: { id: 'grey_roof_tiles', note: 'grey roof tiles, desaturated to remove lichen tint (asphalt-shingle stand-in)', modulate: '92,10' },
  membrane: { id: 'gravel_concrete_04', note: 'fine gravel/aggregate roof surface' },
};

const sha = b => createHash('sha256').update(b).digest('hex');
async function get(url, file) {
  if (!existsSync(file)) {
    const r = await fetch(url);
    if (!r.ok) throw Error(`${r.status} ${url}`);
    writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  }
  return readFileSync(file);
}

const records = [];
for (const [key, set] of Object.entries(SETS)) {
  const info = await (await fetch(`https://api.polyhaven.com/info/${set.id}`)).json();
  const files = await (await fetch(`https://api.polyhaven.com/files/${set.id}`)).json();
  const maps = { color: files.Diffuse['1k'].jpg.url, normal: files.nor_gl['1k'].jpg.url, rough: files.Rough['1k'].jpg.url };
  const tile = (info.dimensions?.[0] ?? 2000) / 1000;
  for (const [kind, url] of Object.entries(maps)) {
    const raw = resolve(cache, `${set.id}-${kind}.jpg`);
    const source = await get(url, raw);
    const target = resolve(out, `${key}-${kind}.jpg`);
    const args = [raw];
    if (set.rotate) args.push('-rotate', String(set.rotate));
    if (set.modulate && kind === 'color') args.push('-modulate', set.modulate);
    // Rotating a tangent-space normal map 90 degrees swaps/negates its X/Y channels.
    if (set.rotate === 90 && kind === 'normal') args.push('-channel-fx', 'red<=>green', '-channel', 'G', '-negate', '+channel');
    const size = kind === 'rough' ? 512 : 1024;
    args.push('-resize', `${size}x${size}`, '-strip', '-sampling-factor', '4:2:0', '-quality', kind === 'normal' ? '88' : '82', target);
    execFileSync('magick', args);
    const bytes = readFileSync(target);
    let mean;
    if (kind === 'color') {
      const m = execFileSync('magick', [target, '-colorspace', 'sRGB', '-resize', '1x1!', '-format', '%[fx:int(255*r)],%[fx:int(255*g)],%[fx:int(255*b)]', 'info:']).toString();
      mean = m.split(',').map(Number);
    }
    records.push({
      file: `${key}-${kind}.jpg`, key, map: kind, asset: set.id, source: `https://polyhaven.com/a/${set.id}`, url,
      license: 'CC0-1.0', authors: Object.keys(info.authors ?? {}), tileMetres: tile,
      processing: `${set.rotate ? `rotate ${set.rotate}; ` : ''}${set.modulate && kind === 'color' ? `modulate ${set.modulate}; ` : ''}resize ${size}px; JPEG re-encode`,
      sourceBytes: source.length, sourceSha256: sha(source), bytes: bytes.length, sha256: sha(bytes), ...(mean ? { meanSrgb: mean } : {}),
      note: set.note,
    });
  }
  console.log(key, set.id, tile, 'm');
}
writeFileSync(resolve(out, 'sources.json'), JSON.stringify({
  description: 'CC0 PBR material sets for generated UT/Austin context buildings (lib/campus/context). Downloaded at build time by tools/context/fetch-materials.mjs; shipped locally, no runtime network.',
  files: records,
}, null, 1) + '\n');
const total = records.reduce((s, r) => s + r.bytes, 0);
console.log('files', records.length, 'bytes', total);
