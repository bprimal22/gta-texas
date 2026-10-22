import * as T from "three";
import { createPobGlass } from "./pob-glass";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import rawPlan from "./pob-frontage-plan.json" with { type: "json" };
import { buildPobWestYard } from "./pob-west-yard";
export type PobVolume = { planes: T.Plane[]; bounds: T.Box3 };
export function pobVolume(points: T.Vector3[], low: number, high: number): PobVolume {
  const center = points
    .reduce((a, b) => a.add(b), new T.Vector3())
    .multiplyScalar(1 / points.length);
  const planes = points.map((a, i) => {
    const b = points[(i + 1) % points.length],
      p = new T.Plane().setFromNormalAndCoplanarPoint(
        new T.Vector3(b.z - a.z, 0, a.x - b.x).normalize(),
        a,
      );
    if (p.distanceToPoint(center) > 0) p.negate();
    return p;
  });
  planes.push(
    new T.Plane(new T.Vector3(0, -1, 0), low),
    new T.Plane(new T.Vector3(0, 1, 0), -high),
  );
  const bounds = new T.Box3().setFromPoints(points);
  bounds.min.y = low;
  bounds.max.y = high;
  return { planes, bounds };
}
/** Closed shallow shells replace only the photographed west/north elevations.
 * East/south walls and the interior roof are retained source data. All lower
 * glass is opaque and physical: this does not create unsupported interiors. */
