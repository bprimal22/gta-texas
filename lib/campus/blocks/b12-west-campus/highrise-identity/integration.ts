// Root-ready context.json key patches for the high-rise profiles (profiles.ts), planned against a FROZEN baseline
// (baseline.json: the owner context values before integration) so the same plan verifies both states:
//  * planIntegration(baseline) -> ops (each with the exact baseline value `prior` and the target `value`) + guards (values that
//    must stay at baseline: un-scoped volume archetypes, catalog archetypes of per-volume profiles);
//  * integrationStatus(contexts) -> 'baseline' (nothing applied), 'applied' (everything applied), 'partial' or 'conflict'
//    (a value that is neither baseline nor target, a guard violation, or massing drift). Only baseline / applied are valid;
//  * applyPlan (idempotent) / revertPlan reconstruct the patched / baseline contexts from either state.
// Ops only touch: archetypes.<owner>:<name> (add), catalog.<id>.archetype / .note / .evidence (set) and
// massing.<key>.volumes[i].archetype / massing.<key>.evidence (set). Rings, heights, datums, footprints, replaces and excludes
// are never written. Evidence keeps its {source, basis, note} shape: identity source kept, facade provenance appended.
import type { Archetype } from '../../../context/catalog';
import type { BlockContextData, BlockEvidence } from '../../types';
import { PROFILES, PRESERVED_KEYS, type HighriseProfile, type Owner } from './profiles';

export type Path = (string | number)[];
export interface Op { file: string; op: 'add' | 'set'; path: Path; value: unknown; prior: unknown }
export interface Guard { file: string; path: Path; expect: unknown; why: string }
export interface BaselineVolume { index: number; role: string; bottom: number; top: number; archetype: string | null; hash: string }
export interface BaselineRecord { profile: string; key: string; owner: Owner; catalogId: string;
  catalog: { archetype: string; note: string; evidence: BlockEvidence } | null;
  massing: { datumHash: string; evidence: BlockEvidence; volumes: BaselineVolume[] } | null }
export interface Baseline { version: 1; note: string; archetypesContainer: Record<Owner, boolean>; records: BaselineRecord[] }
export interface ScopeResolution { profile: string; key: string; owner: Owner; mode: string; catalogArchetype: string | null;
  volumes: { index: number; role: string; bottom: number; top: number; archetype: string | null }[] }
export interface Plan { ops: Op[]; guards: Guard[]; errors: string[]; scopes: ScopeResolution[]; archetypes: Record<string, Archetype> }
export type Ctx = BlockContextData & { archetypes?: Record<string, Archetype> };
export type Contexts = Record<Owner, Ctx>;
export const OWNERS: Owner[] = ['b12-west-campus', 'b11-south-medical'];
export const archetypeKey = (p: HighriseProfile, local: string) => `${p.owner}:${local}`;
export const contextFile = (owner: Owner) => `lib/campus/blocks/${owner}/context.json`;
const ownerOf = (file: string) => OWNERS.find(o => file.includes(o))!;

