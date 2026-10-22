import * as T from 'three';
import type {Terrain} from './terrain';
import {engineeringCourtLocal,engineeringCourtPoint} from './engineering-courtyard';
import {closeGround,type TopTriangle} from './closed-ground';

/** Connect the existing EER north walk to local contour ground in the open
 * strip south of PMA. Grade and the simplified 2.2m path widths are fitted, not
 * surveyed. PMA's nearest footprint edge is t=-19.75; this stops at -19.25.
 * Materials are borrowed. Render/physics share every resulting closed batch. */
export function buildEngineeringNorthTransition(options:{
  groundMeshes:T.Mesh[];terrain:Terrain;concrete:T.MeshStandardMaterial;grass:T.MeshStandardMaterial;
}){
  const sMin=0,sMax=104,innerT=-11.5,outerT=-19.25;
  const edge:{s:number;y:number}[]=[];
  for(const mesh of options.groundMeshes){
    const p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal;
    for(let i=0;i<p.count;i++)if(n.getY(i)>.5){
      const q=engineeringCourtLocal(p.getX(i),p.getZ(i));
      if(Math.abs(q.t-innerT)<.00005)edge.push({s:q.s,y:p.getY(i)});
    }
  }
  edge.sort((a,b)=>a.s-b.s);
  const unique=edge.filter((p,i)=>!i||p.s-edge[i-1].s>.00005);
  if(unique.length<100)throw Error('EER north floor edge is missing');
  const edgeHeight=(s:number)=>{
    for(let i=1;i<unique.length;i++)if(s<=unique[i].s){const a=unique[i-1],b=unique[i];return T.MathUtils.lerp(a.y,b.y,(s-a.s)/(b.s-a.s));}
    return unique.at(-1)!.y;
  };
  const rows=[sMin,sMax,...unique.map(p=>p.s).filter(s=>s>sMin&&s<sMax),
    1.1,51.65,53.95,76.4,78.9];
  // The actual court edge already has sub-metre samples. Extra metre rows
  // add no shape detail and create nearly parallel clipping seams.
  // Preserve the outer terrain endpoint along every grid-plane/diagonal break,
  // not merely at metre-spaced samples of a potentially different plane.
  const a=engineeringCourtPoint(sMin,outerT),b=engineeringCourtPoint(sMax,outerT),d=options.terrain.data;
  for(const[start,end,origin]of[[a.x,b.x,d.x0],[a.z,b.z,d.z0],[a.x+a.z,b.x+b.z,d.x0+d.z0]]){
    const low=Math.min(start,end),high=Math.max(start,end);
    for(let i=Math.ceil((low-origin)/d.step);origin+i*d.step<high;i++){
      const f=(origin+i*d.step-start)/(end-start);if(f>0&&f<1)rows.push(sMin+(sMax-sMin)*f);
    }
  }
  rows.sort((a,b)=>a-b);const ss=rows.filter((s,i)=>!i||s-rows[i-1]>.001);
  const tt=[outerT,-18.35,-17.6,-16.05,-15,-13.5,innerT],top:TopTriangle[]=[];
  const vertex=(s:number,t:number)=>{
    const p=engineeringCourtPoint(s,t),outer=engineeringCourtPoint(s,outerT),mix=(t-innerT)/(outerT-innerT);
    p.y=T.MathUtils.lerp(edgeHeight(s),options.terrain.height(outer.x,outer.z),mix);return p;
  };
  // Existing OSM footways 950226190/192 and551706173 form two north spurs
  // joined by a 2.2m path;1206013981 continues at the west. Minor bends (<.3m)
  // are simplified to this local axis; lawn remains between the actual walks.
  const paved=(s:number,t:number)=>s<=1.1||(s>=51.65&&s<=53.95)||(s>=76.4&&s<=78.9)||
    (s>=51.65&&s<=78.9&&t>=-18.35&&t<=-16.05);
  let maxSlope=0;
  for(let i=1;i<ss.length;i++)for(let j=1;j<tt.length;j++){
    const a=vertex(ss[i-1],tt[j-1]),b=vertex(ss[i],tt[j-1]),c=vertex(ss[i-1],tt[j]),e=vertex(ss[i],tt[j]);
    const material=paved((ss[i]+ss[i-1])/2,(tt[j]+tt[j-1])/2)?0:1;
    for(const points of[[a,c,b],[b,c,e]]as[T.Vector3,T.Vector3,T.Vector3][]){
      const n=points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).normalize();
      maxSlope=Math.max(maxSlope,Math.acos(Math.abs(n.y))*180/Math.PI);top.push({points,material});
    }
  }
  const ground=closeGround(top,[options.concrete,options.grass],.6,'Engineering north contour connection');
  return{...ground,colliderGeometries:ground.meshes.map(m=>m.geometry),materials:[]as T.Material[],
    stats:{sMin,sMax,innerT,outerT,width:innerT-outerT,maxSlope,areaM2:(sMax-sMin)*(innerT-outerT),
      topTriangles:top.length,triangles:ground.meshes.reduce((n,m)=>n+m.geometry.attributes.position.count/3,0),materialBatches:ground.meshes.length,
      sourcePaths:[950226190,950226192,551706173,1206013981],pmaFootprintClearance:.5}};
}