export function buildPobFrontage(options: {
  concrete: T.MeshStandardMaterial;
  grass: T.MeshStandardMaterial;
  fixedGroundHeight?: (x: number, z: number) => number;
}) {
  const p = rawPlan;
  const stone = new T.MeshStandardMaterial({ color: 0xd5c4a7, roughness: 0.91 });
  stone.name = "POB warm limestone";
  stone.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vPobStoneUv;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvPobStoneUv=uv;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vPobStoneUv;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
      vec2 q=vPobStoneUv/vec2(1.5,.72);vec2 f=fract(q);vec2 aa=fwidth(q)*.7;
      vec2 joint=1.-smoothstep(vec2(.005)-aa,vec2(.005)+aa,min(f,1.-f));
      diffuseColor.rgb*=1.-max(joint.x,joint.y)*.15;`,
      );
  };
  stone.customProgramCacheKey = () => "pob-limestone-panels-58";

  const brick = new T.MeshStandardMaterial({ color: 0xb8947a, roughness: 0.94 });
  brick.name = "POB buff brick";
  const glass = createPobGlass();
  const metal = new T.MeshStandardMaterial({ color: 0x343c3c, roughness: 0.55, metalness: 0.45 });
  metal.name = "POB dark window frames";
  // Subtle metric brick joints use facade UVs, not image rectangles. Geometry
  // supplies the reveals, projecting sills, stone courses and roof cornice.
  brick.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vPobUv;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
    vec2 q=vPobUv/vec2(.285,.082); float row=floor(q.y);q.x+=mod(row,2.)*.5;
    vec2 f=fract(q);vec2 aa=fwidth(q)*.65;float jx=1.-smoothstep(.016-aa.x,.016+aa.x,min(f.x,1.-f.x));
    float jy=1.-smoothstep(.045-aa.y,.045+aa.y,min(f.y,1.-f.y));
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.47,.43,.37),max(jx,jy)*.22);`,
      );
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vPobUv;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvPobUv=uv;");
  };
  brick.customProgramCacheKey = () => "pob-metric-brick-58";
  const materials = [stone, brick, glass, metal],
    parts: T.BufferGeometry[][] = materials.map(() => []),
    volumes: PobVolume[] = [],
    northUpperVolumes: PobVolume[] = [],
    witnesses: {
      edge: string;
      origin: number[];
      direction: number[];
      distance: number;
      kind: string;
    }[] = [];
  const plinthTops: {
    center: T.Vector3;
    along: T.Vector3;
    out: T.Vector3;
    halfWidth: number;
    top: number;
  }[] = [];
  let openings = 0,
    upperOpenings = 0,
    lowerOpenings = 0;
  function facade(
    a: number[],
    b: number[],
    name: string,
    top: number,
    pavilion = false,
    windows = true,
  ) {
    const origin = new T.Vector3(a[0], 0, a[1]),
      along = new T.Vector3(b[0] - a[0], 0, b[1] - a[1]),
      length = along.length();
    along.divideScalar(length);
    const out = along.clone().cross(new T.Vector3(0, 1, 0)),
      basis = new T.Matrix4().makeBasis(along, new T.Vector3(0, 1, 0), out).setPosition(origin);
    const point = (u: number, d: number, y = 0) =>
      origin.clone().addScaledVector(along, u).addScaledVector(out, d).setY(y);
    const box = (
      u: number,
      y: number,
      d: number,
      w: number,
      h: number,
      depth: number,
      mat: number,
    ) => {
      if (w <= 1e-6 || h <= 1e-6) return;
      const g = new T.BoxGeometry(w, h, depth);
      g.translate(u, y, d);
      const uv = g.attributes.uv,
        po = g.attributes.position;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, po.getX(i), po.getY(i));
      g.applyMatrix4(basis);
      parts[mat].push(g);
    };
    type Opening = { l: number; r: number; lo: number; hi: number; lower: boolean };
    const apertures: Opening[] = [];
    if (windows) {
      const margin = p.backDepth + 0.25;
      const count = pavilion ? 3 : Math.max(1, Math.floor((length - 2 * margin) / p.upperPitch)),
        pitch = (length - 2 * margin) / count;
      for (const lo of p.upperRows)
        for (let i = 0; i < count; i++) {
          const center = margin + (i + 0.5) * pitch,
            w = pavilion ? 1.55 : p.upperWindowWidth;
          apertures.push({
            l: center - w / 2,
            r: center + w / 2,
            lo,
            hi: lo + p.upperWindowHeight,
            lower: false,
          });
        }
      if (pavilion)
        for (let i = 0; i < 3; i++) {
          const c = (length * (i + 1)) / 4;
          apertures.push({ l: c - 0.77, r: c + 0.77, lo: 25.0, hi: 27.75, lower: false });
        }
      const groups = Math.max(1, Math.floor((length - 2 * margin) / 5.8)),
        groupPitch = (length - 2 * margin) / groups;
      for (let i = 0; i < groups; i++) {
        const c = margin + (i + 0.5) * groupPitch,
          w = Math.min(groupPitch - 1.1, 4.6);
        apertures.push({
          l: c - w / 2,
          r: c + w / 2,
          lo: p.base + 0.18,
          hi: p.stoneTop - 0.62,
          lower: true,
        });
      }
    }
    // The backed wall occupies 0..1.25m inside its official face; there is
    // no flat opaque plane across the opening mouth.
    const levels = [
      ...new Set([
        p.base,
        p.stoneTop,
        ...(pavilion ? [24.6] : []),
        top,
        ...apertures.flatMap((o) => [o.lo, o.hi]),
      ]),
    ].sort((a, b) => a - b);
    for (let j = 0; j < levels.length - 1; j++) {
      const lo = levels[j],
        hi = levels[j + 1],
        mid = (lo + hi) / 2,
        active = apertures.filter((o) => mid > o.lo && mid < o.hi).sort((a, b) => a.l - b.l);
      let x = 0;
      for (const o of active) {
        box(
          (x + o.l) / 2,
          mid,
          -p.wallDepth / 2,
          o.l - x,
          hi - lo,
          p.wallDepth,
          mid < p.stoneTop || (top > p.roof && mid >= 24.6) ? 0 : 1,
        );
        x = o.r;
      }
      box(
        (x + length) / 2,
        mid,
        -p.wallDepth / 2,
        length - x,
        hi - lo,
        p.wallDepth,
        mid < p.stoneTop || (top > p.roof && mid >= 24.6) ? 0 : 1,
      );
    }
    // Closed backing + top slab retain floor/collision even when source is cut.
    box(
      length / 2,
      (p.base + p.stoneTop) / 2,
      -p.backDepth + 0.16,
      length,
      p.stoneTop - p.base,
      0.32,
      0,
    );
    box(length / 2, (p.stoneTop + top) / 2, -p.backDepth + 0.16, length, top - p.stoneTop, 0.32, 1);
    box(length / 2, p.base + 0.1, -p.backDepth / 2, length, 0.2, p.backDepth, 0);
    box(length / 2, top - 0.12, -p.backDepth / 2, length, 0.24, p.backDepth, 0);
    for (const o of apertures) {
      const w = o.r - o.l,
        h = o.hi - o.lo,
        c = (o.l + o.r) / 2,
        y = (o.lo + o.hi) / 2;
      box(c, y, -p.windowInset - 0.045, w, h, 0.09, 2);
      box(o.l + 0.036, y, -p.windowInset + 0.035, 0.072, h, 0.07, 3);
      box(o.r - 0.036, y, -p.windowInset + 0.035, 0.072, h, 0.07, 3);
      box(c, o.lo + 0.036, -p.windowInset + 0.035, w, 0.072, 0.07, 3);
      box(c, o.hi - 0.036, -p.windowInset + 0.035, w, 0.072, 0.07, 3);
      if (o.lower) {
        const panes = Math.max(2, Math.round(w / 1.12));
        for (let k = 1; k < panes; k++)
          box(o.l + (k * w) / panes, y, -p.windowInset + 0.055, 0.055, h, 0.08, 3);
        box(c, o.hi - 0.95, -p.windowInset + 0.055, w, 0.06, 0.08, 3);
        lowerOpenings++;
      } else {
        box(c, o.lo + 0.82, -p.windowInset + 0.04, w, 0.045, 0.08, 3);
        upperOpenings++;
      }
      // Warm projecting stone sill and genuine jamb depth catch daylight.
      box(c, o.lo - 0.075, 0.075, w + 0.22, 0.15, 0.34, 0);
      const from = point(c, 2, y);
      witnesses.push({
        edge: name,
        origin: from.toArray(),
        direction: out.clone().negate().toArray(),
        distance: 2 + p.windowInset,
        kind: o.lower ? "lower-glass" : "upper-glass",
      });
      openings++;
    }
    // The official close-ups show projecting toes and caps under the
    // limestone piers. Keep these shallow so the entry walk stays clear.
    const lower = apertures.filter((o) => o.lower).sort((a, b) => a.l - b.l);
    let left = 0;
    for (const o of [...lower, { l: length, r: length, lo: 0, hi: 0, lower: true }]) {
      const width = o.l - left;
      if (width > 0.35) {
        const c = (left + o.l) / 2;
        box(c, p.base + 0.39, 0.11, Math.min(width, 0.94), 0.78, 0.34, 0);
        box(c, p.base + 0.81, 0.14, Math.min(width + 0.08, 1.02), 0.12, 0.4, 0);
        plinthTops.push({
          center: point(c, 0.14),
          along: along.clone(),
          out: out.clone(),
          halfWidth: Math.min(width + 0.08, 1.02) / 2,
          top: p.base + 0.87,
        });
      }
      left = o.r;
    }
    // Major masonry courses, with stronger cornice at roof. Profiles are
    // intentional architectural depth rather than repeated decorative strips.
    box(length / 2, p.stoneTop + 0.06, 0.085, length, 0.22, 0.24, 0);
    box(length / 2, top - 0.35, 0.15, length, 0.27, 0.38, 0);
    box(length / 2, top + 0.04, 0.22, length, 0.18, 0.55, 0);
    // A shallow closed return at each end prevents a cut face exposing an
    // unsupported hollow wall at corners and the retained south/east ends.
    for (const x of [0.065, length - 0.065]) {
      box(
        x,
        (p.base + p.stoneTop) / 2,
        -p.backDepth / 2,
        0.13,
        p.stoneTop - p.base,
        p.backDepth,
        0,
      );
      box(x, (p.stoneTop + top) / 2, -p.backDepth / 2, 0.13, top - p.stoneTop, p.backDepth, 1);
    }

    const cut = pobVolume(
      [
        point(0, name === "west" ? 1.2 : 0),
        point(length, name === "west" ? 1.2 : 0),
        point(length, -p.backDepth + 0.03),
        point(0, -p.backDepth + 0.03),
      ],
      p.base - 0.025,
      top + 0.22,
    );
    if (name === "west")
      cut.planes.push(
        new T.Plane(new T.Vector3(0, 0, -1), p.west[0][1]),
        new T.Plane(new T.Vector3(0, 0, 1), -p.west[1][1]),
      );
    volumes.push(cut);
    // Measured upper source folds project beyond the official north planes.
    // Keep the original low cuts intact: no new road/floor removal below Y8.
    if (name.startsWith("north-")) {
      const outward = pavilion ? 1.05 : windows ? 1.1 : 0.5;
      const pad = 0.3;
      northUpperVolumes.push(
        pobVolume(
          [
            point(-pad, outward),
            point(length + pad, outward),
            point(length + pad, -p.backDepth + 0.03),
            point(-pad, -p.backDepth + 0.03),
          ],
          8,
          top + 0.22,
        ),
      );
    }
  }
  facade(p.west[0], p.west[1], "west", p.roof);
  for (let i = 0; i < p.north.length - 1; i++)
    facade(
      p.north[i],
      p.north[i + 1],
      `north-${i}`,
      i >= 1 && i <= 3 ? p.pavilionRoof : p.roof,
      i === 2,
      i !== 1 && i !== 3,
    );
  const meshes = parts.map((pieces, i) => {
    const g = mergeGeometries(pieces, false)!;
    for (const x of pieces) x.dispose();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    const m = new T.Mesh(g, materials[i]);
    m.name = `POB frontage: ${materials[i].name}`;
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  });
  const yard = buildPobWestYard({
    concrete: options.concrete,
    grass: options.grass,
    fixedGroundHeight: options.fixedGroundHeight,
    makeVolume: pobVolume,
  });
  const height = (x: number, z: number) => {
    let y = yard.height(x, z);
    if (!Number.isFinite(y)) return y;
    for (const cap of plinthTops) {
      const delta = new T.Vector3(x, 0, z).sub(cap.center);
      if (
        Math.abs(delta.dot(cap.along)) <= cap.halfWidth + 1e-7 &&
        Math.abs(delta.dot(cap.out)) <= 0.2 + 1e-7
      )
        y = Math.max(y, cap.top);
    }
    return y;
  };
  let disposed = false;
  const allMeshes = [...meshes, ...yard.meshes];
  return {
    meshes: allMeshes,
    materials,
    colliderGeometries: allMeshes.map((m) => m.geometry),
    volumes: [...volumes, ...yard.volumes, ...northUpperVolumes],
    sourceClearanceVolumes: [...volumes, ...yard.volumes, ...northUpperVolumes],
    oldGroundTrimVolumes: yard.oldGroundTrimVolumes,
    authoredGroundTrimVolumes: yard.oldGroundTrimVolumes,
    height,
    contains: yard.contains,
    paved: yard.paved,
    local: yard.local,
    trees: [],
    witnesses,
    yard,
    stats: {
      scope: p.scope,
      facadeTriangles: meshes.reduce(
        (n, m) => n + (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3,
        0,
      ),
      groundTriangles: yard.stats.triangles,
      triangles: allMeshes.reduce(
        (n, m) => n + (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3,
        0,
      ),
      batches: allMeshes.length,
      ownedMaterials: materials.length,
      openings,
      upperOpenings,
      lowerOpenings,
      sourceCutVolumes: volumes.length + yard.volumes.length + northUpperVolumes.length,
      yard: yard.stats,
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const m of meshes) m.geometry.dispose();
      yard.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
