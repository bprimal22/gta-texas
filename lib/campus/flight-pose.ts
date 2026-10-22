import * as THREE from 'three';

/** A temporary layer over the accepted character's animation. Restore before
 * advancing the mixer, so repeated flight/landing never accumulates bone edits. */
export function createFlightPose(model: THREE.Object3D) {
  const names = ['L_UpperArm', 'L_Forearm', 'L_Hand', 'R_UpperArm', 'R_Forearm', 'R_Hand', 'L_Thigh', 'R_Thigh', 'L_Calf', 'R_Calf', 'Neck', 'Head'];
  const bones = new Map(names.map(name => [name, model.getObjectByName('Bip01_' + name)]));
  let incoming: { bone: THREE.Object3D; quaternion: THREE.Quaternion }[] = [];
  const restore = () => {
    for (const { bone, quaternion } of incoming) bone.quaternion.copy(quaternion);
    incoming = [];
  };
  const aim = (name: string, childName: string, direction: THREE.Vector3, weight: number) => {
    const bone = bones.get(name), child = bones.get(childName);
    if (!bone || !child) return;
    const from = child.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3())).normalize();
    const world = bone.getWorldQuaternion(new THREE.Quaternion());
    const target = new THREE.Quaternion().setFromUnitVectors(from, direction).multiply(world);
    const local = bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(target);
    bone.quaternion.slerp(local, weight); bone.updateWorldMatrix(false, true);
  };
  return {
    restore,
    apply(avatar: THREE.Group, weight: number) {
      restore();
      if (weight < .001) return;
      incoming = [...bones.values()].filter((b): b is THREE.Object3D => !!b).map(bone => ({ bone, quaternion: bone.quaternion.clone() }));
      avatar.updateWorldMatrix(true, true);
      const q = avatar.getWorldQuaternion(new THREE.Quaternion());
      // Left fist leads above the head; the other arm stays close to the torso.
      // Avatar tilt rotates this upright pose into the direction of flight.
      const lead = new THREE.Vector3(-.12, 1, .13).normalize().applyQuaternion(q);
      const trailing = new THREE.Vector3(.12, -1, .08).normalize().applyQuaternion(q);
      aim('L_UpperArm', 'L_Forearm', lead, weight);
      aim('L_Forearm', 'L_Hand', lead, weight);
      aim('R_UpperArm', 'R_Forearm', trailing, weight);
      aim('R_Forearm', 'R_Hand', trailing, weight);
      for (const name of ['L_Thigh', 'R_Thigh', 'L_Calf', 'R_Calf']) bones.get(name)?.rotateZ((name.endsWith('Calf') ? -.08 : .03) * weight);
      // Keep the face looking ahead rather than into the ground while prone.
      bones.get('Neck')?.rotateZ(-.23 * weight);
      bones.get('Head')?.rotateZ(-.18 * weight);
    },
  };
}
