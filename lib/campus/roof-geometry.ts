import * as T from 'three';
export type Point2=[number,number];
export type RoofPlane={id:string;ax:number;az:number;c:number};
export type RoofZone={id:string;ring:Point2[];bottom:number;planes:RoofPlane[];cutTop:number;cutBottom:number;material:'tile'|'membrane'|'metal'};
export type Volume={planes:T.Plane[];bounds:T.Box3};
const near=(a:Point2,b:Point2)=>Math.hypot(a[0]-b[0],a[1]-b[1])<1e-7;
const height=(p:RoofPlane,x:number,z:number)=>p.ax*x+p.az*z+p.c;
const polygonArea=(p:Point2[])=>p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-b[0]*a[1];},0)/2;
function clean(poly:Point2[]){const a=poly.filter((p,i)=>i===0||!near(p,poly[i-1]));if(a.length>1&&near(a[0],a.at(-1)!))a.pop();return a;}
function clip(poly:Point2[],ax:number,az:number,c:number){const result:Point2[]=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],da=ax*a[0]+az*a[1]+c,db=ax*b[0]+az*b[1]+c;if(da<=1e-8)result.push(a);if((da< -1e-8&&db>1e-8)||(da>1e-8&&db< -1e-8)){const t=da/(da-db);result.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}}return clean(result);}
/** A convex roof cell with a piecewise-planar top and closed bottom/perimeter.
 * Its footprint is supplied by the evidence plan; it is never inferred here.
 * Planes may define a ridge, hip or level roof. No source surface is used as
 * geometry, and clearance only covers the cell's already-built high envelope.
 */
export function buildRoofZone(zone:RoofZone){
 const ring=clean(zone.ring),count=ring.length;
 if(count<3||!Number.isFinite(zone.bottom)||!Number.isFinite(zone.cutBottom)||zone.cutBottom<zone.bottom-.01||zone.cutTop<=zone.cutBottom||!zone.planes.length||Math.abs(polygonArea(ring))<.001)throw new Error(`Invalid roof cell ${zone.id}`);
 if(!ring.flat().every(Number.isFinite)||!zone.planes.every(p=>[p.ax,p.az,p.c].every(Number.isFinite)))throw new Error(`Nonfinite roof cell ${zone.id}`);
 const center=ring.reduce((s,p)=>[s[0]+p[0]/count,s[1]+p[1]/count]as Point2,[0,0]as Point2);
 const edges=ring.map((a,i)=>{const b=ring[(i+1)%count],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);let nx=-dz/len,nz=dx/len;if(nx*(center[0]-a[0])+nz*(center[1]-a[1])<0){nx=-nx;nz=-nz;}const c=-(nx*a[0]+nz*a[1]);return{a,b,nx,nz,c,len};});
 if(!edges.every(e=>ring.every(p=>e.nx*p[0]+e.nz*p[1]+e.c> -1e-5)))throw new Error(`Nonconvex roof cell ${zone.id}`);
 const roofHeight=(x:number,z:number)=>Math.min(...zone.planes.map(p=>height(p,x,z)));
 const faces:{id:string;polygon:Point2[];plane:RoofPlane}[]=[];
 for(const plane of zone.planes){let polygon=ring;for(const other of zone.planes)if(other!==plane)polygon=clip(polygon,plane.ax-other.ax,plane.az-other.az,plane.c-other.c);if(polygon.length>=3&&Math.abs(polygonArea(polygon))>.000001)faces.push({id:plane.id,polygon,plane});}
 const vertices=faces.flatMap(f=>f.polygon);
 if(!vertices.length||Math.min(...vertices.map(p=>roofHeight(...p)))<zone.bottom-.00001||Math.max(...vertices.map(p=>roofHeight(...p)))>zone.cutTop+.001)throw new Error(`Roof height outside closed cell ${zone.id}`);
 const topPos:number[]=[],topUv:number[]=[],bodyPos:number[]=[],bodyUv:number[]=[];
 function fan(points:T.Vector3[],out:T.Vector3,pos:number[],uv:number[]){for(let i=1;i<points.length-1;i++){const a=points[0];let b=points[i],c=points[i+1];const n=b.clone().sub(a).cross(c.clone().sub(a));if(n.lengthSq()<1e-16)continue;if(n.dot(out)<0)[b,c]=[c,b];for(const p of[a,b,c]){pos.push(p.x,p.y,p.z);if(Math.abs(out.y)>.7)uv.push(p.x,p.z);else uv.push(Math.abs(out.x)>.7?p.z:p.x,p.y);}}}
 for(const f of faces)fan(f.polygon.map(p=>new T.Vector3(p[0],roofHeight(...p),p[1])),new T.Vector3(-f.plane.ax,1,-f.plane.az),topPos,topUv);
 const perimeter:Point2[]=[];
 for(const edge of edges){const dx=edge.b[0]-edge.a[0],dz=edge.b[1]-edge.a[1],ts=[0,1,...vertices.filter(p=>Math.abs(edge.nx*p[0]+edge.nz*p[1]+edge.c)<1e-6).map(p=>((p[0]-edge.a[0])*dx+(p[1]-edge.a[1])*dz)/(edge.len*edge.len))],ordered=[...new Set(ts.map(t=>Math.max(0,Math.min(1,t)).toFixed(9)))].map(Number).sort((a,b)=>a-b);for(let j=0;j<ordered.length-1;j++){const a:Point2=[edge.a[0]+ordered[j]*dx,edge.a[1]+ordered[j]*dz],b:Point2=[edge.a[0]+ordered[j+1]*dx,edge.a[1]+ordered[j+1]*dz];perimeter.push(a);fan([new T.Vector3(a[0],zone.bottom,a[1]),new T.Vector3(b[0],zone.bottom,b[1]),new T.Vector3(b[0],roofHeight(...b),b[1]),new T.Vector3(a[0],roofHeight(...a),a[1])],new T.Vector3(-edge.nx,0,-edge.nz),bodyPos,bodyUv);}}
 for(let i=0;i<perimeter.length;i++)fan([center,perimeter[i],perimeter[(i+1)%perimeter.length]].map(p=>new T.Vector3(p[0],zone.bottom,p[1])),new T.Vector3(0,-1,0),bodyPos,bodyUv);
 const geometry=(pos:number[],uv:number[])=>{const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();return g;};
 const planes=edges.map(e=>new T.Plane(new T.Vector3(-e.nx,0,-e.nz),-e.c));planes.push(new T.Plane(new T.Vector3(0,-1,0),zone.cutBottom),new T.Plane(new T.Vector3(0,1,0),-zone.cutTop));
 const bounds=new T.Box3().setFromPoints(ring.flatMap(p=>[new T.Vector3(p[0],zone.cutBottom,p[1]),new T.Vector3(p[0],zone.cutTop,p[1])]));
 return{top:geometry(topPos,topUv),body:geometry(bodyPos,bodyUv),volume:{planes,bounds},roofHeight,inside:(x:number,z:number)=>edges.every(e=>e.nx*x+e.nz*z+e.c>=-1e-7),faces,perimeter};
}
