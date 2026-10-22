import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import planData from '../../public/data/main-building-base-plan.json' with {type:'json'};
type P=[number,number];
type Wall={id:'south'|'west';a:P;b:P;normal:P;base:number;height:number;bays:number;cutRing:P[];photoIds:string[];doorFractions:number[]};
const plan=planData as unknown as {walls:Wall[];fullFootprint:P[]};
export interface MainBuildingBaseOptions {groundHeight:(x:number,z:number)=>number;southBaseElevation?:number;westBaseElevation?:number;facades?:('south'|'west')[]}
/** Two thin facade replacements. Source cuts stop below the upper facade and
 * never replace the Tower shaft, clock, crown or Main Building roof silhouette.
 */
export function buildMainBuildingBase(options:MainBuildingBaseOptions){
 const materials:T.MeshStandardMaterial[]=[],meshes:T.Mesh[]=[],volumes:{planes:T.Plane[];bounds:T.Box3}[]=[],samples:{facade:string;kind:string;origin:number[];direction:number[];minimum:number}[]=[],entrances:{facade:string;position:number[];normal:number[]}[]=[],wallStats:Record<string,unknown>[]=[];
 const mat=(name:string,color:number,roughness=.82,metalness=0)=>{const m=new T.MeshStandardMaterial({color,roughness,metalness});m.name=`Main Building ${name}`;materials.push(m);return m;};
 const stone=mat('warm limestone',0xc2b8a4),light=mat('pale stone blocks',0xc7beaa),dark=mat('weathered stone blocks',0xb8b09d),glass=mat('bronze dark glazing',0x3e493f,.3,.23),frame=mat('bronze sash',0x7b7561,.6,.35),wood=mat('entry timber',0x342e24),iron=mat('balcony iron',0x333a32,.67,.4),shadow=mat('arch soffit shadow',0x8d8879,.96);
 const requested=options.facades??['south','west'];
 for(const wall of plan.walls.filter(w=>requested.includes(w.id))){
  const base=(wall.id==='south'?options.southBaseElevation:options.westBaseElevation)??wall.base,top=base+wall.height,dx=wall.b[0]-wall.a[0],dz=wall.b[1]-wall.a[1],length=Math.hypot(dx,dz),out=new T.Vector3(wall.normal[0],0,wall.normal[1]);
  const bottom=Math.min(base-.3,...[0,.25,.5,.75,1].map(t=>options.groundHeight(wall.a[0]+dx*t,wall.a[1]+dz*t)-.2));if(![base,bottom].every(Number.isFinite))throw new Error('Invalid Main Building ground datum');
  const matrix=new T.Matrix4().makeBasis(new T.Vector3(dx/length,0,dz/length),new T.Vector3(0,1,0),out).setPosition(wall.a[0],0,wall.a[1]);
  const batches=new Map<T.Material,T.BufferGeometry[]>();
  const put=(g:T.BufferGeometry,m:T.Material)=>{g.applyMatrix4(matrix);if(matrix.determinant()<0){if(g.index){const ix=g.index;for(let i=0;i<ix.count;i+=3){const a=ix.getX(i);ix.setX(i,ix.getX(i+2));ix.setX(i+2,a);}}else for(const attr of Object.values(g.attributes))for(let i=0;i<attr.count;i+=3)for(let j=0;j<attr.itemSize;j++){const a=i*attr.itemSize+j,b=(i+2)*attr.itemSize+j,t=attr.array[a];attr.array[a]=attr.array[b];attr.array[b]=t;}}if(!batches.has(m))batches.set(m,[]);batches.get(m)!.push(g);};
  const box=(x:number,y:number,w:number,h:number,d:number,m:T.Material,z=-.4)=>{if(w>.001&&h>.001)put(new T.BoxGeometry(w,h,d).translate(x,y,z),m);};
  type Opening={x:number;y:number;w:number;h:number;arch?:boolean;door?:boolean};const openings:Opening[]=[];
  if(wall.id==='south')for(let j=0;j<wall.bays;j++){const x=length*(j+.5)/wall.bays;openings.push({x,y:base+2.35,w:3.65,h:4.7,arch:true,door:true});openings.push({x,y:base+8.75,w:1.73,h:4.3});}
  else {for(let f=0;f<2;f++)for(let j=0;j<wall.bays;j++){const x=length*(j+.5)/wall.bays;if(f===0&&wall.doorFractions.some(t=>Math.abs(x-t*length)<2.9))continue;openings.push({x,y:base+(f===0?2.03:5.8),w:2.03,h:f===0?2.95:1.8});}for(const t of wall.doorFractions)openings.push({x:t*length,y:base+1.9,w:1.85,h:3.8,door:true});}
  const levels=[bottom,top,...openings.flatMap(o=>[o.y-o.h/2,o.y+o.h/2])].filter(y=>y>=bottom&&y<=top).sort((a,b)=>a-b);
  for(let k=0;k<levels.length-1;k++){const lo=levels[k],hi=levels[k+1];if(hi-lo<.001)continue;const holes=openings.filter(o=>o.y-o.h/2<(lo+hi)/2&&o.y+o.h/2>(lo+hi)/2).sort((a,b)=>a.x-b.x);let cursor=0;for(const o of holes){box((cursor+o.x-o.w/2)/2,(lo+hi)/2,o.x-o.w/2-cursor,hi-lo,.85,stone);cursor=o.x+o.w/2;}box((cursor+length)/2,(lo+hi)/2,length-cursor,hi-lo,.85,stone);}
  // Rustication is shallow physical relief. Joints stay dark because each block
  // sits just proud of the continuous wall, as in the west doorway photograph.
  const courses=Math.ceil(wall.height/.43);for(let row=0;row<courses;row++){const lo=base+row*.43,hi=Math.min(top,lo+.405);if(hi<=lo)continue;const holes=openings.filter(o=>o.y-o.h/2<hi&&o.y+o.h/2>lo);for(let j=-1;j<Math.ceil(length/1.25);j++){const x0=Math.max(0,j*1.25+(row%2)*.625),x1=Math.min(length,(j+1)*1.25+(row%2)*.625-.026);if(x1<=x0||holes.some(o=>o.x-o.w/2<x1&&o.x+o.w/2>x0))continue;if(wall.id==='south'&&lo>base+5.05)continue;box((x0+x1)/2,(lo+hi)/2,x1-x0,hi-lo,.07,(row+j)%7===0?dark:(row+j)%3===0?light:stone,.057);}}
  let arches=0;
  for(const o of openings){const reveal=o.arch?1.32:.59;const joinsAbove=wall.id==='south'&&!o.arch&&o.y+o.h/2>=top-.01;for(const side of [-1,1])box(o.x+side*(o.w/2+.09),joinsAbove?o.y-.045:o.y,.18,joinsAbove?o.h+.09:o.h+.18,.91,stone,-.35);if(!(wall.id==='south'&&!o.arch&&o.y+o.h/2>=top-.01))box(o.x,o.y+o.h/2+.09,o.w+.36,.18,.95,stone,-.34);box(o.x,o.y-o.h/2-.09,o.w+.38,.18,1.02,stone,-.3);
   box(o.x,o.y,o.w,o.h,.12,o.door?wood:glass,-reveal);
   const rows=o.door?3:5,cols=o.door?2:3;for(let j=1;j<cols;j++)box(o.x-o.w/2+o.w*j/cols,o.y,.034,o.h,.07,frame,-reveal+.085);for(let j=1;j<rows;j++)box(o.x,o.y-o.h/2+o.h*j/rows,o.w,.035,.07,frame,-reveal+.085);
   if(o.arch){arches++;const r=o.w/2,spring=o.y+o.h/2-r,cap=new T.Shape();cap.moveTo(-r,spring);cap.lineTo(-r,o.y+o.h/2);cap.lineTo(r,o.y+o.h/2);cap.lineTo(r,spring);cap.absarc(0,spring,r,0,Math.PI,false);cap.closePath();put(new T.ExtrudeGeometry(cap,{depth:1.37,bevelEnabled:false,steps:1,curveSegments:20}).translate(o.x,0,-1.35),stone);
    const arc=new T.Shape();arc.absarc(0,spring,r+.25,0,Math.PI,false);arc.lineTo(-r,spring);arc.absarc(0,spring,r,Math.PI,0,true);arc.closePath();put(new T.ExtrudeGeometry(arc,{depth:.15,bevelEnabled:false,steps:1,curveSegments:20}).translate(o.x,0,.06),light);
    box(o.x,base+4.76,o.w,.12,1.35,shadow,-.68);
   }
   if(o.door)entrances.push({facade:wall.id,position:new T.Vector3(o.x,base,0).applyMatrix4(matrix).toArray(),normal:out.toArray()});
   samples.push({facade:wall.id,kind:o.arch?'deep arched entry':o.door?'recessed west doorway':'recessed window',origin:new T.Vector3(o.x-o.w/2+o.w/cols*.38,o.y-o.h/2+o.h/rows*(o.door?.38:2.38),2).applyMatrix4(matrix).toArray(),direction:out.clone().negate().toArray(),minimum:o.arch?3.0:2.4});
  }
  if(wall.id==='south'){
   box(length/2,base+5.35,length,.29,1.1,stone,.37);for(let j=0;j<75;j++)box(length*(j+.5)/75,base+5.98,.035,1.03,.05,iron,.83);box(length/2,base+6.51,length,.065,.085,iron,.83);
   for(let j=0;j<=wall.bays;j++){const x=length*j/wall.bays;box(x,base+8.7,.28,4.4,.25,stone,.08);}
  }else{box(length/2,base+4.32,length,.25,.7,stone,.16);for(const t of wall.doorFractions)for(const side of[-1,1]){const x=length*t+side*1.35;box(x,base+3.06,.25,.65,.24,iron,.33);box(x,base+3.41,.37,.07,.35,iron,.33);}}
  // South: the tall window bays run through the wall top into the envelope strip, so no top band there.
  if(wall.id!=='south')box(length/2,top-.14,length,.28,.67,stone,.16);
  const before=meshes.length;for(const[m,parts]of batches){const flat=parts.map(g=>g.index?g.toNonIndexed():g),g=mergeGeometries(flat)!;g.computeBoundingBox();g.computeBoundingSphere();const mesh=new T.Mesh(g,m);mesh.name=`MAI ${wall.id} pedestrian facade: ${m.name}`;mesh.castShadow=mesh.receiveShadow=true;meshes.push(mesh);for(const part of new Set([...parts,...flat]))part.dispose();}
  // Short wall cells keep the cut floor local on sloping ground. Both
  // pedestrian ground and all geometry above this facade's top are retained.
  const cells=Math.ceil(length/4);for(let cell=0;cell<cells;cell++){
   const t0=cell/cells,t1=(cell+1)/cells;
   // Live south-wall probes place duplicate scan faces 1.24 m outside the
   // official wall. Keep this repair below the retained upper facade and above
   // the local ground; the unsurveyed west fringe stays at its original width.
   const fringe=wall.id==='south'?1.65:.65;
   const points=[[t0,-1.7],[t1,-1.7],[t1,fringe],[t0,fringe]].map(([t,d])=>new T.Vector3(wall.a[0]+dx*t+out.x*d,0,wall.a[1]+dz*t+out.z*d));
   const center=points.reduce((c,p)=>c.add(p),new T.Vector3()).multiplyScalar(.25),floor=Math.max(base+.03,...points.map(p=>options.groundHeight(p.x,p.z)+.25),options.groundHeight(center.x,center.z)+.25);
   const planes=points.map((a,i)=>{const b=points[(i+1)%4],p=new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(b.z-a.z,0,a.x-b.x).normalize(),a);if(p.distanceToPoint(center)>0)p.negate();return p;});planes.push(new T.Plane(new T.Vector3(0,-1,0),floor),new T.Plane(new T.Vector3(0,1,0),-top));const bounds=new T.Box3().setFromPoints(points);bounds.min.y=floor;bounds.max.y=top;volumes.push({planes,bounds});
  }

  const own=meshes.slice(before);wallStats.push({facade:wall.id,photoIds:wall.photoIds,base,top,arches,openings:openings.length,triangles:own.reduce((n,m)=>n+m.geometry.attributes.position.count/3,0),materialBatches:own.length});
 }
 return{meshes,materials,colliderGeometries:meshes.map(m=>m.geometry),volumes,candidateClearanceVolumes:volumes,samples,entrancePoints:entrances,stats:{building:'MAI',scope:'Two pedestrian facades only; upper Tower remains streamed',facades:wallStats,triangles:meshes.reduce((n,m)=>n+m.geometry.attributes.position.count/3,0),materialBatches:meshes.length}};
}
