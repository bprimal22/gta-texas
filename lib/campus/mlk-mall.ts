import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import data from '../../public/data/mlk-mall-plan.json' with { type: 'json' };
import type { Point } from './types';
import type { CutVolume } from './clip-volume';
import type { TreePlacement } from './foreground-trees';

type Cell={kind:'concrete'|'grass'|'gravel';rings:Point[][]};
const plan=data as unknown as {surfaceCells:Cell[];clearance:Point[][][];statue:Point;spawn:Point;areaM2:number;sidePaths:{north:Point[];south:Point[]}};
export const MLK_POSITION=plan.statue;
export const MLK_SPAWN=plan.spawn;
function inRing(x:number,z:number,ring:Point[]){
 let hit=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const a=ring[i],b=ring[j];
  if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])hit=!hit;
 }return hit;
}
export function inMlkMall(x:number,z:number){return plan.clearance.some(r=>inRing(x,z,r[0])&&!r.slice(1).some(h=>inRing(x,z,h)));}
function triangles(rings:Point[][]){
 const r=rings.map(r=>r.map(p=>new T.Vector2(...p))),p=r.flat();
 return T.ShapeUtils.triangulateShape(r[0],r.slice(1)).map(ids=>ids.map(i=>p[i]) as [T.Vector2,T.Vector2,T.Vector2]);
}
/** Mapped mall plus an estimated planting apron; materials and grade are approximations. */
export function buildMlkMall(corridorHeight:(x:number,z:number)=>number,terrainHeight:(x:number,z:number)=>number,sourceConcrete:T.MeshStandardMaterial,sourceGrass:T.MeshStandardMaterial){
 const concrete=new T.MeshStandardMaterial({color:0xb9b5a8,roughness:.96,map:sourceConcrete.map});
 const gravel=new T.MeshStandardMaterial({color:0xd6d2c3,roughness:1});
 const grass=sourceGrass.clone();grass.color.set(0x8b8759);
 const stone=new T.MeshStandardMaterial({color:0xbfb69e,roughness:.96});
 const metal=new T.MeshStandardMaterial({color:0x3c423b,roughness:.65,metalness:.55});
 const wood=new T.MeshStandardMaterial({color:0x686353,roughness:.93});
 const globe=new T.MeshStandardMaterial({color:0xe1e0ce,roughness:.55});
 const materials=[concrete,gravel,grass,stone,metal,wood,globe];
 for(const [mat,isGravel] of [[concrete,false],[gravel,true]] as const){
  mat.onBeforeCompile=shader=>{
   shader.vertexShader='varying vec2 mlkUv;\n'+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nmlkUv=uv*2.0;');
   shader.fragmentShader=`varying vec2 mlkUv;
    float mlkHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    vec2 mlkHash2(vec2 p){return vec2(mlkHash(p),mlkHash(p+17.3));}\n`+shader.fragmentShader;
   if(!isGravel)shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#ifdef USE_MAP
    vec4 c=texture2D(map,vMapUv);float l=dot(c.rgb,vec3(.2126,.7152,.0722));diffuseColor.rgb*=mix(.90,1.06,smoothstep(.05,.7,l));
    #endif`);
   shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',isGravel?`#include <color_fragment>
    vec2 p=mlkUv*25.0,b=floor(p),f=fract(p);float d=9.0;vec2 chosen=vec2(0.0);
    for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++){vec2 o=vec2(float(x),float(y));vec2 q=o+.17+.66*mlkHash2(b+o)-f;float dd=dot(q,q);if(dd<d){d=dd;chosen=b+o;}}
    float aa=max(fwidth(p.x),fwidth(p.y));float detail=1.0-smoothstep(.4,1.6,aa);
    float shade=mix(.63,1.10,mlkHash(chosen));float edge=1.0-smoothstep(.19,.4,sqrt(d));
    diffuseColor.rgb*=mix(.94,shade*mix(.76,1.0,edge),detail);`:`#include <color_fragment>
    vec2 grid=mlkUv/2.7;vec2 edge=min(fract(grid),1.0-fract(grid));vec2 aa=max(fwidth(grid),vec2(.0001));
    float joint=1.0-min(smoothstep(.0008,.0008+aa.x,edge.x),smoothstep(.0008,.0008+aa.y,edge.y));
    diffuseColor.rgb*=1.0-joint*.17;`);
  };
  mat.customProgramCacheKey=()=>isGravel?'mlk-pale-gravel-v1':'mlk-aggregate-v1';
 }
 const [mx,mz]=plan.statue;
 const baseHeight=(x:number,z:number)=>T.MathUtils.lerp(corridorHeight(x,z),terrainHeight(x,z)+.04,T.MathUtils.smoothstep(x,1,18));
 const statueY=baseHeight(mx,mz);
 const height=(x:number,z:number)=>T.MathUtils.lerp(statueY,baseHeight(x,z),T.MathUtils.smoothstep(Math.hypot(x-mx,z-mz),4.8,8.0));
 const batches=new Map<T.Material,T.BufferGeometry[]>();
 function add(g:T.BufferGeometry,m:T.Material){if(!batches.has(m))batches.set(m,[]);batches.get(m)!.push(g);}
 function cellGeometry(cell:Cell){
  const a:number[]=[],uv:number[]=[];
  for(const tri of triangles(cell.rings)){
   const [p,q,r]=tri,cross=(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
   for(const v of cross>0?[p,r,q]:[p,q,r]){a.push(v.x,height(v.x,v.y),v.y);uv.push(v.x/2,v.y/2);}
  }
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(a,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.computeVertexNormals();return g;
 }
 for(const cell of plan.surfaceCells)add(cellGeometry(cell),{concrete,grass,gravel}[cell.kind]);
 // Boundary faces close the local replacement volume; omit the joined Speedway end.
 for(const rings of plan.clearance)for(const ring of rings)for(let i=0;i<ring.length;i++){
  const a=ring[i],b=ring[(i+1)%ring.length];if(Math.max(a[0],b[0])<2)continue;
  const count=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/2);
  for(let j=0;j<count;j++){
   const p=new T.Vector2(...a).lerp(new T.Vector2(...b),j/count),q=new T.Vector2(...a).lerp(new T.Vector2(...b),(j+1)/count);
   const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute([p.x,height(p.x,p.y),p.y,q.x,height(q.x,q.y),q.y,p.x,-4.1,p.y,q.x,-4.1,q.y],3));
   g.setAttribute('uv',new T.Float32BufferAttribute([0,0,1,0,0,2,1,2],2));g.setIndex([0,2,1,1,2,3]);g.computeVertexNormals();add(g,gravel);
  }
 }
 function box(x:number,y:number,z:number,w:number,h:number,d:number,m:T.Material,angle=.087){add(new T.BoxGeometry(w,h,d).rotateY(-angle).translate(x,y,z),m);}
 function bar(x:number,y:number,z:number,h:number,r:number,m:T.Material){add(new T.CylinderGeometry(r,r,h,12).translate(x,y+h/2,z),m);}
 const trees:TreePlacement[]=[],lamps:Point[]=[],benches:Point[]=[];
 // Wide shared canopies give the passage its shade; no species-specific asset acquisition.
 for(const [i,x] of [15,26,36,47,58,69,79,90,112,122,134,145,158].entries())for(const side of [-1,1]){
  const center=63.03+x*.0879,width=19.62+x*.013,z=center+side*(width/2+1.75);
  if(!inMlkMall(x,z))continue;
  // The source trunk bends sideways. Keep its lower branches outside the full
  // sidewalk width instead of enlarging the tree across the walking route.
  trees.push({x,z,y:height(x,z)-.025,rotation:i*2.399+side,scale:.90+(i%3)*.06,width:.85,height:1.25});
 }
 for(const [i,x] of [18,57,116,151].entries())for(const side of [-1,1]){
  const z=63.03+x*.0879+side*(9.6+x*.0065),y=height(x,z);if(!inMlkMall(x,z))continue;
  lamps.push([x,z]);box(x,y+.07,z,.28,.14,.28,stone);bar(x,y+.14,z,4.45,.045,metal);
  add(new T.SphereGeometry(.22,12,10).scale(.9,1.3,.9).translate(x,y+4.85,z),globe);
  if(i%2===0)box(x+.22,y+3.7,z,.36,.73,.018,stone,0);
 }
 for(const [x,side] of [[28,-1],[65,1],[120,-1],[141,1]]){
  const z=63.03+x*.0879+side*6.4,y=height(x,z);if(!inMlkMall(x,z))continue;benches.push([x,z]);
  for(let s=0;s<4;s++)box(x,y+.44,z+(s-1.5)*.105,1.8,.075,.085,wood);
  for(const dx of [-.65,.65])box(x+dx,y+.22,z,.055,.44,.4,metal);
  for(let s=0;s<3;s++)box(x,y+.65+s*.10,z+side*.23,1.8,.075,.06,wood);
 }
 const meshes:T.Mesh[]=[];
 for(const [mat,parts] of batches){
  const flat=parts.map(g=>g.index?g.toNonIndexed():g),g=mergeGeometries(flat)!;
  const mesh=new T.Mesh(g,mat);mesh.name=`MLK East Mall ${mat===concrete?'concrete':mat===gravel?'gravel':mat===grass?'grass':'furnishings'}`;
  mesh.castShadow=mesh.receiveShadow=true;meshes.push(mesh);for(const p of new Set([...parts,...flat]))p.dispose();
 }
 const volumes:CutVolume[]=plan.clearance.flatMap(rings=>triangles(rings).map(tri=>{
  const p=tri.map(v=>new T.Vector3(v.x,0,v.y)),center=p.reduce((s,v)=>s.add(v),new T.Vector3()).multiplyScalar(1/3);
  const planes=p.map((v,i)=>{const d=p[(i+1)%3].clone().sub(v),plane=new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(d.z,0,-d.x).normalize(),v);if(plane.distanceToPoint(center)>0)plane.negate();return plane;});
  const bounds=new T.Box3().setFromPoints(p);bounds.min.y=-4;bounds.max.y=18;
  planes.push(new T.Plane(new T.Vector3(0,-1,0),-4),new T.Plane(new T.Vector3(0,1,0),-18));return{planes,bounds};
 }));
 return {meshes,materials,colliderGeometries:meshes.map(m=>m.geometry),volumes,trees,height,statueY,paths:plan.sidePaths,
  stats:{areaM2:plan.areaM2,trees:trees.length,lamps:lamps.length,benches:benches.length,surfaceCells:plan.surfaceCells.length,triangles:meshes.reduce((n,m)=>n+m.geometry.attributes.position.count/3,0)}};
}
