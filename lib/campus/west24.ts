import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import plan from '../../public/data/west24-plan.json' with { type: 'json' };
import type { CutVolume } from './clip-volume';
import type { TreePlacement } from './foreground-trees';
import { tagGroundTieIn } from './ground/tag';

type Point = [number, number];
export const west24Route = plan.route as Point[];
const interpolate = (knots: number[][], value: number) => {
  if (value <= knots[0][0]) return knots[0][1];
  for (let i = 1; i < knots.length; i++) {
    if (value > knots[i][0]) continue;
    const a = knots[i - 1], b = knots[i];
    return T.MathUtils.lerp(a[1], b[1], (value - a[0]) / (b[0] - a[0]));
  }
  return knots.at(-1)![1];
};

// Heights from the low-origin live ground witnesses, in calibrated local metres.
// These are fitted road grades, not surveyed elevations or canopy intersections.
const westGrade = [[-200.963,12.08],[-190,11.39],[-180,10.84],[-171.713,10.12],
  [-160,9.72],[-150,9.48],[-140,9.03],[-120.27,8.33],[-118.22,8.18],[-89,7.18],[-68,6.56]];
const southGrade = [[-146.578,12.08],[-130,12.57],[-116.02,12.77],[-108.46,12.87],
  [-100,13.00],[-85,13.48],[-70,14.15],[-59,14.56],[-45,15.35],[-38.68,15.81],[-35.483,15.95]];

function closest(x: number, z: number) {
  let distance = Infinity, result = { x, z, chainage: 0 };
  let chainage = 0;
  for (let i = 1; i < west24Route.length; i++) {
    const a = west24Route[i - 1], b = west24Route[i], dx = b[0] - a[0], dz = b[1] - a[1];
    const length = Math.hypot(dx, dz), t = T.MathUtils.clamp(((x-a[0])*dx+(z-a[1])*dz)/(length*length),0,1);
    const px=a[0]+dx*t,pz=a[1]+dz*t,d=Math.hypot(x-px,z-pz);
    if(d<distance){distance=d;result={x:px,z:pz,chainage:chainage+length*t};}
    chainage+=length;
  }
  return result;
}

function convexVolume(source: number[][], low: number, high: number): CutVolume {
  const ring=source.map(([x,z])=>new T.Vector3(x,0,z));
  const center=ring.reduce((sum,p)=>sum.add(p),new T.Vector3()).divideScalar(ring.length);
  const planes=ring.map((a,i)=>{
    const b=ring[(i+1)%ring.length];
    const p=new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(b.z-a.z,0,a.x-b.x).normalize(),a);
    if(p.distanceToPoint(center)>0)p.negate();return p;
  });
  planes.push(new T.Plane(new T.Vector3(0,-1,0),low),new T.Plane(new T.Vector3(0,1,0),-high));
  const bounds=new T.Box3().setFromPoints(ring);bounds.min.y=low;bounds.max.y=high;
  return {planes,bounds};
}

