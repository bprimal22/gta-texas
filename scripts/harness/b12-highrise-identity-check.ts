// Focused check for lib/campus/blocks/b12-west-campus/highrise-identity (built by b12-highrise-identity.vite.config.mjs).
// The integration plan comes from the FROZEN baseline (highrise-identity/baseline.json), so this check is valid before and
// after the root applies .work/INTEGRATION.json: prior specs = revertPlan(current), patched = applyPlan(current). Every
// profiled record is built with the REAL generator (context/architecture.ts) both ways on its own context.json massing (flat
// ground at its datum) and measured: opening area per type (the facade shader's opening test ported 1:1, R2 samples
// ~16 / m2), opening character, wall family / colour, collider wall + roof shell, top, outward extent, collider triangle
// count (trim topology) and render <-> collider coverage. No browser; no network.
import * as THREE from 'three';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { CATALOG, resolveSpec, resolveSpecWith, type BuildingCatalog, type CatalogEntry } from '../../lib/campus/context/catalog';
import { buildArchitecture, type ArchStats, type MaterialKey } from '../../lib/campus/context/architecture';
import { Batch } from '../../lib/campus/context/batch';
import { PathIndex } from '../../lib/campus/context/paths';
import { ColliderBuilder, cleanRing, orientRings, signedArea, pointInPolygon } from '../../lib/campus/context-geometry';
import type { Massing, Volume, VolumeRole } from '../../lib/campus/context/massing';
import type { Building, CampusData, Point } from '../../lib/campus/types';
import type { BlockMassingVolume } from '../../lib/campus/blocks/types';
import { PROFILES, AUTHORED, LEDGER_EXTRA, RAW_DEEP_WEST_OVER_45, PRESERVED_KEYS, planIntegration, integrationStatus, applyPlan, revertPlan, freezeBaseline, canon, archetypeKey,
  DEEP_WEST_HIGHRISES, applyDeepWestProfiles, OWNERS, type Owner, type Contexts, type Ctx, type Plan, type Baseline } from '../../lib/campus/blocks/b12-west-campus/highrise-identity';
import type { DeepWestBuilding } from '../../lib/campus/extension/deep-west/format';
import b12Json from '../../lib/campus/blocks/b12-west-campus/context.json' with { type: 'json' };
import b11Json from '../../lib/campus/blocks/b11-south-medical/context.json' with { type: 'json' };

type Result = { name: string; pass: boolean; detail: unknown };
const OWNED = 'lib/campus/blocks/b12-west-campus/highrise-identity';
const TYPE: Record<number, string> = { 1: 'punched', 2: 'ribbon', 3: 'glazed', 4: 'open', 5: 'door' };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function prepareRings(source: Point[][]): Point[][] | null {
  const outer = cleanRing(source[0] ?? []);
  if (outer.length < 3 || Math.abs(signedArea(outer)) < 1) return null;
  const holes = source.slice(1).map(r => cleanRing(r)).filter(r => r.length >= 3 && Math.abs(signedArea(r)) > 1);
  return orientRings([outer, ...holes]);
}
/** Owner catalogue as the registry merges it ({...base, ...entry}) plus the owner archetypes. */
function catalogFor(ctxs: Ctx[]): BuildingCatalog {
  const buildings: Record<string, CatalogEntry> = { ...CATALOG.buildings };
  for (const c of ctxs) for (const [id, e] of Object.entries(c.catalog ?? {})) { const { evidence: _e, ...entry } = e; buildings[id] = { ...(buildings[id] ?? { archetype: 'master-plan', basis: 'district-default', district: c.block, note: '' }), ...entry } as CatalogEntry; }
  const archetypes = { ...CATALOG.archetypes };
  for (const c of ctxs) Object.assign(archetypes, c.archetypes ?? {});
  return { ...CATALOG, buildings, archetypes };
}
function massingOf(b: Building, rings: Point[][], vols: BlockMassingVolume[], datum: unknown, cat: BuildingCatalog, only?: Set<number>): Massing {
  const volumes: Volume[] = [];
  vols.forEach((v, i) => {
    if (only && !only.has(i)) return;
    volumes.push({ rings: v.rings ?? (v.ring ? [v.ring] : rings), bottom: v.bottom, top: v.top, roof: v.roof, slope: v.slope ?? (v.roof === 'flat' ? 0 : 0.45),
      role: (v.role ?? 'main') as VolumeRole, ...(v.archetype ? { spec: resolveSpecWith(b, v.archetype, cat) } : {}) });
  });
  const d = datum as undefined | 'grade' | 'campusY' | { aboveY: number };
  return { volumes, source: 'block', height: Math.max(...volumes.map(v => v.top)), heightBase: d === undefined || d === 'grade' ? undefined : d === 'campusY' ? 0 : d.aboveY };
}
const zeroStats = (): ArchStats => ({ triangles: 0, colliderTriangles: 0, hipRoofs: 0, flatRoofs: 0, failedRoofs: 0, volumes: 0, tierVolumes: 0, mechVolumes: 0, estimatedMech: 0, doors: 0, storefrontEdges: 0, sunshades: 0, openings: 0 });
function build(b: Building, rings: Point[][], cat: BuildingCatalog, m: Massing, paths: PathIndex, g0: number) {
  const batches = new Map<MaterialKey, Batch>(), collider = new ColliderBuilder(), stats = zeroStats();
  const batch = (k: MaterialKey) => { let x = batches.get(k); if (!x) { x = new Batch(k.startsWith('wall:')); batches.set(k, x); } return x; };
  buildArchitecture(b, rings, resolveSpec(b, cat), m, { batch, collider, stats, ground: () => g0, paths });
  return { batches, collider, stats };
}
/** The facade shader's opening test (materials.ts FACADE_FRAGMENT) on an R2 low-discrepancy point set per vertical wall triangle,
 * ~16 samples / m2 (0.25 m spacing, finer than any window module; a fixed lattice aliases against the bay grid). */
