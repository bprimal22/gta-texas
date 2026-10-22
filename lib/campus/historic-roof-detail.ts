import * as T from 'three';

export interface HistoricRoofFace {
  /** Non-indexed broad roof vertices only, in the existing winding order. */
  start: number;
  count: number;
  eaveStart: T.Vector3;
  eaveEnd: T.Vector3;
}

/** UV-only chart: U follows this face's eave; V follows gravity down its plane.
 * Both coordinates are metres. The eave is V=0 and the ridge has negative V.
 * Each pair of triangles on one long hip uses the same origin and basis.
 */
export function setHistoricRoofMetreUV(geometry: T.BufferGeometry, faces: readonly HistoricRoofFace[]) {
  if (geometry.index) throw new Error('Historic roof UVs require the existing non-indexed broad faces');
  const p = geometry.getAttribute('position');
  const uv = new T.Float32BufferAttribute(new Float32Array(p.count * 2), 2);
  const covered = new Uint8Array(p.count);
  const point = new T.Vector3();
  for (const face of faces) {
    if (face.start < 0 || face.count < 3 || face.start % 3 || face.count % 3 || face.start + face.count > p.count) throw new Error('Invalid historic roof face range');
    const u = face.eaveEnd.clone().sub(face.eaveStart).normalize();
    const a = new T.Vector3().fromBufferAttribute(p, face.start);
    const b = new T.Vector3().fromBufferAttribute(p, face.start + 1);
    const c = new T.Vector3().fromBufferAttribute(p, face.start + 2);
    const n = b.sub(a).cross(c.sub(a)).normalize();
    const down = new T.Vector3(n.x * n.y, -1 + n.y * n.y, n.z * n.y).normalize();
    if (n.y <= 0 || down.y >= -.001 || Math.abs(u.y) > 1e-6 || Math.abs(u.dot(down)) > 1e-5) throw new Error('Historic roof needs an upward pitched plane with a level eave');
    for (let i = face.start; i < face.start + face.count; i++) {
      if (covered[i]) throw new Error('Historic roof UV face ranges overlap');
      covered[i] = 1;
      point.fromBufferAttribute(p, i).sub(face.eaveStart);
      uv.setXY(i, point.dot(u), point.dot(down));
    }
  }
  if (covered.some(value => value !== 1)) throw new Error('Historic roof UV ranges must cover every broad-face vertex');
  geometry.setAttribute('uv', uv);
}

const treated = new WeakSet<T.MeshStandardMaterial>();

/** Decorate the existing red-tile hook without changing its palette or resources.
 * Replace only its tile color block: unlike brick, barrel columns do not shift
 * sideways on alternating laps. Unresolved color detail tends to its area mean.
 * Call after the historic color hook is created and before the AO decorator.
 * No displacement, additional attributes, uniforms, textures or owned resources.
 */
