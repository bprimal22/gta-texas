import * as THREE from 'three';
import type { CampusData } from './types';
import { subtractVolumes, type CutVolume } from './clip-volume';
import { gdcCourtPoint,gdcCourtVolume,gdcBed,inGdcBed } from './gdc-courtyard';
import type { HedgePlacement } from './foreground-trees';

// The open landscape between Speedway and the official stepped ground walls.
// The middle reaches the entrance and wraps a separate solid sculpture bed.
const outline:[number,number][]=[
  [10.78,-58.5],[30.1,-56.4],[45.9,-54.9],[45.425,-51.010],[44.927,-45.305],
  [29.805,-46.627],[29.336,-41.263],[27.718,-41.404],[26.888,-31.890],[28.506,-31.749],[28.038,-26.385],
  [39.137,-25.414],[37.784,-9.922],
  [26.685,-10.893],[26.217,-5.528],[24.599,-5.670],[23.768,3.844],[25.386,3.987],[24.918,9.350],
  [30.2,9.82],[31,13],[30.4,20.4],[3.74,20.4],
];
export function inGdcFrontage(x:number,z:number){
  let inside=false;
  for(let i=0,j=outline.length-1;i<outline.length;j=i++){
    const a=outline[i],b=outline[j];
    if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
export function buildGdcFrontage(data:CampusData,corridorHeight:(x:number,z:number)=>number,
  grass:THREE.MeshStandardMaterial,concrete:THREE.MeshStandardMaterial){
  const pathIds=[459840282,459840283,1426041602,459840284,459840285];
  const segments:number[][]=[],pathRoutes:{id:number|string;points:number[][]}[]=[];
  for(const path of data.paths.filter(p=>pathIds.includes(p.id))){
    // Adapt source approaches to the actual ground-width courtyard and the
    // sculpture bed, rather than following the narrower City roof outline.
    const xz=(u:number,v:number)=>{const p=gdcCourtPoint(u,v);return [p.x,p.z];};
    const points=path.id===459840282
      ? [path.points[0],xz(-6,6.4),xz(6.5,6.4),xz(8,0),xz(6.5,-6.4),xz(-6,-6.4),path.points.at(-1)!]
      : path.id===459840283 ? [xz(8,0),xz(16,0)] : path.points;
    pathRoutes.push({id:path.id,points});
    for(let i=1;i<points.length;i++)segments.push([...points[i-1],...points[i]]);
  }
  // Southern mapped cross path; this connects its two short building approaches.
  segments.push([3.89,18.0,31,20.0]);
  pathRoutes.push({id:'southern connector',points:[[3.89,18.0],[31,20.0]]});
  const paved=(x:number,z:number)=>inGdcBed(x,z)||segments.some(([ax,az,bx,bz])=>{
    const dx=bx-ax,dz=bz-az,t=THREE.MathUtils.clamp(((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz),0,1);
    return Math.hypot(x-ax-t*dx,z-az-t*dz)<1.35;
  });
  const height=(x:number,z:number)=>{
    const edgeX=7.07-.09*(z+17.625);
    return THREE.MathUtils.lerp(corridorHeight(x,z)+.02,2.45,
      THREE.MathUtils.smoothstep(x-edgeX,0,14));
  };
  const material=new THREE.MeshStandardMaterial({map:grass.map,color:0x7b815d,roughness:.98,side:THREE.DoubleSide});
  material.name='GDC graded groundcover and mapped stone paths';
  material.onBeforeCompile=shader=>{
    shader.uniforms.gdcPaverMap={value:concrete.map};
    shader.vertexShader='varying vec2 gdcGroundMetres;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ngdcGroundMetres=position.xz;');
    shader.fragmentShader=`varying vec2 gdcGroundMetres;uniform sampler2D gdcPaverMap;
      float gdcPathDistance(vec2 p,vec2 a,vec2 b){vec2 v=b-a;return length(p-a-v*clamp(dot(p-a,v)/dot(v,v),0.,1.));}
    `+shader.fragmentShader;
    const pathDistances=segments.map(p=>`d=min(d,gdcPathDistance(gdcGroundMetres,vec2(${p[0].toFixed(3)},${p[1].toFixed(3)}),vec2(${p[2].toFixed(3)},${p[3].toFixed(3)})));`).join('\n');
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      float d=10000.;${pathDistances}
      if(d<1.1){
        vec2 p=gdcGroundMetres;
        float tone=dot(texture2D(gdcPaverMap,p*.5).rgb,vec3(.2126,.7152,.0722));
        vec2 q=p/vec2(.65,.42);q.x+=mod(floor(q.y),2.)*.5;
        vec2 edge=min(fract(q),1.-fract(q))*vec2(.65,.42);
        float aa=max(max(fwidth(p.x),fwidth(p.y)),.0001);
        float joint=1.-smoothstep(.003,.003+aa,min(edge.x,edge.y));
        diffuseColor.rgb=mix(vec3(.36,.35,.31),vec3(.61,.59,.54),smoothstep(.03,.55,tone))*(1.-joint*.22);
      }else{
        diffuseColor.rgb*=vec3(.70,.88,.48);
      }`);
  };
  material.customProgramCacheKey=()=> 'gdc-landscape-paths-v1';
  const shape=outline.map(p=>new THREE.Vector2(...p)),triangles=THREE.ShapeUtils.triangulateShape(shape,[]);
  const positions:number[]=[],uv:number[]=[];
  function triangle(a:THREE.Vector2,b:THREE.Vector2,c:THREE.Vector2,depth=0){
    if(Math.max(a.distanceTo(b),b.distanceTo(c),c.distanceTo(a))>2&&depth<8){
      const ab=a.clone().lerp(b,.5),bc=b.clone().lerp(c,.5),ca=c.clone().lerp(a,.5);
      triangle(a,ab,ca,depth+1);triangle(ab,b,bc,depth+1);triangle(ca,bc,c,depth+1);triangle(ab,bc,ca,depth+1);return;
    }
    const ring=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)>0?[a,c,b]:[a,b,c];
    for(const p of ring){positions.push(p.x,height(p.x,p.y),p.y);uv.push(p.x/2,p.y/2);}
  }
  for(const tri of triangles)triangle(...tri.map(i=>shape[i]) as [THREE.Vector2,THREE.Vector2,THREE.Vector2]);
  for(let i=0;i<shape.length;i++){
    const a=shape[i],b=shape[(i+1)%shape.length],n=Math.ceil(a.distanceTo(b)/2);
    for(let j=0;j<n;j++){
      const lo=a.clone().lerp(b,j/n),hi=a.clone().lerp(b,(j+1)/n);
      const corners=[[lo.x,height(lo.x,lo.y),lo.y],[hi.x,height(hi.x,hi.y),hi.y],[lo.x,-.7,lo.y],[hi.x,-.7,hi.y]];
      for(const index of [0,2,1,1,2,3]){const p=corners[index];positions.push(...p);uv.push(p[0]/2,p[1]/2);}
    }
  }
  let geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.computeVertexNormals();
  const bedCut=gdcCourtVolume(-gdcBed.halfU,gdcBed.halfU,-gdcBed.halfV,gdcBed.halfV,-1,10);
  const outsideBed=subtractVolumes(geometry,new THREE.Matrix4(),[bedCut]);
  if(outsideBed){geometry.dispose();geometry=outsideBed;}
  const mesh=new THREE.Mesh(geometry,material);mesh.name='GDC connected frontage';mesh.receiveShadow=true;
  const volumes:CutVolume[]=triangles.map(tri=>{
    const points=tri.map(i=>new THREE.Vector3(shape[i].x,0,shape[i].y));
    const center=points.reduce((s,p)=>s.add(p),new THREE.Vector3()).multiplyScalar(1/3);
    const planes=points.map((p,i)=>{const q=points[(i+1)%3];
      const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(q.z-p.z,0,p.x-q.x).normalize(),p);
      if(plane.distanceToPoint(center)>0)plane.negate();return plane;});
    const bounds=new THREE.Box3().setFromPoints(points);bounds.min.y=-.65;bounds.max.y=25;
    planes.push(new THREE.Plane(new THREE.Vector3(0,-1,0),-.65),new THREE.Plane(new THREE.Vector3(0,1,0),-25));
    return {planes,bounds};
  });
  const hedges:HedgePlacement[]=[];
  for(const z of [-47,-31,-8,8]){
    const edgeX=7.07-.09*(z+17.625);
    const a:[number,number]=[edgeX+2.2,z],b:[number,number]=[edgeX+9,z+.6];
    hedges.push({a,b,y:height(...a),endY:height(...b),width:.65,height:.56});
  }
  // b03 (whole-campus-92): low clipped hedges beside the two straight approach
  // legs from Speedway to the Circle with Towers bed (Codex Street View note,
  // Mar 2025 capture, observed 2026-10-19: "low clipped hedges beside a straight
  // pale path"). Outer side of each leg only, 1.7 m off the leg centreline
  // (1.1 m path half-width + hedge half-width + margin), from just inside the
  // Speedway edge to 2 m short of the courtyard lamps. Positions are
  // reference-interpreted from perspective, not surveyed.
  for(const [v,side] of [[-6.4,-1],[6.4,1]] as const){
    const bedCorner=gdcCourtPoint(-6,v),end=[bedCorner.x,bedCorner.z],start:[number,number]=v<0?[2.8,-26.1]:[1.8,-14.5];
    const dx=end[0]-start[0],dz=end[1]-start[1],l=Math.hypot(dx,dz),nx=-dz/l*side,nz=dx/l*side;
    const along=(x:number):[number,number]=>{const t=(x-start[0])/dx;return [start[0]+dx*t+nx*1.7,start[1]+dz*t+nz*1.7];};
    const edgeX=7.07-.09*(start[1]+nx*1.7+17.625);
    const a=along(edgeX+2.2),b=along(14.5);
    hedges.push({a,b,y:height(...a),endY:height(...b),width:.65,height:.56});
  }
  return {mesh,material,volumes,height,paved,hedges,pathIds,pathSegments:segments,pathRoutes};
}
