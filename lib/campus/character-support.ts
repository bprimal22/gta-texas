import type RAPIER from '@dimforge/rapier3d-compat';

// A capsule can remain supported on a stair's upper edge while Rapier's
// computedGrounded briefly returns false. Let walkable contacts on its lower
// hemisphere preserve support, so gravity does not accumulate into a downward
// push that prevents the next automatic step. Walls and overhead contacts do
// not qualify, and ascending jumps retain the controller's normal result.
export function characterSupported(
  controller: RAPIER.KinematicCharacterController,
  centerY: number,
  verticalSpeed: number,
) {
  if (controller.computedGrounded()) return true;
  if (verticalSpeed > 0) return false;
  for (let i = 0; i < controller.numComputedCollisions(); i++) {
    const contact = controller.computedCollision(i);
    if (
      contact &&
      contact.normal1.y >= Math.cos(controller.maxSlopeClimbAngle()) &&
      contact.witness1.y <= centerY - 0.54
    ) return true;
  }
  return false;
}
