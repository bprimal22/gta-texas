import * as T from 'three';
import type { TreeForm } from './oak-forms';
import type { TreeMaterials } from './tree-materials';

export interface PlacedTree { x: number; y: number; z: number; rotation: number; scale: number; form: number; tint: number }
export interface LodDistances { near: number; mid: number; far: number; max: number }
export const AUTHORED_LODS: LodDistances = { near: 40, mid: 105, far: 240, max: 1500 };
export const CANOPY_LODS: LodDistances = { near: 32, mid: 85, far: 190, max: 1500 };

/** Impostor atlas: per form a side tile and a top tile (crossed vertical
 * quads + one horizontal quad), rendered once at load from the mid LOD with
 * unlit albedo; the impostor material is lit like the real crowns. */
export interface ImpostorSet { material: T.MeshStandardMaterial; geometries: T.BufferGeometry[]; target: T.WebGLRenderTarget }

function impostorLayout(forms: TreeForm[]) {
  const cols = 4, rows = Math.ceil(forms.length * 2 / cols);
  const boxes = forms.map(form => {
    const box = new T.Box3();
    for (const g of [form.lods[1].wood, form.lods[1].foliage]) { g.computeBoundingBox(); box.union(g.boundingBox!); }
    const ext = Math.max(Math.abs(box.min.x), box.max.x, Math.abs(box.min.z), box.max.z) * 1.02;
    return { box, ext, size: Math.max(2 * ext, box.max.y * 1.02) };
  });
  return { cols, rows, boxes };
}

/** Crossed side quads + one top quad per form, UV-mapped into the atlas. */
function impostorGeometries(forms: TreeForm[]) {
  const { cols, rows, boxes } = impostorLayout(forms);
  return forms.map((_, i) => {
    const { box, ext, size } = boxes[i];
    const u = (t: number) => [(t % cols) / cols, Math.floor(t / cols) / rows, 1 / cols, 1 / rows];
    const [su, sv, sw, sh] = u(i * 2), [tu, tv, tw, th] = u(i * 2 + 1);
    const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
    const quad = (corners: number[][], uvs: number[][], n: number[]) => {
      const b = pos.length / 3;
      for (let c = 0; c < 4; c++) { pos.push(...corners[c]); nor.push(...n); uv.push(...uvs[c]); col.push(1, 1, 1); }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    };
    const s = size / 2, sideUv = [[su, sv], [su + sw, sv], [su + sw, sv + sh], [su, sv + sh]];
    const lift = [0, .75, .66];
    quad([[-s, 0, 0], [s, 0, 0], [s, size, 0], [-s, size, 0]], sideUv, lift);
    quad([[0, 0, s], [0, 0, -s], [0, size, -s], [0, size, s]], sideUv, lift);
    const ty = box.max.y * .62;
    quad([[-ext, ty, ext], [ext, ty, ext], [ext, ty, -ext], [-ext, ty, -ext]], [[tu, tv], [tu + tw, tv], [tu + tw, tv + th], [tu, tv + th]], [0, 1, 0]);
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  });
}

function impostorMaterial(texture: T.Texture) {
  return new T.MeshStandardMaterial({ name: 'Tree impostor (baked from procedural forms)', map: texture, alphaTest: .45,
    side: T.DoubleSide, vertexColors: true, roughness: .9, metalness: 0 });
}

/** Geometry-only impostors (headless checks): same LOD switching and counts. */
export function headlessImpostors(forms: TreeForm[]): ImpostorSet {
  const target = new T.WebGLRenderTarget(1, 1);
  return { material: impostorMaterial(target.texture), geometries: impostorGeometries(forms), target };
}

