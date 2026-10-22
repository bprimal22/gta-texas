import * as T from 'three';

/**
 * Procedural tree forms for the campus canopy. Pure geometry (no textures, DOM
 * or WebGL) so the same forms drive rendering, colliders and headless checks.
 *
 * Southern live-oak forms are reference-guided (UT Speedway / Jackson School
 * photographs, inventory heights and DBH): a short trunk forking at ~2.4–3.4 m
 * into 2–4 heavy crooked scaffold limbs that run nearly horizontally, a low
 * broad dome wider than tall, and foliage as many small-leaf spray cards with
 * irregular sky holes. They are NOT scans of individual campus trees.
 * "Upright" forms stand in for taller-than-wide campus trees (elms, pecans,
 * oaks in groves) seen in canopy data; they are generic broadleaf estimates.
 *
 * Every form is authored at its own reference size and only ever scaled
 * uniformly per instance; nothing is stretched non-uniformly.
 */
export type FormKind = 'live-oak' | 'upright';
export interface FormSpec {
  id: number; kind: FormKind; seed: number;
  /** Reference height and crown radius, metres. */
  height: number; radius: number;
  forkHeight: number; scaffolds: number; lean: number; droop: number;
  /** Initial scaffold elevation (rad), trunk radius / height, limb crookedness. */
  rise: number; trunk: number; crook: number;
}
export interface Limb { points: T.Vector3[]; radii: number[]; order: number }
export interface FoliageCluster { center: T.Vector3; radius: number; shade: number; dir: T.Vector3 }
export interface CollisionCapsule { a: T.Vector3; b: T.Vector3; radius: number; trunk: boolean; order?: number }
export interface FormLod { wood: T.BufferGeometry; foliage: T.BufferGeometry }
export interface TreeForm {
  spec: FormSpec; limbs: Limb[]; clusters: FoliageCluster[]; lods: FormLod[];
  collision: CollisionCapsule[]; trunkRadius: number;
  /** Clearance probe points of visible wood (order ≤ 2), with radius. */
  woodProbes: { p: T.Vector3; r: number; order: number }[];
  /** Lowest foliage extent per cluster, for paved-clearance tests. */
  foliageProbes: { p: T.Vector3; r: number }[];
  triangles: number[];
}

// Reference-informed archetypes. Heights/radii are reference values; instance
// scale is fitted to inventory/LiDAR/authored size. R/H > 0.6 = wider than tall.
export const FORM_SPECS: FormSpec[] = [
  // Live oaks: broad short trunks (DBH ~0.9-1.25 m at 12 m) splitting low into
  // 2-4 heavy crooked scaffolds that sweep up/out, then run near-horizontal.
  { id: 0, kind: 'live-oak', seed: 9011, height: 12, radius: 9.8, forkHeight: 2.2, scaffolds: 4, lean: .35, droop: .6, rise: .78, trunk: .045, crook: .3 },
  { id: 1, kind: 'live-oak', seed: 1733, height: 12, radius: 8.8, forkHeight: 2.6, scaffolds: 3, lean: .5, droop: .4, rise: .9, trunk: .04, crook: .34 },
  { id: 2, kind: 'live-oak', seed: 4127, height: 12, radius: 10.6, forkHeight: 1.8, scaffolds: 3, lean: .25, droop: .8, rise: .7, trunk: .05, crook: .3 },
  { id: 3, kind: 'live-oak', seed: 7349, height: 12, radius: 8.0, forkHeight: 2.9, scaffolds: 2, lean: .7, droop: .3, rise: .95, trunk: .042, crook: .38 },
  { id: 4, kind: 'live-oak', seed: 2281, height: 12, radius: 9.2, forkHeight: 2.4, scaffolds: 4, lean: .45, droop: .5, rise: .85, trunk: .046, crook: .28 },
  { id: 5, kind: 'live-oak', seed: 6619, height: 12, radius: 8.4, forkHeight: 2.0, scaffolds: 3, lean: .3, droop: .3, rise: 1.0, trunk: .044, crook: .34 },
  { id: 6, kind: 'live-oak', seed: 3851, height: 12, radius: 10.0, forkHeight: 1.6, scaffolds: 3, lean: .6, droop: .7, rise: .8, trunk: .052, crook: .38 },
  { id: 7, kind: 'live-oak', seed: 1207, height: 12, radius: 9.0, forkHeight: 3.0, scaffolds: 4, lean: .2, droop: .25, rise: 1.05, trunk: .04, crook: .3 },
  // Generic taller-than-wide campus trees (canopy data with narrow crowns).
  { id: 8, kind: 'upright', seed: 5003, height: 14, radius: 5.6, forkHeight: 3.2, scaffolds: 3, lean: .25, droop: .1, rise: 1.2, trunk: .03, crook: .22 },
  { id: 9, kind: 'upright', seed: 8807, height: 14, radius: 6.6, forkHeight: 3.0, scaffolds: 4, lean: .35, droop: .2, rise: 1.1, trunk: .032, crook: .24 },
  // Clear-stem plaza tree (tree grates beside facades): high fork, narrow crown.
  { id: 10, kind: 'upright', seed: 3313, height: 11, radius: 3.9, forkHeight: 4.2, scaffolds: 3, lean: .15, droop: 0, rise: 1.25, trunk: .03, crook: .2 },
];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
function hash3(x: number, y: number, z: number) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
/** Smooth 3D value noise in [0,1]. */
function noise3(x: number, y: number, z: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(ix + dx, iy + dy, iz + dz);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), sx), l(c(0, 1, 0), c(1, 1, 0), sx), sy),
    l(l(c(0, 0, 1), c(1, 0, 1), sx), l(c(0, 1, 1), c(1, 1, 1), sx), sy), sz);
}

