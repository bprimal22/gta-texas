import * as THREE from 'three';

// Preserve the photographs' baked lighting. A transparent shadow-only copy of
// nearby visible tile meshes adds the character's shadow on the exact surface.
// Geometry buffers are shared with the original tile, not duplicated or exported.
export class ContactShadow {
  readonly material = new THREE.ShadowMaterial({
    opacity: 0.38,
    depthWrite: false,
  });
  readonly receivers = new Map<THREE.Mesh, THREE.Mesh>();
  last = -Infinity;
  stats = {
    updates: 0,
    receiverMeshes: 0,
    triangles: 0,
    lastUpdateMs: 0,
    maxUpdateMs: 0,
    renderCalls: 0,
  };
  constructor(private nearbyMeshes: (position: THREE.Vector3) => THREE.Mesh[]) {
    this.material.polygonOffset = true;
    this.material.polygonOffsetFactor = -1;
    this.material.polygonOffsetUnits = -1;
  }
  update(position: THREE.Vector3, now: number) {
    if (now - this.last < 100) return;
    this.last = now;
    const began = performance.now(),
      wanted = new Set(this.nearbyMeshes(position));
    for (const [source, receiver] of this.receivers) {
      if (wanted.has(source)) continue;
      receiver.removeFromParent();
      this.receivers.delete(source);
    }
    let triangles = 0;
    for (const source of wanted) {
      let receiver = this.receivers.get(source);
      if (!receiver) {
        receiver = new THREE.Mesh(source.geometry, this.material);
        receiver.name = 'Character shadow on photographed ground';
        receiver.userData.campusShadowReceiver = true;
        receiver.receiveShadow = true;
        receiver.onAfterRender = () => {
          this.stats.renderCalls++;
        };
        // This overlay must never become a second ground/camera hit.
        receiver.raycast = () => {};
        source.add(receiver);
        this.receivers.set(source, receiver);
      }
      // A repair or streamed replacement may change the source geometry.
      receiver.geometry = source.geometry;
      // TilesGroup skips child matrix updates when its own transform is stable.
      // Newly added receivers otherwise stay at the origin despite being drawn.
      receiver.updateMatrixWorld(true);
      triangles +=
        (source.geometry.index?.count ??
          source.geometry.attributes.position.count) / 3;
    }
    this.stats.updates++;
    this.stats.receiverMeshes = this.receivers.size;
    this.stats.triangles = triangles;
    this.stats.lastUpdateMs = performance.now() - began;
    this.stats.maxUpdateMs = Math.max(
      this.stats.maxUpdateMs,
      this.stats.lastUpdateMs,
    );
  }
  dispose() {
    for (const receiver of this.receivers.values()) receiver.removeFromParent();
    this.receivers.clear();
    // Tile lifecycle owns the shared geometry. Only this material is ours.
    this.material.dispose();
  }
}
