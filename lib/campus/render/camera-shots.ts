// Developer-only, read-only fixed-camera observation tool.
//
// Activated by `?shot=<id>` (applies on the first rendered frame after load)
// or `window.__campus.shot(id)`; `__campus.shot(null)` or ANY keydown,
// pointerdown, wheel or touchstart exits. While active it overwrites only the
// render camera's position, orientation and fov, every frame, after the game
// has placed its own follow camera. It never reads or writes the player body,
// collider, controller or physics world (this module has no access to them),
// hides nothing, and changes no lighting. The game may use `focus` to centre
// the sun shadow frustum and distance-based detail on what the shot looks at.
//
// No runtime imports: Node checks load this file directly.
import type * as THREE from 'three';
import atlasShots from './atlas-shots.json' with { type: 'json' };
// Per-block QA shots (whole-campus blocks, owner files; JSON so Node checks can load them).
import shots01 from '../blocks/b01-eer/shots.json' with { type: 'json' };
import shots02 from '../blocks/b02-sciences/shots.json' with { type: 'json' };
import shots03 from '../blocks/b03-gdc-speedway/shots.json' with { type: 'json' };
import shots04 from '../blocks/b04-tower/shots.json' with { type: 'json' };
import shots05 from '../blocks/b05-southmall/shots.json' with { type: 'json' };
import shots06 from '../blocks/b06-northwest/shots.json' with { type: 'json' };
import shots07 from '../blocks/b07-wcp-gregory/shots.json' with { type: 'json' };
import shots08 from '../blocks/b08-east-north/shots.json' with { type: 'json' };
import shots09 from '../blocks/b09-stadium/shots.json' with { type: 'json' };
import shots10 from '../blocks/b10-east-campus/shots.json' with { type: 'json' };
import shots11 from '../blocks/b11-south-medical/shots.json' with { type: 'json' };
import shots12 from '../blocks/b12-west-campus/shots.json' with { type: 'json' };
import shots13 from '../blocks/b13-north-perimeter/shots.json' with { type: 'json' };
import shots14 from '../blocks/b14-capitol/shots.json' with { type: 'json' };
// Deep-west extension (D37-D40) reference-pose review shots (tools/extension/bake-deep-west.py).
import deepWestShots from '../extension/deep-west/shots.json' with { type: 'json' };
// Downtown extension review shots (tools/extension/downtown-shots.py; grounds from the baked terrain).
import downtownShots from '../extension/downtown/shots.json' with { type: 'json' };
// West Campus pass review shots (tools/extension/west-campus-shots.py; grounds from the baked terrain).
import westCampusShots from '../extension/west-campus/shots.json' with { type: 'json' };

export type Vec3 = readonly [number, number, number];

export interface CameraShot {
  id: string;
  label: string;
  /** Absolute campus metres (X east, Y up, Z south). Fixed so before/after
   * captures use the identical camera even if ground meshes change. */
  position: Vec3;
  target: Vec3;
  fov: number;
  /** Ground Y used to author position (terrain grid or Capitol datum), for checks. */
  groundY: number;
  /** Where the single 4096 shadow map / detail LOD should centre. Defaults to
   * 15 m ahead of the camera at ground level. */
  focus?: Vec3;
  note: string;
}

/** Fixed sun for every shot = the calibrated preset (render/lighting-presets.ts).
 * The legacy game used a fixed direction of elevation 48.8 deg, azimuth 119.4 deg. */
export const SHOT_SUN = { time: '2026-09-23T10:45:00-05:00', elevationDeg: 41.9, azimuthDeg: 121.2 } as const;

const EYE = 1.75;
const shot = (id: string, label: string, x: number, g: number, z: number, target: Vec3, fov: number, note: string,
  extra: { eye?: number; focus?: Vec3 } = {}): CameraShot =>
  ({ id, label, position: [x, +(g + (extra.eye ?? EYE)).toFixed(2), z], target, fov, groundY: g, focus: extra.focus, note });

