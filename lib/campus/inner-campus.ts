import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import plan from '../../public/data/inner-campus-plan.json' with { type: 'json' };
import type { CutVolume } from './clip-volume';
import type { TreePlacement } from './foreground-trees';
import { tagGroundTieIn } from './ground/tag';

/** Measured and graded Inner Campus roads, with exact joins baked from the old
 * foreground. The plan retains official buildings and the existing mall. */
export function buildInnerCampus(asphalt:T.MeshStandardMaterial,concrete:T.MeshStandardMaterial,grass:T.MeshStandardMaterial) {
  return buildGradedGround(plan,asphalt,concrete,grass,'Inner Campus');
}

interface GroundPlan {
  surfaces: {material:string;ring:number[][]}[];
  clearance:number[][][];
  trees:TreePlacement[];
  routeMeters:number;
}

/** Ground and its collision/cut boundaries share one baked triangle plan. */
export function buildGradedGround(plan:GroundPlan,asphalt:T.MeshStandardMaterial,concrete:T.MeshStandardMaterial,grass:T.MeshStandardMaterial,name:string) {
  const planting=new T.MeshStandardMaterial({map:grass.map,color:0x737958,roughness:1});
  const materials={asphalt,concrete,planting};
  const parts:Record<keyof typeof materials,T.BufferGeometry[]>={asphalt:[],concrete:[],planting:[]};
  let planarSlivers=0;
  for(const cell of plan.surfaces){
    const top=cell.ring.map(p=>new T.Vector3(...p as [number,number,number]));
    let area=0;for(let i=0;i<top.length;i++){const a=top[i],b=top[(i+1)%top.length];area+=a.x*b.z-b.x*a.z;}
    if(area<0)top.reverse();
    let longest=0,a=top[0],b=top[1];
    for(const p of top)for(const q of top){const d=(p.x-q.x)**2+(p.z-q.z)**2;if(d>longest){longest=d;a=p;b=q;}}
    if(Math.abs(area)/(2*Math.sqrt(longest))<.001){
      const ax=a.x,az=a.z,ay=a.y,by=b.y,dx=b.x-ax,dz=b.z-az;
      for(const p of top)p.y=T.MathUtils.lerp(ay,by,((p.x-ax)*dx+(p.z-az)*dz)/longest);
      planarSlivers++;
    }
    const bottom=top.map(p=>p.clone().add(new T.Vector3(0,-1.5,0))),positions:number[]=[],uv:number[]=[];
    const triangle=(a:T.Vector3,b:T.Vector3,c:T.Vector3)=>{for(const p of [a,b,c]){positions.push(p.x,p.y,p.z);uv.push(p.x*.5,p.z*.5);}};
    for(let i=1;i<top.length-1;i++){triangle(top[0],top[i+1],top[i]);triangle(bottom[0],bottom[i],bottom[i+1]);}
    for(let i=0;i<top.length;i++){const j=(i+1)%top.length;triangle(top[i],top[j],bottom[i]);triangle(top[j],bottom[j],bottom[i]);}
    const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(positions,3));
    g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.computeVertexNormals();parts[cell.material as keyof typeof materials].push(g);
  }
  const meshes=Object.entries(parts).filter(([,p])=>p.length).map(([kind,geometries])=>{
    const g=mergeGeometries(geometries)!;geometries.forEach(g=>g.dispose());
    const mesh=new T.Mesh(g,materials[kind as keyof typeof materials]);mesh.name=`${name} ${kind}`;mesh.receiveShadow=true;
    return tagGroundTieIn(mesh,name,kind==='planting'?'soil':'paved');
  });
  const volumes:CutVolume[]=plan.clearance.map(triangle=>{
    const points=triangle.map(p=>new T.Vector3(...p as [number,number,number]));
    const center=points.reduce((s,p)=>s.add(p),new T.Vector3()).divideScalar(3);
    const planes=points.map((a,i)=>{const b=points[(i+1)%points.length];
      const plane=new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(b.z-a.z,0,a.x-b.x).normalize(),a);
      if(plane.distanceToPoint(center)>0)plane.negate();plane.constant-=.035;return plane;
    });
    const low=Math.min(...points.map(p=>p.y))-1.7,high=Math.max(...points.map(p=>p.y))+20;
    planes.push(new T.Plane(new T.Vector3(0,-1,0),low),new T.Plane(new T.Vector3(0,1,0),-high));
    const bounds=new T.Box3().setFromPoints(points);bounds.min.x-=.04;bounds.min.z-=.04;bounds.max.x+=.04;bounds.max.z+=.04;bounds.min.y=low;bounds.max.y=high;
    return{planes,bounds};
  });
  const contains=(x:number,z:number)=>volumes.some(v=>v.planes.slice(0,-2).every(p=>p.distanceToPoint(new T.Vector3(x,0,z))<=0));
  return{meshes,materials:[planting],volumes,contains,trees:plan.trees as TreePlacement[],
    colliderGeometries:meshes.map(m=>m.geometry),
    stats:{routeMeters:plan.routeMeters,surfaceCells:plan.surfaces.length,trees:plan.trees.length,planarSlivers,
      triangles:meshes.reduce((n,m)=>n+m.geometry.attributes.position.count/3,0)}};
}