export function bakeImpostors(renderer: T.WebGLRenderer, forms: TreeForm[], materials: TreeMaterials, tile = 256): ImpostorSet | null {
  if (typeof renderer?.render !== 'function') return null;
  const { cols, rows, boxes } = impostorLayout(forms);
  const target = new T.WebGLRenderTarget(tile * cols, tile * rows, { generateMipmaps: true, minFilter: T.LinearMipmapLinearFilter, magFilter: T.LinearFilter });
  target.texture.colorSpace = T.SRGBColorSpace;
  const basic = (m: T.MeshStandardMaterial) => new T.MeshBasicMaterial({ map: m.map, color: m.color.clone().multiplyScalar(.92), vertexColors: true, alphaTest: m.alphaTest, side: m.side });
  const bark = basic(materials.bark), leaf = basic(materials.foliage);
  const previous = renderer.getRenderTarget(), clear = renderer.getClearColor(new T.Color()), alpha = renderer.getClearAlpha();
  const toneMapping = renderer.toneMapping;
  renderer.toneMapping = T.NoToneMapping;
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x34402a, 0); renderer.clear();
  target.scissorTest = true;
  forms.forEach((form, i) => {
    const scene = new T.Scene();
    scene.add(new T.Mesh(form.lods[1].wood, bark), new T.Mesh(form.lods[1].foliage, leaf));
    const { ext, size } = boxes[i];
    // Side view (looking toward -Z), base at y = 0; top view looking down.
    const side = new T.OrthographicCamera(-size / 2, size / 2, size, 0, .1, 200);
    side.position.set(0, 0, 100); side.lookAt(0, 0, 0);
    const top = new T.OrthographicCamera(-ext, ext, ext, -ext, .1, 300);
    top.position.set(0, 150, 0); top.up.set(0, 0, -1); top.lookAt(0, 0, 0);
    for (const [k, camera] of [[0, side], [1, top]] as const) {
      const t = i * 2 + k, x = (t % cols) * tile, y = Math.floor(t / cols) * tile;
      target.viewport.set(x, y, tile, tile); target.scissor.set(x, y, tile, tile);
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
    }
  });
  target.scissorTest = false; renderer.toneMapping = toneMapping;
  renderer.setRenderTarget(previous); renderer.setClearColor(clear, alpha);
  bark.dispose(); leaf.dispose();
  // Source form geometry was uploaded only for the bake; free its GPU copies.
  for (const form of forms) { form.lods[1].wood.dispose(); form.lods[1].foliage.dispose(); }
  return { material: impostorMaterial(target.texture), geometries: impostorGeometries(forms), target };
}

/**
 * All trees of one population in three BatchedMesh draws (wood, foliage,
 * impostor). Each instance switches geometry LOD by camera distance; Three's
 * per-instance frustum culling also applies to the shadow pass.
 */
export class TreeBatches {
  group = new T.Group();
  wood: T.BatchedMesh; foliage: T.BatchedMesh; impostor: T.BatchedMesh | null = null;
  private woodIds: number[][] = []; private leafIds: number[][] = []; private impostorIds: number[] = [];
  private level: Int8Array; private last = new T.Vector3(Infinity, 0, 0);
  private woodInstance: number[] = []; private leafInstance: number[] = []; private impostorInstance: number[] = [];
  counts = [0, 0, 0, 0, 0];

