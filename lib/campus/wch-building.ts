import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import plan from '../../public/data/wch-building-plan.json' with { type: 'json' };
import { annotateGdcGlazing, createGdcGlazing } from './gdc-glazing';
import type { CutVolume } from './clip-volume';
type Point=[number,number];
type Opening={left:number;right:number;low:number;high:number;door?:boolean};
/** floorHeight/roofRise are fitted to the 2017 LiDAR (record 528705: roof P50 Y32.5, P95 Y34.7, pitch 26 deg);
 * the storey count and opening rhythm stay the photo-informed estimate. Facade datums scale with the storey. */
const b=plan as unknown as {base:number;floors:number;floorHeight:number;roofRise?:number;rings:Point[][];yards:Point[][][];clearance:Point[][][]};
const triangles=(rings:Point[][])=>{const pts=rings.map(r=>r.map(p=>new T.Vector2(...p))),all=pts.flat();return T.ShapeUtils.triangulateShape(pts[0],pts.slice(1)).map(t=>t.map(i=>all[i]));};
/** Gebauer Building GIS footprint (campus.json id 734466), yard soil is clipped to it with a 1.0 m outset (GEB walls stand 0.35 m inside it). */
export const GEB_FOOTPRINT:Point[]=[[-134.07,-38.1],[-134.12,-37.37],[-148.63,-38.42],[-148.54,-39.7],[-161.52,-40.64],[-163.13,-18.27],[-149.82,-17.31],[-149.61,-20.27],[-142.37,-19.74],[-142.5,-17.96],[-139.61,-17.75],[-139.49,-19.53],[-135.06,-19.21],[-135.3,-15.81],[-122.71,-14.9],[-121.1,-37.16]];
const cross=(o:Point,a:Point,b:Point)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
/** Convex cell minus a (possibly concave) footprint: subtract each convex footprint triangle in turn. */
function subtractFootprint(cell:Point[],footprint:Point[],outset=1):Point[][]{
 const xs=cell.map(p=>p[0]),zs=cell.map(p=>p[1]),fx=footprint.map(p=>p[0]),fz=footprint.map(p=>p[1]);
 if(Math.max(...xs)<Math.min(...fx)-outset||Math.min(...xs)>Math.max(...fx)+outset||Math.max(...zs)<Math.min(...fz)-outset||Math.min(...zs)>Math.max(...fz)+outset)return[cell];
 const contour=footprint.map(p=>new T.Vector2(...p));
 const tris=T.ShapeUtils.triangulateShape(contour,[]).map(t=>{let q=t.map(i=>footprint[i]) as Point[];if(cross(q[0],q[1],q[2])<0)q=[q[0],q[2],q[1]];
  // Grow each triangle by the outset so neighbouring triangles overlap (no slivers between them).
  const c=[(q[0][0]+q[1][0]+q[2][0])/3,(q[0][1]+q[1][1]+q[2][1])/3];return q.map(p=>{const dx=p[0]-c[0],dz=p[1]-c[1],l=Math.hypot(dx,dz)||1;return[p[0]+dx/l*outset*2,p[1]+dz/l*outset*2] as Point;});});
 const clip=(poly:Point[],a:Point,b:Point,keepLeft:boolean)=>{const out:Point[]=[];for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length],sp=cross(a,b,p),sq=cross(a,b,q),ip=keepLeft?sp>=0:sp<=0,iq=keepLeft?sq>=0:sq<=0;if(ip)out.push(p);if(ip!==iq){const t=sp/(sp-sq);out.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]);}}return out;};
 const polyArea=(r:Point[])=>Math.abs(r.reduce((s,p,i)=>s+p[0]*r[(i+1)%r.length][1]-r[(i+1)%r.length][0]*p[1],0))/2;
 let pieces=[cell];
 for(const t of tris){const next:Point[][]=[];
  for(const poly of pieces){let rest=poly;
   for(let e=0;e<3&&rest.length>=3;e++){const a=t[e],b=t[(e+1)%3],outside=clip(rest,a,b,false);if(outside.length>=3&&polyArea(outside)>1e-3)next.push(outside);rest=clip(rest,a,b,true);}
  }
  pieces=next;}
 return pieces;
}
/** A separately selectable WCH exterior. Replaces WCH's generic shell and
 * retains its original footprint, datum, yards and source clearance. The small
 * roof ornaments are photo estimates; this does not provide room interiors. */
