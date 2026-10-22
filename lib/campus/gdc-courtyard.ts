import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CutVolume } from './clip-volume';
import type { HedgePlacement } from './foreground-trees';
import { buildCircleWithTowers } from './circle-with-towers';

export const gdcCourtOrigin=new THREE.Vector3(21.8,0,-19.1);
export const gdcCourtEast=new THREE.Vector3(.996164,0,.087504).normalize();
export const gdcCourtSouth=new THREE.Vector3(-gdcCourtEast.z,0,gdcCourtEast.x);
export const gdcBed={halfU:5.2,halfV:5.25,height:2.65};
export function gdcCourtPoint(u:number,v:number,y=0){return gdcCourtOrigin.clone().addScaledVector(gdcCourtEast,u).addScaledVector(gdcCourtSouth,v).setY(y);}
export function gdcCourtUV(x:number,z:number){const p=new THREE.Vector3(x,0,z).sub(gdcCourtOrigin);return [p.dot(gdcCourtEast),p.dot(gdcCourtSouth)];}
export function inGdcBed(x:number,z:number){const [u,v]=gdcCourtUV(x,z);return Math.abs(u)<gdcBed.halfU&&Math.abs(v)<gdcBed.halfV;}
export function gdcCourtVolume(minU:number,maxU:number,minV:number,maxV:number,minY:number,maxY:number):CutVolume{
  const planes=[new THREE.Plane().setFromNormalAndCoplanarPoint(gdcCourtEast,gdcCourtPoint(maxU,0)),
    new THREE.Plane().setFromNormalAndCoplanarPoint(gdcCourtEast.clone().negate(),gdcCourtPoint(minU,0)),
    new THREE.Plane().setFromNormalAndCoplanarPoint(gdcCourtSouth,gdcCourtPoint(0,maxV)),
    new THREE.Plane().setFromNormalAndCoplanarPoint(gdcCourtSouth.clone().negate(),gdcCourtPoint(0,minV)),
    new THREE.Plane(new THREE.Vector3(0,-1,0),minY),new THREE.Plane(new THREE.Vector3(0,1,0),-maxY)];
  const corners=[];for(const u of [minU,maxU])for(const v of [minV,maxV])for(const y of [minY,maxY])corners.push(gdcCourtPoint(u,v,y));
  return {planes,bounds:new THREE.Box3().setFromPoints(corners)};
}
export function buildGdcCourtyard(groundHeight:(x:number,z:number)=>number=()=>2.45){
  const gravel=new THREE.MeshStandardMaterial({name:'GDC sculpture bed fine aggregate',color:0xb5a283,roughness:1});
  gravel.onBeforeCompile=shader=>{
    shader.vertexShader='varying vec3 gdcBedPoint;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ngdcBedPoint=position;');
    shader.fragmentShader='varying vec3 gdcBedPoint;\nfloat gdcGrain(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      float grit=gdcGrain(floor(gdcBedPoint*220.));
      float mottling=gdcGrain(floor(gdcBedPoint*7.));
      diffuseColor.rgb*=mix(.94,.78+grit*.34,1.-smoothstep(.004,.015,length(fwidth(gdcBedPoint))))*(.94+mottling*.11);`);
  };
  gravel.customProgramCacheKey=()=> 'gdc-gravel-v1';
  const stone=new THREE.MeshStandardMaterial({name:'GDC courtyard pale stone',color:0xbeb9ab,roughness:.87});
  const metal=new THREE.MeshStandardMaterial({name:'GDC acorn lamp metal',color:0x67746b,roughness:.58,metalness:.5});
  const globe=new THREE.MeshStandardMaterial({name:'GDC translucent-looking daylight globe',color:0xe0e4dd,roughness:.45});
  const batches=new Map<THREE.Material,THREE.BufferGeometry[]>();
  const basis=new THREE.Matrix4().makeBasis(gdcCourtEast,new THREE.Vector3(0,1,0),gdcCourtSouth);basis.setPosition(gdcCourtOrigin);
  const add=(g:THREE.BufferGeometry,m:THREE.Material)=>{g.applyMatrix4(basis);if(!batches.has(m))batches.set(m,[]);batches.get(m)!.push(g);};
  const box=(u:number,v:number,y:number,w:number,d:number,h:number,m:THREE.Material)=>add(new THREE.BoxGeometry(w,h,d).translate(u,y,v),m);
  // Keep the artwork foundation level, then grade the outer gravel into the
  // actual paths. A flat elevated box looked like a concrete plinth in play.
  const bedHeight=(u:number,v:number)=>{
    const p=gdcCourtPoint(u,v),edge=Math.max(Math.abs(u)/gdcBed.halfU,Math.abs(v)/gdcBed.halfV);
    return THREE.MathUtils.lerp(gdcBed.height,groundHeight(p.x,p.z),THREE.MathUtils.smoothstep(edge,.82,1));
  };
  const positions:number[]=[],uv:number[]=[];
  const triangle=(a:number[],b:number[],c:number[])=>{for(const p of [a,b,c]){positions.push(...p);uv.push(p[0],p[2]);}};
  const nu=26,nv=27;
  for(let i=0;i<nu;i++)for(let j=0;j<nv;j++){
    const u=-gdcBed.halfU+2*gdcBed.halfU*i/nu,v=-gdcBed.halfV+2*gdcBed.halfV*j/nv;
    const right=u+2*gdcBed.halfU/nu,back=v+2*gdcBed.halfV/nv;
    const a=[u,bedHeight(u,v),v],b=[right,bedHeight(right,v),v],c=[u,bedHeight(u,back),back],d=[right,bedHeight(right,back),back];
    triangle(a,c,b);triangle(b,c,d);
  }
  const perimeter=[[-gdcBed.halfU,-gdcBed.halfV],[gdcBed.halfU,-gdcBed.halfV],[gdcBed.halfU,gdcBed.halfV],[-gdcBed.halfU,gdcBed.halfV]];
  for(let edge=0;edge<4;edge++){
    const a=perimeter[edge],b=perimeter[(edge+1)%4],steps=edge%2?nv:nu;
    for(let i=0;i<steps;i++){
      const u=THREE.MathUtils.lerp(a[0],b[0],i/steps),v=THREE.MathUtils.lerp(a[1],b[1],i/steps);
      const u1=THREE.MathUtils.lerp(a[0],b[0],(i+1)/steps),v1=THREE.MathUtils.lerp(a[1],b[1],(i+1)/steps);
      const topA=[u,bedHeight(u,v),v],topB=[u1,bedHeight(u1,v1),v1],bottomA=[u,2.1,v],bottomB=[u1,2.1,v1];
      triangle(topA,topB,bottomA);triangle(topB,bottomB,bottomA);
    }
  }
  const floor=[[-gdcBed.halfU,2.1,-gdcBed.halfV],[gdcBed.halfU,2.1,-gdcBed.halfV],[-gdcBed.halfU,2.1,gdcBed.halfV],[gdcBed.halfU,2.1,gdcBed.halfV]];
  triangle(floor[0],floor[1],floor[2]);triangle(floor[1],floor[3],floor[2]);
  const bedGeometry=new THREE.BufferGeometry();bedGeometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  bedGeometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));bedGeometry.computeVertexNormals();add(bedGeometry,gravel);
  // Low pale planter/seat edges flank the clear approach behind the sculpture.
  for(const v of [-4.35,4.35]){
    box(10.1,v,2.69,4.1,1.0,.48,stone);box(10.1,v,2.955,4.2,1.06,.07,stone);
  }
  // Two simple acorn lamps match the courtyard's silhouette without a light per pole.
  for(const v of [-7.1,7.1]){
    const u=-4.5,p=gdcCourtPoint(u,v),y=groundHeight(p.x,p.z);
    add(new THREE.CylinderGeometry(.23,.30,.14,12).translate(u,y+.07,v),metal);
    add(new THREE.CylinderGeometry(.075,.14,3.8,12).translate(u,y+2.02,v),metal);
    add(new THREE.CylinderGeometry(.23,.16,.17,12).translate(u,y+3.96,v),metal);
    add(new THREE.SphereGeometry(.26,16,12).scale(1,1.26,1).translate(u,y+4.27,v),globe);
    add(new THREE.ConeGeometry(.12,.2,12).translate(u,y+4.65,v),metal);
  }
  const meshes:THREE.Mesh[]=[];
  for(const [material,parts] of batches){
    const normalized=parts.map(g=>g.index?g.toNonIndexed():g),g=mergeGeometries(normalized)!;
    for(const p of new Set([...parts,...normalized]))p.dispose();
    const mesh=new THREE.Mesh(g,material);mesh.name=material.name;mesh.castShadow=true;mesh.receiveShadow=true;meshes.push(mesh);
  }
  const sculpture=buildCircleWithTowers();
  // The asset already offsets its towers by half an octant. Align its axes to
  // the courtyard without another offset, preserving the gap toward Speedway.
  const sculptureMatrix=new THREE.Matrix4().makeRotationY(Math.atan2(-gdcCourtEast.z,gdcCourtEast.x));
  sculptureMatrix.setPosition(gdcCourtPoint(0,0,gdcBed.height));
  for(const g of sculpture.geometries)g.applyMatrix4(sculptureMatrix);
  meshes.push(...sculpture.meshes);
  const colliderGeometries=[...meshes.filter(m=>!sculpture.meshes.includes(m)&&m.material!==globe).map(m=>m.geometry),...sculpture.colliderGeometries];
  const materials=[gravel,stone,metal,globe,...sculpture.materials];
  const geometries=[...new Set([...meshes.map(m=>m.geometry),...colliderGeometries])];
  const volumes=[gdcCourtVolume(-6,15.95,-7.65,7.65,-.65,9.0),
    // The whole central court is now reconstructed. Remove scan triangles
    // floating in its open air, including above the stepped atrium terraces.
    // Stay inside the inner wall planes and below the west-wing roofline.
    gdcCourtVolume(-6,34.5,-7.45,7.45,9.0,29.43)];
  const hedges:HedgePlacement[]=[-4.35,4.35].map(v=>{const a=gdcCourtPoint(8.25,v),b=gdcCourtPoint(11.95,v);return{a:[a.x,a.z],b:[b.x,b.z],y:2.99,endY:2.99,width:.7,height:.4};});
  const bounds=new THREE.Box3();for(const g of geometries){g.computeBoundingBox();bounds.union(g.boundingBox!);}
  const stats={towers:sculpture.stats.towers,triangles:meshes.reduce((n,m)=>n+(m.geometry.index?.count??m.geometry.attributes.position.count)/3,0),lamps:2,planters:2};
  let disposed=false;const dispose=()=>{if(disposed)return;disposed=true;for(const g of geometries)g.dispose();for(const m of materials)m.dispose();};
  return {meshes,materials,geometries,colliderGeometries,volumes,hedges,bounds,stats,dispose};
}
