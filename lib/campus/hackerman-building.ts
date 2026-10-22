import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CutVolume } from './clip-volume';
import { createCampusGlass } from './campus-glass';
import { createHackermanLowerWindow, annotateHackermanLowerWindow } from './hackerman-lower-window';

/** UT's actual NHB polygon, not City footprint 655081 (which merges neighbors).
 * Projected with the existing campus origin and SZ=110851, in metres.
 */
export const hackermanFootprint = [
  [-103.259,-185.413],[-103.020,-188.133],[-61.000,-184.441],[-61.226,-181.861],
  [-51.126,-180.973],[-41.948,-180.167],[-7.501,-177.138],[-9.840,-150.472],
  [-64.311,-155.257],[-109.959,-159.267],[-157.997,-163.486],[-157.604,-167.965],
  [-160.957,-168.259],[-160.786,-170.205],[-161.134,-170.235],[-159.669,-186.938],
  [-159.548,-186.927],[-159.237,-190.469],[-108.442,-186.008],[-108.454,-185.869],
] as const;

export const hackermanFrame = {
  southeast: [-9.8397802555, -150.4720415752] as const,
  west: [-.996164177786, -.087503890742] as const,
  north: [.087503890742, -.996164177786] as const,
  width: 148.7274,
  depth: 26.768,
};

export type HackermanOptions = {
  /** Optional caller-owned, sRGB Tiles139 color map already used on Main east.
   * Only its joint-free mineral inset is sampled. This builder never disposes it. */
  stoneTexture?: THREE.Texture;
  /** Borrowed existing sky PMREM for only the lower recessed bays. */
  lowerWindowEnvironment?: THREE.Texture | null;
  lowerWindowEnvironmentIntensity?: number;
  /** World Y of the entrance threshold; never player-center Y. */
  baseElevation?: number;
  /** Height above threshold of the open canopy, independently configurable. */
  canopyHeight?: number;
  /** Top of the rear service penthouse above the entrance threshold. */
  penthouseHeight?: number;
  /** Small scan registration margin, applied around footprint edges only. */
  clearancePadding?: number;
  /** World translation for scan registration. No implicit GIS reorientation. */
  offset?: readonly [number, number];
};

function masonry(kind: 'stone' | 'brick', mineralTexture?: THREE.Texture) {
  const mat = new THREE.MeshStandardMaterial({
    // Trial albedos informed by the same NHB reference photos; not measured
    // reflectance. Avoid chalk-white stone and orange painted-looking brick.
    color: kind === 'stone' ? 0xb5b0a3 : 0xa68c68,
    roughness: kind === 'stone' ? .89 : .92,
    map: kind === 'stone' ? mineralTexture ?? null : null,
  });
  mat.name = `NHB ${kind === 'stone' ? 'buff limestone' : 'warm running-bond brick'}`;
  mat.onBeforeCompile = shader => {
    if(shader.vertexShader.includes('varying vec2 vNhbMetres;'))return;
    for(const token of ['#include <color_fragment>','#include <normal_fragment_maps>','#include <roughnessmap_fragment>'])
      if(!shader.fragmentShader.includes(token))throw new Error('NHB masonry requires the installed Three shader chunks');
    if(!shader.vertexShader.includes('#include <uv_vertex>'))throw new Error('NHB masonry requires metric UV injection');
    shader.vertexShader = 'varying vec2 vNhbMetres;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvNhbMetres=uv;');
    shader.fragmentShader = `varying vec2 vNhbMetres;
      float nhbHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float nhbNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(nhbHash(i),nhbHash(i+vec2(1,0)),f.x),mix(nhbHash(i+vec2(0,1)),nhbHash(i+vec2(1,1)),f.x),f.y);}
      vec3 nhbNormal(vec3 p,vec3 n,float h,float face){
        vec3 dx=dFdx(p),dy=dFdy(p),r1=cross(dy,n),r2=cross(n,dx);float d=dot(dx,r1)*face;
        if(abs(d)<1e-10)return n;
        return normalize(abs(d)*n-sign(d)*(dFdx(h)*r1+dFdy(h)*r2));
      }
    ` + shader.fragmentShader;
    const surface = kind === 'brick' ? `
      vec2 p=vNhbMetres,q=p/vec2(.225,.075);q.x+=mod(floor(q.y),2.)*.5;
      vec2 edge=min(fract(q),1.-fract(q))*vec2(.225,.075),aa=max(fwidth(p),vec2(.0001));
      float nhbFootprint=max(aa.x,aa.y),nhbFineFade=1.-smoothstep(.0015,.012,nhbFootprint);
      float body=smoothstep(.0027,.0027+aa.x,edge.x)*smoothstep(.0027,.0027+aa.y,edge.y);
      float tone=nhbHash(floor(q)),warm=nhbHash(floor(q)+vec2(8.7,19.3));
      float nhbMineral=nhbNoise(p*vec2(18.,39.)),nhbFine=nhbNoise(p*260.)-.5;
      vec3 nhbFace=(.86+.23*tone)*mix(vec3(.98,1.01,1.04),vec3(1.055,.99,.92),warm);
      // Pale, quiet mortar and small firing variation, not black painted lines.
      diffuseColor.rgb*=mix(vec3(1.06,1.10,1.10),nhbFace,body)*(1.+(nhbMineral-.5)*.045+nhbFine*.035*nhbFineFade);
      float nhbHeight=body*.0014+nhbFine*.0001*nhbFineFade;
    ` : `
      vec2 p=vNhbMetres,q=p/vec2(1.18,.60);
      vec2 edge=min(fract(q),1.-fract(q))*vec2(1.18,.60);
      float nhbFootprint=max(max(fwidth(p.x),fwidth(p.y)),.0001);
      float joint=1.-smoothstep(.0013,.0013+nhbFootprint,min(edge.x,edge.y));
      float tone=nhbHash(floor(q)),nhbMineral=nhbNoise(p*vec2(3.1,5.3));
      float nhbStreak=nhbNoise(p*vec2(4.7,.47)),nhbFine=nhbNoise(p*180.)-.5;
      float nhbFineFade=1.-smoothstep(.002,.012,nhbFootprint);
      // Smooth dressed panels: restrained mineral tone and vertical weathering.
      diffuseColor.rgb*=(.977+.046*tone)*(1.-joint*.11)
        *(1.+(nhbMineral-.5)*.055+(nhbStreak-.5)*.032+nhbFine*.025*nhbFineFade);
      float nhbHeight=-joint*.0007+nhbFine*.00012*nhbFineFade;
      #ifdef USE_MAP
        // Borrow only the already-reviewed joint-free inset region; the full
        // Tiles139 image contains an unrelated tile grid and a warmer tint.
        vec2 nhbMirror=1.-abs(fract(p/.546875)*2.-1.);
        vec2 nhbTextureUv=vec2(.5146484375,.8486328125)+nhbMirror*.13671875;
        vec3 nhbSample=textureGrad(map,nhbTextureUv,dFdx(nhbTextureUv),dFdy(nhbTextureUv)).rgb;
        float nhbSampleTone=dot(nhbSample,vec3(.2126,.7152,.0722));
        diffuseColor.rgb*=mix(1.,clamp(nhbSampleTone/.4071024629,.72,1.24),.38);
        nhbHeight+=(nhbSampleTone-.4071024629)*.00035*(1.-smoothstep(.004,.016,nhbFootprint));
      #endif
    `;
    if(kind==='stone')shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','// NHB samples only the borrowed joint-free mineral inset below.');
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>\n${surface}`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
      roughnessFactor=clamp(roughnessFactor+(nhbMineral-.5)*.055,.80,.98);`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\nnormal=nhbNormal(-vViewPosition,normal,nhbHeight,faceDirection);');
  };
  mat.customProgramCacheKey=()=>`nhb-${kind}-photo-material-v3`;
  return mat;
}

