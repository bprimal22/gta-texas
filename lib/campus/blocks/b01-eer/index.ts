// Block b01-eer: Engineering: EER, PMA, ETC, ECJ site, Dean Keeton east of Speedway.
// Owner-only file (research/whole-campus-92/BLOCKS.md; evidence in research/whole-campus-92/b01-eer/).
//
// install() (round 3) adds the engineering pedestrian bridge across East Dean Keeton (OSM 25775199) with its
// south terrace floor and north landing (dean-keeton-bridge.ts). Colliders are trimeshes of the rendered
// triangles. The PMA/ECJ podium cut for the terrace is in pma-local-podium.ts.
// District D01 (petroleum.ts) rebuilds CPE (732885:1230) and ETC (506548:211) from their own measured massing with
// reference-interpreted facades and REPLACES those two records (context.json `replaces`); the bridge is unchanged.
import type { BlockModule, BlockInstall } from '../types';
import { buildDeanKeetonBridge } from './dean-keeton-bridge';
import { buildPetroleum } from './petroleum';

export const block: BlockModule = {
  id: 'b01-eer',
  install(ctx): BlockInstall {
    const began = performance.now();
    const bridge = buildDeanKeetonBridge(ctx);
    let petroleum: ReturnType<typeof buildPetroleum>;
    try { petroleum = buildPetroleum(ctx); } catch (e) {
      // the registry rolls back every collider of this install; free the bridge's GPU resources too
      for (const g of bridge.geometries) g.dispose();
      for (const m of bridge.materials) m.dispose();
      throw e;
    }
    const colliders = [...bridge.colliders, ...petroleum.colliders];
    return {
      walkable: bridge.walkable,
      solids: [...bridge.solids, ...petroleum.solids],
      detail: petroleum.detail,
      colliders,
      replaced: petroleum.replaced,
      stats: { deanKeetonBridge: bridge.stats, petroleum: petroleum.stats, installMs: +(performance.now() - began).toFixed(1) },
      dispose() {
        for (const c of colliders) if (ctx.physics.getCollider(c.handle)) ctx.physics.removeCollider(c, false);
        for (const g of bridge.geometries) g.dispose();
        for (const m of bridge.materials) m.dispose();
        for (const g of petroleum.geometries) g.dispose();
        for (const m of petroleum.materials) m.dispose();
      },
    };
  },
};
