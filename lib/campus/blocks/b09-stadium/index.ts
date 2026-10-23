// Block b09-stadium: Stadium + athletics: DKR, Moncrief, Bellmont, LBJ west of I-35.
// Owner-only file (research/whole-campus-92/BLOCKS.md). Round 1 corrections are data (context.json). Round 2 install() adds the
// DKR exterior features (./exterior.ts): Bellmont west facade above/south of the authored frontage, the three LiDAR-measured
// north corner towers, the 2021 SEZ premium bands and videoboard (on the bowl's SEZ face) — none of it inside the bowl's colliders.
// East-south lane: D20 Myers east stand / press box / masts, D17 TMM, D18 LBJ + Bass fly-tower slits, D19 Manor Garage with the
// Myers west stand and MFH (./d17-tmm.ts, ./d18-lbj-bass.ts, ./d19-manor.ts, ./d20-myers.ts).
import * as THREE from 'three';
import type { BlockInstall, BlockModule } from '../types';
import { buildExterior, exteriorCollider, EXTERIOR_MATERIALS } from './exterior';
import { createBoardFace } from './board-face';
import { Kit } from './lane-kit';
import { buildMyers } from './d20-myers';
import { buildTmm, TMM_KEY } from './d17-tmm';
import { buildLbj, buildBassSlits, LBJ_KEY } from './d18-lbj-bass';
import { buildManor, MAG_KEY } from './d19-manor';

/** Records the east-south lane replaces with its own geometry (context.json `replaces`). */
export const B09_LANE_REPLACED = [TMM_KEY, LBJ_KEY, MAG_KEY] as const;

export const block: BlockModule = {
  id: 'b09-stadium',
  install(ctx) {
    const started = performance.now();
    const parts = buildExterior(ctx.groundHeight);
    const materials = new Map<string, THREE.MeshStandardMaterial>();
    let boardMap: THREE.Texture | null = null;
    const mat = (k: keyof typeof EXTERIOR_MATERIALS) => {
      let m = materials.get(k);
      if (!m) {
        const s = EXTERIOR_MATERIALS[k];
        m = new THREE.MeshStandardMaterial({ name: `b09 DKR exterior ${k}`, color: s.color, roughness: s.roughness, metalness: s.metalness ?? 0, emissive: s.emissive ?? 0 });
        // SEZ videoboard: authored canvas face (board-face.ts), self-lit at a moderate level like an LED screen by day.
        if (k === 'boardFace' && ctx.renderer) { boardMap = createBoardFace(ctx.renderer); m.map = boardMap; m.emissiveMap = boardMap; m.emissiveIntensity = 0.45; m.userData.authored = 'b09 board-face.ts'; }
        materials.set(k, m);
      }
      return m;
    };
    const geometries: THREE.BufferGeometry[] = [], solids: THREE.Mesh[] = [], detail: THREE.Mesh[] = [];
    const add = (list: THREE.Mesh[], builders: typeof parts.builders, label: string) => {
      for (const [k, b] of builders) {
        if (!b.triangles) continue;
        const g = b.geometry(); geometries.push(g);
        const mesh = new THREE.Mesh(g, mat(k)); mesh.name = `b09 DKR exterior ${label} ${k}`;
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.userData.block = 'b09-stadium';
        // The generated bowl is built after blocks and retracts its stands from authored coverage; these bodies stand outside its
        // envelope, so they must not reshape it (the block check asserts the bowl equals the no-install baseline).
        mesh.userData.localContext = true;
        list.push(mesh);
      }
    };
    add(solids, parts.builders, 'solid');
    add(detail, parts.detail, 'detail');
    const colliders = parts.collider.triangles ? [exteriorCollider(ctx.physics, parts.collider)] : [];
    // East-south lane districts (.work/claude-east-south/HANDOFF.json): one private kit, every mesh coverage-exempt so the
    // generated bowl stays identical to its no-install baseline.
    const kit = new Kit('b09-stadium'), districts: Record<string, unknown> = {};
    const step = (id: string, f: () => unknown) => { const t0 = kit.triangles, c0 = kit.colliderTriangles; const r = f(); districts[id] = { ...(r as object), triangles: kit.triangles - t0, colliderTriangles: kit.colliderTriangles - c0 }; };
    step('D20', () => buildMyers(kit, ctx));
    step('D17', () => buildTmm(kit, ctx));
    step('D18', () => ({ lbj: buildLbj(kit, ctx), bass: buildBassSlits(kit) }));
    step('D19', () => buildManor(kit, ctx));
    const lane = kit.finish(ctx, 'b09 east-south lane', true);
    solids.push(...lane.solids); detail.push(...lane.detail); colliders.push(...lane.colliders);
    const install: BlockInstall = {
      solids, detail, colliders, walkable: lane.walkable, replaced: [...B09_LANE_REPLACED],
      stats: { ...parts.stats, triangles: solids.concat(detail).reduce((s, m) => s + m.geometry.getAttribute('position').count / 3, 0), colliderTriangles: parts.collider.triangles,
        drawCalls: solids.length + detail.length + lane.walkable.length, lane: { districts, triangles: kit.triangles, colliderTriangles: kit.colliderTriangles, meshes: lane.meshes, materials: lane.materials, textures: lane.textures },
        installMs: Math.round(performance.now() - started) },
      dispose() {
        lane.dispose();
        for (const c of colliders) if (ctx.physics.getCollider(c.handle)) ctx.physics.removeCollider(c, false);
        for (const g of geometries) g.dispose();
        for (const m of materials.values()) m.dispose();
        boardMap?.dispose();
      },
    };
    return install;
  },
};
