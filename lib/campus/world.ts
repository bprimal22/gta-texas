import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CampusData, Point, Building } from './types';
import { Terrain } from './terrain';
import type { Materials } from './materials';
import { oakAsset, foliageMaterial, treeImpostor } from './vegetation';
import { buildTower, landmarkFacade } from './landmarks';

export class CampusWorld {
  group = new THREE.Group();
  details: {
    object: THREE.Object3D;
    x: number;
    z: number;
    near?: number;
    far?: number;
  }[] = [];
  stairCount = 0;
  treeCount = 0;
  mappedTreeCount = 0;
  disposed = false;
  treeTargets: THREE.WebGLRenderTarget[] = [];
  colliders = 0;
  private batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  constructor(
    public data: CampusData,
    public terrain: Terrain,
    private physics: RAPIER.World,
    private materialSource: Materials | (() => Materials),
    private renderer: THREE.WebGLRenderer,
  ) {}
  get mat(): Materials {
    if (typeof this.materialSource === 'function')
      this.materialSource = this.materialSource();
    return this.materialSource;
  }
  get loadedMaterials(): Materials | undefined {
    return typeof this.materialSource === 'function'
      ? undefined
      : this.materialSource;
  }
  addMesh(g: THREE.BufferGeometry, m: THREE.Material, collision = false) {
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    if (collision) this.collider(g);
    return mesh;
  }
  collider(g: THREE.BufferGeometry) {
    const index =
      g.index?.array ||
      Uint32Array.from({ length: g.attributes.position.count }, (_, i) => i);
    this.physics.createCollider(
      RAPIER.ColliderDesc.trimesh(
        new Float32Array(g.attributes.position.array),
        new Uint32Array(index),
      ).setFriction(0.8),
    );
    this.colliders++;
  }
  box(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    m: THREE.Material,
    collision = false,
    angle = 0,
  ) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.rotateY(angle);
    g.translate(x, y, z);
    if (collision) this.collider(g);
    this.batch(g, m);
  }
  batch(g: THREE.BufferGeometry, m: THREE.Material) {
    const list = this.batches.get(m) || [];
    list.push(g);
    this.batches.set(m, list);
  }
  flush() {
    // Spatial batches keep draw calls down without making every campus block visible.
    for (const [mat, geos] of this.batches) {
      const chunks = new Map<string, THREE.BufferGeometry[]>();
      for (const g of geos) {
        g.computeBoundingBox();
        const c = g.boundingBox!.getCenter(new THREE.Vector3()),
          key = `${Math.floor(c.x / 120)},${Math.floor(c.z / 120)}`;
        const a = chunks.get(key) || [];
        a.push(g);
        chunks.set(key, a);
      }
      for (const a of chunks.values()) {
        const merged = mergeGeometries(a, false);
        if (merged) {
          const mesh = this.addMesh(merged, mat);
          if (mat === this.mat.glass) {
            mesh.castShadow = false;
            merged.computeBoundingBox();
            const c = merged.boundingBox!.getCenter(new THREE.Vector3());
            this.details.push({ object: mesh, x: c.x, z: c.z, far: 520 });
          }
        }
        a.forEach((g) => g.dispose());
      }
    }
    this.batches.clear();
  }
  async build() {
    const terrainMesh = this.addMesh(
      this.terrain.geometry(),
      this.mat.grass,
      true,
    );
    terrainMesh.castShadow = false;
    for (const b of this.data.buildings) this.building(b);
    this.paths();
    this.stairs();
    buildTower(this);
    this.stadium();
    await this.trees();
    if (this.disposed) return;
    this.flush();
    this.physics.step();
  }
  building(b: Building) {
    const shape = new THREE.Shape(
      b.rings[0].map(([x, z]) => new THREE.Vector2(x, -z)),
    );
    for (const ring of b.rings.slice(1))
      shape.holes.push(
        new THREE.Path(ring.map(([x, z]) => new THREE.Vector2(x, -z))),
      );
    let low = Infinity,
      high = -Infinity;
    b.rings[0].forEach(([x, z]) => {
      const y = this.terrain.height(x, z);
      low = Math.min(low, y);
      high = Math.max(high, y);
    });
    if (b.abbr === 'GDC') b.h = 26;
    if (b.abbr === 'PCL') {
      b.h = 27;
      // PCL's second-floor entrance faces the Speedway/21st Street plaza.
      // Using the highest corner of this sloping footprint raised every window
      // several meters above that plaza. Anchor the level rhythm to its east
      // entry-side footprint corner; exact finished-floor elevations are pending.
      high = this.terrain.height(-78.51, 342.14) + 0.4;
    }
    const base = low - 0.4,
      height = b.h + high - low;
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: height,
      bevelEnabled: false,
      steps: 1,
      curveSegments: 1,
      UVGenerator: {
        generateTopUV: (_g, v, a, b, c) =>
          [a, b, c].map(
            (i) => new THREE.Vector2(v[i * 3] / 4, v[i * 3 + 1] / 4),
          ),
        generateSideWallUV: (_g, v, a, b, c, d) => {
          const axis =
            Math.abs(v[a * 3] - v[b * 3]) >
            Math.abs(v[a * 3 + 1] - v[b * 3 + 1])
              ? 0
              : 1;
          return [a, b, c, d].map(
            (i) => new THREE.Vector2(v[i * 3 + axis] / 2, v[i * 3 + 2] / 2),
          );
        },
      },
    });
    g.rotateX(-Math.PI / 2);
    g.translate(0, base, 0);
    this.collider(g);
    const masonry =
      b.abbr === 'PCL'
        ? this.mat.pclConcrete
        : b.abbr === 'GDC'
          ? this.mat.gdcBrick
          : ['EER', 'WCP', 'GLT'].includes(b.abbr)
            ? this.mat.brick
            : this.mat.stone;
    const mesh = this.addMesh(g, [
      this.mat.roof,
      masonry,
    ] as unknown as THREE.Material);
    mesh.name = b.name || `Building ${b.id}`;
    if (landmarkFacade(this, b, high)) return;
    // First-pass window rhythm. Surveyed facade modules will replace these.
    const floor = b.abbr === 'GDC' ? 4.3 : 3.8;
    const ring = b.rings[0];
    let area = 0;
    for (let j = 0; j < ring.length - 1; j++)
      area += ring[j][0] * ring[j + 1][1] - ring[j + 1][0] * ring[j][1];
    for (let j = 0; j < ring.length - 1; j++) {
      const [ax, az] = ring[j],
        [bx, bz] = ring[j + 1],
        dx = bx - ax,
        dz = bz - az,
        len = Math.hypot(dx, dz);
      if (len < 4 || b.h < 5) continue;
      const angle = Math.atan2(-dz, dx),
        sign = area > 0 ? 1 : -1,
        ox = (dz / len) * sign * 0.06,
        oz = (-dx / len) * sign * 0.06;
      const isGdc = b.abbr === 'GDC',
        n = Math.floor(len / (isGdc ? 4.3 : 3.7)),
        floors = isGdc ? 6 : Math.min(24, Math.floor((b.h - 1.3) / floor));
      if (isGdc) {
        for (let f = 0; f <= 6; f++)
          this.box(
            (ax + bx) / 2 + ox,
            high + f * 4.3 + 0.18,
            (az + bz) / 2 + oz,
            len + 0.25,
            0.23,
            0.38,
            this.mat.trim,
            false,
            angle,
          );
        this.box(
          (ax + bx) / 2,
          high + 26.15,
          (az + bz) / 2,
          len + 3.7,
          0.4,
          3.8,
          this.mat.trim,
          false,
          angle,
        );
      }
      for (let s = 0; s < n; s++)
        for (let f = 0; f < floors; f++) {
          const t = (s + 0.5) / n,
            x = ax + dx * t + ox,
            z = az + dz * t + oz,
            y = high + (isGdc ? 0.85 : 1.5) + f * floor + (isGdc ? 1.4 : 1.1),
            ww = Math.min(isGdc ? 3.55 : 2, (len / n) * (isGdc ? 0.84 : 0.64)),
            hh = isGdc ? 2.9 : 2.15;
          this.box(x, y, z, ww, hh, 0.12, this.mat.glass, false, angle);
          if (isGdc) {
            const edge = (
              off: number,
              yy: number,
              w: number,
              h: number,
              depth: number,
              mat: THREE.Material,
            ) =>
              this.box(
                x + (dx / len) * off,
                y + yy,
                z + (dz / len) * off,
                w,
                h,
                depth,
                mat,
                false,
                angle,
              );
            edge(-ww / 2, 0, 0.17, hh + 0.2, 0.29, this.mat.trim);
            edge(ww / 2, 0, 0.17, hh + 0.2, 0.29, this.mat.trim);
            edge(0, 0, 0.045, hh, 0.24, this.mat.metal);
            edge(0, -hh / 2, ww + 0.2, 0.14, 0.4, this.mat.trim);
            for (let sl = 0; sl < 5; sl++)
              edge(
                0,
                hh / 2 - 0.1 + sl * 0.07,
                ww + 0.2,
                0.035,
                0.65,
                this.mat.metal,
              );
          }
        }
    }
  }
  paths() {
    const lists = new Map<
      string,
      { pos: number[]; uv: number[]; ind: number[] }
    >();
    for (const path of this.data.paths) {
      const walk = [
          'footway',
          'path',
          'pedestrian',
          'steps',
          'cycleway',
        ].includes(path.kind),
        key =
          path.name === 'Speedway' && walk
            ? 'paving'
            : walk
              ? 'concrete'
              : 'asphalt';
      const list = lists.get(key) || { pos: [], uv: [], ind: [] };
      let traveled = 0;
      for (let i = 1; i < path.points.length; i++) {
        const [ax, az] = path.points[i - 1],
          [bx, bz] = path.points[i],
          dx = bx - ax,
          dz = bz - az,
          len = Math.hypot(dx, dz);
        if (len < 0.02) continue;
        const segments = Math.ceil(len / 3),
          px = ((-dz / len) * path.width) / 2,
          pz = ((dx / len) * path.width) / 2;
        for (let j = 0; j < segments; j++) {
          const t0 = j / segments,
            t1 = (j + 1) / segments;
          const coords = [
            [ax + dx * t0 + px, az + dz * t0 + pz],
            [ax + dx * t0 - px, az + dz * t0 - pz],
            [ax + dx * t1 + px, az + dz * t1 + pz],
            [ax + dx * t1 - px, az + dz * t1 - pz],
          ];
          const idx = list.pos.length / 3;
          for (const [x, z] of coords) {
            list.pos.push(
              x,
              this.terrain.height(x, z) +
                (key === 'paving' ? 0.042 : walk ? 0.036 : 0.028),
              z,
            );
            list.uv.push(x / 2, z / 2);
          }
          list.ind.push(idx, idx + 2, idx + 1, idx + 1, idx + 2, idx + 3);
        }
        traveled += len;
      }
      lists.set(key, list);
    }
    for (const [key, l] of lists) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(l.pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(l.uv, 2));
      g.setIndex(l.ind);
      g.computeVertexNormals();
      const m = this.addMesh(g, this.mat[key as keyof Materials]);
      m.castShadow = false;
    }
  }
  stairs() {
    for (const path of this.data.paths.filter((p) => p.kind === 'steps'))
      for (let j = 1; j < path.points.length; j++) {
        let a = path.points[j - 1],
          b = path.points[j],
          ya = this.terrain.height(...a),
          yb = this.terrain.height(...b);
        if (ya > yb) {
          [a, b] = [b, a];
          [ya, yb] = [yb, ya];
        }
        const rise = yb - ya,
          dx = b[0] - a[0],
          dz = b[1] - a[1],
          len = Math.hypot(dx, dz);
        if (rise < 0.32 || len < 0.5 || rise / len > 0.8) continue;
        const n = Math.min(120, Math.ceil(rise / 0.16), Math.floor(len / 0.25)),
          angle = Math.atan2(-dz, dx);
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n,
            x = a[0] + dx * t,
            z = a[1] + dz * t,
            top = ya + (rise * (i + 1)) / n + 0.04,
            bottom = ya - 0.6;
          this.box(
            x,
            (top + bottom) / 2,
            z,
            len / n + 0.025,
            top - bottom,
            path.width,
            this.mat.concrete,
            true,
            angle,
          );
        }
        this.stairCount++;
      }
  }

  stadium() {
    const [x, z] = this.data.landmarks.STD.position,
      y = this.terrain.height(x, z) - 1,
      a = 0.085;
    const place = (
      ox: number,
      oz: number,
      w: number,
      d: number,
      h: number,
      mat: THREE.Material,
    ) =>
      this.box(
        x + ox * Math.cos(a) + oz * Math.sin(a),
        y + h / 2,
        z - ox * Math.sin(a) + oz * Math.cos(a),
        w,
        h,
        d,
        mat,
        true,
        a,
      );
    place(0, 0, 54, 110, 0.3, this.mat.grass);
    for (let t = 0; t < 15; t++) {
      place(
        -33 - t * 2.2,
        0,
        3.1,
        148 + t * 1.6,
        3 + t * 2.5,
        this.mat.concrete,
      );
      place(
        33 + t * 2.2,
        0,
        3.1,
        148 + t * 1.6,
        3 + t * 2.5,
        this.mat.concrete,
      );
      place(0, -62 - t * 2.1, 63 + t * 4.4, 3, 3 + t * 2.15, this.mat.stone);
      place(0, 62 + t * 1.8, 63 + t * 4.4, 3, 3 + t * 1.5, this.mat.brick);
    }
    place(-69, 0, 13, 134, 49, this.mat.stone);
  }
  async trees() {
    // Temporary vegetation distribution along pedestrian routes; not a tree survey.
    const positions: Point[] = [];
    const cells = new Set<string>();
    const within = (x: number, z: number, b: Building) => {
      let c = false;
      const p = b.rings[0];
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        if (
          p[i][1] > z !== p[j][1] > z &&
          x <
            ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) +
              p[i][0]
        )
          c = !c;
      }
      return c;
    };
    for (const tree of this.data.trees || []) {
      const [x, z] = tree.position;
      if (Math.abs(x) > 1000 || Math.abs(z) > 1000) continue;
      if (
        this.data.buildings.some(
          (b) =>
            Math.hypot(b.center[0] - x, b.center[1] - z) < 150 &&
            within(x, z, b),
        )
      )
        continue;
      positions.push([x, z]);
      cells.add(`${Math.round(x / 18)},${Math.round(z / 18)}`);
    }
    this.mappedTreeCount = positions.length;
    const mappedPositions = positions.slice();
    // Other footways may cross a candidate's source path. Keep generated trunks
    // out of every mapped walking/driving corridor, not just their source path.
    type Corridor = {
      ax: number;
      az: number;
      dx: number;
      dz: number;
      length2: number;
      radius: number;
    };
    const corridorCells = new Map<string, Corridor[]>();
    for (const path of this.data.paths)
      for (let i = 1; i < path.points.length; i++) {
        const [ax, az] = path.points[i - 1],
          [bx, bz] = path.points[i];
        const c = {
          ax,
          az,
          dx: bx - ax,
          dz: bz - az,
          length2: (bx - ax) ** 2 + (bz - az) ** 2,
          radius: path.width / 2 + 1.2,
        };
        if (c.length2 < 0.001) continue;
        for (
          let x = Math.floor((Math.min(ax, bx) - c.radius) / 32);
          x <= Math.floor((Math.max(ax, bx) + c.radius) / 32);
          x++
        )
          for (
            let z = Math.floor((Math.min(az, bz) - c.radius) / 32);
            z <= Math.floor((Math.max(az, bz) + c.radius) / 32);
            z++
          ) {
            const key = `${x},${z}`,
              list = corridorCells.get(key) || [];
            list.push(c);
            corridorCells.set(key, list);
          }
      }
    const inCorridor = (x: number, z: number) =>
      (
        corridorCells.get(`${Math.floor(x / 32)},${Math.floor(z / 32)}`) || []
      ).some((c) => {
        const t = THREE.MathUtils.clamp(
          ((x - c.ax) * c.dx + (z - c.az) * c.dz) / c.length2,
          0,
          1,
        );
        return Math.hypot(x - c.ax - t * c.dx, z - c.az - t * c.dz) < c.radius;
      });
    const eligible = this.data.paths.filter(
      (p) => p.name === 'Speedway' || p.kind === 'footway',
    );
    for (const path of eligible)
      for (let i = 1; i < path.points.length; i++) {
        const [ax, az] = path.points[i - 1],
          [bx, bz] = path.points[i],
          dx = bx - ax,
          dz = bz - az,
          len = Math.hypot(dx, dz);
        for (let d = 7; d < len; d += 22)
          for (const sign of [-1, 1]) {
            const x =
                ax +
                (dx * d) / len -
                (dz / len) * (path.width / 2 + 3.5) * sign,
              z =
                az +
                (dz * d) / len +
                (dx / len) * (path.width / 2 + 3.5) * sign;
            if (Math.abs(x) > 1000 || Math.abs(z) > 1000 || inCorridor(x, z))
              continue;
            const key = `${Math.round(x / 18)},${Math.round(z / 18)}`;
            if (
              cells.has(key) ||
              mappedPositions.some((p) => Math.hypot(p[0] - x, p[1] - z) < 12)
            )
              continue;
            if (
              this.data.buildings.some(
                (b) =>
                  Math.hypot(b.center[0] - x, b.center[1] - z) < 150 &&
                  within(x, z, b),
              )
            )
              continue;
            cells.add(key);
            positions.push([x, z]);
          }
      }
    this.treeCount = positions.length;
    const buckets = new Map<string, { points: Point[]; variant: number }>();
    for (const p of positions) {
      const variant = Math.abs(Math.round(p[0] * 19 + p[1] * 7)) % 3;
      const key = `${Math.floor(p[0] / 55)},${Math.floor(p[1] / 55)},${variant}`;
      const bucket = buckets.get(key) || { points: [], variant };
      bucket.points.push(p);
      buckets.set(key, bucket);
    }
    const leafMaterial = await foliageMaterial(this.renderer);
    if (this.disposed) {
      leafMaterial.map?.dispose();
      leafMaterial.dispose();
      return;
    }
    const assets = [0, 1, 2].map(oakAsset);
    const impostors = assets.map((asset) =>
      treeImpostor(this.renderer, asset, leafMaterial, this.mat.bark),
    );
    this.treeTargets.push(...impostors.map((i) => i.target));
    const o = new THREE.Object3D();
    for (const { points, variant } of buckets.values()) {
      const asset = assets[variant],
        impostor = impostors[variant];
      const trunk = new THREE.InstancedMesh(
        asset.branches,
        this.mat.bark,
        points.length,
      );
      const near = new THREE.InstancedMesh(
        asset.near,
        leafMaterial,
        points.length,
      );
      const mid = new THREE.InstancedMesh(
        asset.mid,
        leafMaterial,
        points.length,
      );
      const far = new THREE.InstancedMesh(
        impostor.geometry,
        impostor.material,
        points.length,
      );
      points.forEach(([x, z], i) => {
        const y = this.terrain.height(x, z),
          r = 1 + Math.sin(x * 43 + z) * 0.18;
        o.position.set(x, y, z);
        o.rotation.set(0, x * 1.7, 0);
        o.scale.set(r, r * (1 + 0.09 * Math.sin(z)), r);
        o.updateMatrix();
        for (const mesh of [trunk, near, mid, far])
          mesh.setMatrixAt(i, o.matrix);
        this.physics.createCollider(
          RAPIER.ColliderDesc.cylinder(2.2, 0.54 * r).setTranslation(
            x,
            y + 2.2,
            z,
          ),
        );
        this.colliders++;
      });
      near.castShadow = mid.castShadow = trunk.castShadow = true;
      near.receiveShadow = mid.receiveShadow = trunk.receiveShadow = true;
      this.group.add(trunk, near, mid, far);
      const x = points.reduce((sum, p) => sum + p[0], 0) / points.length;
      const z = points.reduce((sum, p) => sum + p[1], 0) / points.length;
      this.details.push(
        { object: near, x, z, far: 95 },
        { object: mid, x, z, near: 95, far: 230 },
        { object: trunk, x, z, far: 230 },
        { object: far, x, z, near: 230, far: 850 },
      );
    }
  }

  disposePendingResources() {
    this.disposed = true;
    for (const list of this.batches.values()) list.forEach((g) => g.dispose());
    this.batches.clear();
    this.treeTargets.forEach((target) => target.dispose());
    this.treeTargets.length = 0;
  }
  update(x: number, z: number) {
    for (const item of this.details) {
      const d = Math.hypot(item.x - x, item.z - z);
      item.object.visible = d < (item.far || Infinity) && d >= (item.near || 0);
    }
  }
}
