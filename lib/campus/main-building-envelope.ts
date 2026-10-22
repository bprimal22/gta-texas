import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {closeGround,type TopTriangle} from './closed-ground';
import planData from './main-building-envelope-plan.json' with {type:'json'};
type P=[number,number];
type Part={outer:P[];holes:P[][]};
type Zone={id:string;eave:number;rise:number;pitch:number;kind:string;parts:Part[];bounds:number[];area:number;roofTriangles:P[][];parapet?:number;rows?:[number,number][];bays?:number;windowWidth?:number;wall?:'stone'|'brick';continueOpenings?:boolean;lidar?:{samples:number;dsmMedian:number|null;modelMedian:number|null}};
type Edge={ring:number;edge:number;a:P;b:P;normal:P;zone:string;top:number;length:number};
const plan=planData as unknown as {frame:{origin:P;east:P;south:P};officialWorldRings:P[][];footprint:Part;towerHole:Part;baseParts:Part[];baseTriangles:P[][];zones:Zone[];edges:Edge[];area:number;roofArea:number;preservedCourtArea:number;roofSkinDepth:number;protectedFacades:{name:string;edge:number;ring:number;top:number;backingDepth:number}[];southRail:{u0:number;u1:number;v:number;deck:number;top:number}};
export interface MainEnvelopeOptions{
 /** Existing contour/ground before this asset is inserted; only sets buried foundation. */
 groundHeight:(x:number,z:number)=>number;
 stone:T.MeshStandardMaterial;trim:T.MeshStandardMaterial;
 glass:T.MeshStandardMaterial;frame:T.MeshStandardMaterial;
}
/** Whole mapped Main Building envelope, with both GIS courtyard holes and the
 * E-shaped northern courts left open. Existing finished south/west/east facades
 * are borrowed scene neighbors, never edited. The Tower is excluded from every
 * roof/foundation polygon. Dimensions above the GIS footprint are estimates
 * informed by the UT directory and historical architectural photographs.
 */
