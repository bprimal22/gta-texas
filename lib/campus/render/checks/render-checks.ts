// Node-side render-lane checks (bundled by vite.render-checks.config.mjs and
// executed by run-render-checks.mjs). No browser, no GPU: geometry/data checks,
// controller isolation, numeric light calibration and shader-source capture.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import campusData from '../../../../public/data/campus.json';
import terrainData from '../../../../public/data/terrain.json';
import { Terrain } from '../../terrain';
import { capitolGroundReference } from '../../capitol-area';
import type { CampusData, TerrainData } from '../../types';
import { CAMERA_SHOTS, BLOCK_SHOTS, CameraShotController, SHOT_SUN, shotFocus } from '../camera-shots';
// Terrain/footprint authoring rules apply to the 14 base shots. Block QA shots stand on authored terraces and
// courts or fly; they are validated physically by run-shot-clearance.mjs and run-block-checks.mjs (G5).
const BASE = CAMERA_SHOTS.filter(s => !BLOCK_SHOTS.includes(s as never));
import { AUSTIN_LATE_MORNING, LEGACY_LIGHTING, type LightingPreset } from '../lighting-presets';
import { CampusLighting } from '../lighting';
import { solarPosition, sunDirection } from '../solar';
import {
  acesFilmic, displayedSky, horizonDisplayHex, linearToSrgb8, luminance, skyIrradiance, skyRadiance, srgbHexToLinear,
} from '../sky-model';
import { CampusAmbientOcclusion } from '../../ambient-occlusion';
import { ViewportSync } from '../viewport';
import { createCampusGlazing, bindCampusGlassEnvironment } from '../../campus-glass';
import { CampusLocalReflection } from '../../local-reflection';
import { buildContactAo } from '../contact-ao';
import { createRecordingContext } from './fake-webgl.mjs';

const data = campusData as unknown as CampusData;
const terrain = new Terrain(terrainData as unknown as TerrainData, capitolGroundReference);
const BOUNDS = [-760, -864, 1296, 1536];

function inRing(x: number, z: number, ring: number[][]) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
const footprintsAt = (x: number, z: number) => data.buildings.filter(b => {
  let c = false;
  for (const r of b.rings) if (inRing(x, z, r as number[][])) c = !c;
  return c;
});

export function checkShots() {
  const failures: string[] = [], rows: unknown[] = [];
  const ids = new Set<string>();
  for (const s of BASE) {
    const fail = (m: string) => failures.push(`${s.id}: ${m}`);
    if (ids.has(s.id)) fail('duplicate id');
    ids.add(s.id);
    const nums = [...s.position, ...s.target, s.fov, s.groundY, ...(s.focus ?? [])];
    if (!nums.every(Number.isFinite)) { fail('non-finite value'); continue; }
    const [x, y, z] = s.position;
    for (const [px, pz] of [[x, z], [s.target[0], s.target[2]]])
      if (px < BOUNDS[0] || px > BOUNDS[2] || pz < BOUNDS[1] || pz > BOUNDS[3]) fail(`point ${px},${pz} outside campus bounds`);
    if (s.fov < 30 || s.fov > 90) fail('fov outside 30..90');
    const dist = Math.hypot(s.target[0] - x, s.target[1] - y, s.target[2] - z);
    if (dist < 5) fail('target too close');
    const ground = terrain.height(x, z);
    const datumNote = /datum/i.test(s.note);
    if (Math.abs(ground - s.groundY) > 0.35 && !datumNote) fail(`authored groundY ${s.groundY} vs terrain ${ground.toFixed(2)}`);
    const above = y - Math.max(ground, s.groundY);
    if (above < 1.2) fail(`camera only ${above.toFixed(2)} m above ground`);
    const inside = footprintsAt(x, z).filter(b => y < Math.max(ground, s.groundY) + b.h + 3);
    if (inside.length) fail(`camera inside footprint(s) ${inside.map(b => b.abbr || b.id).join(',')}`);
    // The first 3 m of the view must not start inside a building wall.
    const h = Math.hypot(s.target[0] - x, s.target[2] - z) || 1;
    for (const d of [0.5, 1, 2, 3]) {
      const px = x + (s.target[0] - x) / h * d, pz = z + (s.target[2] - z) / h * d, py = y + (s.target[1] - y) / dist * d;
      const blocked = footprintsAt(px, pz).filter(b => py < Math.max(terrain.height(px, pz), s.groundY) + b.h + 3);
      if (blocked.length) { fail(`view ray enters ${blocked.map(b => b.abbr || b.id).join(',')} at ${d} m`); break; }
    }
    const focus = shotFocus(s);
    if (!focus.every(Number.isFinite)) fail('non-finite focus');
    rows.push({ id: s.id, position: s.position, target: s.target, fov: s.fov, terrainGround: +ground.toFixed(2), authoredGround: s.groundY,
      heightAboveGround: +above.toFixed(2), focus: focus.map(v => +v.toFixed(1)) });
  }
  const solar = solarPosition(new Date(SHOT_SUN.time));
  if (Math.abs(solar.elevationDeg - SHOT_SUN.elevationDeg) > 0.2 || Math.abs(solar.azimuthDeg - SHOT_SUN.azimuthDeg) > 0.2)
    failures.push(`SHOT_SUN ${SHOT_SUN.elevationDeg}/${SHOT_SUN.azimuthDeg} != computed ${solar.elevationDeg.toFixed(2)}/${solar.azimuthDeg.toFixed(2)}`);
  if (!('time' in AUSTIN_LATE_MORNING.sun) || AUSTIN_LATE_MORNING.sun.time !== SHOT_SUN.time) failures.push('SHOT_SUN differs from calibrated preset time');
  return { count: BASE.length, blockShotsValidatedElsewhere: BLOCK_SHOTS.length, failures, rows, solar };
}