export function buildWillCHogg(groundHeight:(x:number,z:number)=>number,yardHeight=groundHeight){
 const materials:T.MeshStandardMaterial[]=[],meshes:T.Mesh[]=[],volumes:CutVolume[]=[],colliderGeometries:T.BufferGeometry[]=[];
 const make=(name:string,color:number,roughness=.82,metalness=0)=>{const m=new T.MeshStandardMaterial({color,roughness,metalness});m.name=`WCH ${name}`;materials.push(m);return m;};
 const brick=make('buff running-bond brick',0xb5a08a),stone=make('limestone base and carved-course massing',0xbeb6a4);
 const trim=make('warm limestone window reveals',0xc2bba8),bronze=make('aged bronze vertical spandrels',0x7f8479,.53,.25);
 const frame=make('narrow dark window frames',0x6d756b,.4,.6),wood=make('timber eaves and brackets',0x655744,.82),tile=make('terracotta hipped roof',0x976348,.92),soil=make('existing yard planting soil',0x565a3e,1);
 const glass=createGdcGlazing('WCH inset window glass');materials.push(glass);
 for(const [m,kind]of [[brick,'brick'],[stone,'stone'],[tile,'tile']]as const){
  m.onBeforeCompile=s=>{s.vertexShader='varying vec2 wchUv;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nwchUv=uv;');s.fragmentShader='varying vec2 wchUv;\n'+s.fragmentShader;
   s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
    vec2 cell=wchUv/vec2(${kind==='brick'?'.225,.074':kind==='tile'?'.22,.37':'1.3,.58'});
    ${kind==='brick'?'cell.x+=mod(floor(cell.y),2.)*.5;':''}
    float tone=fract(sin(dot(floor(cell),vec2(127.1,311.7)))*43758.5453);
    vec2 aa=max(fwidth(cell),vec2(.001)),edge=min(fract(cell),1.-fract(cell));
    float face=smoothstep(.023,.023+aa.x,edge.x)*smoothstep(.023,.023+aa.y,edge.y);
    diffuseColor.rgb*=(.91+.15*tone)*(1.-${kind==='brick'?'.14':'.07'}*(1.-face));
    ${kind==='tile'?'diffuseColor.rgb*=.96+.06*cos(fract(cell.x)*6.283);':''}`);
  };m.customProgramCacheKey=()=>`wch-${kind}-v1`;
 }
 const batches=new Map<T.Material,T.BufferGeometry[]>();
 const add=(g:T.BufferGeometry,m:T.Material)=>{if(!batches.has(m))batches.set(m,[]);batches.get(m)!.push(g);};
 const fh=b.floorHeight,rise=b.roofRise??3.05,top=b.base+b.floors*fh,bottom=Math.min(b.base-3,...b.rings[0].map(p=>groundHeight(...p)-2));
 let windows=0,doors=0,brackets=0,dormers=0;
 for(const r of b.rings){const area=r.reduce((s,p,i)=>s+p[0]*r[(i+1)%r.length][1]-r[(i+1)%r.length][0]*p[1],0);
  for(let i=0;i<r.length;i++){
   const a=r[i],c=r[(i+1)%r.length],axis=new T.Vector3(c[0]-a[0],0,c[1]-a[1]),length=axis.length();axis.normalize();
   const out=new T.Vector3(axis.z*Math.sign(area),0,-axis.x*Math.sign(area)),right=axis.clone();
   if(right.clone().cross(new T.Vector3(0,1,0)).dot(out)<0)right.negate();
   const origin=right.dot(axis)>0?a:c,matrix=new T.Matrix4().makeBasis(right,new T.Vector3(0,1,0),out);matrix.setPosition(origin[0],0,origin[1]);
   const box=(x:number,y:number,z:number,w:number,h:number,d:number,m:T.Material)=>{
    if(Math.min(w,h,d)<1e-5)return;const g=new T.BoxGeometry(w,h,d).translate(x,y,z),p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv;
    if(m===glass)annotateGdcGlazing(g,'x',right,out,i*113+x*17+y*3);
    for(let k=0;k<p.count;k++)uv.setXY(k,Math.abs(n.getX(k))>.7?p.getZ(k):p.getX(k),Math.abs(n.getY(k))>.7?p.getZ(k):p.getY(k));g.applyMatrix4(matrix);add(g,m);
   };
   const count=length>30?17:6,pitch=(length-2.1)/count,openings:Opening[]=[];
   const front=out.z>.7;
   for(let j=0;j<count;j++){
    const x=1.05+(j+.5)*pitch,width=length>30?1.43:1.48;
    for(let f=0;f<3;f++){
     const door=front&&j===Math.floor(count/2)&&f===0;
     openings.push({left:x-(door?1.08:width/2),right:x+(door?1.08:width/2),low:b.base+(door?.02:f*b.floorHeight+(f===0?1.3:.72)),high:b.base+(door?3.45:(f+1)*b.floorHeight-(f===0?.75:.44)),door});
    }
    // Metal spandrels link the two upper openings into tall vertical fields;
    // the reference's brick piers remain continuous between those fields.
    box(x,b.base+2*fh+.13,-.01,width+.10,1.22,.10,bronze);
    for(const xx of[x-width/2-.075,x+width/2+.075])box(xx,b.base+2*fh+.15,.03,.11,2*fh-1.38,.20,bronze);
   }
   const xs=[...new Set([0,length,...openings.flatMap(o=>[o.left,o.right])])].sort((a,c)=>a-c),ys=[...new Set([bottom,b.base+fh-.05,top,...openings.flatMap(o=>[o.low,o.high])])].sort((a,c)=>a-c);
   for(let ix=0;ix<xs.length-1;ix++)for(let iy=0;iy<ys.length-1;iy++){
    const x=(xs[ix]+xs[ix+1])/2,y=(ys[iy]+ys[iy+1])/2;
    if(openings.some(o=>x>o.left-1e-5&&x<o.right+1e-5&&y>o.low-1e-5&&y<o.high+1e-5))continue;
    box(x,y,-.29,xs[ix+1]-xs[ix],ys[iy+1]-ys[iy],.58,y<b.base+fh-.05?stone:brick);
   }
   for(const o of openings){const x=(o.left+o.right)/2,y=(o.low+o.high)/2,w=o.right-o.left,h=o.high-o.low;
    box(x,y,-.30,w,h,.065,glass);
    for(const xx of[o.left+.028,o.right-.028])box(xx,y,-.125,.056,h,.38,frame);
    for(const yy of[o.low+.028,o.high-.028])box(x,yy,-.125,w,.056,.38,frame);
    box(x,o.low+h*.57,-.225,w,.055,.10,frame);box(x,y,-.225,.047,h,.1,frame);
    box(x,o.low-.06,.055,w+.25,.12,.48,trim);
    if(o.door){doors++;for(const xx of[o.left-.28,o.right+.28])box(xx,b.base+1.85,.16,.38,3.7,.55,trim);box(x,b.base+3.83,.23,w+1.06,.48,.74,trim);}
    else windows++;
   }
   // Thin projecting frieze, a strong full-width stone base/brick transition.
   box(length/2,b.base+fh-.02,.16,length,.38,.62,trim);
   for(let x=.3;x<length;x+=.54)box(x,b.base+fh-.02,.48,.15,.20,.085,stone);
   box(length/2,top-.16,.17,length,.26,.68,wood);
   box(length/2,top+.06,.43,length+1.5,.23,1.50,wood);
   for(let x=.55;x<length;x+=1.38){
    box(x,top-.35,.48,.13,.48,.92,wood);
    const g=new T.BoxGeometry(.115,.12,.98).rotateX(-.31).translate(x,top-.49,.43);g.applyMatrix4(matrix);add(g,wood);brackets++;
   }
  }
 }
 // Hipped roof on the existing rotated rectangle. Eaves project0.8m, matching
 // the broad roof silhouette. Each dormer has actual side cheeks and a hip.
 const center=b.rings[0].reduce((v,p)=>v.add(new T.Vector3(p[0],0,p[1])),new T.Vector3()).multiplyScalar(.25);
 const e=new T.Vector3(b.rings[0][2][0]-b.rings[0][1][0],0,b.rings[0][2][1]-b.rings[0][1][1]).normalize(),s=new T.Vector3(-e.z,0,e.x);
 const matrix=new T.Matrix4().makeBasis(e,new T.Vector3(0,1,0),s).setPosition(center);
 const width=Math.hypot(b.rings[0][2][0]-b.rings[0][1][0],b.rings[0][2][1]-b.rings[0][1][1]),depth=Math.hypot(b.rings[0][1][0]-b.rings[0][0][0],b.rings[0][1][1]-b.rings[0][0][1]);
 const roof=(cx:number,cz:number,w:number,d:number,y:number,rise:number)=>{
  const p=[[-w/2,y,-d/2],[w/2,y,-d/2],[w/2,y,d/2],[-w/2,y,d/2],[-w/2+Math.min(d/2,w*.22),y+rise,0],[w/2-Math.min(d/2,w*.22),y+rise,0]].map(v=>new T.Vector3(v[0]+cx,v[1],v[2]+cz));
  const vertices:number[]=[],uv:number[]=[];for(const ids of[[0,4,5],[0,5,1],[1,5,2],[2,5,4],[2,4,3],[3,4,0]])for(const i of ids){vertices.push(...p[i].toArray());uv.push(p[i].x,p[i].z);}
  const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(vertices,3)).setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.computeVertexNormals();g.applyMatrix4(matrix);add(g,tile);
 };
 roof(0,0,width+1.6,depth+1.6,top+.20,rise);
 const roofBox=(x:number,y:number,z:number,w:number,h:number,d:number,m:T.Material)=>{
  const g=new T.BoxGeometry(w,h,d).translate(x,y,z);if(m===glass)annotateGdcGlazing(g,'x',e,s,x*17);
  g.applyMatrix4(matrix);add(g,m);
 };
 for(const x of[-width*.32,0,width*.32]){
  // Seat each dormer on the (LiDAR-fitted) roof plane at its front face, as before at 3.05 m rise.
  const z=depth*.32,w=3.55,d=2.55,y=top+.2+rise*(depth/2+.8-(z+d/2))/(depth/2+.8)-.08;
  roofBox(x,y+.56,z,w,1.12,d,wood);
  roofBox(x,y+.60,z+d/2+.016,w-.24,.87,.055,glass);
  for(const dx of[-w/2+.10,0,w/2-.10])roofBox(x+dx,y+.60,z+d/2+.08,.075,.91,.12,frame);
  roof(x,z,w+.65,d+.40,y+1.2,.49);dormers++;
 }
 // Close body at the original top; no invisible solid exists behind windows.
 const cap=(rings:Point[][],height:(p:T.Vector2)=>number,m:T.Material)=>{const pos:number[]=[],uv:number[]=[];
  for(const tri of triangles(rings)){const[p,q,r]=tri;for(const v of(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x)>0?[p,r,q]:[p,q,r]){pos.push(v.x,height(v),v.y);uv.push(v.x,v.y);}}
  const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(pos,3)).setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.computeVertexNormals();add(g,m);
 };
 cap(b.rings,()=>top,wood);
 // b04-tower (whole-campus-92): the yard cells must stop at Gebauer's measured footprint
 // (GIS 734466, confirmed by the 2017 LiDAR roof tier); b04's install() now builds that body.
 for(const cell of b.yards)for(const piece of subtractFootprint(cell[0],GEB_FOOTPRINT))cap([piece],p=>yardHeight(p.x,p.y),soil);
 for(const rings of b.clearance)for(const tri of triangles(rings)){
  const points=tri.map(p=>new T.Vector3(p.x,0,p.y)),center=points.reduce((s,p)=>s.add(p),new T.Vector3()).multiplyScalar(1/3);
  const planes=points.map((p,i)=>{const d=points[(i+1)%3].clone().sub(p),plane=new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(d.z,0,-d.x).normalize(),p);if(plane.distanceToPoint(center)>0)plane.negate();return plane;});
  const low=bottom-4,high=b.base+72,bounds=new T.Box3().setFromPoints(points);bounds.min.y=low;bounds.max.y=high;planes.push(new T.Plane(new T.Vector3(0,-1,0),low),new T.Plane(new T.Vector3(0,1,0),-high));volumes.push({planes,bounds});
 }
 for(const[m,parts]of batches){const flat=parts.map(g=>g.index?g.toNonIndexed():g),g=mergeGeometries(flat);if(!g)throw Error('WCH geometry merge failed');g.computeBoundingBox();g.computeBoundingSphere();
  const mesh=new T.Mesh(g,m);mesh.name=m.name;mesh.castShadow=mesh.receiveShadow=true;meshes.push(mesh);colliderGeometries.push(g);for(const p of new Set([...parts,...flat]))p.dispose();}
 return{meshes,materials,volumes,colliderGeometries,stats:{building:'WCH',windows,doors,brackets,dormers,triangles:meshes.reduce((n,m)=>n+m.geometry.attributes.position.count/3,0),drawCalls:meshes.length},dispose(){for(const m of meshes)m.geometry.dispose();for(const m of materials)m.dispose();}};
}
