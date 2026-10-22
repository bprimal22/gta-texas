// Whole-campus block registry — the single integration point between block owners and the
// shared engine (see ./types.ts). Generated once by the integrator; owners never edit this file.
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Building, CampusData, Point } from '../types';
export { BLOCK_REPLACES, BLOCK_MASSING, blockMassing, isReplaced } from './context-hooks';
import { CATALOG, type CatalogEntry } from '../context/catalog';
import { BLOCK_REPLACES, BLOCK_MASSING } from './context-hooks';
import ownershipData from './ownership.json' with { type: 'json' };
import type { BlockContextData, BlockInstall, BlockInstallContext, BlockModule } from './types';
import { block as b01 } from './b01-eer/index';
import b01Context from './b01-eer/context.json' with { type: 'json' };
import { block as b02 } from './b02-sciences/index';
import b02Context from './b02-sciences/context.json' with { type: 'json' };
import { block as b03 } from './b03-gdc-speedway/index';
import b03Context from './b03-gdc-speedway/context.json' with { type: 'json' };
import { block as b04 } from './b04-tower/index';
import b04Context from './b04-tower/context.json' with { type: 'json' };
import { block as b05 } from './b05-southmall/index';
import b05Context from './b05-southmall/context.json' with { type: 'json' };
import { block as b06 } from './b06-northwest/index';
import b06Context from './b06-northwest/context.json' with { type: 'json' };
import { block as b07 } from './b07-wcp-gregory/index';
import b07Context from './b07-wcp-gregory/context.json' with { type: 'json' };
import { block as b08 } from './b08-east-north/index';
import b08Context from './b08-east-north/context.json' with { type: 'json' };
import { block as b09 } from './b09-stadium/index';
import b09Context from './b09-stadium/context.json' with { type: 'json' };
import { block as b10 } from './b10-east-campus/index';
import b10Context from './b10-east-campus/context.json' with { type: 'json' };
import { block as b11 } from './b11-south-medical/index';
import b11Context from './b11-south-medical/context.json' with { type: 'json' };
import { block as b12 } from './b12-west-campus/index';
import b12Context from './b12-west-campus/context.json' with { type: 'json' };
import { block as b13 } from './b13-north-perimeter/index';
import b13Context from './b13-north-perimeter/context.json' with { type: 'json' };
import { block as b14 } from './b14-capitol/index';
import b14Context from './b14-capitol/context.json' with { type: 'json' };

export const BLOCK_MODULES: BlockModule[] = [b01, b02, b03, b04, b05, b06, b07, b08, b09, b10, b11, b12, b13, b14];
export const BLOCK_CONTEXT: BlockContextData[] = [b01Context, b02Context, b03Context, b04Context, b05Context, b06Context, b07Context, b08Context, b09Context, b10Context, b11Context, b12Context, b13Context, b14Context] as unknown as BlockContextData[];

const ringCenter = (ring: Point[]): Point => {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f; cx += (ring[j][0] + ring[i][0]) * f; cz += (ring[j][1] + ring[i][1]) * f;
  }
  if (Math.abs(a) < 1e-9) return ring[0];
  return [cx / (3 * a), cz / (3 * a)];
};