export function checkShotController() {
  const failures: string[] = [];
  // A recording camera: every property write and method call is logged.
  const log: string[] = [];
  const position = { set: (...a: number[]) => { log.push(`position.set(${a.join(',')})`); } };
  const camera = new Proxy({ fov: 55, position, lookAt: (...a: number[]) => { log.push(`lookAt(${a.join(',')})`); },
    updateProjectionMatrix: () => { log.push('updateProjectionMatrix'); }, updateMatrixWorld: () => { log.push('updateMatrixWorld'); } }, {
    set: (t, k, v) => { log.push(`set ${String(k)}=${v}`); (t as Record<string, unknown>)[k as string] = v; return true; },
  });
  // Sentinels standing in for the physics objects: frozen, so any write throws.
  const body = Object.freeze({ translation: Object.freeze({ x: 1, y: 2, z: 3 }) });
  const before = JSON.stringify(body);
  const events = new EventTarget();
  const c = new CameraShotController(events, '?shot=pcl-plaza');
  if (!c.apply(camera as never)) failures.push('URL shot did not activate on first apply');
  if (c.snapshot().active !== 'pcl-plaza') failures.push('wrong URL shot');
  const allowed = /^(position\.set|lookAt|updateProjectionMatrix|updateMatrixWorld|set fov=)/;
  const other = log.filter(l => !allowed.test(l));
  if (other.length) failures.push(`controller touched more than the camera: ${other.join('; ')}`);
  if (JSON.stringify(body) !== before) failures.push('body sentinel changed');
  events.dispatchEvent(new Event('keydown'));
  if (c.active) failures.push('keydown did not exit the shot');
  if (c.apply(camera as never)) failures.push('apply after exit still owns the camera');
  c.set('south-mall');
  events.dispatchEvent(new Event('pointerdown'));
  if (c.active) failures.push('pointerdown did not exit');
  c.set('dkr-aerial'); events.dispatchEvent(new Event('wheel'));
  if (c.active) failures.push('wheel did not exit');
  let threw = false;
  try { c.set('no-such-shot'); } catch { threw = true; }
  if (!threw) failures.push('unknown shot id did not throw');
  c.dispose();
  return { failures, cameraCalls: log.length };
}

