// Targeted controls + Superman flight behaviour test (no browser, no build step):
//   node --experimental-strip-types scripts/harness/run-flight-controls-test.mjs
// Key layout, W/S altitude holds, hover on release, diagonal ↑+S descent, the velocity-following body pitch,
// upright settling only near the ground, and frame-to-frame smoothness of the eased pose (no jolt).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const { CONTROL_KEYS, GAME_KEYS, readControls, flightHoldAfter } = await import(resolve(root, 'lib/campus/controls.ts'));
const { FlightMotion, FLIGHT_TUNING, FLIGHT_CRUISE_PITCH, flightAttitude, easeAttitude } = await import(resolve(root, 'lib/campus/flight-motion.ts'));

const results = [];
const check = (name, pass, detail = {}) => results.push({ name, pass: !!pass, detail });
const keys = (...codes) => code => codes.includes(code);
const deg = r => +(r * 180 / Math.PI).toFixed(1);

// ------------------------------------------------------------------ 1. key layout
const c = (...k) => readControls(keys(...k));
check('↑ forward, ↓ backward, both cancel', c('ArrowUp').forward === 1 && c('ArrowDown').forward === -1 && c('ArrowUp', 'ArrowDown').forward === 0);
check('← and A turn left identically; → and D turn right identically',
  c('ArrowLeft').turn === 1 && c('KeyA').turn === 1 && c('ArrowRight').turn === -1 && c('KeyD').turn === -1 && c('KeyA', 'KeyD').turn === 0 && c('ArrowLeft', 'KeyA').turn === 1);
check('W rises, S descends, neither moves forward or turns', c('KeyW').rise && !c('KeyW').descend && c('KeyS').descend && c('KeyW').forward === 0 && c('KeyS').forward === 0 && c('KeyS').turn === 0);
check('E is the scooter key; obsolete F/G/C/Ctrl bindings are gone',
  CONTROL_KEYS.scooter.join() === 'KeyE' && !['KeyF', 'KeyG', 'KeyC', 'ControlLeft', 'ControlRight'].some(k => GAME_KEYS.includes(k)), { GAME_KEYS });
check('W/S release: the other held key takes over, none holds altitude',
  flightHoldAfter(keys('KeyS')) === 'down' && flightHoldAfter(keys('KeyW')) === 'up' && flightHoldAfter(keys()) === null);
const game = readFileSync(resolve(root, 'lib/campus/game.ts'), 'utf8'), page = readFileSync(resolve(root, 'app/page.tsx'), 'utf8');
const stale = ["'KeyF'", "'KeyG'", "'KeyC'", "'ControlLeft'", "held('KeyS')", "held('KeyA')", "held('Space') || (this.flightHolding"].filter(s => game.includes(s));
check('game.ts reads movement through controls.ts only (no stale literal bindings)', stale.length === 0, { stale });
check('HUD help names E for the scooter, S for descend, A D for turning; never F', !/<kbd>F<\/kbd>/.test(page) && page.includes('<kbd>E</kbd>') && page.includes('<kbd>S</kbd>') && page.includes('A D'));

// ------------------------------------------------------------------ 2. flight motion
const dt = 1 / 60;
const run = (motion, steps, input) => { let v; for (let i = 0; i < steps; i++) v = motion.update(dt, { strafe: 0, climb: 0, boost: false, yaw: 0, y: 50, enabled: true, forward: 0, ...input }); return v.clone(); };
{
  const m = new FlightMotion(); m.start();
  const fwd = run(m, 120, { forward: 1 });
  check('↑ cruises forward (yaw 0 = -z) at cruise speed, level', Math.abs(fwd.z + FLIGHT_TUNING.cruiseSpeed) < .5 && Math.abs(fwd.y) < 1e-6, { fwd: fwd.toArray() });
  const hover = run(m, 120, {});
  check('releasing every input hovers (velocity -> 0)', hover.length() < .01, { hover: hover.toArray() });
  const climb = run(m, 120, { climb: 1, forward: 1 });
  check('↑+W climbs diagonally', climb.y > 15 && climb.z < -20, { climb: climb.toArray() });
  const hold = run(m, 1, { forward: 1 });
  check('releasing W holds altitude at once (no vertical drift)', hold.y === 0, { hold: hold.toArray() });
  const back = run(m, 120, { forward: -1 });
  check('↓ flies backward at half speed', Math.abs(back.z - FLIGHT_TUNING.cruiseSpeed * FLIGHT_TUNING.backwardFactor) < .5, { back: back.toArray() });
  m.mode = 'landing';
  const dive = run(m, 60, { forward: 1, groundGap: 60 });
  check('↑+S dives diagonally forward and down', dive.y < -15 && dive.z < -20, { dive: dive.toArray(), angleDeg: deg(Math.atan2(-dive.y, -dive.z)) });
  const near = run(m, 60, { forward: 1, groundGap: 1.2 });
  check('close to a floor the descent and forward speed ease off to touch down', near.y > -4 && near.y < -.5 && -near.z < FLIGHT_TUNING.cruiseSpeed * .6, { near: near.toArray() });
  const water = run(m, 60, { forward: 1, groundGap: null });
  check('without a floor reading (open water) the descent keeps the original rate', water.y < -20, { water: water.toArray() });
}

