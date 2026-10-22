import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { annotateGdcGlazing, createGdcGlazing } from './gdc-glazing';
import { detailMainEastLimestone } from './main-east-materials';
import planData from '../../public/data/main-east-entry-plan.json' with {type:'json'};

type P=[number,number];
type Volume={planes:T.Plane[];bounds:T.Box3};
type Witness={kind:string;origin:number[];direction:number[];minimum:number};
const plan=planData as unknown as {a:P;b:P;normal:P;length:number;base:number;height:number;lowerCornice:number;upperOpeningBottom:number;upperOpeningHeight:number;entryHeight:number;northReturnLength:number;southReturnLength:number;cutDepth:number;cutFringe:number;photoIds:string[]};
export interface MainEastEntryOptions {
  /** Current authored ground, excluding this building's own walls/roof. */
  groundHeight:(x:number,z:number)=>number;
  baseElevation?:number;
  /** Bounded scan registration margin. Default 1.15 m; never a campus-wide cut. */
  cutFringe?:number;
  /** Shared, caller-owned mineral color texture; it never changes geometry. */
  stoneTexture?:T.Texture;
}
/** Main Building's 14.74 m east end pavilion, at the East Mall stair arrival.
 * No ground or playable roof is emitted. The Tower and other facades stay intact.
 */