// ---------- numeric light calibration ----------
const Y = luminance;
function presetSun(p: LightingPreset) {
  const d = 'direction' in p.sun ? p.sun.direction : sunDirection(solarPosition(new Date(p.sun.time)));
  const l = Math.hypot(...d);
  return d.map(v => v / l) as [number, number, number];
}
function groundRadianceRaw(p: LightingPreset, sun: number[]) {
  if (p.environment.groundAlbedo === null) return null;
  const direct = p.sunIntensity * Math.max(0, sun[1]) * Y(srgbHexToLinear(p.sunColor));
  const tint = srgbHexToLinear(p.environment.groundTint), ty = Y(tint);
  return tint.map(c => c / ty * p.environment.groundAlbedo! / Math.PI * direct * 1.25 / p.environment.intensity);
}
/** Irradiance (light units) a surface receives from environment + hemisphere, and from the sun. */
function surfaceIrradiance(p: LightingPreset, n: number[], sun: number[]) {
  const ground = groundRadianceRaw(p, sun);
  // Upper hemisphere from the sky model; lower from ground (or legacy: horizon colour extended downward).
  const env = [0, 0, 0], N = 1600;
  for (let k = 0; k < N; k++) {
    const yv = 1 - 2 * (k + 0.5) / N, r = Math.sqrt(1 - yv * yv), phi = k * 2.399963229728653;
    const d = [Math.cos(phi) * r, yv, Math.sin(phi) * r];
    const c = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
    if (c <= 0) continue;
    let L: number[];
    if (yv >= 0 || !ground) {
      const hd = yv >= 0 ? d : [d[0] / r, 0, d[2] / r];
      L = skyIrradianceSample(hd, sun, p);
    } else L = ground;
    for (let j = 0; j < 3; j++) env[j] += L[j] * c * 4 * Math.PI / N;
  }
  const hemiW = 0.5 * n[1] + 0.5, hs = srgbHexToLinear(p.hemisphere.sky), hg = srgbHexToLinear(p.hemisphere.ground);
  const shade = [0, 1, 2].map(j => env[j] * p.environment.intensity + p.hemisphere.intensity * (hg[j] * (1 - hemiW) + hs[j] * hemiW));
  const ndl = Math.max(0, n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2]);
  const sc = srgbHexToLinear(p.sunColor);
  const lit = [0, 1, 2].map(j => shade[j] + sc[j] * p.sunIntensity * ndl);
  return { shade, lit };
}
function skyIrradianceSample(d: number[], sun: number[], p: LightingPreset) {
  // One radiance sample with the preset's environment saturation.
  const l = displayedSkyRadiance(d, sun, p), y = Y(l), s = p.environment.saturation;
  return l.map(v => y + s * (v - y));
}
const displayedSkyRadiance = (d: number[], sun: number[], p: LightingPreset) => skyRadiance(d, sun, p.sky);

