export type ScooterMode = 'foot' | 'mounting' | 'riding' | 'dismounting';
export type ScooterInput = { throttle: boolean; brake: boolean; left: boolean; right: boolean };
export const SCOOTER_TUNING = {
  speedMultiplier: 1.2, acceleration: 4, coast: 2.2, brake: 10,
  wheelbase: 1.03, steeringResponse: 8, lateralAcceleration: 4.5,
  transitionSeconds: .35, dismountSpeed: .35,
};
const approach = (a: number, b: number, amount: number) => a < b ? Math.min(a + amount, b) : Math.max(a - amount, b);
/** Pure fixed-step vehicle state. Translation is a request; the caller must
 * resolve it against the world and reconcile the actual travelled distance. */
export class ScooterMotion {
  mode: ScooterMode = 'foot';
  heading = 0;
  speed = 0;
  actualSpeed = 0;
  steer = 0;
  lean = 0;
  distance = 0;
  pendingDismount = false;
  transition = 0;
  readonly maxSpeed: number;
  constructor(runSpeed: number) { this.maxSpeed = runSpeed * SCOOTER_TUNING.speedMultiplier; }
  get mounted() { return this.mode !== 'foot'; }
  get weight() {
    return this.mode === 'foot' ? 0 : this.mode === 'mounting' ? this.transition : this.mode === 'dismounting' ? 1 - this.transition : 1;
  }
  mount(heading: number) {
    if (this.mode !== 'foot') return false;
    this.heading = heading; this.speed = 0; this.actualSpeed = 0; this.steer = 0; this.lean = 0;
    this.transition = 0; this.pendingDismount = false; this.mode = 'mounting'; return true;
  }
  requestDismount() {
    if (this.mode === 'riding') this.pendingDismount = !this.pendingDismount;
  }
  beginDismount() {
    if (this.mode !== 'riding' || this.speed > SCOOTER_TUNING.dismountSpeed) return false;
    this.mode = 'dismounting'; this.transition = 0; this.pendingDismount = false; this.speed = 0; this.actualSpeed = 0; return true;
  }
  cancelDismount() { this.mode = 'riding'; this.transition = 1; this.stop(); }
  stop() { this.speed = 0; this.actualSpeed = 0; this.lean = 0; this.pendingDismount = false; }
  foot() { this.stop(); this.mode = 'foot'; this.transition = 0; this.steer = 0; }
  update(dt: number, input: ScooterInput) {
    if (!(dt > 0 && dt <= .1)) throw new Error('Scooter step must be positive and at most 100 ms.');
    if (this.mode === 'mounting' || this.mode === 'dismounting') {
      this.transition = Math.min(1, this.transition + dt / SCOOTER_TUNING.transitionSeconds);
      if (this.transition >= 1) {
        if (this.mode === 'mounting') this.mode = 'riding';
        else this.foot();
      }
      return { x: 0, z: 0, heading: this.heading };
    }
    if (this.mode !== 'riding') return { x: 0, z: 0, heading: this.heading };
    const fraction = Math.min(1, this.speed / this.maxSpeed);
    const maxSteer = (35 + (9 - 35) * fraction) * Math.PI / 180;
    const direction = Number(input.left) - Number(input.right);
    this.steer += (direction * maxSteer - this.steer) * (1 - Math.exp(-SCOOTER_TUNING.steeringResponse * dt));
    const curvature = Math.tan(this.steer) / SCOOTER_TUNING.wheelbase;
    const turnCap = Math.sqrt(SCOOTER_TUNING.lateralAcceleration / Math.max(Math.abs(curvature), 1e-6));
    const braking = input.brake || this.pendingDismount;
    const target = braking ? 0 : input.throttle ? Math.min(this.maxSpeed, turnCap) : 0;
    const rate = braking || (input.throttle && this.speed > target) ? SCOOTER_TUNING.brake : input.throttle ? SCOOTER_TUNING.acceleration : SCOOTER_TUNING.coast;
    const before = this.speed;
    this.speed = approach(this.speed, target, rate * dt);
    const average = (before + this.speed) * .5;
    const yawRate = Math.max(-SCOOTER_TUNING.lateralAcceleration / Math.max(average, .1), Math.min(SCOOTER_TUNING.lateralAcceleration / Math.max(average, .1), average * curvature));
    const yawDelta = yawRate * dt;
    const midHeading = this.heading + yawDelta * .5;
    this.heading += yawDelta;
    this.lean = Math.max(-8 * Math.PI / 180, Math.min(8 * Math.PI / 180, -Math.atan(average * yawRate / 9.81)));
    return { x: Math.sin(midHeading) * average * dt, z: Math.cos(midHeading) * average * dt, heading: this.heading };
  }
  reconcile(x: number, z: number, dt: number, allowedHeading: number, blocked: boolean) {
    this.heading = allowedHeading;
    this.actualSpeed = Math.hypot(x, z) / dt;
    this.distance += Math.hypot(x, z);
    if (blocked) this.speed = Math.min(this.speed, Math.max(0, (x * Math.sin(this.heading) + z * Math.cos(this.heading)) / dt));
    if (this.actualSpeed < .02) this.lean = 0;
  }
  snapshot() { return { mode: this.mode, speed: this.actualSpeed, requestedSpeed: this.speed, maxSpeed: this.maxSpeed, heading: this.heading, steer: this.steer, lean: this.lean, distance: this.distance, pendingDismount: this.pendingDismount, weight: this.weight }; }
}