export function applyHistoricRoofDetail(material: T.MeshStandardMaterial) {
  if (material.name !== 'Historic campus red tile') throw new Error('Historic roof detail requires the explicit red-tile material');
  if (treated.has(material)) return;
  const previous = material.onBeforeCompile.bind(material);
  const previousKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = function (shader, renderer) {
    previous(shader, renderer);
    if (shader.fragmentShader.includes('float hr64Height')) return;
    if (!shader.fragmentShader.includes('varying vec2 vHistoricMetres;')) throw new Error('Historic roof detail requires the existing metric color hook');
    const colorStart = 'vec2 q=vHistoricMetres/vec2(0.19,0.34);';
    const colorEnd = 'diffuseColor.rgb*=.87+.13*pow(.5+.5*cos(q.x*6.2831853),.7);';
    const start = shader.fragmentShader.indexOf(colorStart);
    const end = shader.fragmentShader.indexOf(colorEnd, start);
    if (start < 0 || end < start) throw new Error('Historic roof detail requires the known tile color block');
    shader.fragmentShader = shader.fragmentShader.slice(0, start) + `
      // One shared phase drives barrel color and surface-normal relief.
      vec2 hr64Q=vHistoricMetres/vec2(.19,.34);
      float hr64Pixel=max(max(fwidth(vHistoricMetres.x),fwidth(vHistoricMetres.y)),.00001);
      float hr64Fade=1.-smoothstep(.025,.080,hr64Pixel);
      float hr64ColorFade=1.-smoothstep(.012,.065,hr64Pixel);
      float hr64Barrel=cos(hr64Q.x*6.28318530718);
      vec2 hr64Edge=min(fract(hr64Q),1.-fract(hr64Q));
      float hr64Mortar=1.-smoothstep(.025,.025+max(max(fwidth(hr64Q.x),fwidth(hr64Q.y)),.0001),min(hr64Edge.x,hr64Edge.y));
      float hr64Tone=.93+.12*hcHash(floor(hr64Q));
      float hr64Color=hr64Tone*(1.-hr64Mortar*.10)*(.87+.13*pow(.5+.5*hr64Barrel,.7));
      // Mean of the original tone (.99), joint coverage and barrel response.
      // Filtering eliminates subpixel noise without darkening to broad mortar.
      // Small clay-batch differences survive when individual tiles merge.
      // Two smooth, balanced noise bands avoid a periodic wave or dirt mask.
      float hr64Clay=.047*hr64ClayNoise(vHistoricMetres/1.65+vec2(7.31,2.83))
        +.022*hr64ClayNoise(vec2(vHistoricMetres.x*.8-vHistoricMetres.y*.6,vHistoricMetres.x*.6+vHistoricMetres.y*.8)/3.75+vec2(21.17,13.41));
      diffuseColor.rgb*=mix(.92529778,hr64Color,hr64ColorFade)*(1.+hr64Clay);
    ` + shader.fragmentShader.slice(end + colorEnd.length);
    shader.fragmentShader = `
      float hcHash(vec2 p);
      // Mean-zero in expectation; signed corner values with cubic interpolation.
      // Fade each scale before its cell spans less than two output pixels.
      float hr64ClayNoise(vec2 q){
        vec2 i=floor(q),f=fract(q);f=f*f*(3.-2.*f);
        float a=hcHash(i)*2.-1.,b=hcHash(i+vec2(1.,0.))*2.-1.;
        float c=hcHash(i+vec2(0.,1.))*2.-1.,d=hcHash(i+vec2(1.))*2.-1.;
        float width=max(fwidth(q.x),fwidth(q.y));
        return mix(mix(a,b,f.x),mix(c,d,f.x),f.y)*(1.-smoothstep(.20,.50,width));
      }
    ` + shader.fragmentShader;
    for (const anchor of ['#include <roughnessmap_fragment>', '#include <normal_fragment_maps>']) {
      if (!shader.fragmentShader.includes(anchor)) throw new Error('Historic roof detail missing shader anchor: ' + anchor);
    }
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
      #include <roughnessmap_fragment>
      // Existing estimated module: 0.19 m across eave, 0.34 m down the slope.
      // Fade before either period is undersampled. Lap width includes pixel AA.
      float hr64LapDistance=abs(fract(vHistoricMetres.y/.34+.5)-.5)*.34;
      float hr64Lap=1.-smoothstep(.002,.016+hr64Pixel,hr64LapDistance);
      float hr64Height=(.0012*hr64Barrel-.00035*hr64Lap)*hr64Fade;
      roughnessFactor=clamp(roughnessFactor+(.014*hr64Lap-.012*hr64Barrel)*hr64Fade,.04,1.);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
      #include <normal_fragment_maps>
      // Surface-gradient bump in view space; render normals only, never geometry.
      vec3 hr64Dx=dFdx(-vViewPosition),hr64Dy=dFdy(-vViewPosition);
      vec3 hr64R1=cross(hr64Dy,normal),hr64R2=cross(normal,hr64Dx);
      float hr64Det=dot(hr64Dx,hr64R1)*faceDirection;
      vec3 hr64Gradient=sign(hr64Det)*(dFdx(hr64Height)*hr64R1+dFdy(hr64Height)*hr64R2);
      if(abs(hr64Det)>1e-10)normal=normalize(abs(hr64Det)*normal-hr64Gradient);
    `);
  };
  material.customProgramCacheKey = () => previousKey() + '|historic-roof-metric-relief-64-v3';
  material.needsUpdate = true;
  treated.add(material);
}
