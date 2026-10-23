import * as THREE from 'three';

export const FLIGHT_TUNING = {
  cruiseSpeed: 28,
  boostSpeed: 48,
  climbSpeed: 20,
  boostedClimbSpeed: 20,
  groundClearance: 3,
  landingSpeed: 24,
  landingApproachSpeed: 4,
  maxHeightAboveTerrain: 100,
  /** ↓ flies backward at this fraction of the forward speed (facing stays forward). */
  backwardFactor: .5,
} as const;

/** Velocity intent only. CampusGame still sweeps the real collider before moving. */
export class FlightMotion {
  mode: 'foot' | 'flying' | 'landing' = 'foot';
  velocity = new THREE.Vector3();
  blocked = false;
  get active() { return this.mode !== 'foot'; }
  start() {
    this.mode = 'flying'; this.velocity.set(0, 0, 0);
    this.blocked = false;
  }
  stop() {
    this.mode = 'foot'; this.velocity.set(0, 0, 0);
    this.blocked = false;
  }
  pause() { this.velocity.set(0, 0, 0); }
  toggleLanding() {
    this.mode = this.mode === 'landing' ? 'flying' : 'landing';
    this.pause();
  }
  /** `groundGap`: feet-to-floor distance straight below (null over open water or when unknown). While descending it
   * eases the sink rate (and, close in, the forward speed) so the body can settle upright before touching down. */
  update(dt: number, input: { forward: number; strafe: number; climb: number; boost: boolean; yaw: number; y: number; enabled: boolean; landingTarget?: { x: number; y: number; z: number } | null; x?: number; z?: number; groundGap?: number | null }) {
    if (!this.active || !input.enabled) { this.pause(); return this.velocity; }
    if (input.climb > 0 && this.mode === 'landing') this.mode = 'flying';
    const forward = input.forward < 0 ? input.forward * FLIGHT_TUNING.backwardFactor : input.forward;
    const horizontal = new THREE.Vector3(input.strafe, 0, -forward);
    if (horizontal.lengthSq() > 1) horizontal.normalize();
    horizontal.applyAxisAngle(new THREE.Vector3(0, 1, 0), input.yaw);
    const speed = input.boost ? FLIGHT_TUNING.boostSpeed : FLIGHT_TUNING.cruiseSpeed;
    let climb = input.climb * (input.boost ? FLIGHT_TUNING.boostedClimbSpeed : FLIGHT_TUNING.climbSpeed);
    const target = horizontal.multiplyScalar(speed);
    if (this.mode === 'landing') {
      const spot = input.landingTarget;
      // Descend anywhere; the real capsule sweep still prevents tunneling.
      // Only ease off near support directly below, without pulling sideways
      // toward a stale landing target while the player is steering.
      const directlyBelow = spot && input.x !== undefined && input.z !== undefined
        && Math.hypot(spot.x - input.x, spot.z - input.z) < .6;
      const below = input.groundGap ?? Infinity;
      const gap = Math.min(directlyBelow && spot ? Math.max(0, input.y - spot.y) : Infinity, below);
      climb = -Math.min(FLIGHT_TUNING.landingSpeed, Math.max(.6, gap * 3));
      // A diagonal ↑+S approach keeps most of its speed until the last few metres, then slows to touch down.
      if (Number.isFinite(below)) target.multiplyScalar(.45 + .55 * THREE.MathUtils.smoothstep(below, 1, 6));
    }
    target.y = climb;
    // Vertical ascent/descent has its own limit; horizontal cruise no longer
    // silently caps ascent to the horizontal cruise velocity.
    if (this.mode === 'flying' && input.climb === 0) this.velocity.y = 0;
    this.velocity.lerp(target, 1 - Math.exp(-dt * (this.mode === 'landing' ? 12 : target.lengthSq() ? 6 : 9)));
    if (target.lengthSq() === 0 && this.velocity.lengthSq() < .0001) this.pause();
    return this.velocity;
  }
}

/** Body pitch (rad, + tips the head forward about the hips) of level Superman cruise: head slightly up. */
export const FLIGHT_CRUISE_PITCH = 1.28;
/** Steepest head-down pitch for a diving descent. */
export const FLIGHT_MAX_DIVE = 2.4;

/** Superman attitude from the ACTUAL motion (after collisions): the stretched body lines up with the velocity,
 * so ↑ is near prone, ↑+W pitches up, ↑+S dives head-first along the diagonal. Rising straight up stays upright
 * with the fist overhead; hovering, backing up and sinking straight down stay upright. While descending close to
 * the floor (`groundGap` metres below the feet) the body eases upright to land on its feet.
 * Returns the target pitch and the arm/leg pose weight (0 = standing idle, 1 = fully stretched). */
export function flightAttitude(v: { x: number; y: number; z: number }, heading: number, groundGap: number | null) {
  const along = v.x * Math.sin(heading) + v.z * Math.cos(heading);
  const speed = Math.hypot(v.x, v.y, v.z);
  const stretch = THREE.MathUtils.smoothstep(speed, 1, 10);
  const forwardShare = THREE.MathUtils.smoothstep(along, .5, 6);
  const backShare = THREE.MathUtils.smoothstep(-along, .5, 6);
  const elevation = Math.atan2(v.y, Math.max(along, 1e-3));
  // Head-up cruise offset: full when level, fading out in a climb (cos) and quickly in a dive so the body lines up
  // with a descending path instead of mushing belly-first.
  const offset = (Math.PI / 2 - FLIGHT_CRUISE_PITCH) * (elevation >= 0 ? Math.cos(elevation) : Math.max(0, 1 + elevation / .35));
  const direction = THREE.MathUtils.clamp(Math.PI / 2 - elevation - offset, 0, FLIGHT_MAX_DIVE);
  // Settling: only while sinking near a floor; level low flight stays stretched.
  const settle = v.y < -.1 && groundGap !== null ? THREE.MathUtils.smoothstep(groundGap, .8, 6) : 1;
  const pitch = (stretch * forwardShare * direction - .14 * backShare * stretch) * settle;
  return { pitch, weight: stretch * settle };
}

/** Max body pitch rate (rad/s): exponential easing, rate-limited so a sudden ↑+S or touchdown never snaps. */
export const FLIGHT_PITCH_RATE = 3.5;
export function easeAttitude(current: number, target: number, elapsed: number, rate = 5) {
  const step = (target - current) * (1 - Math.exp(-elapsed * rate)), limit = FLIGHT_PITCH_RATE * elapsed;
  return current + THREE.MathUtils.clamp(step, -limit, limit);
}
