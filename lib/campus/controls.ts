// Keyboard layout (one place for the game, the HUD help and the checks). No three.js, no relative imports:
// Node checks import this file directly.
//   ↑ forward · ↓ backward (scooter: brake) · ← → and A D turn (interchangeable) · hold W rise / take off ·
//   hold S descend / land · E scooter on/off · Shift run / boost · Space jump (scooter: brake).
// Releasing W/S holds the current altitude; releasing everything hovers.
export const CONTROL_KEYS = {
  forward: ['ArrowUp'],
  backward: ['ArrowDown'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  rise: ['KeyW'],
  descend: ['KeyS'],
  scooter: ['KeyE'],
  boost: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
} as const;

/** Every key the game captures while playing (preventDefault + held state). */
export const GAME_KEYS: readonly string[] = [...new Set(Object.values(CONTROL_KEYS).flat())];

/** Radians per second of yaw from a held turn key (foot and flight; the scooter steers its own heading). */
export const TURN_RATE = 1.6;

export interface ControlState { forward: number; turn: number; rise: boolean; descend: boolean; boost: boolean }

/** Held keys -> intent. forward: +1 ↑, -1 ↓, 0 both/neither; turn: +1 left (yaw increases), -1 right. */
export function readControls(held: (code: string) => boolean): ControlState {
  const any = (codes: readonly string[]) => codes.some(held);
  return {
    forward: (any(CONTROL_KEYS.forward) ? 1 : 0) - (any(CONTROL_KEYS.backward) ? 1 : 0),
    turn: (any(CONTROL_KEYS.left) ? 1 : 0) - (any(CONTROL_KEYS.right) ? 1 : 0),
    rise: any(CONTROL_KEYS.rise),
    descend: any(CONTROL_KEYS.descend),
    boost: any(CONTROL_KEYS.boost),
  };
}

/** Vertical hold after a W/S key change: the remaining held direction wins, none means hold altitude. */
export function flightHoldAfter(held: (code: string) => boolean): 'up' | 'down' | null {
  const rise = CONTROL_KEYS.rise.some(held), descend = CONTROL_KEYS.descend.some(held);
  return rise && !descend ? 'up' : descend && !rise ? 'down' : rise ? 'up' : null;
}
