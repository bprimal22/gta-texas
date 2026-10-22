import * as T from 'three';
import plan from './welch-north-seam-plan.json' with {type:'json'};
/** Source clearance only: both sides of this narrow overlap already have
 * rendered and physical ground. It starts north of the real building wall. */
export function buildWelchNorthSeamClearance(){
 const volumes=plan.rows.slice(1).map((row,i)=>{
  const previous=plan.rows[i],points=[previous.vertices[0],row.vertices[0],row.vertices[1],previous.vertices[1]].map(p=>new T.Vector3(...p as [number,number,number]));
  const center=points.reduce((a,b)=>a.add(b),new T.Vector3()).multiplyScalar(.25),low=Math.min(...points.map(p=>p.y))-.04;
  const planes=points.map((a,i)=>{const b=points[(i+1)%points.length],p=new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(b.z-a.z,0,a.x-b.x).normalize(),a);if(p.distanceToPoint(center)>0)p.negate();return p});
  planes.push(new T.Plane(new T.Vector3(0,-1,0),low),new T.Plane(new T.Vector3(0,1,0),-plan.sourceCeiling));
  const bounds=new T.Box3().setFromPoints(points);bounds.min.y=low;bounds.max.y=plan.sourceCeiling;return{planes,bounds};
 });
 return{meshes:[] as T.Mesh[],materials:[] as T.MeshStandardMaterial[],colliderGeometries:[] as T.BufferGeometry[],volumes,sourceClearanceVolumes:volumes,stats:{sourceCutVolumes:volumes.length,areaM2:(plan.sEnd-plan.sStart)*(plan.dEnd-plan.dStart),sourceCeiling:plan.sourceCeiling,triangles:0,materialBatches:0},dispose(){}};
}
