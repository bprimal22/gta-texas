import * as T from "three";

export const pmaTowerFrontage = {
  // Engineering-courtyard coordinates. The south face is registered against
  // live wall samples (t=-57.00..-57.48); the former -58.6 face left scan shards.
  s0: 9.9,
  // East edge 48.1 and roof 68.1 (cap top) = 2017 LiDAR 716056 tier Y68.1
  // (1354 m2, s8.0..48.1 where it meets the Y74.2 core); was s45.9 / Y66.98.
  s1: 48.1,
  t0: -93.4,
  t1: -56.9,
  base: 10.5,
  top: 67.62,
  upperStart: 22.5,
  storey: 4,
  recess: 0.92,
  wallDepth: 1.18,
  bevel: 0.22,
  mainBays: 4,
  endBanks: 2,
  // Full-height concrete ribs on the long (north/south) faces, at the solid
  // piers between the four window groups, splaying into angled feet at the
  // base (photo-only live captures pma-eer-photo-only-south / engineering-
  // north-100m). Proportions are reference-interpreted, not surveyed.
  ribWidth: 1.1,
  ribDepth: 0.45,
  footDepth: 1.0,
  footTop: 16.5,
} as const;

type Emit = (g: T.BufferGeometry, material: T.Material, solid?: boolean) => void;
type Opening = { left: number; right: number; low: number; high: number; innerHigh?: number };

/** Photo-informed PMA western tower, with its south face registered to the
 * retained scan. North/south have four broad groups, while east/west have
 * two end banks separated by a solid service-core wall. South/east treatment
 * is an explicit symmetry estimate, not a surveyed elevation. The podium,
 * second tower, landscape and source-cut ownership stay in the caller.
 */
