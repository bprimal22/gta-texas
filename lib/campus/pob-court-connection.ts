import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { closeGround, type TopTriangle } from './closed-ground';
import { pobVolume } from './pob-frontage';

/** Close the whole strip between POB's south apron and GDC's mapped north
 * edge. Boundary heights come from installed floors; interior grading is
 * inferred. Borrowed material and existing geometry stay caller-owned. */
export function buildPobCourtConnection(options: {
  apron: { boundaryEdges: { a:T.Vector3; b:T.Vector3 }[] };
  along: T.Vector3;
  westHeight: (x:number,z:number)=>number;
  gdcGround: T.Mesh;
  concrete: T.MeshStandardMaterial;
}) {
  const unique=(values:number[])=>values.sort((a,b)=>a-b).filter((v,i,a)=>!i||v-a[i-1]>.0001);
  // The outside apron edges run along the facade's along vector.
  // Reading their actual vertices preserves every graded shared seam.
  const outside=options.apron.boundaryEdges.filter(({a,b})=>{
    const v=b.clone().sub(a);v.y=0;
    return v.dot(options.along)>.8*v.length();
  });
  if(!outside.length)throw new Error('POB court needs the installed apron boundary');
  const vertices=outside.flatMap(e=>[e.a,e.b]).sort((a,b)=>a.x-b.x);
  const north=vertices.filter((p,i)=>!i||p.x-vertices[i-1].x>.0001);
  const west=north[0].x,east=north.at(-1)!.x;
  const northAt=(x:number)=>{
    let i=0;while(i<north.length-2&&x>north[i+1].x)i++;
    return north[i].clone().lerp(north[i+1],T.MathUtils.clamp((x-north[i].x)/(north[i+1].x-north[i].x),0,1));
  };
  // These are the existing GDC frontage's two northern edges.
  const southZ=(x:number)=>x<=30.1?-58.5+(x-10.78)*2.1/19.32:-56.4+(x-30.1)*1.5/15.8;
  const xs=[...north.map(p=>p.x),30.1];
  const floorFaces:T.Vector3[][]=[];
  options.gdcGround.updateWorldMatrix(true,false);
  const g=options.gdcGround.geometry,p=g.attributes.position,index=g.index;
  for(let i=0;i<(index?.count??p.count);i+=3){
    const f=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,index?index.getX(i+j):i+j).applyMatrix4(options.gdcGround.matrixWorld));
    if(f[1].clone().sub(f[0]).cross(f[2].clone().sub(f[0])).normalize().y<.5)continue;
    if(!f.some(v=>v.x>=west-2&&v.x<=east+2&&v.z<-50))continue;
    floorFaces.push(f);
    for(const v of f)if(v.x>west&&v.x<east&&Math.abs(v.z-southZ(v.x))<.0001)xs.push(v.x);
  }
  const lower=(x:number)=>{
    const z=southZ(x);
    for(const[a,b,c]of floorFaces){
      const den=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);
      const u=((b.z-c.z)*(x-c.x)+(c.x-b.x)*(z-c.z))/den;
      const v=((c.z-a.z)*(x-c.x)+(a.x-c.x)*(z-c.z))/den;
      if(Math.min(u,v,1-u-v)>=-.00002)return new T.Vector3(x,u*a.y+v*b.y+(1-u-v)*c.y,z);
    }
    throw new Error(`POB court has no GDC boundary backing at ${x},${z}`);
  };
  for(let x=west+.8;x<east;x+=.8)xs.push(x);
  const columns=unique(xs.filter(x=>x>=west&&x<=east));
  const westTop=northAt(west),westBottom=lower(west);
  const rows=unique([0,.25,.5,.75,1,(-58-westTop.z)/(westBottom.z-westTop.z)].filter(v=>v>=0&&v<=1));
  const point=(x:number,v:number)=>{
    const a=northAt(x),b=lower(x),q=a.clone().lerp(b,v);
    const expected=westTop.clone().lerp(westBottom,v);
    const actual=options.westHeight(west-.000001,expected.z);
    if(!Number.isFinite(actual))throw new Error('POB court west cap height missing');
    q.y+=Math.max(0,1-(x-west)/1.5)*(actual-expected.y);
    return q;
  };
  const top:TopTriangle[]=[];
  for(let i=0;i<columns.length-1;i++)for(let j=0;j<rows.length-1;j++){
    const q=[point(columns[i],rows[j]),point(columns[i+1],rows[j]),point(columns[i+1],rows[j+1]),point(columns[i],rows[j+1])];
    for(const[a,b,c]of[[q[0],q[1],q[2]],[q[0],q[2],q[3]]])
      if(b.clone().sub(a).cross(c.clone().sub(a)).lengthSq()>1e-14)top.push({points:[a,b,c],material:0});
  }
  const ys=top.flatMap(t=>t.points.map(p=>p.y)),low=Math.min(...ys)-.03;
  const ground=closeGround(top,[options.concrete,options.concrete],Math.max(.6,Math.max(...ys)-low+.2),'POB court connection');
  const geometry=mergeGeometries(ground.meshes.map(m=>m.geometry),false)!;
  ground.meshes.forEach(m=>m.geometry.dispose());
  geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const mesh=new T.Mesh(geometry,options.concrete);mesh.name='POB connected court walk';mesh.castShadow=true;mesh.receiveShadow=true;
  // Each footprint piece is convex; the bends come from actual boundary
  // segments, not hundreds of independent masks around individual debris.
  const bends=[west,30.1,...north.slice(1,-1).filter((q,i)=>{
    const a=north[i],b=north[i+2];
    return Math.abs((q.x-a.x)*(b.z-q.z)-(q.z-a.z)*(b.x-q.x))>1e-6;
  }).map(p=>p.x),east];
  const sections=unique(bends),rings:T.Vector3[][]=[];
  for(let i=0;i<sections.length-1;i++){
    const ring=[northAt(sections[i]),northAt(sections[i+1]),lower(sections[i+1]),lower(sections[i])];
    const clean=ring.filter((v,k)=>!k||Math.hypot(v.x-ring[k-1].x,v.z-ring[k-1].z)>.00001);
    rings.push(clean);
  }
  const volumes=rings.map(r=>pobVolume(r,low,4.5));
  const oldGroundTrimVolumes=rings.map(r=>pobVolume(r,low-2,4.5));
  // Clear source/old-soil skirts exactly on the old boundary only over the
  // retained GDC floor. The GDC mesh itself must never be clipped here.
  for(const[a,b]of[[west,30.1],[30.1,east]]){
    const p=lower(a),q=lower(b),ring=[p,q,q.clone().add(new T.Vector3(0,0,.035)),p.clone().add(new T.Vector3(0,0,.035))];
    volumes.push(pobVolume(ring,low,4.5));oldGroundTrimVolumes.push(pobVolume(ring,low-2,4.5));
  }
  let disposed=false;
  return {meshes:[mesh],materials:[] as T.Material[],colliderGeometries:[geometry],volumes,oldGroundTrimVolumes,
    height:ground.height,contains:(x:number,z:number)=>Number.isFinite(ground.height(x,z)),top:ground.top,rings,north,columns,rows,
    stats:{scope:'POB south apron to GDC north edge',inferredGrade:true,triangles:geometry.attributes.position.count/3,batches:1,ownedMaterials:0,volumes:volumes.length,west,east},
    dispose(){if(disposed)return;disposed=true;geometry.dispose();}};
}
