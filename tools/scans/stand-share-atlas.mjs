// DKR west stand: share one atlas between the near and far LODs (same UV layout), as the Tower does.
// The far GLB used to embed a byte-identical copy of the 4096x2048 near atlas JPEG, so the game decoded and uploaded the
// same image twice. This post-process (run after build-stand.mjs) tags the near photogrammetry material
// extras.textureKey = 'stand-atlas', replaces the far atlas with a 512x256 downsample of the same image (kept only so the
// far GLB stays a valid standalone asset) tagged extras.textureOfNear = 'stand-atlas', and updates dkr-west-stand.json.
// Runtime: lib/campus/scan-landmarks.ts shareNearTextures() points the far material at the near texture and disposes the
// placeholder before upload. Geometry, UVs and near texels are untouched.
// Usage (tools/node_modules from tools/scans/tower-tools.package.json): node tools/scans/stand-share-atlas.mjs
import { NodeIO } from '@gltf-transform/core';
import { KHRMaterialsUnlit } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
const OUT = new URL('../../public/assets/scans/', import.meta.url).pathname;
const io = new NodeIO().registerExtensions([KHRMaterialsUnlit]);
const KEY = 'stand-atlas', CAPTURED = 'DKR west stand photogrammetry (source photo charts)';
const meta = JSON.parse(readFileSync(OUT + 'dkr-west-stand.json', 'utf8'));
const near = await io.read(OUT + 'dkr-west-stand-near.glb'), far = await io.read(OUT + 'dkr-west-stand-far.glb');
const capturedOf = doc => { const m = doc.getRoot().listMaterials().find(x => x.getName() === CAPTURED); if (!m || !m.getBaseColorTexture()) throw new Error(`${CAPTURED} with a texture missing`); return m; };
const nm = capturedOf(near), fm = capturedOf(far);
const nearJpeg = Buffer.from(nm.getBaseColorTexture().getImage()), farJpeg = Buffer.from(fm.getBaseColorTexture().getImage());
const sha = b => createHash('sha256').update(b).digest('hex');
const alreadyShared = fm.getExtras().textureOfNear === KEY;
if (!alreadyShared && sha(nearJpeg) !== sha(farJpeg)) throw new Error('far atlas is not the near atlas: UV layouts may differ, refusing to share');
nm.setExtras({ ...nm.getExtras(), textureKey: KEY });
if (!alreadyShared) {
  const small = await sharp(nearJpeg).resize(512, 256, { kernel: 'lanczos3' }).jpeg({ quality: 85 }).toBuffer();
  fm.getBaseColorTexture().setImage(small).setName('west stand atlas placeholder (far LOD uses the near atlas at runtime)');
}
fm.setExtras({ ...fm.getExtras(), textureOfNear: KEY });
await io.write(OUT + 'dkr-west-stand-near.glb', near);
await io.write(OUT + 'dkr-west-stand-far.glb', far);
for (const f of meta.files) { const b = readFileSync(OUT + f.name); f.bytes = statSync(OUT + f.name).size; f.sha256 = sha(b); }
meta.files[1].texture = [512, 256];
meta.atlas.far = { size: [512, 256], mode: 'shared: the far material carries extras.textureOfNear = "stand-atlas" and uses the near atlas at runtime (scan-landmarks.ts shareNearTextures); the embedded 512x256 JPEG is a placeholder downsample of the same image, disposed before upload', nearJpegSha256: sha(nearJpeg), tool: 'tools/scans/stand-share-atlas.mjs' };
meta.atlas.budget = 'one 4096x2048 atlas on the GPU for both LODs (scale 1, no source texel loss)';
writeFileSync(OUT + 'dkr-west-stand.json', JSON.stringify(meta));
console.log('near', meta.files[0].bytes, 'far', meta.files[1].bytes);
