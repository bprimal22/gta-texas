// Boot phases, loading copy and the how-to-play steps for the start screen. Pure data and functions:
// no three.js, no DOM globals, no relative imports, so Node checks import this file directly
// (scripts/harness/run-onboarding-test.mjs).

export type BootPhaseId = 'engine' | 'world' | 'landmarks' | 'neighborhoods' | 'character' | 'physics' | 'shaders';

export interface BootPhase { id: BootPhaseId; label: string }

/** In the order CampusGame.init() actually runs them (trees are planted before the neighborhoods). */
export const BOOT_PHASES: readonly BootPhase[] = [
  { id: 'engine', label: 'Starting engine' },
  { id: 'world', label: 'Terrain & world' },
  { id: 'landmarks', label: 'Landmarks & trees' },
  { id: 'neighborhoods', label: 'Neighborhoods' },
  { id: 'character', label: 'Your character' },
  { id: 'physics', label: 'Setting up movement' },
  { id: 'shaders', label: 'Preparing graphics' },
];

/** Every boot mark CampusGame reports (its `__campusBoot` stages) plus the page-side `engine` steps.
 * Steps are listed in emission order inside each phase; optional ones may be skipped. */
const BOOT_STEPS: readonly { stage: string; phase: BootPhaseId; detail: string }[] = [
  { stage: 'engine', phase: 'engine', detail: 'Loading the game engine' },
  { stage: 'engine-start', phase: 'engine', detail: 'Starting 3D graphics' },
  { stage: 'assets', phase: 'world', detail: 'Reading map, terrain and character data' },
  { stage: 'world', phase: 'world', detail: 'Laying out the city grid' },
  { stage: 'buildings-and-ground', phase: 'world', detail: 'Placing buildings and ground' },
  { stage: 'landscape-details', phase: 'world', detail: 'Adding landscape details' },
  { stage: 'offline-campus', phase: 'world', detail: 'Assembling the campus' },
  { stage: 'local-terrain', phase: 'world', detail: 'Shaping the terrain' },
  { stage: 'local-road-finishes', phase: 'landmarks', detail: 'Paving streets and malls' },
  { stage: 'local-context', phase: 'landmarks', detail: 'Raising campus landmarks' },
  { stage: 'vegetation', phase: 'landmarks', detail: 'Planting live oaks' },
  { stage: 'deep-west', phase: 'neighborhoods', detail: 'Building the west side' },
  { stage: 'west-campus', phase: 'neighborhoods', detail: 'Building West Campus' },
  { stage: 'downtown', phase: 'neighborhoods', detail: 'Building downtown Austin' },
  { stage: 'riverfront', phase: 'neighborhoods', detail: 'Opening Lady Bird Lake parks' },
  { stage: 'character', phase: 'character', detail: 'Dressing your character' },
  { stage: 'physics', phase: 'physics', detail: 'Setting up movement' },
  { stage: 'shader-warmup', phase: 'shaders', detail: 'Preparing graphics' },
];

export interface BootProgress {
  stage: string;
  phase: BootPhaseId | 'ready';
  /** 0-based phase index; BOOT_PHASES.length once ready. */
  phaseIndex: number;
  detail: string;
  /** Stage-based, not time- or byte-based: each phase is one equal share of the bar, and the
   * steps inside a phase split that share evenly. 1 only when the game reports ready. */
  fraction: number;
}

/** Progress for a boot mark. Unknown stages keep the caller's previous value (`previous`). */
export function bootProgress(stage: string, previous?: BootProgress): BootProgress {
  if (stage === 'local-ready' || stage === 'ready')
    return { stage, phase: 'ready', phaseIndex: BOOT_PHASES.length, detail: 'Ready', fraction: 1 };
  const step = BOOT_STEPS.find(s => s.stage === stage);
  if (!step) return previous ?? bootProgress('engine');
  const phaseIndex = BOOT_PHASES.findIndex(p => p.id === step.phase);
  const inPhase = BOOT_STEPS.filter(s => s.phase === step.phase);
  const within = inPhase.indexOf(step) / inPhase.length;
  const fraction = (phaseIndex + within) / BOOT_PHASES.length;
  // Never move backwards (an out-of-order mark only updates the description).
  const best = previous && previous.fraction > fraction ? previous : null;
  return best ? { ...best, stage, detail: step.detail } : { stage, phase: step.phase, phaseIndex, detail: step.detail, fraction };
}

