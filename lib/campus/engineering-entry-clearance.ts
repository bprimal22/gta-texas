import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { closeGround, type TopTriangle } from './closed-ground';
import type { CutVolume } from './clip-volume';
import plan from './engineering-entry-clearance-plan.json' with { type: 'json' };

// Same fixed geographic frame as engineering-courtyard.ts; no dependency on
// its constructor or resource ownership is needed for this additive asset.
const east=new T.Vector3(1,0,.089).normalize(),south=new T.Vector3(-east.z,0,east.x);
const engineeringCourtPoint=(s:number,t:number)=>new T.Vector3(32.1,0,-252.35).addScaledVector(east,s).addScaledVector(south,t);
const engineeringCourtLocal=(x:number,z:number)=>{const p=new T.Vector3(x-32.1,0,z+252.35);return{s:p.dot(east),t:p.dot(south)};};
const profile=(xs:number[],ys:number[],v:number)=>{
  if(v<=xs[0])return ys[0];
  for(let i=1;i<xs.length;i++)if(v<=xs[i])return T.MathUtils.lerp(ys[i-1],ys[i],(v-xs[i-1])/(xs[i]-xs[i-1]));
  return ys.at(-1)!;
};
const volume=(ring:T.Vector3[],low:number,high:number):CutVolume=>{
  const center=ring.reduce((a,p)=>a.add(p),new T.Vector3()).multiplyScalar(1/ring.length);
  const planes=ring.map((p,i)=>{
    const q=ring[(i+1)%ring.length],plane=new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(q.z-p.z,0,p.x-q.x).normalize(),p);
    if(plane.distanceToPoint(center)>0)plane.negate();return plane;
  });
  const bounds=new T.Box3().setFromPoints(ring);bounds.min.y=low;bounds.max.y=high;
  planes.push(new T.Plane(new T.Vector3(0,-1,0),low),new T.Plane(new T.Vector3(0,1,0),-high));
  return {planes,bounds};
};
/** Omit exactly the two tree pairs nearest the EER west entrance. Filter before
 * ForegroundTrees.load so the visual tree and its wood collider are both absent. */
export function keepEngineeringEntryTree(p:{x:number;z:number}){
  const {s,t}=engineeringCourtLocal(p.x,p.z);
  return !(plan.eerRemovedTreeStations.some(v=>Math.abs(s-v)<.001)&&
    plan.eerRemovedTreeT.some(v=>Math.abs(t-v)<.001));
}

/** Source-only EER wing air cleanup and a closed PMA southwest forecourt.
 * PMA grades are measured boundary fits with inferred smooth interior, not a
 * survey. No authored building, road, ground, or borrowed material is mutated. */