export function buildMainEastEntry(options:MainEastEntryOptions){
 const base=options.baseElevation??plan.base,top=base+plan.height,fringe=options.cutFringe??plan.cutFringe;
 if(!Number.isFinite(base)||!Number.isFinite(fringe)||fringe<0||fringe>2)throw new Error('Invalid Main east entry datum or fringe');
 const u=new T.Vector3(plan.b[0]-plan.a[0],0,plan.b[1]-plan.a[1]).normalize(),out=new T.Vector3(plan.normal[0],0,plan.normal[1]);
 const matrix=new T.Matrix4().makeBasis(u,new T.Vector3(0,1,0),out).setPosition(plan.a[0],0,plan.a[1]);
 const worldPoint=(x:number,y:number,z:number)=>new T.Vector3(x,y,z).applyMatrix4(matrix);
 const ground=(x:number,z:number)=>{const p=worldPoint(x,0,z),y=options.groundHeight(p.x,p.z);if(!Number.isFinite(y))throw new Error('Nonfinite Main east entry ground');return y;};
 const length=plan.length,bottom=Math.min(base-.20,...[0,.25,.5,.75,1].map(t=>ground(length*t,.3)-.15));
 const materials:T.MeshStandardMaterial[]=[],meshes:T.Mesh[]=[],batches=new Map<T.Material,T.BufferGeometry[]>(),samples:Witness[]=[],volumes:Volume[]=[];
 const mat=(name:string,color:number,roughness=.88,metalness=0)=>{const m=new T.MeshStandardMaterial({color,roughness,metalness});m.name=`Main east ${name}`;materials.push(m);return m;};
 // Moderate sRGB stone values avoid an almost-white facade under the game HDR.
 const glazing=()=>{const m=createGdcGlazing('Main east dark bronze glazing');m.roughness=.18;m.envMapIntensity=1.35;materials.push(m);return m;};
 const stone=mat('limestone',0xa59f92),light=mat('pale limestone',0xb0a99a),weathered=mat('weathered blocks',0x999487),joints=mat('masonry joints and recess',0x7d796d),glass=glazing(),blind=mat('muted interior blinds',0x96968a,.93),bronze=mat('bronze frames',0x48483c,.61,.42),wood=mat('dark entry doors',0x343127,.75),iron=mat('dark balcony rail',0x40463d,.63,.4),tile=mat('terracotta roof lip',0x805640,.93);
 for(const m of [stone,light,weathered])detailMainEastLimestone(m,options.stoneTexture);
 const put=(g:T.BufferGeometry,m:T.Material)=>{g.applyMatrix4(matrix);if(matrix.determinant()<0){if(g.index){const ix=g.index;for(let i=0;i<ix.count;i+=3){const t=ix.getX(i);ix.setX(i,ix.getX(i+2));ix.setX(i+2,t);}}else for(const attr of Object.values(g.attributes))for(let i=0;i<attr.count;i+=3)for(let j=0;j<attr.itemSize;j++){const a=i*attr.itemSize+j,b=(i+2)*attr.itemSize+j,t=attr.array[a];attr.array[a]=attr.array[b];attr.array[b]=t;}}if(!batches.has(m))batches.set(m,[]);batches.get(m)!.push(g);};
 const box=(x:number,y:number,w:number,h:number,d:number,m:T.Material,z=-.38)=>{if(w>.001&&h>.001&&d>.001){const g=new T.BoxGeometry(w,h,d).translate(x,y,z);if(m===glass)annotateGdcGlazing(g,'x',u,out,x*3.3+y*5.1);put(g,m);}};
 const probe=(x:number,y:number,kind:string,minimum:number)=>samples.push({kind,origin:worldPoint(x,y,2.5).toArray(),direction:out.clone().negate().toArray(),minimum});
 type Opening={id:string;x:number;bottom:number;w:number;h:number;depth:number;door?:boolean;upper?:boolean};const openings:Opening[]=[];
 const baySpan=length-3.45,bayStep=baySpan/5,center=length/2;
 for(let j=0;j<5;j++){
  const x=1.725+(j+.5)*bayStep;
  openings.push({id:`upper-${j}`,x,bottom:base+plan.upperOpeningBottom,w:1.56,h:plan.upperOpeningHeight,depth:.78,upper:true});
  if(j!==2){openings.push({id:`lower-${j}`,x,bottom:base+3.35,w:1.19,h:2.12,depth:.59});openings.push({id:`basement-${j}`,x,bottom:base+.22,w:1.43,h:1.12,depth:.57});}
 }
 openings.push({id:'ground-entry',x:center,bottom:base,w:1.96,h:plan.entryHeight,depth:1.00,door:true});
 openings.push({id:'balcony-entry',x:center,bottom:base+3.23,w:1.45,h:2.43,depth:.72,door:true});
 // The continuous wall stops at each frame's outer construction bounds.
 // Its former inner boundary coincided with the exposed stone reveal, causing
 // two differently shaded surfaces to compete for the same depth buffer value.
 const constructionOpenings=openings.map(o=>{const trim=o.upper?.15:o.door?.18:.13;return {...o,w:o.w+2*trim,bottom:o.bottom-.075,h:o.h+trim+.075};});
 const horizontalIntervals=(lo:number,hi:number)=>{const holes=constructionOpenings.filter(o=>o.bottom<hi&&o.bottom+o.h>lo).sort((a,b)=>a.x-b.x);const spans:[number,number][]=[];let cursor=0;for(const o of holes){spans.push([cursor,o.x-o.w/2]);cursor=Math.max(cursor,o.x+o.w/2);}spans.push([cursor,length]);return spans.filter(([a,b])=>b>a);};
 const levels=[bottom,top,...constructionOpenings.flatMap(o=>[o.bottom,o.bottom+o.h])].filter(y=>y>=bottom&&y<=top).sort((a,b)=>a-b);
 for(let k=0;k<levels.length-1;k++){const lo=levels[k],hi=levels[k+1];if(hi-lo<.001)continue;for(const[a,b]of horizontalIntervals(lo+.0001,hi-.0001))box((a+b)/2,(lo+hi)/2,b-a,hi-lo,.86,joints,-.42);}
 // Stone blocks are physical relief, clipped to each opening, not a flat image.
 const course=.51,block=1.28;
 for(let row=0;row<Math.ceil((top-bottom)/course);row++){
  const lo=bottom+row*course,hi=Math.min(top,lo+course-.026);if(hi<=lo)continue;
  const spans=horizontalIntervals(lo,hi);
  for(let j=-1;j<Math.ceil(length/block);j++){
   const a0=Math.max(0,j*block+(row%2)*block/2),b0=Math.min(length,(j+1)*block+(row%2)*block/2-.022);
   for(const[a,b]of spans){const l=Math.max(a,a0),r=Math.min(b,b0);if(r-l<.025)continue;const m=(row*7+j*3)%13===0?weathered:(row+j)%4===0?light:stone;const relief=hi<base+plan.lowerCornice?.085:.038;box((l+r)/2,(lo+hi)/2,r-l,hi-lo,relief,m,.02+relief/2);}
  }
 }
 for(const o of openings){
  const y=o.bottom+o.h/2,trim=o.upper?.15:o.door?.18:.13;
  // The side and head reveals run all the way to the inset leaf/glass.
  for(const sign of[-1,1])box(o.x+sign*(o.w/2+trim/2),y,trim,o.h+.15,o.depth+.12,stone,-o.depth/2+.04);
  box(o.x,o.bottom+o.h+trim/2,o.w+trim*2,trim,o.depth+.16,light,-o.depth/2+.05);
  box(o.x,o.bottom-.075,o.w+.30,.15,o.depth+.28,stone,-o.depth/2+.08);
  box(o.x,y,o.w,o.h,.10,o.door?wood:glass,-o.depth);
  const cols=o.upper?2:2,rows=o.upper?4:o.door?2:3;
  for(let c=1;c<cols;c++)box(o.x-o.w/2+o.w*c/cols,y,.035,o.h,.07,bronze,-o.depth+.09);
  for(let r=1;r<rows;r++)box(o.x,o.bottom+o.h*r/rows,o.w,.04,.07,bronze,-o.depth+.09);
  if(o.upper){
   // The tall windows in L023 have pale lowered blinds behind bronze sash.
   box(o.x,o.bottom+o.h*.65,o.w-.09,o.h*.66,.018,blind,-o.depth+.058);
   for(let r=1;r<4;r++)box(o.x,o.bottom+o.h*r/4,o.w,.044,.07,bronze,-o.depth+.10);
   const points:T.Vector3[]=[];for(let i=0;i<=12;i++){const t=i/12;points.push(new T.Vector3(o.x-o.w/2+t*o.w,o.bottom+.54,.15+Math.sin(t*Math.PI)*.20));}
   put(new T.TubeGeometry(new T.CatmullRomCurve3(points),18,.023,5,false),iron);
   for(let i=0;i<=9;i++){const t=i/9;box(o.x-o.w/2+t*o.w,o.bottom+.26,.023,.5,.024,iron,.15+Math.sin(t*Math.PI)*.20);}
   probe(o.x-o.w*.29,o.bottom+o.h*.19,`${o.id} deep glazed bay`,3.10);
   probe(o.x-o.w*.29,o.bottom+o.h*.64,`${o.id} blind behind sash`,3.10);
  }else{
   // Projecting flat heads and tapered keystones in the lower rusticated wall.
   if(!o.door){const k=new T.Shape();k.moveTo(-.13,0);k.lineTo(.13,0);k.lineTo(.21,.32);k.lineTo(-.21,.32);k.closePath();put(new T.ExtrudeGeometry(k,{depth:.09,steps:1,bevelEnabled:false}).translate(o.x,o.bottom+o.h+.04,.08),light);}
   probe(o.x-o.w*.28,o.bottom+o.h*(o.id==='balcony-entry'?.61:.24),`${o.id} recessed opening`,o.door?3.05:2.95);
  }
  if(o.door){for(const sign of[-1,1])box(o.x+sign*.13,o.bottom+1.16,.026,.32,.07,bronze,-o.depth+.16);}
 }
 // Upper hall: four slim stone columns separate the five tall glazed bays.
 for(let i=1;i<5;i++){
  const x=1.725+i*bayStep,y=base+9.35;
  put(new T.CylinderGeometry(.155,.19,5.12,14,1).translate(x,y,.21),light);
  box(x,base+6.74,.46,.17,.51,stone,.18);box(x,base+11.98,.47,.18,.51,light,.18);box(x,base+12.11,.59,.13,.59,stone,.16);
 }
 for(const x of[1.45,length-1.45]){box(x,base+9.39,.44,5.75,.35,stone,.11);box(x,base+12.20,.66,.20,.56,light,.19);}
 // Ground doorway surround is substantial but leaves the aperture unobstructed.
 for(const sign of[-1,1]){box(center+sign*1.18,base+1.55,.27,3.1,.32,light,.17);box(center+sign*1.27,base+3.02,.46,.21,.46,stone,.18);}
 box(center,base+3.13,2.96,.20,.67,light,.23);
 // The photographed central balcony: deep slab, turned stone balusters and
 // two corbels. Its underside is high enough to retain entry clearance.
 box(center,base+3.30,2.83,.24,1.15,stone,.56);
 for(const sign of[-1,1]){
  const s=new T.Shape();s.moveTo(-.31,base+3.20);s.lineTo(.28,base+3.20);s.lineTo(.18,base+2.72);s.lineTo(-.15,base+2.47);s.lineTo(-.31,base+2.47);s.closePath();
  // Local corbel profile is in Y/Z, extruded along the balcony width.
  const g=new T.ExtrudeGeometry(s,{depth:.28,steps:1,bevelEnabled:false}).rotateY(-Math.PI/2).translate(center+sign*.94+.14,0,.52);put(g,stone);
 }
 const balusterProfile=[new T.Vector2(.065,0),new T.Vector2(.074,.06),new T.Vector2(.043,.16),new T.Vector2(.044,.37),new T.Vector2(.083,.50),new T.Vector2(.086,.56)];
 for(let i=0;i<10;i++)put(new T.LatheGeometry(balusterProfile,8).translate(center-1.21+i*2.42/9,base+3.43,1.035),light);
 for(const sign of[-1,1]){box(center+sign*1.34,base+3.72,.15,.62,1.08,stone,.56);}
 box(center,base+4.06,2.90,.14,1.17,light,.56);
 // Lower cornice and upper roof-edge silhouette, with shaded soffits and small
 // dentils. Only a narrow tile lip is authored; the existing roof is preserved.
 for(const[y,h,d,z]of[[base+6.05,.16,.64,.20],[base+6.23,.22,.96,.34],[base+6.38,.08,.85,.34],[base+12.72,.18,.55,.16],[base+12.89,.16,.79,.28],[base+13.025,.11,.98,.35]])box(length/2,y,length,h,d,stone,z);
 for(let i=0;i<35;i++)box(length*(i+.5)/35,base+12.70,.18,.19,.23,light,.37);
 const tiles=Math.floor(length/.23);for(let i=0;i<tiles;i++)put(new T.CylinderGeometry(.068,.068,.42,7,1,true,Math.PI/2,Math.PI).rotateX(Math.PI/2).translate(length*(i+.5)/tiles,top+.035,.34),tile);
 // Short returns sit inside the official adjacent walls. They have the same
 // visible and physical geometry and do not extend the facade into the routes.
 for(const[x,depth]of[[.12,plan.northReturnLength],[length-.12,plan.southReturnLength]]){
  box(x,(bottom+top)/2,.24,top-bottom,depth,stone,-depth/2);
  for(const y of[base+6.23,base+12.89])box(x,y,.42,.19,depth,light,-depth/2);
 }
 for(const x of[.65,length-.65])probe(x,base+5.8,'solid end pier',0);
 for(const[m,parts]of batches){const flat=parts.map(g=>g.index?g.toNonIndexed():g),g=mergeGeometries(flat)!;g.computeBoundingBox();g.computeBoundingSphere();const mesh=new T.Mesh(g,m);mesh.name=`MAI east arrival facade: ${m.name}`;mesh.castShadow=mesh.receiveShadow=true;meshes.push(mesh);for(const part of new Set([...parts,...flat]))part.dispose();}
 // Convex cuts have local above-ground floors. The apron, stairs, upper Tower,
 // and west/south facade volumes are never included in this narrow strip.
 const cellCount=Math.ceil(length/3.6);
 for(let i=0;i<cellCount;i++){
  const a=length*i/cellCount,b=length*(i+1)/cellCount;
  const points=[[a,-plan.cutDepth],[b,-plan.cutDepth],[b,fringe],[a,fringe]].map(([x,z])=>worldPoint(x,0,z));
  const centerPoint=points.reduce((s,p)=>s.add(p),new T.Vector3()).multiplyScalar(.25);
  const floor=Math.max(base+.025,...points.map(p=>options.groundHeight(p.x,p.z)+.20),options.groundHeight(centerPoint.x,centerPoint.z)+.20);
  if(!Number.isFinite(floor))throw new Error('Nonfinite Main east cut floor');
  const planes=points.map((a,j)=>{const b=points[(j+1)%4],p=new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(b.z-a.z,0,a.x-b.x).normalize(),a);if(p.distanceToPoint(centerPoint)>0)p.negate();return p;});
  planes.push(new T.Plane(new T.Vector3(0,-1,0),floor),new T.Plane(new T.Vector3(0,1,0),-(top+.16)));
  const bounds=new T.Box3().setFromPoints(points);bounds.min.y=floor;bounds.max.y=top+.16;volumes.push({planes,bounds});
 }
 const entrance={facade:'east',position:worldPoint(center,base,0).toArray(),normal:out.toArray(),groundSample:ground(center,1.3)};
 return{meshes,materials,colliderGeometries:meshes.map(m=>m.geometry),volumes,candidateClearanceVolumes:volumes,samples,entrancePoints:[entrance],stats:{building:'MAI',scope:'East arrival pavilion only',base,top,sourcePhotoIds:plan.photoIds,tallUpperBays:5,openings:openings.length,triangles:meshes.reduce((n,m)=>n+m.geometry.attributes.position.count/3,0),materialBatches:meshes.length,cutVolumes:volumes.length}};
}