export function calibration() {
  const out: Record<string, unknown> = {};
  const failures: string[] = [];
  const display = (albedo: number, E: number[], exposure: number) => linearToSrgb8(acesFilmic(E.map(v => v * albedo / Math.PI), exposure));
  for (const p of [LEGACY_LIGHTING, AUSTIN_LATE_MORNING]) {
    const sun = presetSun(p);
    const az = Math.atan2(sun[0], -sun[2]);
    const at = (el: number, off: number) => { const e = el * Math.PI / 180, a = az + off; return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)]; };
    const sky: Record<string, number[]> = {};
    for (const el of [90, 30, 10, 3, 1]) {
      sky[`away ${el}deg`] = displayedSky(at(el, Math.PI), sun, p.sky, p.sky.visibleGain, p.exposure);
      sky[`side ${el}deg`] = displayedSky(at(el, Math.PI / 2), sun, p.sky, p.sky.visibleGain, p.exposure);
    }
    const surfaces: Record<string, number[]> = {
      ground: [0, 1, 0],
      'wall facing sun': [sun[0], 0, sun[2]].map(v => v / Math.hypot(sun[0], sun[2])),
      'wall facing away': [-sun[0], 0, -sun[2]].map(v => v / Math.hypot(sun[0], sun[2])),
      'wall side-on': [sun[2], 0, -sun[0]].map(v => v / Math.hypot(sun[0], sun[2])),
    };
    const light: Record<string, unknown> = {};
    for (const [name, n] of Object.entries(surfaces)) {
      const { shade, lit } = surfaceIrradiance(p, n, sun);
      light[name] = {
        shadeIrradiance: shade.map(v => +v.toFixed(2)), litIrradiance: lit.map(v => +v.toFixed(2)),
        shadeOverLit: +(Y(shade) / Y(lit)).toFixed(2),
        limestone55: { lit: display(.55, lit, p.exposure), shade: display(.55, shade, p.exposure) },
        brick30: { lit: display(.30, lit, p.exposure), shade: display(.30, shade, p.exposure) },
        grass12: { lit: display(.12, lit, p.exposure), shade: display(.12, shade, p.exposure) },
      };
    }
    const fogHex = p.fog.color ?? horizonDisplayHex(sun, p.sky, p.sky.visibleGain, p.exposure);
    const fogCurve: Record<string, number[]> = {};
    for (const camY of [1.7, 100]) {
      fogCurve[`camera ${camY} m, ground targets`] = [100, 300, 600, 1000, 1500, 2000].map(d => {
        if (p.fog.kind === 'exp2') return +(1 - Math.exp(-((p.fog.density * d) ** 2))).toFixed(3);
        const rise = -camY;
        const k = Math.max(-30, Math.min(30, p.fog.falloff * rise));
        const shape = Math.abs(k) > 1e-3 ? (1 - Math.exp(-k)) / k : 1 - k / 2;
        const tau = p.fog.density * Math.exp(-p.fog.falloff * (camY - p.fog.baseHeight)) * d * shape;
        const edge = Math.min(1, Math.max(0, (d - p.fog.edgeNear) / (p.fog.edgeFar - p.fog.edgeNear)));
        return +Math.max(1 - Math.exp(-tau), edge * edge * (3 - 2 * edge)).toFixed(3);
      });
    }
    out[p.id] = { sun: solarOf(sun), sky, light, fogColor: '#' + fogHex.toString(16).padStart(6, '0'), fogFactor: fogCurve,
      skyIrradianceUpRaw: skyIrradiance([0, 1, 0], sun, p.sky, p.environment.saturation, 1024).map(v => +v.toFixed(2)) };
  }
  // Acceptance targets (see HANDOFF.md for rationale).
  const cal = out['austin-late-morning'] as { sky: Record<string, number[]>; light: Record<string, { limestone55: { lit: number[]; shade: number[] } }> };
  const leg = out.legacy as typeof cal;
  const z = cal.sky['away 90deg'];
  if (z[2] - z[0] < 90) failures.push(`zenith not a clear blue: ${z.join(',')}`);
  const hz = cal.sky['away 3deg'];
  if ((hz[0] + hz[1] + hz[2]) / 3 > 225) failures.push(`horizon still near-white: ${hz.join(',')}`);
  const litNow = cal.light.ground.limestone55.lit, litWas = leg.light.ground.limestone55.lit;
  if (Math.abs(Y(litNow) - Y(litWas)) > 20) failures.push(`sunlit limestone brightness drifted: ${litNow.join(',')} vs ${litWas.join(',')}`);
  const away = cal.light['wall facing away'].limestone55.shade, awayWas = leg.light['wall facing away'].limestone55.shade;
  if (Y(away) < 90 || Y(away) > 165) failures.push(`shaded wall limestone not deep-but-legible: ${away.join(',')}`);
  if (Y(away) >= Y(awayWas)) failures.push('shaded wall is not deeper than legacy');
  const shadeGround = cal.light.ground.limestone55.shade;
  if (shadeGround[2] - shadeGround[0] > 45) failures.push(`ground shade too blue: ${shadeGround.join(',')}`);
  return { results: out, failures };
}
function solarOf(sun: number[]) {
  return { elevationDeg: +(Math.asin(sun[1]) * 180 / Math.PI).toFixed(2), azimuthDeg: +(((Math.atan2(sun[0], -sun[2]) * 180 / Math.PI) + 360) % 360).toFixed(2) };
}

