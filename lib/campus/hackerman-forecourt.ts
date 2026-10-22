import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CutVolume } from './clip-volume';
import type { TreePlacement, HedgePlacement } from './foreground-trees';

// An L-shaped paved apron outside the official NHB footprint. The east
// boundary meets Speedway's grey edge; the west reaches the repaired 24th
// approach so no scanned vegetation sliver remains between path and facade.
const outline: [number,number][] = [
  [-73,-156.05],[-9.8,-150.45],[-7.49,-177.1],[11.39,-177.1],
  [7.85,-135.6],[-73,-141.89],
];
export function inHackermanForecourt(x:number,z:number) {
  let inside=false;
  for(let i=0,j=outline.length-1;i<outline.length;j=i++) {
    const a=outline[i],b=outline[j];
    if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
export function buildHackermanForecourt(corridorHeight:(x:number,z:number)=>number,
  concrete:THREE.MeshStandardMaterial,approachHeight?:(x:number,z:number)=>number) {
  const paving=new THREE.MeshStandardMaterial({color:0xffffff,map:concrete.map,roughness:.92,side:THREE.DoubleSide});
  paving.name='Hackerman pale rectangular forecourt pavers';
  paving.onBeforeCompile=shader=>{
    shader.vertexShader='varying vec2 nhbPaverMetres;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nnhbPaverMetres=uv;');
    shader.fragmentShader='varying vec2 nhbPaverMetres;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
      float courtTone=smoothstep(.015,.40,dot(diffuseColor.rgb,vec3(.2126,.7152,.0722)));
      diffuseColor.rgb=mix(vec3(.31,.30,.27),vec3(.63,.61,.56),courtTone);`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      vec2 p=nhbPaverMetres;
      vec2 q=p/vec2(.8,.4);q.x+=mod(floor(q.y),2.0)*.5;
      vec2 edge=min(fract(q),1.-fract(q))*vec2(.8,.4);
      float aa=max(max(fwidth(p.x),fwidth(p.y)),.0001);
      float joint=1.-smoothstep(.004,.004+aa,min(edge.x,edge.y));
      diffuseColor.rgb*=1.-joint*.30;`);
  };
  paving.customProgramCacheKey=()=> 'nhb-forecourt-pavers-v2';
  const wood=new THREE.MeshStandardMaterial({color:0x77604b,roughness:.9});
  const metal=new THREE.MeshStandardMaterial({color:0x3d4442,metalness:.35,roughness:.65});
  const soil=new THREE.MeshStandardMaterial({color:0x554a39,roughness:1});
  const edging=new THREE.MeshStandardMaterial({color:0xb2aa95,roughness:.92});
  const materials=[paving,wood,metal,soil,edging];
  // Blend the entrance threshold to Speedway without a curb across the route.
  // Datum is registered to the loaded source ground, not a survey elevation.
  const height=(x:number,z:number)=>{
    const edgeX=12.785+(-z-135.382)*.0913-5.022;
    const threshold=4.74-.006*(z+151);
    const fromSpeedway=THREE.MathUtils.lerp(corridorHeight(x,z)+.02,threshold,
      THREE.MathUtils.smoothstep(edgeX-x,0,12));
    if(!approachHeight)return fromSpeedway;
    // 24th rises westward while NHB's modeled threshold remains level. Blend
    // across the apron from the north paving edge to the south facade. Keep the
    // overlapped portion 1cm beneath the street so its golden material wins.
    const northDistance=(-135.382+(x-12.785)*.090416-z)*.995937;
    const fromApproach=THREE.MathUtils.lerp(approachHeight(x,z)+.01,threshold,
      THREE.MathUtils.smoothstep(northDistance,4.6,12.7));
    return THREE.MathUtils.lerp(fromSpeedway,fromApproach,THREE.MathUtils.smoothstep(-x-10,0,8));
  };
  const shape=outline.map(p=>new THREE.Vector2(...p));
  const triangles=THREE.ShapeUtils.triangulateShape(shape,[]);
  const positions:number[]=[],uv:number[]=[];
  function triangle(a:THREE.Vector2,b:THREE.Vector2,c:THREE.Vector2,depth=0){
    const edges=[a.distanceTo(b),b.distanceTo(c),c.distanceTo(a)];
    if(Math.max(...edges)>2&&depth<9){
      const ab=a.clone().lerp(b,.5),bc=b.clone().lerp(c,.5),ca=c.clone().lerp(a,.5);
      triangle(a,ab,ca,depth+1);triangle(ab,b,bc,depth+1);triangle(ca,bc,c,depth+1);triangle(ab,bc,ca,depth+1);return;
    }
    // In x/z, a clockwise polygon has an upward-facing normal.
    const ring=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)>0?[a,c,b]:[a,b,c];
    for(const p of ring){positions.push(p.x,height(p.x,p.y),p.y);uv.push(p.x,p.y);}
  }
  for(const tri of triangles)triangle(...tri.map(i=>shape[i]) as [THREE.Vector2,THREE.Vector2,THREE.Vector2]);
  // The terrain sources differ by small amounts at this boundary. Close the
  // vertical edge of the apron so there is no view through the cleared world.
  for(let i=0;i<shape.length;i++){
    const a=shape[i],b=shape[(i+1)%shape.length],n=Math.ceil(a.distanceTo(b)/2);
    for(let j=0;j<n;j++){
      const lo=a.clone().lerp(b,j/n),hi=a.clone().lerp(b,(j+1)/n);
      const corners=[[lo.x,height(lo.x,lo.y),lo.y],[hi.x,height(hi.x,hi.y),hi.y],
        [lo.x,.29,lo.y],[hi.x,.29,hi.y]];
      for(const index of [0,2,1,1,2,3]){const p=corners[index];positions.push(...p);uv.push(p[0],p[1]);}
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.computeVertexNormals();
  const ground=new THREE.Mesh(geometry,paving);ground.name='Hackerman continuous entrance forecourt';ground.receiveShadow=true;
  const meshes:THREE.Mesh[]=[ground],colliderGeometries:THREE.BufferGeometry[]=[geometry];
  const batches=new Map<THREE.Material,THREE.BufferGeometry[]>();
  const box=(x:number,y:number,z:number,w:number,h:number,d:number,m:THREE.Material)=>{
    const g=new THREE.BoxGeometry(w,h,d).translate(x,y,z);
    if(!batches.has(m))batches.set(m,[]);batches.get(m)!.push(g);
  };
  // Simple timber slat benches from the supplied forecourt photo. Keep the
  // route to the doors and the sculpture pedestal unobstructed.
  for(const [x,z] of [[-18,-145],[-25,-145.65],[-32,-146.3]]){
    const y=height(x,z);
    for(let i=0;i<5;i++)box(x,y+.45,z+(i-2)*.105,2.5,.065,.088,wood);
    for(const side of [-1,1])box(x+side*.91,y+.21,z,.075,.42,.43,metal);
    colliderGeometries.push(new THREE.BoxGeometry(2.5,.47,.51).translate(x,y+.235,z));
  }
  // Simple planting islands behind the benches, following the supplied photo's
  // low planting and small trees. Positions/sizes are authored approximations.
  const trees:TreePlacement[]=[],hedges:HedgePlacement[]=[];
  for(const [i,[x,z]] of [[-17,-148.4],[-32,-149.72]].entries()){
    const y=height(x,z),w=3.2,d=2.0;
    box(x,y+.065,z,w,.13,d,soil);
    for(const side of [-1,1]){
      box(x,y+.10,z+side*(d/2-.045),w,.20,.09,edging);
      box(x+side*(w/2-.045),y+.10,z,.09,.20,d,edging);
    }
    colliderGeometries.push(new THREE.BoxGeometry(w,.20,d).translate(x,y+.10,z));
    trees.push({x,y:y+.11,z,rotation:i*2.4+.3,scale:.77,width:.86});
    hedges.push({a:[x-1.25,z+.64],b:[x+1.25,z+.64],y:y+.13,endY:y+.13,width:.62,height:.48});
  }
  for(const [mat,parts] of batches){
    const mesh=new THREE.Mesh(mergeGeometries(parts)!,mat);mesh.castShadow=mesh.receiveShadow=true;
    mesh.name=mat===wood||mat===metal?'Hackerman timber forecourt benches':'Hackerman low planting islands';meshes.push(mesh);parts.forEach(g=>g.dispose());
  }
  const volumes:CutVolume[]=triangles.map(tri=>{
    const ring=tri.map(i=>new THREE.Vector3(shape[i].x,0,shape[i].y));
    const center=ring.reduce((s,p)=>s.add(p),new THREE.Vector3()).multiplyScalar(1/3);
    const planes=ring.map((a,i)=>{const b=ring[(i+1)%3];
      const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(b.z-a.z,0,a.x-b.x).normalize(),a);
      if(plane.distanceToPoint(center)>0)plane.negate();return plane;});
    const bounds=new THREE.Box3().setFromPoints(ring);bounds.min.y=.3;bounds.max.y=27;
    planes.push(new THREE.Plane(new THREE.Vector3(0,-1,0),.3),new THREE.Plane(new THREE.Vector3(0,1,0),-27));
    return {planes,bounds};
  });
  return {meshes,materials,colliderGeometries,volumes,height,benches:3,trees,hedges};
}
