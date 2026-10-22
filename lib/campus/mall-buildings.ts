import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import planData from '../../public/data/mall-buildings-plan.json' with { type: 'json' };
import type { Point } from './types';
import type { CutVolume } from './clip-volume';
import { subtractVolumes } from './clip-volume';
import { buildSpeedwayYardPriorityVolumes, type SpeedwaySupportStrip } from './speedway-yard-priority';

type Building = {abbr:string;name:string;base:number;floors:number;floorHeight:number;roof:string;rings:Point[][];clearance:Point[][][];yards:Point[][][]};
const plan=planData as unknown as {buildings:Building[]};
function triangulate(rings:Point[][]){
 const r=rings.map(p=>p.map(v=>new T.Vector2(...v))),all=r.flat();
 return T.ShapeUtils.triangulateShape(r[0],r.slice(1)).map(ids=>ids.map(i=>all[i]));
}

/** Closed, smooth photo-informed exteriors on individual UT building footprints.
 * These deliberately replace damaged scans; heights and facade rhythms are estimates.
 */
export function buildMallBuildings(groundHeight:(x:number,z:number)=>number, options:{
 /** Replacements that own their exterior, yard and clearance. */
 exclude?:readonly string[];
 /** Replacements that own only the exterior; retain the original grounds. */
 excludeShells?:readonly string[];
 /** EPS legacy yard must not cover the existing Speedway brick/gray paving. */
 speedwaySupportStrips?:readonly SpeedwaySupportStrip[];
 /** Continuous soil grade, independent of the building foundation datum. */
 yardHeight?:(x:number,z:number)=>number;
}={}){
 const materials:T.MeshStandardMaterial[]=[];
 const material=(name:string,color:number,roughness=.86,metalness=0)=>{
  const m=new T.MeshStandardMaterial({color,roughness,metalness});m.name=name;materials.push(m);return m;
 };
 const brick=material('Mall warm masonry',0x97734f), pale=material('Mall pale masonry',0xa69d85);
 const stone=material('Mall limestone trim',0xb0a790), dark=material('Mall dark entrance stone',0x494b47);
 const glass=material('Mall recessed blue green glass',0x294b53,.22,.36);
 const glassShade=material('Mall shaded window glass',0x243438,.32,.25);
 const frame=material('Mall dark bronze window frames',0x4c574f,.45,.55);
 const tile=material('Mall terracotta roof',0x79533d,.94), roof=material('Mall flat roof',0x666860,.98);
 const paving=material('Mall edge paving',0x969184), soil=material('Mall planting soil',0x565a3e);
 for(const [m,unit,contrast] of [[brick,[.24,.085],.16],[pale,[1.2,.6],.05],[tile,[.22,.4],.18]] as const){
  m.onBeforeCompile=s=>{
   s.vertexShader='varying vec2 facadeUv;\n'+s.vertexShader;
   s.vertexShader=s.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nfacadeUv=uv;');
   s.fragmentShader='varying vec2 facadeUv;\n'+s.fragmentShader;
   s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
    vec2 cell=facadeUv/vec2(${unit[0]},${unit[1]});cell.x+=mod(floor(cell.y),2.)*.5;
    vec2 edge=min(fract(cell),1.-fract(cell));vec2 aa=max(fwidth(cell),vec2(.0001));
    float body=smoothstep(.024,.024+aa.x,edge.x)*smoothstep(.024,.024+aa.y,edge.y);
    diffuseColor.rgb*=1.-${contrast}*(1.-body);`);
  };m.customProgramCacheKey=()=>`mall-smooth-${m.name}-v1`;
 }
 const yardPriority=options.speedwaySupportStrips?buildSpeedwayYardPriorityVolumes(options.speedwaySupportStrips):[];
 const batches=new Map<T.Material,T.BufferGeometry[]>();
 const add=(g:T.BufferGeometry,m:T.Material)=>{if(!batches.has(m))batches.set(m,[]);batches.get(m)!.push(g);};
 const box=(x:number,y:number,z:number,w:number,h:number,d:number,m:T.Material,angle=0)=>add(new T.BoxGeometry(w,h,d).rotateY(-angle).translate(x,y,z),m);
 const volumes:CutVolume[]=[];let windows=0,doors=0;
 const included=plan.buildings.filter(b=>!options.exclude?.includes(b.abbr));
 for(const b of included){
  const top=b.base+b.floors*b.floorHeight, bottom=Math.min(b.base-3,...b.rings[0].map(p=>groundHeight(...p)-2));
  if(!options.excludeShells?.includes(b.abbr)){
  const shape=new T.Shape(b.rings[0].map(([x,z])=>new T.Vector2(x,-z)));
  shape.holes=b.rings.slice(1).map(r=>new T.Path(r.map(([x,z])=>new T.Vector2(x,-z))));
  const masonry=['WCP','RLP','WCH'].includes(b.abbr)?pale:brick;
  const body=new T.ExtrudeGeometry(shape,{depth:top-bottom,steps:1,bevelEnabled:false}).rotateX(-Math.PI/2).translate(0,bottom,0);
  // World metre UVs on each facade, independent of the triangulation.
  const pos=body.attributes.position,normal=body.attributes.normal,uv=body.attributes.uv;
  for(let i=0;i<pos.count;i++)uv.setXY(i,Math.abs(normal.getX(i))>.7?pos.getZ(i):pos.getX(i),pos.getY(i));
  add(body,masonry);
  add(new T.ExtrudeGeometry(shape,{depth:.5,steps:1,bevelEnabled:false}).rotateX(-Math.PI/2).translate(0,top,0),b.roof==='tile'?tile:roof);
  const northSide=['EPS','JGB','WCH'].includes(b.abbr);
  const entranceEdge=b.rings[0].reduce((best,a,i,r)=>{
   const c=r[(i+1)%r.length],mid=(a[1]+c[1])/2,length=Math.hypot(a[0]-c[0],a[1]-c[1]);
   if(length<10)return best;
   return best<0|| (northSide?mid>(r[best][1]+r[(best+1)%r.length][1])/2:mid<(r[best][1]+r[(best+1)%r.length][1])/2)?i:best;
  },-1);
  for(const ring of b.rings){
   const area=ring.reduce((s,p,i)=>s+p[0]*ring[(i+1)%ring.length][1]-ring[(i+1)%ring.length][0]*p[1],0);
   for(let i=0;i<ring.length;i++){
    const a=ring[i],c=ring[(i+1)%ring.length],dx=c[0]-a[0],dz=c[1]-a[1],length=Math.hypot(dx,dz);
    if(length<.1)continue;
    const angle=Math.atan2(dz,dx),nx=dz/length*Math.sign(area),nz=-dx/length*Math.sign(area);
    const edgeBox=(t:number,y:number,w:number,h:number,d:number,m:T.Material,offset=.04)=>box(a[0]+dx*t+nx*offset,y,a[1]+dz*t+nz*offset,w,h,d,m,angle);
    edgeBox(.5,b.base+1.1,length,2.2,.12,b.abbr==='WCP'?dark:stone);
    edgeBox(.5,top-.2,length,.42,.42,stone,.13);
    edgeBox(.5,b.base+b.floorHeight,length,.32,.25,stone,.08);
    const bays=Math.floor((length-1.5)/(b.abbr==='WCP'?3.6:3.1));
    for(let f=0;f<b.floors;f++)for(let j=0;j<bays;j++){
     const t=(j+.5)/bays,y=b.base+f*b.floorHeight+b.floorHeight*.53;
     const entrance=ring===b.rings[0]&&i===entranceEdge&&f===0&&Math.abs(j-(bays-1)/2)<.6;
     const w=entrance?2.05:b.abbr==='WCP'?2.7:1.42,h=entrance?2.85:2.35;
     const yy=entrance?b.base+1.45:y;
     edgeBox(t,yy,w+.30,h+.28,.22,stone,.13);
     edgeBox(t,yy,w,h,.08,(j+f)%4===0?glassShade:glass,.265);
     edgeBox(t,yy,.065,h,.10,frame,.32);
     edgeBox(t,yy+.15,w,.05,.10,frame,.32);
     edgeBox(t,yy-h/2-.12,w+.45,.16,.5,stone,.20);
     if(entrance)doors++;else windows++;
    }
   }
  }
  // Low hipped roofs for the rectangular historic buildings. Complex modern
  // footprints keep a closed flat roof rather than an invented giant ridge.
  if(b.roof==='tile'&&b.rings[0].length===4){
   const r=b.rings[0].map(p=>new T.Vector3(p[0],top+.48,p[1]));
   if(r[0].distanceTo(r[1])<r[1].distanceTo(r[2]))r.push(r.shift()!);
   const left=r[0].clone().lerp(r[3],.5),right=r[1].clone().lerp(r[2],.5);
   const p=left.clone().lerp(right,.15),q=left.clone().lerp(right,.85);p.y+=3;q.y+=3;
   const vertices=[r[0],r[1],q,r[0],q,p,r[1],r[2],q,r[2],r[3],p,r[2],p,q,r[3],r[0],p];
   const g=new T.BufferGeometry().setFromPoints(vertices);g.setAttribute('uv',new T.Float32BufferAttribute(vertices.flatMap(v=>[v.x,v.z]),2));g.computeVertexNormals();
   // Both winding orientations remain visible from the paths around the roof.
   tile.side=T.DoubleSide;add(g,tile);
  }
  }
  for(const cell of b.yards){
   const points:number[]=[],uv:number[]=[];
   for(const tri of triangulate(cell)){
    const [p,q,r]=tri,cross=(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
    for(const v of cross>0?[p,r,q]:[p,q,r]){points.push(v.x,(options.yardHeight??groundHeight)(v.x,v.y),v.y);uv.push(v.x,v.y);}
   }
   let g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(points,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.computeVertexNormals();
   if(b.abbr==='EPS'&&yardPriority.length){
    const clipped=subtractVolumes(g,new T.Matrix4(),yardPriority);
    if(clipped){g.dispose();g=clipped;}
   }
   if(g.attributes.position.count)add(g,b.abbr==='WCP'?paving:soil);else g.dispose();
  }
  for(const rings of b.clearance)for(const tri of triangulate(rings)){
   const p=tri.map(v=>new T.Vector3(v.x,0,v.y)),center=p.reduce((s,v)=>s.add(v),new T.Vector3()).multiplyScalar(1/3);
   const planes=p.map((v,i)=>{const d=p[(i+1)%3].clone().sub(v),plane=new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(d.z,0,-d.x).normalize(),v);if(plane.distanceToPoint(center)>0)plane.negate();return plane;});
   const low=bottom-4,high=b.base+72,bounds=new T.Box3().setFromPoints(p);bounds.min.y=low;bounds.max.y=high;
   planes.push(new T.Plane(new T.Vector3(0,-1,0),low),new T.Plane(new T.Vector3(0,1,0),-high));volumes.push({planes,bounds});
  }
 }
 const meshes:T.Mesh[]=[];
 for(const [m,parts] of batches){
  const flat=parts.map(g=>g.index?g.toNonIndexed():g),g=mergeGeometries(flat)!;
  const mesh=new T.Mesh(g,m);mesh.name=`Smooth East Mall buildings: ${m.name}`;mesh.castShadow=mesh.receiveShadow=true;meshes.push(mesh);
  for(const part of new Set([...parts,...flat]))part.dispose();
 }
 return {meshes,materials,volumes,stats:{buildings:included.filter(b=>!options.excludeShells?.includes(b.abbr)).length,windows,doors,triangles:meshes.reduce((n,m)=>n+m.geometry.attributes.position.count/3,0)}};
}