// ---------- shader capture ----------
function materialsScene() {
  const scene = new THREE.Scene();
  const box = new THREE.BoxGeometry();
  const tex = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  tex.needsUpdate = true;
  const add = (m: THREE.Material, kind: 'mesh' | 'points' | 'line' | 'sprite' | 'instanced' = 'mesh') => {
    const o = kind === 'points' ? new THREE.Points(box, m) : kind === 'line' ? new THREE.Line(box, m)
      : kind === 'sprite' ? new THREE.Sprite(m as THREE.SpriteMaterial)
      : kind === 'instanced' ? new THREE.InstancedMesh(box, m, 2) : new THREE.Mesh(box, m);
    o.castShadow = o.receiveShadow = true;
    scene.add(o);
    return m;
  };
  add(new THREE.MeshStandardMaterial({ map: tex, normalMap: tex, roughnessMap: tex }));
  add(new THREE.MeshStandardMaterial({ alphaTest: .5, map: tex, side: THREE.DoubleSide }), 'instanced');
  add(new THREE.MeshPhysicalMaterial({ clearcoat: .12, roughness: .38 }));
  add(new THREE.MeshLambertMaterial({ map: tex }));
  add(new THREE.MeshPhongMaterial());
  add(new THREE.MeshToonMaterial());
  add(new THREE.ShadowMaterial({ opacity: .4 }));
  add(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  // A captured-colour material that would otherwise receive the AO ACES wrap.
  const captured = add(new THREE.MeshBasicMaterial({ map: tex, toneMapped: true }));
  captured.userData.capturedColor = true;
  add(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true }));
  add(new THREE.PointsMaterial({ size: 2 }), 'points');
  add(new THREE.LineBasicMaterial(), 'line');
  add(new THREE.SpriteMaterial({ map: tex }), 'sprite');
  add(createCampusGlazing('reflective'));
  add(createCampusGlazing('clear'));
  const reflective = add(new THREE.MeshStandardMaterial({ roughness: .1, metalness: .2 })) as THREE.MeshStandardMaterial;
  // Mimics root gdc-glazing.ts: sky strength declared, applied by its own gain only while envMap is null.
  reflective.userData.gdcSkyReflection = 1.35;
  return { scene, reflective };
}

export function captureShaders(search: string) {
  const { canvas, gl, sources } = createRecordingContext();
  const renderer = new THREE.WebGLRenderer({ canvas: canvas as never, context: gl as never });
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const { scene, reflective } = materialsScene();
  const camera = new THREE.PerspectiveCamera(55, 1.6, .12, 2100);
  const sky = new Sky(); sky.scale.setScalar(10000); scene.add(sky);
  const hemisphere = new THREE.HemisphereLight(); scene.add(hemisphere);
  const sun = new THREE.DirectionalLight(); scene.add(sun, sun.target);
  const lighting = new CampusLighting(renderer, scene, sun, sky, { camera, hemisphere, search });
  lighting.update({ x: 0, y: 0, z: 0 });
  bindCampusGlassEnvironment(scene, lighting.reflectionEnvironment.texture);
  const reflection = new CampusLocalReflection(renderer, scene, sky, [], [reflective], null);
  const ao = new CampusAmbientOcclusion(renderer, scene, camera, search);
  ao.prepareMaterials();
  // Direct path and the offscreen (AO) path produce different programs.
  renderer.compile(scene, camera);
  renderer.setRenderTarget(ao.color);
  renderer.compile(scene, camera);
  renderer.setRenderTarget(null);
  // A secondary bake scene with a non-shadow light (vegetation impostor case).
  const bake = new THREE.Scene();
  bake.add(new THREE.HemisphereLight(), new THREE.DirectionalLight());
  bake.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ alphaTest: .3 })));
  renderer.compile(bake, camera);
  const snapshot = lighting.snapshot();
  const captureStrength = reflection.snapshot().strengths[0]?.captureStrength;
  // Declared-strength glass is bound at its declared strength (no double boost).
  const declaredBound = reflective.envMap === lighting.reflectionEnvironment.texture && reflective.envMapIntensity === 1.35;
  const glassBound = declaredBound && (scene.children as THREE.Mesh[]).filter(o => (o.material as THREE.Material | undefined)?.userData?.campusGlass)
    .every(o => (o.material as THREE.MeshPhysicalMaterial).envMap === lighting.reflectionEnvironment.texture);
  const aoSnap = ao.snapshot();
  reflection.dispose(); ao.dispose(); lighting.dispose(); renderer.dispose();
  return { sources: sources as { type: 'vert' | 'frag'; source: string }[], lighting: snapshot,
    aoPatched: aoSnap.patchedLitMaterials, capturedSkipped: aoSnap.capturedColorMaterialsSkipped, captureStrength, glassBound };
}

