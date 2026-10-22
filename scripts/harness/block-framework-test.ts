// Fixtures for the whole-campus block framework (lib/campus/blocks/registry.ts), per
// research/whole-campus-92/coverage-audit/framework-review.md. Synthetic data + real Rapier; no scene.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { applyBlockData, installBlocks, type BlockOwnership } from '../../lib/campus/blocks/registry';
import { BLOCK_REPLACES, BLOCK_MASSING, blockMassing } from '../../lib/campus/blocks/context-hooks';
import { CATALOG } from '../../lib/campus/context/catalog';
import type { BlockContextData, BlockModule } from '../../lib/campus/blocks/types';
import type { CampusData, Point } from '../../lib/campus/types';

const sq = (x: number, z: number, s = 10): Point[][] => [[[x, z], [x + s, z], [x + s, z + s], [x, z + s]]];
const ev = { source: 'fixture', basis: 'estimate' as const };
const ownership: BlockOwnership = {
  recordOwner: { '7:0': 'tA', '7:1': 'tA', '8:2': 'tA', '9:3': 'tB' },
  rects: { tA: [[0, 100, 0, 100]], tB: [[100, 200, 0, 100]] }, ambiguousIds: [7],
};
const freshData = (): CampusData => ({
  origin: [0, 0], bounds: [0, 0, 200, 100], paths: [], landmarks: {}, metadata: {},
  buildings: [
    { id: 7, name: 'multipart a', abbr: '', h: 5, center: [5, 5], rings: sq(0, 0) },
    { id: 7, name: 'multipart b', abbr: '', h: 5, center: [25, 5], rings: sq(20, 0) },
    { id: 8, name: 'single', abbr: '', h: 5, center: [45, 5], rings: sq(40, 0) },
    { id: 9, name: 'other block', abbr: '', h: 5, center: [125, 5], rings: sq(120, 0) },
  ],
});

