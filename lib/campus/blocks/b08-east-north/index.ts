// Block b08-east-north: Dean Keeton east: TNH, CRH, San Jacinto north, Duren.
// Owner-only file (research/whole-campus-92/BLOCKS.md). install() adds the east-south lane's district geometry
// (.work/b08-FROZEN.json): D15 (./d15-law-sjg.ts: SJG garage, JON, TS1 replaced; CCJ pilasters/cornice additive) and D16
// (./d16-st-davids.ts: St. David's hospital and both garages replaced), declared in context.json `replaces`. One private kit
// batches every triangle per (layer, material) with one trimesh collider per layer from the same triangles; every mesh is
// coverage-exempt so neighbouring generated buildings are classified exactly as before.
import type { BlockInstall, BlockModule } from '../types';
import { Kit } from './lane-kit';
import { buildD15, SJG_KEY, JON_KEY, TS1_KEY } from './d15-law-sjg';
import { buildD16, HOSPITAL_KEY, SDMC_GARAGE_KEY, GARAGE1_KEY } from './d16-st-davids';

export const B08_REPLACED = [SJG_KEY, JON_KEY, TS1_KEY, HOSPITAL_KEY, SDMC_GARAGE_KEY, GARAGE1_KEY] as const;

export const block: BlockModule = {
  id: 'b08-east-north',
  install(ctx): BlockInstall {
    const started = performance.now(), kit = new Kit('b08-east-north'), districts: Record<string, unknown> = {};
    const step = (id: string, f: () => unknown) => { const t0 = kit.triangles, c0 = kit.colliderTriangles; const r = f(); districts[id] = { ...(r as object), triangles: kit.triangles - t0, colliderTriangles: kit.colliderTriangles - c0 }; };
    step('D15', () => buildD15(kit, ctx));
    step('D16', () => buildD16(kit, ctx));
    const out = kit.finish(ctx, 'b08 east-south lane', true);
    return {
      solids: out.solids, walkable: out.walkable, detail: out.detail, colliders: out.colliders, replaced: [...B08_REPLACED],
      stats: { districts, triangles: kit.triangles, colliderTriangles: kit.colliderTriangles, meshes: out.meshes, materials: out.materials, textures: out.textures, installMs: Math.round(performance.now() - started) },
      dispose: out.dispose,
    };
  },
};