export function buildMainBuildingEnvelope(options:MainEnvelopeOptions){
 const {origin,east,south}=plan.frame;
 const wp=(u:number,y:number,v:number)=>new T.Vector3(origin[0]+u*east[0]+v*south[0],y,origin[1]+u*east[1]+v*south[1]);
 const local=(x:number,z:number)=>[(x-origin[0])*east[0]+(z-origin[1])*east[1],(x-origin[0])*south[0]+(z-origin[1])*south[1]] as P;
 const groundSamples=plan.officialWorldRings.flat().map(([x,z])=>options.groundHeight(x,z));
 if(!groundSamples.every(Number.isFinite))throw new Error('Main Building envelope requires finite existing ground');
 const bottom=Math.min(...groundSamples)-.65;
 const materials:T.MeshStandardMaterial[]=[];
 const owned=(name:string,color:number,roughness:number)=>{const m=new T.MeshStandardMaterial({color,roughness});m.name=`MAI envelope ${name}`;materials.push(m);return m;};
 const tile=owned('terracotta roof',0x815742,.94),flat=owned('recessed roof surface',0x777366,.96),brick=owned('salmon clerestory panels',0xa47f6d,.90),shadow=owned('eave shadow and joints',0x645f54,.94);
 const batches=new Map<T.Material,T.BufferGeometry[]>();
 const add=(g:T.BufferGeometry,m:T.Material)=>{const q=g.index?g.toNonIndexed():g;if(q!==g)g.dispose();if(!batches.has(m))batches.set(m,[]);batches.get(m)!.push(q);};
 const boxWorld=(position:T.Vector3,size:T.Vector3,mat:T.Material,matrix?:T.Matrix4)=>{if(Math.min(size.x,size.y,size.z)<=.001)return;const g=new T.BoxGeometry(size.x,size.y,size.z);if(matrix)g.applyMatrix4(matrix);else g.translate(position.x,position.y,position.z);add(g,mat);};
 const roofSamples:{zone:string;point:number[]}[]=[],windowSamples:{zone:string;origin:number[];direction:number[]}[]=[],wallWitnesses:{zone:string;origin:number[];direction:number[]}[]=[];
 // Closed thin skins keep actual roof/foundation visual and physical buffers
 // identical. No elevation rectangle fills a courtyard or the south forecourt.
 const makeSkin=(triangles:P[][],height:(p:P)=>number,depth:number,mat:T.MeshStandardMaterial,name:string)=>{
  const top:TopTriangle[]=triangles.map(t=>({points:t.map(([u,v])=>wp(u,height([u,v]),v)) as [T.Vector3,T.Vector3,T.Vector3],material:0}));
  const skin=closeGround(top,[mat,mat],depth,name);for(const m of skin.meshes)add(m.geometry,mat);
  for(let i=0;i<top.length;i+=Math.max(1,Math.floor(top.length/18))){const p=top[i].points.reduce((a,b)=>a.add(b),new T.Vector3()).multiplyScalar(1/3);roofSamples.push({zone:name,point:p.toArray()});}
  return top;
 };
 makeSkin(plan.baseTriangles,()=>bottom,.32,options.stone,'buried foundation');
 for(const zone of plan.zones){const [u0,v0,u1,v1]=zone.bounds;
  const height=([u,v]:P)=>zone.eave+Math.min(zone.rise,Math.max(0,Math.min(u-u0,u1-u,v-v0,v1-v))*zone.pitch);
  makeSkin(zone.roofTriangles,height,plan.roofSkinDepth,zone.kind==='tile'?tile:flat,zone.id);
 }
 type Opening={x:number;lo:number;hi:number;width:number;depth:number};let openingsCount=0,facadeSegments=0,cornices=0;
 const facade=(edge:Edge,lo:number,hi:number,backing=false)=>{
  if(hi-lo<.05||edge.length<.05)return;facadeSegments++;
  const len=edge.length,du=(edge.b[0]-edge.a[0])/len,dv=(edge.b[1]-edge.a[1])/len;
  const tangent=new T.Vector3(du*east[0]+dv*south[0],0,du*east[1]+dv*south[1]),normal=new T.Vector3(edge.normal[0]*east[0]+edge.normal[1]*south[0],0,edge.normal[0]*east[1]+edge.normal[1]*south[1]);
  const matrix=new T.Matrix4().makeBasis(tangent,new T.Vector3(0,1,0),normal).setPosition(wp(edge.a[0],0,edge.a[1]));
  const place=(x:number,y:number,width:number,height:number,depth:number,m:T.Material,out=-.28)=>{
   if(Math.min(width,height,depth)<.002)return;const g=new T.BoxGeometry(width,height,depth).translate(x,y,out);g.applyMatrix4(matrix);
   if(matrix.determinant()<0){const ix=g.index!;for(let i=0;i<ix.count;i+=3){const a=ix.getX(i);ix.setX(i,ix.getX(i+2));ix.setX(i+2,a);}}
   add(g,m);
  };
  if(backing){place(len/2,(lo+hi)/2,len,hi-lo,.20,options.stone,-2.6);return;}
  const openings:Opening[]=[];
  const rows:(readonly[number,number])[]=edge.zone==='north-stack'?Array.from({length:10},(_,i)=>[14.60+i*2.06,16.05+i*2.06] as const):edge.zone.includes('north-')?[[16.1,18.2],[20.1,22.2],[25.15,31.10],[32.35,34.08]]:edge.zone==='south-clerestory'?[[30.66,32.70]]:[[19.25,21.1],[23.0,24.7],[26.0,29.55]];
  if(edge.ring>0){rows.splice(0,rows.length,[17.6,19.55],[21.8,23.75],[26.0,27.95],[30.2,32.15],[34.4,36.35],[38.0,39.9]);}
  // Round 2: zones re-fitted to the 2017 LiDAR carry their own storey rows (estimates).
  const zoneRows=plan.zones.find(z=>z.id===edge.zone)?.rows;
  if(zoneRows&&edge.ring<=0)rows.splice(0,rows.length,...zoneRows);
  // These returns sit behind neighboring pitched roofs; avoid invented windows
  // partly buried in their roof slopes. The visible south clerestory is separate.
  if(edge.ring===-1&&edge.zone!=='south-clerestory'&&!zoneRows)rows.length=0;
  const bayPitch=edge.zone==='north-stack'?4.65:edge.zone.includes('north-')?4.8:4.65;
  const zoneSpec=plan.zones.find(z=>z.id===edge.zone);
  const count=edge.ring===0&&zoneSpec?.bays?zoneSpec.bays:Math.max(0,Math.floor((len-.65)/bayPitch));
  const wallMat=edge.zone==='south-clerestory'||zoneSpec?.wall==='brick'?brick:options.stone;
  const cont=edge.ring===0&&!!zoneSpec?.continueOpenings;
  for(const [a,b]of rows){if((!cont&&a<lo+.08)||a<lo-.001||b>hi-.25)continue;for(let j=0;j<count;j++){
   const x=len*(j+.5)/count,width=zoneSpec?.windowWidth??(edge.zone==='north-stack'?1.52:(b-a>4?2.08:1.74));if(x-width/2<.35||x+width/2>len-.35)continue;
   openings.push({x,lo:a,hi:b,width,depth:cont?.59:.36});
  }}
  const levels=[lo,hi,...openings.flatMap(o=>[o.lo,o.hi])].sort((a,b)=>a-b);
  for(let k=0;k<levels.length-1;k++){const l=levels[k],h=levels[k+1];if(h-l<.001)continue;const holes=openings.filter(o=>o.lo<(l+h)/2&&o.hi>(l+h)/2).sort((a,b)=>a.x-b.x);let cursor=0;
   for(const o of holes){place((cursor+o.x-o.width/2)/2,(l+h)/2,o.x-o.width/2-cursor,h-l,.56,wallMat);cursor=o.x+o.width/2;}place((cursor+len)/2,(l+h)/2,len-cursor,h-l,.56,wallMat);
  }
  for(const o of openings){const y=(o.lo+o.hi)/2,h=o.hi-o.lo;openingsCount++;
   if(cont){
    // South front strip only: these openings are the upper halves of the base's tall bays
    // (main-building-base.ts south, Y 25.12-29.42). Same glass depth (0.59), jamb profile,
    // 3-column/0.86 m sash grid and frame depth; no sill or band at the join, glass overlaps it.
    place(o.x,y-.02,o.width,h+.04,.12,options.glass,-o.depth);
    for(const side of[-1,1])place(o.x+side*(o.width/2+.09),y,.18,h,.91,options.stone,-.35);
    place(o.x,o.hi+.09,o.width+.36,.18,.95,options.stone,-.34);
    for(let j=1;j<3;j++)place(o.x-o.width/2+o.width*j/3,y,.034,h,.07,options.frame,-o.depth+.085);
    const sash=Math.max(2,Math.round(h/.86));for(let j=1;j<sash;j++)place(o.x,o.lo+h*j/sash,o.width,.035,.07,options.frame,-o.depth+.085);
    const point=wp(edge.a[0]+du*o.x,lo,edge.a[1]+dv*o.x);point.y=y+.17;point.addScaledVector(tangent,-o.width*.23);point.addScaledVector(normal,2);windowSamples.push({zone:edge.zone,origin:point.toArray(),direction:normal.clone().negate().toArray()});
    continue;
   }
   place(o.x,y,o.width,h,.10,options.glass,-o.depth);
   for(const side of[-1,1])place(o.x+side*(o.width/2+.08),y,.16,h+.16,.54,options.trim,-.16);
   place(o.x,o.hi+.09,o.width+.34,.18,.65,options.trim,-.11);place(o.x,o.lo-.08,o.width+.4,.16,.78,options.trim,-.03);
   place(o.x,y,.04,h,.08,options.frame,-o.depth+.075);
   const rows=Math.max(2,Math.round(h/1.05));for(let j=1;j<rows;j++)place(o.x,o.lo+h*j/rows,o.width,.042,.07,options.frame,-o.depth+.075);
   if(h>4){place(o.x,o.lo-.31,o.width+.44,.18,.48,options.trim,.05);for(const side of[-1,1])place(o.x+side*(o.width/2+.37),y,.18,h+.82,.18,options.trim,.06);}
   const point=wp(edge.a[0]+du*o.x,lo,edge.a[1]+dv*o.x);point.y=y+.17;point.addScaledVector(tangent,-o.width*.23);point.addScaledVector(normal,2);windowSamples.push({zone:edge.zone,origin:point.toArray(),direction:normal.clone().negate().toArray()});
  }
  // Paired cornices/attic eaves produce real silhouette and shadows. Only the
  // missing facade sections are detailed; finished pedestrian facades keep theirs.
  for(const y of[24.55,31.82,hi-.25])if(y>lo+.15&&y<hi+.02&&!openings.some(o=>o.lo-.3<y&&o.hi+.3>y)){place(len/2,y,len,.17,.78,options.trim,.04);cornices++;}
  place(len/2,hi-.08,len,.16,.96,options.trim,.10);place(len/2,hi-.24,len,.16,.65,shadow,-.02);
  if(edge.zone.includes('reading'))for(let i=0;i<Math.floor(len/1.24);i++)place((i+.5)*len/Math.floor(len/1.24),hi-.39,.18,.22,.51,options.trim,.09);
  // A few horizontal lower stone courses give the northern base scale without
  // repainting or replacing the individually finished west wall.
  for(let y=Math.max(lo+.3,15.5);y<Math.min(23.5,hi);y+=.56){const spans=openings.filter(o=>o.lo<y&&o.hi>y).sort((a,b)=>a.x-b.x);let c=0;for(const o of spans){place((c+o.x-o.width/2)/2,y,o.x-o.width/2-c,.018,.025,shadow,.004);c=o.x+o.width/2;}place((c+len)/2,y,len-c,.018,.025,shadow,.004);}
  const p=wp(edge.a[0]+du*.25,edge.ring===-1?hi-.7:Math.max(lo+.35,Math.min(hi-.35,18.9)),edge.a[1]+dv*.25).addScaledVector(normal,2);wallWitnesses.push({zone:edge.zone,origin:p.toArray(),direction:normal.clone().negate().toArray()});
 };
 for(const edge of plan.edges){const protect=plan.protectedFacades.find(q=>q.ring===edge.ring&&q.edge===edge.edge);
  if(protect){facade(edge,bottom,Math.min(edge.top,protect.top),true);facade(edge,protect.top+.012,edge.top);}
  // The existing east entry includes the entire1.14m north return and1.7m
  // of the south return. Respect these actual modeled lengths.
  else if(edge.ring===0&&edge.edge===21){facade(edge,31.632,edge.top);}
  else if(edge.ring===0&&edge.edge===23){const d=Math.min(1.72,edge.length),t=d/edge.length,part={...edge,a:[T.MathUtils.lerp(edge.a[0],edge.b[0],t),T.MathUtils.lerp(edge.a[1],edge.b[1],t)] as P,length:edge.length-d};facade(part,bottom,edge.top);}
  else facade(edge,bottom,edge.top);
 }
 // Higher volumes rising behind the common terrace receive their own closed
 // vertical returns. No wall is added on the Tower exclusion boundary.
 const inRing=(p:P,r:P[])=>{let inside=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;};
 const inPart=(p:P,q:Part)=>inRing(p,q.outer)&&!q.holes.some(h=>inRing(p,h));
 for(const zone of plan.zones)if(zone.eave>29.5)for(const part of zone.parts)for(const ring of[part.outer,...part.holes])for(let i=0;i<ring.length;i++){
  const a=ring[i],b=ring[(i+1)%ring.length],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<.1)continue;
  const mid=[(a[0]+b[0])/2,(a[1]+b[1])/2]as P;let n=[dz/length,-dx/length]as P;if(inPart([mid[0]+n[0]*.04,mid[1]+n[1]*.04],part))n=[-n[0],-n[1]];
  const outside=[mid[0]+n[0]*.05,mid[1]+n[1]*.05]as P;
  if(!inPart(outside,plan.footprint)||inRing(outside,plan.towerHole.outer))continue;
  const other=plan.zones.find(z=>z!==zone&&z.parts.some(p=>inPart(outside,p)));if(!other||other.eave>=zone.eave-.01)continue;
  facade({ring:-1,edge:-1,a,b,normal:n,zone:zone.id,top:zone.eave,length},other.eave-.18,zone.eave);
 }
 // South front terrace balustrade above the arcade storey. Round 2: deck and rail
 // top from the 2017 LiDAR DSM (deck 35.2, balustrade cells 36.6-36.9 along v -0.7).
 const rail=(u0:number,u1:number,v:number,deck:number,top:number)=>{
  const mat=new T.Matrix4().makeBasis(new T.Vector3(east[0],0,east[1]),new T.Vector3(0,1,0),new T.Vector3(south[0],0,south[1]));
  const b=(u:number,y:number,w:number,h:number,d:number)=>{const m=mat.clone().setPosition(wp(u,y,v));boxWorld(new T.Vector3(),new T.Vector3(w,h,d),options.trim,m);};
  const h=top-deck;b((u0+u1)/2,deck+.09,u1-u0,.18,.36);b((u0+u1)/2,top-.085,u1-u0,.17,.42);
  const count=Math.floor((u1-u0)/.62);for(let i=0;i<=count;i++)b(T.MathUtils.lerp(u0,u1,i/count),deck+h/2,.13,h-.35,.19);
 };
 rail(plan.southRail.u0,plan.southRail.u1,plan.southRail.v,plan.southRail.deck,plan.southRail.top);
 const meshes:T.Mesh[]=[];
 for(const[m,parts]of batches){const g=mergeGeometries(parts,false)!;parts.forEach(p=>p.dispose());g.computeBoundingBox();g.computeBoundingSphere();const mesh=new T.Mesh(g,m);mesh.name=`MAI complete mapped body: ${m.name||'borrowed material'}`;mesh.castShadow=mesh.receiveShadow=true;meshes.push(mesh);}
 let disposed=false;
 return{meshes,materials,colliderGeometries:meshes.map(m=>m.geometry),volumes:[],roofSamples,windowSamples,wallWitnesses,plan,worldPoint:wp,localPoint:local,
  stats:{building:'MAI',scope:'Mapped Main Building wings, north stack block, south upper story and roofs; existing entrances and Tower preserved',zones:plan.zones.length,courtyards:2,courtyardArea:plan.preservedCourtArea,footprintArea:plan.area,roofArea:plan.roofArea,foundationBottom:bottom,windows:openingsCount,facadeSegments,cornices,triangles:meshes.reduce((n,m)=>n+m.geometry.attributes.position.count/3,0),batches:meshes.length,ownedMaterials:materials.length,sourceVolumes:0,verticalDimensionsInferred:true},
  dispose(){if(disposed)return;disposed=true;meshes.forEach(m=>m.geometry.dispose());materials.forEach(m=>m.dispose());}};
}
