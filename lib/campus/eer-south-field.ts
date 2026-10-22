import * as T from 'three';

// EER south tower OUTER (south) face, engineering frame t = 33.5, s 104..184.4: appearance-only correction (root request
// b01-d02-eer-1, verified in root IAB: d02-eer-southeast.png vs district-orbits-30m d02-orbit-southeast.jpg).
// The source shows, from the base up: pale warm stone base storey, a continuous DARK horizontal band, a broad SILVER-GREY
// horizontally ribbed metal field, and a warm stone top band. No geometry or collider changes: the existing limestone
// shader recolours only fragments of this one face (positions are campus coordinates, meshes have identity transforms),
// and the shared silver frame material is darkened only where its south-face pieces cross the band.
// Heights are ESTIMATES: camera rays through the source band edges (pose: camera 179.89,28.939,-168.86 -> target
// 116.25,14.054,-232.5, vertical fov 60, 1280x720) intersected with the plane t = 33.5: band Y 7.73-10.42 at s 107.8 and
// 8.11-10.67 at s 138.9 (east sample at s 149.8 blurred: reported, not used) -> band 7.90-10.55 (+-0.4 m); metal field top
// read 38.98 / 35.5 -> top-storey datum 39.15 (+-1.5 m). Rib pitch, seam pitch and both tones are estimates.
export const EER_SOUTH_FIELD = {
  t: 33.5, tTol: 0.03, s0: 104.0, s1: 184.4,
  bandBottom: 7.90, bandTop: 10.55, fieldTop: 39.15,
  ribPitch: 0.30, seamPitch: 2.94,
  band: { srgb: 0x3a3f42, roughness: 0.55, metalness: 0.25 },
  field: { srgb: 0xb3b7b8, roughness: 0.42, metalness: 0.55 },
  /** frame pieces standing proud of this face (t 33.465..33.71) that cross the band */
  frameT: [33.45, 33.72] as [number, number],
};
export type EerSouthZone = 'band' | 'field' | null;

/** Pure zone test (same thresholds as the GLSL): campus-frame s/t, Y, and the normal's component along the outward (south) axis. */
export function eerSouthFieldZone(s: number, t: number, y: number, normalSouth: number): EerSouthZone {
  const F = EER_SOUTH_FIELD;
  if (Math.abs(t - F.t) > F.tTol || normalSouth < 0.9 || s < F.s0 || s > F.s1) return null;
  if (y >= F.bandBottom && y < F.bandTop) return 'band';
  if (y >= F.bandTop && y < F.fieldTop) return 'field';
  return null;
}

/** Linear working-space RGB of an sRGB hex (THREE.Color converts sRGB input to the linear working colour space). */
function linear(hex: number) { const c = new T.Color(hex); return `vec3(${c.r.toFixed(5)},${c.g.toFixed(5)},${c.b.toFixed(5)})`; }
const f = (v: number) => v.toFixed(5);

/** Shared GLSL for the s/t frame and the soft zone masks (pixel-width aware edges). `p` / `n` are campus position / normal. */
function frameGLSL(origin: T.Vector3, east: T.Vector3, p: string, n: string) {
  const F = EER_SOUTH_FIELD, ex = east.x / Math.hypot(east.x, east.z), ez = east.z / Math.hypot(east.x, east.z);
  return `
        vec2 sfD=${p}.xz-vec2(${f(origin.x)},${f(origin.z)});
        float sfS=dot(sfD,vec2(${f(ex)},${f(ez)})),sfT=dot(sfD,vec2(${f(-ez)},${f(ex)}));
        float sfNS=dot(normalize(${n}).xz,vec2(${f(-ez)},${f(ex)}));
        float sfY=${p}.y,sfW=max(fwidth(sfY),1e-4);
        float sfIn=step(${f(F.s0)},sfS)*step(sfS,${f(F.s1)});
        float sfBand=smoothstep(${f(F.bandBottom)}-sfW,${f(F.bandBottom)}+sfW,sfY)*(1.-smoothstep(${f(F.bandTop)}-sfW,${f(F.bandTop)}+sfW,sfY));
        float sfField=smoothstep(${f(F.bandTop)}-sfW,${f(F.bandTop)}+sfW,sfY)*(1.-smoothstep(${f(F.fieldTop)}-sfW,${f(F.fieldTop)}+sfW,sfY));`;
}

/** Limestone: after <color_fragment>, recolour this face's band and ribbed metal field; after <metalnessmap_fragment>, its PBR. */
export function eerSouthFieldGLSL(origin: T.Vector3, east: T.Vector3, p: string, n: string) {
  const F = EER_SOUTH_FIELD;
  const color = `
        // EER south outer face (eer-south-field.ts): dark band + silver-grey ribbed metal field.
        ${frameGLSL(origin, east, p, n)}
        float sfFace=sfIn*step(abs(sfT-${f(F.t)}),${f(F.tTol)})*step(.9,sfNS);
        float sfB=sfFace*sfBand,sfM=sfFace*sfField;
        float sfRibW=max(fwidth(sfY/${f(F.ribPitch)}),1e-4),sfRibD=min(fract(sfY/${f(F.ribPitch)}),1.-fract(sfY/${f(F.ribPitch)}));
        float sfRib=(1.-smoothstep(.08,.08+sfRibW*1.5,sfRibD))*(1.-smoothstep(.15,.4,sfRibW));
        float sfSeamU=sfS/${f(F.seamPitch)},sfSeamW=max(fwidth(sfSeamU),1e-4),sfSeamD=min(fract(sfSeamU),1.-fract(sfSeamU));
        float sfSeam=(1.-smoothstep(.006,.006+sfSeamW*1.5,sfSeamD))*(1.-smoothstep(.04,.12,sfSeamW));
        vec3 sfMetal=${linear(F.field.srgb)}*(1.-.10*sfRib)*(1.-.18*sfSeam);
        diffuseColor.rgb=mix(diffuseColor.rgb,sfMetal,sfM);
        diffuseColor.rgb=mix(diffuseColor.rgb,${linear(F.band.srgb)},sfB);`;
  const pbr = `
        roughnessFactor=mix(roughnessFactor,${f(F.field.roughness)},sfM);roughnessFactor=mix(roughnessFactor,${f(F.band.roughness)},sfB);
        metalnessFactor=mix(metalnessFactor,${f(F.field.metalness)},sfM);metalnessFactor=mix(metalnessFactor,${f(F.band.metalness)},sfB);`;
  return { color, pbr };
}

/** Silver frame: darken only pieces standing proud of this face (t 33.45..33.72, s 104..184.4) inside the band. */
export function eerSouthBandFrameGLSL(origin: T.Vector3, east: T.Vector3, p: string, n: string) {
  const F = EER_SOUTH_FIELD;
  const color = `
        // EER south outer face band (eer-south-field.ts): frame pieces crossing the dark band take the band tone.
        ${frameGLSL(origin, east, p, n)}
        float sfB=sfIn*step(${f(F.frameT[0])},sfT)*step(sfT,${f(F.frameT[1])})*sfBand;
        diffuseColor.rgb=mix(diffuseColor.rgb,${linear(F.band.srgb)},sfB);`;
  const pbr = `
        roughnessFactor=mix(roughnessFactor,${f(F.band.roughness)},sfB);metalnessFactor=mix(metalnessFactor,${f(F.band.metalness)},sfB);`;
  return { color, pbr };
}
