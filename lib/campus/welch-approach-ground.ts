import * as T from 'three';
type P = [number,number,number];
type Volume = {planes:T.Plane[];bounds:T.Box3};
type Surface = {a:T.Vector3;b:T.Vector3;c:T.Vector3;facade:'west'|'south'};
export interface WelchApproachGroundOptions {
  /** A strict ray against existing authored ground. Undefined means no support;
   * never provide the nearest-surface fallback used for facade foundations. */
  groundHeight:(x:number,z:number)=>number|undefined;
  material:T.MeshStandardMaterial;
  /** Provisional local grades inferred from photo step scale, not a survey. */
  westLandingElevation?:number;
  southLandingElevation?:number;
  /** Closed fill sides end below observed adjacent yard, whose minimum is4.596. */
  bottomElevation?:number;
}
const frames = {
 west:{position:[-47.472303022398776,0,16.32924984291715] as P,normal:[-.9961769724079679,0,-.08735811149569886] as P},
 south:{position:[-38.90528227871023,0,37.93899038593919] as P,normal:[-.08629701582403679,0,.9962694540433655] as P},
};
/** Bounded supported routes to the Mall. Build first, query their exact surface
 * for the short aprons, then trim only the route/old ground inside those aprons.
 * The west route turns south beside Welch; it does not bridge to distant WCH. */
