// Usage (from the lane root):
//   node lib/campus/render/checks/run-render-checks.mjs [--json]
// Bundles render-checks.ts with vite (SSR), then runs every render-lane check.
// GLSL is validated with glslangValidator when available
// (.work/render-tools/node_modules/glslang-validator-prebuilt-predownloaded, MIT;
// install: cd .work/render-tools && npm install glslang-validator-prebuilt-predownloaded@0.0.2).
import { build } from 'vite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '../../../..');
await build({ configFile: resolve(import.meta.dirname, 'vite.render-checks.config.mjs') });
// Inert browser globals for three/vite-bundled modules.
globalThis.window = globalThis; globalThis.self = globalThis;
globalThis.location ??= { search: '' };
globalThis.requestAnimationFrame ??= () => 0; globalThis.cancelAnimationFrame ??= () => {};
// oxlint-disable-next-line typescript/no-deprecated -- inert stand-in object, not the DOM API
globalThis.document ??= { createElement: () => ({ style: {}, getContext: () => null, addEventListener() {}, removeEventListener() {} }), createElementNS: () => ({ style: {} }) };
const checks = await import(pathToFileURL(resolve(root, '.work/render-checks-dist/render-checks.mjs')).href);
const failures = [];
const report = {};

const viewport = checks.checkViewportSync();
report.viewport = viewport; failures.push(...viewport.failures);
const output = checks.checkAoOutput();
report.aoOutput = output; failures.push(...output.failures);
const shots = checks.checkShots();
report.shots = shots; failures.push(...shots.failures);
const controller = checks.checkShotController();
report.controller = controller; failures.push(...controller.failures);

// Static isolation review: the controller module cannot reach physics state,
// and every game.ts line that touches cameraShots passes only the camera.
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const shotSource = strip(fs.readFileSync(resolve(import.meta.dirname, '../camera-shots.ts'), 'utf8'));
const forbidden = shotSource.match(/\b(body|collider|physics|RAPIER|setTranslation|setNextKinematicTranslation|characterController)\b/g);
if (forbidden) failures.push(`camera-shots.ts references ${[...new Set(forbidden)].join(',')}`);
const gameLines = fs.readFileSync(resolve(root, 'lib/campus/game.ts'), 'utf8').split('\n').filter(l => l.includes('cameraShots'));
for (const l of gameLines) if (/\b(body|collider|physics|controller)\b/.test(l)) failures.push(`game.ts cameraShots line touches physics: ${l.trim()}`);
report.isolation = { forbiddenIdentifiers: forbidden ?? [], gameIntegrationLines: gameLines.map(l => l.trim()) };

const cal = checks.calibration();
report.calibration = cal.results; failures.push(...cal.failures);
const contact = checks.contactAoSmoke();
report.contactAo = contact; failures.push(...contact.failures);

const validator = resolve(root, '.work/render-tools/node_modules/glslang-validator-prebuilt-predownloaded/bin/glslangValidator.' + (process.platform === 'darwin' ? 'darwin' : 'linux'));
const haveValidator = fs.existsSync(validator);
const tmp = resolve(root, '.work/render-glsl'); fs.mkdirSync(tmp, { recursive: true });
report.shaders = {};
for (const search of ['?lighting=legacy&occlusion=off', '', '?shadows=csm', '?shadows=csm&shadowcascades=4', '?fog=height&lighting=legacy', '?occlusion=off']) {
  const { sources, lighting, aoPatched, capturedSkipped, captureStrength, glassBound } = checks.captureShaders(search);
  if (captureStrength !== 1.35) failures.push(`local capture strength ${captureStrength} != declared sky reflection 1.35 (${search})`);
  if (!glassBound) failures.push(`factory glass not bound to the reflection environment (${search})`);
  const unique = new Map();
  for (const s of sources) unique.set(createHash('sha1').update(s.type + s.source).digest('hex'), s);
  let valid = 0; const errors = [];
  if (haveValidator) for (const [hash, s] of unique) {
    // glslang 11.7 reserves the AMD builtin name `average` (used by three's shadow code).
    const file = resolve(tmp, `${hash}.${s.type}`);
    fs.writeFileSync(file, s.source.replace(/\baverage\b/g, 'campusAverageFn'));
    try { execFileSync(validator, ['-S', s.type, file], { encoding: 'utf8' }); valid++; }
    catch (e) { errors.push(`${hash}.${s.type}: ${(e.stdout || String(e)).split('\n').filter(l => l.includes('ERROR')).slice(0, 4).join(' | ')}`); }
  }
  const cascadeChunk = [...unique.values()].some(s => s.source.includes('campusCsmBands'));
  const heightFog = [...unique.values()].some(s => s.source.includes('campusFogRise'));
  report.shaders[search || '(default)'] = { programs: unique.size, validated: haveValidator ? valid : 'validator missing', errors,
    cascadeChunkPresent: cascadeChunk, heightFogPresent: heightFog, shadowMode: lighting.shadows.mode,
    fallbackReason: lighting.shadows.fallbackReason ?? null, aoPatched, capturedSkipped };
  failures.push(...errors.map(e => `GLSL ${search}: ${e}`));
  if (search.includes('csm') && (!cascadeChunk || lighting.shadows.mode !== 'csm')) failures.push(`csm not active for ${search}`);
  if (!search.includes('csm') && cascadeChunk) failures.push(`cascade chunk leaked into ${search || 'default'}`);
  if ((!search.includes('lighting=legacy') || search.includes('fog=height')) !== heightFog) failures.push(`height fog presence wrong for ${search || 'default'}`);
  if (capturedSkipped < 1 && !search.includes('occlusion=off')) failures.push('captured-colour material was not skipped by AO patching');
}
if (!haveValidator) console.warn('glslangValidator not installed; GLSL syntax not validated');

if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 1));
else {
  console.log('SHOTS', shots.count, 'checked;', shots.failures.length, 'failures');
  for (const r of shots.rows) console.log('  ', JSON.stringify(r));
  console.log('CONTROLLER', controller.failures.length ? controller.failures : 'ok', 'camera calls', controller.cameraCalls);
  console.log('ISOLATION', JSON.stringify(report.isolation));
  console.log('CALIBRATION', JSON.stringify(report.calibration, null, 1));
  console.log('CONTACT-AO', JSON.stringify(contact));
  console.log('SHADERS', JSON.stringify(report.shaders, null, 1));
}
if (failures.length) { console.error('FAIL\n' + failures.join('\n')); process.exit(1); }
console.log('RENDER CHECKS PASS');