export interface BlockOwnership { recordOwner: Record<string, string>; rects: Record<string, [number, number, number, number][]>; ambiguousIds: number[] }
const OWNERSHIP = ownershipData as unknown as BlockOwnership;
const ROOFS = new Set(['hip-tile', 'hip-shingle', 'hip-metal', 'flat']);
const WALLS = new Set(['buffBrick', 'brownBrick', 'limestone', 'precast', 'stucco', 'siding', 'metal']);
const WINDOWS = new Set(['punched', 'ribbon', 'glazed', 'open', 'none']);
const FRAMES = new Set(['dark', 'bronze', 'light']);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isColor = (v: unknown) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
/** Full structural check of a block-defined archetype (every field the generator reads). */
function checkArchetype(a: unknown, where: string, errors: string[]) {
  if (!isObj(a)) { errors.push(`${where}: archetype must be an object`); return; }
  const num = (k: string, min = 0, max = 1e3) => { if (!(finite(a[k]) && (a[k] as number) >= min && (a[k] as number) <= max)) errors.push(`${where}.${k}: number in [${min}, ${max}] required`); };
  for (const k of ['label', 'era', 'reference']) if (typeof a[k] !== 'string') errors.push(`${where}.${k}: string required`);
  for (const k of ['wall', 'ground', 'base', 'trim']) if (!WALLS.has(a[k] as string)) errors.push(`${where}.${k}: wall family required`);
  for (const k of ['wallColor', 'groundColor', 'baseColor', 'trimColor', 'roofColor']) if (!isColor(a[k])) errors.push(`${where}.${k}: #rrggbb required`);
  if (!ROOFS.has(a.roof as string)) errors.push(`${where}.roof: roof form required`);
  num('baseHeight', 0, 20); num('roofSlope', 0, 3); num('overhang', 0, 5); num('parapet', 0, 5); num('cornice', 0, 5); num('floor', 2.4, 12); num('groundFloor', 2.4, 15);
  for (const k of ['brackets', 'belt']) if (typeof a[k] !== 'boolean') errors.push(`${where}.${k}: boolean required`);
  for (const k of ['sunshades', 'storefront', 'deepReveal']) if (a[k] !== undefined && typeof a[k] !== 'boolean') errors.push(`${where}.${k}: boolean if present`);
  for (const k of ['window', 'groundWindow']) {
    const w = a[k];
    if (!isObj(w)) { errors.push(`${where}.${k}: window spec required`); continue; }
    const wn = (f: string, min: number, max: number) => { if (!(finite(w[f]) && (w[f] as number) >= min && (w[f] as number) <= max)) errors.push(`${where}.${k}.${f}: number in [${min}, ${max}] required`); };
    wn('bay', 0.5, 30); wn('width', 0, 30); wn('sill', 0, 10); wn('head', 0, 15);
    if (finite(w.width) && finite(w.bay) && (w.width as number) > (w.bay as number)) errors.push(`${where}.${k}: width must not exceed bay`);
    if (finite(w.head) && finite(w.sill) && (w.head as number) < (w.sill as number)) errors.push(`${where}.${k}: head must be >= sill`);
    if (!(Number.isInteger(w.mullions) && (w.mullions as number) >= 0 && (w.mullions as number) <= 20)) errors.push(`${where}.${k}.mullions: integer 0..20 required`);
    if (typeof w.transom !== 'boolean') errors.push(`${where}.${k}.transom: boolean required`);
    if (!WINDOWS.has(w.type as string)) errors.push(`${where}.${k}.type: punched|ribbon|glazed|open|none`);
    if (!FRAMES.has(w.frame as string)) errors.push(`${where}.${k}.frame: dark|bronze|light`);
    if (w.surround !== undefined && typeof w.surround !== 'boolean') errors.push(`${where}.${k}.surround: boolean if present`);
  }
  const d = a.door;
  if (!isObj(d) || !(finite(d.width) && (d.width as number) > 0 && (d.width as number) < 20) || !(finite(d.height) && (d.height as number) > 0 && (d.height as number) < 20)) errors.push(`${where}.door: {width, height} > 0 required`);
}
const BASES = new Set(['measured', 'official', 'reference-interpreted', 'estimate']);

export interface BlockDataReport {
  applied: Record<string, { footprints: number; excluded: number; added: number; replacesPending: number; catalog: number; massing: number }>;
  /** Blocks whose whole data was rejected (validation errors) — nothing of theirs was applied. */
  rejected: Record<string, string[]>;
  excluded: { key: string; id: number; block: string; evidence: unknown }[];
  added: { key: string; id: number; block: string }[];
  errors: string[];
}

