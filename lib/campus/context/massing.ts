import * as THREE from 'three';
import type { Building, Point } from '../types';
import type { BuildingSpec, RoofForm } from './catalog';
import { cleanRing, offsetRing, signedArea, pointInPolygon, poleOfInaccessibility, hash01 } from '../context-geometry';
import { segmentDistanceSq } from '../context-coverage';

/** Building massing: measured (2017 USGS 3DEP LiDAR, via the lidar lane's
 * roofs-lidar.json) where available, else the packaged campus.json height.
 * Stepped roofs become separate volumes: a base volume over the whole
 * footprint plus one volume per higher LiDAR tier. */

export interface LidarTier { height: number; area: number; ring: Point[] }
export interface LidarRoof {
  status: 'measured' | 'conflict' | 'no-data';
  groundY: number; heightP50: number; heightP95: number; heightMax: number;
  roofType: 'flat' | 'pitched' | 'mixed'; pitchDeg: number; coverage: number;
  tiers: LidarTier[]; note?: string;
}
export interface RoofsLidar { source?: string; buildings: Record<string, LidarRoof> }

export type VolumeRole = 'main' | 'tier' | 'mech' | 'estimated-mech';
export interface Volume {
  rings: Point[][];
  /** Wall bottom above grade (0 for the main volume). */
  bottom: number;
  /** Roof deck (flat) or ridge (hipped) above grade. */
  top: number;
  roof: RoofForm;
  /** Hipped roof rise per horizontal metre. */
  slope: number;
  role: VolumeRole;
  /** Optional facade composition for this volume (else the building's spec). */
  spec?: BuildingSpec;
}
export interface Massing { volumes: Volume[]; source: 'lidar' | 'lidar-tiers' | 'campus-h' | 'campus-h-conflict' | 'block'; height: number;
  /** Campus Y that volume top/bottom are measured from; default = the generator's median grade around the footprint. */
  heightBase?: number }

const HIP_MAX = { 'hip-tile': 6.5, 'hip-shingle': 4.2, 'hip-metal': 6 } as const;

function snapRing(ring: Point[], footprint: Point[][], setback = 0.08): Point[] | null {
  const outer = footprint[0];
  const snapped = ring.map(([x, z]): Point => {
    let best = Infinity, bx = x, bz = z;
    for (let i = 0; i < outer.length; i++) {
      const [ax, az] = outer[i], [cx, cz] = outer[(i + 1) % outer.length];
      const d = segmentDistanceSq(x, z, ax, az, cx, cz);
      if (d < best) {
        best = d;
        const dx = cx - ax, dz = cz - az, l = dx * dx + dz * dz;
        const t = l > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l)) : 0;
        bx = ax + dx * t; bz = az + dz * t;
      }
    }
    // Raster tier outlines within ~1.2 m of the footprint line, or outside it, snap onto it.
    return best < 1.44 || !pointInPolygon(x, z, footprint) ? [bx, bz] : [x, z];
  });
  let r = cleanRing(simplify(snapped, 1.0), 0.6);
  if (r.length < 3 || Math.abs(signedArea(r)) < 40) return null;
  if (signedArea(r) < 0) r = r.slice().reverse();
  // Inset slightly so tier walls sit just behind the base parapet line (no coplanar faces).
  const inset = offsetRing(r, -setback);
  return Math.abs(signedArea(inset)) > Math.abs(signedArea(r)) * 0.5 && signedArea(inset) > 0 ? inset : null;
}