function facade(batches: Map<MaterialKey, Batch>) {
  const area: Record<string, number> = {}, fam: Record<string, { a: number; r: number; g: number; b: number }> = {};
  let upper = 0, ribbonCont = 0, ribbonW = 0, vert = 0, vertW = 0, storey = 0;
  const v3 = new THREE.Vector3(), w3 = new THREE.Vector3();
  for (const [key, bt] of batches) {
    if (!bt.facade) continue;
    for (let t = 0; t < bt.index.length; t += 3) {
      const ids = [bt.index[t], bt.index[t + 1], bt.index[t + 2]];
      if (Math.abs(bt.normal[ids[0] * 3 + 1]) > 0.1) continue;
      const P = ids.map(i => new THREE.Vector3(bt.position[i * 3], bt.position[i * 3 + 1], bt.position[i * 3 + 2]));
      const A = v3.subVectors(P[1], P[0]).cross(w3.subVectors(P[2], P[0])).length() / 2;
      if (A < 1e-6) continue;
      const fac = ids.map(i => [bt.fac[i * 4], bt.fac[i * 4 + 1], bt.fac[i * 4 + 2], bt.fac[i * 4 + 3]]);
      const win = [bt.win[ids[0] * 4], bt.win[ids[0] * 4 + 1], bt.win[ids[0] * 4 + 2], bt.win[ids[0] * 4 + 3]], r0 = bt.range[ids[0] * 2], r1 = bt.range[ids[0] * 2 + 1];
      const code = Math.floor(win[3] + 0.5), type = code % 8;
      if ((fac[0][1] + fac[1][1] + fac[2][1]) / 3 < 1) continue; // upper storeys only
      upper += A;
      if (!(code > 0)) continue;
      const f = fam[key] ??= { a: 0, r: 0, g: 0, b: 0 };
      f.a += A; for (const i of ids) { f.r += bt.color[i * 3] * A / 3; f.g += bt.color[i * 3 + 1] * A / 3; f.b += bt.color[i * 3 + 2] * A / 3; }
      const bw = (fac[0][2] + fac[1][2] + fac[2][2]) / 3, fh = (fac[0][3] + fac[1][3] + fac[2][3]) / 3, wmC = win[0] * bw, hmC = (win[2] - win[1]) * fh;
      ribbonCont += win[0] * A; ribbonW += A; if (win[2] - win[1] >= 0.8) storey += A;
      if (wmC > 0) { vert += (hmC / wmC >= 2.5 && win[2] - win[1] >= 0.85 ? 1 : 0) * A; vertW += A; }
      const S = Math.min(400000, Math.max(64, Math.ceil(A * 16)));
      for (let n = 0; n < S; n++) {
        let u = (0.5 + 0.7548776662466927 * (n + 1)) % 1, v = (0.5 + 0.5698402909980532 * (n + 1)) % 1; if (u + v > 1) { u = 1 - u; v = 1 - v; }
        const w0 = 1 - u - v, F = [0, 1, 2, 3].map(k => w0 * fac[0][k] + u * fac[1][k] + v * fac[2][k]);
        if (!(F[2] > 0.01 && F[3] > 0.01)) continue;
        const k = Math.floor(F[1]); if (!(k >= r0 - 0.5 && k <= r1 + 0.5)) continue;
        const fr = (x: number) => x - Math.floor(x);
        const wm = win[0] * F[2], xm = (fr(F[0]) - 0.5 + win[0] * 0.5) * F[2], hm = (win[2] - win[1]) * F[3], ym = (fr(F[1]) - win[1]) * F[3];
        if (xm >= 0 && xm <= wm && ym >= 0 && ym <= hm) area[TYPE[type] ?? 'other'] = (area[TYPE[type] ?? 'other'] ?? 0) + A / S;
      }
    }
  }
  const openings = Object.values(area).reduce((s, x) => s + x, 0), glass = (area.punched ?? 0) + (area.ribbon ?? 0) + (area.glazed ?? 0);
  const dom = Object.entries(fam).sort((a, b) => b[1].a - a[1].a)[0];
  return { glassFraction: upper ? glass / upper : 0, byType: Object.fromEntries(Object.entries(area).map(([k, v]) => [k, +v.toFixed(1)])), openings,
    dominantFamily: dom ? dom[0] : null, dominantColor: dom ? new THREE.Color(dom[1].r / dom[1].a, dom[1].g / dom[1].a, dom[1].b / dom[1].a) : null,
    widthPerBay: ribbonW ? ribbonCont / ribbonW : 0, verticalShare: vertW ? vert / vertW : 0, storeyHighShare: ribbonW ? storey / ribbonW : 0 };
}
/** Collider triangles whose three vertices all lie on a volume / footprint ring boundary (walls + roof decks = the body shell). */
function shell(c: ColliderBuilder, rings: Point[][]) {
  const segs: [number, number, number, number][] = [];
  for (const r of rings) for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; segs.push([a[0], a[1], b[0], b[1]]); }
  const on = (x: number, z: number) => segs.some(([ax, az, bx, bz]) => { const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz, t = l ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l)) : 0; return Math.hypot(ax + t * dx - x, az + t * dz - z) < 2e-3; });
  const out: string[] = []; let maxY = -Infinity; const p = c.position;
  for (let i = 0; i < p.length; i += 9) {
    maxY = Math.max(maxY, p[i + 1], p[i + 4], p[i + 7]);
    if (on(p[i], p[i + 2]) && on(p[i + 3], p[i + 5]) && on(p[i + 6], p[i + 8])) out.push([0, 1, 2].map(k => [p[i + k * 3], p[i + k * 3 + 1], p[i + k * 3 + 2]].map(x => x.toFixed(3)).join(',')).sort().join('|'));
  }
  return { set: out.sort(), maxY };
}
function maxOutside(c: ColliderBuilder, ring: Point[]) {
  let worst = 0; const p = c.position;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], z = p[i + 2]; if (pointInPolygon(x, z, [ring])) continue;
    let d = Infinity; for (let k = 0; k < ring.length; k++) { const a = ring[k], b = ring[(k + 1) % ring.length], dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz, t = l ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l)) : 0; d = Math.min(d, Math.hypot(a[0] + t * dx - x, a[1] + t * dz - z)); }
    worst = Math.max(worst, d);
  }
  return worst;
}
/** render <-> collider coverage: collider triangle centroids NOT lying on (2 mm) any render triangle, and vertical render wall
 * triangle centroids NOT lying on any collider triangle (parapet inner faces / soffits have no collider by generator design).
 * The invariant is that a profile adds no new uncovered (render-only / collider-only) triangle; shares are reported. */
