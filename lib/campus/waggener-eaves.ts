import * as T from 'three';

/** The source roof cross sections and UT photographs support a broad overhang,
 * continuous soffit and shaped brackets. These are architectural approximations,
 * not the painted medallions or a survey of individual roof tiles. */
export function addWaggenerEaves(
  corners: T.Vector3[],
  top: number,
  overhang: number,
  materials: { stone: T.Material; soffit: T.Material; roof: T.Material; wood: T.Material },
  add: (geometry: T.BufferGeometry, material: T.Material) => void,
) {
  const center = corners.reduce((sum, p) => sum.add(p), new T.Vector3()).multiplyScalar(.25);
  let brackets = 0;
  for (let edge = 0; edge < 4; edge++) {
    const a = corners[edge], b = corners[(edge + 1) % 4];
    const u = b.clone().sub(a).normalize(), length = a.distanceTo(b);
    const inward = center.clone().sub(a.clone().lerp(b, .5));
    inward.y = 0; inward.normalize();
    const basis = new T.Matrix4().makeBasis(u, new T.Vector3(0, 1, 0), inward).setPosition(a.x, top, a.z);
    const place = (geometry: T.BufferGeometry, material: T.Material) => {
      geometry.applyMatrix4(basis);
      if (basis.determinant() < 0) {
        const ix = geometry.index;
        if (ix) for (let j = 0; j < ix.count; j += 3) {
          const first = ix.getX(j); ix.setX(j, ix.getX(j + 2)); ix.setX(j + 2, first);
        }
        else for (const attr of Object.values(geometry.attributes)) for (let j = 0; j < attr.count; j += 3)
          for (let k = 0; k < attr.itemSize; k++) {
            const first = j * attr.itemSize + k, last = (j + 2) * attr.itemSize + k;
            const v = attr.array[first]; attr.array[first] = attr.array[last]; attr.array[last] = v;
          }
      }
      add(geometry, material);
    };
    const box = (x: number, y: number, z: number, w: number, h: number, d: number, m: T.Material) =>
      place(new T.BoxGeometry(w, h, d).translate(x, y, z), m);
    // Close the underside between the wall and the outer fascia. End mitres
    // overlap only inside this solid soffit, never create an open roof lip.
    box(length / 2, -.16, overhang / 2, length, .24, overhang + .08, materials.soffit);
    box(length / 2, -.07, .02, length, .26, .14, materials.wood);
    box(length / 2, -.29, overhang + .04, length, .14, .22, materials.stone);
    const count = Math.max(3, Math.round((length - 2 * overhang) / 4.1));
    for (let j = 0; j <= count; j++) {
      const x = overhang + (length - 2 * overhang) * j / count;
      // Extruded side profile: the broad head projects to the fascia while the
      // curved heel returns to the wall. Side profile is in local Z/Y.
      const profile = new T.Shape();
      profile.moveTo(.15, -.22); profile.lineTo(overhang + .2, -.22);
      profile.lineTo(overhang + .2, -1.05); profile.lineTo(overhang - .04, -1.05);
      profile.bezierCurveTo(overhang - .44, -1.05, overhang - .08, -.49, .15, -.45);
      profile.closePath();
      const bracket = new T.ExtrudeGeometry(profile, { depth: .34, steps: 1, bevelEnabled: false, curveSegments: 8 });
      // Profile X becomes depth into the soffit; extrusion becomes facade U.
      bracket.rotateY(-Math.PI / 2).translate(x + .17, 0, 0);
      place(bracket, materials.stone);
      box(x, -.24, overhang / 2, .46, .12, overhang + .08, materials.wood);
      brackets++;
      if (j < count) {
        const width = (length - 2 * overhang) / count - .55;
        box(x + (length - 2 * overhang) / count / 2, -.285, overhang / 2,
          width, .015, overhang - .27, materials.roof);
      }
    }
    const tileCount = Math.ceil(length / .24);
    for (let j = 0; j < tileCount; j++) {
      const tile = new T.CylinderGeometry(.095, .095, .38, 8, 1, true, Math.PI / 2, Math.PI)
        .rotateX(Math.PI / 2).translate(length * (j + .5) / tileCount, .075, .04);
      place(tile, materials.roof);
    }
  }
  return brackets;
}
