import * as THREE from 'three';

const MAGIC = 0x55544752;
const HEADER_BYTES = 20;

/** Decode the locally baked contour terrain. This is the same position buffer
 * used by the render mesh and the caller's trimesh collider. Materials are borrowed. */
export function decodeOfflineTerrain(buffer: ArrayBuffer, material: THREE.Material) {
  const start = performance.now();
  if (buffer.byteLength < HEADER_BYTES) throw new Error('Truncated local terrain header');
  const header = new DataView(buffer);
  if (header.getUint32(0, true) !== MAGIC || header.getUint32(4, true) !== 1) {
    throw new Error('Unsupported local terrain format');
  }
  const count = header.getUint32(8, true);
  if (!count || count % 3 || count > 6_000_000 || buffer.byteLength !== HEADER_BYTES + count * 20) {
    throw new Error('Invalid local terrain geometry length');
  }
  const positions = new Float32Array(buffer, HEADER_BYTES, count * 3);
  const uvs = new Float32Array(buffer, HEADER_BYTES + count * 12, count * 2);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Offline local contour terrain';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  let disposed = false;
  return {
    mesh,
    meshes: [mesh],
    colliderGeometries: [geometry],
    materials: [] as THREE.Material[],
    stats: {
      local: true, baked: true, triangles: count / 3, drawCalls: 1,
      baseTriangles: header.getUint32(12, true), clearance: header.getFloat32(16, true),
      decodeMs: performance.now() - start,
    },
    dispose() { if (!disposed) { disposed = true; geometry.dispose(); } },
  };
}

/** One same-origin file, no provider or tile service. The bake manifest records
 * the authored floor inputs; rebuild it when those floor footprints change. */
export async function loadOfflineTerrain(material: THREE.Material,
  url = '/assets/campus/offline-terrain-61.bin.gz?v=22adb2250b7b') {
  if (!url.startsWith('/') || url.startsWith('//')) throw new Error('Local terrain must use a same-origin absolute path');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Local terrain load failed: ${response.status}`);
  const zipped = await response.arrayBuffer();
  const bytes = new Uint8Array(zipped);
  const buffer = bytes[0] === 0x1f && bytes[1] === 0x8b
    ? await new Response(new Blob([zipped]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
    : zipped; // Servers may apply Content-Encoding and transparently decompress.
  return decodeOfflineTerrain(buffer, material);
}