function coverage(batches: Map<MaterialKey, Batch>, c: ColliderBuilder) {
  type T = { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; min: THREE.Vector3; max: THREE.Vector3; n: THREE.Vector3 };
  const mk = (a: THREE.Vector3, b: THREE.Vector3, cc: THREE.Vector3): T | null => { const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(cc, a)); if (n.lengthSq() < 1e-12) return null; n.normalize(); return { a, b, c: cc, n, min: a.clone().min(b).min(cc).subScalar(0.003), max: a.clone().max(b).max(cc).addScalar(0.003) }; };
  const render: T[] = [], renderWalls: THREE.Vector3[] = [], coll: T[] = [];
  for (const [key, bt] of batches) for (let t = 0; t < bt.index.length; t += 3) {
    const P = [0, 1, 2].map(k => { const i = bt.index[t + k]; return new THREE.Vector3(bt.position[i * 3], bt.position[i * 3 + 1], bt.position[i * 3 + 2]); });
    const tri = mk(P[0], P[1], P[2]); if (!tri) continue; render.push(tri);
    if (key.startsWith('wall:') && Math.abs(tri.n.y) < 0.1) renderWalls.push(P[0].clone().add(P[1]).add(P[2]).divideScalar(3));
  }
  const p = c.position;
  for (let i = 0; i < p.length; i += 9) { const tri = mk(new THREE.Vector3(p[i], p[i + 1], p[i + 2]), new THREE.Vector3(p[i + 3], p[i + 4], p[i + 5]), new THREE.Vector3(p[i + 6], p[i + 7], p[i + 8])); if (tri) coll.push(tri); }
  const on = (q: THREE.Vector3, list: T[]) => list.some(t => {
    if (q.x < t.min.x || q.x > t.max.x || q.y < t.min.y || q.y > t.max.y || q.z < t.min.z || q.z > t.max.z) return false;
    if (Math.abs(t.n.dot(new THREE.Vector3().subVectors(q, t.a))) > 0.002) return false;
    const v0 = new THREE.Vector3().subVectors(t.c, t.a), v1 = new THREE.Vector3().subVectors(t.b, t.a), v2 = new THREE.Vector3().subVectors(q, t.a);
    const d00 = v0.dot(v0), d01 = v0.dot(v1), d02 = v0.dot(v2), d11 = v1.dot(v1), d12 = v1.dot(v2), inv = 1 / (d00 * d11 - d01 * d01);
    const u = (d11 * d02 - d01 * d12) * inv, v = (d00 * d12 - d01 * d02) * inv; return u >= -1e-4 && v >= -1e-4 && u + v <= 1 + 1e-4;
  });
  const collCent = coll.map(t => t.a.clone().add(t.b).add(t.c).divideScalar(3));
  const colliderUncovered = collCent.filter(q => !on(q, render)).length, renderWallUncovered = renderWalls.filter(q => !on(q, coll)).length;
  return { colliderUncovered, renderWallUncovered, colliderOnRender: 1 - colliderUncovered / Math.max(1, collCent.length), renderWallOnCollider: 1 - renderWallUncovered / Math.max(1, renderWalls.length) };
}
const hsl = (c: THREE.Color) => { const o = { h: 0, s: 0, l: 0 }; c.getHSL(o); return o; };

