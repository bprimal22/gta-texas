import * as T from 'three';
import { buildGradedGround } from './inner-campus';

/** A small provisional graded entrance apron, fitted to the existing mall.
 * The source scan has overlapping layers here. Low-origin probes set the
 * threshold; existing authored triangle heights set every outer ground join.
 * Exact historical stair geometry remains a separate reference task.
 */
export function buildUnionApproach(groundHeight:(x:number,z:number)=>number,concrete:T.MeshStandardMaterial,base=14.25){
  const center=new T.Vector2(-393.20334,8.81191),east=new T.Vector2(.9961722,.0874122),out=new T.Vector2(-east.y,east.x);
  const points=new Map<string,number[]>();
  const point=(u:number,d:number)=>{
    const key=`${u},${d}`,cached=points.get(key);
    if(cached)return cached;
    const q=center.clone().addScaledVector(east,u).addScaledVector(out,d);
    const old=groundHeight(q.x,q.y);
    const side=1-T.MathUtils.smoothstep(Math.abs(u),3.3,5.8);
    const forward=1-T.MathUtils.smoothstep(d,.3,6);
    const result=[q.x,T.MathUtils.lerp(old+.004,Math.max(old+.004,base),side*forward),q.y];
    points.set(key,result);return result;
  };
  const surfaces:{material:string;ring:number[][]}[]=[];
  const across=[-5.8,-4.55,-3.3,-2,-1,0,1,2,3.3,4.55,5.8],depth=[-.25,.3,1,2,3,4,5,6];
  for(let i=1;i<across.length;i++)for(let j=1;j<depth.length;j++){
    const a=point(across[i-1],depth[j-1]),b=point(across[i],depth[j-1]),c=point(across[i],depth[j]),d=point(across[i-1],depth[j]);
    for(const ring of [[a,b,c],[a,c,d]])surfaces.push({material:'concrete',ring});
  }
  const corners=[point(-5.8,-.25),point(5.8,-.25),point(5.8,6),point(-5.8,6)];
  const clearance=[[corners[0],corners[1],corners[2]],[corners[0],corners[2],corners[3]]];
  const result=buildGradedGround({surfaces,clearance,trees:[],routeMeters:0},concrete,concrete,concrete,'Union entrance approach');
  return {...result,point,stats:{...result.stats,threshold:base,source:'Low-origin live surface probes; current authored mall ground at edges'}};
}