export function buildWest24(
  approachHeight:(x:number,z:number)=>number,
  asphalt:T.MeshStandardMaterial,concrete:T.MeshStandardMaterial,grass:T.MeshStandardMaterial,
) {
  const height=(x:number,z:number,kind='asphalt')=>{
    const p=closest(x,z);
    const south=p.x<=-200.96 && p.z>=-146.578;
    const measured=south?interpolate(southGrade,p.z):interpolate(westGrade,p.x);
    // The first metres meet the existing continuous Hackerman road exactly.
    const road=T.MathUtils.lerp(approachHeight(x,z)+.02,measured,T.MathUtils.smoothstep(p.chainage,0,20));
    const curb=(kind==='concrete'?.14:kind==='soil'?.10:0)*T.MathUtils.smoothstep(p.chainage,0,5);
    return road+curb;
  };
  const soil=new T.MeshStandardMaterial({map:grass.map,color:0x69674c,roughness:1});
  const batches:Record<string,T.BufferGeometry[]>={asphalt:[],concrete:[],soil:[]};
  const volumes:CutVolume[]=plan.clearance.map(ring=>{
    const heights=ring.map(([x,z])=>height(x,z));
    return convexVolume(ring,Math.min(...heights)-1.5,Math.max(...heights)+20);
  });
  const contains=(x:number,z:number)=>volumes.some(v=>v.planes.slice(0,-2).every(p=>p.distanceToPoint(new T.Vector3(x,0,z))<=1e-6));
  let planarSlivers=0;
  for(const cell of plan.surfaces){
    const ring=cell.ring;
    let area=0;for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];area+=a[0]*b[1]-b[0]*a[1];}
    const top=ring.map(([x,z])=>new T.Vector3(x,height(x,z,cell.kind),z));
    if(area<0)top.reverse();
    let distance=0, a=top[0], b=top[1];
    for(const p of top)for(const q of top){const d=(p.x-q.x)**2+(p.z-q.z)**2;if(d>distance){distance=d;a=p;b=q;}}
    if(Math.abs(area)/(2*Math.sqrt(distance))<.001){
      const ax=a.x,az=a.z,ay=a.y,by=b.y,dx=b.x-ax,dz=b.z-az;
      for(const p of top)p.y=T.MathUtils.lerp(ay,by,((p.x-ax)*dx+(p.z-az)*dz)/distance);
      planarSlivers++;
    }
    const bottom=top.map(p=>p.clone().add(new T.Vector3(0,-1.55,0))),positions:number[]=[],uv:number[]=[];
    const tri=(a:T.Vector3,b:T.Vector3,c:T.Vector3)=>{for(const p of [a,b,c]){positions.push(p.x,p.y,p.z);uv.push(p.x*.5,p.z*.5);}};
    for(let i=1;i<top.length-1;i++){tri(top[0],top[i+1],top[i]);tri(bottom[0],bottom[i],bottom[i+1]);}
    // Side faces: u runs along the edge and v down the face, so the 1.55 m
    // skirt shows the finish at true scale instead of XZ-projected streaks.
    let run=0;
    for(let i=0;i<top.length;i++){const j=(i+1)%top.length,len=Math.hypot(top[j].x-top[i].x,top[j].z-top[i].z);
      for(const [p,u,v] of [[top[i],run,0],[top[j],run+len,0],[bottom[i],run,1.55],[top[j],run+len,0],[bottom[j],run+len,1.55],[bottom[i],run,1.55]] as const){
        positions.push(p.x,p.y,p.z);uv.push(u*.5,v*.5);}
      run+=len;}
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));
    g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.computeVertexNormals();batches[cell.kind].push(g);
  }
  const materials={asphalt,concrete,soil};
  const meshes=Object.entries(batches).map(([kind,parts])=>{
    const geometry=mergeGeometries(parts)!;parts.forEach(g=>g.dispose());
    const mesh=new T.Mesh(geometry,materials[kind as keyof typeof materials]);
    mesh.name=`West 24th and Tower north ${kind}`;mesh.receiveShadow=true;
    // Graded soil/lawn tie-ins replace the exposed slab sides (ground/tie-ins.ts).
    return tagGroundTieIn(mesh,'West 24th and Tower north',kind==='soil'?'soil':'paved');
  });
  const trees:TreePlacement[]=plan.trees.map(p=>({...p,y:height(p.x,p.z,'soil')-.02}));
  // Asphalt meets Speedway's retained golden strip; never paint over it merely
  // because the crossing's OSM ways share a street classification.
  const crossX=(z:number)=>12.785+(-z-135.382)*.0913;
  const crossingVolumes=[convexVolume([[-150,-1],[-150,1],[-119,1],[-119,-1]].map(([z,side])=>[crossX(z)+side*4.59,z]),-1000,1000)];
  return {meshes,materials:[soil],colliderGeometries:meshes.map(m=>m.geometry),volumes,crossingVolumes,contains,height,trees,
    stats:{routeMeters:plan.routeMeters,surfaceCells:plan.surfaces.length,trees:trees.length,planarSlivers,
      triangles:meshes.reduce((n,m)=>n+m.geometry.attributes.position.count/3,0)}};
}
