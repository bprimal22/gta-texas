import * as T from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { TreeForm, CollisionCapsule } from './oak-forms';
import type { GroundQuery } from './ground-index';

/** Head clearance required under any visible wood / tree collider that hangs
 * over paved walkable ground (paths, plazas, roads, stairs) away from the trunk. */
export const LIMB_CLEARANCE = 2.4;
/** Over lawn / planting / terrain, limbs may hang low (as real oaks do and as
 * the collider shows) but never into the ground. */
export const LAWN_LIMB_CLEARANCE = .3;
/** Foliage over paving should not brush a walking head. */
export const FOLIAGE_PAVED_CLEARANCE = 2.2;

type Ring = number[][];
/** Building footprints, grid-hashed for point tests. */
export class Footprints {
  private cells = new Map<string, { rings: Ring[]; box: number[] }[]>();
  constructor(buildings: { rings: Ring[] }[], private cell = 32) {
    for (const b of buildings) {
      const ring = b.rings?.[0];
      if (!ring || ring.length < 3) continue;
      const xs = ring.map(p => p[0]), zs = ring.map(p => p[1]);
      const box = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
      for (let i = Math.floor(box[0] / cell); i <= Math.floor(box[1] / cell); i++)
        for (let j = Math.floor(box[2] / cell); j <= Math.floor(box[3] / cell); j++) {
          const k = `${i},${j}`; if (!this.cells.has(k)) this.cells.set(k, []); this.cells.get(k)!.push({ rings: b.rings, box });
        }
    }
  }
  contains(x: number, z: number) {
    for (const b of this.cells.get(`${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`) ?? []) {
      if (x < b.box[0] || x > b.box[1] || z < b.box[2] || z > b.box[3]) continue;
      let inside = false;
      for (const ring of b.rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, zi] = ring[i], [xj, zj] = ring[j];
        if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      }
      if (inside) return true;
    }
    return false;
  }
}

export interface FitRequest {
  x: number; y: number; z: number; rotation: number;
  /** Desired height and crown radius (metres); uniform scale only. */
  height: number; radius: number;
  kind?: 'live-oak' | 'upright' | 'any'; seed: number;
  /** Crown radius / height above which a live-oak form is used. */
  oakAspect?: number;
  /** Scale reductions tried when nothing fits at full size. */
  scales?: number[]; rotations?: number;
  policy?: ColliderPolicy;
  /** Subsample probes (campus-scale populations). */
  fast?: boolean;
  /** Also require 2.4 m over paving inside the trunk zone (canopy trees). */
  trunkZonePaved?: boolean;
}
export interface FitResult {
  form: number; rotation: number; scale: number;
  woodViolations: number; foliagePaved: number; foliageInBuildings: number;
  /** Fallback used: the tree could not be made clear at any size. */
  unresolved: boolean;
  capsules: CollisionCapsule[];
}
export type CollisionCapsuleList = CollisionCapsule[];
export interface ColliderPolicy { maxOrder: number; maxLength: number; tolerance: number }
export const AUTHORED_COLLIDERS: ColliderPolicy = { maxOrder: 2, maxLength: 2.2, tolerance: .06 };
export const CANOPY_COLLIDERS: ColliderPolicy = { maxOrder: 1, maxLength: 4.5, tolerance: .18 };

const v = new T.Vector3();
function place(p: T.Vector3, req: FitRequest, rotation: number, scale: number, out: T.Vector3) {
  const c = Math.cos(rotation), s = Math.sin(rotation);
  // Matches Matrix4.compose(position, Y-rotation, uniform scale).
  return out.set((p.x * c + p.z * s) * scale + req.x, p.y * scale + req.y, (-p.x * s + p.z * c) * scale + req.z);
}

const fastProbes = new WeakMap<TreeForm, { wood: TreeForm['woodProbes']; foliage: TreeForm['foliageProbes'] }>();
function probes(form: TreeForm, fast: boolean) {
  if (!fast) return { wood: form.woodProbes, foliage: form.foliageProbes };
  let p = fastProbes.get(form);
  if (!p) fastProbes.set(form, p = { wood: form.woodProbes.filter((w, i) => w.order <= 1 || i % 3 === 0), foliage: form.foliageProbes.filter((_, i) => i % 4 === 0) });
  return p;
}

