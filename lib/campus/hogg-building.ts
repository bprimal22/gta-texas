import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import data from '../../public/data/hogg-plan.json' with { type: 'json' };
import type { CutVolume } from './clip-volume';

type Point=[number,number];
type Rings=Point[][];
const plan=data as unknown as {originXZ:Point;rotationRadians:number;localFootprint:Rings;localCore:Rings;officialFootprintXZ:Rings;fringeXZ:Rings[];defaultBaseHeight:number};
export type HoggBuildingOptions={baseHeight?:number;groundHeight?:(x:number,z:number)=>number;includeRegistrationFringe?:boolean};
function footprintShape(rings:Rings){const s=new T.Shape(rings[0].map(([x,z])=>new T.Vector2(x,-z)));s.holes=rings.slice(1).map(r=>new T.Path(r.map(([x,z])=>new T.Vector2(x,-z))));return s;}
function cutVolumes(rings:Rings,lo:number,hi:number):CutVolume[]{
 const vectors=rings.map(r=>r.map(p=>new T.Vector2(...p))),all=vectors.flat();
 return T.ShapeUtils.triangulateShape(vectors[0],vectors.slice(1)).map(ids=>{
  const p=ids.map(i=>new T.Vector3(all[i].x,0,all[i].y)),center=p.reduce((s,v)=>s.add(v),new T.Vector3()).multiplyScalar(1/3);
  const planes=p.map((a,i)=>{const b=p[(i+1)%3],plane=new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(b.z-a.z,0,a.x-b.x).normalize(),a);if(plane.distanceToPoint(center)>0)plane.negate();return plane;});
  planes.push(new T.Plane(new T.Vector3(0,-1,0),lo),new T.Plane(new T.Vector3(0,1,0),-hi));
  const bounds=new T.Box3().setFromPoints(p);bounds.min.y=lo;bounds.max.y=hi;return{planes,bounds};
 });
}

/** Exterior-only Hogg Auditorium. All rendered buffers can be used unchanged
 * as Rapier trimeshes. No grounds, road, stairs or character edits. */
