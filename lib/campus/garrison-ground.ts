import * as T from 'three';
import mallPlan from '../../public/data/mall-buildings-plan.json' with {type:'json'};
import anchors from '../../public/data/garrison-ground-anchors.json' with {type:'json'};

type Vertex={x:number;y:number;z:number};
type Face=[Vertex,Vertex,Vertex];
const A=new T.Vector2(-151.3299,90.5366),U=new T.Vector2(47.6972,4.2536).normalize(),V=new T.Vector2(-U.y,U.x);
const gar=mallPlan.buildings.find(b=>b.abbr==='GAR')!;
const smooth=(a:number,b:number,x:number)=>{const q=T.MathUtils.clamp((x-a)/(b-a),0,1);return q*q*(3-2*q);};
const local=(p:Vertex)=>{const dx=p.x-A.x,dz=p.z-A.y;return {s:dx*U.x+dz*U.y,t:dx*V.x+dz*V.y};};
const world=(s:number,t:number,y=0):Vertex=>({x:A.x+U.x*s+V.x*t,y,z:A.y+U.y*s+V.y*t});
/** Same edge3 parameter .43 and 2m outward sample as the existing GAR portal. */
export function garrisonNorthDoorApproach(){return world(Math.hypot(47.6972,4.2536)*(1-.43),-2);}
function inside(x:number,z:number,r:number[][]){let yes=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
function inYard(x:number,z:number){return gar.yards.some(rs=>inside(x,z,rs[0])&&!rs.slice(1).some(r=>inside(x,z,r)));}
const triangleArea=(f:Face)=>Math.abs((f[1].x-f[0].x)*(f[2].z-f[0].z)-(f[2].x-f[0].x)*(f[1].z-f[0].z))*.5;
function bary(f:Face,x:number,z:number){const[a,b,c]=f,d=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);if(Math.abs(d)<1e-10)return null;const u=((b.z-c.z)*(x-c.x)+(c.x-b.x)*(z-c.z))/d,v=((c.z-a.z)*(x-c.x)+(a.x-c.x)*(z-c.z))/d;return Math.min(u,v,1-u-v)>=-1e-5?u*a.y+v*b.y+(1-u-v)*c.y:null;}
function split(poly:Vertex[],axis:'s'|'t',at:number):Vertex[][]{const parts:Vertex[][]=[[],[]];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],da=local(a)[axis]-at,db=local(b)[axis]-at;if(da<=1e-8)parts[0].push(a);if(da>=-1e-8)parts[1].push(a);if(da*db< -1e-16){const q=da/(da-db),p={x:T.MathUtils.lerp(a.x,b.x,q),y:T.MathUtils.lerp(a.y,b.y,q),z:T.MathUtils.lerp(a.z,b.z,q)};parts[0].push(p);parts[1].push(p);}}return parts.filter(p=>p.length>=3);}
function refined(f:Face):Face[]{const[a,b,c]=f,mid=(p:Vertex,q:Vertex)=>({x:(p.x+q.x)*.5,y:(p.y+q.y)*.5,z:(p.z+q.z)*.5}),ab=mid(a,b),bc=mid(b,c),ca=mid(c,a);return[[a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]];}
function geometry(faces:Face[]){const positions:number[]=[],uv:number[]=[];for(const face of faces){const f=face.map(p=>({x:Math.fround(p.x),y:Math.fround(p.y),z:Math.fround(p.z)})) as Face;const a=new T.Vector3(f[0].x,f[0].y,f[0].z),b=new T.Vector3(f[1].x,f[1].y,f[1].z),c=new T.Vector3(f[2].x,f[2].y,f[2].z);if(b.sub(a).cross(c.sub(a)).lengthSq()<1e-18)continue;for(const p of f){positions.push(p.x,p.y,p.z);uv.push(p.x,p.z);}}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();return g;}
function outward(faces:Face[]){for(let i=0;i<faces.length;i+=12){const solid=faces.slice(i,i+12),points=solid.flat(),center=points.reduce((a,b)=>new T.Vector3(a.x+b.x/points.length,a.y+b.y/points.length,a.z+b.z/points.length),new T.Vector3());for(const f of solid){const a=new T.Vector3(f[0].x,f[0].y,f[0].z),b=new T.Vector3(f[1].x,f[1].y,f[1].z),c=new T.Vector3(f[2].x,f[2].y,f[2].z),normal=b.clone().sub(a).cross(c.clone().sub(a)),mid=a.clone().add(b).add(c).multiplyScalar(1/3);if(normal.dot(mid.sub(center))<0)[f[1],f[2]]=[f[2],f[1]];}}}

/** Prepare replacement ground without mutating the current scene. The caller
 * must keep the old soil alive while building foundations/portals, then swap
 * the shared render geometry AND its existing Rapier collider before trees.
 * The original footprint, borrowed materials and photographic cuts stay fixed.
 */
