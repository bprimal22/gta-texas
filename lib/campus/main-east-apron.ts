import * as T from 'three';
import { tagGroundTieIn } from './ground/tag';
import planData from '../../public/data/main-east-apron-plan.json' with {type:'json'};
type P=[number,number];
type Volume={planes:T.Plane[];bounds:T.Box3};
const plan=planData as unknown as {center:P;outward:P;along:P;width:number;innerDistance:number;outerDistance:number;threshold:number;outerHeights:[number,number,number]};
export interface MainEastApronOptions {
  /** Borrowed calibrated mall material. Ownership and shaders stay with caller. */
  material?:T.MeshStandardMaterial;
  thresholdElevation?:number;
  /** Heights at the surveyed outer edge: north, center, south. No nearest-ground fallback. */
  outerElevations?:[number,number,number];
}
/** A bounded solid doorstep connection across the confirmed approach gap.
 * Geometry and collision use the same slab; the existing facade is untouched.
 */
export function buildMainEastApron(options:MainEastApronOptions={}){
 const threshold=options.thresholdElevation??plan.threshold,outer=options.outerElevations??plan.outerHeights;
 if(!Number.isFinite(threshold)||outer.length!==3||!outer.every(Number.isFinite)||outer.some(y=>Math.abs(y-threshold)>.32))throw new Error('Invalid Main east apron endpoint elevations');
 const north=new T.Vector3(plan.along[0],0,plan.along[1]),out=new T.Vector3(plan.outward[0],0,plan.outward[1]);
 const width=plan.width,lo=plan.innerDistance,hi=plan.outerDistance,thickness=.16;
 const pos=(t:number,d:number,y:number)=>new T.Vector3(plan.center[0]+north.x*t+out.x*d,y,plan.center[1]+north.z*t+out.z*d);
 // Three millimeters below the existing sill prevents a competing coplanar
 // patch in their intentional 0.12 m overlap. This is far below a walkable step.
 const innerY=threshold-.003;
 // Outer survey points are linear to 0.0213 mm. One plane avoids an
 // unnecessary longitudinal seam while retaining both measured outer ends.
 const outerCenter=(outer[0]+outer[2])/2,crossSlope=(outer[2]-outer[0])/width;
 const heightAt=(t:number,d:number)=>innerY+crossSlope*t+(outerCenter-innerY)*T.MathUtils.clamp((d-lo)/(hi-lo),0,1);
 const raw:number[]=[],volumes:Volume[]=[],topTriangles:T.Vector3[][]=[];
 const tri=(a:T.Vector3,b:T.Vector3,c:T.Vector3)=>raw.push(...a.toArray(),...b.toArray(),...c.toArray());
 const upTri=(a:T.Vector3,b:T.Vector3,c:T.Vector3)=>{if(new T.Vector3().crossVectors(b.clone().sub(a),c.clone().sub(a)).y<0)[b,c]=[c,b];tri(a,b,c);topTriangles.push([a,b,c]);};
 const rows=1,columns=1,grid:T.Vector3[][]=[];
 for(let r=0;r<=rows;r++){const d=T.MathUtils.lerp(lo,hi,r/rows),row:T.Vector3[]=[];for(let c=0;c<=columns;c++){const t=-width/2+width*c/columns;row.push(pos(t,d,heightAt(t,d)));}grid.push(row);}
 for(let r=0;r<rows;r++)for(let c=0;c<columns;c++){const a=grid[r][c],b=grid[r][c+1],cc=grid[r+1][c+1],d=grid[r+1][c];upTri(a,b,cc);upTri(a,cc,d);}
 for(const[a,b,c]of topTriangles)tri(c.clone().add(new T.Vector3(0,-thickness,0)),b.clone().add(new T.Vector3(0,-thickness,0)),a.clone().add(new T.Vector3(0,-thickness,0)));
 const boundary=[...grid[0],...grid.slice(1).map(r=>r[columns]),...grid[rows].slice(0,columns).reverse(),...grid.slice(1,rows).reverse().map(r=>r[0])];
 const center=pos(0,(lo+hi)/2,heightAt(0,(lo+hi)/2)-thickness/2);
 for(let i=0;i<boundary.length;i++){const a=boundary[i],b=boundary[(i+1)%boundary.length],c=b.clone().add(new T.Vector3(0,-thickness,0)),d=a.clone().add(new T.Vector3(0,-thickness,0));const normal=new T.Vector3().crossVectors(b.clone().sub(a),c.clone().sub(a));if(normal.dot(a.clone().sub(center))>0){tri(a,b,c);tri(a,c,d);}else{tri(a,c,b);tri(a,d,c);}}
 // Share position indices across adjoining floor triangles. A disconnected
 // triangle soup can give Rapier ambiguous exact-edge hits at the center seam.
 const unique:number[]=[],indices:number[]=[],vertexMap=new Map<string,number>();
 for(let i=0;i<raw.length;i+=3){const p=[Math.fround(raw[i]),Math.fround(raw[i+1]),Math.fround(raw[i+2])],key=p.join(',');let index=vertexMap.get(key);if(index===undefined){index=unique.length/3;vertexMap.set(key,index);unique.push(...p);}indices.push(index);}
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(unique,3));geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
 const uv:number[]=[];for(let i=0;i<unique.length;i+=3){const x=unique[i]-plan.center[0],z=unique[i+2]-plan.center[1];if(options.material)uv.push(unique[i]*.5,unique[i+2]*.5);else uv.push(x*north.x+z*north.z,x*out.x+z*out.z);}geometry.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
 const material=options.material??new T.MeshStandardMaterial({color:0xa79f8d,roughness:.94});
 if(!options.material){material.name='Main east doorway paving';
 material.onBeforeCompile=shader=>{if(shader.vertexShader.includes('varying vec2 vDoorApron;'))return;shader.vertexShader='varying vec2 vDoorApron;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nvDoorApron=uv;');shader.fragmentShader='varying vec2 vDoorApron;\n'+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
 vec2 q=vDoorApron/vec2(.8,.975);vec2 edge=min(fract(q),1.-fract(q));float joint=1.-smoothstep(.006,.006+max(fwidth(q.x),fwidth(q.y)),min(edge.x,edge.y));diffuseColor.rgb*=1.-.10*joint;`);};material.customProgramCacheKey=()=> 'main-east-apron-v1';}
 const mesh=new T.Mesh(geometry,material);mesh.name='MAI east doorway: continuous apron';tagGroundTieIn(mesh,'MAI east doorway apron','paved');mesh.castShadow=mesh.receiveShadow=true;
 // Each small cut prism follows the actual sloping triangle. It clears only
 // source geometry 15 mm to 65 cm above the replacement floor, inside it.
 for(const points of topTriangles){const center=points.reduce((s,p)=>s.add(p),new T.Vector3()).multiplyScalar(1/3);const planes=points.map((a,i)=>{const b=points[(i+1)%3],p=new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(b.z-a.z,0,a.x-b.x).normalize(),a);if(p.distanceToPoint(center)>0)p.negate();return p;});const up=new T.Vector3().crossVectors(points[1].clone().sub(points[0]),points[2].clone().sub(points[0])).normalize();planes.push(new T.Plane().setFromNormalAndCoplanarPoint(up.clone().negate(),points[0].clone().add(new T.Vector3(0,.015,0))),new T.Plane().setFromNormalAndCoplanarPoint(up,points[0].clone().add(new T.Vector3(0,.65,0))));const bounds=new T.Box3().setFromPoints(points);bounds.min.y+=.015;bounds.max.y+=.65;volumes.push({planes,bounds});}
 const samples=[];for(const t of[-1.4,-.7,0,.7,1.4])for(const d of[lo+.03,.3,.7,1,1.5,2,2.5,3,3.5,hi-.03]){const p=pos(t,d,heightAt(t,d));samples.push({kind:'apron floor',position:p.toArray(),minimumNormalY:.99});}
 return{meshes:[mesh],materials:options.material?[]:[material],colliderGeometries:[geometry],volumes,candidateClearanceVolumes:volumes,samples,stats:{scope:'Main east doorway ground connection',width,innerDistance:lo,outerDistance:hi,thresholdElevation:threshold,innerTop:innerY,outerElevations:outer,outerCenterFitResidual:outerCenter-outer[1],innerCornerHeights:[heightAt(-width/2,lo),heightAt(width/2,lo)],area:width*(hi-lo),triangles:raw.length/9,materialBatches:1,cutVolumes:volumes.length,bounds:{min:geometry.boundingBox!.min.toArray(),max:geometry.boundingBox!.max.toArray()}},heightAt};
}
