import type * as T from 'three';
import type { Box2 } from './surface-index';

/** Finish of a graded ground surface: paved edges get lawn batters, paved ramps
 * and level infills; lawn/soil edges continue in their own material. */
export type TieInFinish = 'paved' | 'lawn' | 'soil';
export interface TieInTag { module: string; finish: TieInFinish; /** Only edges inside these boxes. */ regions?: Box2[] }

/** Builders tag the meshes whose up-facing top is graded ground (ground/tie-ins.ts). */
export function tagGroundTieIn<M extends T.Object3D>(mesh: M, module: string, finish: TieInFinish): M {
  mesh.userData.groundTieIn = { module, finish } satisfies TieInTag;
  return mesh;
}
