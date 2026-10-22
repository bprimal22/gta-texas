import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import rawPlan from './welch-inner-roof-plan.json' with {type:'json'};
import {buildRoofZone,type RoofZone,type Point2,type Volume} from './roof-geometry';
const plan=rawPlan as unknown as {frame:{origin:Point2;along:Point2;out:Point2};zones:(RoofZone&{parapetEdges:number[]})[];equipment:{id:string;s:number;d:number;platformY:number;topY:number;radius:number;housingWidth:number}[];scope:string;sourceWitnesses:number[][];};
/** Separate measured high mechanical penthouse. This builder never changes
 * existing facade/roof meshes or clears the street/courtyard beneath it.
 * Every high-band clearance has a complete new roof, underside and perimeter.
 * Exact curb sections/panel spacing/fan blades are documented approximations.
 */
export function buildWelchInnerRoof(){
 const meshes:T.Mesh[]=[],materials:T.MeshStandardMaterial[]=[],volumes:Volume[]=[],batches=new Map<T.MeshStandardMaterial,T.BufferGeometry[]>();
 const mat=(name:string,color:number,roughness:number,metalness=0)=>{const m=new T.MeshStandardMaterial({color,roughness,metalness});m.name=`Welch inner roof ${name}`;materials.push(m);return m;};
 const roof=mat('pale standing seam cover',0xb6bab7,.66,.28),body=mat('gray equipment enclosure',0x858b8a,.74,.18),metal=mat('galvanized curb and fans',0x929b9c,.48,.62),dark=mat('vent interior shadow',0x303939,.93,.12),deck=mat('service platform',0x727d7c,.82,.16);
 // Vent throats expose both faces of the sheet metal. Match visible inner faces
 // to the shared triangle collision mesh as well as the exterior.
 metal.side=T.DoubleSide;
 roof.onBeforeCompile=shader=>{shader.vertexShader='varying vec2 welchInnerRoofUv;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nwelchInnerRoofUv=uv;');shader.fragmentShader='varying vec2 welchInnerRoofUv;\n'+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
   float panel=dot(welchInnerRoofUv,vec2(${plan.frame.out[0]},${plan.frame.out[1]}))/.52;
   float aa=max(fwidth(panel),.0001),dist=min(fract(panel),1.-fract(panel));
   float line=(1.-smoothstep(.012,.022+aa,dist))*(1.-smoothstep(.35,1.2,aa));
   diffuseColor.rgb*=1.-line*.14;`);};roof.customProgramCacheKey=()=> 'welch-inner-roof-panels-v1';
 const put=(g:T.BufferGeometry,m:T.MeshStandardMaterial)=>{if(!batches.has(m))batches.set(m,[]);batches.get(m)!.push(g);};
 const world=(s:number,d:number,y:number)=>new T.Vector3(plan.frame.origin[0]+plan.frame.along[0]*s+plan.frame.out[0]*d,y,plan.frame.origin[1]+plan.frame.along[1]*s+plan.frame.out[1]*d);
 const box=(s:number,d:number,y:number,w:number,h:number,depth:number,m:T.MeshStandardMaterial)=>{const p=world(s,d,y),g=new T.BoxGeometry(w,h,depth);const basis=new T.Matrix4().makeBasis(new T.Vector3(plan.frame.along[0],0,plan.frame.along[1]),new T.Vector3(0,1,0),new T.Vector3(plan.frame.out[0],0,plan.frame.out[1])).setPosition(p);g.applyMatrix4(basis);put(g,m);};
 const cellDetails=[];
 for(const zone of plan.zones){const cell=buildRoofZone(zone);put(cell.top,zone.material==='metal'?roof:deck);put(cell.body,body);volumes.push(cell.volume);cellDetails.push({...zone,faces:cell.faces,perimeter:cell.perimeter});
  for(const i of zone.parapetEdges){const a=zone.ring[i],b=zone.ring[(i+1)%zone.ring.length],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);const center=zone.ring.reduce((v,p)=>v.add(new T.Vector2(...p)),new T.Vector2()).multiplyScalar(1/zone.ring.length);let nx=-dz/len,nz=dx/len;if(nx*(center.x-a[0])+nz*(center.y-a[1])<0){nx=-nx;nz=-nz;}const pa=new T.Vector3(a[0]+nx*.16,cell.roofHeight(...a)+.19,a[1]+nz*.16),pb=new T.Vector3(b[0]+nx*.16,cell.roofHeight(...b)+.19,b[1]+nz*.16);const g=new T.BoxGeometry(len,.38,.29).rotateY(-Math.atan2(dz,dx)).translate(...pa.clone().lerp(pb,.5).toArray());put(g,metal);}
 }
 for(const unit of plan.equipment){
  const middle=(unit.platformY+unit.topY)/2,stemTop=unit.topY-.38;
  box(unit.s,unit.d,unit.platformY+.13,unit.housingWidth+.26,.26,unit.housingWidth+.26,metal);
  box(unit.s,unit.d,(unit.platformY+.22+stemTop)/2,unit.housingWidth,stemTop-unit.platformY-.22,unit.housingWidth,body);
  // Four dark louver faces sit on complete closed metal housings. The count and
  // throat/impeller profile are representative; observed bank count is separate.
  for(const sign of[-1,1]){
   box(unit.s+sign*(unit.housingWidth/2+.008),unit.d,middle,.018,(unit.topY-unit.platformY)*.52,unit.housingWidth*.73,dark);
   box(unit.s,unit.d+sign*(unit.housingWidth/2+.008),middle,unit.housingWidth*.73,(unit.topY-unit.platformY)*.52,.018,dark);
  }
  const center=world(unit.s,unit.d,stemTop+.1);
  const throat=new T.CylinderGeometry(unit.radius,unit.radius*.86,.55,24,1,true).translate(center.x,center.y,center.z);put(throat,metal);
  const disk=new T.CylinderGeometry(unit.radius*.91,unit.radius*.91,.055,24,1,false).translate(center.x,unit.topY-.18,center.z);put(disk,dark);
  const rim=new T.TorusGeometry(unit.radius,.065,6,24).rotateX(Math.PI/2).translate(center.x,unit.topY-.005,center.z);put(rim,metal);
  const hub=new T.SphereGeometry(unit.radius*.15,12,8).scale(1,.35,1).translate(center.x,unit.topY-.105,center.z);put(hub,metal);
  for(let i=0;i<5;i++){const g=new T.BoxGeometry(unit.radius*.73,.045,unit.radius*.20).translate(unit.radius*.44,0,0).rotateY(i*Math.PI*2/5+.23).translate(center.x,unit.topY-.135,center.z);put(g,metal);}
 }
 for(const[m,parts]of batches){const flat=parts.map(g=>g.index?g.toNonIndexed():g),g=mergeGeometries(flat)!;g.computeBoundingBox();g.computeBoundingSphere();const mesh=new T.Mesh(g,m);mesh.name=`WEL high inner roof: ${m.name}`;mesh.castShadow=mesh.receiveShadow=true;meshes.push(mesh);for(const p of new Set([...flat,...parts]))p.dispose();}
 let disposed=false;
 return{meshes,materials,colliderGeometries:meshes.map(m=>m.geometry),volumes,candidateClearanceVolumes:volumes,cellDetails,
  stats:{building:'WEL',scope:plan.scope,zones:plan.zones.length,mechanicalUnits:plan.equipment.length,materialBatches:meshes.length,triangles:meshes.reduce((n,m)=>n+m.geometry.attributes.position.count/3,0),cutVolumes:volumes.length,cutLowest:Math.min(...plan.zones.map(z=>z.cutBottom)),groundCut:false,exactSurvey:false},
  dispose(){if(disposed)return;disposed=true;for(const m of meshes)m.geometry.dispose();for(const m of materials)m.dispose();}};
}
