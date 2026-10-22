import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CutVolume } from './clip-volume';
import plan from './gdc-north-neck-plan.json' with { type: 'json' };

/** The small official GDC projection between its straight north elevation and
 * the POB connector. Materials are borrowed; this asset owns only its buffers. */
export function buildGdcNorthNeck(options: {
  stone: T.MeshStandardMaterial; brick: T.MeshStandardMaterial;
  metal: T.MeshStandardMaterial; concrete: T.MeshStandardMaterial;
}) {
  const v = (p: number[]) => new T.Vector3(p[0], 0, p[1]);
  const C = v(plan.northWest), D = v(plan.northEast), E = v(plan.southEast), A = v(plan.southWest);
  const width = C.distanceTo(D), depth = (C.distanceTo(A) + D.distanceTo(E)) / 2;
  // Bilinear interpolation retains all four official/shared corners; the two
  // maps differ by ~10cm at D, so a forced rectangle would leave a thin seam.
  const point = (q: number, t: number, y = 0) => C.clone().lerp(D, q / width).lerp(A.clone().lerp(E, q / width), t / depth).setY(y);
  const roofY = (q: number) => T.MathUtils.lerp(plan.eave, plan.ridge,
    T.MathUtils.clamp((q + plan.eaveOut) / (plan.ridgeDepth + plan.eaveOut), 0, 1));
  const mats = [options.stone, options.brick, options.metal, options.concrete];
  const parts: T.BufferGeometry[][] = mats.map(() => []);
  const topology: { name: string; vertices: number[][]; triangles: number[][] }[] = [];
  const solid = (name: string, q0: number, q1: number, t0: number, t1: number,
    bottom: (q: number) => number, top: (q: number) => number, mat: number) => {
    const qt = [[q0,t0],[q1,t0],[q1,t1],[q0,t1]];
    const lower = qt.map(([q,t]) => point(q,t,bottom(q))), upper = qt.map(([q,t]) => point(q,t,top(q)));
    const all = [...lower,...upper], center = all.reduce((s,p) => s.add(p),new T.Vector3()).multiplyScalar(1/8);
    const indices: number[][] = [];
    const quad = (ids: number[], wanted: T.Vector3) => {
      const [a,b,c] = ids.map(i => all[i]);
      if (b.clone().sub(a).cross(c.clone().sub(a)).dot(wanted) < 0) ids.reverse();
      indices.push([ids[0],ids[1],ids[2]],[ids[0],ids[2],ids[3]]);
    };
    quad([0,1,2,3],new T.Vector3(0,-1,0)); quad([4,5,6,7],new T.Vector3(0,1,0));
    for (let i=0;i<4;i++) { const j=(i+1)%4; quad([i,j,j+4,i+4],all[i].clone().lerp(all[j],.5).sub(center).setY(0)); }
    const vertices = indices.flatMap(tri => tri.flatMap(i => all[i].toArray())), uv: number[] = [];
    for (const tri of indices) {
      const normal = all[tri[1]].clone().sub(all[tri[0]]).cross(all[tri[2]].clone().sub(all[tri[0]])).normalize();
      for (const i of tri) uv.push(Math.abs(normal.y)>.5 ? all[i].x : Math.abs(normal.x)>.5 ? all[i].z : all[i].x,
        Math.abs(normal.y)>.5 ? all[i].z : all[i].y);
    }
    const g = new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(vertices,3))
      .setAttribute('uv',new T.Float32BufferAttribute(uv,2)); g.computeVertexNormals(); parts[mat].push(g);
    topology.push({name,vertices:all.map(p=>p.toArray()),triangles:indices});
  };
  // A 20mm slab lip overlaps the already-backed connector foundation;
  // source clearance still ends exactly at C-D. This avoids float-edge cracks.
  solid('closed foundation',0,width,-.02,depth,()=>plan.floor-plan.slabDepth,()=>plan.floor,3);
  for (const [q0,q1] of [[0,plan.ridgeDepth],[plan.ridgeDepth,width]]) {
    solid('closed sloping metal roof',q0,q1,0,depth, q=>roofY(q)-plan.roofThickness,roofY,2);
    for (const [name,t0,t1] of [['north join',0,plan.wallThickness],['south building join',depth-plan.wallThickness,depth]] as const) {
      solid(name+' stone',q0,q1,t0,t1,()=>plan.floor,()=>plan.floor+plan.stoneBaseHeight,0);
      solid(name+' brick',q0,q1,t0,t1,()=>plan.floor+plan.stoneBaseHeight,q=>roofY(q)-plan.roofThickness+.01,1);
    }
  }
  // Hidden returns are deliberately simple solid masonry, not invented doors.
  for (const [name,q0,q1] of [['west return',0,plan.wallThickness],['east return',width-plan.wallThickness,width]] as const) {
    solid(name+' stone',q0,q1,0,depth,()=>plan.floor,()=>plan.floor+plan.stoneBaseHeight,0);
    solid(name+' brick',q0,q1,0,depth,()=>plan.floor+plan.stoneBaseHeight,q=>roofY(q)-plan.roofThickness+.01,1);
  }
  // The same standing seam direction and pitch continue across the shared roof.
  // These low strips do not add collision spikes: their 25mm relief is included
  // in the exact rendered collider and lies inside the inaccessible roof.
  let seamCount = 0;
  for (let t=.3;t<depth-.1;t+=.46) {
    solid('standing seam',0,plan.ridgeDepth,t-.0125,t+.0125,q=>roofY(q),q=>roofY(q)+.025,2); seamCount++;
  }
  const meshes = parts.flatMap((items,i) => {
    if (!items.length) return [];
    const g = mergeGeometries(items,false)!; items.forEach(p=>p.dispose()); g.computeBoundingBox(); g.computeBoundingSphere();
    const mesh = new T.Mesh(g,mats[i]); mesh.name = `GDC north neck: ${['stone base','brick returns','metal roof','closed foundation'][i]}`;
    mesh.castShadow=true;mesh.receiveShadow=true;return [mesh];
  });
  const ring = [C,D,E,A], center = ring.reduce((s,p)=>s.add(p),new T.Vector3()).multiplyScalar(.25);
  const planes = ring.map((a,i)=> {
    const b=ring[(i+1)%4],p=new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(b.z-a.z,0,a.x-b.x).normalize(),a);
    if(p.distanceToPoint(center)>0)p.negate();return p;
  });
  const contains = (x:number,z:number) => planes.every(p=>p.distanceToPoint(new T.Vector3(x,0,z))<=1e-8);
  const bounds = new T.Box3().setFromPoints(ring); bounds.min.y=plan.sourceCutBottom;bounds.max.y=plan.sourceCutTop;
  const volume: CutVolume = {bounds,planes:[...planes,new T.Plane(new T.Vector3(0,-1,0),plan.sourceCutBottom),new T.Plane(new T.Vector3(0,1,0),-plan.sourceCutTop)]};
  let disposed=false;
  return {meshes,materials:[] as T.MeshStandardMaterial[],colliderGeometries:meshes.map(m=>m.geometry),
    volumes:[volume],sourceClearanceVolumes:[volume],groundVolumes:[volume],contains,
    groundHeight:(x:number,z:number)=>contains(x,z)?plan.floor:null,point,roofY,plan,topology,
    stats:{scope:'Official GDC north low projection only',triangles:meshes.reduce((n,m)=>n+m.geometry.attributes.position.count/3,0),drawCalls:meshes.length,newMaterials:0,cutVolumes:1,seamCount,width,depth,area:Math.abs(ring.reduce((s,a,i)=>{const b=ring[(i+1)%4];return s+a.x*b.z-b.x*a.z;},0))/2},
    dispose(){if(disposed)return;disposed=true;meshes.forEach(m=>m.geometry.dispose());},
  };
}