const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const ringArea = (r: Point[]) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return a / 2; };
const inRing = (x: number, z: number, r: Point[]) => { let inside = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside; } return inside; };
function checkRings(rings: unknown, where: string, errors: string[]) {
  if (!Array.isArray(rings) || !rings.length) { errors.push(`${where}: rings missing`); return; }
  rings.forEach((r, k) => {
    if (!Array.isArray(r) || r.length < 3 || !r.every(p => Array.isArray(p) && p.length === 2 && finite(p[0]) && finite(p[1]))) { errors.push(`${where}: ring ${k} needs >= 3 finite [x,z] points`); return; }
    if (Math.abs(ringArea(r as Point[])) < 0.5) errors.push(`${where}: ring ${k} has (near) zero area`);
    if (k > 0 && !(r as Point[]).every(p => inRing(p[0], p[1], rings[0] as Point[]))) errors.push(`${where}: hole ${k} not inside the outer ring`);
  });
}
const checkEvidence = (e: unknown, where: string, errors: string[]) => {
  const ev = e as { source?: unknown; basis?: unknown } | undefined;
  if (!ev || typeof ev.source !== 'string' || !ev.source || !BASES.has(ev.basis as string)) errors.push(`${where}: evidence {source, basis: measured|official|reference-interpreted|estimate} required`);
};

/** Validate one block's data against the source records (by immutable key) without mutating anything.
 * Returns the resolved record keys per operation. */
