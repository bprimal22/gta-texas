// Block b03-gdc-speedway: GDC, Speedway mall, East Mall, MLK statue.
// Owner-only file (research/whole-campus-92/BLOCKS.md; evidence in research/whole-campus-92/b03-gdc-speedway/).
//
// install() adds, with colliders built from the rendered triangles:
//  - (round 2) the Speedway service drive north of the accepted corridor end (z -243.8) to the East Dean Keeton
//    curb (speedway-north.ts; shared requests b03-r4 / b01-r1), walkable and rideable;
//  - (round 2) the two power plant chimneys measured in the 2017 LiDAR point cloud (power-plant-stacks.ts);
//  - (round 3) the fan shrouds on the CS6, CT1 and CT2 cooling-tower decks (cooling-fans.ts).
//  - (district round, D04) painted stall lines on that service drive (speedway-north-markings.ts; flush paint, no
//    collider), and (D05) b03-owned textured brick/metal finishes at metre UVs on the chimneys and fan shrouds
//    (textured-finish.ts; geometry and colliders unchanged). The root-owned GDC model is NOT changed by this block.
// It replaces no record: the generated power plant buildings (and the round-3 official additions CT1, CT2,
// PA1, PA3, PA4, PB2 in context.json `add`) stay generated with their LiDAR massing.
import type { BlockModule, BlockInstall } from '../types';
import { buildSpeedwayNorth } from './speedway-north';
import { buildSpeedwayNorthMarkings } from './speedway-north-markings';
import { buildPowerPlantStacks } from './power-plant-stacks';
import { buildCoolingFans } from './cooling-fans';
import { TexturedFinish } from './textured-finish';

export const block: BlockModule = {
  id: 'b03-gdc-speedway',
  install(ctx): BlockInstall {
    const began = performance.now();
    const tex = new TexturedFinish(ctx.renderer);
    const speedway = buildSpeedwayNorth(ctx);
    const paint = buildSpeedwayNorthMarkings(speedway.stations);
    const stacks = buildPowerPlantStacks(ctx, tex);
    const fans = buildCoolingFans(ctx, tex);
    const colliders = [...speedway.colliders, stacks.collider, fans.collider];
    return {
      walkable: [...speedway.walkable, paint.mesh],
      solids: [stacks.mesh, fans.mesh],
      colliders,
      stats: {
        speedwayNorth: speedway.stats,
        stallPaint: paint.stats,
        stacks: { count: 2, triangles: stacks.triangles },
        coolingFans: { count: fans.count, triangles: fans.triangles },
        textured: tex.materials.map(m => ({ name: m.name, family: m.userData.family, tileM: m.userData.tileM, textured: m.userData.textured })),
        installMs: +(performance.now() - began).toFixed(1),
      },
      dispose() {
        for (const c of colliders) if (ctx.physics.getCollider(c.handle)) ctx.physics.removeCollider(c, false);
        for (const g of speedway.geometries) g.dispose();
        paint.geometry.dispose(); paint.material.dispose();
        stacks.geometry.dispose(); fans.geometry.dispose(); tex.dispose();
      },
    };
  },
};