/** Crown dome height at horizontal distance r (0..R): low broad live-oak dome. */
function envelope(spec: FormSpec, r: number) {
  const u = Math.min(1, r / spec.radius);
  return spec.kind === 'live-oak'
    ? spec.height * (1 - .48 * u * u)
    : spec.height * Math.sqrt(Math.max(0, 1 - .78 * u * u * u));
}

export function buildForm(spec: FormSpec): TreeForm {
  const random = rng(spec.seed), jitter = (s: number) => (random() - .5) * 2 * s;
  const { height: H, radius: R } = spec;
  const oak = spec.kind === 'live-oak';
  const trunkRadius = spec.trunk * H;
  const limbs: Limb[] = [], clusters: FoliageCluster[] = [];
  const leanAz = random() * Math.PI * 2, crookAz = leanAz + Math.PI / 2 + jitter(.8);
  const fork = new T.Vector3(Math.cos(leanAz) * spec.lean, spec.forkHeight, Math.sin(leanAz) * spec.lean);

  // Trunk: near-vertical below ~1.2 m (keeps the authored trunk footprint),
  // a crook and lean above, lobed root flare at the base, short and broad.
  const trunkPts: T.Vector3[] = [], trunkR: number[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8, y = -.25 + (spec.forkHeight + .25) * t;
    const bend = Math.pow(Math.max(0, (y - 1.0) / Math.max(.3, spec.forkHeight - 1.0)), 1.5);
    const kink = Math.sin(Math.PI * t) * spec.crook * .35 * Math.min(1, Math.max(0, y) / 1.2);
    trunkPts.push(new T.Vector3(fork.x * bend + Math.cos(crookAz) * kink, y, fork.z * bend + Math.sin(crookAz) * kink));
    trunkR.push(trunkRadius * (1 + .6 * Math.exp(-Math.max(0, y) / .4)) * (1 - .1 * t));
  }
  limbs.push({ points: trunkPts, radii: trunkR, order: 0 });

  /** Grow a crooked limb by direction steps (elevation from `steer`). */
  const grow = (start: T.Vector3, az: number, length: number, r0: number, r1: number, order: number,
    steer: (t: number, p: T.Vector3) => number, wobble: number, elbows = 0) => {
    const pts = [start.clone()], radii = [r0];
    const step = order <= 1 ? .8 : .7, n = Math.max(3, Math.round(length / step));
    const elbowAt = Array.from({ length: elbows }, () => Math.floor(1 + random() * (n - 2)));
    let a = az, p = start.clone(), kick = 0;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      a += jitter(wobble);
      // Elbows: the abrupt direction changes of old live-oak limbs.
      if (elbowAt.includes(i)) { a += (random() < .5 ? -1 : 1) * (.35 + random() * .3); kick = jitter(.28); }
      const e = steer(t, p) + jitter(wobble * .5) + kick; kick *= .4;
      p = p.clone().add(new T.Vector3(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)).multiplyScalar(length / n));
      pts.push(p); radii.push(r0 + (r1 - r0) * Math.pow(t, .7));
    }
    const limb = { points: pts, radii, order }; limbs.push(limb); return limb;
  };

  // Heavy scaffolds start inside the trunk top (blended split), sweep up and
  // out, run near-horizontal with a slight droop, and lift at the tips.
  const scaffolds: Limb[] = [];
  for (let i = 0; i < spec.scaffolds; i++) {
    const az = leanAz + (i / spec.scaffolds) * Math.PI * 2 + jitter(.5);
    const reach = R * (oak ? .86 + random() * .18 : .55 + random() * .2);
    const out = new T.Vector3(Math.cos(az), 0, Math.sin(az));
    const start = fork.clone().addScaledVector(out, trunkRadius * .25).add(new T.Vector3(0, -.3 - random() * .25, 0));
    const e0 = spec.rise + jitter(.12), peak = oak ? H * (.5 + random() * .08) : H * (.66 + random() * .08);
    const steer = oak
      ? (t: number, p: T.Vector3) => {
        const e = t < .42 ? e0 * (1 - t / .42) + .1 * (t / .42) : t < .82 ? .1 - spec.droop * .5 * (t - .42) / .4 : .32;
        return p.y > peak ? Math.min(e, 0) : e;
      }
      : (t: number) => e0 - t * .5;
    scaffolds.push(grow(start, az, reach * (oak ? 1.12 : 1.3), trunkRadius * (.66 + random() * .14), trunkRadius * .1, 1, steer,
      spec.crook * .6, oak ? 2 : 1));
  }
  // Leader(s) fill the crown top.
  const leaders: Limb[] = [];
  for (let i = 0; i < (oak ? 1 : 2); i++)
    leaders.push(grow(fork.clone().add(new T.Vector3(0, -.2, 0)), random() * Math.PI * 2, H * (oak ? .4 : .6),
      trunkRadius * .45, trunkRadius * .07, 1, t => (oak ? .95 : 1.2) - t * .5, spec.crook * (oak ? .8 : .5), oak ? 2 : 1));

  // Secondaries aim at random points on the crown dome near their azimuth;
  // one heavy upper sweep per scaffold builds the interlocking upper limbs.
  const secondaries: Limb[] = [];
  for (const parent of [...scaffolds, ...leaders]) {
    const n = parent.points.length;
    for (let k = 2; k < n; k += 2) {
      const from = parent.points[k], radius = parent.radii[k];
      const fromR = Math.hypot(from.x, from.z), fromAz = Math.atan2(from.z, from.x);
      for (let side = 0; side < (k > n * .5 ? 2 : 1); side++) {
        const heavy = side === 0 && k === 2 && oak;
        const az = fromAz + jitter(heavy ? .6 : .85);
        const rr = Math.min(R * .98, fromR + R * (heavy ? .3 + random() * .25 : .12 + random() * .32));
        const target = new T.Vector3(Math.cos(az) * rr, 0, Math.sin(az) * rr);
        target.y = envelope(spec, rr) * (heavy ? .9 + random() * .08 : .8 + random() * .17);
        if (target.y < from.y + .4) target.y = from.y + .4 + random() * 1.2;
        const d = target.clone().sub(from), len = d.length();
        const e = Math.asin(T.MathUtils.clamp(d.y / len, -1, 1)), a = Math.atan2(d.z, d.x);
        secondaries.push(grow(from.clone(), a, len, Math.max(.035, radius * (heavy ? .7 : .52)), .02, 2,
          t => e + (heavy ? .25 * (1 - t) : 0) - (heavy ? .12 : 0), oak ? .3 : .2, heavy || len > 2.5 ? 1 : 0));
      }
    }
  }
  // Twigs and foliage clusters (cluster dir = twig direction, for card orientation).
  for (const s of secondaries) {
    const n = s.points.length;
    for (let k = Math.max(1, Math.floor(n * .3)); k < n; k++) {
      const p = s.points[k];
      const count = k === n - 1 ? 3 : 2;
      for (let j = 0; j < count; j++) {
        const end = p.clone().add(new T.Vector3(jitter(1.3), .2 + jitter(.7), jitter(1.3)));
        const r = Math.hypot(end.x, end.z), top = envelope(spec, r);
        if (end.y > top) end.y = top - random() * .3;
        if (k === n - 1 || random() < .55) limbs.push({ points: [p.clone(), p.clone().lerp(end, .55).add(new T.Vector3(0, .12, 0)), end], radii: [.024, .015, .006], order: 3 });
        clusters.push({ center: end, radius: (oak ? 1.0 : .95) + random() * .4, shade: 1, dir: end.clone().sub(p).normalize() });
      }
    }
  }
  // Leaves along the outer half of scaffolds (live oaks keep foliage along limbs).
  for (const s of scaffolds) for (let k = Math.floor(s.points.length * .45); k < s.points.length; k++) {
    const d = s.points[k].clone().sub(s.points[k - 1]).normalize();
    clusters.push({ center: s.points[k].clone().add(new T.Vector3(jitter(.6), .35 + random() * .4, jitter(.6))), radius: .9 + random() * .3, shade: .8,
      dir: d.add(new T.Vector3(0, .6, 0)).normalize() });
  }

  // Irregular sky holes: drop clusters in low-noise pockets of the crown.
  // Live-oak foliage is a layer 3-5 m thick under the dome (thicker toward the
  // drooping edge); below it the crooked limbs stay visible from the path.
  // Two noise octaves cut many small and a few large sky holes.
  const kept = clusters.filter(c => {
    const r = Math.hypot(c.center.x, c.center.z), layer = oak ? 3.2 + 2.2 * Math.min(1, r / R) : 5;
    if (c.center.y < envelope(spec, r) - layer) return false;
    const holes = noise3(c.center.x * .3 + spec.seed, c.center.y * .36, c.center.z * .3) * .65
      + noise3(c.center.x * .9 - spec.seed, c.center.y * 1.1, c.center.z * .9) * .35;
    return holes > .4 && random() > .1;
  });
  const crownCenter = new T.Vector3(0, oak ? H * .58 : H * .62, 0);
  for (const c of kept) {
    const rel = c.center.clone().sub(crownCenter);
    const outer = T.MathUtils.clamp(Math.hypot(rel.x / R, rel.y / (H * .45), rel.z / R), 0, 1);
    c.shade *= .55 + .45 * outer;
  }

  // Collision: trunk and heavy limbs only (thin wood and leaves are walk-through).
  const collision: CollisionCapsule[] = [];
  const minCollider = trunkRadius * .3;
  for (const limb of limbs) {
    if (limb.order > 2) continue;
    for (let i = 1; i < limb.points.length; i++) {
      const r = (limb.radii[i - 1] + limb.radii[i]) / 2;
      if (r < minCollider) continue;
      collision.push({ a: limb.points[i - 1].clone(), b: limb.points[i].clone(), radius: r * .92, trunk: limb.order === 0, order: limb.order });
    }
  }
  const woodProbes: TreeForm['woodProbes'] = [];
  for (const limb of limbs) if (limb.order <= 2)
    for (let i = 0; i < limb.points.length; i++) woodProbes.push({ p: limb.points[i], r: limb.radii[i], order: limb.order });
  const foliageProbes = kept.map(c => ({ p: c.center, r: c.radius * .75 }));

  const lods: FormLod[] = [];
  // Near: many small sprays (soft, fine texture); far keeps few larger cards.
  const settings = [
    { sides: [16, 12, 6, 3], maxOrder: 3, cards: 14, size: .82, tiles: [0, 1, 2] },
    { sides: [9, 7, 4, 0], maxOrder: 2, cards: 5, size: 1.25, tiles: [0, 1, 2, 3] },
    { sides: [6, 5, 3, 0], maxOrder: 1, cards: 2, size: 2.1, tiles: [3, 3, 0] },
  ];
  for (const [level, s] of settings.entries()) {
    lods.push({ wood: woodGeometry(limbs, s.sides, s.maxOrder, level), foliage: foliageGeometry(kept, crownCenter, spec, s.cards, s.size, s.tiles, level) });
  }
  const triangles = lods.map(l => (l.wood.index!.count + l.foliage.index!.count) / 3);
  return { spec, limbs, clusters: kept, lods, collision, trunkRadius, woodProbes, foliageProbes, triangles };
}