const BASE_SHOTS: readonly CameraShot[] = [
  shot('spawn-east-mall-west', 'Spawn · MLK / East Mall looking west', 121, 0.20, 64.6, [40, 4.6, 60], 55,
    'Just behind the spawn (114, 64.4); Speedway and the Tower axis ahead.'),
  shot('speedway-north', 'Speedway looking north (GDC / POB / NHB)', -1.5, 2.87, 38, [11, 7.0, -120], 55,
    'On the mapped Speedway centreline (campus.json path, x = -3 at z 43 to x = 12 at z -130). Brief said x~25; the actual centreline is x -3..12.'),
  shot('speedway-south', 'Speedway looking south (toward East Mall)', 11.5, 4.03, -116, [-2, 5.9, 40], 55,
    'Reverse of speedway-north; canopy shade and paving.'),
  shot('gdc-west-frontage', 'GDC west frontage from Speedway', -1, 3.60, -52, [24, 14.5, -18], 58,
    'West edge of Speedway, facing the GDC facade and the stepped atrium notch.'),
  shot('gdc-atrium-back', 'GDC atrium, from inside the court looking west', 35.5, 2.45, -17.9, [0, 6.7, -21], 60,
    'Inside the authored west notch court (gdc-atrium origin 21.8,-19.1; ground datum 2.45, not the 2.14 terrain grid), u~13.7 m from the opening, below the first terrace front (16 m). The brief\'s (60,-16) lies inside the GDC spine (footprint x 54..65), so the camera sits in the open court instead.'),
  shot('nhb-southeast', 'NHB from the southeast (Speedway at 24th)', 16, 3.81, -121, [-20, 17, -170], 55,
    'East side of Speedway between NHB and POB, facing NW at the NHB corner (landmark -9.8,-150.5).'),
  shot('tower-west-mall', 'Tower from the West Mall', -300, 16.44, 31, [-215, 55, 10], 60,
    'Between Flawn (z <= 14) and the West Mall Office Building (z >= 49).'),
  shot('tower-east-yard', 'Tower from the east yard', -150, 16.40, 35, [-215, 50, 10], 60,
    'East of the Main Building, north of Garrison; WCH is 25 m away.'),
  shot('south-mall', 'Main lawn / South Mall looking north to the Tower', -213, 10.91, 190, [-215, 50, 10], 55,
    'Between Mezes and Rainey on the South Mall axis.'),
  shot('pcl-plaza', 'PCL from Speedway at the plaza', -36, -0.52, 286, [-110, 6.7, 330], 58,
    'Speedway beside the PCL forecourt, facing south-west.'),
  shot('dkr-west', 'DKR stadium west exterior', 304, -9.07, 300, [348, 11.2, 250], 62,
    'West of the DKR official footprint (x 330..357), looking north-east along the west frontage. Moved 8 m west of (312,300): a LiDAR canopy tree stands 2 m from that point.'),
  shot('dkr-aerial', 'DKR stadium aerial from the southwest', 240, -4.52, 430, [444, 5, 272], 60,
    'Aerial, ~95 m above ground; bowl and surrounding blocks.', { eye: 95, focus: [400, -4, 300] }),
  shot('capitol-great-walk', 'Capitol Great Walk looking north', -368.4, -5.78, 1451.5, [-308, 32, 1266.5], 55,
    'Great Walk centreline (Capitol local u=0, v=190); ground from capitolGroundHeight (the terrain grid ends at z 1288).'),
  shot('flight-overview-100m', 'Flight overview, 100 m over central campus', 20, 0.83, 150, [-215, 30, 10], 65,
    '100 m above ground east of WCP looking west-north-west across Speedway to the Tower; flight fov 65.',
    { eye: 100, focus: [-90, 5, 80] }),
];

/** A block QA shot (lib/campus/blocks/<id>/shots.json): same fields plus the owning block. */
export interface BlockShot extends CameraShot { block: string; kind: 'street' | 'side' | 'rear' | 'aerial' }
export const BLOCK_SHOTS: readonly BlockShot[] = ([shots01, shots02, shots03, shots04, shots05, shots06, shots07, shots08, shots09, shots10, shots11, shots12, shots13, shots14] as unknown as BlockShot[][]).flat();
export const CAMERA_SHOTS: readonly CameraShot[] = [...BASE_SHOTS, ...BLOCK_SHOTS];
/** Staged research comparison poses for the 153 accepted atlas overviews (tools/blocks/atlas-shots.mjs). Reachable via
 * ?shot=<unit>-overview; not part of CAMERA_SHOTS (no gameplay/clearance claims). */
export const ATLAS_SHOTS: readonly (CameraShot & { block: string; kind: 'atlas' })[] = atlasShots as unknown as (CameraShot & { block: string; kind: 'atlas' })[];

/** Deep-west extension review shots at the actual reference-orbit horizontal poses, camera 30 m over the
 * baked extension terrain (corrected basis, see each note). Separate from CAMERA_SHOTS: they only show
 * geometry when the extension asset validated and loaded. */
export const EXTENSION_SHOTS: readonly (CameraShot & { district: string; kind: 'aerial'; referenceReview: string })[] =
  deepWestShots as unknown as (CameraShot & { district: string; kind: 'aerial'; referenceReview: string })[];

