// Onboarding logic test (no browser, no build step):
//   node --experimental-strip-types scripts/harness/run-onboarding-test.mjs
// Boot stages map to monotonic, stage-based progress; every stage CampusGame marks is known; error copy is human;
// tutorial bindings use real CONTROL_KEYS; tutorial completion storage is versioned and never throws.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const { CONTROL_KEYS } = await import(resolve(root, 'lib/campus/controls.ts'));
const o = await import(resolve(root, 'lib/campus/onboarding.ts'));

// 1. Every boot mark emitted by game.ts is a known stage (an unknown one would freeze the label).
const game = readFileSync(resolve(root, 'lib/campus/game.ts'), 'utf8');
const marks = [...game.matchAll(/markBoot\('([a-z-]+)'\)/g)].map(m => m[1]);
const initial = /const boot = \{ stage: '([a-z-]+)'/.exec(game)?.[1];
assert.ok(initial && marks.length >= 10, 'found the boot marks in game.ts');
for (const stage of [initial, ...marks]) {
  const p = o.bootProgress(stage);
  assert.ok(stage === 'local-ready' ? p.phase === 'ready' : p.stage === stage && p.detail && !p.detail.includes('Engine'), `known stage ${stage}`);
}

// 2. In emission order (page: engine, engine-start; then game.ts marks), progress never decreases, stays < 1 until ready.
let previous, last = -1;
for (const stage of ['engine', 'engine-start', initial, ...marks]) {
  const p = o.bootProgress(stage, previous);
  assert.ok(p.fraction >= last, `monotonic at ${stage}: ${p.fraction} >= ${last}`);
  assert.ok(stage === 'local-ready' ? p.fraction === 1 : p.fraction < 1, `only ready reaches 1 (${stage})`);
  last = p.fraction; previous = p;
}
const phasesSeen = new Set(['engine', 'engine-start', initial, ...marks].map(s => o.bootProgress(s).phase));
for (const phase of o.BOOT_PHASES) assert.ok(phasesSeen.has(phase.id), `phase ${phase.id} is reached by a real stage`);
// Out-of-order or unknown marks never move the bar backwards.
const late = o.bootProgress('physics');
assert.equal(o.bootProgress('world', late).fraction, late.fraction);
assert.equal(o.bootProgress('not-a-stage', late), late);
// Player-facing labels avoid engine jargon.
const labels = o.BOOT_PHASES.map(p => p.label).join(' ');
assert.ok(!/\b(Shaders?|Physics)\b/.test(labels), labels);
assert.ok(labels.includes('Preparing graphics') && labels.includes('Setting up movement'));

// 3. Error copy: import failure vs start failure, WebGL recognised, technical detail kept separately.
const imp = o.describeBootError(new TypeError('Failed to fetch dynamically imported module'), 'import');
assert.match(imp.title, /engine/i); assert.match(imp.message, /reload/i); assert.match(imp.detail, /dynamically/);
assert.match(o.describeBootError(new Error('Error creating WebGL context.'), 'start').title, /3D graphics/);
assert.match(o.describeBootError(new Error('Campus data failed to load'), 'start').title, /Austin/);
assert.match(o.describeBootError('weird', 'start').message, /Reload/);
assert.ok(!/context/i.test(o.describeBootError(new Error('Local context glazing missing'), 'start').title), 'context ≠ WebGL context');

// 4. Tutorial: three steps (walk, scooter, fly), every keyboard binding is a real CONTROL_KEYS code.
const known = new Set(Object.values(CONTROL_KEYS).flat());
assert.deepEqual(o.TUTORIAL_STEPS.map(s => s.id), ['walk', 'scooter', 'fly']);
for (const step of o.TUTORIAL_STEPS) for (const b of step.bindings) for (const code of b.codes ?? [])
  assert.ok(known.has(code), `${step.id}: ${b.action} uses bound key ${code}`);
const has = (id, code) => o.TUTORIAL_STEPS.find(s => s.id === id).bindings.some(b => b.codes?.includes(code));
assert.ok(CONTROL_KEYS.rise.includes('KeyW') && has('fly', 'KeyW'));
assert.ok(CONTROL_KEYS.descend.includes('KeyS') && has('fly', 'KeyS'));
assert.ok(CONTROL_KEYS.scooter.includes('KeyE') && has('scooter', 'KeyE'));
assert.ok(has('scooter', 'Space') && has('walk', 'Space'), 'Space: jump on foot, brake on the scooter');

// 5. Guarded, versioned completion storage.
const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m }; };
const s = memory();
assert.match(o.TUTORIAL_STORAGE_KEY, /v\d+$/);
assert.equal(o.tutorialCompleted(() => s), false);
assert.equal(o.markTutorialCompleted(() => s), true);
assert.equal(o.tutorialCompleted(() => s), true);
assert.equal(s.m.get(o.TUTORIAL_STORAGE_KEY), 'done');
const throwing = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); } };
assert.equal(o.tutorialCompleted(() => throwing), false);
assert.equal(o.markTutorialCompleted(() => throwing), false);
assert.equal(o.tutorialCompleted(() => { throw new Error('no localStorage'); }), false);
assert.equal(o.tutorialCompleted(() => null), false);

console.log(`PASS: ${marks.length + 1} boot stages → ${o.BOOT_PHASES.length} monotonic stage-based phases, error copy, `
  + `${o.TUTORIAL_STEPS.length} tutorial steps on real bindings, guarded versioned storage`);