export function buildPmaTowerFrontage(
  add: Emit,
  stone: T.MeshStandardMaterial,
  glass: T.MeshStandardMaterial,
  metal: T.MeshStandardMaterial,
) {
  const p = pmaTowerFrontage;
  const stats = {
    openings: 0,
    mainBays: p.mainBays,
    endBanks: p.endBanks,
    lowerHaunches: 0,
    glazedPanes: 0,
    ribs: 0,
    triangles: 0,
    collisionTriangles: 0,
  };
  const emit: Emit = (g, m, solid = true) => {
    const triangles = (g.index?.count ?? g.attributes.position.count) / 3;
    stats.triangles += triangles;
    if (solid) stats.collisionTriangles += triangles;
    add(g, m, solid);
  };
  const box = (s: number, y: number, t: number, w: number, h: number, d: number, m: T.Material) =>
    emit(new T.BoxGeometry(w, h, d).translate(s, y, t), m);
  // The inset closed core and cap protect the former volume. The skin sits
  // ahead of it; no hidden solid core fills a window's visible recess.
  box(
    (p.s0 + p.s1) / 2,
    (p.base + p.top) / 2,
    (p.t0 + p.t1) / 2,
    p.s1 - p.s0 - 2 * p.wallDepth,
    p.top - p.base,
    p.t1 - p.t0 - 2 * p.wallDepth,
    stone,
  );
  box((p.s0 + p.s1) / 2, p.top + 0.24, (p.t0 + p.t1) / 2, p.s1 - p.s0 + 0.18, 0.48, p.t1 - p.t0 + 0.18, stone);

  const corners = [
    [p.s0, p.t0],
    [p.s1, p.t0],
    [p.s1, p.t1],
    [p.s0, p.t1],
  ];
  const witnesses: { edge: number; u: number; y: number; depth: number; kind: string }[] = [];
  for (let edge = 0; edge < 4; edge++) {
    const a = corners[edge],
      b = corners[(edge + 1) % 4],
      du = b[0] - a[0],
      dt = b[1] - a[1],
      length = Math.hypot(du, dt);
    const along = new T.Vector3(du / length, 0, dt / length),
      out = new T.Vector3(dt / length, 0, -du / length);
    const matrix = new T.Matrix4()
      .makeBasis(along, new T.Vector3(0, 1, 0), out)
      .setPosition(a[0], 0, a[1]);
    // Along/up/out is a reflected frame. Flip triangle winding after the
    // transform so front-facing render surfaces and collider normals agree.
    const transform = (g: T.BufferGeometry) => {
      g.applyMatrix4(matrix);
      const index = g.index!;
      for (let i = 0; i < index.count; i += 3) {
        const j = index.getX(i + 1);
        index.setX(i + 1, index.getX(i + 2));
        index.setX(i + 2, j);
      }
      return g;
    };
    // Local facade coordinates: u along the wall, positive depth outward.
    const part = (
      u: number,
      y: number,
      depth: number,
      w: number,
      h: number,
      d: number,
      m: T.Material,
    ) => {
      emit(transform(new T.BoxGeometry(w, h, d).translate(u, y, depth)), m);
    };
    const quad = (points: number[][], m: T.Material) => {
      const pos = points.flatMap((q) => q),
        g = new T.BufferGeometry().setAttribute("position", new T.Float32BufferAttribute(pos, 3));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      g.computeVertexNormals();
      g.setAttribute(
        "uv",
        new T.Float32BufferAttribute(
          points.flatMap((q) => [q[0], q[1]]),
          2,
        ),
      );
      emit(transform(g), m);
    };
    const main = edge % 2 === 0,
      groups: { left: number; right: number }[] = [];
    if (main) {
      const margin = 1.4,
        pitch = (length - 2 * margin) / 4;
      for (let j = 0; j < 4; j++)
        groups.push({ left: margin + j * pitch + 1.05, right: margin + (j + 1) * pitch - 1.05 });
    } else {
      // The photographed Speedway end wall has broad blank masonry in its
      // center, with recessed window banks near the two ends.
      groups.push({ left: 1.5, right: 7.8 }, { left: length - 7.8, right: length - 1.5 });
    }
    const openings: Opening[] = [];
    for (const g of groups) {
      // Three-storey base piers and the diagonal concrete haunch are a strong
      // PMA cue in both the 2012 north view and 2025 northwest reference.
      openings.push({
        ...g,
        low: p.base + 0.18,
        high: p.upperStart - 0.68,
        innerHigh: p.base + 7.2,
      });
      for (let floor = 0; floor < 11; floor++)
        openings.push({
          ...g,
          low: p.upperStart + floor * p.storey + 1.9,
          high: p.upperStart + floor * p.storey + 3.62,
        });
    }
    // Closed wall boxes in the spaces between apertures. Splitting by band
    // rather than a Cartesian opening grid keeps triangle count bounded.
    const levels = [p.base, ...new Set(openings.flatMap((o) => [o.low, o.high])), p.top].sort(
      (x, y) => x - y,
    );
    for (let k = 0; k < levels.length - 1; k++) {
      const low = levels[k],
        high = levels[k + 1],
        mid = (low + high) / 2;
      const active = openings
        .filter((o) => mid > o.low && mid < o.high)
        .sort((x, y) => x.left - y.left);
      let left = 0;
      for (const opening of active) {
        if (opening.left > left)
          part(
            (left + opening.left) / 2,
            mid,
            -p.wallDepth / 2,
            opening.left - left,
            high - low,
            p.wallDepth,
            stone,
          );
        left = opening.right;
      }
      if (left < length)
        part(
          (left + length) / 2,
          mid,
          -p.wallDepth / 2,
          length - left,
          high - low,
          p.wallDepth,
          stone,
        );
    }
    for (const o of openings) {
      const l = o.left,
        r = o.right,
        lo = o.low,
        hi = o.high;
      const il = l + p.bevel,
        ir = r - p.bevel,
        ilow = lo + p.bevel,
        ih = (o.innerHigh ?? hi) - p.bevel;
      const outer = [
        [l, lo, 0],
        [r, lo, 0],
        [r, hi, 0],
        [l, hi, 0],
      ];
      const inner = [
        [il, ilow, -0.72],
        [ir, ilow, -0.72],
        [ir, ih, -0.72],
        [il, ih, -0.72],
      ];
      for (let side = 0; side < 4; side++) {
        const next = (side + 1) % 4;
        // Ring normals face the opening; this gives true beveled jambs,
        // deep soffits and a sloped sill instead of a painted dark rectangle.
        quad([outer[side], outer[next], inner[next], inner[side]], stone);
        const back = inner.map((q) => [q[0], q[1], -p.recess]);
        quad([inner[side], inner[next], back[next], back[side]], stone);
      }
      const width = ir - il,
        height = ih - ilow,
        u = (il + ir) / 2,
        y = (ilow + ih) / 2;
      part(u, y, -p.recess - 0.025, width, height, 0.05, glass);
      // Four vertical panes are visible in the photo's broad windows. Frame
      // bars have actual depth, but do not divide the wall into extra bays.
      for (let mullion = 1; mullion < 4; mullion++)
        part(il + (width * mullion) / 4, y, -p.recess + 0.025, 0.055, height, 0.07, metal);
      part(u, ilow + 0.055, -p.recess + 0.025, width, 0.07, 0.07, metal);
      part(u, ih - 0.035, -p.recess + 0.025, width, 0.05, 0.07, metal);
      if (o.innerHigh !== undefined) {
        stats.lowerHaunches++;
        for (const yy of [p.base + 3.25, p.base + 5.95])
          if (yy < ih) part(u, yy, -p.recess + 0.025, width, 0.11, 0.07, metal);
      }
      if(o.innerHigh!==undefined) witnesses.push({edge,u:u+width*.08,y:(ih+hi)/2,depth:.36,kind:'sloped-haunch'});
      stats.openings++;
      stats.glazedPanes += 4;
      witnesses.push({
          edge,
          u: u + width * 0.08,
          y: y + 0.15,
          depth: p.recess,
          kind: "recessed-glass",
        });
    }
    witnesses.push({
      edge,
      u: main ? 1.4 : length / 2,
      y: 35,
      depth: 0,
      kind: "solid-pier-or-core",
    });
    if (main) {
      // Ribs stand proud of the wall plane (depth 0 = wall face, + = outward);
      // the four window groups therefore read as deep recesses between them.
      const margin = 1.4,
        pitch = (length - 2 * margin) / 4,
        // Feet start at the tower base line (Y10.5): below it the supported
        // forecourt walk reaches the south face, so nothing may project there.
        footBottom = p.base;
      for (let j = 0; j <= 4; j++) {
        const u = margin + j * pitch;
        part(u, (p.footTop + p.top) / 2, p.ribDepth / 2, p.ribWidth, p.top - p.footTop, p.ribDepth, stone);
        // Angled foot: outer face slopes from footDepth at the bottom to the
        // rib depth at footTop. Box vertices are per-face, so normals stay flat.
        const h = p.footTop - footBottom,
          foot = new T.BoxGeometry(p.ribWidth, h, p.footDepth);
        const pos = foot.attributes.position;
        for (let i = 0; i < pos.count; i++)
          if (pos.getY(i) > 0 && pos.getZ(i) > 0) pos.setZ(i, -p.footDepth / 2 + p.ribDepth);
        foot.computeVertexNormals();
        emit(transform(foot.translate(u, (footBottom + p.footTop) / 2, p.footDepth / 2)), stone);
        witnesses.push({ edge, u, y: (p.footTop + p.top) / 2, depth: -p.ribDepth, kind: "rib" });
        stats.ribs++;
      }
    }
  }
  return { stats, witnesses };
}