// ------------------------------------------------------------------ 3. Superman attitude
const heading = Math.PI; // facing -z
const at = (x, y, z, gap = 50) => flightAttitude({ x, y, z }, heading, gap);
const level = at(0, 0, -28), up = at(0, 20, -28), down = at(0, -24, -28), rise = at(0, 20, 0), sink = at(0, -24, 0), hover = at(0, 0, 0), backward = at(0, 0, 14);
check('level cruise: stretched, head slightly up (Superman)', Math.abs(level.pitch - FLIGHT_CRUISE_PITCH) < .02 && level.weight > .99, { pitchDeg: deg(level.pitch) });
check('↑+W pitches up along the climb', up.pitch > .3 && up.pitch < level.pitch - .3 && up.weight > .99, { pitchDeg: deg(up.pitch), pathDeg: deg(Math.atan2(20, 28)) });
// Body axis (pitch from vertical) vs flight path angle below horizontal.
const pathDown = Math.atan2(24, 28), bodyDown = down.pitch - Math.PI / 2;
check('↑+S dives head-first along the downward diagonal, still stretched', bodyDown > .25 && Math.abs(bodyDown - pathDown) < .09 && down.weight > .99, { bodyBelowHorizontalDeg: deg(bodyDown), pathDeg: deg(pathDown) });
check('W alone: upright, fist overhead (stretched pose, no pitch)', rise.pitch < .02 && rise.weight > .99);
check('S alone, hover and backing up stay upright', sink.pitch < .02 && hover.weight < .01 && Math.abs(backward.pitch) < .2, { backDeg: deg(backward.pitch) });
const landing = at(0, -3, -10, .9), lowLevel = at(0, 0, -28, .9);
check('descending into the last metre eases upright; level low flight stays stretched', landing.pitch < .15 && landing.weight < .2 && lowLevel.pitch > 1.2, { landingDeg: deg(landing.pitch), lowLevelDeg: deg(lowLevel.pitch) });

// ------------------------------------------------------------------ 4. smoothness of a full ↑ -> ↑+S -> touchdown sequence
{
  const m = new FlightMotion(); m.start();
  let y = 40, z = 0, lean = 0, stretch = 0, maxStep = 0, maxCamStep = 0, focusY = y + .6;
  const frame = 1 / 30, ease = 1 - Math.exp(-frame * 5);
  for (let f = 0; f < 30 * 12; f++) {
    const phase = f < 60 ? 'cruise' : 'dive';
    if (phase === 'dive') m.mode = m.mode === 'foot' ? 'foot' : 'landing';
    const gap = Math.max(0, y - .905);
    let v;
    for (let s = 0; s < 2; s++) { v = m.update(dt, { forward: 1, strafe: 0, climb: 0, boost: false, yaw: 0, y, enabled: true, groundGap: gap }); y = Math.max(.905, y + v.y * dt); z += v.z * dt; }
    const target = flightAttitude(v, heading, Math.max(0, y - .905));
    const before = lean;
    lean = easeAttitude(lean, target.pitch, frame); stretch += (target.weight - stretch) * ease;
    maxStep = Math.max(maxStep, Math.abs(lean - before));
    const focus = focusY + (y + .6 - focusY) * (1 - Math.exp(-frame * 12));
    maxCamStep = Math.max(maxCamStep, Math.abs(focus - focusY)); focusY = focus;
    if (y <= .906) break;
  }
  check('↑ -> ↑+S -> touchdown: pitch eases (≤ 7° per 30 fps frame), ends near upright, camera focus moves smoothly',
    maxStep < .1222 && lean < .3 && maxCamStep < 1.2, { maxPitchStepDeg: deg(maxStep), finalPitchDeg: deg(lean), finalStretch: +stretch.toFixed(2), maxFocusStepM: +maxCamStep.toFixed(2) });
}

for (const r of results) console.log(r.pass ? 'PASS' : 'FAIL', r.name, JSON.stringify(r.detail).slice(0, 240));
const failed = results.filter(r => !r.pass).length;
console.log(failed ? 'FLIGHT CONTROLS TEST FAIL' : 'FLIGHT CONTROLS TEST PASS', `${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
