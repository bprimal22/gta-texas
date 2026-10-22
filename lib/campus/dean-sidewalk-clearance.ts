import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {closeGround,type TopTriangle} from './closed-ground';
import type {CutVolume} from './clip-volume';
import plan from './dean-sidewalk-clearance-plan.json' with {type:'json'};

/** Vertical triangular prism with lower/upper planes parallel to its actual
 * supporting floor triangle. Offsets are vertical metres, not normal distance. */
function prism(points:[T.Vector3,T.Vector3,T.Vector3],low:number,high:number):CutVolume{
  const [a,b,c]=points,center=a.clone().add(b).add(c).multiplyScalar(1/3);
  const normal=b.clone().sub(a).cross(c.clone().sub(a)).normalize();if(normal.y<0)normal.negate();
  const planes=points.map((p,i)=>{
    const q=points[(i+1)%3],plane=new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(q.z-p.z,0,p.x-q.x).normalize(),p);
    if(plane.distanceToPoint(center)>0)plane.negate();return plane;
  });
  planes.push(new T.Plane(normal.clone().negate(),normal.dot(a)+low*normal.y),new T.Plane(normal,-normal.dot(a)-high*normal.y));
  const bounds=new T.Box3().setFromPoints(points);bounds.min.y+=low;bounds.max.y+=high;return{planes,bounds};
}

/** Reconstruct only the photographed/mapped ground-level sidewalk where the
 * scan loses its floor under the real layer1 PMA bridge. The overhead bridge
 * is retained above2.10m pedestrian clearance. End heights are source-measured;
 * the smooth grade between them is inferred. Materials remain caller-owned. */
export function buildDeanSidewalkClearance(options:{concrete:T.MeshStandardMaterial}){
  const [a,b]=plan.centerLine,slope=(b[1]-a[1])/(b[0]-a[0]);
  const centerZ=(x:number)=>a[1]+(x-a[0])*slope;
  const point=(x:number,j:number)=>new T.Vector3(x,T.MathUtils.lerp(plan.westY[j],plan.eastY[j],(x-plan.westX)/(plan.eastX-plan.westX)),centerZ(x)+plan.offsets[j]);
  const top:TopTriangle[]=[];
  for(let j=0;j<2;j++){
    const a=point(plan.westX,j),b=point(plan.eastX,j),c=point(plan.eastX,j+1),d=point(plan.westX,j+1);
    top.push({points:[a,b,c],material:0},{points:[a,c,d],material:0});
  }
  const ground=closeGround(top,[options.concrete,options.concrete],plan.slabDepth,'Dean Keeton bridge sidewalk');
  const geometry=mergeGeometries(ground.meshes.map(m=>m.geometry),false)!;ground.meshes.forEach(m=>m.geometry.dispose());geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const mesh=new T.Mesh(geometry,options.concrete);mesh.name='Dean Keeton supported walk beneath PMA bridge';mesh.castShadow=mesh.receiveShadow=true;
  const groundVolumes=ground.top.map(t=>prism(t.points,plan.sourceLowOffset,plan.sourceHighOffset));
  const northA=point(plan.westX,0),northB=point(plan.eastX,0),outerA=northA.clone().add(new T.Vector3(0,0,-plan.northAirFringe)),outerB=northB.clone().add(new T.Vector3(0,0,-plan.northAirFringe));
  // Rider shoulder clearance slightly outside the nominal north curb. This
  // never cuts the roadway floor: its low plane is45cm above the measured edge.
  const airVolumes=[prism([northA,northB,outerB],plan.northAirLowOffset,plan.sourceHighOffset),prism([northA,outerB,outerA],plan.northAirLowOffset,plan.sourceHighOffset)];
  let disposed=false;
  return{meshes:[mesh],materials:[] as T.Material[],colliderGeometries:[geometry],volumes:[...groundVolumes,...airVolumes],groundVolumes,airVolumes,top:ground.top,height:ground.height,point,centerZ,plan,
    stats:{scope:plan.scope,triangles:geometry.attributes.position.count/3,batches:1,ownedMaterials:0,groundVolumes:groundVolumes.length,airVolumes:airVolumes.length,lengthMeters:Math.hypot(plan.eastX-plan.westX,centerZ(plan.eastX)-centerZ(plan.westX)),areaM2:(plan.eastX-plan.westX)*2.2,bridgePreserved:true,inferredGrade:true},
    dispose(){if(disposed)return;disposed=true;geometry.dispose();}};
}