function evaluate(form: TreeForm, req: FitRequest, rotation: number, scale: number, ground: GroundQuery, footprints: Footprints | undefined, limit: number) {
  const trunkZone = Math.max(1.1, form.trunkRadius * scale * 2.6);
  let wood = 0, paved = 0, inside = 0;
  const list = probes(form, !!req.fast);
  for (const probe of list.wood) {
    if (Math.hypot(probe.p.x, probe.p.z) * scale <= trunkZone) continue;
    place(probe.p, req, rotation, scale, v);
    const bottom = v.y - probe.r * scale;
    if (footprints?.contains(v.x, v.z)) wood++;
    else {
      // Under an authored roof/overhang/deck = inside or against a building.
      const roof = ground.above?.(v.x, v.z, v.y + probe.r * scale);
      if (roof !== null && roof !== undefined && roof - v.y < 30) wood++;
      else {
        const g = ground.under(v.x, v.z, bottom);
        if (g && bottom - g.y < (g.paved ? LIMB_CLEARANCE + .1 : LAWN_LIMB_CLEARANCE)) wood++;
      }
    }
    if (wood > limit) return { wood, paved, inside };
  }
  for (const probe of list.foliage) {
    place(probe.p, req, rotation, scale, v);
    if (footprints?.contains(v.x, v.z)) { inside++; continue; }
    const bottom = v.y - probe.r * scale;
    const g = ground.under(v.x, v.z, bottom);
    if (g?.paved && bottom - g.y < FOLIAGE_PAVED_CLEARANCE) paved++;
  }
  return { wood, paved, inside };
}

function capsulesFor(form: TreeForm, req: FitRequest, rotation: number, scale: number, policy: ColliderPolicy) {
  return mergeCapsules(form.collision.filter(c => (c.order ?? 0) <= policy.maxOrder).map(c => ({
    a: place(c.a, req, rotation, scale, new T.Vector3()), b: place(c.b, req, rotation, scale, new T.Vector3()),
    radius: c.radius * scale, trunk: c.trunk, order: c.order,
  })), policy.maxLength, policy.tolerance);
}

/** Dense check of the exact collider capsules (every 0.2 m along the axis). */
export function capsulesClear(capsules: CollisionCapsule[], x: number, z: number, zone: number, ground: GroundQuery, trunkZonePaved: boolean) {
  const p = new T.Vector3();
  for (const c of capsules) for (let k = 0, m = Math.max(2, Math.ceil(c.a.distanceTo(c.b) / .1)); k <= m; k++) {
    p.copy(c.a).lerp(c.b, k / m);
    const bottom = p.y - c.radius, far = Math.hypot(p.x - x, p.z - z) > zone;
    if (!far && !trunkZonePaved) continue;
    const g = ground.under(p.x, p.z, bottom);
    if (!g) continue;
    if (g.paved && bottom - g.y < LIMB_CLEARANCE + .05) return false;
    if (far && !g.paved && bottom - g.y < .2) return false;
  }
  return true;
}

/** Choose form, rotation and (only if needed) a smaller uniform scale so no
 * visible wood or collider hangs below 2.4 m over paved walkable ground, dips
 * into lawn/terrain, or enters a building footprint / under an authored roof.
 * The authored trunk zone (≤ ~1.1 m from the trunk) is exempt unless
 * `trunkZonePaved` is set (canopy trees must not lean over paving either).
 * Accepted candidates are re-verified on their exact merged collider capsules. */
