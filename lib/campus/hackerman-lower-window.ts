import * as THREE from 'three';
import { createCampusGlass } from './campus-glass';

export interface HackermanLowerWindowOptions {
  /** Existing sky PMREM, borrowed; this helper creates no captures or textures. */
  envMap?: THREE.Texture | null;
  envMapIntensity?: number;
}

/** A small, empty shadow-box approximation behind the real recessed panes.
 * The view-dependent interior is analytical: no transparent sorting or scene
 * transmission pass, and no assertion that the actual room has this layout.
 * Existing Three dielectric reflections are preserved without a blue diffuse fill.
 */
export function createHackermanLowerWindow(options: HackermanLowerWindowOptions = {}) {
  const material = createCampusGlass({
    name: 'NHB lower recessed window depth', roughness: .085, ior: 1.56,
    interiorLevel: .0065, interiorVariation: .12,
    envMap: options.envMap, envMapIntensity: options.envMapIntensity ?? .45,
  });
  const previous = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    const output = 'outgoingLight = totalSpecular + campusInterior*(vec3(1.)-campusFresnel);';
    if (!shader.vertexShader.includes('#include <project_vertex>') || !shader.fragmentShader.includes(output)) {
      throw new Error('NHB lower windows require the installed campus glass shader');
    }
    shader.vertexShader = `
      attribute vec4 nhbRoomPane;
      attribute vec3 nhbRoomU;
      attribute vec3 nhbRoomOut;
      attribute float nhbRoomSeed;
      varying vec4 vNhbRoomPane;
      varying vec3 vNhbRoomU,vNhbRoomOut;
      varying float vNhbRoomSeed;
    ` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
      #include <project_vertex>
      vNhbRoomPane=nhbRoomPane;vNhbRoomU=nhbRoomU;
      vNhbRoomOut=nhbRoomOut;vNhbRoomSeed=nhbRoomSeed;
    `);
    shader.fragmentShader = `
      varying vec4 vNhbRoomPane;
      varying vec3 vNhbRoomU,vNhbRoomOut;
      varying float vNhbRoomSeed;
      float nhbRoomSafe(float d){return d<0. ? min(d,-.00001) : max(d,.00001);}
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(output, `
      // Coordinates are metres across each actual opening. The analytical
      // interior is only .75–1.05 m deep; the physical facade recess is unchanged.
      vec2 nhbRoomSize=max(vNhbRoomPane.zw,vec2(.05));
      vec2 nhbRoomP=clamp(vNhbRoomPane.xy,vec2(0.),nhbRoomSize);
      vec3 nhbRoomView=transformDirectionByInverseViewMatrix(normalize(vViewPosition),viewMatrix);
      vec3 nhbRoomDirection=vec3(-dot(nhbRoomView,vNhbRoomU),-nhbRoomView.y,
        max(dot(nhbRoomView,vNhbRoomOut),.0001));
      float nhbRoomDepth=.75+.30*campusGlassHash(vec2(vNhbRoomSeed,9.2));
      vec3 nhbRoomExit=vec3(
        (nhbRoomDirection.x<0.?-nhbRoomP.x:nhbRoomSize.x-nhbRoomP.x)/nhbRoomSafe(nhbRoomDirection.x),
        (nhbRoomDirection.y<0.?-nhbRoomP.y:nhbRoomSize.y-nhbRoomP.y)/nhbRoomSafe(nhbRoomDirection.y),
        nhbRoomDepth/nhbRoomDirection.z);
      float nhbRoomT=max(0.,min(nhbRoomExit.x,min(nhbRoomExit.y,nhbRoomExit.z)));
      vec3 nhbRoomHit=vec3(nhbRoomP,0.)+nhbRoomDirection*nhbRoomT;
      float nhbRoomBack=step(nhbRoomExit.z,min(nhbRoomExit.x,nhbRoomExit.y));
      float nhbRoomSide=(1.-nhbRoomBack)*step(nhbRoomExit.x,nhbRoomExit.y);
      float nhbRoomFloor=(1.-nhbRoomBack)*(1.-nhbRoomSide)*step(nhbRoomDirection.y,0.);
      float nhbRoomCeiling=(1.-nhbRoomBack)*(1.-nhbRoomSide)*(1.-nhbRoomFloor);
      // A dim neutral back wall, soft side return, floor and ceiling. No bright
      // furniture, invented room photos or repeating fluorescent-light stamps.
      vec3 nhbRoomTone=nhbRoomBack*vec3(.026,.029,.027)
        +nhbRoomSide*vec3(.039,.042,.039)
        +nhbRoomFloor*vec3(.044,.046,.040)
        +nhbRoomCeiling*vec3(.017,.020,.020);
      float nhbRoomVariation=.86+.25*campusGlassHash(vec2(vNhbRoomSeed,31.6));
      float nhbRoomEdge=min(min(nhbRoomHit.x,nhbRoomSize.x-nhbRoomHit.x),
        min(nhbRoomHit.y,nhbRoomSize.y-nhbRoomHit.y));
      float nhbRoomCorner=smoothstep(.015,.19,max(nhbRoomEdge,0.));
      nhbRoomTone*=nhbRoomVariation*mix(.76,1.,nhbRoomCorner);
      // A narrow back-wall structural edge is a low-confidence neutral proxy,
      // not an additional exterior mullion. It moves behind the glass at oblique views.
      float nhbRoomPostX=nhbRoomSize.x*(.24+.48*campusGlassHash(vec2(vNhbRoomSeed,7.7)));
      float nhbRoomAA=max(fwidth(nhbRoomHit.x),.001);
      float nhbRoomPost=1.-smoothstep(.018,.018+nhbRoomAA,abs(nhbRoomHit.x-nhbRoomPostX));
      nhbRoomTone+=vec3(.009,.010,.009)*nhbRoomPost*nhbRoomBack;
      campusInterior=nhbRoomTone;
      outgoingLight = totalSpecular + campusInterior*(vec3(1.)-campusFresnel);
      // A 15 mm glazing seal fixes the abrupt color-to-stone edge without
      // changing the opening width or adding hundreds of tiny geometry strips.
      float nhbRoomPaneEdge=min(min(nhbRoomP.x,nhbRoomSize.x-nhbRoomP.x),
        min(nhbRoomP.y,nhbRoomSize.y-nhbRoomP.y));
      float nhbRoomSealAA=max(max(fwidth(nhbRoomP.x),fwidth(nhbRoomP.y)),.0005);
      float nhbRoomSeal=1.-smoothstep(.015,.015+nhbRoomSealAA,nhbRoomPaneEdge);
      outgoingLight=mix(outgoingLight,vec3(.012,.014,.013),nhbRoomSeal*.88);
    `);
  };
  material.customProgramCacheKey = () => 'nhb-lower-window-shadow-box-v1';
  return material;
}