export function buildHoggBuilding(options:HoggBuildingOptions={}){
 const base=options.baseHeight??plan.defaultBaseHeight,ground=options.groundHeight??(()=>base-.3);
 const materials:T.MeshStandardMaterial[]=[];
 const mat=(name:string,color:number,roughness=.86,metalness=0)=>{const m=new T.MeshStandardMaterial({color,roughness,metalness});m.name=`Hogg ${name}`;materials.push(m);return m;};
 const ashlar=mat('rusticated limestone',0xc7baa0,.89),rubble=mat('upper limestone',0xb7ad96,.94),trim=mat('cut limestone',0xc9bfa9,.84);
 const peach=mat('recessed peach stucco',0xb76840,.92),wood=mat('red-brown sash and doors',0x6e3726,.61),iron=mat('bronze railing',0x393b31,.54,.38);
 const glass=mat('dark recessed glazing',0x20383d,.17,.36);glass.envMapIntensity=2.1;
 const tile=mat('Spanish clay tile',0x935b40,.9),roof=mat('flat roof and recess shadow',0x635f52,.97),timber=mat('timber soffit',0x5c3e2b,.87);
 for(const [m,w,h,relief] of [[ashlar,.92,.46,.004],[rubble,.59,.21,.002],[tile,.24,.37,.0045]] as const){
  m.onBeforeCompile=s=>{
   if(s.vertexShader.includes('varying vec2 hoggSurfaceUv;'))return;
   s.vertexShader='varying vec2 hoggSurfaceUv;\n'+s.vertexShader;
   s.vertexShader=s.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nhoggSurfaceUv=uv;');
   s.fragmentShader=`varying vec2 hoggSurfaceUv;
    float hoggHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float hoggNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hoggHash(i),hoggHash(i+vec2(1,0)),f.x),mix(hoggHash(i+vec2(0,1)),hoggHash(i+vec2(1,1)),f.x),f.y);}\n`+s.fragmentShader;
   const masonryColor=m===rubble?`#include <color_fragment>
    // Irregular coursed limestone: thin pale joints, varied course heights
    // and stone lengths rather than a high-contrast running-bond grid.
    float courseUnit=hoggSurfaceUv.y/.21,group=floor(courseUnit/3.);
    float within=courseUnit-group*3.,course,fy,courseHeight;
    if(within<.70){course=group*3.;fy=within/.70;courseHeight=.147;}
    else if(within<1.75){course=group*3.+1.;fy=(within-.70)/1.05;courseHeight=.2205;}
    else{course=group*3.+2.;fy=(within-1.75)/1.25;courseHeight=.2625;}
    float stoneWidth=.43+.33*hoggHash(vec2(course,7.31));
    float qx=hoggSurfaceUv.x/stoneWidth+hoggHash(vec2(course,19.71))*3.;
    float fx=fract(qx);
    vec2 edge=vec2(min(fx,1.-fx)*stoneWidth,min(fy,1.-fy)*courseHeight);
    vec2 footprint=abs(dFdx(hoggSurfaceUv))+abs(dFdy(hoggSurfaceUv));
    float body=smoothstep(.0014,.0032+footprint.x,edge.x)*smoothstep(.0012,.0030+footprint.y,edge.y);
    float broad=hoggNoise(hoggSurfaceUv*.73),mineral=hoggNoise(hoggSurfaceUv*5.1);
    float grain=hoggNoise(hoggSurfaceUv*24.),tone=hoggHash(vec2(floor(qx),course));
    float poreResolution=max(length(dFdx(hoggSurfaceUv*82.)),length(dFdy(hoggSurfaceUv*82.)));
    float pore=smoothstep(.58,.77,hoggNoise(hoggSurfaceUv*82.))*(1.-smoothstep(.35,1.15,poreResolution));
    vec3 stoneTone=mix(vec3(.925,.899,.842),vec3(1.055,1.037,.989),tone);
    vec3 mineralTone=mix(vec3(.85,.839,.798),vec3(1.045,1.024,.966),broad*.62+mineral*.38);
    diffuseColor.rgb*=mix(vec3(.88,.867,.827),stoneTone,body)*mineralTone*(.958+.069*grain-.105*pore);
    float relief=body*.0008+(grain-.5)*.00045-pore*.00038;
    `:`#include <color_fragment>
    vec2 q=hoggSurfaceUv/vec2(${w},${h});q.x+=mod(floor(q.y),2.)*.5;
    vec2 edge=min(fract(q),1.-fract(q)),aa=max(fwidth(q),vec2(.0001));
    float block=smoothstep(.017,.046+aa.x,edge.x)*smoothstep(.023,.056+aa.y,edge.y);
    float mineral=hoggNoise(hoggSurfaceUv*11.),tone=hoggHash(floor(q));
    diffuseColor.rgb*=mix(vec3(.68,.66,.60),mix(vec3(.88,.85,.78),vec3(1.09,1.045,.96),tone),block)*(.93+.12*mineral);
    float relief=block*${relief}+(mineral-.5)*${relief*.38};`;
   s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',masonryColor);
   s.fragmentShader=s.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
    vec3 sx=dFdx(-vViewPosition),sy=dFdy(-vViewPosition),rx=cross(sy,normal),ry=cross(normal,sx);
    float det=dot(sx,rx);normal=normalize(abs(det)*normal-sign(det)*(dFdx(relief)*rx+dFdy(relief)*ry));`);
  };m.customProgramCacheKey=()=>`hogg-masonry-${m.name}-${m===rubble?2:1}`;
 }
 const angle=plan.rotationRadians,co=Math.cos(angle),si=Math.sin(angle);
 const registration=new T.Matrix4().makeRotationY(-angle).setPosition(plan.originXZ[0],base,plan.originXZ[1]);
 const worldPoint=(x:number,z:number)=>[plan.originXZ[0]+co*x-si*z,plan.originXZ[1]+si*x+co*z] as Point;
 const batches=new Map<T.Material,T.BufferGeometry[]>();let windows=0,doors=0;
 const add=(g:T.BufferGeometry,m:T.Material)=>{if(!batches.has(m))batches.set(m,[]);batches.get(m)!.push(g);};
 const box=(x:number,y:number,z:number,w:number,h:number,d:number,m:T.Material,matrix?:T.Matrix4)=>{
  const g=new T.BoxGeometry(w,h,d).translate(x,y,z),p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv;
  for(let i=0;i<p.count;i++)uv.setXY(i,Math.abs(n.getY(i))>.7?p.getX(i):Math.abs(n.getX(i))>.7?p.getZ(i):p.getX(i),Math.abs(n.getY(i))>.7?p.getZ(i):p.getY(i));
  if(matrix)g.applyMatrix4(matrix);add(g,m);
 };
 const line=(a:T.Vector3,b:T.Vector3,radius:number,m:T.Material,segments=6)=>{
  const d=new T.Vector3().subVectors(b,a),g=new T.CylinderGeometry(radius,radius,d.length(),segments,1);
  g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),d.clone().normalize())).translate(...a.clone().lerp(b,.5).toArray());add(g,m);
 };
 const floorMinimum=Math.min(...plan.officialFootprintXZ[0].map(([x,z])=>ground(x,z)))-base-1.2;
 add(new T.ExtrudeGeometry(footprintShape(plan.localCore),{depth:11.8-floorMinimum,bevelEnabled:false}).rotateX(-Math.PI/2).translate(0,floorMinimum,0),ashlar);
 // Higher enclosed lobby and stage masses stay behind the deep front screen.
 box(17.3,13.2,0,7.0,3.0,17.8,rubble);
 box(-18.1,13.15,0,7.1,2.7,17.6,rubble);
 type Aperture={x:number;bottom:number;width:number;height:number;kind:'glass'|'door'|'peach'};
 const witnesses:{label:string;origin:number[];direction:number[];expected:string}[]=[];
 const rings=plan.localFootprint;
 for(const source of rings){
  const r=[...source];if(r.reduce((n,p,i)=>n+p[0]*r[(i+1)%r.length][1]-r[(i+1)%r.length][0]*p[1],0)>0)r.reverse();
  for(let i=0;i<r.length;i++){
   const a=r[i],b=r[(i+1)%r.length],d=new T.Vector3(b[0]-a[0],0,b[1]-a[1]),length=d.length();if(length<.1)continue;
   const along=d.clone().normalize(),out=new T.Vector3(-along.z,0,along.x),mid=[(a[0]+b[0])/2,(a[1]+b[1])/2];
   const matrix=new T.Matrix4().makeBasis(along,new T.Vector3(0,1,0),out).setPosition(a[0],0,a[1]);
   const panelBox=(x:number,y:number,z:number,w:number,h:number,depth:number,m:T.Material)=>box(x,y,z,w,h,depth,m,matrix);
   const front=out.x>.95&&mid[0]>22,side=Math.abs(out.z)>.95&&length>35,frontWing=out.x>.95&&!front;
   const top=front||mid[0]>21?15.2:frontWing?12.7:side?11.8:mid[0]<-20?14.4:12.7;
   const openings:Aperture[]=[];
   if(front){
    for(const x of [length/2-4.1,length/2,length/2+4.1]){openings.push({x,bottom:.08,width:2.1,height:2.55,kind:'door'});openings.push({x,bottom:3.65,width:3.12,height:7.7,kind:'peach'});}
   }else if(side){
    for(const localX of [-8,0,8]){const x=(localX-a[0])/along.x;openings.push({x,bottom:4.45,width:3.05,height:5.55,kind:'glass'},{x,bottom:.7,width:3.05,height:1.85,kind:'glass'});}
    for(const localX of [-16.8,16.8])openings.push({x:(localX-a[0])/along.x,bottom:.18,width:1.8,height:2.48,kind:'door'});
   }else if(frontWing&&length>3)openings.push({x:length/2,bottom:3.65,width:1.02,height:2.2,kind:'glass'});
   else if(mid[0]<-22&&length>15)for(const x of [length*.27,length*.73])openings.push({x,bottom:.2,width:1.75,height:2.5,kind:'door'});
   for(const [lo,hi,material] of [[floorMinimum,3.3,ashlar],[3.3,top,rubble]] as const){
    const wall=new T.Shape([new T.Vector2(0,lo),new T.Vector2(length,lo),new T.Vector2(length,hi),new T.Vector2(0,hi)]);
    for(const o of openings){if(o.bottom<lo||o.bottom+o.height>hi)continue;wall.holes.push(new T.Path([new T.Vector2(o.x-o.width/2,o.bottom),new T.Vector2(o.x-o.width/2,o.bottom+o.height),new T.Vector2(o.x+o.width/2,o.bottom+o.height),new T.Vector2(o.x+o.width/2,o.bottom)]));}
    add(new T.ExtrudeGeometry(wall,{depth:.62,bevelEnabled:false}).translate(0,0,-.62).applyMatrix4(matrix),material);
   }
   for(const o of openings){
    const y=o.bottom+o.height/2,depth=o.kind==='peach'?-1.05:-.46;
    panelBox(o.x,y,depth,o.width,o.height,.07,o.kind==='peach'?peach:o.kind==='door'?wood:glass);
    if(o.kind==='peach'){
     const windowBottom=o.bottom+.03,h=3.05,w=1.33,doorY=windowBottom+h/2;
     panelBox(o.x,doorY,-.965,w,h,.065,glass);
     for(const side of [-1,1])panelBox(o.x+side*(w/2+.12),doorY,-.83,.24,h+.40,.25,trim);
     panelBox(o.x,windowBottom+h+.16,-.83,w+.65,.28,.29,trim);
     for(let v=0;v<=2;v++)panelBox(o.x-w/2+w*v/2,doorY,-.86,.035,h,.06,wood);
     for(let hline=0;hline<=6;hline++)panelBox(o.x,windowBottom+h*hline/6,-.86,w,.034,.06,wood);
     if(Math.abs(o.x-length/2)<.1){
      const yTop=windowBottom+h+.34,wTop=1.17;
      const pediment=new T.Shape([new T.Vector2(o.x-wTop,yTop),new T.Vector2(o.x,yTop+.72),new T.Vector2(o.x+wTop,yTop)]);
      add(new T.ExtrudeGeometry(pediment,{depth:.17,bevelEnabled:false}).translate(0,0,-.77).applyMatrix4(matrix),trim);
      panelBox(o.x,yTop-.035,-.68,2.5,.13,.34,trim);
     }
     windows++;continue;
    }
    for(const s of [-1,1])panelBox(o.x+s*(o.width/2+.105),y,-.02,.21,o.height+.35,.18,trim);
    panelBox(o.x,o.bottom+o.height+.12,.025,o.width+.53,.22,.28,trim);
    panelBox(o.x,o.bottom-.08,.04,o.width+.48,.16,.36,trim);
    if(o.kind==='glass'){
     for(let c=0;c<=4;c++)panelBox(o.x-o.width/2+o.width*c/4,y,-.34,.037,o.height,.06,wood);
     for(let q=0;q<=8;q++)panelBox(o.x,o.bottom+o.height*q/8,-.33,o.width,.039,.065,wood);
     windows++;
    }else{
     panelBox(o.x,y,-.375,.06,o.height,.10,iron);
     for(const s of [-1,1]){
      const cx=o.x+s*o.width/4;
      for(let row=0;row<4;row++){const py=o.bottom+.33+row*(o.height-.48)/4;panelBox(cx,py,-.375,o.width*.35,.37,.095,wood);}
      panelBox(o.x+s*.11,o.bottom+1.10,-.26,.035,.35,.06,iron);
     }
     doors++;
    }
   }
   panelBox(length/2,3.33,.055,length,.19,.41,trim);
   panelBox(length/2,3.48,.15,length,.14,.58,trim);
   panelBox(length/2,top-.14,.09,length,.19,.38,trim);
   panelBox(length/2,top+.02,.15,length,.13,.51,trim);
   if(side){
    panelBox(length/2,11.72,.33,length,.14,.85,timber);
    for(let x=.35;x<length;x+=.82)panelBox(x,11.61,.3,.105,.23,.92,timber);
    // Three monumental window surrounds distinguish the long auditorium wall.
    for(const localX of [-12,12])panelBox((localX-a[0])/along.x,7.48,.07,.45,8.03,.27,trim);
    for(const localX of [-16.1,16.1])panelBox((localX-a[0])/along.x,7.4,.13,.10,8.0,.16,iron);
   }
   if(front){
    const left=length/2-6.62,right=length/2+6.62;
    // Four square piers and entablature frame the three deep stucco bays.
    for(const x of [left,length/2-2.05,length/2+2.05,right]){
     panelBox(x,7.47,.16,.76,7.76,.54,trim);
     panelBox(x,11.28,.22,1.02,.22,.67,trim);
    }
    panelBox(length/2,11.77,.19,13.96,.77,.70,trim);
    panelBox(length/2,12.18,.30,14.38,.18,.90,trim);
    panelBox(length/2,3.58,.30,14.0,.18,.91,trim);
    // A continuous balcony rail, with real vertical pickets.
    for(let x=left+.24;x<=right-.20;x+=.23)panelBox(x,4.16,.69,.028,1.03,.035,iron);
    panelBox(length/2,4.69,.69,13.10,.046,.06,iron);
    panelBox(length/2,3.65,.69,13.10,.045,.06,iron);
    // Low tile-capped canopy: distinct corrugated silhouette above the porch.
    for(let x=left-.35;x<right+.36;x+=.22){const g=new T.CylinderGeometry(.105,.105,.82,6,1,true,0,Math.PI).rotateX(Math.PI/2).translate(x,12.35,.30).applyMatrix4(matrix);add(g,tile);}
    for(const u of [length/2-4.1,length/2,length/2+4.1]){
     const disk=new T.CylinderGeometry(.34,.34,.085,20).rotateX(Math.PI/2).translate(u,13.47,.09).applyMatrix4(matrix);add(disk,trim);
     // Small low relief is a silhouette approximation of the observed masks.
     const face=new T.SphereGeometry(.20,10,8).scale(.83,1.12,.35).translate(u,13.47,.18).applyMatrix4(matrix);add(face,trim);
     for(const s of [-1,1]){const eye=new T.SphereGeometry(.042,7,5).scale(1.1,.7,.28).translate(u+s*.075,13.50,.245).applyMatrix4(matrix);add(eye,roof);}
     const mouth=new T.SphereGeometry(.07,8,6).scale(1.1,Math.abs(u-length/2)<.1?.5:.75,.20).translate(u,13.37,.247).applyMatrix4(matrix);add(mouth,roof);
    }
    // Paired urn finials at the ends of the tall front parapet.
    for(const x of [.55,length-.55]){
     panelBox(x,15.37,.0,.73,.32,.78,trim);
     const points=[new T.Vector2(.28,0),new T.Vector2(.30,.10),new T.Vector2(.16,.16),new T.Vector2(.22,.44),new T.Vector2(.12,.64),new T.Vector2(.08,.84),new T.Vector2(0,.94)];
     add(new T.LatheGeometry(points,14).translate(x,15.53,0).applyMatrix4(matrix),trim);
    }
   }
   // Independent probes at actual wall locations for visible/physical checks.
   for(const t of [.21,.5,.79])for(const height of [1.35,5.7,10.8]){
    const p=new T.Vector3(length*t,height,2).applyMatrix4(matrix).applyMatrix4(registration),direction=out.clone().negate().transformDirection(registration);
    witnesses.push({label:`${front?'east-front':side?'auditorium-side':'return'}-${i}-${t}-${height}`,origin:p.toArray(),direction:direction.toArray(),expected:'sealed exterior'});
   }
  }
 }
 const surface=(corners:T.Vector3[],m:T.Material)=>{const candidate=[[corners[0],corners[1],corners[2]],[corners[0],corners[2],corners[3]]],p=candidate.filter(t=>new T.Vector3().crossVectors(new T.Vector3().subVectors(t[1],t[0]),new T.Vector3().subVectors(t[2],t[0])).lengthSq()>1e-10).flat(),g=new T.BufferGeometry().setFromPoints(p);g.setAttribute('uv',new T.Float32BufferAttribute(p.flatMap(v=>[v.x,v.z]),2));g.computeVertexNormals();m.side=T.DoubleSide;add(g,m);};
 // Photographic roof topology: a broad truncated hip over the auditorium,
 // a raised stage hip at the rear, and flat front parapets.
 const lower=[[-15.8,11.93,-13.7],[14.3,11.93,-13.7],[14.3,11.93,13.7],[-15.8,11.93,13.7]].map(p=>new T.Vector3(...p));
 const upper=[[-12.0,13.5,-7.6],[10.5,13.5,-7.6],[10.5,13.5,7.6],[-12.0,13.5,7.6]].map(p=>new T.Vector3(...p));
 for(let i=0;i<4;i++)surface([lower[i],lower[(i+1)%4],upper[(i+1)%4],upper[i]],tile);
 surface(upper,roof);
 box(18.35,15.14,0,8.62,.16,19.25,roof);
 for(const z of [-11.5,11.5])box(17.5,12.62,z,6.65,.16,3.60,roof);
 const rear=[[-22.6,14.55,-9.75],[-14.0,14.55,-9.75],[-14.0,14.55,9.75],[-22.6,14.55,9.75]].map(p=>new T.Vector3(...p));
 const ridgeA=new T.Vector3(-18.3,16.75,-6.3),ridgeB=new T.Vector3(-18.3,16.75,6.3);
 surface([rear[0],rear[1],ridgeA,ridgeA],tile);surface([rear[1],rear[2],ridgeB,ridgeA],tile);surface([rear[2],rear[3],ridgeB,ridgeB],tile);surface([rear[3],rear[0],ridgeA,ridgeB],tile);
 line(ridgeA,ridgeB,.13,tile,8);
 const meshes:T.Mesh[]=[];
 for(const [m,parts] of batches){const flats=parts.map(g=>g.index?g.toNonIndexed():g),geometry=mergeGeometries(flats)!;geometry.applyMatrix4(registration);
  // Lathe tips contain zero-area triangles at the rotation axis. Remove those
  // before handing the identical final buffers to rendering and collisions.
  const position=geometry.attributes.position,keep:number[]=[];
  for(let i=0;i<position.count;i+=3){const a=new T.Vector3().fromBufferAttribute(position,i),b=new T.Vector3().fromBufferAttribute(position,i+1),c=new T.Vector3().fromBufferAttribute(position,i+2);if(new T.Vector3().crossVectors(b.sub(a),c.sub(a)).lengthSq()>1e-14)keep.push(i,i+1,i+2);}
  for(const [name,attribute] of Object.entries(geometry.attributes)){const values=new Float32Array(keep.length*attribute.itemSize);for(let i=0;i<keep.length;i++)for(let j=0;j<attribute.itemSize;j++)values[i*attribute.itemSize+j]=attribute.getComponent(keep[i],j);geometry.setAttribute(name,new T.BufferAttribute(values,attribute.itemSize));}
  const mesh=new T.Mesh(geometry,m);mesh.name=`Hogg Memorial Auditorium: ${m.name}`;mesh.castShadow=mesh.receiveShadow=true;meshes.push(mesh);for(const p of new Set([...parts,...flats]))p.dispose();}
 const volumes=cutVolumes(plan.officialFootprintXZ,base+floorMinimum-.2,base+19);
 // Kept separate: the root must repair/check floor edges before enabling the
 // registration fringe. Strict footprint cuts are safe inside sealed mass.
 const registrationFringeVolumes=plan.fringeXZ.flatMap(r=>cutVolumes(r,Math.min(...r[0].map(([x,z])=>ground(x,z)))+.12,base+19));
 if(options.includeRegistrationFringe)volumes.push(...registrationFringeVolumes);
 return{meshes,materials,volumes,registrationFringeVolumes,witnesses,stats:{building:'HMA',baseHeight:base,windows,doors,materialBatches:meshes.length,triangles:meshes.reduce((n,m)=>n+m.geometry.attributes.position.count/3,0),strictFootprintOnly:!options.includeRegistrationFringe},worldPoint};
}
