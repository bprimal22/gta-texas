import * as T from 'three';

type SurfaceMaterials = Record<'asphalt' | 'concrete' | 'speedway', T.MeshStandardMaterial>;
const names = ['asphalt', 'concrete', 'speedway'] as const;
const headerBytes = 24;

/** Surface finishes clipped to the exact baked terrain. These meshes are visual
 * only: the existing terrain remains the sole physical ground. No raised slabs,
 * invisible second floors or expensive duplicate scooter indices are introduced.
 */
export function decodeLocalSurfaces(buffer: ArrayBuffer, source: SurfaceMaterials) {
  const start = performance.now();
  if (buffer.byteLength < headerBytes) throw Error('Truncated local surface header');
  const header = new DataView(buffer);
  if (header.getUint32(0, true) !== 0x55545053 || header.getUint32(4, true) !== 1)
    throw Error('Unsupported local surface format');
  const counts = names.map((_, i) => header.getUint32(8 + i * 4, true));
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total || total > 6_000_000 || counts.some(n => n % 3) || buffer.byteLength !== headerBytes + total * 20)
    throw Error('Invalid local surface geometry length');
  const group = new T.Group();
  group.name = 'Local mapped road and path finishes';
  const materials: T.MeshStandardMaterial[] = [];
  const geometries: T.BufferGeometry[] = [];
  let offset = headerBytes;
  for (let i = 0; i < names.length; i++) {
    const count = counts[i];
    if (!count) continue;
    const vertices = new T.InterleavedBuffer(new Float32Array(buffer, offset, count * 5), 5);
    offset += count * 20;
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.InterleavedBufferAttribute(vertices, 3, 0));
    geometry.setAttribute('uv', new T.InterleavedBufferAttribute(vertices, 2, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const borrowed = source[names[i]], material = borrowed.clone();
    // Material.clone deliberately omits shader hooks. Preserve Speedway's exact
    // golden-brick remapping so the continuation has the same finish.
    material.onBeforeCompile = (shader, renderer) => borrowed.onBeforeCompile.call(material, shader, renderer);
    material.customProgramCacheKey = () => borrowed.customProgramCacheKey();
    material.name = `Local mapped ${names[i]} surface`;
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1;
    material.polygonOffsetUnits = -1;
    const mesh = new T.Mesh(geometry, material);
    mesh.name = material.name;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.renderOrder = 1;
    group.add(mesh);
    geometries.push(geometry);
    materials.push(material);
  }
  let disposed = false;
  return {
    group,
    stats: { triangles: total / 3, drawCalls: group.children.length, decodeMs: performance.now() - start,
      terrainVersion: '22adb2250b7b', collisionSurfacesAdded: 0,
      finishes: Object.fromEntries(names.map((n, i) => [n, counts[i] / 3])) },
    // Textures are borrowed from the shared campus materials and stay alive.
    dispose() { if (!disposed) { disposed = true; geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); } },
  };
}

export async function loadLocalSurfaces(materials: SurfaceMaterials,
  url = '/assets/campus/local-surfaces-61.bin.gz?v=727725306bc3') {
  if (!url.startsWith('/') || url.startsWith('//')) throw Error('Local surfaces require a same-origin path');
  const response = await fetch(url);
  if (!response.ok) throw Error(`Local surface load failed: ${response.status}`);
  const zipped = await response.arrayBuffer(), bytes = new Uint8Array(zipped);
  const buffer = bytes[0] === 0x1f && bytes[1] === 0x8b
    ? await new Response(new Blob([zipped]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
    : zipped;
  return decodeLocalSurfaces(buffer, materials);
}