/** Photo-informed six-story exterior, made entirely from native geometry/PBR.
 * Exact corner position follows UT GIS; heights and facade rhythms are authored.
 * No clipping is activated. Inspect candidateClearanceVolumes before integration.
 */
export function buildHackermanBuilding(options: HackermanOptions = {}) {
  const base=options.baseElevation??4.74, canopy=options.canopyHeight??31.36;
  const penthouse=options.penthouseHeight??37.46;
  const clearancePadding=options.clearancePadding??.6;
  const [offsetX,offsetZ]=options.offset??[0,0];
  if (![base,canopy,penthouse,clearancePadding,offsetX,offsetZ].every(Number.isFinite)||canopy<27||canopy>43||penthouse<canopy||penthouse>50||clearancePadding<0||clearancePadding>1.5)
    throw new Error('Invalid Hackerman datum or canopy height');
  const scaleY=canopy/33.2;
  const materials={
    stone:masonry('stone',options.stoneTexture), brick:masonry('brick'),
    glass:createCampusGlass({roughness:.065,ior:1.60,interiorLevel:.018,interiorVariation:.10}),
    darkGlass:createCampusGlass({roughness:.095,ior:1.52,interiorLevel:.0065,interiorVariation:.12}),
    lowerGlass:createHackermanLowerWindow({envMap:options.lowerWindowEnvironment,envMapIntensity:options.lowerWindowEnvironmentIntensity}),
    mullion:new THREE.MeshStandardMaterial({color:0x9da49d,metalness:.68,roughness:.3}),
    canopy:new THREE.MeshStandardMaterial({color:0xd7d4c8,metalness:.28,roughness:.55}),
    shadow:new THREE.MeshStandardMaterial({color:0x3d4545,roughness:.95}),
    roof:new THREE.MeshStandardMaterial({color:0x777773,roughness:.95}),
    serviceScreen:new THREE.MeshStandardMaterial({color:0x8e8a7f,roughness:.67,metalness:.32}),
    planter:new THREE.MeshStandardMaterial({color:0x584c3d,roughness:.87}),
    foliage:new THREE.MeshStandardMaterial({color:0x506439,roughness:.95}),
  };
  materials.glass.name='NHB blue curtain glazing';materials.darkGlass.name='NHB recessed ground glazing';
  materials.mullion.name='NHB silver mullions';materials.canopy.name='NHB ivory open roof screen';
  materials.shadow.name='NHB dark window reveals';materials.roof.name='NHB flat roof';
  materials.planter.name='NHB terrace planters';materials.foliage.name='NHB terrace planting';
  materials.serviceScreen.name='NHB corrugated mechanical screen';
  // CO Architects N1586: the penthouse is vertically fluted metal, not a blank
  // ivory slab. Metric, derivative-filtered corrugation avoids tiny draw calls.
  materials.serviceScreen.onBeforeCompile=shader=>{
   if(shader.vertexShader.includes('varying vec2 nhbScreenUv;'))return;
   shader.vertexShader='varying vec2 nhbScreenUv;\n'+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nnhbScreenUv=uv;');
   shader.fragmentShader='varying vec2 nhbScreenUv;\n'+shader.fragmentShader;
   shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
    float rib=nhbScreenUv.x/0.16,fade=1.-clamp(fwidth(rib)*1.3,0.,1.);
    float wave=cos(rib*6.2831853),nhbScreenHeight=wave*.006*fade;
    diffuseColor.rgb*=1.-.13*(.5+.5*wave)*fade;`);
   shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
    vec3 dx=dFdx(-vViewPosition),dy=dFdy(-vViewPosition),r1=cross(dy,normal),r2=cross(normal,dx);
    float det=dot(dx,r1);normal=normalize(abs(det)*normal-sign(det)*(dFdx(nhbScreenHeight)*r1+dFdy(nhbScreenHeight)*r2));`);
  };materials.serviceScreen.customProgramCacheKey=()=> 'nhb-ribbed-screen-v1';
  // Both glass batches use the existing dielectric Fresnel/sky shader. The
  // reference's blue changes with reflection; it is not a metallic blue paint.
  // No local capture is introduced and the scene illumination is untouched.
  const matList:THREE.Material[]=Object.values(materials);
  const batches=new Map<THREE.Material,THREE.BufferGeometry[]>();
  const origin=new THREE.Vector3(hackermanFrame.southeast[0]+offsetX,base,hackermanFrame.southeast[1]+offsetZ);
  const west=new THREE.Vector3(hackermanFrame.west[0],0,hackermanFrame.west[1]);
  const north=new THREE.Vector3(hackermanFrame.north[0],0,hackermanFrame.north[1]);
  const matrix=new THREE.Matrix4().makeBasis(west,new THREE.Vector3(0,1,0),north).setPosition(origin);
  // West/up/north is right-handed. No reflected normals or back-face workaround.
  const yMatrix=new THREE.Matrix4().makeScale(1,scaleY,1);
  const transform=matrix.clone().multiply(yMatrix);
  const localPoint=(u:number,y:number,v:number)=>new THREE.Vector3(u,y,v).applyMatrix4(transform);
  let windows=0,roofBlades=0;
  const add=(g:THREE.BufferGeometry,mat:THREE.Material)=>{
    if(g.index){const original=g;g=g.toNonIndexed();original.dispose();}
    const p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv;
    for(let i=0;i<p.count;i++){
      const side=Math.abs(n.getX(i))>.7,top=Math.abs(n.getY(i))>.7;
      uv.setXY(i,side?p.getZ(i):p.getX(i),top?p.getZ(i):p.getY(i));
    }
    g.applyMatrix4(transform);
    if(!batches.has(mat))batches.set(mat,[]);batches.get(mat)!.push(g);return g;
  };
  const box=(u:number,y:number,v:number,w:number,h:number,d:number,mat:THREE.Material)=>{
    if(Math.min(w,h,d)<=0)throw new Error('NHB geometry must have positive dimensions');
    const g=new THREE.BoxGeometry(w,h,d);g.translate(u,y,v);return add(g,mat);
  };
  const beam=(a:THREE.Vector3,b:THREE.Vector3,r:number,mat:THREE.Material)=>{
    const delta=b.clone().sub(a),g=new THREE.CylinderGeometry(r,r,delta.length(),6,1);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()));
    g.translate(...a.clone().add(b).multiplyScalar(.5).toArray());add(g,mat);
  };
  const W=hackermanFrame.width,D=hackermanFrame.depth,B=10.8,brickTop=28.0;
  // Round 2 (b02, 2017 USGS 3DEP LiDAR, 0.5 m class-6 raster in the game frame; see
  // research/whole-campus-92/b02-sciences/derived/r2/nhb_*.py). Heights are metres above the threshold.
  //  - West of u=104.75 the building stops at the brick bar: roof Y31.38 (P10..P90 31.28..31.57),
  //    perimeter parapet Y32.81; no glazed top storey, no canopy, no penthouse there.
  //  - The Y42.2 LiDAR level is the screened mechanical penthouse, not the canopy: a solid first-return top
  //    over u 23.3..104.75, v 4.2..north face (and the rear extension), rising north (fit 40.83+0.0853 v,
  //    median |residual| 0.22 m). The open canopy itself measures Y35.5 and ends at u -0.7 / v -2.65.
  const UW=104.75,westRoof=26.64/scaleY,westParapet=28.07/scaleY;
  const penthouseSlope=.0853,penthouseV0=4.2,canopyEast=-.7,canopySouth=-2.65,canopyWest=UW; // LiDAR canopy end u~103.9 (+-0.5 m raster); run to UW so the step closes
  const penthouseTop=(v:number)=>(penthouse+penthouseSlope*(v-15.5))/scaleY;

  // Interior backstops and floor slabs close the exterior without invented rooms.
  box(W/2,5.35,D/2,W-1.5,10.7,D-3.2,materials.shadow);
  box((UW+24)/2,20.0,D/2,UW-24,18.4,D-3.2,materials.shadow);
  box((UW+W)/2,(B+westRoof-.3)/2,D/2,W-UW,westRoof-.3-B,D-3.2,materials.shadow);
  box(14.0,21.8,14.2,18.0,21.6,17.8,materials.shadow);
  for(const y of [.12,5.28,10.67])box(W/2,y,D/2,W,.24,D,materials.stone);

  // A real deep two-story limestone frame. Bottom and top rows use staggered
  // openings; glazing remains 0.62 m behind the stone face, not pasted onto it.
  const baseFace=(axis:'south'|'east'|'north'|'west',length:number,count:number)=>{
    const isLong=axis==='south'||axis==='north';
    const faceBox=(s:number,y:number,inset:number,w:number,h:number,depth:number,mat:THREE.Material)=>{
      if(axis==='south')return box(s,y,inset,w,h,depth,mat);
      else if(axis==='north')return box(s,y,D-inset,w,h,depth,mat);
      else if(axis==='east')return box(inset,y,s,depth,h,w,mat);
      else return box(W-inset,y,s,depth,h,w,mat);
    };
    const pitch=length/count;
    for(let row=0;row<2;row++){
      const y0=row*5.4,y1=y0+5.13;
      faceBox(length/2,y0+.22,.27,length,.44,.54,materials.stone);
      faceBox(length/2,y1,.27,length,.54,.54,materials.stone);
      for(let j=0;j<count;j++){
        const s=(j+.5)*pitch;
        const hero=!isLong||s<27;
        const wideSolid=hero&&((row===1&&j===1)||(row===0&&j===count-2));
        const pier=wideSolid?pitch*.72:hero?pitch*.34:pitch*.29;
        const width=pitch-pier,lo=y0+.43,hi=y1-.27,height=hi-lo;
        const glassS=s+pier/2;
        faceBox(j*pitch+pier/2,(lo+hi)/2,.40,pier,height,.8,materials.stone);
        const lowerPane=faceBox(glassS,(lo+hi)/2,.68,width,height,.09,materials.lowerGlass);
        const paneCenter=axis==='south'?localPoint(glassS,(lo+hi)/2,.635)
          :axis==='north'?localPoint(glassS,(lo+hi)/2,D-.635)
          :axis==='east'?localPoint(.635,(lo+hi)/2,glassS):localPoint(W-.635,(lo+hi)/2,glassS);
        const paneU=isLong?west:north;
        const paneOut=axis==='south'?north.clone().negate():axis==='north'?north
          :axis==='east'?west.clone().negate():west;
        annotateHackermanLowerWindow(lowerPane,paneCenter,paneU,paneOut,width,height*scaleY,
          ({south:0,east:1000,north:2000,west:3000}[axis])+row*100+j);
        for(const side of [-1,1])faceBox(glassS+side*(width/2-.028),(lo+hi)/2,.53,.056,height,.30,materials.mullion);
        faceBox(glassS,lo+1.1,.607,width,.042,.10,materials.mullion);
        // Sloping top reveal, visibly thick and shadowed at walking height.
        const depth=.67,thick=.16;
        // The lintel is a native box tilted around the horizontal facade axis.
        const g=new THREE.BoxGeometry(width,thick,depth);g.rotateX(-.23);g.translate(glassS,hi-.025,.34);
        if(axis==='north'){g.rotateY(Math.PI);g.translate(length,0,D);}
        else if(axis==='east'){g.rotateY(Math.PI/2);g.translate(0,0,length);}
        else if(axis==='west'){g.rotateY(-Math.PI/2);g.translate(W,0,0);}
        add(g,materials.stone);windows++;
      }
      faceBox(length-.1,(y0+y1)/2,.4,.2,y1-y0,.8,materials.stone);
    }
  };
  baseFace('south',W,45);baseFace('east',D,8);
  baseFace('north',W,42);baseFace('west',D,8);

  // Upper brick bar: three rows of paired, tall recessed openings, followed by
  // a recessed glazed top storey. The east corner is deliberately left glass.
  const brickFace=(northFace:boolean)=>{
    const start=northFace?7.0:24.0,end=W,n=Math.round((end-start)/6.0),pitch=(end-start)/n;
    const fv=northFace?D-.32:.32;
    const inset=(d:number)=>northFace?fv-d:fv+d;
    for(let row=0;row<3;row++){
      const low=B+row*(brickTop-B)/3,fh=(brickTop-B)/3,glassLow=low+.87,glassHigh=low+fh-.88;
      box((start+end)/2,(low+glassLow)/2,fv,end-start,glassLow-low,.65,materials.brick);
      box((start+end)/2,(glassHigh+low+fh)/2,fv,end-start,low+fh-glassHigh,.65,materials.brick);
      for(let j=0;j<n;j++){
        const c=start+(j+.5)*pitch,pairWidth=2.25,gap=.38,pane=(pairWidth-gap)/2;
        const edgeWidth=(pitch-pairWidth)/2;
        for(const side of [-1,1]){
          box(c+side*(pairWidth/2+edgeWidth/2),(glassLow+glassHigh)/2,fv,edgeWidth,glassHigh-glassLow,.65,materials.brick);
          const x=c+side*(gap/2+pane/2);
          box(x,(glassLow+glassHigh)/2,inset(.4),pane,glassHigh-glassLow,.055,materials.darkGlass);
          box(x,glassHigh-.4,inset(.10),pane,.8,.07,materials.glass);
          for(const dx of [-1,1])box(x+dx*(pane/2-.025),(glassLow+glassHigh)/2,inset(.24),.05,glassHigh-glassLow,.33,materials.mullion);
          box(x,glassLow+.06,inset(.22),pane,.12,.35,materials.brick);windows++;
        }
        box(c,(glassLow+glassHigh)/2,fv,gap,glassHigh-glassLow,.65,materials.brick);
      }
    }
    // The top floor sits behind the face, below the projecting roof grid.
    const topV=northFace?D-1.7:2.5;
    // Glazed top storey only where it exists (east of UW); the west end stops at the brick bar.
    box((start+UW)/2,30.54,topV,UW-start,4.45,.09,materials.darkGlass);
    for(let i=0;i<=n*2;i++){const u=start+i*(end-start)/(n*2);if(u<UW-.1)box(u,30.54,topV-.05,.11,4.5,.16,materials.mullion);}
  };
  brickFace(false);brickFace(true);
  // Small official-footprint extensions at the rear and west end are closed
  // massing, not additional invented NHB wings.
  const footprintExtensions=[[75.03,28.06,42.18,2.59],[150.43,15.63,3.40,22.26]] as const;
  footprintExtensions.forEach(([u,v,w,d],i)=>{
    box(u,5.4,v,w,10.8,d,materials.stone);
    const top=i===1?westRoof:33.0;
    box(u,(B+top)/2,v,w,top-B,d,materials.brick);
  });
  // Western return is lower-confidence but keeps the exterior closed.
  box(W-.25,(B+westParapet)/2,D/2,.5,westParapet-B,D,materials.brick);
  // West end (u > UW): roof deck at the measured Y31.4, brick parapets to Y32.8 on the south and north
  // faces, and a closing wall where the taller glazed-top-storey section steps up at UW.
  box((UW+W)/2,(brickTop+westParapet)/2,.32,W-UW,westParapet-brickTop,.65,materials.brick);
  box((UW+W)/2,(brickTop+westParapet)/2,D-.32,W-UW,westParapet-brickTop,.65,materials.brick);
  box((UW+W-.5)/2,westRoof-.135,D/2,W-.5-UW,.27,D-1.29,materials.roof);
  box(UW+.15,(westRoof+33.235)/2,D/2,.3,33.235-westRoof,D,materials.brick);
  // Rear/west faces seen from the 24th St/Speedway routes and from flight
  // were blank walls. Real NHB rear elevations repeat the front vocabulary
  // (CO N1586): slender deep stone-base openings and paired brick-bar windows.
  // The closed extensions are solid, so openings are built as projecting
  // surrounds around dark glass (0.15 m reveal) rather than cut holes.
  // Rhythm and sizes are estimates carried over from the south face.
  const proudWindow=(axis:'north'|'west',s:number,fixed:number,y0:number,y1:number,w:number,surround:THREE.Material)=>{
    const h=y1-y0,mid=(y0+y1)/2;
    const at=(along:number,y:number,out:number,wa:number,hh:number,depth:number,mat:THREE.Material)=>
      axis==='north'?box(along,y,fixed+out,wa,hh,depth,mat):box(fixed+out,y,along,depth,hh,wa,mat);
    at(s,mid,.03,w,h,.04,materials.darkGlass);
    for(const side of [-1,1])at(s+side*(w/2+.09),mid,.09,.18,h+.36,.18,surround);
    at(s,y1+.09,.09,w+.36,.18,.18,surround);
    at(s,y0-.07,.11,w+.56,.14,.22,surround);
    at(s,mid,.07,.05,h,.06,materials.mullion);
    at(s,y0+h*.62,.07,w,.04,.06,materials.mullion);
    windows++;
  };
  {
    const [cu,cv,cw,cd]=footprintExtensions[0],face=cv+cd/2,u0=cu-cw/2+1.2,u1=cu+cw/2-1.2;
    const baseCount=Math.round((u1-u0)/3.3),basePitch=(u1-u0)/baseCount;
    for(let row=0;row<2;row++)for(let j=0;j<baseCount;j++)
      proudWindow('north',u0+(j+.5)*basePitch,face,row*5.4+1.0,row*5.4+4.5,1.05,materials.stone);
    const pairs=Math.round((u1-u0)/6),pitch=(u1-u0)/pairs;
    for(let row=0;row<3;row++){
      const low=B+row*(brickTop-B)/3,fh=(brickTop-B)/3;
      for(let j=0;j<pairs;j++)for(const side of [-1,1])
        proudWindow('north',u0+(j+.5)*pitch+side*.75,face,low+.87,low+fh-.88,.95,materials.brick);
    }
    // Top storey ribbon under the roof, like the recessed glazed top floor.
    box(cu,30.4,face+.05,cw-1.0,3.6,.06,materials.darkGlass);
    for(let i=0;i<=Math.round((cw-1)/1.5);i++)box(cu-(cw-1)/2+i*(cw-1)/Math.round((cw-1)/1.5),30.4,face+.1,.08,3.7,.08,materials.mullion);
    box(cu,32.4,face+.12,cw-.6,.25,.2,materials.stone);
  }
  {
    const [cu,cv,cw,cd]=footprintExtensions[1],face=cu+cw/2,v0=cv-cd/2+1.0,v1=cv+cd/2-1.0;
    const n=Math.round((v1-v0)/3.9),pitch=(v1-v0)/n;
    for(let j=0;j<n;j++){
      const v=v0+(j+.5)*pitch;
      for(let row=0;row<2;row++)proudWindow('west',v,face,row*5.4+1.0,row*5.4+4.5,1.05,materials.stone);
      // Same three brick-bar rows as the main faces (the measured west roof is at the brick-bar top).
      for(let row=0;row<3;row++){const low=B+row*(brickTop-B)/3,fh=(brickTop-B)/3;proudWindow('west',v,face,low+.87,low+fh-.88,1.3,materials.brick);}
    }
  }

  // Four-storey blue corner: curtain wall planes meet at an actual corner.
  // Fine secondary transoms and larger floor rails are separate metal geometry.
  const glassLow=B+.18,glassHigh=32.95,glassU=2.85,glassV=2.85;
  const curtain=(axis:'south'|'east',start:number,end:number)=>{
    const count=Math.round((end-start)/1.35),pitch=(end-start)/count;
    const fb=(s:number,y:number,w:number,h:number,d:number,mat:THREE.Material,offset=0)=>{
      if(axis==='south')box(s,y,glassV+offset,w,h,d,mat);else box(glassU+offset,y,s,d,h,w,mat);
    };
    fb((start+end)/2,(glassLow+glassHigh)/2,end-start,glassHigh-glassLow,.07,materials.glass);
    for(let i=0;i<=count;i++)fb(start+i*pitch,(glassLow+glassHigh)/2,.055,glassHigh-glassLow,.14,materials.mullion,-.075);
    for(let floor=0;floor<=4;floor++){
      const y=glassLow+floor*(glassHigh-glassLow)/4;
      fb((start+end)/2,y,end-start,.065,.14,materials.mullion,-.075);
      if(floor<4)for(const dy of [.72,1.5,4.65])fb((start+end)/2,y+dy,end-start,.031,.115,materials.mullion,-.075);
    }
    windows+=count*4;
  };
  curtain('south',glassU,24.1);curtain('east',glassV,21.5);
  // Blank limestone core to the north of the east glazing, with its high slit.
  box(3.1,17.0,24.2,6.2,34.0,5.15,materials.stone);
  box(-.028,28.4,24.0,.065,4.2,1.05,materials.shadow);
  box(-.075,28.4,24.0,.06,3.94,.84,materials.darkGlass);
  box(3.3,33.82,24.2,6.7,.24,5.35,materials.stone);
  // Core north face: stacked stair-slot windows and a full-height reveal,
  // instead of a blank 34 m stone slab (photo-guided, positions estimated).
  for(let k=0;k<5;k++)proudWindow('north',3.1,26.775,12.0+k*4.3,14.7+k*4.3,.75,materials.stone);
  box(5.4,17.0,26.79,.07,33.6,.04,materials.shadow);
  box(-.02,17.0,22.3,.04,33.6,.07,materials.shadow);
  box(-.02,17.0,26.1,.04,33.6,.07,materials.shadow);

  // Terrace set-back is central to the silhouette: actual deck, glass guard,
  // metal top rail and low rectangular planted boxes around the glazed corner.
  box(13.5,10.95,12.0,27,.25,24,materials.stone);
  for(const axis of ['south','east'] as const){
    if(axis==='south'){
      box(13.1,11.52,.09,26.2,.88,.075,materials.darkGlass);
      box(13.1,12.0,.07,26.2,.055,.08,materials.mullion);
    }else{
      box(.09,11.52,10.6,.075,.88,21.2,materials.darkGlass);
      box(.07,12.0,10.6,.08,.055,21.2,materials.mullion);
    }
  }
  for(const [u,v,w,d] of [[6,1.35,7,1],[17,1.35,8,1],[1.35,8,1,7],[1.35,17,1,5]] as const){
    box(u,11.42,v,w,.62,d,materials.planter);
    box(u,11.75,v,w-.16,.16,d-.16,materials.foliage);
  }

  // Entry canopy and doors. No playable interiors are advertised; closed door
  // colliders remain flush with the recessed glass so approaches are walkable.
  box(6.65,2.98,-1.25,6.4,.2,3.1,materials.canopy);
  box(6.65,2.83,-1.22,5.9,.055,2.7,materials.shadow);
  for(let j=0;j<4;j++){
    const x=4.6+j*1.36;
    box(x,1.43,.59,1.25,2.72,.07,materials.darkGlass);
    for(const edge of [-1,1])box(x+edge*.60,1.43,.52,.065,2.72,.10,materials.mullion);
    box(x,2.78,.52,1.27,.075,.10,materials.mullion);
    box(x+.37,1.4,.445,.026,.63,.10,materials.mullion);
  }

  // L-shaped open screen: a long strip shades the south wall; its eastern
  // 31 m wraps over the glass corner. Every blade and its air gap is real.
  const screen=(u0:number,u1:number,v0:number,v1:number)=>{
    const rows=Math.round((v1-v0)/.31),spacing=(v1-v0)/rows;
    for(let j=0;j<=rows;j++){
      box((u0+u1)/2,33.2,v0+j*spacing,u1-u0,.115,.145,materials.canopy);roofBlades++;
    }
    for(const v of [v0,v1])box((u0+u1)/2,33.12,v,u1-u0,.24,.16,materials.canopy);
    const bays=Math.round((u1-u0)/4.5);
    for(let j=0;j<=bays;j++)box(u0+j*(u1-u0)/bays,32.99,(v0+v1)/2,.17,.3,v1-v0,materials.canopy);
  };
  screen(canopyEast,23.3,canopySouth,23.0);screen(23.3,canopyWest,canopySouth,3.6);
  // Main weatherproof roof is behind the open overhang, with a quiet service
  // penthouse. Triangular canopy stays are most visible against the sky.
  box((UW+26)/2,33.1,15.4,UW-26,.27,22.8,materials.roof);
  // Close the top of the glazed corner block under the open screen.
  box((glassU+26)/2,33.025,(glassV+D)/2,26-glassU,.15,D-glassV,materials.roof);
  // Screened mechanical penthouse (CO Architects: vertically fluted metal) over the measured footprint,
  // flush with the north face and the rear extension, its roof plane rising north as measured.
  const pentRing:[number,number][]=[[23.3,penthouseV0],[UW,penthouseV0],[UW,D],[96.12,D],[96.12,29.355],[53.94,29.355],[53.94,D],[23.3,D]];
  const pentBottom=33.0,pentWalls:number[]=[],pentRoof:number[]=[];
  const pushTri=(out:number[],a:number[],b:number[],c:number[],hint:number[])=>{
    const n=[(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]),(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]),(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])];
    if(n[0]*hint[0]+n[1]*hint[1]+n[2]*hint[2]<0)out.push(...a,...c,...b);else out.push(...a,...b,...c);
  };
  pentRing.forEach(([u0,v0],i)=>{
    const [u1,v1]=pentRing[(i+1)%pentRing.length],cu=pentRing.reduce((a,p)=>a+p[0],0)/pentRing.length,cv=pentRing.reduce((a,p)=>a+p[1],0)/pentRing.length;
    let hint=[v1-v0,0,-(u1-u0)];if(hint[0]*((u0+u1)/2-cu)+hint[2]*((v0+v1)/2-cv)<0)hint=hint.map(x=>-x);
    const a=[u0,pentBottom,v0],b=[u1,pentBottom,v1],c=[u1,penthouseTop(v1),v1],d=[u0,penthouseTop(v0),v0];
    pushTri(pentWalls,a,b,c,hint);pushTri(pentWalls,a,c,d,hint);
  });
  const pentShape=pentRing.map(([u,v])=>new THREE.Vector2(u,v));
  for(const [i,j,k] of THREE.ShapeUtils.triangulateShape(pentShape,[]))
    pushTri(pentRoof,...([i,j,k].map(n=>[pentRing[n][0],penthouseTop(pentRing[n][1]),pentRing[n][1]]) as [number[],number[],number[]]),[0,1,0]);
  const prism=(arr:number[])=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(arr,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(arr.length/3*2),2));g.computeVertexNormals();return g;};
  const pentWallGeometry=add(prism(pentWalls),materials.serviceScreen),pentRoofGeometry=add(prism(pentRoof),materials.roof);
  // Vertical posts on the long south screen and a thin cap along its sloped top edge line.
  for(let u=27;u<UW-1;u+=4.8)box(u,(pentBottom+penthouseTop(penthouseV0))/2,penthouseV0-.06,.065,penthouseTop(penthouseV0)-pentBottom,.11,materials.mullion);
  box((23.3+UW)/2,penthouseTop(penthouseV0)+.04,penthouseV0,UW-23.3+.2,.12,.24,materials.mullion);
  // Canopy stays only along the measured canopy; the rear leg lands on the penthouse screen.
  for(let u=1;u<canopyWest-1;u+=7){
    beam(new THREE.Vector3(u,33.3,canopySouth+.4),new THREE.Vector3(u,35.0,1.7),.048,materials.canopy);
    if(u>23.3)beam(new THREE.Vector3(u,35.0,1.7),new THREE.Vector3(u,35.0-1.7*(penthouseV0-1.7)/4.3,penthouseV0),.048,materials.canopy);
    else beam(new THREE.Vector3(u,35.0,1.7),new THREE.Vector3(u,33.3,6.0),.048,materials.canopy);
  }

  const meshes:THREE.Mesh[]=[],bounds=new THREE.Box3();
  for(const [mat,gs]of batches){
    const geometry=mergeGeometries(gs,false)!;for(const g of gs)g.dispose();
    geometry.computeBoundingBox();geometry.computeBoundingSphere();bounds.union(geometry.boundingBox!);
    const mesh=new THREE.Mesh(geometry,mat);mesh.name=mat.name;mesh.castShadow=true;mesh.receiveShadow=true;meshes.push(mesh);
  }
  // Simple closed envelope collisions, separate from high-detail glazing/louvers.
  const colliderGeometries:THREE.BufferGeometry[]=[];
  const collision=(u:number,y:number,v:number,w:number,h:number,d:number)=>{
    const g=new THREE.BoxGeometry(w,h,d);g.translate(u,y,v);g.applyMatrix4(transform);colliderGeometries.push(g);
  };
  // Envelope split so the recessed blue corner, terrace, roofs, core,
  // penthouse and open canopy agree with what is visible (<= 0.1 m on tops).
  const deck=11.075,roofTop=33.235;
  const solid=(u0:number,u1:number,y0:number,y1:number,v0:number,v1:number)=>collision((u0+u1)/2,(y0+y1)/2,(v0+v1)/2,u1-u0,y1-y0,v1-v0);
  solid(0,W,0,deck,0,D);
  solid(glassU-.03,24.1,deck,33.1,glassV-.03,D);
  solid(24.1,UW,deck,roofTop,0,D);
  solid(UW,W,deck,westRoof,0,D);
  solid(UW,W,brickTop,westParapet,-.005,.645);solid(UW,W,brickTop,westParapet,D-.645,D+.005);
  solid(W-.5,W,westRoof,westParapet,0,D);
  solid(UW,UW+.3,westRoof,roofTop,0,D);
  solid(0,6.2,0,34,21.625,26.775);
  colliderGeometries.push(pentWallGeometry.clone(),pentRoofGeometry.clone());
  // Walkable-from-the-air canopy grid: one thin plate midway between the
  // blade tops (33.26) and the bay beams below them (33.14).
  for(const [u0,u1,v0,v1] of [[canopyEast,23.3,canopySouth,23.0],[23.3,canopyWest,canopySouth,3.6]] as const)solid(u0,u1,33.08,33.2,v0,v1);
  // The official west/rear extensions project beyond the main envelope. Their
  // visible closed walls must also stop entry from the higher adjoining walks.
  footprintExtensions.forEach(([u,v,w,d],i)=>{
    collision(u,5.4,v,w,10.8,d);
    const top=i===1?westRoof:33.0;
    collision(u,(B+top)/2,v,w,top-B,d);
  });
  // Bound the replacement to NHB's official footprint; the main agent chooses
  // if/when to subtract this from the live scan. Canopy needs separate review.
  const footprint=hackermanFootprint.map(([x,z])=>new THREE.Vector2(x+offsetX,z+offsetZ));
  const triangles=THREE.ShapeUtils.triangulateShape(footprint,[]);
  const candidateClearanceVolumes:CutVolume[]=triangles.map(tri=>{
    const pts=tri.map(i=>new THREE.Vector3(footprint[i].x,base-.12,footprint[i].y));
    const center=pts.reduce((a,b)=>a.add(b),new THREE.Vector3()).multiplyScalar(1/3);
    const planes:THREE.Plane[]=[];
    for(let i=0;i<3;i++){
      const a=pts[i],b=pts[(i+1)%3],normal=new THREE.Vector3(b.z-a.z,0,a.x-b.x).normalize();
      const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(normal,a);
      if(plane.distanceToPoint(center)>0)plane.negate();planes.push(plane);
    }
    const top=base+penthouse+penthouseSlope*(29.355-15.5)+.18;
    planes.push(new THREE.Plane(new THREE.Vector3(0,-1,0),base-.12),new THREE.Plane(new THREE.Vector3(0,1,0),-top));
    const boxBounds=new THREE.Box3().setFromPoints(pts);boxBounds.max.y=top;
    return{planes,bounds:boxBounds};
  });
  // Edge-strip padding avoids expanding skinny triangulation planes into very
  // large wedges. Every padded piece is a finite rectangle.
  const orientedVolume=(center:THREE.Vector3,u:THREE.Vector3,v:THREE.Vector3,halfU:number,halfV:number,low:number,high:number):CutVolume=>{
    const planes:THREE.Plane[]=[];
    for(const [normal,half]of [[u,halfU],[v,halfV]] as const)for(const sign of [-1,1]){
      const n=normal.clone().multiplyScalar(sign),p=center.clone().addScaledVector(n,half);
      planes.push(new THREE.Plane().setFromNormalAndCoplanarPoint(n,p));
    }
    planes.push(new THREE.Plane(new THREE.Vector3(0,-1,0),low),new THREE.Plane(new THREE.Vector3(0,1,0),-high));
    const vertices:THREE.Vector3[]=[];
    for(const a of [-1,1])for(const b of [-1,1])for(const y of [low,high])vertices.push(center.clone().addScaledVector(u,a*halfU).addScaledVector(v,b*halfV).setY(y));
    return{planes,bounds:new THREE.Box3().setFromPoints(vertices)};
  };
  if(clearancePadding>0)for(let i=0;i<footprint.length;i++){
    const a=new THREE.Vector3(footprint[i].x,0,footprint[i].y),b=new THREE.Vector3(footprint[(i+1)%footprint.length].x,0,footprint[(i+1)%footprint.length].y);
    const u=b.clone().sub(a).normalize(),v=new THREE.Vector3(-u.z,0,u.x);
    candidateClearanceVolumes.push(orientedVolume(a.clone().add(b).multiplyScalar(.5),u,v,a.distanceTo(b)/2+clearancePadding,clearancePadding,base-.12,base+penthouse+penthouseSlope*(29.355-15.5)+.18));
  }
  // Narrow height bands clear the old canopy without opening a tall rectangular
  // hole beside the building or deleting ground underneath the overhang.
  const canopyClearanceVolumes:CutVolume[]=[];
  for(const [u0,u1,v0,v1]of [[-4.4,28.6,-4.9,23.6],[27.4,W+1.8,-4.9,4.2]] as const){
    canopyClearanceVolumes.push(orientedVolume(localPoint((u0+u1)/2,0,(v0+v1)/2),west,north,(u1-u0)/2,(v1-v0)/2,base+canopy-1.0,base+canopy+2.0));
  }
  const volumes:CutVolume[]=[];
  let disposed=false;
  const dispose=()=>{if(disposed)return;disposed=true;for(const mesh of meshes)mesh.geometry.dispose();for(const g of colliderGeometries)g.dispose();for(const mat of matList)mat.dispose();};
  return{
    meshes,materials,colliderGeometries,volumes,candidateClearanceVolumes,canopyClearanceVolumes,footprint,bounds,
    clearance:{enabledByDefault:false,footprintSource:'UT official NHB OBJECTID 429',minY:base-.12,maxY:base+penthouse+penthouseSlope*(29.355-15.5)+.18,scanPadding:clearancePadding,includesCanopyOverhang:false,canopyClearanceIsSeparate:true},
    landmarks:{southeast:localPoint(0,0,0),entrance:localPoint(6.65,0,-1.2),glassCorner:localPoint(glassU,B,glassV),canopyCorner:localPoint(canopyEast,33.2,canopySouth)},
    stats:{windows,roofBlades,drawCalls:meshes.length,triangles:meshes.reduce((n,m)=>n+m.geometry.attributes.position.count/3,0),baseElevation:base,canopyElevation:base+canopy},
    dispose,
  };
}
