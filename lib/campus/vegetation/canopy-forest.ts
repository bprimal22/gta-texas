import * as T from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { treeForms } from './oak-forms';
import type { TreeMaterials } from './tree-materials';
import { TreeBatches, CANOPY_LODS, type PlacedTree, type ImpostorSet } from './tree-batches';
import { fitTree, createCapsuleColliders, CANOPY_COLLIDERS, type Footprints, type CollisionCapsuleList } from './tree-fit';
import type { GroundQuery } from './ground-index';

/** Schema published by the lidar lane (CONTRACT.md). */
export interface CanopyTree { x: number; z: number; groundY: number; height: number; crownRadius: number; confidence: number }
export interface CanopyData { source: string; trees: CanopyTree[] }
/** Processed UT TreeKeeper public site layer (tools/vegetation/build_tree_sites.py). */
export interface TreeSitesData { source: string; fields: string[]; counts: Record<string, unknown>; sites: [number, number, number, number][] }

export const CANOPY_URL = '/data/derived/canopy-trees.json';
export const TREE_SITES_URL = '/assets/vegetation/tree-sites.json';
/** Campus bounds [west, north, east, south] (CONTRACT.md). */
export const CAMPUS_BOUNDS = [-760, -864, 1296, 1536] as const;
/** Inventory coverage = union of discs of this radius around every inventory
 * site (all types: a vacant site still means the area was inventoried). */
export const COVERAGE_RADIUS = 30;
/** Official site ↔ CHM crown association distance and crown sharing. */
export const MATCH_DISTANCE = 7, CROWN_SHARE = 2;
/** Official sites this close to an authored placement are the same tree. */
export const AUTHORED_DUPLICATE = 2.5;
/** Minimum spacing between instantiated (non-authored) trunks. */
export const MIN_TRUNK_SPACING = 1.5;
/** Limb capsules whose underside is ≥ this above the ground below them are
 * streamed (created within STREAM_IN m of the camera, removed beyond
 * STREAM_OUT); trunks and lower limbs stay resident. 2.2 m clears a standing
 * player capsule (top 1.83 m), so arrivals never land inside a missing limb. */
export const RESIDENT_LIMB_HEIGHT = 2.2, STREAM_IN = 90, STREAM_OUT = 120;

async function fetchJson<D>(url: string): Promise<D | null> {
  if (!url.startsWith('/') || url.startsWith('//')) throw Error('Vegetation data must be same-origin');
  try {
    const response = await fetch(url);
    return response.ok ? await response.json() as D : null;
  } catch { return null; }
}
export async function loadCanopyData(url = CANOPY_URL) {
  const data = await fetchJson<CanopyData>(url);
  return Array.isArray(data?.trees) ? data : null;
}
export async function loadTreeSites(url = TREE_SITES_URL) {
  const data = await fetchJson<TreeSitesData>(url);
  return Array.isArray(data?.sites) ? data : null;
}

export type TreeSource = 'official' | 'chm' | 'osm';
export interface TreeProvenance {
  source: TreeSource;
  /** TreeKeeper site_id (official). */
  siteId: number | null;
  /** Index into canopy-trees.json and distance to it ('none' = null). */
  chm: number | null; chmDistance: number | null;
  /** Height/crown not measured for this tree (default/neighbourhood estimate). */
  sizeEstimated: boolean;
  /** Horizontal distance the trunk was nudged off paving (m). */
  moved: number;
}

export interface CanopyForestOptions {
  sites: TreeSitesData | null;
  canopy: CanopyData | null;
  osm?: { position: number[] }[];
  physics: RAPIER.World;
  ground: GroundQuery;
  footprints: Footprints;
  /** Authored tree trunks (x, z): authoritative hero placements. */
  authored: { x: number; z: number }[];
  materials: TreeMaterials;
  impostors: ImpostorSet | null;
  minConfidence?: number;
}