export function buildWelchApproachGround(options:WelchApproachGroundOptions){
 if(!options?.groundHeight||!options.material)throw new Error('Welch approach ground requires strict ground ray and material');
 const levels={west:options.westLandingElevation??7.1,south:options.southLandingElevation??6.1},bottom=options.bottomElevation??4.2;
 if(![...Object.values(levels),bottom].every(Number.isFinite)||bottom>=Math.min(...Object.values(levels))-.4)throw new Error('Invalid Welch approach elevations');
 const meshes:T.Mesh[]=[],colliderGeometries:T.BufferGeometry[]=[],surfaces:Surface[]=[],authoredGroundTrimVolumes:Volume[]=[],sourceClearanceVolumes:Volume[]=[];
 const anchorSamples:{facade:string;u:number;d:number;position:P}[]=[],samples:{facade:string;kind:string;position:P;minimumNormalY:number}[]=[],stats:Record<string,unknown>[]=[];
 const fns=new Map<string,{local:(x:number,z:number)=>{u:number;d:number};contains:(u:number,d:number)=>boolean}>();
 for(const facade of ['west','south'] as const){
  const frame=frames[facade],origin=new T.Vector3(...frame.position),out=new T.Vector3(...frame.normal),along=new T.Vector3(out.z,0,-out.x),landing=levels[facade];
  const p=(u:number,d:number,y:number)=>origin.clone().addScaledVector(along,u).addScaledVector(out,d).setY(y);
  const local=(x:number,z:number)=>{const q=new T.Vector3(x,0,z).sub(origin);return{u:q.dot(along),d:q.dot(out)};};
  const eps=1e-6,inside=(u:number,d:number)=>facade==='west'?((u>=-2.78-eps&&u<=2.78+eps&&d>=-1.13-eps&&d<=5+eps)||(u>=2.78-eps&&u<=36+eps&&d>=2.2-eps&&d<=5+eps)):(u>=-1.4-eps&&u<=1.4+eps&&d>=-1.13-eps&&d<=12.5+eps);
  fns.set(facade,{local,contains:inside});
  const cross=Array.from({length:9},(_,i)=>facade==='west'?2.2+2.8*i/8:-1.4+2.8*i/8);
  const anchors=cross.map(c=>{const u=facade==='west'?36:c,d=facade==='west'?c:12.5,q=p(u,d,0),height=options.groundHeight(q.x,q.z);if(height===undefined||!Number.isFinite(height))throw new Error(`Welch ${facade} approach endpoint has no authored support at ${q.x},${q.z}`);if(Math.abs(height-landing)>2.0)throw new Error(`Welch ${facade} approach endpoint grade exceeds bounded design`);anchorSamples.push({facade,u,d,position:[q.x,height,q.z]});return height;});
  const interp=(values:number[],x:number)=>{const t=T.MathUtils.clamp((x-cross[0])/(cross.at(-1)!-cross[0])*8,0,8),i=Math.min(7,Math.floor(t));return T.MathUtils.lerp(values[i],values[i+1],t-i);};
  const h=(u:number,d:number)=>{
   const f=facade==='west'?T.MathUtils.clamp((u-2.78)/(36-2.78),0,1):T.MathUtils.clamp((d-1.8)/(12.5-1.8),0,1);
   return T.MathUtils.lerp(landing,interp(anchors,facade==='west'?d:u),f);
  };
  const raw:number[]=[],normals:number[]=[],tops:Surface[]=[];
  const tri=(a:T.Vector3,b:T.Vector3,c:T.Vector3)=>{const n=b.clone().sub(a).cross(c.clone().sub(a));if(n.lengthSq()<1e-16)return;n.normalize();raw.push(...a.toArray(),...b.toArray(),...c.toArray());normals.push(...n.toArray(),...n.toArray(),...n.toArray());};
  const top=(a:T.Vector3,b:T.Vector3,c:T.Vector3)=>{if(b.clone().sub(a).cross(c.clone().sub(a)).y<0)[b,c]=[c,b];tri(a,b,c);tops.push({a,b,c,facade});};
  const grid=(us:number[],ds:number[])=>{for(let i=0;i<us.length-1;i++)for(let j=0;j<ds.length-1;j++){const a=p(us[i],ds[j],h(us[i],ds[j])),b=p(us[i+1],ds[j],h(us[i+1],ds[j])),c=p(us[i+1],ds[j+1],h(us[i+1],ds[j+1])),d=p(us[i],ds[j+1],h(us[i],ds[j+1]));top(a,b,c);top(a,c,d);}};
  let boundary:T.Vector3[];
  if(facade==='west'){
   grid([-2.78,2.78],[-1.13,2.2,...cross.slice(1)]);
   const us=[2.78,6,12,20,28,32,34,36];grid(us,cross);
   boundary=[p(-2.78,-1.13,landing),p(2.78,-1.13,landing),p(2.78,2.2,landing),...us.slice(1).map(u=>p(u,2.2,h(u,2.2))),...cross.slice(1).map(d=>p(36,d,h(36,d))),...us.slice(0,-1).reverse().map(u=>p(u,5,h(u,5))),p(-2.78,5,landing)];
  }else{
   const ds=[-1.13,.3,1.8,4,7,9,11,12.5];grid(cross,ds);
   boundary=[...cross.map(u=>p(u,-1.13,landing)),...ds.slice(1).map(d=>p(1.4,d,h(1.4,d))),...cross.slice(0,-1).reverse().map(u=>p(u,12.5,h(u,12.5))),...ds.slice(1,-1).reverse().map(d=>p(-1.4,d,h(-1.4,d)))];
  }
  // An extruded perimeter fills toY4.2 instead of leaving floating 24cm slabs
  // above the low existing yard. Internal grid edges have no vertical caps.
  const ring2=boundary.map(v=>new T.Vector2(v.x,v.z)),inds=T.ShapeUtils.triangulateShape(ring2,[]);
  for(const ix of inds){const [a,b,c]=ix.map(i=>boundary[i].clone().setY(bottom));if(b.clone().sub(a).cross(c.clone().sub(a)).y>0)tri(a,c,b);else tri(a,b,c);}
  const area=ring2.reduce((s,v,i)=>s+v.x*ring2[(i+1)%ring2.length].y-ring2[(i+1)%ring2.length].x*v.y,0);
  for(let i=0;i<boundary.length;i++){const a=boundary[i],b=boundary[(i+1)%boundary.length],c=b.clone().setY(bottom),d=a.clone().setY(bottom);if(area>0){tri(a,b,c);tri(a,c,d);}else{tri(a,d,c);tri(a,c,b);}}
  const vertices:number[]=[],ns:number[]=[],idx:number[]=[],dedup=new Map<string,number>();
  for(let i=0;i<raw.length;i+=3){const pos=raw.slice(i,i+3).map(Math.fround),n=normals.slice(i,i+3).map(Math.fround),key=[...pos,...n.map(v=>Math.round(v*1e6))].join(',');let ix=dedup.get(key);if(ix===undefined){ix=vertices.length/3;dedup.set(key,ix);vertices.push(...pos);ns.push(...n);}idx.push(ix);}
  const geometry=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(vertices,3)).setAttribute('normal',new T.Float32BufferAttribute(ns,3)).setIndex(idx),uv:number[]=[];for(let i=0;i<vertices.length;i+=3)uv.push(vertices[i]*.5,vertices[i+2]*.5);geometry.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const mesh=new T.Mesh(geometry,options.material);mesh.name=`Welch ${facade}: supported Mall approach`;mesh.castShadow=mesh.receiveShadow=true;meshes.push(mesh);colliderGeometries.push(geometry);surfaces.push(...tops);
  // The floor is tessellated for grade fitting, but clearance has constant
  // vertical limits. Two rectangles cover the westL and one covers south:
  // avoid hundreds of redundant per-triangle cuts during source streaming.
  const rectangles=facade==='west'?[[-2.78,2.78,-1.13,5],[2.78,36,2.2,5]]:[[-1.4,1.4,-1.13,12.5]];
  for(const [u0,u1,d0,d1]of rectangles){
   const points=[p(u0,d0,0),p(u1,d0,0),p(u1,d1,0),p(u0,d1,0)],center=p((u0+u1)/2,(d0+d1)/2,0);
   const planes=points.map((v,i)=>{const w=points[(i+1)%4],q=new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(w.z-v.z,0,v.x-w.x).normalize(),v);if(q.distanceToPoint(center)>0)q.negate();return q;});
   const make=(high:number)=>{const bounds=new T.Box3().setFromPoints(points);bounds.min.y=bottom-.02;bounds.max.y=high;return{bounds,planes:[...planes,new T.Plane(new T.Vector3(0,-1,0),bottom-.02),new T.Plane(new T.Vector3(0,1,0),-high)]};};
   authoredGroundTrimVolumes.push(make(Math.max(landing,...anchors)+2));sourceClearanceVolumes.push(make(13));
  }
  for(const {a,b,c}of tops){const normal=b.clone().sub(a).cross(c.clone().sub(a)).normalize();samples.push({facade,kind:'route top',position:a.clone().add(b).add(c).multiplyScalar(1/3).toArray() as P,minimumNormalY:Math.max(.7,normal.y-.002)});}
  stats.push({facade,nearDoorElevation:landing,nearDoorDatum:'Explicit provisional photo-scale estimate; not survey or fallback',endAlong:facade==='west'?36:12.5,connectionShape:facade==='west'?'L: west doorway landing, then narrow southbound walk':'Straight south walkway',bottomElevation:bottom,sourceCeiling:13,area:Math.abs(area)/2,triangles:idx.length/3,topTriangles:tops.length,bounds:{min:geometry.boundingBox!.min.toArray(),max:geometry.boundingBox!.max.toArray()}});
 }
 const contains=(x:number,z:number)=>[...fns.values()].some(f=>{const q=f.local(x,z);return f.contains(q.u,q.d);});
 const query=(x:number,z:number)=>{
  if(!contains(x,z))return undefined;
  // Query the actual piecewise-linear surface, not a separate bilinear ramp.
  const q=new T.Vector3(x,0,z),eps=2e-6;
  for(const s of surfaces){const flat=[s.a,s.b,s.c].map(v=>v.clone().setY(0)),t=new T.Triangle(...flat),b=t.getBarycoord(q,new T.Vector3());if(!b||Math.min(b.x,b.y,b.z)<-eps)continue;return{height:b.x*s.a.y+b.y*s.b.y+b.z*s.c.y,facade:s.facade,source:'new authored Welch approach' as const};}
  return undefined;
 };
 return{meshes,materials:[] as T.MeshStandardMaterial[],colliderGeometries,authoredGroundTrimVolumes,sourceClearanceVolumes,volumes:sourceClearanceVolumes,candidateClearanceVolumes:sourceClearanceVolumes,contains,query,height:(x:number,z:number)=>query(x,z)?.height,anchorSamples,samples,stats:{scope:'Supported west and south Welch routes to existing Mall paving',triangles:stats.reduce((n,s)=>n+Number(s.triangles),0),meshes:2,uniqueMaterials:1,sourceCutVolumes:sourceClearanceVolumes.length,authoredGroundTrimVolumes:authoredGroundTrimVolumes.length,routes:stats}};
}

/** Use after clipping these single-material routes. Float32 conversion can
 * collapse a cut sliver to a repeated vertex; remove that zero-area face before
 * the same geometry is registered for rendering and physics. */
export function compactWelchRouteTriangles(geometry:T.BufferGeometry){
 const p=geometry.attributes.position,count=geometry.index?.count??p.count,indices:number[]=[];
 let removed=0;
 for(let i=0;i<count;i+=3){const ids=[0,1,2].map(j=>geometry.index?geometry.index.getX(i+j):i+j),vs=ids.map(j=>new T.Vector3().fromBufferAttribute(p,j));if(vs[1].clone().sub(vs[0]).cross(vs[2].clone().sub(vs[0])).lengthSq()<1e-14){removed++;continue;}indices.push(...ids);}
 geometry.setIndex(indices);return{geometry,removed};
}
