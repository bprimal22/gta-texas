import * as T from 'three';
import plan from './garrison-landscape-plan.json' with {type:'json'};
import type {CutVolume} from './clip-volume';
import type {TreePlacement} from './foreground-trees';
type Finish='asphalt'|'concrete'|'soil';
const floors=Object.values(plan.topTriangles).flat();
const inside=(x:number,z:number,r:number[][])=>{let yes=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};
/** Fixed offline-reviewed topology, matching visible and collidable closed slab.
 * Register after final67 soil replacement. Trim only WAG western soil using the returned oldGroundTrimVolumes; materials
 * and their textures are borrowed from the existing Walkway owner.
 */
export function buildGarrisonLandscape(options:Record<Finish,T.Material>){
 const meshes:T.Mesh[]=[],geometries:T.BufferGeometry[]=[];
 const entry=plan.entry;
 const entryPoint=(s:number,d:number,y:number)=>new T.Vector3(entry.wall[0]+entry.along[0]*s+entry.out[0]*d,y,entry.wall[1]+entry.along[1]*s+entry.out[1]*d);
 const rise=(entry.threshold-entry.plazaY)/entry.steps;
 const entryPositions=plan.entryPositions;
 // Smooth only the continuous floor; keep the buried slab and perimeter hard.
 const floorNormals=plan.vertices.map(()=>new T.Vector3());
 for(const tri of floors){const[a,b,c]=tri.map(i=>new T.Vector3(...plan.vertices[i]));const n=b.sub(a).cross(c.sub(a));for(const i of tri)floorNormals[i].add(n);}
 for(const n of floorNormals)n.normalize();
 const push=(out:number[],p:number[])=>out.push(p[0],p[1],p[2]);
 for(const kind of ['asphalt','concrete','soil'] as const){
  const data:number[]=[];
  for(const tri of plan.topTriangles[kind])for(const i of tri)push(data,plan.vertices[i]);
  if(kind==='concrete')data.push(...entryPositions);
  if(kind==='soil'){
   for(const tri of floors)for(const i of [tri[2],tri[1],tri[0]]){const p=plan.vertices[i];push(data,[p[0],plan.bottom,p[2]]);}
   for(const[a,b]of plan.boundaryEdges){const p=plan.vertices[a],q=plan.vertices[b],pb=[p[0],plan.bottom,p[2]],qb=[q[0],plan.bottom,q[2]];for(const v of[p,pb,qb,p,qb,q])push(data,v);}
  }
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(data,3));
  const uv:number[]=[];for(let i=0;i<data.length;i+=3)uv.push(data[i]/2,data[i+2]/2);geometry.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geometry.computeVertexNormals();let normalIndex=0;const normal=geometry.attributes.normal;for(const tri of plan.topTriangles[kind])for(const i of tri){const n=floorNormals[i];normal.setXYZ(normalIndex++,n.x,n.y,n.z);}geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const mesh=new T.Mesh(geometry,options[kind]);mesh.name=`Garrison exterior landscape ${kind}`;mesh.receiveShadow=true;mesh.castShadow=false;meshes.push(mesh);geometries.push(geometry);
 }
 const makeVolumes=(triangles:number[][][]):CutVolume[]=>triangles.map(tri=>{
  const points=tri.map(p=>new T.Vector3(p[0],0,p[1])),center=points.reduce((a,b)=>a.add(b),new T.Vector3()).multiplyScalar(1/3),planes:T.Plane[]=[];
  for(let i=0;i<3;i++){const a=points[i],b=points[(i+1)%3],normal=new T.Vector3(-(b.z-a.z),0,b.x-a.x).normalize(),plane=new T.Plane().setFromNormalAndCoplanarPoint(normal,a);if(plane.distanceToPoint(center)>0)plane.negate();planes.push(plane);}
  const bounds=new T.Box3().setFromPoints(points);bounds.min.y=plan.sourceMinY;bounds.max.y=plan.sourceMaxY;return {planes,bounds};
 });
 const volumes=makeVolumes(plan.cutTriangles),oldGroundTrimVolumes=makeVolumes(plan.trimTriangles);
 const contains=(x:number,z:number)=>inside(x,z,plan.rings[0])&&!plan.rings.slice(1).some(r=>inside(x,z,r));
 const height=(x:number,z:number)=>{const dx=x-entry.wall[0],dz=z-entry.wall[1],s=dx*entry.along[0]+dz*entry.along[1],d=dx*entry.out[0]+dz*entry.out[1];if(Math.abs(s)<=entry.width/2&&d>=0&&d<=entry.landingDepth+(entry.steps-1)*entry.tread){if(d<=entry.landingDepth)return entry.threshold;const i=Math.min(entry.steps,Math.ceil((d-entry.landingDepth)/entry.tread));return entry.threshold-i*rise;}for(const tri of floors){const[a,b,c]=tri.map(i=>plan.vertices[i]);const den=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);if(Math.abs(den)<1e-12)continue;const u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/den,v=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/den;if(Math.min(u,v,1-u-v)>-1e-6)return u*a[1]+v*b[1]+(1-u-v)*c[1];}return null;};
 const treePlacements=(existing:readonly TreePlacement[]):TreePlacement[]=>{
  const out:TreePlacement[]=[];
  for(const site of plan.treeCandidates){if(existing.some(p=>Math.hypot(p.x-site.x,p.z-site.z)<3))continue;const ground=height(site.x,site.z);if(ground===null)continue;const y=ground+.017011718824505806*2.5*site.scale*site.height-.01-site.rootBurial;out.push({x:site.x,y,z:site.z,scale:site.scale,width:site.width,height:site.height,rotation:site.rotation});}
  return out;
 };
 return {entry:{...entry,point:entryPoint,triangles:entryPositions.length/9},meshes,colliderGeometries:geometries,volumes,oldGroundTrimVolumes,height,contains,treePlacements,materials:[] as T.MeshStandardMaterial[],stats:{...plan.stats,triangles:geometries.reduce((n,g)=>n+g.attributes.position.count/3,0),materialBatches:3,sourceMinY:plan.sourceMinY,sourceMaxY:plan.sourceMaxY},dispose(){for(const g of geometries)g.dispose();}};
}