  constructor(public trees: PlacedTree[], private forms: TreeForm[], materials: TreeMaterials, private lods: LodDistances,
    impostors: ImpostorSet | null, name: string) {
    this.group.name = name;
    const sum = (f: (form: TreeForm) => T.BufferGeometry[]) => {
      let v = 0, i = 0;
      for (const form of forms) for (const g of f(form)) { v += g.attributes.position.count; i += g.index!.count; }
      return [v, i];
    };
    const n = Math.max(1, trees.length);
    const [wv, wi] = sum(f => f.lods.map(l => l.wood)), [lv, li] = sum(f => f.lods.map(l => l.foliage));
    this.wood = new T.BatchedMesh(n, wv, wi, materials.bark);
    this.foliage = new T.BatchedMesh(n, lv, li, materials.foliage);
    this.wood.name = `${name} wood`; this.foliage.name = `${name} foliage`;
    for (const mesh of [this.wood, this.foliage]) { mesh.castShadow = mesh.receiveShadow = true; this.group.add(mesh); }
    for (const form of forms) {
      this.woodIds.push(form.lods.map(l => this.wood.addGeometry(l.wood)));
      this.leafIds.push(form.lods.map(l => this.foliage.addGeometry(l.foliage)));
    }
    if (impostors) {
      const iv = impostors.geometries.reduce((a, g) => a + g.attributes.position.count, 0);
      this.impostor = new T.BatchedMesh(n, iv, iv * 2, impostors.material);
      this.impostor.name = `${name} impostors`;
      this.impostor.receiveShadow = true; this.impostor.castShadow = false;
      // 6 triangles each: drawing every impostor is cheaper than CPU-culling
      // thousands of them per frame.
      this.impostor.perObjectFrustumCulled = false; this.impostor.sortObjects = false;
      this.impostorIds = impostors.geometries.map(g => this.impostor!.addGeometry(g));
      this.group.add(this.impostor);
    }
    const matrix = new T.Matrix4(), q = new T.Quaternion(), color = new T.Color(), up = new T.Vector3(0, 1, 0);
    this.level = new Int8Array(trees.length).fill(-1);
    for (const tree of trees) {
      matrix.compose(new T.Vector3(tree.x, tree.y, tree.z), q.setFromAxisAngle(up, tree.rotation), new T.Vector3(tree.scale, tree.scale, tree.scale));
      color.setRGB(tree.tint, tree.tint, tree.tint * .98);
      const w = this.wood.addInstance(this.woodIds[tree.form][2]), l = this.foliage.addInstance(this.leafIds[tree.form][2]);
      this.wood.setMatrixAt(w, matrix); this.foliage.setMatrixAt(l, matrix);
      this.wood.setColorAt(w, new T.Color(1, 1, 1)); this.foliage.setColorAt(l, color);
      this.wood.setVisibleAt(w, false); this.foliage.setVisibleAt(l, false);
      this.woodInstance.push(w); this.leafInstance.push(l);
      if (this.impostor) {
        const k = this.impostor.addInstance(this.impostorIds[tree.form]);
        this.impostor.setMatrixAt(k, matrix); this.impostor.setColorAt(k, color); this.impostor.setVisibleAt(k, false);
        this.impostorInstance.push(k);
      }
    }
  }

  /** Re-evaluate LODs when the camera has moved ≥ 1.5 m. */
  update(camera: T.Camera, force = false) {
    const p = camera.getWorldPosition(new T.Vector3());
    if (!force && p.distanceToSquared(this.last) < 2.25) return;
    this.last.copy(p);
    const { near, mid, far, max } = this.lods;
    this.counts.fill(0);
    for (let i = 0; i < this.trees.length; i++) {
      const t = this.trees[i];
      const k = Math.min(1.6, Math.max(.7, t.scale));
      const d = Math.hypot(t.x - p.x, t.y + 6 * t.scale - p.y, t.z - p.z) / k;
      let level = d < near ? 0 : d < mid ? 1 : d < far ? 2 : d < max ? 3 : 4;
      if (level === 3 && !this.impostor) level = d < max ? 2 : 4;
      this.counts[level]++;
      if (level === this.level[i]) continue;
      const was = this.level[i]; this.level[i] = level;
      const real = level <= 2;
      if (real) {
        this.wood.setGeometryIdAt(this.woodInstance[i], this.woodIds[t.form][level]);
        this.foliage.setGeometryIdAt(this.leafInstance[i], this.leafIds[t.form][level]);
      }
      if (was === -1 || (was <= 2) !== real || level === 4 || was === 4) {
        this.wood.setVisibleAt(this.woodInstance[i], real);
        this.foliage.setVisibleAt(this.leafInstance[i], real);
        if (this.impostor) this.impostor.setVisibleAt(this.impostorInstance[i], level === 3);
      }
    }
  }

  /** Triangles currently submitted before frustum culling, by LOD. */
  triangleEstimate() {
    const per = [0, 0, 0, 0];
    for (let i = 0; i < this.trees.length; i++) {
      const l = this.level[i];
      if (l < 0 || l > 3) continue;
      per[l] += l === 3 ? 6 : this.forms[this.trees[i].form].triangles[l];
    }
    return per;
  }

  dispose() {
    this.group.removeFromParent();
    this.wood.dispose(); this.foliage.dispose(); this.impostor?.dispose();
  }
}