export function fitTree(forms: TreeForm[], req: FitRequest, ground: GroundQuery, footprints?: Footprints): FitResult {
  // An authored trunk inside a GIS footprint stands in a courtyard/forecourt
  // the authored building leaves open: rely on the authored roofs instead.
  if (footprints?.contains(req.x, req.z)) footprints = undefined;
  const policy = req.policy ?? AUTHORED_COLLIDERS;
  const aspect = req.radius / Math.max(1, req.height);
  const kind = req.kind && req.kind !== 'any' ? req.kind : aspect < (req.oakAspect ?? .52) ? 'upright' : 'live-oak';
  const candidates = forms.filter(f => f.spec.kind === kind)
    .map(f => ({ f, err: Math.abs(Math.log((f.spec.radius / f.spec.height) / aspect)) }))
    .sort((a, b) => a.err - b.err).slice(0, 3).map(c => c.f);
  // Seeded order among the best-matching forms gives neighbour variety.
  const start = Math.abs(Math.floor(req.seed)) % candidates.length;
  const ordered = candidates.map((_, i) => candidates[(start + i) % candidates.length]);
  const fallbackForms = forms.filter(f => f.spec.kind !== kind);
  const scales = req.scales ?? [1, .9, .8, .7, .6, .5, .4, .3];
  const rotations = req.rotations ?? 12;
  type Scored = FitResult & { score: number };
  let best: Scored | null = null, worst: Scored | null = null;
  for (const [pass, list] of [ordered, fallbackForms].entries()) {
    for (const factor of scales) {
      for (const form of list) {
        const scale = req.height / form.spec.height * factor;
        for (let r = 0; r < rotations; r++) {
          const rotation = req.rotation + (r % 2 ? -1 : 1) * Math.ceil(r / 2) * (Math.PI * 2 / rotations);
          const limit = best ? 0 : worst ? worst.woodViolations : Infinity;
          const e = evaluate(form, req, rotation, scale, ground, footprints, limit);
          const score = e.wood * 1000 + e.inside * 4 + e.paved + pass * .5 + (1 - factor) * 3;
          const result: Scored = { form: form.spec.id, rotation, scale, woodViolations: e.wood, foliagePaved: e.paved, foliageInBuildings: e.inside,
            unresolved: e.wood > 0, capsules: [], score };
          if (e.wood > 0) { if (!worst || score < worst.score) worst = result; continue; }
          if (best && score >= best.score) continue;
          result.capsules = capsulesFor(form, req, rotation, scale, policy);
          if (!capsulesClear(result.capsules, req.x, req.z, Math.max(1.1, form.trunkRadius * scale * 2.6), ground, !!req.trunkZonePaved)) continue;
          best = result;
          if (e.paved === 0 && e.inside === 0) return best;
        }
      }
      if (best) return best;
    }
  }
  if (best) return best;
  const w = worst ?? { form: ordered[0].spec.id, rotation: req.rotation, scale: req.height / ordered[0].spec.height, woodViolations: 1,
    foliagePaved: 0, foliageInBuildings: 0, unresolved: true, capsules: [], score: Infinity };
  return { ...w, unresolved: true, capsules: capsulesFor(forms[w.form], req, w.rotation, w.scale, policy) };
}

/** Merge consecutive segments of each limb into ≤ maxLength capsules, only
 * while every merged joint stays within `tolerance` of the capsule axis, so the
 * collider follows the visible limb (no chord cutting under an arch). */
export function mergeCapsules(capsules: CollisionCapsule[], maxLength = 2.2, tolerance = .06) {
  const out: CollisionCapsule[] = [];
  let cur: CollisionCapsule | null = null, joints: T.Vector3[] = [];
  const line = new T.Line3(), closest = new T.Vector3();
  for (const c of capsules) {
    if (cur && cur.b.distanceTo(c.a) < 1e-4 && cur.trunk === c.trunk && cur.a.distanceTo(c.b) <= maxLength) {
      line.set(cur.a, c.b);
      const within = [...joints, c.a].every(j => line.closestPointToPoint(j, true, closest).distanceTo(j) <= tolerance);
      if (within) { joints.push(c.a); cur = { a: cur.a, b: c.b, radius: Math.max(cur.radius, c.radius), trunk: cur.trunk }; continue; }
    }
    if (cur) out.push(cur);
    cur = { ...c }; joints = [];
  }
  if (cur) out.push(cur);
  return out;
}

export function createCapsuleColliders(physics: RAPIER.World, capsules: CollisionCapsule[]) {
  const up = new T.Vector3(0, 1, 0), q = new T.Quaternion(), d = new T.Vector3();
  return capsules.map(c => {
    d.subVectors(c.b, c.a);
    const length = d.length();
    q.setFromUnitVectors(up, length > 1e-6 ? d.clone().normalize() : up);
    const mid = c.a.clone().add(c.b).multiplyScalar(.5);
    return physics.createCollider(RAPIER.ColliderDesc.capsule(Math.max(.001, length / 2), c.radius)
      .setTranslation(mid.x, mid.y, mid.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
  });
}
