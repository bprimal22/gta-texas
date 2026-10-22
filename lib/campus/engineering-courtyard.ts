import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CutVolume } from './clip-volume';
import type { TreePlacement } from './foreground-trees';
import { annotateGdcGlazing, createGdcGlazing } from './gdc-glazing';
import { buildPmaTowerFrontage } from './pma-frontage';
import { buildPmaLocalPodium } from './pma-local-podium';
import { eerSouthFieldGLSL, eerSouthBandFrameGLSL } from './eer-south-field';

// Aligned with the mapped walks 129071829 / 573368326, looking east from
// Speedway. s runs toward EER and t across the mall (positive = south).
const origin = new T.Vector3(32.1, 0, -252.35);
const east = new T.Vector3(1, 0, .089).normalize();
const south = new T.Vector3(-east.z, 0, east.x);
const basis = new T.Matrix4().makeBasis(east, new T.Vector3(0, 1, 0), south).setPosition(origin);
/** Engineering s/t frame -> campus matrix (local x=s, y=Y, z=t). */
export const engineeringCourtBasis = basis;
export const engineeringCourtPoint = (s: number, t: number, y = 0) =>
  new T.Vector3(s, y, t).applyMatrix4(basis);
export function engineeringCourtLocal(x: number, z: number) {
  const p = new T.Vector3(x - origin.x, 0, z - origin.z);
  return { s: p.dot(east), t: p.dot(south) };
}
export function inEngineeringCourt(x: number, z: number) {
  const { s, t } = engineeringCourtLocal(x, z);
  return s >= -4 && s <= 96 && t >= -11.5 && t <= 12;
}
function cut(s0: number, s1: number, t0: number, t1: number, low: number, high: number): CutVolume {
  const points = [[s0,t0],[s1,t0],[s1,t1],[s0,t1]].map(([s,t]) => engineeringCourtPoint(s,t));
  const center = engineeringCourtPoint((s0+s1)/2,(t0+t1)/2);
  const planes = points.map((p,i) => {
    const q = points[(i+1)%4];
    const plane = new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(q.z-p.z,0,p.x-q.x).normalize(),p);
    if (plane.distanceToPoint(center)>0) plane.negate();
    return plane;
  });
  const bounds = new T.Box3().setFromPoints(points); bounds.min.y=low; bounds.max.y=high;
  planes.push(new T.Plane(new T.Vector3(0,-1,0),low),new T.Plane(new T.Vector3(0,1,0),-high));
  return {planes,bounds};
}

/** Shared Speedway east edge north of the accepted corridor end (b03 request
 * b03-r4). The 30 ft (9.144 m, PWP) brick follows OSM 571500826 + 1036229280
 * (campus 22.7,-243.8 -> 29.7,-325.1 -> 33.0,-373.0); its east edge is the
 * centreline offset 4.572 m to the east. Returns the edge point at campus z.
 */
const speedwayNorth:[number,number][]=[[22.7,-243.8],[29.7,-325.1],[33.0,-373.0]];
export function speedwayNorthEastEdge(z:number):[number,number]{
  const i=z>speedwayNorth[1][1]?0:1,[a,b]=[speedwayNorth[i],speedwayNorth[i+1]];
  const k=(z-a[1])/(b[1]-a[1]),dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz);
  // Right-hand (east) normal of a northward (-z) segment is (-dz, dx)/l.
  return [a[0]+dx*k-dz/l*4.572,a[1]+dz*k+dx/l*4.572];
}
/** Engineering-side elevation (campus Y) at that shared edge, z -244..-366.
 * z -244..-264: the engineering court's west edge (this module's ground(),
 * which already follows the Speedway corridor height + 0.02 m); north of the
 * court: the baked terrain / PMA forecourt edge. b03's brick must meet these
 * values (+-0.03 m) along its east edge; measured by the b01 block check.
 */
// Measured from the built scene (b01 block check, 2026-10-20): court collider
// z-244..-264, terrain z-268..-280 and -316..-364, PMA forecourt z-284..-312.
const speedwayEdgeKnots:[number,number][]=[[-244,5.62],[-248,5.61],[-252,5.61],[-256,5.61],[-260,5.6],[-264,5.6],[-268,5.69],[-272,5.75],[-276,5.79],[-280,5.84],[-284,5.95],[-288,6.11],[-292,6.21],[-296,6.28],[-300,6.27],[-304,6.24],[-308,6.22],[-312,6.23],[-316,6.34],[-320,6.37],[-324,6.38],[-328,6.4],[-332,6.39],[-336,6.38],[-340,6.31],[-344,6.26],[-348,6.1],[-352,5.96],[-356,5.79],[-360,5.66],[-364,5.58]];
export function engineeringSpeedwayEdge(z:number){
  const k=speedwayEdgeKnots;
  if(z>=k[0][0])return k[0][1];
  for(let i=1;i<k.length;i++)if(z>=k[i][0])return T.MathUtils.lerp(k[i-1][1],k[i][1],(z-k[i-1][0])/(k[i][0]-k[i-1][0]));
  return k.at(-1)![1];
}

/** Photo-informed west mall and EER entrance exterior, not a surveyed model.
 * Leaves the independently calibrated southern walk, stairs and GLT bridge
 * intact. Only reconstructed ground/frontage receives source clearance.
 */