/** Douglas-Peucker on a closed ring. */
function simplify(ring: Point[], tolerance: number): Point[] {
  if (ring.length < 5) return ring;
  const t2 = tolerance * tolerance;
  const keep = new Uint8Array(ring.length);
  // Anchor at the two most distant vertices.
  let far = 0, fd = -1;
  for (let i = 1; i < ring.length; i++) { const d = (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2; if (d > fd) { fd = d; far = i; } }
  keep[0] = keep[far] = 1;
  const run = (i0: number, i1: number) => {
    const stack: [number, number][] = [[i0, i1]];
    while (stack.length) {
      const [a, b] = stack.pop()!;
      let best = -1, bd = t2;
      const n = (b - a + ring.length) % ring.length;
      for (let k = 1; k < n; k++) {
        const i = (a + k) % ring.length;
        const d = segmentDistanceSq(ring[i][0], ring[i][1], ring[a][0], ring[a][1], ring[b % ring.length][0], ring[b % ring.length][1]);
        if (d > bd) { bd = d; best = i; }
      }
      if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
    }
  };
  run(0, far); run(far, 0);
  return ring.filter((_, i) => keep[i]);
}

function hipped(form: RoofForm) { return form !== 'flat'; }

/** Roof form after LiDAR: measured flat roofs stay flat; measured pitched roofs
 * on non-catalogued buildings become hipped in the district's material. */
function roofForm(spec: BuildingSpec, lidar: LidarRoof | undefined): RoofForm {
  const form = spec.roof;
  if (!lidar || lidar.status !== 'measured' || lidar.coverage < 0.4) return form;
  if (lidar.roofType === 'flat' && lidar.pitchDeg < 6) return 'flat';
  if (lidar.roofType === 'pitched' && form === 'flat' && spec.basis !== 'known') {
    if (spec.archetype === 'utility' || spec.archetype === 'athletic' || spec.archetype === 'shed') return 'hip-metal';
    return spec.district === 'core' || spec.district === 'east-campus' ? 'hip-tile' : 'hip-shingle';
  }
  return form;
}

export function buildMassing(b: Building, rings: Point[][], spec: BuildingSpec, lidar: LidarRoof | undefined): Massing {
  const arch = spec.arch;
  const area = Math.abs(signedArea(rings[0])) - rings.slice(1).reduce((s, r) => s + Math.abs(signedArea(r)), 0);
  const form = roofForm(spec, lidar);
  const measured = lidar && lidar.status === 'measured' && lidar.heightP95 > 2.5 && lidar.coverage >= 0.3;
  const clampH = (h: number) => THREE.MathUtils.clamp(h, 3, 110);
  const slopeOf = (f: RoofForm) => {
    if (!hipped(f)) return 0;
    const measuredSlope = measured && lidar.roofType !== 'flat' && lidar.pitchDeg > 8 ? Math.tan(THREE.MathUtils.degToRad(Math.min(lidar.pitchDeg, 45))) : 0;
    const base = arch.roofSlope || (f === 'hip-shingle' ? 0.5 : 0.42);
    return measuredSlope ? THREE.MathUtils.clamp(measuredSlope, 0.25, 1.0) : base;
  };
  if (!measured) {
    const h = clampH(b.h);
    const volumes: Volume[] = [{ rings, bottom: 0, top: hipped(form) ? h : Math.max(2.6, h - arch.parapet * 0.6), roof: form, slope: slopeOf(form), role: 'main' }];
    // Without a measurement, large flat roofs get one modest mechanical penthouse (estimate).
    const pole = poleOfInaccessibility(rings);
    if (!hipped(form) && spec.archetype !== 'garage' && spec.archetype !== 'shed' && area > 900 && h > 10 && pole.d > 6) {
      let angle = 0, longest = 0;
      for (let i = 0; i < rings[0].length; i++) {
        const [ax, az] = rings[0][i], [bx, bz] = rings[0][(i + 1) % rings[0].length], l = Math.hypot(bx - ax, bz - az);
        if (l > longest) { longest = l; angle = Math.atan2(bz - az, bx - ax); }
      }
      const hx = Math.min(pole.d * 0.55, 10), hz = hx * (0.55 + hash01(b.id, 7) * 0.25);
      const c = Math.cos(angle), s = Math.sin(angle);
      const corner = (sx: number, sz: number): Point => [pole.x + sx * hx * c - sz * hz * s, pole.z + sx * hx * s + sz * hz * c];
      let ring = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
      if (signedArea(ring) < 0) ring = ring.reverse();
      volumes.push({ rings: [ring], bottom: volumes[0].top, top: volumes[0].top + 3.6 + hash01(b.id, 8) * 1.2, roof: 'flat', slope: 0, role: 'estimated-mech' });
    }
    return { volumes, source: lidar?.status === 'conflict' ? 'campus-h-conflict' : 'campus-h', height: h };
  }
  if (hipped(form)) {
    // Ridge from the measured maximum, ignoring chimneys/antennae above P95.
    const ridge = clampH(Math.min(lidar.heightMax, lidar.heightP95 + 1.5));
    return { volumes: [{ rings, bottom: 0, top: ridge, roof: form, slope: slopeOf(form), role: 'main' }], source: 'lidar', height: ridge };
  }
  const flatDeck = clampH(Math.max(lidar.heightP50, lidar.heightP95 - arch.parapet));
  const tiers = (lidar.tiers ?? []).filter(t => t.height >= 2.5 && t.ring.length >= 3);
  if (tiers.length < 2) return { volumes: [{ rings, bottom: 0, top: flatDeck, roof: 'flat', slope: 0, role: 'main' }], source: 'lidar', height: flatDeck };
  // Base volume at the lowest substantial tier; higher tiers stack on it.
  const substantial = tiers.filter(t => t.area >= area * 0.08);
  const baseH = clampH(Math.min(...(substantial.length ? substantial : tiers).map(t => t.height)));
  const volumes: Volume[] = [{ rings, bottom: 0, top: baseH, roof: 'flat', slope: 0, role: 'main' }];
  const upper = tiers.filter(t => t.height > baseH + 1.5).sort((a, c) => c.area - a.area).slice(0, 12);
  for (const t of upper) {
    const below = tiers.filter(o => o !== t && o.height < t.height && o.area > t.area).reduce((m, o) => Math.max(m, o.height), baseH);
    const mech = t.area < Math.max(200, area * 0.12) && t.height - below <= 7;
    // Mechanical penthouses are set back from the facade line (as built practice), which also
    // keeps them clear of neighbouring occupied tiers after outline simplification.
    const ring = snapRing(t.ring, rings, mech ? 0.9 : 0.08);
    if (!ring) continue;
    volumes.push({ rings: [ring], bottom: baseH, top: clampH(t.height), roof: 'flat', slope: 0, role: mech ? 'mech' : 'tier' });
  }
  return { volumes, source: 'lidar-tiers', height: Math.max(...volumes.map(v => v.top)) };
}

export function hipRise(rings: Point[][], form: RoofForm, slope: number, overhang: number) {
  if (form === 'flat') return 0;
  const pole = poleOfInaccessibility(rings);
  return Math.min(HIP_MAX[form], slope * Math.max(0.5, pole.d + overhang));
}
