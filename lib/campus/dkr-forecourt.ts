import * as THREE from 'three';
import type { CutVolume } from './clip-volume';
import type { TreePlacement } from './foreground-trees';
import plan from './dkr-forecourt-plan.json' with { type: 'json' };

/** Bounded concrete forecourt at Bellmont's middle west entrance. Coordinates
 * and lowest ground hits are recorded in the plan. Only the portal sightline
 * section of the continuous scanned tree row is cleared; no building cut. */
export function buildDkrForecourt(concreteMap: THREE.Texture | null = null) {
  const positions = plan.vertices.flatMap(p=>p);
  const count = plan.vertices.length, cols = plan.columns, rows = plan.rowZ.length;
  for (const [x,y,z] of plan.vertices) positions.push(x,y-plan.depth,z);
  const indices:number[]=[],topTriangles:number[][]=[];
  const tri=(a:number,b:number,c:number)=>indices.push(a,b,c);
  for(let r=0;r<rows-1;r++)for(let c=0;c<cols-1;c++){
    const a=r*cols+c,b=a+1,d=a+cols,e=d+1;
    tri(a,d,b);tri(b,d,e);topTriangles.push([a,d,b],[b,d,e]);
    tri(a+count,b+count,d+count);tri(b+count,e+count,d+count);
  }
  const ring:number[]=[];
  for(let c=0;c<cols;c++)ring.push(c);
  for(let r=1;r<rows;r++)ring.push(r*cols+cols-1);
  for(let c=cols-2;c>=0;c--)ring.push((rows-1)*cols+c);
  for(let r=rows-2;r>0;r--)ring.push(r*cols);
  for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length];tri(a,b,a+count);tri(b,b+count,a+count);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(positions.flatMap((_,i)=>i%3===0?[positions[i]*.45,positions[i+2]*.45]:[]),2));
  geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
  // Material uses metric joints and a small mulch square beneath the new tree.
  // This is one continuous floor, not an unsupported decorative ground plane.
  const material=new THREE.MeshStandardMaterial({color:0xb8b4a9,map:concreteMap,roughness:.95});
  material.name='DKR graded concrete forecourt';
  material.onBeforeCompile=shader=>{
    if(!shader.vertexShader.includes('#include <begin_vertex>')||!shader.fragmentShader.includes('#include <color_fragment>'))throw new Error('DKR forecourt requires installed Three shader chunks');
    shader.vertexShader='varying vec3 vDkrApron;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvDkrApron=position;');
    shader.fragmentShader=`varying vec3 vDkrApron;
      float dkrApronHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    `+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      vec2 dkrAp=vDkrApron.xz;
      float dkrAa=max(max(fwidth(dkrAp.x),fwidth(dkrAp.y)),.0001);
      vec2 dkrJ=abs(fract((dkrAp-vec2(310.,272.))/2.3)-.5)*2.3;
      float dkrJoint=1.-smoothstep(.0035,.0035+dkrAa,min(dkrJ.x,dkrJ.y));
      float dkrFine=dkrApronHash(floor(dkrAp*175.))-.5;
      float dkrFade=1.-smoothstep(.003,.02,dkrAa);
      diffuseColor.rgb*=1.-dkrJoint*.15+dkrFine*.055*dkrFade;
      vec2 dkrTree=abs(dkrAp-vec2(${plan.trees[0].x.toFixed(4)},${plan.trees[0].z.toFixed(4)}));
      float dkrMulch=1.-smoothstep(.82,.82+dkrAa,max(dkrTree.x,dkrTree.y));
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.069,.050,.029)*(1.+dkrFine*.16*dkrFade),dkrMulch);
    `);
  };
  material.customProgramCacheKey=()=> 'dkr-graded-apron-v1';
  const mesh=new THREE.Mesh(geometry,material);mesh.name=material.name;mesh.castShadow=true;mesh.receiveShadow=true;
  const group=new THREE.Group();group.name='DKR bounded west forecourt';group.add(mesh);
  // Exact piecewise-triangle interpolation, matching the rendered/collider
  // top surface. Calls are build-time tree placement and diagnostic use only.
  const heightAt=(x:number,z:number):number|null=>{
    const epsilon=1e-7;
    for(const[t0,t1,t2]of topTriangles){
      const a=plan.vertices[t0],b=plan.vertices[t1],c=plan.vertices[t2];
      const d=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);
      const u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/d;
      const v=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/d,w=1-u-v;
      if(u>=-epsilon&&v>=-epsilon&&w>=-epsilon)return a[1]*u+b[1]*v+c[1]*w;
    }
    return null;
  };
  const volume=(ring:THREE.Vector3[],low:number,high:number):CutVolume=>{
    const bounds=new THREE.Box3().setFromPoints(ring);bounds.min.y=low;bounds.max.y=high;
    // Rings run clockwise when viewed from above (positive X/Z area).
    const planes=ring.map((a,i)=>{const b=ring[(i+1)%ring.length],normal=new THREE.Vector3(b.z-a.z,0,a.x-b.x).normalize();return new THREE.Plane().setFromNormalAndCoplanarPoint(normal,a);});
    planes.push(new THREE.Plane(new THREE.Vector3(0,-1,0),low),new THREE.Plane(new THREE.Vector3(0,1,0),-high));return{bounds,planes};
  };
  const groundVolumes:CutVolume[]=[];
  for(let r=0;r<rows-1;r++){
    const a=plan.vertices[r*cols],b=plan.vertices[r*cols+cols-1],c=plan.vertices[(r+1)*cols+cols-1],d=plan.vertices[(r+1)*cols];
    const strip=plan.vertices.slice(r*cols,(r+2)*cols),low=Math.min(...strip.map(p=>p[1]))-plan.depth+.008,high=Math.max(...strip.map(p=>p[1]))+plan.groundClearanceAbove;
    groundVolumes.push(volume([a,b,c,d].map(([x,,z])=>new THREE.Vector3(x,0,z)),low,high));
  }
  const foliageVolumes=plan.foliageCuts.map(({min,max})=>volume([
    new THREE.Vector3(min[0],0,min[2]),new THREE.Vector3(max[0],0,min[2]),new THREE.Vector3(max[0],0,max[2]),new THREE.Vector3(min[0],0,max[2]),
  ],min[1],max[1]));
  const trees:TreePlacement[]=plan.trees.map(p=>({...p,y:heightAt(p.x,p.z)!}));
  const stats={rows,columns:cols,topTriangles:topTriangles.length,triangles:indices.length/3,batches:1,groundVolumes:groundVolumes.length,foliageVolumes:foliageVolumes.length,trees:trees.length,ownedGeometries:1,ownedMaterials:1,ownedTextures:0,borrowedTextures:concreteMap?1:0};
  let disposed=false;
  const dispose=()=>{if(disposed)return;disposed=true;group.removeFromParent();geometry.dispose();material.dispose();};
  return{group,meshes:[mesh],materials:[material],colliderGeometries:[geometry],groundVolumes,foliageVolumes,volumes:[...groundVolumes,...foliageVolumes],trees,heightAt,stats,dispose};
}
