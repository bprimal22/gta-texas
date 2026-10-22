import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function randomSource(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
}

// Branch hierarchy is shared by both foliage LODs, so their crown outlines agree.
// Broad, low-spreading forms are inspired by campus oaks, not scanned specimens.
export function oakAsset(variant: number) {
  const random = randomSource(981 + variant * 7381);
  const segments: THREE.BufferGeometry[] = [],
    tips: THREE.Vector3[] = [];
  function limb(
    points: THREE.Vector3[],
    radius: number,
    endRadius: number,
    radial = 7,
  ) {
    const curve = new THREE.CatmullRomCurve3(points);
    const steps = Math.max(4, Math.ceil(curve.getLength() * 1.5));
    const frames = curve.computeFrenetFrames(steps, false);
    const positions: number[] = [],
      uv: number[] = [],
      indices: number[] = [];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps,
        p = curve.getPointAt(t),
        r = THREE.MathUtils.lerp(radius, endRadius, t);
      for (let k = 0; k <= radial; k++) {
        const a = (k / radial) * Math.PI * 2;
        const surface = p
          .clone()
          .addScaledVector(frames.normals[s], Math.cos(a) * r)
          .addScaledVector(frames.binormals[s], Math.sin(a) * r);
        positions.push(surface.x, surface.y, surface.z);
        uv.push(
          (k / radial) * Math.max(0.2, radius * Math.PI * 2),
          t * curve.getLength(),
        );
        if (s < steps && k < radial) {
          const i = s * (radial + 1) + k;
          indices.push(
            i,
            i + 1,
            i + radial + 1,
            i + 1,
            i + radial + 2,
            i + radial + 1,
          );
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    segments.push(g);
  }
  const trunkTop = new THREE.Vector3(0.18, 3.6, -0.13);
  limb(
    [
      new THREE.Vector3(0, -0.2, 0),
      new THREE.Vector3(-0.12, 1.1, 0.08),
      new THREE.Vector3(0.1, 2.4, 0.04),
      trunkTop,
    ],
    0.54,
    0.26,
    11,
  );
  for (let i = 0; i < 7; i++) {
    const a = (i * Math.PI * 2) / 7 + random() * 0.3;
    limb(
      [
        new THREE.Vector3(Math.cos(a) * 1.1, 0.02, Math.sin(a) * 1.1),
        new THREE.Vector3(Math.cos(a) * 0.52, 0.16, Math.sin(a) * 0.52),
        new THREE.Vector3(0, 0.8, 0),
      ],
      0.025,
      0.24,
      6,
    );
  }
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI * 2) / 8 + random() * 0.6;
    const reach = 3.5 + random() * 1.7,
      end = new THREE.Vector3(
        Math.cos(angle) * reach,
        5.2 + random() * 1.8,
        Math.sin(angle) * reach,
      );
    const start = new THREE.Vector3(0.1, 2.3 + random() * 1.3, -0.05);
    const mid = start.clone().lerp(end, 0.52);
    mid.y -= 0.35;
    limb([start, mid, end], 0.24, 0.05);
    for (let j = 0; j < 5; j++) {
      const t = 0.45 + j * 0.105,
        branchStart = mid.clone().lerp(end, t);
      const direction = angle + (j % 2 ? 1 : -1) * (0.5 + random() * 0.65);
      const tip = branchStart
        .clone()
        .add(
          new THREE.Vector3(
            Math.cos(direction) * (1 + random() * 1.1),
            0.45 + random() * 1.35,
            Math.sin(direction) * (1 + random() * 1.1),
          ),
        );
      const bend = branchStart.clone().lerp(tip, 0.5);
      bend.y += 0.15;
      limb([branchStart, bend, tip], 0.055, 0.008, 5);
      tips.push(tip);
      for (let k = 0; k < 2; k++) {
        const twigStart = branchStart.clone().lerp(tip, 0.65),
          twigTip = tip
            .clone()
            .add(
              new THREE.Vector3(
                (random() - 0.5) * 1.2,
                0.4,
                (random() - 0.5) * 1.2,
              ),
            );
        limb([twigStart, twigTip], 0.018, 0.003, 4);
        tips.push(twigTip);
      }
    }
  }
  const branches = mergeGeometries(segments)!;
  segments.forEach((g) => g.dispose());
  const foliage = (count: number, size: number) => {
    const rand = randomSource(1503 + variant * 2729),
      pos: number[] = [],
      uv: number[] = [],
      norm: number[] = [],
      colors: number[] = [];
    // Sample the vein-bearing interior of one scanned leaf. The polygon supplies
    // its silhouette, keeping transparent atlas padding and other twigs out.
    const outline = [
      [0, 0.48],
      [0.15, 0.85],
      [0.5, 1],
      [0.83, 0.79],
      [1, 0.48],
      [0.77, 0.17],
      [0.38, 0],
      [0.11, 0.19],
    ];
    const q = new THREE.Quaternion(),
      leafNormal = new THREE.Vector3(),
      vertex = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const center = tips[i % tips.length];
      const theta = rand() * Math.PI * 2,
        radius = Math.sqrt(rand()) * (0.5 + rand() * 0.9),
        rise = (rand() - 0.5) * 1.5;
      const p = center
        .clone()
        .add(
          new THREE.Vector3(
            Math.cos(theta) * radius,
            rise,
            Math.sin(theta) * radius,
          ),
        );
      q.setFromEuler(
        new THREE.Euler(
          (rand() - 0.5) * 2.6,
          rand() * Math.PI * 2,
          (rand() - 0.5) * 2,
        ),
      );
      leafNormal.set(0, 1, 0).applyQuaternion(q);
      // Blend leaf normals toward the crown envelope to avoid harsh flat-card shading.
      leafNormal
        .lerp(
          p
            .clone()
            .sub(new THREE.Vector3(0, 4, 0))
            .normalize(),
          0.65,
        )
        .normalize();
      const scale = size * (0.8 + rand() * 0.5),
        tint = 0.62 + rand() * 0.38;
      for (let j = 1; j < outline.length - 1; j++)
        for (const k of [0, j, j + 1]) {
          const [u, v] = outline[k];
          vertex
            .set(
              (u - 0.5) * scale,
              (0.5 - Math.abs(u - 0.5)) * 0.025,
              (v - 0.5) * scale * 0.47,
            )
            .applyQuaternion(q)
            .add(p);
          pos.push(vertex.x, vertex.y, vertex.z);
          norm.push(leafNormal.x, leafNormal.y, leafNormal.z);
          uv.push(0.27 + u * 0.055, 1 - (0.305 + v * 0.035));
          colors.push(tint * 0.88, tint, tint * 0.79);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return g;
  };
  return { branches, near: foliage(9500, 0.3), mid: foliage(2400, 0.49) };
}

export async function foliageMaterial(renderer: THREE.WebGLRenderer) {
  const texture = await new THREE.TextureLoader().loadAsync(
    '/assets/broadleaf-diff.jpg',
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return new THREE.MeshStandardMaterial({
    map: texture,
    color: 0xffffff,
    side: THREE.DoubleSide,
    vertexColors: true,
    roughness: 0.86,
    envMapIntensity: 0.55,
  });
}

export function treeImpostor(
  renderer: THREE.WebGLRenderer,
  asset: ReturnType<typeof oakAsset>,
  leaf: THREE.Material,
  bark: THREE.Material,
) {
  const scene = new THREE.Scene(),
    tree = new THREE.Group();
  tree.add(
    new THREE.Mesh(asset.branches, bark),
    new THREE.Mesh(asset.near, leaf),
  );
  scene.add(tree);
  scene.add(new THREE.HemisphereLight(0xc9e7ff, 0x665e44, 1.5));
  const sun = new THREE.DirectionalLight(0xfff0d6, 2.8);
  sun.position.set(8, 12, 5);
  scene.add(sun);
  const camera = new THREE.OrthographicCamera(-9, 9, 6, -6, 0.1, 60);
  camera.position.set(20, 6, 0);
  camera.lookAt(0, 5, 0);
  const target = new THREE.WebGLRenderTarget(512, 512, {
    minFilter: THREE.LinearMipmapLinearFilter,
    generateMipmaps: true,
  });
  target.texture.colorSpace = THREE.SRGBColorSpace;
  const previous = renderer.getRenderTarget(),
    clear = renderer.getClearColor(new THREE.Color()),
    alpha = renderer.getClearAlpha();
  renderer.setClearColor(0, 0);
  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(previous);
  renderer.setClearColor(clear, alpha);
  const material = new THREE.MeshBasicMaterial({
    map: target.texture,
    alphaTest: 0.35,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const a = new THREE.PlaneGeometry(18, 12);
  a.translate(0, 5, 0);
  const b = a.clone().rotateY(Math.PI / 2);
  const geometry = mergeGeometries([a, b])!;
  a.dispose();
  b.dispose();
  return { geometry, material, target };
}