export async function run(root: string, opts: { emit?: boolean; freeze?: boolean } = {}) {
  const t0 = performance.now(), results: Result[] = [];
  const check = (name: string, pass: boolean, detail: unknown) => { results.push({ name, pass, detail }); };
  const campus = JSON.parse(readFileSync(resolve(root, 'public/data/campus.json'), 'utf8')) as CampusData;
  campus.buildings.forEach((b, i) => { b.key ??= `${b.id}:${i}`; });
  const byKey = new Map(campus.buildings.map(b => [b.key!, b]));
  const real: Contexts = { 'b12-west-campus': clone(b12Json) as unknown as Ctx, 'b11-south-medical': clone(b11Json) as unknown as Ctx };
  const paths = new PathIndex(campus.paths);

  // ------------------------------------------------------------ 1. frozen baseline, plan, mode of the CURRENT owner contexts
  const baselineFile = resolve(root, OWNED, 'baseline.json');
  if (opts.freeze) writeFileSync(baselineFile, JSON.stringify(freezeBaseline(real), null, 1) + '\n');
  if (!existsSync(baselineFile)) { check('frozen baseline.json present', false, { baselineFile }); return { pass: false, mode: 'no-baseline', ms: 0, results }; }
  const baseline = JSON.parse(readFileSync(baselineFile, 'utf8')) as Baseline;
  const plan = planIntegration(baseline, CATALOG.archetypes);
  check('plan from the frozen baseline builds without errors (16 profiles)', plan.errors.length === 0 && PROFILES.length === 16 && plan.scopes.length === 16 && new Set(PROFILES.map(p => p.key)).size === 16, { errors: plan.errors, ops: plan.ops.length, guards: plan.guards.length });
  const status = integrationStatus(real, plan, baseline);
  check('current owner contexts are exactly baseline or exactly fully applied', status.mode === 'baseline' || status.mode === 'applied', status);
  const allowed = (o: { path: (string | number)[] }) => (o.path[0] === 'archetypes' && o.path.length <= 2) || (o.path[0] === 'catalog' && o.path.length === 3 && ['archetype', 'note', 'evidence'].includes(String(o.path[2])))
    || (o.path[0] === 'massing' && ((o.path.length === 5 && o.path[2] === 'volumes' && o.path[4] === 'archetype') || (o.path.length === 3 && o.path[2] === 'evidence')));
  check('ops touch only archetypes / catalog archetype+note+evidence / per-volume archetype / massing evidence', plan.ops.every(allowed), plan.ops.filter(o => !allowed(o)).map(o => o.path));
  const evBad = plan.ops.filter(o => o.path[o.path.length - 1] === 'evidence').filter(o => { const v = o.value as Record<string, unknown>, pr = o.prior as Record<string, unknown>;
    return canon(Object.keys(v).sort()) !== canon(['basis', 'note', 'source']) || !String(v.source).startsWith(String(pr.source)) || String(v.note).includes('facade = generic archetype') || !/facade = highrise-identity profile/.test(String(v.note)); });
  check('evidence patches keep {source,basis,note}, keep the identity source, replace the stale generic-facade note', evBad.length === 0, { evidencePatches: plan.ops.filter(o => o.path[o.path.length - 1] === 'evidence').map(o => o.path.join('.')), evBad: evBad.map(o => o.path.join('.')) });
  const badPrefix = Object.keys(plan.archetypes).filter(k => !PROFILES.some(p => k.startsWith(p.owner + ':')));
  const preservedBad: string[] = [];
  for (const p of PROFILES) for (const local of Object.keys(p.archetypes)) {
    const a = plan.archetypes[archetypeKey(p, local)] as unknown as Record<string, unknown>, prior = CATALOG.archetypes[p.priorArchetype] as unknown as Record<string, unknown>;
    for (const k of PRESERVED_KEYS) if (JSON.stringify(a?.[k]) !== JSON.stringify(prior[k])) preservedBad.push(`${p.id}/${local}.${k}`);
  }
  check('owner-prefixed archetype keys; envelope keys (roof, parapet, cornice, belt, plinth, sunshades) copied from the prior archetype', badPrefix.length === 0 && preservedBad.length === 0, { archetypes: Object.keys(plan.archetypes), badPrefix, preservedBad });

  // ------------------------------------------------------------ 2. lifecycle: baseline <-> applied, partial / tampered rejected
  const baseCtx = revertPlan(real, plan), applied = applyPlan(baseCtx, plan), st = (c: Contexts) => integrationStatus(c, plan, baseline).mode;
  check('lifecycle: revert(current) = baseline, apply(baseline) = applied, apply is idempotent, revert(applied) = baseline',
    st(baseCtx) === 'baseline' && st(applied) === 'applied' && canon(applyPlan(applied, plan)) === canon(applied) && canon(revertPlan(applied, plan)) === canon(baseCtx)
    && canon(baseCtx['b12-west-campus'].massing) === canon((b12Json as unknown as Ctx).massing) || status.mode === 'applied', { baseline: st(baseCtx), applied: st(applied) });
  const without = (pred: (o: Plan['ops'][number]) => boolean) => { const i = plan.ops.findIndex(pred); return applyPlan(baseCtx, { ...plan, ops: plan.ops.filter((_, k) => k !== i) }); };
  const tamper = (f: (c: Contexts) => void) => { const c = clone(applied); f(c); return c; };
  const b12 = (c: Contexts) => c['b12-west-campus'];
  const variants: Record<string, Contexts> = {
    'partial: one archetype definition missing': without(o => o.path[0] === 'archetypes' && o.path.length === 2),
    'partial: one catalog archetype not switched': without(o => o.path[0] === 'catalog' && o.path[2] === 'archetype'),
    'partial: one per-volume archetype missing': without(o => o.path[0] === 'massing' && o.path[4] === 'archetype'),
    'partial: one evidence patch missing': without(o => o.path[o.path.length - 1] === 'evidence'),
    'partial: b11 patch not applied': applyPlan(baseCtx, { ...plan, ops: plan.ops.filter(o => !o.file.includes('b11')) }),
    'tamper: archetype content edited (linden window width)': tamper(c => { b12(c).archetypes!['b12-west-campus:linden'].window.width += 0.3; }),
    'tamper: Ion archetype on the wrong volume (2 instead of 1)': tamper(c => { const v = b12(c).massing!['622603:771'].volumes; delete v[1].archetype; v[2].archetype = 'b12-west-campus:ion'; }),
    'tamper: catalog archetype neither baseline nor target': tamper(c => { b12(c).catalog!['683551'].archetype = 'wc-tower'; }),
    'tamper: Clements low wing given the tower archetype (guard)': tamper(c => { b12(c).massing!['486277:108'].volumes[0].archetype = 'b12-west-campus:clements'; }),
    'tamper: massing drift (Rise top +1 m)': tamper(c => { b12(c).massing!['554717:450'].volumes[0].top += 1; }),
  };
  const modes = Object.fromEntries(Object.entries(variants).map(([k, c]) => [k, st(c)]));
  check('incomplete / tampered / drifted contexts are rejected (never baseline or applied)', Object.entries(modes).every(([k, m]) => k.startsWith('partial') ? m === 'partial' : m === 'conflict'), modes);
  const strip = (c: Ctx) => canon({ massing: Object.fromEntries(Object.entries(c.massing ?? {}).map(([k, m]) => [k, { ...m, evidence: null, volumes: m.volumes.map(v => ({ ...v, archetype: null })) }])),
    catalog: Object.fromEntries(Object.entries(c.catalog ?? {}).map(([k, e]) => [k, { ...e, archetype: null, note: null, evidence: null }])), footprints: c.footprints, exclude: c.exclude, add: c.add, replaces: c.replaces });
  check('applied vs baseline: rings / heights / datums / footprints / excludes / adds / replaces / other catalog fields identical', OWNERS.every(o => strip(baseCtx[o]) === strip(applied[o])), {});
  const authoredKeys = new Set([...Object.keys(real['b12-west-campus'].replaces ?? {}), ...AUTHORED.map(a => a.key)]);
  const touchesAuthored = plan.ops.filter(o => (o.path[0] === 'massing' && authoredKeys.has(String(o.path[1]))) || (o.path[0] === 'catalog' && [...authoredKeys].some(k => k.split(':')[0] === String(o.path[1]))));
  check('no op touches an authored / replaced record', touchesAuthored.length === 0, touchesAuthored.map(o => o.path));

  // ------------------------------------------------------------ 3. generator measurements (from current contexts, and from the simulated applied state)
  const measure = (current: Contexts) => {
    const pri = revertPlan(current, plan), now = applyPlan(current, plan);
    const priorCat = catalogFor(OWNERS.map(o => pri[o])), newCat = catalogFor(OWNERS.map(o => now[o]));
    const out: Record<string, Record<string, unknown> & { pass: boolean }> = {};
    for (const p of PROFILES) {
      const b = byKey.get(p.key)!, rings = prepareRings(b.rings)!;
      const priorM = pri[p.owner].massing?.[p.key], newM = now[p.owner].massing?.[p.key];
      const scope = plan.scopes.find(s => s.profile === p.id)!, primaryKey = archetypeKey(p, p.primary);
      const scoped = new Set(scope.mode === 'catalog' ? (priorM ? priorM.volumes.map((_, i) => i) : [0]) : scope.volumes.filter(v => v.archetype === primaryKey).map(v => v.index));
      const datum = priorM?.datum, g0 = datum && typeof datum === 'object' ? datum.aboveY : 0;
      const mk = (m: typeof priorM, cat: BuildingCatalog, only?: Set<number>): Massing => m ? massingOf(b, rings, m.volumes, m.datum, cat, only)
        : { volumes: [{ rings, bottom: 0, top: b.h, roof: 'flat', slope: 0, role: 'main' }], source: 'block', height: b.h };
      const fp = facade(build(b, rings, priorCat, mk(priorM, priorCat, priorM ? scoped : undefined), paths, g0).batches);
      const fn = facade(build(b, rings, newCat, mk(newM, newCat, newM ? scoped : undefined), paths, g0).batches);
      const f = p.archetypes[p.primary], ratio = fp.glassFraction > 0 ? fn.glassFraction / fp.glassFraction : Infinity;
      const share = fn.openings ? (fn.byType[p.expect.upperType] ?? 0) / fn.openings : 0;
      const dirOk = p.expect.glazing === 'more' ? ratio >= 1.15 : p.expect.glazing === 'less' ? ratio <= 0.9 : ratio >= 0.75 && ratio <= 1.33;
      const charOk = !p.expect.character || (p.expect.character === 'band' ? fn.widthPerBay >= 0.85 : p.expect.character === 'storey-high' ? fn.storeyHighShare >= 0.9 : fn.verticalShare >= 0.9);
      // colour: generator per-building variation is L +-0.035, s x[0.9, 1.1], h +-0.006 (catalog.ts) -> accept exactly that window
      const hs = hsl(new THREE.Color(f.wallColor)), hm = fn.dominantColor ? hsl(fn.dominantColor) : null;
      const dh = hm ? Math.min(Math.abs(hm.h - hs.h), 1 - Math.abs(hm.h - hs.h)) : 1;
      const colourOk = !!hm && Math.abs(hm.l - hs.l) <= 0.0355 && (hs.s < 0.04 || (hm.s / hs.s >= 0.895 && hm.s / hs.s <= 1.105 && dh <= 0.0065));
      const famOk = fn.dominantFamily === `wall:${f.wall}`;
      // body envelope, trim topology and render = collider on the FULL massing
      const ePrior = build(b, rings, priorCat, mk(priorM, priorCat), paths, g0), eNew = build(b, rings, newCat, mk(newM, newCat), paths, g0);
      const volRings = [rings[0], ...(priorM ? priorM.volumes.flatMap(v => v.rings ?? (v.ring ? [v.ring] : [])) : [])];
      const sp = shell(ePrior.collider, volRings), sn = shell(eNew.collider, volRings);
      const shellSame = sp.set.length === sn.set.length && sp.set.every((x, i) => x === sn.set[i]);
      const outP = maxOutside(ePrior.collider, rings[0]), outN = maxOutside(eNew.collider, rings[0]);
      const mainRings = mk(priorM, priorCat).volumes.find(v => v.role === 'main')?.rings ?? [rings[0]];
      const beltTris = 4 * mainRings.reduce((s, r) => s + r.filter((q, i) => Math.hypot(r[(i + 1) % r.length][0] - q[0], r[(i + 1) % r.length][1] - q[1]) >= 1e-3).length, 0);
      const trimDelta = ePrior.collider.triangles - eNew.collider.triangles, trimOk = trimDelta === (p.trim?.beltDropped ? beltTris : 0);
      const cP = coverage(ePrior.batches, ePrior.collider), cN = coverage(eNew.batches, eNew.collider);
      const rcOk = cN.colliderUncovered <= cP.colliderUncovered && cN.renderWallUncovered <= cP.renderWallUncovered;
      const envOk = shellSame && Math.abs(sp.maxY - sn.maxY) < 1e-6 && outN <= Math.max(outP, 0.1) + 1e-6 && eNew.stats.sunshades === 0;
      out[p.id] = { key: p.key, pass: dirOk && share >= 0.9 && charOk && colourOk && famOk && envOk && trimOk && rcOk, scopeVolumes: [...scoped],
        glass: { prior: +fp.glassFraction.toFixed(3), now: +fn.glassFraction.toFixed(3), ratio: +ratio.toFixed(2), expect: p.expect.glazing, ok: dirOk },
        openingsByType: { prior: fp.byType, now: fn.byType }, typeShare: { type: p.expect.upperType, share: +share.toFixed(3) },
        character: { expect: p.expect.character ?? null, widthPerBay: +fn.widthPerBay.toFixed(2), verticalShare: +fn.verticalShare.toFixed(2), storeyHighShare: +fn.storeyHighShare.toFixed(2), ok: charOk },
        family: { prior: fp.dominantFamily, now: fn.dominantFamily, expect: `wall:${f.wall}`, ok: famOk },
        colour: { source: f.wallColor, rendered: fn.dominantColor ? '#' + fn.dominantColor.getHexString() : null, prior: fp.dominantColor ? '#' + fp.dominantColor.getHexString() : null, ok: colourOk },
        envelope: { bodyShellTriangles: sn.set.length, bodyShellIdentical: shellSame, maxY: [+sp.maxY.toFixed(3), +sn.maxY.toFixed(3)], maxOutside: [+outP.toFixed(3), +outN.toFixed(3)], ok: envOk },
        trim: { colliderTriangles: [ePrior.collider.triangles, eNew.collider.triangles], expectedDelta: p.trim?.beltDropped ? beltTris : 0, declared: p.trim?.reason ?? null, ok: trimOk },
        renderCollider: { colliderUncovered: [cP.colliderUncovered, cN.colliderUncovered], renderWallUncovered: [cP.renderWallUncovered, cN.renderWallUncovered], colliderCentroidsOnRender: [+cP.colliderOnRender.toFixed(4), +cN.colliderOnRender.toFixed(4)], renderWallCentroidsOnCollider: [+cP.renderWallOnCollider.toFixed(4), +cN.renderWallOnCollider.toFixed(4)], ok: rcOk },
        basis: p.evidence.basis };
    }
    return out;
  };
  const perProfile = measure(real);
  for (const p of PROFILES) { const r = perProfile[p.id], f = p.archetypes[p.primary];
    check(`profile ${p.id} (${p.key}): glazing ${p.expect.glazing}, ${p.expect.upperType}${p.expect.character ? ' ' + p.expect.character : ''}, ${f.wall} ${f.wallColor}, body envelope + render=collider kept${p.trim ? ', declared belt trim side effect' : ''}`, r.pass, r); }
  const perApplied = measure(applied);
  check('simulated fully applied contexts measure identically (check is valid after integration)', canon(perApplied) === canon(perProfile), { ids: Object.keys(perApplied).length });

  // ------------------------------------------------------------ 4. authored towers: root-patch anchors, nothing rebuilt here
  const anchors = AUTHORED.flatMap(a => (a.rootPatches ?? []).map(rp => { const text = readFileSync(resolve(root, rp.file), 'utf8'); return { key: a.key, file: rp.file, old: text.split(rp.new).join('').split(rp.old).length - 1, new: text.split(rp.new).length - 1 }; }));
  check('authored root patches: each anchors exactly once (or is already applied exactly once)', anchors.every(a => (a.old === 1 && a.new === 0) || (a.old === 0 && a.new === 1)), anchors);
  const ownedFiles = readdirSync(resolve(root, OWNED)).filter(f => f.endsWith('.ts'));
  const ownedSrc = ownedFiles.map(f => [f, readFileSync(resolve(root, OWNED, f), 'utf8')] as const);
  const badImports = ownedSrc.flatMap(([f, s]) => [...s.matchAll(/from\s+'([^']+)'/g)].map(m => [f, m[1]] as const).filter(([, spec]) => /^https?:|\/towers|\/district|\/kit|\/massing'|\/church|\/coop|\/pbr|\/roof/.test(spec)));
  const remote = ownedSrc.filter(([, s]) => /\bfetch\(|XMLHttpRequest|import\(\s*['"]https?:|new\s+URL\(/.test(s)).map(([f]) => f);
  check('owned modules: no authored-geometry imports, no remote runtime dependency', badImports.length === 0 && remote.length === 0, { files: ownedFiles, badImports, remote });

  // ------------------------------------------------------------ 5. deep-West: raw 3 vs runtime 2, profile parity
  const raw = gunzipSync(readFileSync(resolve(root, 'public/assets/extension/deep-west-v1.bin.gz')));
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const meta = JSON.parse(new TextDecoder().decode(raw.subarray(20, 20 + view.getUint32(8, true)))) as { buildings: DeepWestBuilding[] };
  const runtimeTall = meta.buildings.filter(b => b.heightMeters > 45).map(b => b.key).sort();
  const mtxt = readFileSync(resolve(root, 'public/assets/extension/deep-west-v1.manifest.json'), 'utf8').replace(/\s+/g, ''), i470 = mtxt.indexOf('"coa-2023:470235"');
  const seamReason = i470 >= 0 && /eastseamx=-760/.test(mtxt.slice(i470, i470 + 260));
  const after = applyDeepWestProfiles(meta.buildings);
  const geomSame = after.every((b, i) => { const { wall: _w1, ...x } = meta.buildings[i]; const { wall: _w2, ...y } = b; return JSON.stringify(x) === JSON.stringify(y); });
  const changed = after.filter((b, i) => JSON.stringify(b.wall) !== JSON.stringify(meta.buildings[i].wall)).map(b => ({ key: b.key, wall: b.wall, was: meta.buildings.find(x => x.key === b.key)!.wall }));
  check('deep-West: runtime has exactly 615176 + 726333 over 45 m; raw 470235 seam-excluded and flagged as a gap',
    canon(runtimeTall) === canon(['coa-2023:615176', 'coa-2023:726333']) && seamReason && !meta.buildings.some(b => b.key === 'coa-2023:470235')
    && DEEP_WEST_HIGHRISES.find(d => d.key === 'coa-2023:470235')?.disposition === 'seam-excluded-gap' && RAW_DEEP_WEST_OVER_45.length === 3, { runtimeTall, seamReason });
  check('deep-West profile: only the wall of 726333 changes; rings / heights / roofs / districts identical', geomSame && changed.length === 1 && changed[0].key === 'coa-2023:726333', { changed });

  // ------------------------------------------------------------ 6. ledger + review shots
  const massTop = (o: Owner, k: string) => { const m = baseCtx[o].massing?.[k]; return m ? +Math.max(...m.volumes.map(v => v.top)).toFixed(2) : null; };
  const original = campus.buildings.filter(b => b.center[0] < -360 && b.h > 45).map(b => b.key!);
  const measuredExtra = ['512858:245', '594352:667'];
  const ledger = {
    generatedBy: 'scripts/harness/b12-highrise-identity-check.ts', status: 'reference-guided facade identity; not a survey, not 1:1',
    criteria: 'campus.json centre x < -360 and City h > 45 m (21 records, incl. Dobie b05) + Union / Waterloo (measured massing top > 45 m, City h < 45) + deep-West raw > 45 m (3) vs runtime (2)',
    original21: original.length,
    records: [...original, ...measuredExtra].map(k => {
      const b = byKey.get(k)!, prof = PROFILES.find(p => p.key === k), au = AUTHORED.find(a => a.key === k), ex = LEDGER_EXTRA.find(a => a.key === k);
      const owner = (prof?.owner ?? au?.owner ?? ex?.owner ?? 'b12-west-campus') as string, scope = plan.scopes.find(s => s.key === k);
      return { key: k, name: prof?.name ?? au?.name ?? ex?.name ?? '?', owner, cityH: b.h, center: b.center, massTop: OWNERS.includes(owner as Owner) ? massTop(owner as Owner, k) : null,
        disposition: prof ? (prof.owner === 'b12-west-campus' ? 'changed-profile' : 'outside-parent-patch') : au?.disposition ?? ex?.disposition ?? 'UNACCOUNTED',
        identity: prof?.identity ?? null, basis: prof?.evidence.basis ?? null, evidence: prof?.evidence.sources ?? au?.evidence ?? ex?.evidence ?? [],
        observed: prof?.evidence.observed ?? null, limits: prof?.evidence.limits ?? au?.uncertainty ?? ex?.uncertainty ?? null, trim: prof?.trim?.reason ?? null,
        archetypes: scope ? { catalog: scope.catalogArchetype, volumes: scope.volumes } : null, rootPatches: au?.rootPatches ?? null,
        measured: prof ? { glass: perProfile[prof.id].glass, colour: perProfile[prof.id].colour } : null };
    }),
    deepWest: DEEP_WEST_HIGHRISES,
  };
  const unaccounted = ledger.records.filter(r => r.disposition === 'UNACCOUNTED').map(r => r.key);
  check('ledger accounts for all 21 original + 2 measured-top records; Union is a changed profile', original.length === 21 && unaccounted.length === 0 && ledger.records.find(r => r.key === '512858:245')?.disposition === 'changed-profile', { original, unaccounted });
  const near = (x: number, z: number, R: number) => campus.buildings.filter(o => Math.hypot(o.center[0] - x, o.center[1] - z) < R);
  const segHits = (ax: number, az: number, bx: number, bz: number, r: Point[]) => { for (let i = 0; i < r.length; i++) { const c = r[i], d = r[(i + 1) % r.length]; const den = (bx - ax) * (d[1] - c[1]) - (bz - az) * (d[0] - c[0]); if (Math.abs(den) < 1e-9) continue; const t = ((c[0] - ax) * (d[1] - c[1]) - (c[1] - az) * (d[0] - c[0])) / den, u = ((c[0] - ax) * (bz - az) - (c[1] - az) * (bx - ax)) / den; if (t > 0 && t < 1 && u >= 0 && u <= 1) return true; } return false; };
  const ringDist = (x: number, z: number, r: Point[]) => { let d = Infinity; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length], dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz, t = l ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l)) : 0; d = Math.min(d, Math.hypot(a[0] + t * dx - x, a[1] + t * dz - z)); } return d; };
  const STREETS = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'primary_link', 'secondary_link']);
  const shots: Record<string, unknown>[] = [], shotIssues: string[] = [];
  const shotTargets = [...PROFILES.filter(p => p.owner === 'b12-west-campus').map(p => ({ key: p.key, label: p.name, id: p.id })), ...AUTHORED.filter(a => a.rootPatches).map(a => ({ key: a.key, label: a.name, id: a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') }))];
  for (const t of shotTargets) {
    const b = byKey.get(t.key)!, m = baseCtx['b12-west-campus'].massing?.[t.key], d = m?.datum, gy = d && typeof d === 'object' ? d.aboveY : 0, top = m ? Math.max(...m.volumes.map(v => v.top)) : b.h;
    const [cx, cz] = b.center, around = near(cx, cz, 260), cands: { x: number; z: number; dist: number }[] = [];
    for (const pth of campus.paths) if (!pth.area && STREETS.has(pth.kind)) for (const q of pth.points) { const dist = Math.hypot(q[0] - cx, q[1] - cz); if (dist >= 45 && dist <= 140) cands.push({ x: q[0], z: q[1], dist }); }
    const clearAt = (x: number, z: number) => around.every(o => !pointInPolygon(x, z, [o.rings[0] as Point[]]) && ringDist(x, z, o.rings[0] as Point[]) >= 3);
    const sight = (x: number, z: number, maxH: number) => around.every(o => o.key === t.key || o.h <= maxH || !segHits(x, z, cx, cz, o.rings[0] as Point[]));
    const pick = (maxH: number, prefer: number) => cands.filter(c => clearAt(c.x, c.z) && sight(c.x, c.z, maxH)).sort((a, c) => Math.abs(a.dist - prefer) - Math.abs(c.dist - prefer))[0];
    for (const [kind, maxH, prefer, h] of [['street', 10, 70, 1.7], ['aerial-30m', 24, 110, 30]] as const) {
      const c = pick(maxH, prefer);
      if (!c) { shotIssues.push(`${t.key} ${kind}: no clear candidate`); continue; }
      shots.push({ id: `b12-hi-${t.id}-${kind === 'street' ? 'street' : '30m'}`, block: 'b12-west-campus', kind: kind === 'street' ? 'street' : 'aerial', label: `${t.label} (${t.key}) from ${kind === 'street' ? 'the street' : '30 m'}`,
        position: [+c.x.toFixed(2), +(gy + h).toFixed(2), +c.z.toFixed(2)], target: [+cx.toFixed(2), +(gy + Math.min(top * 0.5, 40)).toFixed(2), +cz.toFixed(2)], fov: 62, groundY: +gy.toFixed(2),
        note: `highrise-identity review shot; camera on a street centreline point ${c.dist.toFixed(0)} m from the record centre, >= 3 m outside every footprint, plan sight line clear of other footprints taller than ${maxH} m. groundY = the record's massing datum (estimate; the root shot-clearance check confirms terrain).` });
    }
  }
  // Ground and physical clearance measured in the complete integrated scene; preserve these authored review poses.
  const cameraAdjustments = JSON.parse(readFileSync(resolve(root, OWNED, 'camera-adjustments.json'), 'utf8')) as Record<string, Record<string, unknown>>;
  for (const shot of shots) if (cameraAdjustments[String(shot.id)]) Object.assign(shot, cameraAdjustments[String(shot.id)]);
  check('review shots: street + 30 m for every changed / patched b12 record, ids b12-hi-*', shotIssues.length === 0 && shots.length === shotTargets.length * 2 && shots.every(s => String(s.id).startsWith('b12-hi-')), { count: shots.length, shotIssues });

  // ------------------------------------------------------------ outputs
  const integration = {
    version: 2, generatedBy: 'scripts/harness/b12-highrise-identity-check.ts (plan = planIntegration(highrise-identity/baseline.json), profiles.ts)',
    contract: 'Generated high-rises get owner-prefixed archetypes merged into the OWNER context.json (catalog archetype or per-volume massing archetype) plus source-backed evidence (identity source kept, facade provenance + limits appended, stale "facade = generic archetype" replaced). No geometry code to register: the generator reads them. Profiles change facade render geometry / trim; the body wall + roof envelope, collider top and outward extent are verified unchanged, render = collider coverage does not regress, and the only collider topology change is the declared Union belt course. Authored corrections are exact text root patches. Deep-West profile is one optional import + call.',
    howToApply: 'For each contextPatches entry: op "add" = insert value at path (must be absent), op "set" = replace the value at path (the current value must equal expectBefore; "expectBefore": null means absent). Then rerun the check: it must report contexts "applied" (a partial merge reports "partial" and fails; a wrong value reports "conflict").',
    contextPatches: Object.fromEntries(OWNERS.map(o => [`lib/campus/blocks/${o}/context.json`, plan.ops.filter(x => x.file.includes(o)).map(x => ({ op: x.op, path: x.path, expectBefore: x.prior ?? null, value: x.value }))])),
    guards: plan.guards.map(g => ({ file: g.file, path: g.path, mustStay: g.expect ?? null, why: g.why })),
    scopes: plan.scopes, baseline: `${OWNED}/baseline.json`,
    rootTextPatches: AUTHORED.flatMap(a => (a.rootPatches ?? []).map(rp => ({ record: a.key, ...rp }))),
    deepWestHook: { file: 'lib/campus/extension/deep-west/index.ts', optional: true,
      edits: [{ old: "import { buildingParts, surfaceGeometry, terrainGeometry, TerrainHeight, type DeepWestPart } from './geometry';", new: "import { buildingParts, surfaceGeometry, terrainGeometry, TerrainHeight, type DeepWestPart } from './geometry';\nimport { applyDeepWestProfiles } from '../../blocks/b12-west-campus/highrise-identity/deep-west';" },
        { old: '  const buildings = buildingParts(data.meta.buildings, data.meta.districts);', new: '  const buildings = buildingParts(applyDeepWestProfiles(data.meta.buildings), data.meta.districts);' }],
      effect: 'coa-2023:726333 wall brownBrick 160,86,64 -> precast 204,206,205; nothing else. The asset binary, its sha256 and the seam / render=collider checks are unaffected (same rings and heights).' },
    shots: { file: `${OWNED}/shots.json`, mergeInto: 'lib/campus/blocks/b12-west-campus/shots.json (append; ids b12-hi-*)' },
    harness: { script: 'vite build --config scripts/harness/b12-highrise-identity.vite.config.mjs && node scripts/harness/run-b12-highrise-identity-check.mjs', packageJsonSuggestion: { 'check:b12-highrise': 'vite build --config scripts/harness/b12-highrise-identity.vite.config.mjs && node scripts/harness/run-b12-highrise-identity-check.mjs' } },
    sideEffects: ['Union on San Antonio: the 5 cm belt course at the ground-storey line is not built (storey-high glazing, sill 0.1 m < the generator belt condition 0.3 m): collider triangles ' + JSON.stringify((perProfile['union-san-antonio'].trim as { colliderTriangles: number[] }).colliderTriangles) + '.',
      'All profiles: plinth / belt trim bands (5-7 cm relief) move with the new storey grid and ground-window sill; the body shell, top and outward extent are identical.'],
    notImplemented: [
      'Waterloo copper panels on the 24th St face: needs a per-face wall colour the generator lacks (narrow optional hook: a per-edge colour override in architecture.ts keyed by record + edge normal); not implemented.',
      'Linden podium screen above 15 m, amenity level and crown screen: generator ground storey max 15 m; would need a visual overlay; not implemented.',
      'Union balconies (projecting concrete slabs, dark railings): not modelled (no exact balcony geometry claimed).',
      'Per-building glass tint: architecture.ts / materials.ts glass is shared; no field invented.',
      'coa-2023:470235 (89.8 m, seam-excluded): root decision on a seam-crossing addition.'],
    measured: perProfile,
  };
  writeFileSync(resolve(root, '.work/INTEGRATION.json'), JSON.stringify(integration, null, 1) + '\n');
  writeFileSync(resolve(root, '.work/HIGHRISE-LEDGER.json'), JSON.stringify(ledger, null, 1) + '\n');
  if (opts.emit) { writeFileSync(resolve(root, OWNED, 'ledger.json'), JSON.stringify(ledger, null, 1) + '\n'); writeFileSync(resolve(root, OWNED, 'shots.json'), JSON.stringify(shots, null, 1) + '\n'); }
  else {
    const same = (f: string, v: unknown) => { try { return readFileSync(resolve(root, OWNED, f), 'utf8') === JSON.stringify(v, null, 1) + '\n'; } catch { return false; } };
    check('owned ledger.json / shots.json are current (re-run with --emit after profile edits)', same('ledger.json', ledger) && same('shots.json', shots), {});
  }
  return { pass: results.every(r => r.pass), mode: status.mode, ms: Math.round(performance.now() - t0), results };
}