export const fnv = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h.toString(16).padStart(8, '0'); };
/** Canonical JSON (sorted keys): a root hand-merge that reorders keys still compares equal. */
export const canon = (v: unknown): string => v === undefined ? 'undefined' : v === null || typeof v !== 'object' ? JSON.stringify(v)
  : Array.isArray(v) ? `[${v.map(canon).join(',')}]` : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}`;
const volHash = (v: object) => { const rec = { ...(v as Record<string, unknown>) }; delete rec.archetype; return fnv(canon(rec)); };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const get = (o: unknown, path: Path) => path.reduce<unknown>((n, k) => (n === null || n === undefined ? undefined : (n as Record<string | number, unknown>)[k]), o);

/** Full archetype: facade from the profile, envelope keys (PRESERVED_KEYS) and era copied from the prior archetype. */
export function makeArchetype(p: HighriseProfile, local: string, prior: Archetype): Archetype {
  const f = p.archetypes[local];
  const a = { ...prior, ...f, era: prior.era, door: f.door ?? prior.door } as Archetype;
  const rec = a as unknown as Record<string, unknown>, src = prior as unknown as Record<string, unknown>;
  for (const k of PRESERVED_KEYS) { if (src[k] === undefined) delete rec[k]; else rec[k] = src[k]; }
  return a;
}

/** Same structural rules as blocks/registry.ts checkArchetype, plus generator sanity (head below the 0.95 x storey grid floor). */
export function checkArchetypeLite(a: Archetype, where: string): string[] {
  const e: string[] = [], hex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);
  for (const k of ['wallColor', 'groundColor', 'baseColor', 'trimColor', 'roofColor'] as const) if (!hex(a[k])) e.push(`${where}.${k}`);
  if (!(a.floor >= 2.4 && a.floor <= 12) || !(a.groundFloor >= 2.4 && a.groundFloor <= 15)) e.push(`${where}: floor/groundFloor range`);
  for (const [k, w] of [['window', a.window], ['groundWindow', a.groundWindow]] as const) {
    if (!(w.bay >= 0.5 && w.bay <= 30 && w.width >= 0 && w.width <= w.bay && w.sill >= 0 && w.head >= w.sill && w.head <= 15)) e.push(`${where}.${k}: bay/width/sill/head`);
    if (!(Number.isInteger(w.mullions) && w.mullions >= 0 && w.mullions <= 20)) e.push(`${where}.${k}.mullions`);
  }
  if (a.window.head > a.floor * 0.95) e.push(`${where}.window.head exceeds the fitted storey floor (0.95 x floor)`);
  if (a.groundWindow.head > a.groundFloor) e.push(`${where}.groundWindow.head exceeds groundFloor`);
  if (!(a.door.width > 0 && a.door.height > 0)) e.push(`${where}.door`);
  return e;
}

const RANK: Record<BlockEvidence['basis'], number> = { measured: 3, official: 2, 'reference-interpreted': 1, estimate: 0 };
const GENERIC = 'facade = generic archetype';
/** Evidence with the identity / massing source kept and the facade provenance + limits appended. Catalog basis = the weaker of
 * identity and facade basis; massing evidence keeps its (height) basis and states the facade basis in the note. */
export function facadeEvidence(old: BlockEvidence, p: HighriseProfile, where: 'catalog' | 'massing', on?: string): BlockEvidence {
  const facade = `facade = highrise-identity profile ${p.id}${on ? ` on ${on}` : ''} (facade basis ${p.evidence.basis}): ${p.evidence.observed}; limits: ${p.evidence.limits}`;
  const note0 = old.note ?? '';
  const note = note0.includes(GENERIC) ? note0.replace(GENERIC, facade) : `${note0}${note0 ? '; ' : ''}${facade}`;
  const basis = where === 'catalog' && RANK[p.evidence.basis] < RANK[old.basis] ? p.evidence.basis : old.basis;
  return { source: `${old.source} ; facade sources: ${p.evidence.sources.join(' ; ')}`, basis, note };
}

/** Freeze the pre-integration owner values for every profiled record. Refuses contexts that already carry profile values. */
export function freezeBaseline(contexts: Contexts, profiles: HighriseProfile[] = PROFILES): Baseline {
  const records: BaselineRecord[] = [];
  for (const p of profiles) {
    const ctx = contexts[p.owner], id = p.key.split(':')[0], cat = ctx.catalog?.[id], m = ctx.massing?.[p.key];
    for (const local of Object.keys(p.archetypes)) if (ctx.archetypes?.[archetypeKey(p, local)]) throw new Error(`freeze: ${archetypeKey(p, local)} already present`);
    if (cat?.archetype?.startsWith(p.owner + ':')) throw new Error(`freeze: catalog ${id} already ${cat.archetype}`);
    if (m?.volumes.some(v => v.archetype?.startsWith(p.owner + ':') && Object.keys(p.archetypes).some(l => v.archetype === archetypeKey(p, l)))) throw new Error(`freeze: ${p.key} volumes already patched`);
    records.push({ profile: p.id, key: p.key, owner: p.owner, catalogId: id,
      catalog: cat ? { archetype: cat.archetype ?? '', note: cat.note ?? '', evidence: clone(cat.evidence) } : null,
      massing: m ? { datumHash: fnv(canon(m.datum ?? 'grade')), evidence: clone(m.evidence), volumes: m.volumes.map((v, i) => ({ index: i, role: v.role ?? 'main', bottom: v.bottom, top: v.top, archetype: v.archetype ?? null, hash: volHash(v) })) } : null });
  }
  return { version: 1, note: 'Owner context values before the highrise-identity integration (frozen by the b12 high-rise check --freeze-baseline).',
    archetypesContainer: Object.fromEntries(OWNERS.map(o => [o, !!contexts[o].archetypes])) as Record<Owner, boolean>, records };
}

/** Pure plan from the frozen baseline (independent of the current contexts). */
export function planIntegration(baseline: Baseline, baseArchetypes: Record<string, Archetype>, profiles: HighriseProfile[] = PROFILES): Plan {
  const ops: Op[] = [], guards: Guard[] = [], errors: string[] = [], scopes: ScopeResolution[] = [], archetypes: Record<string, Archetype> = {};
  const container = new Set<Owner>();
  for (const p of profiles) {
    const rec = baseline.records.find(r => r.profile === p.id && r.key === p.key), file = contextFile(p.owner), id = p.key.split(':')[0];
    if (!rec) { errors.push(`${p.id}: not in the frozen baseline`); continue; }
    const prior = baseArchetypes[p.priorArchetype];
    if (!prior) { errors.push(`${p.id}: prior archetype ${p.priorArchetype} unknown`); continue; }
    if (p.scope.kind === 'catalog' && rec.catalog?.archetype !== p.priorArchetype) errors.push(`${p.id}: baseline catalog archetype ${rec.catalog?.archetype}, profile expects ${p.priorArchetype}`);
    if (!baseline.archetypesContainer[p.owner] && !container.has(p.owner)) { ops.push({ file, op: 'add', path: ['archetypes'], value: {}, prior: undefined }); container.add(p.owner); }
    for (const local of Object.keys(p.archetypes)) {
      const key = archetypeKey(p, local), a = makeArchetype(p, local, prior);
      errors.push(...checkArchetypeLite(a, key));
      ops.push({ file, op: 'add', path: ['archetypes', key], value: a, prior: undefined });
      archetypes[key] = a;
    }
    const res: ScopeResolution = { profile: p.id, key: p.key, owner: p.owner, mode: p.scope.kind, catalogArchetype: null, volumes: [] };
    const vols = rec.massing?.volumes ?? [];
    let assigned: (string | null)[] = vols.map(() => null);
    if (p.scope.kind === 'catalog') {
      if (!rec.catalog) { errors.push(`${p.id}: no ${p.owner} catalog entry for ${id}`); continue; }
      res.catalogArchetype = archetypeKey(p, p.primary);
      ops.push({ file, op: 'set', path: ['catalog', id, 'archetype'], value: res.catalogArchetype, prior: rec.catalog.archetype });
    } else {
      if (!rec.massing) { errors.push(`${p.id}: ${p.key} has no massing (per-volume scope impossible)`); continue; }
      const nonMech = vols.filter(v => v.role !== 'mech'), tallest = nonMech.reduce((b, v) => (v.top > b.top ? v : b), nonMech[0]);
      const sc = p.scope;
      assigned = vols.map(v => v.role === 'mech' ? null : sc.kind === 'tall-volumes' ? (v.top >= sc.minTop ? archetypeKey(p, p.primary) : null)
        : sc.kind === 'split' ? archetypeKey(p, v.index === tallest.index ? sc.tallest : sc.others) : null);
      if (!assigned.some(Boolean)) errors.push(`${p.id}: scope matched no volume`);
      if (rec.catalog) guards.push({ file, path: ['catalog', id, 'archetype'], expect: rec.catalog.archetype, why: 'per-volume profile keeps the catalog archetype for un-scoped volumes' });
    }
    vols.forEach((v, i) => {
      const a = assigned[i];
      if (a && v.archetype) errors.push(`${p.id}: volume ${i} already has archetype ${v.archetype}`);
      if (a) ops.push({ file, op: 'set', path: ['massing', p.key, 'volumes', i, 'archetype'], value: a, prior: v.archetype ?? undefined });
      else guards.push({ file, path: ['massing', p.key, 'volumes', i, 'archetype'], expect: v.archetype ?? undefined, why: 'volume outside the profile scope keeps its baseline archetype' });
      res.volumes.push({ index: i, role: v.role, bottom: v.bottom, top: v.top, archetype: a });
    });
    const on = p.scope.kind === 'catalog' ? undefined : res.volumes.filter(v => v.archetype).map(v => `volume ${v.index} (${v.archetype})`).join(', ') + '; other volumes keep their baseline archetype';
    if (rec.catalog) {
      ops.push({ file, op: 'set', path: ['catalog', id, 'note'], value: `${rec.catalog.note} | facade: highrise-identity profile ${p.id}`, prior: rec.catalog.note });
      ops.push({ file, op: 'set', path: ['catalog', id, 'evidence'], value: facadeEvidence(rec.catalog.evidence, p, 'catalog', on), prior: rec.catalog.evidence });
    } else ops.push({ file, op: 'set', path: ['massing', p.key, 'evidence'], value: facadeEvidence(rec.massing!.evidence, p, 'massing', on), prior: rec.massing!.evidence });
    scopes.push(res);
  }
  return { ops, guards, errors, scopes, archetypes };
}

export type Mode = 'baseline' | 'applied' | 'partial' | 'conflict';
export interface Status { mode: Mode; applied: number; pending: number; conflicts: string[]; pendingPaths: string[] }
/** Classify the current owner contexts against the plan; also detects massing drift against the frozen baseline. */
export function integrationStatus(contexts: Contexts, plan: Plan, baseline: Baseline): Status {
  let applied = 0, pending = 0; const conflicts: string[] = [], pendingPaths: string[] = [];
  for (const o of plan.ops) {
    const cur = get(contexts[ownerOf(o.file)], o.path), where = `${ownerOf(o.file)}:${o.path.join('.')}`;
    if (o.path.length === 1) { if (cur === undefined) { pending++; pendingPaths.push(where); } else if (typeof cur === 'object') applied++; else conflicts.push(`${where}: not an object`); continue; }
    if (canon(cur) === canon(o.value)) applied++;
    else if (canon(cur) === canon(o.prior)) { pending++; pendingPaths.push(where); }
    else conflicts.push(`${where}: neither baseline nor target`);
  }
  for (const g of plan.guards) { const cur = get(contexts[ownerOf(g.file)], g.path); if (canon(cur ?? null) !== canon(g.expect ?? null)) conflicts.push(`${ownerOf(g.file)}:${g.path.join('.')}: guard (${g.why}) expected ${canon(g.expect)} got ${canon(cur)}`); }
  for (const r of baseline.records) {
    if (!r.massing) continue;
    const m = contexts[r.owner].massing?.[r.key];
    if (!m || m.volumes.length !== r.massing.volumes.length || fnv(canon(m.datum ?? 'grade')) !== r.massing.datumHash || m.volumes.some((v, i) => volHash(v) !== r.massing!.volumes[i].hash)) conflicts.push(`${r.owner}:massing.${r.key}: massing drift against the frozen baseline`);
  }
  const mode: Mode = conflicts.length ? 'conflict' : pending === 0 ? 'applied' : applied === 0 ? 'baseline' : 'partial';
  return { mode, applied, pending, conflicts, pendingPaths };
}

const setAt = (root: unknown, path: Path, value: unknown) => {
  const parent = get(root, path.slice(0, -1)) as Record<string | number, unknown> | undefined;
  if (!parent || typeof parent !== 'object') throw new Error(`missing parent for ${path.join('.')}`);
  const last = path[path.length - 1];
  if (value === undefined) delete parent[last]; else parent[last] = clone(value);
};
/** Patched contexts (idempotent: applying to an applied state is a no-op). */
export function applyPlan(contexts: Contexts, plan: Plan): Contexts {
  const out = clone(contexts);
  for (const o of plan.ops) { const root = out[ownerOf(o.file)]; if (o.path.length === 1 && get(root, o.path) !== undefined) continue; setAt(root, o.path, o.value); }
  return out;
}
/** Baseline contexts reconstructed from either state (prior values restored, added archetypes removed). */
export function revertPlan(contexts: Contexts, plan: Plan): Contexts {
  const out = clone(contexts);
  for (const o of [...plan.ops].reverse()) {
    const root = out[ownerOf(o.file)];
    if (o.path.length === 1) { const c = get(root, o.path) as Record<string, unknown> | undefined; if (c && Object.keys(c).length === 0) setAt(root, o.path, undefined); continue; }
    if (get(root, o.path.slice(0, -1)) !== undefined) setAt(root, o.path, o.prior);
  }
  return out;
}
