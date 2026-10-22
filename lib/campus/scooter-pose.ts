import * as T from "three";
import type { ScooterTargets } from "./scooter-model";

export interface ScooterPoseState {
  targets: ScooterTargets;
  weight: number;
  /** 0 while cruising; 1 plants the rear/right foot beside the deck. */
  stationary?: number | boolean;
}
interface Transform {
  position: T.Vector3;
  quaternion: T.Quaternion;
  scale: T.Vector3;
}
const save = (o: T.Object3D): Transform => ({
  position: o.position.clone(),
  quaternion: o.quaternion.clone(),
  scale: o.scale.clone(),
});
const put = (o: T.Object3D, t: Transform) => {
  o.position.copy(t.position);
  o.quaternion.copy(t.quaternion);
  o.scale.copy(t.scale);
};

/** Bind once to the accepted GLB. Does not own or modify its mesh/material assets.
 * Frame order: restore(); mixer.update(dt); update avatar/scooter world transforms;
 * apply(...). Each solved ride starts from immutable bind transforms, and restore
 * returns precisely the incoming mixed pose rather than the original bind pose.
 */
export function createScooterPose(model: T.Object3D) {
  const find = (name: string) => {
    const b = model.getObjectByName("Bip01" + (name ? "_" + name : ""));
    if (!b) throw Error("Scooter pose: missing Bip01" + (name ? "_" + name : ""));
    return b;
  };
  const rigRoot = find(""),
    spine1 = find("Spine1"),
    spine2 = find("Spine2");
  const bones: T.Object3D[] = [rigRoot];
  model.traverse((o) => {
    if ((o as T.Bone).isBone) bones.push(o);
  });
  const stable = bones.map(save);
  let incoming: Transform[] | null = null,
    disposed = false,
    lastWeight = 0;
  model.updateWorldMatrix(true, true);
  const left = { upper: find("L_UpperArm"), lower: find("L_Forearm"), end: find("L_Hand") },
    right = { upper: find("R_UpperArm"), lower: find("R_Forearm"), end: find("R_Hand") };
  const front = { upper: find("L_Thigh"), lower: find("L_Calf"), end: find("L_Foot") },
    rear = { upper: find("R_Thigh"), lower: find("R_Calf"), end: find("R_Foot") };
  const world = (o: T.Object3D) => o.getWorldPosition(new T.Vector3());
  const modelQ = model.getWorldQuaternion(new T.Quaternion()),
    invModelQ = modelQ.clone().invert();
  const footBinding = (limb: typeof front) => {
    const side = limb === front ? "L" : "R",
      p = world(limb.end),
      toe = world(find(side + "_Toe0")),
      forward = toe.clone().sub(p).applyQuaternion(invModelQ),
      yaw = Math.atan2(forward.x, forward.z);
    const restQ = invModelQ.clone().multiply(limb.end.getWorldQuaternion(new T.Quaternion()));
    const q = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), -yaw).multiply(restQ);
    const local = model.worldToLocal(p.clone()),
      sole = new T.Vector3(local.x, 0.005, local.z + 0.045);
    const contact = limb.end.worldToLocal(model.localToWorld(sole));
    return { q, contact };
  };
  const feet = { front: footBinding(front), rear: footBinding(rear) };
  // Palm center 6.2 rig units beyond wrist. Fingers point across the bar and curl
  // down around it; the target names refer to rider left (+X) and right (-X).
  const handContact = new T.Vector3(6.2, 0, 0),
    x = new T.Vector3(0, -0.16, 0.987117).normalize(),
    y = new T.Vector3(0, -0.987117, -0.16).normalize(),
    z = new T.Vector3().crossVectors(x, y).normalize();
  const handQ = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(x, y, z));
  let lastTargets: ScooterTargets | undefined,
    lastStationary = 0;
  const contactState: Record<string, { actual: T.Vector3; target: T.Vector3; error: number }> = {};
  const setWorldQ = (o: T.Object3D, q: T.Quaternion) => {
    o.quaternion.copy(o.parent!.getWorldQuaternion(new T.Quaternion()).invert().multiply(q));
    o.updateWorldMatrix(false, true);
  };
  const rotateWorld = (o: T.Object3D, axis: T.Vector3, angle: number) =>
    setWorldQ(
      o,
      new T.Quaternion()
        .setFromAxisAngle(axis, angle)
        .multiply(o.getWorldQuaternion(new T.Quaternion())),
    );
  const aim = (o: T.Object3D, child: T.Object3D, target: T.Vector3) => {
    const a = world(o),
      from = world(child).sub(a).normalize(),
      to = target.clone().sub(a).normalize();
    setWorldQ(
      o,
      new T.Quaternion()
        .setFromUnitVectors(from, to)
        .multiply(o.getWorldQuaternion(new T.Quaternion())),
    );
  };
  const solve = (
    limb: typeof left,
    target: T.Vector3,
    pole: T.Vector3,
    q: T.Quaternion,
    contact: T.Vector3,
    key: string,
  ) => {
    const scale = limb.end.getWorldScale(new T.Vector3());
    const endTarget = target.clone().sub(contact.clone().multiply(scale).applyQuaternion(q));
    const a = world(limb.upper),
      b = world(limb.lower),
      c = world(limb.end),
      ab = a.distanceTo(b),
      bc = b.distanceTo(c),
      direction = endTarget.clone().sub(a),
      rawDistance = direction.length();
    const distance = T.MathUtils.clamp(rawDistance, Math.abs(ab - bc) + 1e-5, ab + bc - 1e-5);
    direction.normalize();
    const poleDirection = pole
      .clone()
      .sub(a)
      .addScaledVector(direction, -pole.clone().sub(a).dot(direction));
    if (poleDirection.lengthSq() < 1e-9)
      poleDirection.set(0, 0, 1).addScaledVector(direction, -direction.z);
    poleDirection.normalize();
    const along = (ab * ab - bc * bc + distance * distance) / (2 * distance),
      off = Math.sqrt(Math.max(0, ab * ab - along * along));
    const elbow = a.clone().addScaledVector(direction, along).addScaledVector(poleDirection, off);
    aim(limb.upper, limb.lower, elbow);
    aim(limb.lower, limb.end, endTarget);
    setWorldQ(limb.end, q);
    const actual = limb.end.localToWorld(contact.clone());
    contactState[key] = { actual, target: target.clone(), error: actual.distanceTo(target) };
  };
  const restore = () => {
    if (!incoming) return;
    bones.forEach((o, i) => put(o, incoming![i]));
    incoming = null;
    lastWeight = 0;
    model.updateWorldMatrix(true, true);
  };
  const apply = ({ targets, weight, stationary = 0 }: ScooterPoseState) => {
    if (disposed) return;
    restore();
    const w = T.MathUtils.clamp(Number.isFinite(weight) ? weight : 0, 0, 1);
    if (w === 0) return;
    incoming = bones.map(save);
    bones.forEach((o, i) => put(o, stable[i]));
    model.updateWorldMatrix(true, true);
    const localPoint = (x: number, y: number, z: number) =>
      model.localToWorld(new T.Vector3(x, y, z));
    const stationaryWeight = T.MathUtils.clamp(Number(stationary), 0, 1);
    // A small hip adjustment plus a forward torso bend keeps the hat below the
    // unchanged collision cap without lifting the avatar's world-space root.
    const p = world(rigRoot).add(
      new T.Vector3(0, 0.015 - 0.09 * stationaryWeight, 0).applyQuaternion(
        model.getWorldQuaternion(new T.Quaternion()),
      ),
    );
    rigRoot.position.copy(rigRoot.parent!.worldToLocal(p));
    rigRoot.updateWorldMatrix(false, true);
    const worldX = new T.Vector3(1, 0, 0).applyQuaternion(
      model.getWorldQuaternion(new T.Quaternion()),
    );
    rotateWorld(spine1, worldX, 0.28);
    rotateWorld(spine2, worldX, 0.2);
    const f = targets.frontFoot.getWorldPosition(new T.Vector3()),
      r = targets.rearFoot.getWorldPosition(new T.Vector3());
    const basis = targets.frontFoot.getWorldQuaternion(new T.Quaternion());
    // The stationary shoe lies inside the .592m handlebar footprint; it is not a
    // hidden teleport of the physics body or an extra collider.
    const ground = r.clone().add(new T.Vector3(-0.19, -0.161, 0.07).applyQuaternion(basis));
    r.lerp(ground, stationaryWeight);
    solve(
      front,
      f,
      localPoint(0.1, 0.52, 0.5),
      basis.clone().multiply(feet.front.q),
      feet.front.contact,
      "frontFoot",
    );
    solve(
      rear,
      r,
      localPoint(-0.1, 0.5, 0.3),
      basis.clone().multiply(feet.rear.q),
      feet.rear.contact,
      "rearFoot",
    );
    solve(
      left,
      world(targets.leftGrip),
      localPoint(0.29, 1.0, -0.07),
      targets.leftGrip.getWorldQuaternion(new T.Quaternion()).multiply(handQ),
      handContact,
      "leftHand",
    );
    solve(
      right,
      world(targets.rightGrip),
      localPoint(-0.29, 1.0, -0.07),
      targets.rightGrip.getWorldQuaternion(new T.Quaternion()).multiply(handQ),
      handContact,
      "rightHand",
    );
    // Curl the existing fingers. They keep their original translations and mesh.
    for (const o of bones)
      if (/_Finger[1-4][0-2]?$/.test(o.name)) {
        const child = /Finger[1-4][12]$/.test(o.name);
        o.rotateZ(child ? 0.8 : 0.5);
      }
    bones.forEach((o, i) => {
      o.position.lerpVectors(incoming![i].position, o.position, w);
      const solvedQ = o.quaternion.clone();
      o.quaternion.copy(incoming![i].quaternion).slerp(solvedQ, w);
      o.scale.lerpVectors(incoming![i].scale, o.scale, w);
    });
    lastWeight = w;
    lastTargets = targets;
    lastStationary = stationaryWeight;
    model.updateWorldMatrix(true, true);
    for (const [key, limb, contact] of [
      ["leftHand", left, handContact],
      ["rightHand", right, handContact],
      ["frontFoot", front, feet.front.contact],
      ["rearFoot", rear, feet.rear.contact],
    ] as const) {
      const actual = limb.end.localToWorld(contact.clone());
      contactState[key].actual = actual;
      contactState[key].error = actual.distanceTo(contactState[key].target);
    }
  };
  return {
    apply,
    restore,
    diagnostics({ includeBounds = true }: { includeBounds?: boolean } = {}) {
      model.updateWorldMatrix(true, true);
      if (lastTargets && lastWeight > 0) {
        for (const [key, limb, contact, node] of [
          ["leftHand", left, handContact, lastTargets.leftGrip],
          ["rightHand", right, handContact, lastTargets.rightGrip],
          ["frontFoot", front, feet.front.contact, lastTargets.frontFoot],
          ["rearFoot", rear, feet.rear.contact, lastTargets.rearFoot],
        ] as const) {
          const actual = limb.end.localToWorld(contact.clone()),
            target = world(node);
          if (key === "rearFoot")
            target.add(
              new T.Vector3(-0.19, -0.161, 0.07)
                .multiplyScalar(lastStationary)
                .applyQuaternion(lastTargets.frontFoot.getWorldQuaternion(new T.Quaternion())),
            );
          contactState[key] = { actual, target, error: actual.distanceTo(target) };
        }
      }
      // Exact skinned bounds walk every animated vertex on the CPU. Ordinary
      // game snapshots only need contacts/joints; reserve this scan for an
      // explicit character-fit inspection instead of stalling each replay frame.
      const bounds = includeBounds ? new T.Box3().setFromObject(model, true) : null;
      return {
        weight: lastWeight,
        contacts: Object.fromEntries(
          Object.entries(lastWeight > 0 ? contactState : {}).map(([k, v]) => [
            k,
            { actual: v.actual.toArray(), target: v.target.toArray(), error: v.error },
          ]),
        ),
        bounds: bounds ? { min: bounds.min.toArray(), max: bounds.max.toArray() } : null,
        joints: Object.fromEntries(
          [left, right, front, rear]
            .flatMap((l) => [l.upper, l.lower, l.end])
            .map((o) => [o.name, world(o).toArray()]),
        ),
      };
    },
    dispose() {
      if (disposed) return;
      restore();
      disposed = true;
    },
  };
}
export type ScooterPose = ReturnType<typeof createScooterPose>;