/** Attach metre coordinates to already-transformed vertices. No existing
 * positions, normals, UVs, indices or bounds are modified by this annotation.
 */
export function annotateHackermanLowerWindow(geometry: THREE.BufferGeometry,
  center: THREE.Vector3, u: THREE.Vector3, out: THREE.Vector3,
  width: number, height: number, seed: number) {
  if (![...center.toArray(),...u.toArray(),...out.toArray(),width,height,seed].every(Number.isFinite) ||
      width<=0 || height<=0 || Math.abs(u.length()-1)>.00001 || Math.abs(out.length()-1)>.00001 ||
      Math.abs(u.dot(out))>.00001 || Math.abs(u.y)>.00001 || Math.abs(out.y)>.00001) {
    throw new Error('Invalid NHB lower-window frame');
  }
  const position=geometry.attributes.position,count=position.count;
  const pane=new Float32Array(count*4),axes=new Float32Array(count*3),normals=new Float32Array(count*3),seeds=new Float32Array(count);
  const delta=new THREE.Vector3();
  for(let i=0;i<count;i++) {
    delta.fromBufferAttribute(position,i).sub(center);
    pane.set([delta.dot(u)+width/2,delta.y+height/2,width,height],i*4);
    axes.set(u.toArray(),i*3);normals.set(out.toArray(),i*3);seeds[i]=seed;
  }
  geometry.setAttribute('nhbRoomPane',new THREE.BufferAttribute(pane,4));
  geometry.setAttribute('nhbRoomU',new THREE.BufferAttribute(axes,3));
  geometry.setAttribute('nhbRoomOut',new THREE.BufferAttribute(normals,3));
  geometry.setAttribute('nhbRoomSeed',new THREE.BufferAttribute(seeds,1));
}