function planBlock(c: BlockContextData, keysById: Map<number, string[]>, ownership: BlockOwnership, errors: string[]) {
  const block = c.block, resolved = { footprints: [] as [string, NonNullable<BlockContextData['footprints']>[string]][], exclude: [] as [string, unknown][], replaces: [] as string[], massing: [] as [string, NonNullable<BlockContextData['massing']>[string]][] };
  if (!ownership.rects[block]) { errors.push(`unknown block "${block}"`); return resolved; }
  const resolve = (k: string, op: string): string | null => {
    let key: string;
    if (/^-?\d+:(\d+|add)$/.test(k)) key = k;
    else if (/^-?\d+$/.test(k)) {
      const keys = keysById.get(+k) ?? [];
      if (keys.length !== 1) { errors.push(`${block} ${op} ${k}: id is ${keys.length ? 'ambiguous (' + keys.join(', ') + ') — use a record key' : 'not in the data'}`); return null; }
      key = keys[0];
    } else { errors.push(`${block} ${op} ${k}: not an id or record key`); return null; }
    const owner = ownership.recordOwner[key] ?? (addedOwner.get(key));
    if (!owner) { errors.push(`${block} ${op} ${key}: no such record`); return null; }
    if (owner !== block) { errors.push(`${block} ${op} ${key}: record belongs to ${owner}`); return null; }
    return key;
  };
  for (const op of ['footprints', 'exclude', 'replaces', 'massing', 'catalog', 'archetypes'] as const) {
    const v = (c as unknown as Record<string, unknown>)[op];
    if (v !== undefined && !isObj(v)) errors.push(`${block} ${op}: must be an object`);
    else if (v) for (const [k, e] of Object.entries(v)) if (!isObj(e)) errors.push(`${block} ${op} ${k}: entry must be an object`);
  }
  if (errors.length) return resolved;
  for (const [k, f] of Object.entries(c.footprints ?? {})) { const key = resolve(k, 'footprints'); checkRings(f.rings, `${block} footprints ${k}`, errors); if (f.h !== undefined && !(finite(f.h) && f.h >= 0)) errors.push(`${block} footprints ${k}: h must be finite >= 0`); checkEvidence(f.evidence, `${block} footprints ${k}`, errors); if (key) resolved.footprints.push([key, f]); }
  for (const [k, e] of Object.entries(c.exclude ?? {})) { const key = resolve(k, 'exclude'); checkEvidence(e, `${block} exclude ${k}`, errors); if (key) resolved.exclude.push([key, e]); }
  for (const [k, e] of Object.entries(c.replaces ?? {})) { const key = resolve(k, 'replaces'); checkEvidence(e, `${block} replaces ${k}`, errors); if (key) resolved.replaces.push(key); }
  for (const [k, m] of Object.entries(c.massing ?? {})) {
    const key = resolve(k, 'massing'); checkEvidence(m.evidence, `${block} massing ${k}`, errors);
    if (!Array.isArray(m.volumes) || !m.volumes.length) errors.push(`${block} massing ${k}: volumes must be a non-empty list`);
    else m.volumes.forEach((v, i) => {
      const w = `${block} massing ${k} volume ${i}`;
      if (!finite(v.top) || !finite(v.bottom) || !(v.top > v.bottom)) errors.push(`${w}: finite top > bottom required`);
      if (!ROOFS.has(v.roof)) errors.push(`${w}: roof must be hip-tile|hip-shingle|hip-metal|flat`);
      if (v.slope !== undefined && !(finite(v.slope) && v.slope >= 0)) errors.push(`${w}: slope must be finite >= 0`);
      if (v.role !== undefined && !['main', 'tier', 'mech'].includes(v.role)) errors.push(`${w}: role must be main|tier|mech`);
      if (v.rings) checkRings(v.rings, w, errors); else if (v.ring) checkRings([v.ring], w, errors);
      if (v.archetype !== undefined && !Object.hasOwn(CATALOG.archetypes, v.archetype) && !(c.archetypes && Object.hasOwn(c.archetypes, v.archetype))) errors.push(`${w}: unknown archetype ${v.archetype}`);
    });
    const d = m.datum as unknown;
    if (d !== undefined && d !== 'grade' && d !== 'campusY' && !(isObj(d) && finite(d.aboveY))) errors.push(`${block} massing ${k}: datum must be "grade", "campusY" or {aboveY}`);
    if (key) resolved.massing.push([key, m]);
  }
  for (const [key, arch] of Object.entries(c.archetypes ?? {})) { if (!key.startsWith(block + ':')) errors.push(`${block}: archetype ${key} must start with "${block}:"`); checkArchetype(arch, `${block} archetype ${key}`, errors); }
  for (const [k, e] of Object.entries(c.catalog ?? {})) {
    checkEvidence(e.evidence, `${block} catalog ${k}`, errors);
    const keys = keysById.get(+k) ?? [];
    if (!keys.length) errors.push(`${block} catalog ${k}: id not in the data`);
    else for (const key of keys) if ((ownership.recordOwner[key] ?? addedOwner.get(key)) !== block) errors.push(`${block} catalog ${k}: record ${key} belongs to ${ownership.recordOwner[key]}`);
    if (e.archetype && !Object.hasOwn(CATALOG.archetypes, e.archetype) && !(c.archetypes && Object.hasOwn(c.archetypes, e.archetype))) errors.push(`${block} catalog ${k}: unknown archetype ${e.archetype}`);
  }
  return resolved;
}
const addedOwner = new Map<string, string>();

/** Apply every block's context.json to freshly loaded campus data. Each block's data is validated as a
 * whole first; a block with any error, or one writing a record another block already wrote, is rejected
 * entirely (nothing of it is applied) and reported. Record keys are assigned once, before any edit.
 * `contexts`/`ownership` are injectable for fixtures. Idempotent per data object. */
