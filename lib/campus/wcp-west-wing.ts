import * as T from 'three';

export type WcpOpening = {
  left: number; right: number; low: number; high: number;
  door?: boolean; shade?: boolean; tallReveal?: boolean;
};
type Patch = { left: number; right: number; low: number; high: number };

/** Ratios traced from the architect's UTSAC_2 photograph and north section.
 * The origin is the left end when standing outside each wall. These are
 * exterior visual estimates, not surveyed window or floor dimensions. */
export function wcpWestWingFace(
  length: number, base: number, top: number, out: T.Vector3,
) {
  const openings: WcpOpening[] = [], panels: Patch[] = [];
  const west = out.x < -.7, north = out.z < -.7, south = out.z > .7;
  const add = (center: number, width: number, low: number, high: number,
    options: Partial<WcpOpening> = {}) => {
    openings.push({ left: center - width / 2, right: center + width / 2,
      low: base + low, high: base + high, ...options });
  };
  const panel = (left: number, right: number, low: number, high: number) =>
    panels.push({ left, right, low: base + low, high: base + high });

  if (west && length > 15) {
    // Speedway end: charcoal ground-level corner, an isolated window and a
    // group of three; no doorway here. The entrance is along the north side.
    panel(0, length * .29, .34, 3.7);
    panel(0, length * .33, 5.25, 8.15);
    for (const t of [.32, .54, .655, .77]) add(length * t, 1.03, .48, 3.7);
    for (const t of [.13, .265]) add(length * t, 1.13, 5.25, 8.15, { shade: true });
    for (const t of [.54, .655, .77]) add(length * t, 1.22, 5.25, 11.65, { tallReveal: true });
    openings.push({ left: .12, right: length * .33, low: base + 9.65, high: top - .25 });
  } else if (north && length > 35) {
    // North wall coordinates run east to west. Keep the band wrapping the
    // west corner, with the door and five lower windows visible in the photo.
    const westDistance = (d: number) => length - d;
    panel(length * .61, length, .34, 3.7);
    panel(length * .84, length, 5.25, 8.15);
    for (const d of [2.8, 6.3, 9.8, 13.3, 16.8]) add(westDistance(d), 1.08, .48, 3.7);
    add(westDistance(20.1), 2.1, .18, 3.7, { door: true });
    for (const t of [.055, .098, .141, .184, .227]) add(length * t, 1.04, .48, 3.35);
    for (const t of [.37, .52]) add(length * t, .48, 2.45, 3.6);
    for (const d of [1.8, 4.7, 7.6, 12.4, 15.3]) add(westDistance(d), 1.17, 5.25, 8.15);
    for (const t of [.075, .12, .165, .21, .255]) add(length * t, 1.16, 5.25, 11.65, { tallReveal: true });
    for (const t of [.40, .49, .58]) add(length * t, .48, 6.5, 7.55);
    for (const t of [.38, .48, .58]) add(length * t, .45, 10.3, 11.55);
    openings.push({ left: length * .69, right: length - .12, low: base + 9.65, high: top - .25 });
  } else if (south && length > 10) {
    // Courtyard side: broad ground-floor glazing, paired middle windows and
    // an upper solid wall. It does not repeat the Speedway-end pattern.
    const count = Math.max(2, Math.floor(length / 4.3)), pitch = length / count;
    for (let j = 0; j < count; j++) {
      add((j + .5) * pitch, pitch - .55, .38, 3.45);
      add((j + .5) * pitch, 1.1, 5.45, 8.2, { shade: j % 2 === 0 });
      if (j % 3 === 1) add((j + .5) * pitch, .65, 10.15, 11.6);
    }
    panel(.2, length - .2, 5.45, 8.2);
  }
  return { openings, panels };
}

/** A low hipped roof with a deep thin eave, aligned to the real western bar.
 * Its pitch and projection are estimated from the architect's section. */
export function wcpWestWingRoof(ring: [number, number][], eaveY: number, rise = 2.75) {
  const origin = new T.Vector2(13.1252, 122.36676);
  const east = new T.Vector2(51.45238, 4.7297).normalize();
  const south = new T.Vector2(-east.y, east.x);
  const local = ring.map(p => {
    const d = new T.Vector2(...p).sub(origin);
    return new T.Vector2(d.dot(east), d.dot(south));
  });
  // Offset the actual stepped footprint. A bounding rectangle would create
  // an oversized canopy over the southwest recess in this L-shaped bar.
  const sign = Math.sign(local.reduce((a, p, i) => {
    const q = local[(i + 1) % local.length]; return a + p.x * q.y - q.x * p.y;
  }, 0));
  const outline = local.map((p, i) => {
    const previous = local[(i + local.length - 1) % local.length];
    const next = local[(i + 1) % local.length];
    const a = p.clone().sub(previous).normalize(), b = next.clone().sub(p).normalize();
    const n1 = new T.Vector2(a.y * sign, -a.x * sign);
    const n2 = new T.Vector2(b.y * sign, -b.x * sign);
    return p.clone().addScaledVector(n1.clone().add(n2), 1.1 / (1 + n1.dot(n2)));
  });
  // The plan's first vertex is collinear along the eastern edge. The two
  // ridge ends and stepped southern eave retain a low, continuous hip.
  const points = outline.map(p => [p.x, p.y, eaveY]);
  const westMid = (outline[2].y + outline[3].y) / 2;
  const eastMid = (outline[1].y + outline[6].y) / 2;
  points.push([outline[2].x + 10, westMid, eaveY + rise]);
  points.push([outline[1].x - 11, eastMid, eaveY + rise]);
  const faces = [[2, 7, 8], [2, 8, 1], [1, 8, 6], [6, 8, 5],
    [5, 8, 4], [4, 8, 7], [4, 7, 3], [3, 7, 2]];
  const position: number[] = [], uv: number[] = [];
  for (const face of faces) {
    for (const i of face) {
      const [x, z, y] = points[i];
      position.push(origin.x + east.x * x + south.x * z, y,
        origin.y + east.y * x + south.y * z);
      uv.push(x, z);
    }
  }
  const geometry = new T.BufferGeometry()
    .setAttribute('position', new T.Float32BufferAttribute(position, 3))
    .setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  const shape = new T.Shape(outline.map(p => origin.clone()
    .addScaledVector(east, p.x).addScaledVector(south, p.y)));
  const soffit = new T.ExtrudeGeometry(shape, { depth: .14, bevelEnabled: false })
    .rotateX(Math.PI / 2).translate(0, eaveY, 0);
  return { roof: geometry, soffit };
}
