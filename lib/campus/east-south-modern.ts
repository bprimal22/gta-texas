import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import planData from '../../public/data/east-south-modern-plan.json' with { type: 'json' };
import { annotateGdcGlazing, createGdcGlazing } from './gdc-glazing';
import type { CutVolume } from './clip-volume';
import { wcpWestWingFace, wcpWestWingRoof, type WcpOpening } from './wcp-west-wing';
type Point=[number,number];
type Mass={name:string;floors:number;rings:Point[][];
 /** Measured wall/deck top (absolute campus Y, 2017 LiDAR); overrides base+floors*floorHeight. */top?:number;
 /** Pitched-roof rise above the eave (west wing; measured ridge minus eave). */roofRise?:number;topBasis?:string};
type Building={abbr:'WCP'|'RLP';name:string;base:number;floorHeight:number;rings:Point[][];masses:Mass[];yards:Point[][][];clearance:Point[][][]};
type Opening=WcpOpening;
const data=planData as unknown as {buildings:Building[]};
function triangles(rings:Point[][]){const r=rings.map(p=>p.map(v=>new T.Vector2(...v))),all=r.flat();return T.ShapeUtils.triangulateShape(r[0],r.slice(1)).map(ids=>ids.map(i=>all[i]));}
function finish(m:T.MeshStandardMaterial,unit:[number,number],contrast:number){
 m.onBeforeCompile=s=>{
  s.vertexShader='varying vec2 eastModernUv;\n'+s.vertexShader;
  s.vertexShader=s.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\neastModernUv=uv;');
  s.fragmentShader='varying vec2 eastModernUv;\n'+s.fragmentShader;
  s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
   vec2 p=eastModernUv/vec2(${unit[0]},${unit[1]});
   float tone=fract(sin(dot(floor(p),vec2(127.1,311.7)))*43758.5453);
   vec2 edge=min(fract(p),1.-fract(p));vec2 aa=max(fwidth(p),vec2(.0001));
   float face=smoothstep(.006,.006+aa.x,edge.x)*smoothstep(.006,.006+aa.y,edge.y);
   diffuseColor.rgb*=(.95+tone*.09)*(1.-${contrast}*(1.-face));`);
 };m.customProgramCacheKey=()=>`east-modern-${m.name}-v1`;return m;
}

/** Gregory Aquatic Pool Equipment Bldg (GRP, City footprint 716175; UT GIS objectId 414; LiDAR 2017 roof 4.5-5.4 m).
 * The WCP perimeter paving used to run straight over it, which made the context classify it as a route and draw
 * nothing. The paving is now cut 0.15 m outside its footprint so the generated building can stand there
 * (research/whole-campus-92/b07-wcp-gregory/EVIDENCE.md). */
const GRP_RING:Point[]=[[118.17,174.27],[117.01,188.12],[126.17,188.89],[127.34,175.04]];
const GRP_CUT:Point[]=(()=>{const c=GRP_RING.reduce((a,p)=>[a[0]+p[0]/4,a[1]+p[1]/4],[0,0]);
 // Convex quad grown 0.15 m along each edge normal (vertices pushed out by 0.15/cos(half-angle) ~ 0.15*sqrt2 for right angles).
 return GRP_RING.map(p=>{const dx=p[0]-c[0],dz=p[1]-c[1],l=Math.hypot(dx,dz);return [p[0]+dx/l*.21,p[1]+dz/l*.21] as Point;});})();
/** Pieces of triangle `tri` outside convex polygon `poly` (Sutherland-Hodgman, disjoint pieces, fan-triangulated). */
function outsideConvex(tri:T.Vector2[],poly:Point[]):T.Vector2[][]{
 const ccw=poly.reduce((a,p,i)=>{const q=poly[(i+1)%poly.length];return a+p[0]*q[1]-q[0]*p[1];},0)>0;
 const side=(v:T.Vector2,i:number)=>{const a=poly[i],b=poly[(i+1)%poly.length],c=(b[0]-a[0])*(v.y-a[1])-(b[1]-a[1])*(v.x-a[0]);return ccw?c:-c;};// >0 inside half-plane i
 const clip=(pts:T.Vector2[],i:number,keepInside:boolean)=>{const out:T.Vector2[]=[];
  for(let k=0;k<pts.length;k++){const p=pts[k],q=pts[(k+1)%pts.length],sp=side(p,i)*(keepInside?1:-1),sq=side(q,i)*(keepInside?1:-1);
   if(sp>=0)out.push(p);if((sp>=0)!==(sq>=0)){const t=sp/(sp-sq);out.push(new T.Vector2(p.x+(q.x-p.x)*t,p.y+(q.y-p.y)*t));}}
  return out;};
 const pieces:T.Vector2[][]=[];let rest=tri;
 for(let i=0;i<poly.length&&rest.length>=3;i++){const out=clip(rest,i,false);if(out.length>=3)pieces.push(out);rest=clip(rest,i,true);}
 const result:T.Vector2[][]=[];
 for(const pc of pieces)for(let k=1;k+1<pc.length;k++)result.push([pc[0],pc[k],pc[k+1]]);
 return result;
}

/** Opt-in replacement for WCP/RLP only. Keep legacy mall buildings as the
 * default until the owning scene selects these records. Heights and facade
 * proportions are photo-informed; base, footprint, yard grades and source-cut
 * extents come unchanged from the existing verified campus plan.
 */
export function buildEastSouthModern(groundHeight:(x:number,z:number)=>number,
 selected:ReadonlyArray<'WCP'|'RLP'>=['WCP','RLP'],
 yardHeights:Partial<Record<'WCP'|'RLP',(x:number,z:number)=>number>>={}){
 const meshes:T.Mesh[]=[],colliderGeometries:T.BufferGeometry[]=[],materials:T.MeshStandardMaterial[]=[],volumes:CutVolume[]=[],reports=[];
 for(const b of data.buildings.filter(x=>selected.includes(x.abbr))){
  const mat=(name:string,color:number,roughness=.8,metalness=0)=>{const m=new T.MeshStandardMaterial({color,roughness,metalness});m.name=`${b.abbr} ${name}`;materials.push(m);return m;};
  const stone=finish(mat('coursed warm limestone',0xb8ad97),[1.45,.58],.10);
  const slate=finish(mat('charcoal panel auditorium',0x46515a,.72),[1.6,.38],.15);
  const trim=mat('light limestone reveals',0xbeb7a5,.8),frame=mat('dark anodized mullions',0x596762,.29,.72);
  const metal=mat('projecting roof shade',0x737873,.34,.67);
  const glass=createGdcGlazing(`${b.abbr} recessed architectural glazing`);materials.push(glass);
  const paving=mat('existing perimeter paving',0x969184),soil=mat('existing planting soil',0x565a3e);
  const westStone=b.abbr==='WCP'?finish(mat('west wing limestone',0xc7c3b8,.87),[1.55,.52],.055):stone;
  const westRoof=b.abbr==='WCP'?finish(mat('west wing terracotta roof',0x80513c,.88),[.25,.4],.13):metal;
  const batches=new Map<T.Material,T.BufferGeometry[]>();
  const yardHeight=yardHeights[b.abbr]??groundHeight;
  let windows=0,doors=0,roofSlats=0;
  const add=(g:T.BufferGeometry,m:T.Material)=>{if(!batches.has(m))batches.set(m,[]);batches.get(m)!.push(g);};
  const baseBottom=Math.min(b.base-3,...b.rings[0].map(p=>groundHeight(...p)-2));
  const cap=(rings:Point[][],height:number,m:T.Material)=>{
   const positions:number[]=[],uv:number[]=[];
   for(const tri of triangles(rings)){
    const[p,q,r]=tri,area=(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
    for(const v of area>0?[p,r,q]:[p,q,r]){positions.push(v.x,height,v.y);uv.push(v.x,v.y);}
   }
   const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(positions,3)).setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.computeVertexNormals();add(g,m);
  };
  for(const mass of b.masses){
   const westWing=b.abbr==='WCP'&&mass.name==='west-wing';
   const top=mass.top??b.base+mass.floors*b.floorHeight;
   cap(mass.rings,top,metal);
   if(westWing){const roof=wcpWestWingRoof(mass.rings[0],top+.12,mass.roofRise);add(roof.roof,westRoof);add(roof.soffit,metal);}
   for(const ring of mass.rings){
    const area=ring.reduce((s,p,i)=>s+p[0]*ring[(i+1)%ring.length][1]-ring[(i+1)%ring.length][0]*p[1],0);
    for(let i=0;i<ring.length;i++){
     const a=ring[i],c=ring[(i+1)%ring.length],dx=c[0]-a[0],dz=c[1]-a[1],length=Math.hypot(dx,dz);
     if(length<.15)continue;
     const axis=new T.Vector3(dx/length,0,dz/length),out=new T.Vector3(dz/length*Math.sign(area),0,-dx/length*Math.sign(area));
     // Use a right-handed local basis. Reversing clockwise edges avoids
     // reflected geometry winding while preserving exact wall endpoints.
     const handed=axis.clone().cross(new T.Vector3(0,1,0)).dot(out);
     const xAxis=handed>0?axis:axis.clone().negate();
     const origin=handed>0?a:c;
     const matrix=new T.Matrix4().makeBasis(xAxis,new T.Vector3(0,1,0),out);matrix.setPosition(origin[0],0,origin[1]);
     const part=(x:number,y:number,z:number,w:number,h:number,d:number,m:T.Material)=>{
      if(Math.min(w,h,d)<=.0001)return;
      const g=new T.BoxGeometry(w,h,d).translate(x,y,z),p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv;
      if(m===glass)annotateGdcGlazing(g,'x',xAxis,out,b.base*51+i*13+x*3+y*7);
      for(let j=0;j<p.count;j++)uv.setXY(j,Math.abs(n.getX(j))>.7?p.getZ(j):p.getX(j),Math.abs(n.getY(j))>.7?p.getZ(j):p.getY(j));
      g.applyMatrix4(matrix);add(g,m);
     };
     const mx=(a[0]+c[0])/2,mz=(a[1]+c[1])/2;
     const north=out.z<-.65,south=out.z>.65;
     const original=b.rings.some(r=>r.some((p,j)=>{
      const q=r[(j+1)%r.length],vx=q[0]-p[0],vz=q[1]-p[1],ll=Math.hypot(vx,vz);
      return Math.abs((mx-p[0])*vz-(mz-p[1])*vx)/ll<.02&&Math.hypot(mx-p[0],mz-p[1])+Math.hypot(mx-q[0],mz-q[1])<ll+.03;
     }));
     let openings:Opening[]=[];
     const isAuditorium=b.abbr==='WCP'&&mass.name==='auditorium';
     const facadeMaterial=westWing?westStone:isAuditorium?slate:stone;
     const westFace=westWing&&original?wcpWestWingFace(length,b.base,top,out):null;
     // Internal mass seams are closed walls; they do not gain invented windows.
     if(original&&length>2.2){
      if(b.abbr==='WCP'){
       if(westFace){
        openings=westFace.openings.map(o=>{
         if(!o.door)return o;
         const center=(o.left+o.right)/2;
         // Fit the threshold to the retained yard, independently of the
         // building's estimated floor datum. No invented step or floating sill.
         const x=origin[0]+xAxis.x*center+out.x*.7,z=origin[1]+xAxis.z*center+out.z*.7;
         return {...o,low:yardHeight(x,z)+.04};
        });
       }else if(isAuditorium){
        // The theater is an opaque charcoal volume, with sparse staggered
        // slits rather than the old uniform broad-window grid.
        for(let j=0;j<Math.floor(length/5.4);j++){
         const x=(j+.65)*5.4;if(x>length-.9)continue;
         const low=b.base+1.2+(j%3)*2.2;
         openings.push({left:x-.28,right:x+.28,low,high:Math.min(top-.8,low+3.15)});
        }
       }else if(mass.name==='dining'){
        // Two-storey glazed dining volume, divided by slim mullions. The
        // south terrace retains a broad solid stone section between glass.
        const span=length-1.0,glassSpan=south?span*.55:span;
        if(glassSpan>2){openings.push({left:.5,right:.5+glassSpan,low:b.base+.48,high:top-.55,door:north||out.x<-.7});}
       }else{
        for(let f=0;f<mass.floors;f++){
         const low=b.base+f*b.floorHeight;
         if(north&&f<2&&length>12){openings.push({left:length*.25,right:length*.8,low:low+.3,high:low+b.floorHeight-.15,door:f===0});}
         else{
          const pitch=length/Math.max(1,Math.floor(length/4.5));
          for(let j=0;j<Math.floor(length/pitch);j++){
           const x=(j+.5)*pitch,w=f>2?1.05:1.65;
           openings.push({left:x-w/2,right:x+w/2,low:low+(f>2?1.6:.85),high:low+b.floorHeight-.65});
          }
         }
        }
       }
      }else{
       const glazedBar=mass.name==='north-bar';
       for(let f=0;f<mass.floors;f++){
        const low=b.base+f*b.floorHeight;
        if(glazedBar&&f===0){
         // Low shadowed base and spaced support piers, beneath the tall
         // north-bar glazing shown in the official building-header photo.
         const n=Math.max(1,Math.floor(length/7.5)),pitch=length/n;
         for(let j=0;j<n;j++)openings.push({left:j*pitch+.38,right:(j+1)*pitch-.38,low:low+.28,high:low+b.floorHeight-.45,door:north&&j===Math.floor(n/2)});
        }else{
         const n=Math.max(1,Math.floor(length/(glazedBar?2.75:3.1))),pitch=length/n;
         for(let j=0;j<n;j++){
          const inset=glazedBar?.32:.52;
          openings.push({left:j*pitch+inset,right:(j+1)*pitch-inset,low:low+(glazedBar?.18:.65),high:low+b.floorHeight-(glazedBar?.18:.6)});
         }
        }
       }
      }
     }
     const panels=westFace?.panels??[];
     const xs=[...new Set([0,length,...openings.flatMap(o=>[o.left,o.right]),...panels.flatMap(p=>[p.left,p.right])])].sort((a,c)=>a-c);
     const ys=[...new Set([baseBottom,top,...openings.flatMap(o=>[o.low,o.high]),...panels.flatMap(p=>[p.low,p.high]),...(westWing?[b.base+.34]:[])])].sort((a,c)=>a-c);
     for(let ix=0;ix<xs.length-1;ix++)for(let iy=0;iy<ys.length-1;iy++){
      const x=(xs[ix]+xs[ix+1])/2,y=(ys[iy]+ys[iy+1])/2;
      if(openings.some(o=>x>o.left-.0001&&x<o.right+.0001&&y>o.low-.0001&&y<o.high+.0001))continue;
      const panel=panels.some(p=>x>p.left&&x<p.right&&y>p.low&&y<p.high);
      part(x,y,-.27,xs[ix+1]-xs[ix],ys[iy+1]-ys[iy],.54,panel||westWing&&y<b.base+.34?slate:facadeMaterial);
     }
     for(const o of openings){
      const w=o.right-o.left,h=o.high-o.low,x=(o.left+o.right)/2,y=(o.low+o.high)/2;
      part(x,y,-.40,w,h,.07,glass);
      for(const xx of[o.left+.028,o.right-.028])part(xx,y,-.14,.056,h,.55,frame);
      for(const yy of[o.low+.028,o.high-.028])part(x,yy,-.14,w,.056,.55,frame);
      if(w>2.1)for(let j=1;j<Math.ceil(w/1.45);j++)part(o.left+j*w/Math.ceil(w/1.45),y,-.29,.045,h,.19,frame);
      if(h>4.5)for(let yy=o.low+2.9;yy<o.high-.7;yy+=2.9)part(x,yy,-.29,w,.045,.19,frame);
      if(westWing){
       // Flush sill and head give each narrow opening real shadow depth.
       part(x,o.low-.035,-.15,w+.10,.07,.43,trim);
       if(o.tallReveal)for(const xx of[o.left-.11,o.right+.11])part(xx,y,.09,.20,h+.15,.72,westStone);
       if(o.shade){
        for(let k=0;k<5;k++){part(x,o.high-.86,.13+k*.14,w+.18,.04,.075,metal);roofSlats++;}
        for(const xx of[o.left+.12,o.right-.12])part(xx,o.high-.91,.34,.038,.09,.75,frame);
       }
       if(h>2&&h<4.5)part(x,o.high-.6,-.29,w,.045,.19,frame);
      }
      if(o.door){
       doors++;const doorW=Math.min(w-0.2,3.8),doorBase=westWing?o.low:b.base,doorY=doorBase+1.46;
       part(x,doorY,-.28,.06,2.8,.22,frame);part(x,doorBase+2.9,-.28,doorW,.085,.22,frame);
       for(const s of[-1,1])part(x+s*.14,doorBase+1.25,-.13,.035,.46,.035,metal);
       if(b.abbr==='WCP'&&!westWing)part(x,b.base+3.28,.78,Math.min(w+1.0,7.2),.14,2.1,metal);
      }else windows++;
      if(b.abbr==='RLP'&&mass.name==='north-bar'&&o.low>b.base+b.floorHeight){
       // Real projecting pale fins between full-height glazing fields.
       part(o.left-.13,y,.12,.18,h,.40,trim);
      }
     }
     if(original){
      if(!westWing)part(length/2,top-.10,.02,length,.20,.66,trim);
      if(b.abbr==='RLP'&&mass.name==='north-bar'){
       // Broad thin roof visor and the open layered edge seen from East Mall.
       part(length/2,top+1.02,.85,length+.8,.16,2.8,metal);
       for(let k=0;k<6;k++){part(length/2,top+.14+k*.135,.7+k*.035,length,.045,1.9,metal);roofSlats++;}
      }else if(b.abbr==='WCP'&&mass.name==='office')part(length/2,top+.1,.38,length+.35,.16,1.35,metal);
     }
    }
   }
  }
  // Yard grades can follow their adjoining route independently of the building
  // datum. Keep the original footprint, triangulation, UVs and source clearance.
  for(const cell of b.yards){
   const positions:number[]=[],uv:number[]=[];
   for(const whole of triangles(cell))for(const tri of b.abbr==='WCP'?outsideConvex(whole,GRP_CUT):[whole]){const[p,q,r]=tri,cross=(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
    if(Math.abs(cross)<1e-6)continue;
    for(const v of cross>0?[p,r,q]:[p,q,r]){positions.push(v.x,yardHeight(v.x,v.y),v.y);uv.push(v.x,v.y);}}
   const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(positions,3)).setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.computeVertexNormals();add(g,b.abbr==='WCP'?paving:soil);
  }
  for(const rings of b.clearance)for(const tri of triangles(rings)){
   const p=tri.map(v=>new T.Vector3(v.x,0,v.y)),center=p.reduce((s,v)=>s.add(v),new T.Vector3()).multiplyScalar(1/3);
   const planes=p.map((v,i)=>{const d=p[(i+1)%3].clone().sub(v),plane=new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(d.z,0,-d.x).normalize(),v);if(plane.distanceToPoint(center)>0)plane.negate();return plane;});
   const low=baseBottom-4,high=b.base+72,bounds=new T.Box3().setFromPoints(p);bounds.min.y=low;bounds.max.y=high;
   planes.push(new T.Plane(new T.Vector3(0,-1,0),low),new T.Plane(new T.Vector3(0,1,0),-high));volumes.push({planes,bounds});
  }
  const start=meshes.length;
  for(const[m,parts]of batches){const flat=parts.map(g=>g.index?g.toNonIndexed():g),g=mergeGeometries(flat);if(!g)throw new Error(`${b.abbr} merge failed`);
   g.computeBoundingBox();g.computeBoundingSphere();const mesh=new T.Mesh(g,m);mesh.name=m.name;mesh.castShadow=mesh.receiveShadow=true;meshes.push(mesh);colliderGeometries.push(g);
   for(const p of new Set([...parts,...flat]))p.dispose();}
  reports.push({abbr:b.abbr,name:b.name,windows,doors,roofSlats,masses:b.masses.map(m=>({name:m.name,storeys:m.floors,roofY:m.top??b.base+m.floors*b.floorHeight,ridgeY:m.roofRise?(m.top??0)+.12+m.roofRise:undefined})),drawCalls:meshes.length-start,triangles:meshes.slice(start).reduce((n,m)=>n+m.geometry.attributes.position.count/3,0)});
 }
 return{meshes,materials,volumes,colliderGeometries,reports,stats:{buildings:reports.length,windows:reports.reduce((n,r)=>n+r.windows,0),doors:reports.reduce((n,r)=>n+r.doors,0),triangles:reports.reduce((n,r)=>n+r.triangles,0)},dispose(){for(const m of meshes)m.geometry.dispose();for(const m of materials)m.dispose();}};
}