export function applyBlockData(data: CampusData, contexts: BlockContextData[] = BLOCK_CONTEXT, ownership: BlockOwnership = OWNERSHIP): BlockDataReport {
  const marker = data as CampusData & { blocksApplied?: BlockDataReport };
  if (marker.blocksApplied) return marker.blocksApplied;
  const report: BlockDataReport = { applied: {}, rejected: {}, excluded: [], added: [], errors: [] };
  BLOCK_REPLACES.clear(); BLOCK_MASSING.clear(); PENDING_REPLACES.clear(); addedOwner.clear();
  restoreCatalog();
  data.buildings.forEach((b, i) => { b.key ??= `${b.id}:${i}`; });
  const keysById = new Map<number, string[]>();
  for (const b of data.buildings) { const l = keysById.get(b.id) ?? []; l.push(b.key!); keysById.set(b.id, l); }
  // Additions first (validated per block), so other operations of the same block can address them.
  const plans: { c: BlockContextData; plan: ReturnType<typeof planBlock>; adds: Building[] }[] = [];
  const written = new Map<string, string>();
  const reservedAdds = new Map<number, string>(); // accepted added ids across ALL blocks
  for (const c of contexts) {
    const errors: string[] = [], adds: Building[] = [];
    const rects = ownership.rects[c.block] ?? [];
    for (const a of c.add ?? []) {
      const w = `${c.block} add ${a.id}`;
      if (!isObj(a)) { errors.push(`${c.block} add: entries must be objects`); continue; }
      if (!(Number.isInteger(a.id) && a.id < 0) || keysById.has(a.id) || adds.some(x => x.id === a.id)) errors.push(`${w}: id must be a unique negative integer`);
      else if (reservedAdds.has(a.id)) errors.push(`${w}: id already added by ${reservedAdds.get(a.id)}`);
      checkRings(a.rings, w, errors); checkEvidence(a.evidence, w, errors);
      if (!(finite(a.h) && a.h > 0)) errors.push(`${w}: h must be finite > 0`);
      if (Array.isArray(a.rings?.[0]) && !a.rings[0].every(p => rects.some(([x0, x1, z0, z1]) => p[0] >= x0 && p[0] < x1 && p[1] >= z0 && p[1] < z1))) errors.push(`${w}: every vertex must lie inside ${c.block}`);
      adds.push({ id: a.id, name: a.name, abbr: a.abbr, h: a.h, rings: a.rings, center: [0, 0], key: `${a.id}:add` });
    }
    for (const b of adds) if (!reservedAdds.has(b.id)) addedOwner.set(b.key!, c.block);
    const localKeys = new Map(keysById); for (const b of adds) localKeys.set(b.id, [b.key!]);
    const plan = planBlock(c, localKeys, ownership, errors);
    for (const key of [...plan.footprints.map(f => f[0]), ...plan.exclude.map(e => e[0]), ...plan.replaces, ...plan.massing.map(m => m[0])]) {
      const other = written.get(key); if (other && other !== c.block) errors.push(`${c.block}: record ${key} is also written by ${other}`);
    }
    if (errors.length) { report.rejected[c.block] = errors; report.errors.push(...errors); for (const b of adds) if (addedOwner.get(b.key!) === c.block && !reservedAdds.has(b.id)) addedOwner.delete(b.key!); continue; }
    for (const key of [...plan.footprints.map(f => f[0]), ...plan.exclude.map(e => e[0]), ...plan.replaces, ...plan.massing.map(m => m[0])]) written.set(key, c.block);
    for (const b of adds) reservedAdds.set(b.id, c.block);
    plans.push({ c, plan, adds });
  }
  const byKey = new Map(data.buildings.map(b => [b.key!, b]));
  for (const { c, plan, adds } of plans) {
    const r = { footprints: 0, excluded: 0, added: 0, replacesPending: 0, catalog: 0, massing: 0 };
    for (const b of adds) { b.center = ringCenter(b.rings[0]); data.buildings.push(b); byKey.set(b.key!, b); report.added.push({ key: b.key!, id: b.id, block: c.block }); r.added++; }
    for (const [key, f] of plan.footprints) { const b = byKey.get(key)!; b.rings = f.rings; b.center = ringCenter(f.rings[0]); if (f.h !== undefined) b.h = f.h; r.footprints++; }
    for (const [key, e] of plan.exclude) { const i = data.buildings.findIndex(b => b.key === key); if (i >= 0) { const [b] = data.buildings.splice(i, 1); report.excluded.push({ key, id: b.id, block: c.block, evidence: e }); r.excluded++; } }
    for (const key of plan.replaces) { PENDING_REPLACES.set(key, c.block); r.replacesPending++; }
    for (const [key, m] of plan.massing) {
      const d = m.datum ?? 'grade';
      BLOCK_MASSING.set(key, { block: c.block, volumes: m.volumes, heightBase: d === 'grade' ? undefined : d === 'campusY' ? 0 : (d as { aboveY: number }).aboveY });
      r.massing++;
    }
    // Catalogue attribution is intentionally id-wide (all parts of a building share an archetype).
    for (const [key, arch] of Object.entries(c.archetypes ?? {})) CATALOG.archetypes[key] = arch;
    for (const [id, e] of Object.entries(c.catalog ?? {})) {
      const { evidence, ...entry } = e;
      const existed = id in CATALOG.buildings;
      const base: CatalogEntry = BASE_CATALOG.get(id) ?? CATALOG.buildings[id] ?? { archetype: 'master-plan', basis: 'district-default', district: c.block, note: '' };
      if (existed && !BASE_CATALOG.has(id)) BASE_CATALOG.set(id, base);
      if (!existed) ADDED_CATALOG.add(id);
      CATALOG.buildings[id] = { ...base, ...entry, note: `${entry.note ?? base.note} [${c.block}: ${evidence.basis} — ${evidence.source}]` } as CatalogEntry;
      r.catalog++;
    }
    report.applied[c.block] = r;
  }
  marker.blocksApplied = report;
  if (report.errors.length) console.error('Block data rejected:', report.rejected);
  return report;
}
/** Catalogue entries as they were before any block edit (so re-applying is idempotent). */
const BASE_CATALOG = new Map<string, CatalogEntry>();
const ORIGINAL_ARCHETYPES = new Set(Object.keys(CATALOG.archetypes));
/** Undo every block catalogue edit from a previous data object (fresh scene, hot update, fixtures). */
function restoreCatalog() {
  for (const [id, entry] of BASE_CATALOG) CATALOG.buildings[id] = entry;
  for (const id of ADDED_CATALOG) delete CATALOG.buildings[id];
  for (const k of Object.keys(CATALOG.archetypes)) if (!ORIGINAL_ARCHETYPES.has(k)) delete CATALOG.archetypes[k];
  BASE_CATALOG.clear(); ADDED_CATALOG.clear();
}
/** Catalogue ids that did not exist before a block edit created them. */
const ADDED_CATALOG = new Set<string>();
/** Declared replacements waiting for their block's geometry to install. */
const PENDING_REPLACES = new Map<string, string>();