export function buildEngineeringCourtyard(
  approachHeight: (x: number, z: number) => number,
  sourceConcrete: T.MeshStandardMaterial,
  sourceGrass: T.MeshStandardMaterial,
  options: {photoFacades?:boolean;localPodium?:boolean} = {},
) {
  const materials: T.MeshStandardMaterial[] = [];
  const material = (name: string, color: number, roughness=.88, metalness=0) => {
    const m = new T.MeshStandardMaterial({color,roughness,metalness});
    m.name=name;materials.push(m);return m;
  };
  const concrete=sourceConcrete.clone();concrete.name='Engineering courtyard concrete';
  // Three does not clone shader callbacks; share the established route finish.
  concrete.onBeforeCompile=(shader,renderer)=>sourceConcrete.onBeforeCompile.call(concrete,shader,renderer);
  concrete.customProgramCacheKey=()=>sourceConcrete.customProgramCacheKey();materials.push(concrete);
  const grass=material('Engineering central lawn',0x829064,1);grass.map=sourceGrass.map;
  const soil=material('Engineering low planted strips',0x4e5735,1);
  const limestone=material('EER pale limestone panels',0xc8bfa9);
  const limestoneShade=material('EER alternating stone panels',0xc3baa5);
  const glass=material('EER blue gray glazing',0x365969,.21,.34);
  const darkGlass=material('EER recessed glazing',0x223b48,.28,.25);
  const shadow=material('EER closed interior backing',0x263237,1);
  const frame=material('EER silver mullions and braces',0xaeb7b5,.4,.58);
  const roof=material('EER parapet and roof',0x8e948f,.85);
  const lampMetal=material('Engineering globe lamp posts',0x515d55,.6,.4);
  const globe=material('Engineering lamp glass',0xe2e4dc,.4);
  const bench=material('Engineering bench slats',0x746453,.95);
  const reveal=material('EER floor reveals',0x5e625f,.9);
  const diagrid=material('EER white diagrid steel',0xe8eae5,.5,.15);
  const plant=material('EER rooftop plant enclosures',0x9ea29e,.82);
  const louvre=material('EER plant louvres',0x4f5559,.7,.2);
  const grating=material('EER screened plant well grating',0x2c3134,.85,.3);
  // White roof membrane of the tower roofs (accepted b01-r0-a2 overview); the court terrace/podium keep `roof`.
  const membrane=material('EER white roof membrane',0xd6d9d5,.9);
  // Fine stone grain stays subtle at walking height. Large color differences
  // between panels made the earlier wings look like a patchwork texture atlas.
  // eer-dataset-pass: the exterior photographs show faint vertical panel joints in the pale stone; drawn
  // procedurally (pixel-width aware, fading out where a joint would be sub-pixel) on vertical faces only.
  // b01-d02-eer-1 (eer-south-field.ts): appearance-only dark band + silver-grey ribbed metal field on the south tower's OUTER
  // face (t 33.5, s 104..184.4); same buffers, same colliders. Shader positions/normals are campus coordinates (identity meshes).
  const southField=eerSouthFieldGLSL(origin,east,'eerStonePosition','eerStoneNormal');
  for(const m of [limestone,limestoneShade]){
    m.onBeforeCompile=shader=>{
      shader.vertexShader='varying vec3 eerStonePosition;\nvarying vec3 eerStoneNormal;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\neerStonePosition=position;\neerStoneNormal=normal;');
      shader.fragmentShader='varying vec3 eerStonePosition;\nvarying vec3 eerStoneNormal;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
        float grain=sin(eerStonePosition.x*37.0+eerStonePosition.y*53.0)*sin(eerStonePosition.z*47.0-eerStonePosition.y*29.0);
        diffuseColor.rgb*=.99+.01*grain;
        vec3 sn=normalize(eerStoneNormal);
        if(abs(sn.y)<.5){
          float u=(abs(sn.x)>abs(sn.z)?eerStonePosition.z:eerStonePosition.x)/1.47,du=fwidth(u);
          float d=min(fract(u),1.-fract(u)),line=1.-smoothstep(.006,.006+du*1.5,d);
          diffuseColor.rgb*=1.-.07*line*(1.-smoothstep(.04,.12,du));
        }${southField.color}`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <metalnessmap_fragment>',`#include <metalnessmap_fragment>${southField.pbr}`);
    };
    m.customProgramCacheKey=()=> 'eer-subtle-limestone-v4-south-field';
  }
  // The silver mullions/braces keep their look everywhere except where south-face pieces cross the dark band.
  const bandFrame=eerSouthBandFrameGLSL(origin,east,'eerFramePosition','eerFrameNormal');
  frame.onBeforeCompile=shader=>{
    shader.vertexShader='varying vec3 eerFramePosition;\nvarying vec3 eerFrameNormal;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\neerFramePosition=position;\neerFrameNormal=normal;');
    shader.fragmentShader='varying vec3 eerFramePosition;\nvarying vec3 eerFrameNormal;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>${bandFrame.color}`)
      .replace('#include <metalnessmap_fragment>',`#include <metalnessmap_fragment>${bandFrame.pbr}`);
  };
  frame.customProgramCacheKey=()=> 'eer-silver-frame-south-band-v1';
  const photoGlass=options.photoFacades?createGdcGlazing('EER recessed photo-study glass'):null;
  const soffit=options.photoFacades?material('EER warm wood entrance soffit',0x94704a,.76):null;
  if(photoGlass)materials.push(photoGlass);
  // Court curtain walls: the same parallax room-box glazing, annotated per
  // face (horizontal along s, outward toward the court) instead of the west
  // facade's orientation. One extra material batch.
  const courtGlass=options.photoFacades?createGdcGlazing('EER court curtain wall glass'):null;
  if(courtGlass)materials.push(courtGlass);
  const batches=new Map<T.Material,T.BufferGeometry[]>(), solidParts:T.BufferGeometry[]=[];
  const add=(g:T.BufferGeometry,m:T.Material,solid=false)=>{
    const p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv;
    if(uv&&n)for(let i=0;i<p.count;i++)uv.setXY(i,
      Math.abs(n.getX(i))>.7?p.getZ(i):p.getX(i),Math.abs(n.getY(i))>.7?p.getZ(i):p.getY(i));
    if(m===photoGlass) {
      const seed=p.count+p.getX(0)*17+p.getY(0)*31+p.getZ(0)*11;
      annotateGdcGlazing(g,'z',south,east.clone().negate(),seed);
    }
    g.applyMatrix4(basis);
    if(!batches.has(m))batches.set(m,[]);batches.get(m)!.push(g);
    if(solid) {
      const physical=g.clone();
      // Per-field glass shading attributes are render-only; keep the merged
      // collider schema identical to the established position/normal/UV mesh.
      for(const key of Object.keys(physical.attributes))if(key.startsWith('gdcWindow'))physical.deleteAttribute(key);
      solidParts.push(physical);
    }
  };
  const box=(s:number,y:number,t:number,w:number,h:number,d:number,m:T.Material,solid=false)=>
    add(new T.BoxGeometry(w,h,d).translate(s,y,t),m,solid);
  const tube=(a:T.Vector3,b:T.Vector3,r:number,m:T.Material,solid=false)=>{
    const delta=b.clone().sub(a),g=new T.CylinderGeometry(r,r,delta.length(),8);
    g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize()));
    g.translate(...a.clone().lerp(b,.5).toArray());add(g,m,solid);
  };
  const height=(s:number,t:number)=>{
    const p=engineeringCourtPoint(s,t);
    return approachHeight(p.x,p.z);
  };
  const paved=(s:number,t:number)=>s<3||s>78||Math.abs(t)>7.7||Math.abs(s-18)<1.3||Math.abs(s-54)<1.3;
  // One continuous ground mesh per material. Matching physics comes from these
  // same triangles, including the lawn: there is no decorative floor over a void.
  const ground=(s0:number,s1:number,t0:number,t1:number,entrance=false)=>{
    const ns=Math.ceil((s1-s0)/.75),nt=Math.ceil((t1-t0)/.75);
    const terrainParts=new Map<T.Material,number[]>();
    const vertex=(s:number,t:number)=>new T.Vector3(s,entrance?7.15:height(s,t),t);
    const emit=(ps:T.Vector3[],m:T.Material)=>{
      if(!terrainParts.has(m))terrainParts.set(m,[]);
      for(const p of ps)terrainParts.get(m)!.push(...p.toArray());
    };
    for(let i=0;i<ns;i++)for(let j=0;j<nt;j++){
      const a=s0+(s1-s0)*i/ns,b=s0+(s1-s0)*(i+1)/ns;
      const c=t0+(t1-t0)*j/nt,d=t0+(t1-t0)*(j+1)/nt;
      const s=(a+b)/2,t=(c+d)/2;
      const m=entrance||paved(s,t)?concrete:Math.abs(t)>6.3?soil:grass;
      const p=vertex(a,c),q=vertex(b,c),r=vertex(a,d),v=vertex(b,d);
      emit([p,r,q,q,r,v],m);
    }
    const corners=[[s0,t0],[s1,t0],[s1,t1],[s0,t1]];
    for(let i=0;i<4;i++){
      const a=corners[i],b=corners[(i+1)%4],n=Math.ceil(Math.hypot(a[0]-b[0],a[1]-b[1]));
      for(let j=0;j<n;j++){
        const p=vertex(T.MathUtils.lerp(a[0],b[0],j/n),T.MathUtils.lerp(a[1],b[1],j/n));
        const q=vertex(T.MathUtils.lerp(a[0],b[0],(j+1)/n),T.MathUtils.lerp(a[1],b[1],(j+1)/n));
        const pl=p.clone().add(new T.Vector3(0,-2.5,0)),ql=q.clone().add(new T.Vector3(0,-2.5,0));
        emit([p,q,pl,q,ql,pl],concrete);
      }
    }
    for(const [m,positions] of terrainParts){
      const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(positions,3));
      g.setAttribute('uv',new T.Float32BufferAttribute(positions.flatMap((v,i)=>i%3===0?[v/2,positions[i+2]/2]:[]),2));
      g.computeVertexNormals();add(g,m,true);
    }
  };
  ground(-4,96,-11.5,12);
  // Connect the atrium apron to the end of the existing upper terrace.
  ground(96,115,-11.5,12,true);
  const volumes:CutVolume[]=[cut(-4,96,-11.5,12,-4,23),cut(96,115,-11.5,12,3,23)];

  const trees:TreePlacement[]=[];
  // Codex build-10 normal-control scooter replay + b01 court-walk rides (full ScooterClearance): oaks at
  // t±6.95 put low limbs over the walk edges (rider-clearance stops at stations 8N, 28N/S, 39S, 48N). The
  // allee now stands on the lawn edge (t±6.0); the station-48 north oak (the reported stop) is omitted.
  // Geometry and capsule colliders move together (one placement feeds both).
  for(const t0 of [-6.95,6.95])for(const [i,s] of [8,28,39,48,65,75].entries()){
    if(s===48&&t0<0)continue;
    const t=Math.sign(t0)*6;
    const p=engineeringCourtPoint(s,t,height(s,t)-.025);
    trees.push({x:p.x,y:p.y,z:p.z,rotation:(i+(t<0?2:0))*2.39996,
      scale:.86+.035*(i%3),width:.82,height:1.08});
  }
  // Narrow stone edging follows the actual grade; avoid tall barriers around
  // grass or placing trunks on either continuous walking strip.
  for(const t of [-6.3,6.3])for(let s=3;s<78;s++){
    if(Math.abs(s-18)<1.7||Math.abs(s-54)<1.7)continue;
    box(s+.5,height(s+.5,t)-.03,t,1,.1,.13,limestone);
  }
  let lamps=0,benches=0;
  for(const t of [-7.25,7.25])for(const s of [12,43,70]){
    const y=height(s,t);lamps++;
    tube(new T.Vector3(s,y,t),new T.Vector3(s,y+3.7,t),.055,lampMetal);
    box(s,y+.15,t,.22,.3,.22,lampMetal,true);
    add(new T.SphereGeometry(.22,10,8).scale(.8,1.25,.8).translate(s,y+3.85,t),globe);
    tube(new T.Vector3(s,y+4.08,t),new T.Vector3(s,y+4.25,t),.035,lampMetal);
  }
  for(const t of [-6.85,6.85])for(const s of [33,60]){
    const y=height(s,t);benches++;
    for(let j=0;j<4;j++)box(s,y+.46,t+(j-1.5)*.11,1.8,.055,.095,bench,true);
    for(const d of [-.66,.66])box(s+d,y+.23,t,.07,.46,.4,lampMetal,true);
  }

  // EER (main record 715399; the low south component 655276 stays a separate
  // generated record). Two limestone towers frame an upper OUTDOOR court that
  // sits on a lower enclosed three-storey atrium (Ennead section/photos).
  // Measured, same campus-Y datum (roofs-lidar = NAVD88-165, as the terrain):
  // tower roofs Y45.0 (groundY-2.9 + 47.9 m, 2125/2025 m2 tiers), court roof
  // screen Y38.6 (1429 m2), west entry terrace Y12.5, north low podium Y12.1.
  // Official 9 floors (UTDirect EER) = 7 above the high west entry (Y7.15) +
  // 2 exposed on the low east side ~10 m below; the per-floor split is an
  // estimate. Wing edges: official UT GIS 547 west face t-33.5..-11.3, LiDAR
  // tier edges for the court (t-10.8..9.6) and south face (t33.5).
  const base=7.15,floors=7,eerRoofY=45.0,top=eerRoofY-.52,floor=(top-base)/floors;
  const aN=-10.8,aS=9.6,aC=(aN+aS)/2,aW=aS-aN,deckY=12.5,screenY=38.6,eerFoot=-4.2,lowPodiumY=12.1;
  let windows=0,braces=0,photoRecesses=0,soffitSlats=0,courtMullions=0,courtGlassArea=0,courtWallArea=0;
  // Inner (court) elevations above the deck: broad floor-to-floor curtain wall
  // (Ennead 1012_Jeff-Goldberg-17 / 1012_AW-Final-19/-20, ennead.com/work/eerc)
  // replacing the round-1 opaque limestone with 0.82 m slits. The glass sits
  // glassSet behind the court line; pale slab bands and silver mullions stand
  // in front of it; the limestone core steps back courtRecess behind it.
  // Glazing proportions, band depth and mullion pitch are reference-interpreted.
  const courtRecess=.6,glassSet=.34,courtBand=.42,mullionPitch=1.5;
  const courtCurtainWall=(sA:number,sB:number,tE:number,inward:number)=>{
    const levels=[deckY];
    for(let f=1;f<=floors;f++){const y=base+f*floor;if(y>deckY+1)levels.push(y);}
    const L=sB-sA,sm=(sA+sB)/2,glassT=tE+inward*(glassSet+.03);
    for(let i=0;i+1<levels.length;i++){
      const y0=levels[i]+(i===0?.06:courtBand/2),y1=levels[i+1]-(i+2===levels.length?courtBand:courtBand/2);
      const g=new T.BoxGeometry(L,y1-y0,.06).translate(sm,(y0+y1)/2,glassT);
      if(courtGlass)annotateGdcGlazing(g,'x',east,south.clone().multiplyScalar(-inward),17+i*7+tE,Math.max(1,Math.round(L/6)));
      add(g,courtGlass??darkGlass,true);courtGlassArea+=L*(y1-y0);
    }
    for(let i=1;i<levels.length;i++){
      const y=i+1===levels.length?levels[i]-courtBand/2:levels[i];
      box(sm,y,tE+inward*(glassSet+.04)/2,L,courtBand,glassSet+.04,limestone,true);
    }
    box(sm,deckY+.03,tE+inward*(glassSet+.04)/2,L,.06,glassSet+.04,frame,true);
    for(let sm2=sA+mullionPitch;sm2<sB-.4;sm2+=mullionPitch){
      box(sm2,(deckY+top)/2,tE+inward*glassSet/2,.07,top-deckY,glassSet,frame,true);courtMullions++;
    }
    // Closed limestone returns at both ends of the stepped-back strip, so the
    // recess never shows as an open slot on the west or east elevation.
    for(const se of [sA+.2,sB-.2])box(se,(deckY+top)/2,tE+inward*courtRecess/2,.4,top-deckY,courtRecess,limestone,true);
    courtWallArea+=L*(top-deckY);
  };
  // West wing faces (eer-dataset-pass: ut-eer-547-engineering-2 / -directory-photo, read from the pixels):
  // single-storey slots staggered floor to floor (not continuous columns), the north wing's outer field
  // blank, the full-height blue strip at the atrium-side edge, and a blank top band (no windows on the top
  // storey) under the coping. Slot positions/widths are reference-interpreted, not surveyed.
  const slotOffsets=[0,.55,-.55,1.1,0,-1.1,.55];
  const photoWingFront=(t0:number,t1:number)=>{
    const width=t1-t0,inner=t0<0?t1:t0,north=t0<0;
    // Panelled field between the outer edge and the inner glass strip; the north wing's slots stay in the
    // inner 55 % of it (its outer field is blank in both photographs).
    const fieldA=north?t0+.6:t0+3.2,fieldB=north?t1-3.2:t1-.6,fieldW=fieldB-fieldA;
    const zoneA=north?fieldB-fieldW*.55:fieldA,zoneW=fieldB-zoneA,count=north?3:5,cell=zoneW/count;
    type Opening={left:number;right:number;low:number;high:number};
    const openings:Opening[]=[];
    let y=3.5;
    for(let f=0;f<floors;f++){
      const low=base+f*floor+.16,high=base+(f+1)*floor-.16,row:Opening[]=[];
      if(f<floors-1){
        // The continuous glazing at the inner corners is wider than the sparse
        // slit windows on the pale wing. Both now sit in real wall apertures.
        row.push({left:inner+(north?-2.45:.14),right:inner+(north?-.14:2.45),low,high});
        for(let j=0;j<count;j++){
          const w=(f+j)%3===1?.85:.62,c=zoneA+(j+.5)*cell+slotOffsets[(f*3+j*5)%7]*Math.min(1,cell/2.6);
          const x=T.MathUtils.clamp(c,zoneA+w/2+.1,zoneA+zoneW-w/2-.1);
          row.push({left:x-w/2,right:x+w/2,low,high});
        }
      }
      // Solid limestone: the band below this storey's openings, then the piers between them (per storey,
      // so staggered slots do not multiply the cell grid).
      if(low>y)box(104.6,(y+low)/2,(t0+t1)/2,1.2,low-y,width,limestone,true);
      let cursor=t0;
      for(const o of row.sort((a,b)=>a.left-b.left)){
        if(o.left>cursor+1e-4)box(104.6,(low+high)/2,(cursor+o.left)/2,1.2,high-low,o.left-cursor,limestone,true);
        cursor=o.right;
      }
      if(t1>cursor+1e-4)box(104.6,(low+high)/2,(cursor+t1)/2,1.2,high-low,t1-cursor,limestone,true);
      openings.push(...row);y=high;
    }
    if(top>y)box(104.6,(y+top)/2,(t0+t1)/2,1.2,top-y,width,limestone,true);
    for(const o of openings){const t=(o.left+o.right)/2,y=(o.low+o.high)/2,w=o.right-o.left,h=o.high-o.low;
      box(104.42,y,t,.07,h,w,photoGlass!,true);
      for(const tt of[o.left+.027,o.right-.027])box(104.18,y,tt,.48,h,.054,frame,true);
      for(const yy of[o.low+.027,o.high-.027])box(104.18,yy,t,.48,.054,w,frame,true);
      // Narrow dark horizontal transoms read the laboratory floor datum without
      // large bright exterior bands bisecting the limestone wall.
      box(104.35,o.low+h*.26,t,.09,.046,w,frame);windows++;photoRecesses++;
    }
    // Continuous dark floor reveals (clearly read in both photographs; the former 5.5 cm line did not).
    for(let f=1;f<floors;f++)box(103.985,base+f*floor,(t0+t1)/2,.03,.16,width,reveal);
  };
  for(const [t0,t1] of [[-34.5,aN],[aS,33.5]]){
    const center=(t0+t1)/2,width=t1-t0;
    const end=t0<0?153.5:184.4,depth=end-104;
    // Keep the mapped body and returns; replace only its front 1.2 m skin.
    // Foundation reaches below the low east/north grade (~-2.3..-3.5); the
    // former Y3.5 underside left a void above the San Jacinto-side terrain.
    // Above the deck the core steps back courtRecess from the court line,
    // behind the curtain wall built by courtCurtainWall().
    const inward=t0<0?-1:1,coreS=options.photoFacades?105.2:104;
    box((coreS+end)/2,(eerFoot+deckY)/2,center,end-coreS,deckY-eerFoot,width,limestone,true);
    box((coreS+end)/2,(deckY+top)/2,center+inward*courtRecess/2,end-coreS,top-deckY,width-courtRecess,limestone,true);
    if(options.photoFacades)photoWingFront(t0,t1);
    box((104+end)/2,top+.26,center,depth+.35,.52,width+.35,membrane,true);
    // Stable bays with narrow vertical glazing and continuous floor bands.
    // Small alternating offsets follow the photos without random panel sizes.
    const bays=Math.round(width/4.4),pitch=(width-1.2)/bays;
    if(!options.photoFacades)for(let f=0;f<floors;f++){
      const y=base+(f+.5)*floor;
      box(103.87,base+f*floor,center,.32,.15,width,frame);
      for(let j=0;j<bays;j++){
        const start=t0+.6+j*pitch,glassWidth=j===bays-1?1.15:.72;
        const windowT=start+pitch*(f%2?.60:.72);
        box(103.90,y,start+pitch/2,.18,floor-.21,pitch-.055,j%3?limestone:limestoneShade);
        box(103.77,y,windowT,.065,floor-.26,glassWidth,j===bays-1?glass:darkGlass);windows++;
        for(const side of [-1,1])box(103.70,y,windowT+side*(glassWidth/2+.035),.14,floor-.2,.065,frame);
        box(103.69,y-floor/2+.14,windowT,.18,.08,glassWidth+.14,frame);
      }
    }
    // Slit glazing stays on the OUTER (north/south exterior) returns only.
    const inner=t0<0?t1:t0;
    for(const edge of [t0<0?t0:t1])for(let f=0;f<floors;f++){
      const outward=edge===t0?-1:1,y=base+(f+.5)*floor;
      box((104+end)/2,base+f*floor,edge+outward*.065,depth,.15,.2,frame);
      // Same blank top storey as the west faces (plant level; reference-interpreted).
      if(f<floors-1)for(let s=106;s<end-1.5;s+=4.4){
        box(s,y,edge+outward*.075,.82,floor-.28,.10,darkGlass);windows++;
        for(const side of [-1,1])box(s+side*.45,y,edge+outward*.13,.065,floor-.2,.16,frame);
      }
      // Recessed atrium-side corner windows sit under the same floor datum.
      if(f===0)box(110,base+3.1,inner+(t0<0?.7:-.7),11,.16,1.45,roof);
    }
    courtCurtainWall(105.2,184.4,inner,inward);
    // Keep the source ground outside the narrow apron: clearing below these
    // wings would remove unsurveyed neighboring paths without replacing them.
    volumes.push(cut(102.5,end+.3,t0-.25,t1+.25,base+.05,70));
  }
  // Rear returns. Tower-height pieces follow the LiDAR Y45.0 tier; the north
  // low podium (s115..153.5, t-58.7..-34.5) is the measured Y12.1 tier, not a
  // full-height block. The old full-height central strip [116.4,184.4,-12,12]
  // closed the court; it is replaced below by the atrium/court/screen.
  for(const [s0,s1,t0,t1,y1] of [[153.5,184.4,-33.6,aN,top],[153.5,177.5,-38.5,-33.6,top],
    [115,153.5,-58.7,-34.5,lowPodiumY-.52]]){
    if(t1===aN){
      // North court return: same stepped-back core behind the curtain wall.
      box((s0+s1)/2,(eerFoot+deckY)/2,(t0+t1)/2,s1-s0,deckY-eerFoot,t1-t0,limestone,true);
      box((s0+s1)/2,(deckY+y1)/2,(t0+t1-courtRecess)/2,s1-s0,y1-deckY,t1-t0-courtRecess,limestone,true);
    }else box((s0+s1)/2,(eerFoot+y1)/2,(t0+t1)/2,s1-s0,y1-eerFoot,t1-t0,limestone,true);
    box((s0+s1)/2,y1+.26,(t0+t1)/2,s1-s0,.52,t1-t0,y1===top?membrane:roof,true);
    volumes.push(cut(s0-.25,s1+.25,t0-.25,t1+.25,base+.05,70));
  }
  // Tower roofs: rooftop plant and parapets measured from the 2017 USGS LiDAR DSM in this s/t frame
  // (research eer-dataset-pass/derived/eer_roof_dsm.py → eer_roof_dsm.json; roof median Y45.09 north /
  // 45.07 south). Footprints are the DSM blobs (0.5 m cells, >1 m above the roof), tops their P50; the
  // enclosure form (louvred boxes) is an estimate, cross-checked only against the photo-only roof
  // reference (live-reference/eer-roof-screen-photo-only). Solar arrays seen there are not modelled.
  // `top` is the parapet-free wall top (Y44.48); the roof cap's upper face is roofTop = Y45.0 (LiDAR tier).
  const roofTop=top+.52;
  for(const [s0,s1,t0,t1,y] of [
    [121,134,-22.5,-14.5,48.22],[118.5,122,-28.5,-22.5,46.67],
    [140,150.5,19.5,27,48.13],[149.2,152.3,18.5,23.4,47.45],[115,128.5,27,29.3,46.4],[118.5,124,12,14,46.34],
  ] as [number,number,number,number,number][]){
    box((s0+s1)/2,(roofTop+y)/2,(t0+t1)/2,s1-s0,y-roofTop,t1-t0,plant,true);
    // Louvre bands on the long faces (visual).
    for(let yy=roofTop+.45;yy<y-.25;yy+=.5)for(const tt of [t0-.02,t1+.02])box((s0+s1)/2,yy,tt,s1-s0-.3,.12,.04,louvre);
  }
  // Screened mechanical zones at the wing ends: dark gridded squares in the accepted b01-r0-a2 overview
  // (both ends of the north tower, both ends of the south tower). In the DSM the same zones mix
  // screen-top returns (Y46.2–46.7) with returns deep into wells (Y37–42; derived/eer_roof_wells.json),
  // i.e. open gratings over sunken plant wells. Modelled as a dark grating deck at the measured screen
  // level on a frame grid with louvred sides; the wells below are not modelled (the roof slab stays).
  // Zone extents are read from the overview + DSM well returns (estimates, ±1–2 m).
  let screenedArea=0;
  for(const [s0,s1,t0,t1] of [[105,118.5,-33.5,-12],[170,183.6,-32.8,-11.8],[105,113,12.5,28],[159,183.6,11.6,32.6]] as [number,number,number,number][]){
    const y=46.5;screenedArea+=(s1-s0)*(t1-t0);
    box((s0+s1)/2,y-.05,(t0+t1)/2,s1-s0,.1,t1-t0,grating,true);
    for(let s=s0+1.5;s<s1-.5;s+=3)box(s,y+.06,(t0+t1)/2,.14,.14,t1-t0,frame);
    for(let t=t0+1.5;t<t1-.5;t+=3)box((s0+s1)/2,y+.06,t,s1-s0,.14,.14,frame);
    // Louvred sides between the roof and the grating (solid; the player can stand on the deck).
    for(const [a,b,c,d] of [[s0,t0,s1,t0],[s0,t1,s1,t1],[s0,t0,s0,t1],[s1,t0,s1,t1]])
      box((a+c)/2,(roofTop+y-.1)/2,(b+d)/2,Math.max(.2,Math.abs(c-a)),y-.1-roofTop,Math.max(.2,Math.abs(d-b)),louvre,true);
  }
  // Parapets (LiDAR roof edges Y46.1–46.3 = ~1.1 m above the roof) around both tower outlines.
  const parapetH=1.15,pw=.35;
  const parapet=(sA:number,tA:number,sB:number,tB:number)=>box((sA+sB)/2,roofTop+parapetH/2,(tA+tB)/2,
    Math.max(pw,Math.abs(sB-sA)),parapetH,Math.max(pw,Math.abs(tB-tA)),roof,true);
  for(const [sA,tA,sB,tB] of [
    // north tower: west, outer (north, with the s153.5–177.5 bump), east, court side
    [104,-34.5,104,aN],[104,-34.5,153.5,-34.5],[153.5,-38.5,153.5,-34.5],[153.5,-38.5,177.5,-38.5],
    [177.5,-38.5,177.5,-33.6],[177.5,-33.6,184.4,-33.6],[184.4,-33.6,184.4,aN],[104,aN,184.4,aN],
    // south tower: west, court side, outer (south), east
    [104,aS,104,33.5],[104,aS,184.4,aS],[104,33.5,184.4,33.5],[184.4,aS,184.4,33.5],
  ] as [number,number,number,number][])parapet(sA,tA,sB,tB);
  // Lower enclosed atrium (three storeys from the low east side) whose roof is
  // the upper court deck. Deck level = measured west terrace Y12.5; that the
  // court floor continues at this level is reference-interpreted (section).
  box((116.4+179)/2,(eerFoot+deckY)/2,aC,179-116.4,deckY-eerFoot,aW,roof,true);
  // Low-side (east) atrium glazing behind the open east porch s179..184.4.
  box(179.06,(-2.6+deckY-.4)/2,aC,.08,deckY-.4+2.6,aW-.4,darkGlass);
  for(let t=aN+1.6;t<aS-1;t+=2.9)box(179.12,(-2.6+deckY-.4)/2,t,.12,deckY-.4+2.6,.08,frame);
  // Court furnishings: curved planted bed (north) and the pitched glazed
  // skylight over the lower atrium (south), Ennead photo 1012_Jeff-Goldberg-17.
  // Honest simplification of both shapes (no measured plan): a planted bed
  // whose court-side edge is a single smooth curve, and a ridged (pitched)
  // glass skylight prism. Sizes/heights are reference-interpreted estimates.
  const bedS0=120,bedS1=172,bedT=aN+1,bedPts:T.Vector2[]=[];
  for(let i=0;i<=16;i++){const s=bedS0+(bedS1-bedS0)*i/16;bedPts.push(new T.Vector2(s,bedT+2.4+1.8*Math.sin(Math.PI*i/16)));}
  bedPts.push(new T.Vector2(bedS1,bedT),new T.Vector2(bedS0,bedT));
  const prismY=(shape:T.Shape,y0:number,h:number)=>new T.ExtrudeGeometry(shape,{depth:h,bevelEnabled:false}).rotateX(Math.PI/2).translate(0,y0+h,0);
  add(prismY(new T.Shape(bedPts),deckY,.64),limestone,true);
  const soilPts=bedPts.map(v=>new T.Vector2(T.MathUtils.clamp(v.x,bedS0+.25,bedS1-.25),T.MathUtils.clamp(v.y,bedT+.25,v.y-.25)));
  add(prismY(new T.Shape(soilPts),deckY+.64,.03),soil);
  const skyT0=aS-7.3,skyT1=aS-1.5,skyS0=125,skyS1=175;
  const skyShape=new T.Shape([new T.Vector2(skyT0,0),new T.Vector2(skyT1,0),new T.Vector2(skyT1,.45),
    new T.Vector2((skyT0+skyT1)/2,1.55),new T.Vector2(skyT0,.45)]);
  add(new T.ExtrudeGeometry(skyShape,{depth:skyS1-skyS0,bevelEnabled:false}).rotateY(-Math.PI/2).translate(skyS1,deckY,0),glass,true);
  box((skyS0+skyS1)/2,deckY+1.58,(skyT0+skyT1)/2,skyS1-skyS0,.08,.16,frame);
  // Upper court roof screen (measured Y38.6), open beneath: transverse slats
  // on three girders. Every member is solid with colliders from its triangles.
  for(let s=105.4;s<184.4;s+=1.8)box(s,screenY-.25,aC,.16,.5,aW,frame,true);
  for(const t of [aN+.35,aC,aS-.35])box(144.9,screenY-.75,t,79.4,.5,.34,frame,true);
  // West end (Speedway face): white diagrid read from ut-eer-547-engineering-2 / -directory-photo pixels.
  // A continuous diamond lattice, three X's per band across the whole bay, four bands from the storey
  // above the terrace (base+2 floors) up to the screen girders, white floor chords, edge posts only (no
  // central post). The terrace storey below stays open. Pattern, member size and the band split are
  // reference-interpreted; the terrace (Y12.5) and screen (Y38.6) levels are the measured LiDAR tiers.
  {
    const sf=105.7,y0=base+2*floor,y1=screenY-1,bands=4,bandH=(y1-y0)/bands,nodes=[0,1,2,3].map(j=>aN+.5+j*(aW-1)/3);
    for(const t of [aN+.3,aS-.3])box(sf,(deckY+y1)/2,t,.5,y1-deckY,.5,diagrid,true);
    for(let k=0;k<=bands;k++)box(sf,y0+k*bandH,aC,.46,.36,aW,diagrid,true);
    for(let k=0;k<bands;k++)for(let j=0;j<3;j++){
      const ya=y0+k*bandH+.18,yb=y0+(k+1)*bandH-.18;
      tube(new T.Vector3(sf,ya,nodes[j]),new T.Vector3(sf,yb,nodes[j+1]),.14,diagrid,true);
      tube(new T.Vector3(sf,ya,nodes[j+1]),new T.Vector3(sf,yb,nodes[j]),.14,diagrid,true);braces+=2;
    }
    // Thin stays from the tower parapets down to the lattice top corners (visible against the sky in the
    // photograph; visual only, 45 m above grade).
    for(const [tw,tl] of [[aN-1.6,aN+.5],[aS+1.6,aS-.5]])tube(new T.Vector3(sf-.2,top+.4,tw),new T.Vector3(sf,y1+.2,tl),.04,diagrid);
  }
  // Open braced end frame at the east (low San Jacinto side) end of the court: no ground photograph in the
  // dataset, so the round-1/2 interpretation is kept.
  for(const sf of [184.0]){
    for(const t of [aN+.3,aC,aS-.3])box(sf,(deckY+screenY-1)/2,t,.5,screenY-1-deckY,.5,frame,true);
    const levels=[deckY+.15];
    for(let f=1;f<floors;f++){const y=base+f*floor;if(y>deckY+2&&y<screenY-2)levels.push(y);}
    levels.push(screenY-1);
    for(const y of levels.slice(1))box(sf,y,aC,.46,.32,aW,frame,true);
    for(let i=0;i+1<levels.length;i++)for(const [a,b] of [[aN+.5,aC-.2],[aC+.2,aS-.5]]){
      tube(new T.Vector3(sf,levels[i]+.2,a),new T.Vector3(sf,levels[i+1]-.2,b),.09,frame,true);
      tube(new T.Vector3(sf,levels[i]+.2,b),new T.Vector3(sf,levels[i+1]-.2,a),.09,frame,true);braces+=2;
    }
  }
  // Thin exterior sun screens on the exposed southern return, as visible in
  // the oblique reference. Batched geometry adds depth without new textures.
  for(let s=127;s<181;s+=3.5)box(s,(base+4+top-2)/2,33.95,.10,top-6-base,.8,frame);
  for(let y=base+4;y<top-2;y+=.6)box(154,y,34.25,54,.07,.35,roof);
  // West entrance: one storey of glazing (west entry Y7.15 to the terrace
  // underside) below the measured Y12.5 terrace, which continues as the court
  // deck. Above it the court is open behind the braced frame (no full-height
  // glass wall: the former 7-storey glazed plane closed an outdoor space).
  const glassTop=deckY-.62;
  box(115.7,(base+glassTop)/2,aC,1.4,glassTop-base,aW,shadow,true);
  if(options.photoFacades) {
    for(let j=0;j<7;j++)box(114.9,(base+glassTop)/2,aN+(j+.5)*aW/7,.10,glassTop-base,aW/7,photoGlass!);
  }else box(114.9,(base+glassTop)/2,aC,.10,glassTop-base,aW-.3,glass);
  for(let t=aN;t<=aS+1e-6;t+=aW/14)box(114.77,(base+glassTop)/2,t,.15,glassTop-base,.075,frame);
  box(114.56,base-.12,aC,.7,.22,aW,frame);
  // Entry terrace slab (top Y12.5, walkable roof with matching collider).
  box(109.25,deckY-.31,aC,11.7,.62,aW,roof,true);
  box(103.46,deckY-.31,aC,.12,.64,aW,frame);
  if(options.photoFacades) {
    // Real shallow timber strips provide the characteristic warm soffit.
    for(let t=aN+.2;t<aS-.1;t+=.29){box(109.4,deckY-.68,t,11.2,.105,.25,soffit!);soffitSlats++;}
    box(113.92,base+3.19,aC,2.25,.20,12.5,roof);
  }else box(113.9,base+3.35,aC,2.4,.32,aW,limestone);
  for(let t=-4.5;t<=4.5;t+=1.5){
    box(114.69,base+1.55,aC+t,.16,3,1.36,darkGlass);
    box(114.55,base+1.55,aC+t,.12,3,.045,frame);
    box(114.47,base+1.25,aC+t+.48,.07,.46,.045,frame);
  }
  volumes.push(cut(104,116.5,aN,aS,base-.4,63));

  // PMA: mapped stepped podium with two smooth towers. Window recesses and
  // vertical piers are geometry, based on the user's historical photograph;
  // tower heights and the podium/tower split remain approximate.
  const pmaStone=material('PMA pale warm masonry',0xc5aa88,.92);
  // ECJ is a separate concrete-frame building: same tone as before, but never the PMA brick coursing.
  const ecjStone=material('ECJ concrete frame',0xc5aa88,.92);
  // PMA fine buff brick (eer-dataset-pass, ut-pma-449-engineering-3 pixels: running bond, slight orange
  // variation, joints barely lighter). Procedural, US modular courses (0.0677 m, 0.2032 m bricks) on
  // vertical faces; pixel-width aware so the coursing fades instead of shimmering beyond ~25 m.
  // Horizontal faces (sills, caps) stay plain. Module is the standard size, not a survey.
  pmaStone.onBeforeCompile=shader=>{
    shader.vertexShader='varying vec3 pmaBrickP;\nvarying vec3 pmaBrickN;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\npmaBrickP=position;\npmaBrickN=normal;');
    shader.fragmentShader='varying vec3 pmaBrickP;\nvarying vec3 pmaBrickN;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      vec3 bn=normalize(pmaBrickN);
      if(abs(bn.y)<.5){
        float v=pmaBrickP.y/.0677,row=floor(v);
        float u=(abs(bn.x)>abs(bn.z)?pmaBrickP.z:pmaBrickP.x)/.2032+.5*mod(row,2.);
        vec2 f=fract(vec2(u,v)),w=fwidth(vec2(u,v));
        float ju=1.-smoothstep(.023,.023+w.x,min(f.x,1.-f.x)),jv=1.-smoothstep(.07,.07+w.y,min(f.y,1.-f.y));
        float joint=max(ju,jv),fade=1.-smoothstep(.12,.4,max(w.x,w.y));
        float id=fract(sin(dot(vec2(floor(u),row),vec2(12.9898,78.233)))*43758.5453);
        vec3 brick=diffuseColor.rgb*(.955+.09*id)*mix(vec3(1.),vec3(1.05,.97,.9),step(.86,id));
        vec3 mortar=mix(diffuseColor.rgb,vec3(dot(diffuseColor.rgb,vec3(.333))),.4)*1.06;
        diffuseColor.rgb=mix(diffuseColor.rgb,mix(brick,mortar,joint),fade);
      }`);
  };
  pmaStone.customProgramCacheKey=()=>'pma-fine-brick-v1';
  const pmaRecess=material('PMA dark recessed windows',0x273432,.48,.12);
  const pmaFootprint=[
    [81.71,-101.93],[81.69,-71.62],[77.33,-71.63],[77.34,-80.2],[54.11,-80.47],
    [54.11,-75.12],[48.46,-75.12],[48.46,-89.24],[45.93,-89.24],[45.93,-93.51],
    [9.75,-93.51],[9.75,-78.57],[8.09,-78.58],[8.09,-75.2],[9.83,-75.21],
    [9.84,-58.13],[54.61,-58.55],[54.53,-19.75],[66.43,-19.75],[66.43,-28.39],
    [77.66,-28.6],[77.66,-46.04],[73.07,-46.05],[73.07,-58.77],
    [154.52,-58.71],[154.55,-101.89],
  ];
  const podiumTop=10.5;
  const pmaGlass=material('PMA grouped blue-gray glazing',0x475854,.33,.24);
  const pmaFrame=material('PMA recessed bronze window frames',0x66655d,.55,.3);
  const pmaPodium=options.localPodium===false ? null : buildPmaLocalPodium(add,pmaFootprint as [number,number][],{stone:pmaStone,glass:pmaGlass,metal:pmaFrame});
  if (!pmaPodium) {
    const shape=new T.Shape(pmaFootprint.map(([s,t])=>new T.Vector2(s,-t)));
    add(new T.ExtrudeGeometry(shape,{depth:7.5,bevelEnabled:false}).rotateX(-Math.PI/2).translate(0,3,0),pmaStone,true);
  }
  const pmaPoints=pmaFootprint.map(([s,t])=>new T.Vector2(s,t));
  for(const ids of T.ShapeUtils.triangulateShape(pmaPoints,[])){
    const points=ids.map(i=>engineeringCourtPoint(...pmaFootprint[i] as [number,number]));
    const center=points.reduce((sum,p)=>sum.add(p),new T.Vector3()).multiplyScalar(1/3);
    const planes=points.map((p,i)=>{
      const q=points[(i+1)%3],plane=new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(q.z-p.z,0,p.x-q.x).normalize(),p);
      if(plane.distanceToPoint(center)>0)plane.negate();return plane;
    });
    const bounds=new T.Box3().setFromPoints(points);bounds.min.y=3.01;bounds.max.y=95;
    planes.push(new T.Plane(new T.Vector3(0,-1,0),3.01),new T.Plane(new T.Vector3(0,1,0),-95));
    volumes.push({planes,bounds});
  }

  const pmaFrontage=buildPmaTowerFrontage(add,pmaStone,pmaGlass,pmaFrame);
  // The photographed Speedway end wall has a projecting service-core blade.
  // Its position combines the mapped podium notch with retained wall samples;
  // depth and the small roof projection remain photo-informed estimates.
  box(9.05,39.25,-76.1,2.3,57.5,5.4,pmaStone,true);
  volumes.push(cut(7.9,10.2,-78.8,-73.4,10.5,68));
  // Back the corrected south-face strip with the complete closed tower skin.
  // This only clears the 1.7 m registration discrepancy above the podium.
  volumes.push(cut(9.9,48.1,-58.6,-56.9,10.5,68.1));
  let pmaWindows=pmaFrontage.stats.openings;
  // City footprint 716056 is a union of PMA and ECJ (Ernest Cockrell Jr. Hall).
  // The former generic "second PMA tower" s81.8..154.4 / Y54.5 is replaced by:
  //  - ECJ on the official UT GIS object 430 rectangle, main roof = measured
  //    LiDAR tier Y46.8 (1909 m2), penthouse Y51.9 (849 m2). 14 floors
  //    (UTDirect ECJ); above-podium floor split is an estimate.
  //  - the PMA east wing on official UT GIS 449 (s55.1..77.5, t-20.1..-61.4),
  //    measured LiDAR tier Y51.1 (1115 m2), formerly only the Y10.5 podium.
  // City-only union strips (s77.5..108.75 between the two, t<-95.5 north of
  // the official polygons) stay at the podium: LiDAR shows taller returns
  // there but no official identity; recorded as an open gap.
  const ecjRoofY=46.8,ecjPenthouseY=51.9,pmaWingRoofY=51.1,pmaCoreY=74.2;
  // Face-local box: u along edge a->b, y up, `out` = centre offset along the
  // outward normal (negative = behind the outer line). Same frame as round 1.
  type ST=[number,number];
  const faceBox=(a:ST,b:ST,u:number,y:number,width:number,h:number,depth:number,out:number,m:T.Material,solid=true)=>{
    const ds=b[0]-a[0],dt=b[1]-a[1],length=Math.hypot(ds,dt),nx=dt/length,nz=-ds/length;
    const g=new T.BoxGeometry(width,h,depth).rotateY(-Math.atan2(dt,ds));
    g.translate(a[0]+ds*u/length+nx*out,y,a[1]+dt*u/length+nz*out);add(g,m,solid);
  };
  // ECJ: deep egg-crate elevation (photo-only live captures pma-eer-photo-only-
  // south / engineering-north-100m: windows sit deep between full-height
  // concrete ribs and floor spandrels). Real geometry, but no per-window
  // pieces: one closed core, one recessed dark glazing plane per face,
  // full-height ribs and one spandrel band per floor. Bay pitch ~3.3 m and
  // the 0.95 m recess are reference-interpreted, not surveyed.
  const ecj={s0:108.75,s1:150.44,t0:-95.49,t1:-63.53,floors:10,recess:.95,bay:3.3,rib:.6};
  let ecjRibs=0,ecjSpandrels=0;
  {
    const {s0,s1,t0,t1,recess}=ecj,topY=ecjRoofY-.48,step=(topY-podiumTop)/ecj.floors;
    box((s0+s1)/2,(podiumTop+topY)/2,(t0+t1)/2,s1-s0-2*recess,topY-podiumTop,t1-t0-2*recess,ecjStone,true);
    box((s0+s1)/2,topY+.24,(t0+t1)/2,s1-s0+.18,.48,t1-t0+.18,ecjStone,true);
    const corners:ST[]=[[s0,t0],[s1,t0],[s1,t1],[s0,t1]];
    for(let edge=0;edge<4;edge++){
      const a=corners[edge],b=corners[(edge+1)%4],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
      const bays=Math.max(1,Math.round(length/ecj.bay)),pitch=length/bays;
      faceBox(a,b,length/2,(podiumTop+topY)/2,length-2*recess,topY-podiumTop,.05,-recess+.03,pmaRecess,false);pmaWindows+=bays*ecj.floors;
      for(let j=0;j<=bays;j++){
        const u=T.MathUtils.clamp(j*pitch,ecj.rib/2,length-ecj.rib/2);
        faceBox(a,b,u,(podiumTop+topY)/2,ecj.rib,topY-podiumTop,recess,-recess/2,ecjStone);ecjRibs++;
      }
      for(let f=0;f<=ecj.floors;f++){
        const y=f===ecj.floors?topY-.55:podiumTop+f*step+.55,h=1.1;
        faceBox(a,b,length/2,y,length-.1,h,recess-.18,-.18-(recess-.18)/2,ecjStone);ecjSpandrels++;
      }
    }
  }
  // PMA east wing: official UT GIS 449 outline extended north around the
  // core to the measured LiDAR Y51.1 tier (s55..73.7, t-61.4..-80.4; the
  // tier is 1115 m2, the round-1 GIS-only wing ~770 m2). The photo-only live
  // captures show a mostly BLANK service face toward the south with only a
  // few stacks of small punched windows, not a full window grid. Window stack
  // positions on the south faces follow those captures; the stacks on the
  // unseen east/west/north faces are estimates.
  const wing:ST[]=[[55,-80.4],[67.4,-80.4],[67.4,-72],[73.7,-72],[73.7,-46],[77.5,-46],[77.5,-28.6],[66.5,-28.6],
    [66.5,-20.1],[55.2,-20.1],[55.2,-61.4],[61.3,-61.4],[61.3,-72],[55,-72]];
  // Window-stack centres as a fraction of each edge (null = hidden against the core).
  const wingStacks:(number[]|null)[]=[[.5],[],[],[.35,.75],[],[.5],[.75],[],[.45],[.2,.5,.8],null,null,null,[]];
  const wingSkin=.4,wingTop=pmaWingRoofY-.48,wingStep=(wingTop-podiumTop)/10;
  let wingPunched=0;
  {
    const inset=wing.map((v,i)=>{
      const p=wing[(i+wing.length-1)%wing.length],n=wing[(i+1)%wing.length];
      const n1=[v[1]-p[1],-(v[0]-p[0])],n2=[n[1]-v[1],-(n[0]-v[0])];
      const l1=Math.hypot(n1[0],n1[1]),l2=Math.hypot(n2[0],n2[1]);
      return new T.Vector2(v[0]-wingSkin*(n1[0]/l1+n2[0]/l2),v[1]-wingSkin*(n1[1]/l1+n2[1]/l2));
    });
    add(prismY(new T.Shape(inset),podiumTop,wingTop-podiumTop),pmaStone,true);
    add(prismY(new T.Shape(wing.map(([s,t])=>new T.Vector2(s,t))),wingTop,.48),pmaStone,true);
    for(let edge=0;edge<wing.length;edge++){
      const stacks=wingStacks[edge];if(!stacks)continue;
      const a=wing[edge],b=wing[(edge+1)%wing.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
      const win=1.3,openings=stacks.map(f=>T.MathUtils.clamp(f*length,win/2+.6,length-win/2-.6));
      // Bands: full-length wall where no stack is open, otherwise wall pieces
      // between the stacks; small windows recessed by the skin depth.
      const lows:number[]=[],highs:number[]=[];
      for(let f=0;f<10;f++){lows.push(podiumTop+f*wingStep+1.15);highs.push(podiumTop+f*wingStep+2.75);}
      const levels=[...new Set([podiumTop,wingTop,...lows,...highs])].sort((x,y)=>x-y);
      for(let k=0;k+1<levels.length;k++){
        const lo=levels[k],hi=levels[k+1],mid=(lo+hi)/2,open=lows.some((l,i)=>mid>l&&mid<highs[i])&&openings.length;
        let left=0;
        if(open)for(const c of openings){
          faceBox(a,b,(left+c-win/2)/2,mid,c-win/2-left,hi-lo,wingSkin,-wingSkin/2,pmaStone);left=c+win/2;
        }
        faceBox(a,b,(left+length)/2,mid,length-left,hi-lo,wingSkin,-wingSkin/2,pmaStone);
      }
      for(const c of openings)for(let f=0;f<10;f++){
        faceBox(a,b,c,(lows[f]+highs[f])/2,win,highs[f]-lows[f],.05,-wingSkin+.03,pmaRecess,false);wingPunched++;pmaWindows++;
      }
    }
    // Roof mechanical setback: open-top louvred screen (1.8 m) around plant
    // units, set back from the parapets (100 m photo-only capture shows a
    // ribbed mechanical enclosure on this roof). Heights are estimates; the
    // open top keeps the measured Y51.1 roof surface inside it.
    const [m0,m1,n0,n1]=[57,71.5,-44,-31],screenH=1.8;
    for(const [ss,tt,w,dd] of [[(m0+m1)/2,n0,m1-m0,.12],[(m0+m1)/2,n1,m1-m0,.12],[m0,(n0+n1)/2,.12,n1-n0],[m1,(n0+n1)/2,.12,n1-n0]] as [number,number,number,number][]){
      box(ss,pmaWingRoofY+screenH/2,tt,w,screenH,dd,pmaFrame,true);
      for(let y=pmaWingRoofY+.3;y<pmaWingRoofY+screenH;y+=.3)box(ss,y,tt,w+(dd>w?.1:0),.06,dd+(w>dd?.1:0),pmaStone);
    }
    for(const [ss,tt] of [[66,-41],[66,-34.5]])box(ss,pmaWingRoofY+.7,tt,3.2,1.4,2.4,pmaFrame,true);
  }
  // ECJ rooftop penthouse (measured tier Y51.9) and the PMA service core
  // between the west tower and the east wing (measured tier Y74.2; the tall
  // core with antennas in the 2025 Ajay Suresh / UT News photograph).
  for(const [s0,s1,t0,t1,y0,y1] of [[112.6,146.7,-91.6,-67.4,ecjRoofY-.5,ecjPenthouseY],[45.9,61.3,-76.5,-61,podiumTop,pmaCoreY]]){
    box((s0+s1)/2,(y0+y1-.4)/2,(t0+t1)/2,s1-s0,y1-.4-y0,t1-t0,pmaStone,true);
    box((s0+s1)/2,y1-.2,(t0+t1)/2,s1-s0+.3,.4,t1-t0+.3,pmaStone,true);
  }
  // ECJ penthouse reads as the rooftop mechanical setback: dark louvre bands.
  for(const y of [47.7,48.7,49.7,50.7])for(const [ss,tt,w,dd] of [[129.65,-91.66,34.2,.12],[129.65,-67.34,34.2,.12],[112.53,-79.5,.12,24.3],[146.77,-79.5,.12,24.3]] as [number,number,number,number][])
    box(ss,y,tt,w,.55,dd,pmaFrame,true);
  const meshes:T.Mesh[]=[];
  for(const [m,parts] of batches){
    const flat=parts.map(g=>g.index?g.toNonIndexed():g),g=mergeGeometries(flat)!;
    const mesh=new T.Mesh(g,m);mesh.name=`Engineering courtyard: ${m.name}`;
    mesh.castShadow=mesh.receiveShadow=true;meshes.push(mesh);
    for(const part of new Set([...parts,...flat]))part.dispose();
  }
  const flatSolid=solidParts.map(g=>g.index?g.toNonIndexed():g);
  const colliderGeometries=[mergeGeometries(flatSolid)!];
  for(const part of new Set([...solidParts,...flatSolid]))part.dispose();
  // These three batches contain only ground() triangles; every triangle also
  // exists unchanged in the combined solid collider. Borrow their identities
  // for the offline terrain mask without treating decorative meshes as floors.
  const groundMeshes=meshes.filter(mesh=>mesh.material===concrete||mesh.material===grass||mesh.material===soil);
  return {meshes,groundMeshes,materials,colliderGeometries,volumes,trees,height,paved,
    stats:{eerRoof:{screenedArea:Math.round(screenedArea),plantBlocks:6},trees:trees.length,lamps,benches,windows,braces,photoRecesses,soffitSlats,courtMullions,courtGlassArea:Math.round(courtGlassArea),courtWallArea:Math.round(courtWallArea),ecjRibs,ecjSpandrels,wingPunched,pmaTowers:1,pmaEastWing:1,ecj:1,pmaWindows,pmaFrontage:pmaFrontage.stats,pmaPodium:pmaPodium?.stats,
      triangles:meshes.reduce((n,m)=>n+m.geometry.attributes.position.count/3,0)}};
}
