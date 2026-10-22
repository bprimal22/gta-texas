// Block b10-east-campus: East campus beyond I-35: Manor Rd, Comal, garages, fields.
// Owner-only file (research/whole-campus-92/BLOCKS.md). install() adds the east-south lane's district geometry
// (.work/claude-east-south/HANDOFF.json): D21 Indoor Practice Facility fabric dome (./d21-practice-dome.ts) and
// D22 UFCU Disch-Falk Field grandstand (./d22-disch-falk.ts), both declared in context.json `replaces`.
// One private kit batches every triangle per (layer, material) with one trimesh collider per layer from the same triangles.
import type { BlockInstall, BlockModule } from '../types';
import { Kit } from './lane-kit';
import { buildPracticeDome, IPF_KEY } from './d21-practice-dome';
import { buildDischFalk, DFF_KEY } from './d22-disch-falk';

export const B10_REPLACED = [IPF_KEY, DFF_KEY] as const;

export const block: BlockModule = {
  id: 'b10-east-campus',
  install(ctx): BlockInstall {
    const started = performance.now(), kit = new Kit('b10-east-campus'), districts: Record<string, unknown> = {};
    const step = (id: string, f: () => unknown) => { const t0 = kit.triangles, c0 = kit.colliderTriangles; const r = f(); districts[id] = { ...(r as object), triangles: kit.triangles - t0, colliderTriangles: kit.colliderTriangles - c0 }; };
    step('D21', () => buildPracticeDome(kit, ctx));
    step('D22', () => buildDischFalk(kit, ctx));
    const out = kit.finish(ctx, 'b10 east-south lane');
    return {
      solids: out.solids, walkable: out.walkable, detail: out.detail, colliders: out.colliders, replaced: [...B10_REPLACED],
      stats: { districts, triangles: kit.triangles, colliderTriangles: kit.colliderTriangles, meshes: out.meshes, materials: out.materials, textures: out.textures, installMs: Math.round(performance.now() - started) },
      dispose: out.dispose,
    };
  },
};