export async function runBlockFrameworkTest() {
  await RAPIER.init();
  const failures: string[] = [], report: Record<string, unknown> = {};
  const expect = (ok: boolean, msg: string) => { if (!ok) failures.push(msg); };

  // 1. ambiguous id rejected; record key edits only that record; exclude keeps later keys stable.
  {
    const d = freshData();
    const r = applyBlockData(d, [{ block: 'tA', footprints: { '7': { rings: sq(0, 0, 12), evidence: ev } } }], ownership);
    expect(!!r.rejected.tA && d.buildings[0].rings[0][1][0] === 10, 'ambiguous id must reject the whole block and change nothing');
    const d2 = freshData();
    const r2 = applyBlockData(d2, [{ block: 'tA', footprints: { '7:1': { rings: sq(20, 0, 12), evidence: ev } }, exclude: { '7:0': ev } }], ownership);
    expect(!r2.errors.length, `record-key edit rejected: ${r2.errors.join('; ')}`);
    expect(d2.buildings.length === 3 && d2.buildings[0].key === '7:1' && d2.buildings[0].rings[0][1][0] === 32 && d2.buildings[1].key === '8:2', 'exclude 7:0 + edit 7:1: later keys must stay stable and only 7:1 change');
    expect(r2.excluded.length === 1 && r2.excluded[0].key === '7:0', 'excluded record must be reported with its key');
    report.multipart = { applied: r2.applied.tA, keys: d2.buildings.map(b => b.key) };
  }
  // 2. added record: owned, keyed, inside the block; outside → rejected.
  {
    const d = freshData();
    const r = applyBlockData(d, [{ block: 'tA', add: [{ id: -101, name: 'new', abbr: 'NEW', h: 12, rings: sq(60, 60), evidence: ev }], massing: { '-101:add': { volumes: [{ bottom: 0, top: 12, roof: 'flat' }], evidence: ev } } }], ownership);
    expect(!r.errors.length && r.added[0]?.key === '-101:add' && d.buildings.some(b => b.key === '-101:add'), `valid add failed: ${r.errors.join('; ')}`);
    const d2 = freshData();
    const r2 = applyBlockData(d2, [{ block: 'tA', add: [{ id: -102, name: 'bad', abbr: '', h: 9, rings: [[[90, 10], [110, 10], [110, 20], [90, 20]]], evidence: ev }] }], ownership);
    expect(!!r2.rejected.tA && d2.buildings.length === 4, 'add crossing into another block must be rejected (all vertices checked)');
  }
  // 3. two blocks writing the same record: the second is rejected; cross-owner writes rejected.
  {
    const d = freshData();
    const r = applyBlockData(d, [{ block: 'tA', replaces: { '8': ev } }, { block: 'tB', massing: { '8': { volumes: [{ bottom: 0, top: 3, roof: 'flat' }], evidence: ev } } }], ownership);
    expect(!r.rejected.tA && !!r.rejected.tB && !BLOCK_MASSING.has('8:2'), 'conflicting/cross-owner writer must be rejected without mutation');
  }
  // 4. malformed data rejected before any mutation (data and catalogue untouched).
  {
    const before = JSON.stringify(CATALOG.buildings['8'] ?? null);
    const bad: BlockContextData[] = [{ block: 'tA',
      catalog: { '8': { archetype: 'master-plan', evidence: ev } },
      massing: { '8': { volumes: [], evidence: ev } } },
    { block: 'tA', footprints: { '8': { rings: [[[40, 0], [50, 0], [50, 10], [40, 10]], [[60, 60], [61, 60], [61, 61]]], evidence: ev } } },
    { block: 'tA', massing: { '8': { volumes: [{ bottom: 5, top: 4, roof: 'flat' }], evidence: ev } } },
    { block: 'tA', massing: { '8': { volumes: [{ bottom: 0, top: 4, roof: 'dome' as 'flat' }], evidence: ev } } },
    { block: 'tA', massing: { '8': { volumes: [{ bottom: 0, top: Number.NaN, roof: 'flat' }], evidence: ev } } },
    { block: 'tA', catalog: { '8': { archetype: 'no-such-archetype', evidence: ev } } }];
    bad.forEach((c, i) => {
      const d = freshData();
      const r = applyBlockData(d, [c], ownership);
      expect(!!r.rejected.tA && d.buildings[2].rings.length === 1 && d.buildings[2].rings[0][1][0] === 50 && !BLOCK_MASSING.size, `malformed case ${i} not rejected before mutation`);
    });
    expect(JSON.stringify(CATALOG.buildings['8'] ?? null) === before, 'catalogue mutated by a rejected block');
  }
  // 5. datum
  {
    const d = freshData();
    applyBlockData(d, [{ block: 'tA', massing: { '8': { volumes: [{ bottom: 0, top: 30, roof: 'flat' }], evidence: ev, datum: 'campusY' } } }], ownership);
    const m = blockMassing(d.buildings[2], d.buildings[2].rings);
    expect(m?.heightBase === 0 && m.volumes[0].top === 30, 'campusY datum must resolve to heightBase 0');
    const d2 = freshData();
    applyBlockData(d2, [{ block: 'tA', massing: { '8': { volumes: [{ bottom: 0, top: 30, roof: 'flat' }], evidence: ev, datum: { aboveY: 4.5 } } } }], ownership);
    expect(blockMassing(d2.buildings[2], d2.buildings[2].rings)?.heightBase === 4.5, 'aboveY datum must resolve');
    const d3 = freshData();
    applyBlockData(d3, [{ block: 'tA', massing: { '8': { volumes: [{ rings: [[[40, 0], [50, 0], [50, 10], [40, 10]], [[43, 3], [47, 3], [47, 7], [43, 7]]], bottom: 0, top: 9, roof: 'flat' }], evidence: ev } } }], ownership);
    expect(blockMassing(d3.buildings[2], d3.buildings[2].rings)?.volumes[0].rings.length === 2, 'massing rings with holes must be kept');
  }
  // 6. install transaction, replacement commit, rollback and disposal.
  {
    const physics = new RAPIER.World({ x: 0, y: -24, z: 0 });
    const borrowed = new THREE.MeshBasicMaterial(); let borrowedDisposed = 0; borrowed.addEventListener('dispose', () => { borrowedDisposed++; });
    const box = (x: number) => RAPIER.ColliderDesc.cuboid(1, 1, 1).setTranslation(x, 1, 5);
    const mk = (id: string, install: BlockModule['install']): BlockModule => ({ id, install });
    const d = freshData();
    applyBlockData(d, [{ block: 'tA', replaces: { '8': ev, '7:0': ev } }, { block: 'tB', replaces: { '9': ev } }], ownership);
    const surfaces = new THREE.Group(), world = new THREE.Group();
    const count = () => { let n = 0; physics.forEachCollider(() => { n++; }); return n; };
    const ownGeometry = new THREE.BoxGeometry(); let ownDisposed = 0; ownGeometry.addEventListener('dispose', () => { ownDisposed++; });
    const mods: BlockModule[] = [
      mk('tA', ctx => { const c = ctx.physics.createCollider(box(45)); const mesh = new THREE.Mesh(ownGeometry, borrowed); const ground = new THREE.Mesh(new THREE.PlaneGeometry(), borrowed);
        return { solids: [mesh], walkable: [ground], colliders: [c], replaced: ['8'], stats: {}, dispose() { ownGeometry.dispose(); } }; }),
      mk('tB', ctx => { ctx.physics.createCollider(box(125)); ctx.physics.createCollider(box(130)); throw new Error('injected failure after two colliders'); }),
      mk('tC', () => null),
    ];
    const before = count();
    const inst = installBlocks({ data: d, physics, terrainHeight: () => 0, groundHeight: () => 0, authored: { surfaces, world }, material: () => borrowed }, surfaces, world, mods);
    expect(count() === before + 1, `after install expected +1 collider (tB rolled back), got ${count() - before}`);
    expect(BLOCK_REPLACES.has('8:2') && !BLOCK_REPLACES.has('7:0') && !BLOCK_REPLACES.has('9:3'), 'only replacements reported by a successful install may commit');
    expect(inst.replacements.fallback['7:0'] === 'tA' && inst.replacements.fallback['9:3'] === 'tB', 'declared but unbuilt replacements must keep their fallback');
    expect(surfaces.children.length === 1 && world.children.length === 1, 'walkable/solid attachment');
    inst.dispose(); inst.dispose();
    expect(count() === before && surfaces.children.length === 0 && world.children.length === 0 && !BLOCK_REPLACES.size, 'dispose must remove colliders, detach objects and clear replacements (twice safe)');
    expect(ownDisposed === 1 && borrowedDisposed === 0, `owner geometry disposed once (${ownDisposed}), borrowed material never (${borrowedDisposed})`);
    report.transaction = { stats: inst.stats, replacements: inst.replacements };
  }
  // 7. v2.1 regressions from Codex's targeted fixtures (framework-review-v2.md).
  {
    const d = freshData();
    const r = applyBlockData(d, [
      { block: 'tA', add: [{ id: -101, name: 'a', abbr: '', h: 5, rings: sq(60, 60), evidence: ev }] },
      { block: 'tB', add: [{ id: -101, name: 'b', abbr: '', h: 5, rings: sq(160, 60), evidence: ev }] }], ownership);
    expect(!r.rejected.tA && !!r.rejected.tB && d.buildings.filter(b => b.key === '-101:add').length === 1 && r.added.length === 1 && r.added[0].block === 'tA', 'duplicate added id across blocks must be rejected for the later block only');
    const dn = freshData();
    let threw = false;
    try { const rn = applyBlockData(dn, [{ block: 'tA', massing: { '8': { volumes: [{ bottom: 0, top: 3, roof: 'flat' }], evidence: ev, datum: null as unknown as 'grade' } } }], ownership); expect(!!rn.rejected.tA, 'null datum must be rejected'); } catch { threw = true; }
    expect(!threw, 'null datum must not throw');
    const dnull = freshData();
    let threw2 = false;
    try { const rn2 = applyBlockData(dnull, [{ block: 'tA', footprints: { '8': null as unknown as { rings: Point[][]; evidence: typeof ev } } }], ownership); expect(!!rn2.rejected.tA, 'null footprint entry must be rejected'); } catch { threw2 = true; }
    expect(!threw2, 'null operation payload must not throw');
    const da = freshData();
    const ra = applyBlockData(da, [{ block: 'tA', archetypes: { 'tA:bad': {} as never }, catalog: { '8': { archetype: 'tA:bad', evidence: ev } } }], ownership);
    expect(!!ra.rejected.tA && !CATALOG.archetypes['tA:bad'], 'empty archetype must be rejected and not installed');
    const garage = Object.keys(CATALOG.archetypes).find(k => k !== (CATALOG.buildings['8']?.archetype ?? 'master-plan')) ?? 'master-plan';
    const before = CATALOG.buildings['8']?.archetype;
    applyBlockData(freshData(), [{ block: 'tA', catalog: { '8': { archetype: garage, evidence: ev } } }], ownership);
    expect(CATALOG.buildings['8']?.archetype === garage, 'catalogue override must apply');
    applyBlockData(freshData(), [], ownership);
    expect(CATALOG.buildings['8']?.archetype === before, `catalogue must be restored for a fresh data object (got ${CATALOG.buildings['8']?.archetype}, expected ${before})`);
    // empty successful replacement and ambiguous claim
    const physics = new RAPIER.World({ x: 0, y: -24, z: 0 });
    const g = new THREE.Group();
    const dr = freshData();
    applyBlockData(dr, [{ block: 'tA', replaces: { '8': ev, '7:0': ev, '7:1': ev } }], ownership);
    const empty: BlockModule = { id: 'tA', install: () => ({ colliders: [], replaced: ['8'], stats: {}, dispose() {} }) };
    const i1 = installBlocks({ data: dr, physics, terrainHeight: () => 0, groundHeight: () => 0, authored: { surfaces: g, world: g }, material: () => undefined }, g, g, [empty]);
    expect(!BLOCK_REPLACES.has('8:2') && i1.replacements.fallback['8:2'] === 'tA', 'an empty successful install must not commit a replacement');
    i1.dispose();
    applyBlockData(dr === dr ? freshData() : dr, [{ block: 'tA', replaces: { '7:0': ev, '7:1': ev } }], ownership);
    const amb: BlockModule = { id: 'tA', install: ctx => ({ solids: [new THREE.Mesh(new THREE.BoxGeometry())], colliders: [ctx.physics.createCollider(RAPIER.ColliderDesc.cuboid(1, 1, 1))], replaced: ['7'], stats: {}, dispose() {} }) };
    const i2 = installBlocks({ data: dr, physics, terrainHeight: () => 0, groundHeight: () => 0, authored: { surfaces: g, world: g }, material: () => undefined }, g, g, [amb]);
    expect(!BLOCK_REPLACES.size && !!(i2.stats.tA as { claimErrors?: string[] }).claimErrors, 'an ambiguous numeric replacement claim must be rejected, not resolved to the first part');
    i2.dispose();
  }
  // 8. inherited property names are not archetypes (framework v3 review).
  {
    const d = freshData();
    const r = applyBlockData(d, [{ block: 'tA', catalog: { '8': { archetype: 'toString', evidence: ev } } }], ownership);
    expect(!!r.rejected.tA, 'catalog archetype "toString" must be rejected');
    const r2 = applyBlockData(freshData(), [{ block: 'tA', massing: { '8': { volumes: [{ bottom: 0, top: 3, roof: 'flat', archetype: 'constructor' }], evidence: ev } } }], ownership);
    expect(!!r2.rejected.tA, 'volume archetype "constructor" must be rejected');
  }
  return { failures, report };
}