class PointGrid {
  private cells = new Map<string, { x: number; z: number; i: number }[]>();
  constructor(private size = 16) {}
  add(x: number, z: number, i = 0) {
    const k = `${Math.floor(x / this.size)},${Math.floor(z / this.size)}`;
    let list = this.cells.get(k); if (!list) this.cells.set(k, list = []); list.push({ x, z, i });
  }
  near(x: number, z: number, r: number, fn?: (p: { x: number; z: number; i: number }, d: number) => void) {
    const reach = Math.ceil(r / this.size); let found = false;
    for (let a = -reach; a <= reach; a++) for (let b = -reach; b <= reach; b++)
      for (const p of this.cells.get(`${Math.floor(x / this.size) + a},${Math.floor(z / this.size) + b}`) ?? []) {
        const d = Math.hypot(p.x - x, p.z - z);
        if (d < r) { found = true; if (!fn) return true; fn(p, d); }
      }
    return found;
  }
}

const median = (v: number[]) => { const s = v.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

/**
 * Campus-wide trees, official positions first:
 *  1. UT TreeKeeper inventory sites (type 1 only) inside inventory coverage,
 *     sized from the associated 2017 LiDAR CHM crown (greedy nearest within
 *     7 m, ≤ 2 sites per crown) or, unmatched, a neighbourhood estimate;
 *  2. residual CHM crowns only OUTSIDE inventory coverage (approximate trunks);
 *  3. OSM mapped trees where neither exists (sizes estimated).
 * Authored placements stay authoritative; no populations are stacked.
 * Every tree passes the same route protection as before (tree-fit).
 */
export function buildCanopyForest(o: CanopyForestOptions) {
  const t0 = performance.now();
  const forms = treeForms();
  const [w, n, e, s] = CAMPUS_BOUNDS;
  const inBounds = (x: number, z: number) => x >= w && x <= e && z >= n && z <= s;
  const authored = new PointGrid(), trunks = new PointGrid();
  for (const a of o.authored) authored.add(a.x, a.z);

  // --- Inventory coverage (5 m raster of 30 m site buffers) -----------------
  const cell = 5, cw = Math.ceil((e - w) / cell), ch = Math.ceil((s - n) / cell), coverage = new Uint8Array(cw * ch);
  const sites = (o.sites?.sites ?? []).filter(([, x, z]) => inBounds(x, z));
  for (const [, x, z] of sites) {
    const r = COVERAGE_RADIUS;
    for (let j = Math.max(0, Math.floor((z - r - n) / cell)); j <= Math.min(ch - 1, Math.floor((z + r - n) / cell)); j++)
      for (let i = Math.max(0, Math.floor((x - r - w) / cell)); i <= Math.min(cw - 1, Math.floor((x + r - w) / cell)); i++)
        if (Math.hypot(w + (i + .5) * cell - x, n + (j + .5) * cell - z) <= r) coverage[j * cw + i] = 1;
  }
  const covered = (x: number, z: number) => {
    const i = Math.floor((x - w) / cell), j = Math.floor((z - n) / cell);
    return i >= 0 && j >= 0 && i < cw && j < ch && coverage[j * cw + i] === 1;
  };
  let coveredCells = 0; for (const c of coverage) coveredCells += c;

  // --- CHM crowns --------------------------------------------------------------
  const crowns = (o.canopy?.trees ?? []).map((t, i) => ({ ...t, i }))
    .filter(t => Number.isFinite(t.x) && Number.isFinite(t.z) && inBounds(t.x, t.z) && t.height >= 3 && t.height <= 40);
  const crownGrid = new PointGrid();
  crowns.forEach((c, k) => crownGrid.add(c.x, c.z, k));

  const counts = {
    official: { read: Number(o.sites?.counts?.read ?? 0), inBounds: sites.length, type1: 0, excludedType2: 0, excludedType3: 0,
      duplicateSites: 0, authoredDuplicates: 0, building: 0, noGround: 0, nudgedOffPaving: 0, skippedPaving: 0, noClearFit: 0,
      chmMatched: 0, sizeEstimated: 0, placed: 0 },
    chm: { total: o.canopy?.trees.length ?? 0, usable: crowns.length, matchedToOfficial: 0, insideCoverageUnmatched: 0,
      outsideCoverage: 0, lowConfidence: 0, duplicates: 0, building: 0, noGround: 0, paved: 0, noClearFit: 0, relocated: 0, placed: 0 },
    osm: { total: o.osm?.length ?? 0, insideCoverage: 0, nearChmOrTree: 0, rejected: 0, placed: 0 },
    coverageKm2: +(coveredCells * cell * cell / 1e6).toFixed(3),
  };

  // --- Official type-1 sites: dedupe, authored duplicates, CHM association -------
  const official: { siteId: number; x: number; z: number }[] = [];
  const siteGrid = new PointGrid();
  for (const [siteId, x, z, type] of sites) {
    if (type === 2) { counts.official.excludedType2++; continue; }
    if (type === 3) { counts.official.excludedType3++; continue; }
    if (type !== 1) continue;
    counts.official.type1++;
    if (siteGrid.near(x, z, MIN_TRUNK_SPACING)) { counts.official.duplicateSites++; continue; }
    if (authored.near(x, z, AUTHORED_DUPLICATE)) { counts.official.authoredDuplicates++; continue; }
    siteGrid.add(x, z); official.push({ siteId, x, z });
  }
  const pairs: { s: number; c: number; d: number }[] = [];
  official.forEach((site, si) => crownGrid.near(site.x, site.z, MATCH_DISTANCE, (p, d) => pairs.push({ s: si, c: p.i, d })));
  pairs.sort((a, b) => a.d - b.d);
  const matchOf = new Int32Array(official.length).fill(-1), matchDist = new Float32Array(official.length), crownUse = new Uint8Array(crowns.length);
  for (const p of pairs) {
    if (matchOf[p.s] >= 0 || crownUse[p.c] >= CROWN_SHARE) continue;
    matchOf[p.s] = p.c; matchDist[p.s] = p.d; crownUse[p.c]++;
  }
  // Size for each official site: its crown (radius shared when one crown
  // informs two trunks) or the median of matched sites within 40 m.
  const sized = official.map((site, si) => {
    const c = matchOf[si];
    if (c < 0) return null;
    const crown = crowns[c];
    return { height: crown.height, radius: crown.crownRadius * (crownUse[c] > 1 ? .75 : 1) };
  });
  const matchedGrid = new PointGrid();
  sized.forEach((v, si) => { if (v) matchedGrid.add(official[si].x, official[si].z, si); });
  const globalH = median(sized.flatMap(v => v ? [v.height] : [])), globalR = median(sized.flatMap(v => v ? [v.radius] : []));

  const placed: PlacedTree[] = [], provenance: TreeProvenance[] = [];
  const capsules: CollisionCapsuleList = [], owners: number[] = [];
  let reduced = 0;
  const tint = (x: number, z: number) => .86 + .22 * (((Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1 + 1) % 1);
  /** Trunk point not on paving (centre + 0.6 m ring at the same level). */
  const pavedAt = (x: number, z: number, y: number) => {
    const g = o.ground.under(x, z, y);
    if (!g) return true;
    if (g.paved) return true;
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4, h = o.ground.under(x + Math.cos(a) * .6, z + Math.sin(a) * .6, g.y + .6);
      if (h?.paved && Math.abs(h.y - g.y) < 1) return true;
    }
    return false;
  };
  const fitAt = (x: number, z: number, y: number, height: number, radius: number, seed: number, scales: number[], rotations: number) =>
    fitTree(forms, { x, y, z, rotation: (seed * 2.39996) % (Math.PI * 2), height, radius, seed, scales, rotations,
      policy: CANOPY_COLLIDERS, fast: true, trunkZonePaved: true,
      // LiDAR watershed splits interlocking crowns, so measured radii run small.
      oakAspect: .42 }, o.ground, o.footprints);
  const accept = (x: number, y: number, z: number, fit: ReturnType<typeof fitTree>, height: number, p: TreeProvenance) => {
    if (fit.scale * forms[fit.form].spec.height < height * .999) reduced++;
    placed.push({ x, y, z, rotation: fit.rotation, scale: fit.scale, form: fit.form, tint: tint(x, z) });
    provenance.push(p);
    for (const c of fit.capsules) { capsules.push(c); owners.push(placed.length - 1); }
    trunks.add(x, z, placed.length - 1);
  };

  official.forEach((site, si) => {
    let size = sized[si];
    const estimated = !size;
    if (!size) {
      const hs: number[] = [], rs: number[] = [];
      matchedGrid.near(site.x, site.z, 40, p => { const v = sized[p.i]!; hs.push(v.height); rs.push(v.radius); });
      size = hs.length >= 3 ? { height: median(hs), radius: median(rs) } : { height: globalH || 9, radius: globalR || 4 };
    }
    if (o.footprints.contains(site.x, site.z)) { counts.official.building++; return; }
    const g = o.ground.under(site.x, site.z, 400);
    if (!g) { counts.official.noGround++; return; }
    // Off paving: a site on authored paving is likely a tree well / planter
    // mismatch; nudge ≤ 1.5 m to the nearest clear spot, else skip.
    let x = site.x, z = site.z, y = g.y, moved = 0;
    if (pavedAt(x, z, g.y + 2)) {
      let found = false;
      for (const r of [.5, 1, 1.5]) {
        for (let k = 0; k < 12 && !found; k++) {
          const a = k * Math.PI / 6, nx = site.x + Math.cos(a) * r, nz = site.z + Math.sin(a) * r;
          if (trunks.near(nx, nz, MIN_TRUNK_SPACING) || authored.near(nx, nz, AUTHORED_DUPLICATE)) continue;
          const h = o.ground.under(nx, nz, g.y + 2);
          if (!h || Math.abs(h.y - g.y) > 1.2 || pavedAt(nx, nz, h.y + .2) || o.footprints.contains(nx, nz)) continue;
          x = nx; z = nz; y = h.y; moved = r; found = true;
        }
        if (found) break;
      }
      if (!found) { counts.official.skippedPaving++; return; }
      counts.official.nudgedOffPaving++;
    }
    if (trunks.near(x, z, MIN_TRUNK_SPACING)) { counts.official.duplicateSites++; return; }
    const fit = fitAt(x, z, y - .02, size.height, size.radius, site.siteId, [1, .85, .7, .55, .4], 6);
    if (fit.unresolved) { counts.official.noClearFit++; return; }
    if (!estimated) counts.official.chmMatched++; else counts.official.sizeEstimated++;
    counts.official.placed++;
    accept(x, y - .02, z, fit, size.height, { source: 'official', siteId: site.siteId, chm: estimated ? null : crowns[matchOf[si]].i,
      chmDistance: estimated ? null : +matchDist[si].toFixed(2), sizeEstimated: estimated, moved });
  });
  counts.chm.matchedToOfficial = crowns.reduce((a, _, k) => a + (crownUse[k] ? 1 : 0), 0);

  // --- Residual CHM crowns outside inventory coverage --------------------------
  const residual = crowns.filter((c, k) => {
    if (crownUse[k]) return false;
    if (covered(c.x, c.z)) { counts.chm.insideCoverageUnmatched++; return false; }
    counts.chm.outsideCoverage++;
    return true;
  }).sort((a, b) => b.height - a.height);
  const chmGrid = new PointGrid();
  for (const t of residual) {
    if ((t.confidence ?? 1) < (o.minConfidence ?? .4)) { counts.chm.lowConfidence++; continue; }
    const crown = T.MathUtils.clamp(Number.isFinite(t.crownRadius) ? t.crownRadius : t.height * .45, 1.2, 16);
    // Not within its crown (≥ 4 m) of an official/authored trunk; LiDAR double tops.
    if (trunks.near(t.x, t.z, Math.max(4, crown)) || authored.near(t.x, t.z, Math.max(4, crown))) { counts.chm.duplicates++; continue; }
    if (chmGrid.near(t.x, t.z, Math.max(2.5, crown * .35))) { counts.chm.duplicates++; continue; }
    // Crown tops of leaning street trees often sit over paving while the trunk
    // stands in the adjacent parkway: try the top, then up to 2.5 m away.
    type Trial = { x: number; z: number; y: number; fit: ReturnType<typeof fitTree> } | 'building' | 'noGround' | 'paved' | 'noClearFit';
    const attempt = (x: number, z: number): Trial => {
      if (o.footprints.contains(x, z)) return 'building';
      const g = o.ground.under(x, z, Number.isFinite(t.groundY) ? t.groundY + 4 : 400);
      if (!g) return 'noGround';
      let paved = g.paved;
      for (let k = 0; k < 16 && !paved; k++) {
        const a = k * Math.PI / 4, d = k < 8 ? .8 : 1.5, h = o.ground.under(x + Math.cos(a) * d, z + Math.sin(a) * d, g.y + .6);
        paved = !!h?.paved && Math.abs(h.y - g.y) < 1.5;
      }
      if (paved) return 'paved';
      const fit = fitAt(x, z, g.y - .02, t.height, crown, Math.round(x * 3.1 + z * 1.7), [1, .8, .6], 4);
      return fit.unresolved ? 'noClearFit' : { x, z, y: g.y - .02, fit };
    };
    const first = attempt(t.x, t.z);
    let trial = first;
    for (let k = 0; k < 16 && typeof trial === 'string' && (first === 'paved' || first === 'building'); k++) {
      const a = (k % 8) * Math.PI / 4 + (k >= 8 ? Math.PI / 8 : 0), d = k < 8 ? 1.25 : 2.5;
      const x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
      if (authored.near(x, z, 2.5) || chmGrid.near(x, z, 2.5) || trunks.near(x, z, 2.5)) continue;
      trial = attempt(x, z);
    }
    if (typeof trial === 'string') { counts.chm[typeof first === 'string' ? first : trial]++; continue; }
    const moved = Math.hypot(trial.x - t.x, trial.z - t.z);
    if (moved > 0) counts.chm.relocated++;
    counts.chm.placed++;
    chmGrid.add(trial.x, trial.z);
    accept(trial.x, trial.y, trial.z, trial.fit, t.height, { source: 'chm', siteId: null, chm: t.i, chmDistance: +moved.toFixed(2), sizeEstimated: false, moved });
  }

  // --- OSM fallback where neither official sites nor CHM crowns exist ----------
  for (const [k, p] of (o.osm ?? []).entries()) {
    const [x, z] = p.position;
    if (!inBounds(x, z)) continue;
    if (covered(x, z)) { counts.osm.insideCoverage++; continue; }
    if (crownGrid.near(x, z, 6) || trunks.near(x, z, 4) || authored.near(x, z, 4)) { counts.osm.nearChmOrTree++; continue; }
    const g = o.ground.under(x, z, 400);
    if (!g || o.footprints.contains(x, z) || pavedAt(x, z, g.y + 2)) { counts.osm.rejected++; continue; }
    const fit = fitAt(x, z, g.y - .02, 9, 5, k + 7, [1, .8, .6], 4);
    if (fit.unresolved) { counts.osm.rejected++; continue; }
    counts.osm.placed++;
    accept(x, g.y - .02, z, fit, 9, { source: 'osm', siteId: null, chm: null, chmDistance: null, sizeEstimated: true, moved: 0 });
  }

  // --- Colliders: resident trunks + low limbs; higher limbs streamed ------------
  const resident: CollisionCapsuleList = [], residentOwners: number[] = [];
  const streamed: { tree: number; capsule: CollisionCapsuleList[number] }[] = [];
  capsules.forEach((c, i) => {
    let low = c.trunk;
    if (!low) for (const t of [0, .5, 1]) {
      const p = c.a.clone().lerp(c.b, t), g = o.ground.under(p.x, p.z, p.y - c.radius);
      if (!g || p.y - c.radius - g.y < RESIDENT_LIMB_HEIGHT) { low = true; break; }
    }
    if (low) { resident.push(c); residentOwners.push(owners[i]); } else streamed.push({ tree: owners[i], capsule: c });
  });
  const colliders = createCapsuleColliders(o.physics, resident);
  const streamGrid = new Map<string, number[]>();
  streamed.forEach((s, k) => {
    const t = placed[s.tree], key = `${Math.floor(t.x / 40)},${Math.floor(t.z / 40)}`;
    let list = streamGrid.get(key); if (!list) streamGrid.set(key, list = []); list.push(k);
  });
  const live = new Map<number, RAPIER.Collider>(), lastStream = new T.Vector3(Infinity, 0, 0);
  let streamPeak = 0;
  const stream = (p: T.Vector3) => {
    if (p.distanceToSquared(lastStream) < 64) return;
    lastStream.copy(p);
    for (const [k, c] of live) {
      const t = placed[streamed[k].tree];
      if (Math.hypot(t.x - p.x, t.z - p.z) > STREAM_OUT) { o.physics.removeCollider(c, true); live.delete(k); }
    }
    const reach = Math.ceil(STREAM_IN / 40);
    for (let a = -reach; a <= reach; a++) for (let b = -reach; b <= reach; b++)
      for (const k of streamGrid.get(`${Math.floor(p.x / 40) + a},${Math.floor(p.z / 40) + b}`) ?? []) {
        if (live.has(k)) continue;
        const t = placed[streamed[k].tree];
        if (Math.hypot(t.x - p.x, t.z - p.z) <= STREAM_IN) live.set(k, createCapsuleColliders(o.physics, [streamed[k].capsule])[0]);
      }
    streamPeak = Math.max(streamPeak, live.size);
  };

  const batches = new TreeBatches(placed, forms, o.materials, CANOPY_LODS, o.impostors, 'Campus trees');
  // Thousands of instances: skip per-frame depth sorting (culling still applies).
  batches.wood.sortObjects = batches.foliage.sortObjects = false;
  if (batches.impostor) batches.impostor.sortObjects = false;
  const bySource = provenance.reduce<Record<string, number>>((a, p) => { a[p.source] = (a[p.source] ?? 0) + 1; return a; }, {});
  const cameraPosition = new T.Vector3();
  const buildMs = Math.round(performance.now() - t0);
  return {
    group: batches.group, batches, placed, provenance, capsules, owners, colliders,
    /** Resident colliders plus currently streamed limb colliders. */
    allColliders: () => [...colliders, ...live.values()],
    stats: () => ({
      sources: { sites: o.sites?.source ?? null, canopy: o.canopy?.source ?? null },
      counts, placedBySource: bySource, placed: placed.length, reducedScale: reduced,
      officialChmMatchMedianM: +median(provenance.flatMap(p => p.source === 'official' && p.chmDistance !== null ? [p.chmDistance] : [])).toFixed(2),
      colliders: { residentTrunk: resident.filter(c => c.trunk).length, residentLowLimb: resident.filter(c => !c.trunk).length,
        streamedLimbTotal: streamed.length, streamedLive: live.size, streamedPeak: streamPeak, streamRadius: [STREAM_IN, STREAM_OUT] },
      buildMs,
      forms: placed.reduce<Record<number, number>>((a, t) => { a[t.form] = (a[t.form] ?? 0) + 1; return a; }, {}),
      lodCounts: batches.counts.slice(), lodTriangles: batches.triangleEstimate(),
    }),
    update(camera: T.Camera) { batches.update(camera); stream(camera.getWorldPosition(cameraPosition)); },
    /** Stream limb colliders around an explicit point (tests, travel arrival). */
    streamAt(p: T.Vector3) { lastStream.set(Infinity, 0, 0); stream(p); },
    dispose() {
      batches.dispose();
      for (const c of colliders) o.physics.removeCollider(c, true);
      for (const c of live.values()) o.physics.removeCollider(c, true);
      live.clear();
    },
  };
}