export function contactAoSmoke() {
  const ring = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  const flat = buildContactAo({ footprints: [{ rings: [ring] }], trees: [{ x: 20, z: 20, radius: 2 }], groundAt: () => 1 });
  const step = buildContactAo({ footprints: [{ rings: [ring] }], groundAt: (x, z) => (x > 10.5 || z > 10.5 || x < -.5 || z < -.5) ? 3 : 1 });
  const failures: string[] = [];
  if (!(flat.stats.quads > 0 && flat.stats.discs === 1)) failures.push('flat contact AO produced no geometry');
  const pos = flat.mesh.geometry.getAttribute('position');
  for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getY(i) - 1.035) > 1e-4) { failures.push('contact AO not lifted 3.5 cm above ground'); break; }
  // Outward band: every outer vertex (alpha 0) must lie outside the footprint.
  const col = flat.mesh.geometry.getAttribute('color');
  for (let i = 0; i < pos.count; i++) if (col.getW(i) === 0 && pos.getX(i) > 0.05 && pos.getX(i) < 9.95 && pos.getZ(i) > 0.05 && pos.getZ(i) < 9.95) { failures.push('band points into the building'); break; }
  if (step.stats.quads !== 0) failures.push('band crossed a 2 m step instead of being dropped');
  flat.dispose(); step.dispose();
  return { failures, stats: flat.stats };
}

/** Exercise both AO output paths against the recording WebGL context. This
 * validates pass count/target lifetime and compiles the fused output shader;
 * image equivalence is checked separately with real browser screenshots. */
export function checkAoOutput() {
  const rows = [];
  const failures: string[] = [];
  for (const search of ['', '?aocomposite=legacy', '?occlusion=off']) {
    const { canvas, gl, sources } = createRecordingContext();
    const renderer = new THREE.WebGLRenderer({ canvas: canvas as never, context: gl as never });
    renderer.setSize(1280, 720, false);
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
    const camera = new THREE.PerspectiveCamera(55, 1280/720, .1, 100);
    camera.position.z = 5;
    const ao = new CampusAmbientOcclusion(renderer, scene, camera, search);
    ao.render(true);
    const snapshot = ao.snapshot();
    const calls = renderer.info.render.calls;
    const expected = search.includes('off') ? 1 : search.includes('legacy') ? 6 : 4;
    if (calls !== expected) failures.push(`${search || 'fused'}: ${calls} draws, expected ${expected}`);
    if (!search && ao.composite.width !== 1) failures.push('fused output allocated a composite buffer');
    if (!search && !sources.some((s: {source:string}) => s.source.includes('campusOcclusion'))) failures.push('fused shader was not compiled');
    ao.render(false);
    if (ao.output.uniforms.campusAOIntensity && ao.output.uniforms.campusAOIntensity.value !== 0) failures.push('AO stayed enabled in overview');
    rows.push({ search, calls, ...snapshot });
    ao.dispose(); renderer.dispose();
  }
  return { rows, failures };
}

export function checkViewportSync() {
  const failures: string[] = [];
  const events = new EventTarget(), original = globalThis.window;
  const fakeWindow = { devicePixelRatio: 2, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) };
  (globalThis as unknown as {window: unknown}).window = fakeWindow;
  try {
    let ratio = 1, sizes = 0, callbacks = 0;
    const size = new THREE.Vector2();
    const renderer = { getSize: (out: THREE.Vector2) => out.copy(size), getPixelRatio: () => ratio,
      setPixelRatio: (v: number) => { ratio = v; }, setSize: (w: number, h: number) => { size.set(w,h); sizes++; } };
    const host = { clientWidth: 1280, clientHeight: 720 }, camera = new THREE.PerspectiveCamera();
    const viewport = new ViewportSync(renderer as unknown as THREE.WebGLRenderer, camera, host as HTMLElement, () => { callbacks++; });
    viewport.apply();
    if (ratio !== 1.5 || sizes !== 1) failures.push('initial HiDPI size/cap incorrect');
    host.clientWidth = 960; host.clientHeight = 600;
    for (let i=0; i<20; i++) events.dispatchEvent(new Event('resize'));
    viewport.apply(); viewport.apply();
    if (sizes !== 2 || callbacks !== 2 || camera.aspect !== 1.6) failures.push('resize burst was not coalesced');
    fakeWindow.devicePixelRatio = 1;
    events.dispatchEvent(new Event('resize')); viewport.apply();
    if (Number(ratio) !== 1 || Number(sizes) !== 3) failures.push('DPR change did not update target sizing');
    viewport.dispose();
    return { failures, sizes, callbacks };
  } finally { (globalThis as unknown as {window:unknown}).window = original; }
}