export interface InstalledBlocks {
  group: THREE.Group;
  installs: { id: string; install: BlockInstall; colliders: RAPIER.Collider[]; walkable: THREE.Object3D[]; reused: RAPIER.Collider[] }[];
  stats: Record<string, unknown>;
  /** Replacements committed (record key -> block) and declared ones left with their generated fallback. */
  replacements: { committed: Record<string, string>; fallback: Record<string, string> };
  dispose(): void;
}

/** Collider-tracking view of the physics world: every collider an installer creates is recorded so a
 * failed install can be rolled back and disposal can remove exactly the block's own colliders. */
function trackingWorld(physics: RAPIER.World, created: RAPIER.Collider[]): RAPIER.World {
  return new Proxy(physics, {
    get(target, key) {
      if (key === 'createCollider') return (...args: Parameters<RAPIER.World['createCollider']>) => { const c = target.createCollider(...args); created.push(c); return c; };
      const value = Reflect.get(target, key, target) as unknown;
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}
const removeColliders = (physics: RAPIER.World, colliders: RAPIER.Collider[]) => {
  for (const c of colliders) try { if (physics.getCollider(c.handle)) physics.removeCollider(c, false); } catch { /* already freed */ }
};

/** Install every block's authored geometry as a transaction per block: on a throw its colliders are
 * removed and nothing is attached; on success solids/detail go under the returned group (added to
 * solidParent) and walkable meshes under walkableParent, then — only then — the block's declared
 * replacements that its install reports in `replaced` are committed. */
export function installBlocks(ctx: BlockInstallContext, walkableParent: THREE.Object3D, solidParent: THREE.Object3D, modules: BlockModule[] = BLOCK_MODULES): InstalledBlocks {
  const group = new THREE.Group(); group.name = 'Whole-campus blocks';
  const installs: InstalledBlocks['installs'] = [];
  const stats: Record<string, unknown> = {};
  const committed: Record<string, string> = {}, fallback: Record<string, string> = {};
  for (const m of modules) {
    const started = performance.now(), created: RAPIER.Collider[] = [];
    let result: BlockInstall | null = null;
    try { result = m.install({ ...ctx, physics: trackingWorld(ctx.physics, created) }); } catch (error) {
      removeColliders(ctx.physics, created);
      console.error(`Block ${m.id} install failed; rolled back ${created.length} collider(s), generated fallback kept.`, error);
      stats[m.id] = { failed: String(error), rolledBackColliders: created.length }; continue;
    }
    if (!result) { if (created.length) { removeColliders(ctx.physics, created); stats[m.id] = { failed: 'install returned null after creating colliders', rolledBackColliders: created.length }; } continue; }
    const colliders = [...new Set([...created, ...result.colliders])];
    const blockGroup = new THREE.Group(); blockGroup.name = `Block ${m.id}`;
    for (const o of [...(result.solids ?? []), ...(result.detail ?? [])]) blockGroup.add(o);
    const walkable = result.walkable ?? [];
    for (const o of walkable) { o.userData.block = m.id; o.traverse(x => { x.userData.block = m.id; }); walkableParent.add(o); }
    blockGroup.traverse(x => { x.userData.block = m.id; });
    group.add(blockGroup);
    let triangles = 0, meshes = 0;
    const materials = new Set<THREE.Material>();
    for (const root of [blockGroup, ...walkable]) root.traverse(o => {
      const mesh = o as THREE.Mesh; if (!mesh.isMesh) return; meshes++;
      for (const mat of [mesh.material].flat()) materials.add(mat);
      triangles += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3;
    });
    // A replacement claim commits only if it resolves to exactly one pending record of this block and the
    // install actually returned geometry with colliders (an empty "success" cannot suppress a building).
    const claimErrors: string[] = [], replacedKeys = new Set<string>();
    for (const k of result.replaced ?? []) {
      const mine = [...PENDING_REPLACES].filter(([p, b]) => b === m.id && (p === k || p.startsWith(k + ':'))).map(([p]) => p);
      if (mine.length === 1) replacedKeys.add(mine[0]); else claimErrors.push(`replaced "${k}" matches ${mine.length} pending records of ${m.id}`);
    }
    if (replacedKeys.size && (meshes === 0 || colliders.length === 0)) { claimErrors.push(`replacement claimed with ${meshes} meshes / ${colliders.length} colliders`); replacedKeys.clear(); }
    for (const [key, block] of PENDING_REPLACES) {
      if (block !== m.id) continue;
      if (replacedKeys.has(key)) { BLOCK_REPLACES.set(key, block); committed[key] = block; } else fallback[key] = block;
    }
    if (claimErrors.length) console.error(`Block ${m.id} replacement claims rejected:`, claimErrors);
    stats[m.id] = { ...result.stats, meshes, triangles, materials: materials.size, colliders: colliders.length, trackedColliders: created.length, replaced: [...replacedKeys], ...(claimErrors.length ? { claimErrors } : {}), ms: Math.round(performance.now() - started) };
    installs.push({ id: m.id, install: result, colliders, walkable, reused: result.reusedColliders ?? [] });
  }
  for (const [key, block] of PENDING_REPLACES) if (!committed[key]) fallback[key] = block;
  solidParent.add(group);
  let disposed = false;
  return {
    group, installs, stats, replacements: { committed, fallback },
    dispose() {
      if (disposed) return; disposed = true;
      for (const { install, colliders, walkable } of installs) {
        for (const o of walkable) o.removeFromParent();
        try { install.dispose(); } catch (error) { console.error('Block dispose failed', error); }
        removeColliders(ctx.physics, colliders);
      }
      group.removeFromParent();
      for (const key of Object.keys(committed)) BLOCK_REPLACES.delete(key);
    },
  };
}