export function prepareGarrisonGround(options:{soil:T.Mesh;terrainHeight:(x:number,z:number)=>number;stone:T.Material;concrete:T.Material;doorHeight:number}){
 const source=options.soil.geometry;if(source.index)throw new Error('Garrison soil must retain the current nonindexed batch');
 const p=source.attributes.position,original:Face[]=[],outside:number[]=[],selected:number[]=[];
 for(let i=0;i<p.count;i+=3){const f=[0,1,2].map(k=>({x:p.getX(i+k),y:p.getY(i+k),z:p.getZ(i+k)})) as Face;const x=(f[0].x+f[1].x+f[2].x)/3,z=(f[0].z+f[1].z+f[2].z)/3;if(inYard(x,z)){original.push(f);selected.push(i/3);}else outside.push(i/3);}
 if(original.length<500)throw new Error('Garrison yard coverage changed; review the bounded replacement');
 const sample=(faces:Face[],x:number,z:number)=>{let y=NaN;for(const f of faces){const h=bary(f,x,z);if(h!==null)y=Number.isFinite(y)?Math.max(y,h):h;}return y;};
 const oldHeight=(x:number,z:number)=>sample(original,x,z);
 const constraints=anchors.points.map(([x,z,y])=>({x,z,y,residual:y-options.terrainHeight(x,z)}));
 const lower=(x:number,z:number)=>{let sum=0,weight=0;for(const a of constraints){const d=(a.x-x)**2+(a.z-z)**2;if(d<1e-12)return a.y;const w=1/d;sum+=a.residual*w;weight+=w;}return options.terrainHeight(x,z)+sum/weight;};
 const upper=(s:number,t:number)=>t>=0&&t<=30.3&&(s<=0||(s<=18&&t>=27));
 const grade=(q:Vertex,upperSide:boolean)=>{if(upperSide)return q.y;const{s,t}=local(q),lo=lower(q.x,q.z);if(t<=1e-6)return T.MathUtils.lerp(q.y,lo,smooth(-8,0,s)*smooth(-18,-6,t));return lo;};
 const floor:Face[]=[],edges=new Map<string,{a:Vertex;b:Vertex;center:Vertex}[]>();
 const key=(p:Vertex)=>`${Math.round(p.x*1e5)},${Math.round(p.z*1e5)}`;
 for(const face of original)for(const sub of refined(face)){
  let polygons:Vertex[][]=[sub];for(const[axis,at]of[['s',0],['s',18],['t',0],['t',27],['t',30.3]] as const)polygons=polygons.flatMap(poly=>split(poly,axis,at));
  for(const poly of polygons){if(poly.slice(1,-1).reduce((sum,p,i)=>sum+triangleArea([poly[0],p,poly[i+2]]),0)<1e-7)continue;const center=poly.reduce((a,b)=>({x:a.x+b.x/poly.length,y:a.y+b.y/poly.length,z:a.z+b.z/poly.length}),{x:0,y:0,z:0}),st=local(center),keep=upper(st.s,st.t),vertices=poly.map(q=>({...q,y:grade(q,keep)}));
   for(let i=1;i<vertices.length-1;i++){const f=[vertices[0],vertices[i],vertices[i+1]] as Face;if(triangleArea(f)>1e-7)floor.push(f);}
   for(let i=0;i<vertices.length;i++){const a=vertices[i],b=vertices[(i+1)%vertices.length],ids=[key(a),key(b)].sort().join('|');if(!edges.has(ids))edges.set(ids,[]);edges.get(ids)!.push({a,b,center});}
  }
 }
 // Every high/low discontinuity is a deliberately partitioned retaining edge,
 // never a giant interpolated soil triangle. Both sides have actual yard floor.
 const walls:Face[]=[],wallSegments:{a:number[];b:number[];lower:number[];upper:number[]}[]=[];
 const quad=(out:Face[],a:Vertex,b:Vertex,c:Vertex,d:Vertex)=>{out.push([a,b,c],[a,c,d]);};
 for(const variants of edges.values()){
  if(variants.length!==2)continue;const[a,b]=variants;if(inside((a.a.x+a.b.x)/2,(a.a.z+a.b.z)/2,gar.rings[0]))continue;const match=(v:Vertex,e:typeof a)=>Math.hypot(v.x-e.a.x,v.z-e.a.z)<1e-4?e.a:e.b;
  const ba=match(a.a,b),bb=match(a.b,b);if(Math.max(Math.abs(a.a.y-ba.y),Math.abs(a.b.y-bb.y))<.04)continue;
  const high=(a.a.y+a.b.y>b.a.y+b.b.y)?a:b,low=high===a?b:a,la=match(high.a,low),lb=match(high.b,low),dx=high.b.x-high.a.x,dz=high.b.z-high.a.z,length=Math.hypot(dx,dz);if(length<.0001)continue;
  let nx=-dz/length,nz=dx/length;if(nx*(high.center.x-high.a.x)+nz*(high.center.z-high.a.z)<0){nx=-nx;nz=-nz;}
  const ha={...high.a,y:high.a.y+.055},hb={...high.b,y:high.b.y+.055},ia={x:ha.x+nx*.2,y:ha.y,z:ha.z+nz*.2},ib={x:hb.x+nx*.2,y:hb.y,z:hb.z+nz*.2},da={...la,y:la.y-.08},db={...lb,y:lb.y-.08},ida={x:ia.x,y:da.y,z:ia.z},idb={x:ib.x,y:db.y,z:ib.z};
  quad(walls,ha,da,db,hb);quad(walls,ia,ib,idb,ida);quad(walls,ha,hb,ib,ia);quad(walls,da,ida,idb,db);quad(walls,ha,ia,ida,da);quad(walls,hb,db,idb,ib);
  wallSegments.push({a:[ha.x,ha.z],b:[hb.x,hb.z],lower:[la.y,lb.y],upper:[high.a.y,high.b.y]});
 }
 // A real closed stair connects the unchanged north portal to its lower path.
 // Bay center follows the existing plan's edge3 parameter .43; dimensions are
 // restrained photo-informed estimates, not new door/facade proportions.
 const doorS=Math.hypot(47.6972,4.2536)*(1-.43),width=3.6,landing=.9,tread=.28;
 let steps=12;for(let i=0;i<8;i++){const foot=world(doorS,-landing-steps*tread),h=sample(floor,foot.x,foot.z);if(!Number.isFinite(h))throw new Error('Garrison north stair needs backed floor');steps=Math.max(1,Math.ceil((options.doorHeight-h)/.17));}
 const run=landing+steps*tread,basePoint=world(doorS,-run),base=sample(floor,basePoint.x,basePoint.z),rise=(options.doorHeight-base)/steps;
 if(rise<=0||rise>.185||steps>28)throw new Error('Garrison stair grade is outside the supported envelope');
 const stairs:Face[]=[];
 for(let i=0;i<=steps;i++){
  const t0=i===steps?-landing:-run+i*tread,t1=i===steps?.06:t0+tread,y=i===steps?options.doorHeight:base+(i+1)*rise;
  const pts=[world(doorS-width/2,t0,y),world(doorS+width/2,t0,y),world(doorS+width/2,t1,y),world(doorS-width/2,t1,y)];
  const bottom=pts.map(q=>{const ground=sample(floor,q.x,q.z);if(!Number.isFinite(ground)&&!inside(q.x,q.z,gar.rings[0]))throw new Error('Stair corner lacks yard or existing building backing');return {...q,y:Number.isFinite(ground)?Math.min(base-.3,ground-.15):base-.3};});
  quad(stairs,pts[0],pts[3],pts[2],pts[1]);quad(stairs,bottom[0],bottom[1],bottom[2],bottom[3]);for(let j=0;j<4;j++)quad(stairs,pts[j],pts[(j+1)%4],bottom[(j+1)%4],bottom[j]);
 }
 const next=source.clone(),output:Record<string,number[]>={};for(const name of Object.keys(source.attributes))output[name]=[];
 for(const i of outside)for(let j=0;j<3;j++)for(const[name,attr]of Object.entries(source.attributes))for(let k=0;k<attr.itemSize;k++)output[name].push(attr.getComponent(i*3+j,k));
 const generated=geometry(floor),groundTriangles=generated.attributes.position.count/3;for(const[name,attr]of Object.entries(source.attributes)){const other=generated.getAttribute(name);if(!other)throw new Error(`Unsupported soil attribute ${name}`);output[name].push(...Array.from(other.array));next.setAttribute(name,new T.Float32BufferAttribute(output[name],attr.itemSize));}generated.dispose();
 // Rebuilt single-material buffers must not retain the old, shorter group range.
 // Later regional trims need every retained triangle, including the GAR floor.
 next.clearGroups();next.computeBoundingBox();next.computeBoundingSphere();
 outward(walls);outward(stairs);const meshes:T.Mesh[]=[];
 for(const[faces,material,name]of[[walls,options.stone,'Garrison garden retaining edges'],[stairs,options.concrete,'Garrison north entrance stairs']] as const){const mesh=new T.Mesh(geometry(faces),material);mesh.name=name;mesh.castShadow=mesh.receiveShadow=true;meshes.push(mesh);}
 // Round-trip through Float32 so facade gates and roots match rendered/Rapier
 // triangles, including edges. This is a small build-time query, not per-frame.
 const round=(f:Face)=>f.map(v=>({x:Math.fround(v.x),y:Math.fround(v.y),z:Math.fround(v.z)})) as Face,finalFloor=floor.map(round).filter(f=>triangleArea(f)>1e-10);
 const height=(x:number,z:number)=>sample(finalFloor,x,z);
 return {geometry:next,meshes,colliderGeometries:meshes.map(m=>m.geometry),height,oldHeight,stats:{changedTriangles:original.length,groundTriangles,unchangedTriangles:outside.length,retainingSegments:wallSegments.length,retainingTriangles:meshes[0].geometry.attributes.position.count/3,stairsTriangles:meshes[1].geometry.attributes.position.count/3,stair:{center:world(doorS,0),width,steps,rise,run,base,top:options.doorHeight},wallSegments},materials:[] as T.Material[]};
}