export const LOADING_TIPS: readonly string[] = [
  'Hold W to take off from anywhere — even from the scooter.',
  'Press M for the map, then click a street to travel there.',
  'Over Lady Bird Lake, holding S hovers safely instead of landing in the water.',
  'Press E on a clear path to hop on a scooter.',
  'Press V for an overview of the whole city.',
  'Drag with the mouse to look around; scroll to zoom.',
  'Hold ↑ and S together to dive.',
];

export interface BootErrorCopy { title: string; message: string; detail: string }

/** Short, human copy for a failed start. `detail` keeps the technical text for the curious. */
export function describeBootError(error: unknown, during: 'import' | 'start'): BootErrorCopy {
  const detail = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (/webgl|\bgpu\b/i.test(detail))
    return { title: 'Your browser couldn’t start 3D graphics',
      message: 'GTA Texas needs WebGL 2. Turn on hardware acceleration or try another browser, then reload.', detail };
  if (during === 'import')
    return { title: 'The game engine didn’t load',
      message: 'Part of the game couldn’t be downloaded. Check your connection and reload to try again.', detail };
  if (/fetch|network|load|json|http/i.test(detail))
    return { title: 'Austin didn’t finish loading',
      message: 'Some map data couldn’t be read. Check your connection and reload to try again.', detail };
  return { title: 'Something went wrong while loading',
    message: 'The city couldn’t be built this time. Reload to try again.', detail };
}

/** Keys shown in the how-to-play steps. `codes` are KeyboardEvent.code values checked against
 * CONTROL_KEYS by the onboarding test; pointer/UI rows have none. */
export interface TutorialBinding { keys: readonly string[]; action: string; codes?: readonly string[] }
export interface TutorialStep { id: 'walk' | 'scooter' | 'fly'; title: string; summary: string; bindings: readonly TutorialBinding[]; note?: string }

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'walk', title: 'Walk & look',
    summary: 'Explore on foot. The camera follows as you turn.',
    bindings: [
      { keys: ['↑', '↓'], action: 'Move forward / back', codes: ['ArrowUp', 'ArrowDown'] },
      { keys: ['←', '→'], action: 'Turn (A / D also turn)', codes: ['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'] },
      { keys: ['Space'], action: 'Jump', codes: ['Space'] },
      { keys: ['Drag'], action: 'Look around · scroll to zoom' },
    ],
    note: 'Double-click to lock the mouse for looking; Esc releases it.',
  },
  {
    id: 'scooter', title: 'Ride a scooter',
    summary: 'Hop on anywhere with a clear path.',
    bindings: [
      { keys: ['E'], action: 'Get on / off', codes: ['KeyE'] },
      { keys: ['↑'], action: 'Ride', codes: ['ArrowUp'] },
      { keys: ['←', '→'], action: 'Steer (A / D also steer)', codes: ['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'] },
      { keys: ['↓', 'Space'], action: 'Brake', codes: ['ArrowDown', 'Space'] },
    ],
  },
  {
    id: 'fly', title: 'Fly & travel',
    summary: 'Take to the sky, or jump straight to a spot on the map.',
    bindings: [
      { keys: ['W'], action: 'Hold to take off / rise', codes: ['KeyW'] },
      { keys: ['S'], action: 'Hold to descend / land', codes: ['KeyS'] },
      { keys: ['↑', 'S'], action: 'Dive', codes: ['ArrowUp', 'KeyS'] },
      { keys: ['Shift'], action: 'Boost', codes: ['ShiftLeft'] },
      { keys: ['M'], action: 'Map · click to travel' },
      { keys: ['V'], action: 'City overview' },
    ],
    note: 'Let go of W and S to hover. Over water, S hovers safely instead of landing.',
  },
];

/** Versioned so a reworked tutorial can be offered again. */
export const TUTORIAL_STORAGE_KEY = 'gta-texas:tutorial:v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** Storage can be missing or throw (privacy modes, sandboxed frames, quota): treat that as "not seen". */
export function tutorialCompleted(storage: () => StorageLike | null | undefined): boolean {
  try { return storage()?.getItem(TUTORIAL_STORAGE_KEY) === 'done'; } catch { return false; }
}

export function markTutorialCompleted(storage: () => StorageLike | null | undefined): boolean {
  try { storage()?.setItem(TUTORIAL_STORAGE_KEY, 'done'); return true; } catch { return false; }
}