function woodGeometry(limbs: Limb[], sidesByOrder: number[], maxOrder: number, level: number) {
  const pos: number[] = [], uv: number[] = [], nor: number[] = [], idx: number[] = [];
  const up = new T.Vector3(0, 1, 0);
  for (const limb of limbs) {
    if (limb.order > maxOrder) continue;
    const sides = sidesByOrder[limb.order];
    if (!sides) continue;
    // Skip the finest secondaries in far levels.
    if (level === 2 && limb.order === 1 && limb.radii[0] < .12) continue;
    const pts = limb.points, n = pts.length;
    const normal = new T.Vector3();
    const tangent0 = pts[1].clone().sub(pts[0]).normalize();
    normal.crossVectors(tangent0, Math.abs(tangent0.y) > .9 ? new T.Vector3(1, 0, 0) : up).normalize();
    let along = 0;
    const base = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const tangent = (i === n - 1 ? pts[i].clone().sub(pts[i - 1]) : pts[i + 1].clone().sub(pts[i > 0 ? i - 1 : i])).normalize();
      // Parallel transport keeps the bark texture from twisting.
      normal.sub(tangent.clone().multiplyScalar(normal.dot(tangent))).normalize();
      const binormal = new T.Vector3().crossVectors(tangent, normal);
      if (i > 0) along += pts[i].distanceTo(pts[i - 1]);
      const r = limb.radii[i];
      for (let j = 0; j <= sides; j++) {
        const a = (j / sides) * Math.PI * 2;
        // Lobed root flare / fluting on the trunk base only.
        const lobe = limb.order === 0 ? 1 + .1 * Math.sin(a * 5 + 1.3) * Math.exp(-Math.max(0, pts[i].y) / .6) : 1;
        const dir = normal.clone().multiplyScalar(Math.cos(a)).addScaledVector(binormal, Math.sin(a));
        const p = pts[i].clone().addScaledVector(dir, r * lobe);
        pos.push(p.x, p.y, p.z); nor.push(dir.x, dir.y, dir.z);
        uv.push((j / sides) * Math.max(.25, 2 * Math.PI * r) / .8, along / .8);
      }
    }
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < sides; j++) {
      const a = base + i * (sides + 1) + j, b = a + sides + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  // BatchedMesh requires identical attribute sets; wood carries a white colour.
  g.setAttribute('color', new T.Float32BufferAttribute(new Float32Array(pos.length).fill(1), 3));
  g.setIndex(idx); g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

function foliageGeometry(clusters: FoliageCluster[], crownCenter: T.Vector3, spec: FormSpec, cardsPer: number,
  size: number, tiles: number[], level: number) {
  const random = rng(spec.seed * 31 + level * 977);
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  const v = new T.Vector3(), radial = new T.Vector3(), up = new T.Vector3(), side = new T.Vector3(), cardN = new T.Vector3();
  const sphere = new T.Vector3(), n = new T.Vector3(), rnd = new T.Vector3();
  const squash = new T.Vector3(1 / spec.radius, 1 / (spec.height * .5), 1 / spec.radius);
  for (const cluster of clusters) {
    // Each cluster is a small rounded clump: its own "sphere" centre sits a
    // little behind the twig tip so normals bulge outward (soft lighting).
    const clumpCentre = cluster.center.clone().addScaledVector(cluster.dir, -cluster.radius * .35);
    const clusterTint = .9 + random() * .2, hue = (random() - .5) * .12;
    for (let k = 0; k < cardsPer; k++) {
      const center = cluster.center.clone().add(rnd.set(random() - .5, (random() - .5) * .6, random() - .5).multiplyScalar(cluster.radius * 1.1))
        .addScaledVector(cluster.dir, (random() - .3) * cluster.radius * .5);
      radial.copy(center).sub(crownCenter).multiply(squash).normalize();
      // Spray "up" (twig base → tip) follows the branch tip with jitter; the
      // card plane turns around it so sprays are seen from many angles.
      up.copy(cluster.dir).add(rnd.set(random() - .5, random() - .5, random() - .5).multiplyScalar(.9)).normalize();
      side.crossVectors(up, rnd.set(random() - .5, random() - .5, random() - .5).add(radial).normalize());
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      side.normalize(); cardN.crossVectors(side, up).normalize();
      const s = size * (.75 + random() * .5) * (cluster.radius / 1.1);
      const tile = tiles[Math.floor(random() * tiles.length)], u0 = (tile % 2) * .5, v0 = tile < 2 ? .5 : 0;
      const shade = cluster.shade * clusterTint * (.9 + random() * .2);
      const base = pos.length / 3;
      for (const [x, y] of [[-.5, -.15], [.5, -.15], [.5, .85], [-.5, .85]]) {
        // Twig base (tile v = 0) sits at the clump, the spray extends outward.
        v.copy(center).addScaledVector(side, x * s).addScaledVector(up, y * s);
        pos.push(v.x, v.y, v.z);
        // Bent normals: mostly the clump's sphere normal, some crown radial,
        // a little of the card plane — rounded, soft, no flat card facets.
        sphere.copy(v).sub(clumpCentre).normalize();
        n.copy(sphere).multiplyScalar(.58).addScaledVector(radial, .32).addScaledVector(cardN, .1).normalize();
        nor.push(n.x, n.y, n.z);
        uv.push(u0 + (x + .5) * .5, v0 + (y + .15) * .5);
        const tint = shade * (.93 + .1 * (y + .15));
        col.push(tint * (1 + hue), tint * (1 + hue * .4), tint * (.92 - hue * .6 + random() * .06));
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

let cache: TreeForm[] | null = null;
/** Shared, lazily built forms (one set per page; geometry is reused by every batch). */
export function treeForms() { return cache ??= FORM_SPECS.map(buildForm); }
export function disposeTreeForms() {
  if (!cache) return;
  for (const f of cache) for (const l of f.lods) { l.wood.dispose(); l.foliage.dispose(); }
  cache = null;
}