/** Downtown extension review poses (skyline from campus, Capitol approach, obliques, routes, riverbank). */
export const DOWNTOWN_SHOTS: readonly (CameraShot & { kind: string; groundSource: string })[] =
  downtownShots as unknown as (CameraShot & { kind: string; groundSource: string })[];
/** West Campus pass review poses (new towers, Deep West facades and canopy; street + aerial). */
export const WEST_CAMPUS_SHOTS: readonly (CameraShot & { kind: 'street' | 'aerial'; groundSource: string })[] =
  westCampusShots as unknown as (CameraShot & { kind: 'street' | 'aerial'; groundSource: string })[];
export function findShot(id: string): CameraShot | undefined {
  return CAMERA_SHOTS.find(s => s.id === id) ?? ATLAS_SHOTS.find(s => s.id === id) ?? EXTENSION_SHOTS.find(s => s.id === id)
    ?? DOWNTOWN_SHOTS.find(s => s.id === id) ?? WEST_CAMPUS_SHOTS.find(s => s.id === id);
}

/** Ground-level point 15 m ahead of the camera unless the shot names a focus. */
export function shotFocus(s: CameraShot): Vec3 {
  if (s.focus) return s.focus;
  const [px, py, pz] = s.position, [tx, , tz] = s.target;
  const h = Math.hypot(tx - px, tz - pz) || 1, d = Math.min(15, h);
  return [px + (tx - px) / h * d, py - EYE, pz + (tz - pz) / h * d];
}

type CameraLike = Pick<THREE.PerspectiveCamera, 'fov' | 'updateProjectionMatrix' | 'lookAt' | 'updateMatrixWorld'> & {
  position: { set(x: number, y: number, z: number): unknown };
};

const EXIT_EVENTS = ['keydown', 'pointerdown', 'wheel', 'touchstart'] as const;

export class CameraShotController {
  active: CameraShot | null = null;
  private pending: string | null;
  private activations = 0;
  private framesApplied = 0;
  private lastExit = '';
  readonly focus = { x: 0, y: 0, z: 0 };
  private readonly onInput = (event: Event) => { if (this.active) this.exit(`input:${event.type}`); };

  private readonly events: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null;

  // Plain parameters (no TS parameter properties) keep this file loadable by Node's type stripping.
  constructor(events: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null =
    typeof window === 'undefined' ? null : window, search = typeof location === 'undefined' ? '' : location.search) {
    this.events = events;
    this.pending = new URLSearchParams(search).get('shot');
    for (const type of EXIT_EVENTS) this.events?.addEventListener(type, this.onInput, { capture: true, passive: true } as AddEventListenerOptions);
  }

  /** Activate by id; null exits. Unknown ids throw (list via `CAMERA_SHOTS`). */
  set(id: string | null) {
    if (id === null) { this.exit('api'); return null; }
    const s = findShot(id);
    if (!s) throw new Error(`Unknown camera shot "${id}". Known: ${CAMERA_SHOTS.map(c => c.id).join(', ')}`);
    this.pending = null;
    this.active = s;
    this.activations++;
    const [x, y, z] = shotFocus(s);
    Object.assign(this.focus, { x, y, z });
    return this.snapshot();
  }

  exit(reason = 'api') {
    if (!this.active && !this.pending) return;
    this.active = null;
    this.pending = null;
    this.lastExit = reason;
  }

  /** Call every frame after the game placed its camera and before rendering.
   * Returns true while a shot owns the camera. Touches only `camera`. */
  apply(camera: CameraLike): boolean {
    if (this.pending) {
      try { this.set(this.pending); } catch { this.pending = null; this.lastExit = 'unknown-url-shot'; }
    }
    const s = this.active;
    if (!s) return false;
    camera.position.set(s.position[0], s.position[1], s.position[2]);
    camera.lookAt(s.target[0], s.target[1], s.target[2]);
    if (camera.fov !== s.fov) { camera.fov = s.fov; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
    this.framesApplied++;
    return true;
  }

  snapshot() {
    return {
      active: this.active?.id ?? null, pending: this.pending, activations: this.activations,
      framesApplied: this.framesApplied, lastExit: this.lastExit || null,
      shot: this.active ? { ...this.active, focus: [this.focus.x, this.focus.y, this.focus.z] } : null,
      sun: SHOT_SUN,
    };
  }

  list() { return [...CAMERA_SHOTS, ...EXTENSION_SHOTS, ...DOWNTOWN_SHOTS, ...WEST_CAMPUS_SHOTS].map(s => ({ id: s.id, label: s.label, position: s.position, target: s.target, fov: s.fov })); }

  dispose() {
    for (const type of EXIT_EVENTS) this.events?.removeEventListener(type, this.onInput, { capture: true } as EventListenerOptions);
    this.active = null; this.pending = null;
  }
}
