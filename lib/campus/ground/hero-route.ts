import type * as T from 'three';
import type { Box2 } from './surface-index';
import type { TieInTag } from './tag';

/** Hero route boxes [minX, maxX, minZ, maxZ] (campus metres, Z south): MLK / East
 * Mall -> Speedway -> East Mall upper court / Main east apron -> Tower and Main ->
 * West Mall, South Mall, West 24th / Tower north, Flawn / Inner Campus. */
export const HERO_ROUTE_BOXES: Record<string, Box2> = {
  'MLK / East Mall': [-100, 130, 25, 92],
  'Speedway': [-15, 30, -160, 80],
  'East Mall upper / Main east apron': [-176, -100, 0, 92],
  'Tower / Main': [-300, -130, -70, 50],
  'West Mall': [-420, -260, -5, 75],
  'South Mall': [-290, -140, 50, 215],
  'West 24th / Tower north': [-232, -60, -160, -30],
  'Flawn / Inner Campus': [-345, -255, -90, 25],
};
const boxes = Object.values(HERO_ROUTE_BOXES);

/** Graded ground built by modules owned elsewhere that borders the hero route.
 * Their meshes are not edited; tie-ins are added beside their outer edges, on
 * the hero route only. Mesh names as built today (checked by the ground check). */
const EXTRA: [RegExp, TieInTag['finish']][] = [
  [/^Smooth East Mall buildings: Mall planting soil$/, 'soil'],
  [/^WCH existing yard planting soil$/, 'soil'],
  [/^West 24th architecture: 24th foundation gravel$/, 'paved'],
];
export function heroRouteExtraGround(mesh: T.Mesh): TieInTag | null {
  for (const [name, finish] of EXTRA) if (name.test(mesh.name)) return { module: mesh.name, finish, regions: boxes };
  return null;
}