export function buildEngineeringEntryClearance(options:{concrete:T.MeshStandardMaterial}) {
  const p=plan.pma,[a,b]=p.roadLine;
  const roadSlope=(b[0]-a[0])/(b[1]-a[1]);
  // Preserve a full 9.144m corridor although the northern OSM service segment
  // lists 5.5m. Actual authored golden paving stops south of this forecourt.
  const westX=(z:number)=>a[0]+roadSlope*(z-a[1])+p.reservedHalfWidth*Math.sqrt(1+roadSlope*roadSlope);
  const sw=new T.Vector3(p.podiumSW[0],0,p.podiumSW[1]),se=new T.Vector3(p.podiumSE[0],0,p.podiumSE[1]);
  const wn=engineeringCourtPoint(9.83,-75.21);
  const cornerZ=sw.z+(p.eastX-sw.x)*(se.z-sw.z)/(se.x-sw.x);
  const eastX=(z:number)=>z<sw.z?sw.x+(wn.x-sw.x)*(z-sw.z)/(wn.z-sw.z):z<cornerZ?sw.x+(se.x-sw.x)*(z-sw.z)/(se.z-sw.z):p.eastX;
  const westY=(z:number)=>T.MathUtils.lerp(profile(p.westZ,p.westY28,z),profile(p.westZ,p.westY34,z),T.MathUtils.clamp((westX(z)-28)/6,0,1));
  const eastY=(z:number)=>z<=-305?T.MathUtils.lerp(6.49,p.eastY[0],T.MathUtils.smoothstep(z,sw.z,-305)):profile(p.eastZ,p.eastY,z);
  const sample=(z:number,q:number)=>{
    const x=T.MathUtils.lerp(westX(z),eastX(z),q);
    const base=T.MathUtils.lerp(westY(z),eastY(z),q);
    const southX=T.MathUtils.lerp(westX(p.southZ),p.eastX,q);
    const southExpected=T.MathUtils.lerp(westY(p.southZ),eastY(p.southZ),q);
    const southActual=profile(p.southX,p.southY,southX);
    // Exact side edge values are authoritative; correction is zero at either
    // end rather than introducing a seam along the conserved road boundary.
    const edgeCorrection=T.MathUtils.lerp(profile(p.southX,p.southY,westX(p.southZ))-westY(p.southZ),profile(p.southX,p.southY,p.eastX)-eastY(p.southZ),q);
    const y=base+(southActual-southExpected-edgeCorrection)*T.MathUtils.smoothstep(z,p.southZ-9,p.southZ);
    return new T.Vector3(x,y,z);
  };
  const unique=(v:number[])=>v.sort((a,b)=>a-b).filter((x,i,a)=>!i||x-a[i-1]>1e-7);
  const rows=unique([p.northZ,sw.z,cornerZ,...p.westZ,...p.eastZ,...Array.from({length:33},(_,i)=>p.northZ+i)].filter(z=>z>=p.northZ&&z<=p.southZ));
  const columns=Array.from({length:33},(_,i)=>i/32),top:TopTriangle[]=[];
  for(let i=0;i<rows.length-1;i++)for(let j=0;j<columns.length-1;j++){
    const a=sample(rows[i],columns[j]),b=sample(rows[i],columns[j+1]),c=sample(rows[i+1],columns[j+1]),d=sample(rows[i+1],columns[j]);
    top.push({points:[a,b,c],material:0},{points:[a,c,d],material:0});
  }
  const ground=closeGround(top,[options.concrete,options.concrete],p.slabDepth,'PMA clear forecourt');
  const geometry=mergeGeometries(ground.meshes.map(m=>m.geometry),false)!;ground.meshes.forEach(m=>m.geometry.dispose());
  geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const mesh=new T.Mesh(geometry,options.concrete);mesh.name='PMA supported clear southwest forecourt';mesh.receiveShadow=mesh.castShadow=true;
  const regions=[p.northZ,sw.z,cornerZ,p.southZ];
  const rings=regions.slice(0,-1).map((z,i)=>[sample(z,0),sample(z,1),sample(regions[i+1],1),sample(regions[i+1],0)]);
  const groundVolumes=rings.map(r=>volume(r,p.sourceLow,p.sourceHigh));
  const airVolumes=plan.eerAir.map(r=>volume([[r.s[0],r.t[0]],[r.s[1],r.t[0]],[r.s[1],r.t[1]],[r.s[0],r.t[1]]].map(([s,t])=>engineeringCourtPoint(s,t)),r.y[0],r.y[1]));
  // The very shallow strip immediately south of the authored tower is already
  // backed by the same forecourt. Preserve the podium/tower geometry itself.
  const wallA=sw.clone(),wallB=sample(cornerZ,1),out=new T.Vector3(-.0886495958,0,.9960628741);
  const facadeAir=volume([wallA,wallB,wallB.clone().addScaledVector(out,2.1),wallA.clone().addScaledVector(out,2.1)],p.sourceHigh-.01,68.1);
  const volumes=[...groundVolumes,...airVolumes,facadeAir];
  let disposed=false;
  return {meshes:[mesh],materials:[] as T.Material[],colliderGeometries:[geometry],volumes,groundVolumes,airVolumes:[...airVolumes,facadeAir],top:ground.top,rings,boundaryEdges:ground.boundaryEdges,
    height:ground.height,westX,eastX,sample,plan,
    stats:{scope:plan.scope,triangles:geometry.attributes.position.count/3,batches:1,ownedMaterials:0,sourceVolumes:volumes.length,removedEerTrees:4,exactSurvey:false},
    dispose(){if(disposed)return;disposed=true;geometry.dispose();}};
}
