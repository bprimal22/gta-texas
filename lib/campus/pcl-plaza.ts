import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CampusData, Point } from './types';
import type { CutVolume } from './clip-volume';
import type { TreePlacement, HedgePlacement } from './foreground-trees';
import { pclParapetPoints } from './pcl-forecourt';

// The east edge joins mapped Speedway; the west follows the outside of the
// already repaired lightwell parapet. This excludes the recessed lightwell.
const wall = pclParapetPoints.map(p => new THREE.Vector3(...p));
const outer = wall.map((p,i) => {
  const a=p.clone().sub(wall[Math.max(0,i-1)]).setY(0).normalize();
  const b=wall[Math.min(wall.length-1,i+1)].clone().sub(p).setY(0).normalize();
  if (!a.lengthSq()) a.copy(b); if (!b.lengthSq()) b.copy(a);
  const n=new THREE.Vector3(a.z+b.z,0,-a.x-b.x).normalize();
  return p.clone().addScaledVector(n,2.12/Math.max(.35,n.dot(new THREE.Vector3(b.z,0,-b.x))));
});
export const pclPlazaOutline: Point[] = [
  ...outer.map(p=>[p.x,p.z] as Point),
  [-49,338.4],[-37.67,338.4],[-33.57,291.04],[-118.5,283.7],
];
export function inPclPlaza(x: number,z: number) {
  return inside(x,z,pclPlazaOutline);
}
function inside(x:number,z:number,ring: readonly Point[]) {
  let hit=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i],b=ring[j];
    if((a[1]>z)!==(b[1]>z) && x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0]) hit=!hit;
  }
  return hit;
}
function cleanRing(points: Point[]) {
  return points[0][0]===points.at(-1)![0] && points[0][1]===points.at(-1)![1]
    ? points.slice(0,-1) : points;
}
export function buildPclPlaza(data: CampusData, corridorHeight:(x:number,z:number)=>number,
  concrete: THREE.MeshStandardMaterial, brick: THREE.MeshStandardMaterial) {
  const lowerRing=cleanRing(data.paths.find(p=>p.id===147362092)!.points);
  const upperRing=cleanRing(data.paths.find(p=>p.id===129347240)!.points);
  const eastStair=data.paths.find(p=>p.id===129347246)!;
  const broadStair=cleanRing(data.paths.find(p=>p.id===147362093)!.points);
  const materials: THREE.MeshStandardMaterial[]=[];
  const textures: THREE.Texture[]=[];
  const material=(color:number,roughness=1,metalness=0)=>{
    const m=new THREE.MeshStandardMaterial({color,roughness,metalness}); materials.push(m); return m;
  };
  const paving=material(0x747674), metal=material(0x42474a,.55,.62);
  const wood=material(0x906449,.88), orange=material(0xa8522d,.76);
  const soil=material(0x493b2b), globe=material(0xe5e5d5,.28,.05);
  paving.map=concrete.map;
  paving.onBeforeCompile=shader=>{
    shader.vertexShader='varying vec2 plazaUv;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nplazaUv=uv*2.0;');
    shader.fragmentShader='varying vec2 plazaUv;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      vec2 cell=vec2(plazaUv.x/.32+mod(floor(plazaUv.y/.16),2.0)*.5,plazaUv.y/.16);
      vec2 edge=min(fract(cell),1.0-fract(cell))*vec2(.32,.16);
      float joint=1.0-smoothstep(.002,.002+max(fwidth(plazaUv.x),fwidth(plazaUv.y)),min(edge.x,edge.y));
      diffuseColor.rgb *= 1.0-joint*.22;`);
  };
  paving.customProgramCacheKey=()=> 'pcl-plaza-pavers-v1';
  wood.onBeforeCompile=shader=>{
    shader.vertexShader='varying vec3 woodPosition;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nwoodPosition=position;');
    shader.fragmentShader='varying vec3 woodPosition;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      float grain=sin(woodPosition.z*310.0+sin(woodPosition.x*7.0)*2.0);
      diffuseColor.rgb*=.95+grain*.04;`);
  };
  wood.customProgramCacheKey=()=> 'pcl-table-grain-v1';
  const batches=new Map<THREE.Material,THREE.BufferGeometry[]>();
  const add=(g:THREE.BufferGeometry,m:THREE.Material)=>{
    if(!batches.has(m))batches.set(m,[]); batches.get(m)!.push(g);
  };
  const box=(x:number,y:number,z:number,w:number,h:number,d:number,m:THREE.Material,angle=0)=>{
    const g=new THREE.BoxGeometry(w,h,d).rotateY(angle).translate(x,y,z);
    const p=g.attributes.position,uv=g.attributes.uv,n=g.attributes.normal;
    for(let i=0;i<p.count;i++)uv.setXY(i,(Math.abs(n.getX(i))>.5?p.getZ(i):p.getX(i))/2,
      (Math.abs(n.getY(i))>.5?p.getZ(i):p.getY(i))/2);
    add(g,m);
  };
  const tube=(a:THREE.Vector3,b:THREE.Vector3,r:number,m:THREE.Material)=>{
    const delta=b.clone().sub(a),g=new THREE.CylinderGeometry(r,r,delta.length(),10);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()));
    g.translate(...a.clone().lerp(b,.5).toArray()); add(g,m);
  };
  // A low-grade fit from the unobstructed source samples. Near Speedway use the
  // existing corridor's elevation exactly; decorative objects are not samples.
  const lowerHeight=(x:number,z:number)=>{
    const edgeX=-33.57-(z-291.04)*4.25/49.06;
    const join=corridorHeight(edgeX+7.2,z)+.06;
    const plane=.10-.032*(x+80)-.006*(z-300)-.43*THREE.MathUtils.smoothstep(z,322,330);
    return THREE.MathUtils.lerp(join,plane,THREE.MathUtils.smoothstep(edgeX-x,0,10));
  };
  const upperHeight=(x:number,z:number)=> .20-.012*(x+70)+.05*Math.max(0,318-z);
  const groundHeight=(x:number,z:number)=>{
    let height=inside(x,z,upperRing)?upperHeight(x,z):lowerHeight(x,z);
    // Join the existing parapet coping path without a raised lip.
    let best=Infinity,edgeY=height;
    for(let i=1;i<outer.length;i++) {
      const a=outer[i-1],b=outer[i],dx=b.x-a.x,dz=b.z-a.z;
      const t=THREE.MathUtils.clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz),0,1);
      const d=Math.hypot(x-a.x-dx*t,z-a.z-dz*t);
      if(d<best){best=d;edgeY=THREE.MathUtils.lerp(a.y,b.y,t)+.015;}
    }
    if(best<4)height=THREE.MathUtils.lerp(edgeY,height,THREE.MathUtils.smoothstep(best,0,4));
    return height;
  };
  function surface(ring:Point[], height:(x:number,z:number)=>number,m:THREE.Material) {
    const contour=cleanRing(ring).map(p=>new THREE.Vector2(...p));
    const triangles=THREE.ShapeUtils.triangulateShape(contour,[]);
    const positions:number[]=[],uv:number[]=[];
    function triangle(a:THREE.Vector2,b:THREE.Vector2,c:THREE.Vector2) {
      if(Math.max(a.distanceTo(b),b.distanceTo(c),c.distanceTo(a))>3) {
        const ab=a.clone().lerp(b,.5),bc=b.clone().lerp(c,.5),ca=c.clone().lerp(a,.5);
        triangle(a,ab,ca);triangle(ab,b,bc);triangle(ca,bc,c);triangle(ab,bc,ca); return;
      }
      const cross=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
      for(const p of cross>0?[a,c,b]:[a,b,c]) {
        positions.push(p.x,height(p.x,p.y),p.y);uv.push(p.x/2,p.y/2);
      }
    }
    for(const ids of triangles)triangle(...ids.map(i=>contour[i]) as [THREE.Vector2,THREE.Vector2,THREE.Vector2]);
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.computeVertexNormals();add(g,m);
  }
  // Full exterior ground closes gaps between mapped paved areas. The two mapped
  // plaza polygons determine paving finishes and raised-terrace boundaries.
  surface(pclPlazaOutline,lowerHeight,paving);
  // The mapped seating polygon meets the Speedway centerline; its visible
  // paving stops at the outside of the existing herringbone corridor instead.
  surface(upperRing,(x,z)=>upperHeight(x,z)+.02,concrete);
  const westBand:Point[]=[...outer.map(p=>[p.x,p.z] as Point),[-82.9,331],[-94,305],[-115,289]];
  surface(westBand,groundHeight,concrete);
  // A retaining skirt encloses the raised terrace. Stair openings are separate.
  for(let i=0;i<upperRing.length;i++) {
    const a=upperRing[i],b=upperRing[(i+1)%upperRing.length];
    if(i===2)continue;
    const length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    const steps=Math.ceil(length/2);
    for(let j=0;j<steps;j++){
      const t=(j+.5)/steps,x=THREE.MathUtils.lerp(a[0],b[0],t),z=THREE.MathUtils.lerp(a[1],b[1],t);
      const stairA=eastStair.points[0],stairB=eastStair.points[1];
      const sx=stairB[0]-stairA[0],sz=stairB[1]-stairA[1],sl=Math.hypot(sx,sz);
      const along=((x-stairA[0])*sx+(z-stairA[1])*sz)/sl;
      const across=Math.abs((x-stairA[0])*sz-(z-stairA[1])*sx)/sl;
      if(along>0 && along<sl+1 && across<eastStair.width/2+.35)continue;
      const top=upperHeight(x,z)+.02,bottom=Math.min(lowerHeight(x,z)-.25,top-.2);
      box(x,(top+bottom)/2,z,length/steps+.03,top-bottom,.22,brick,-Math.atan2(b[1]-a[1],b[0]-a[0]));
    }
  }
  const stairRecords:{a:Point;b:Point;width:number;low:number;high:number;count:number}[]=[];
  function stairs(a:Point,b:Point,width:number,low:number,high:number,count:number,rails:boolean) {
    const len=Math.hypot(b[0]-a[0],b[1]-a[1]),u=new THREE.Vector3((b[0]-a[0])/len,0,(b[1]-a[1])/len);
    const n=new THREE.Vector3(u.z,0,-u.x),landing=rails?1.25:0;
    const run=len-landing*2,angle=-Math.atan2(u.z,u.x);
    const at=(t:number,y:number,side=0)=>new THREE.Vector3(a[0],y,a[1]).addScaledVector(u,t).addScaledVector(n,side);
    const slab=(start:number,end:number,top:number)=>{
      const p=at((start+end)/2,(top+low-.24)/2);
      const g=new THREE.BoxGeometry(end-start+.018,top-low+.24,width).rotateY(angle).translate(p.x,p.y,p.z);
      const positions=g.attributes.position,uv=g.attributes.uv;
      for(let i=0;i<positions.count;i++){
        const point=new THREE.Vector3().fromBufferAttribute(positions,i);
        if(!rails){
          // The wide flight crosses the plaza's lateral grade. A level first
          // tread left its downhill edge above the controller's step limit.
          const side=point.clone().sub(at((start+end)/2,0)).dot(n);
          const left=at(0,0,side),right=at(len,0,side);
          const delta=THREE.MathUtils.lerp(lowerHeight(left.x,left.z)+.02-low,
            upperHeight(right.x,right.z)+.02-high,(top-low)/(high-low));
          positions.setY(i,point.y+delta);
        }
        uv.setXY(i,point.x/2,Math.abs(g.attributes.normal.getY(i))>.5?point.z/2:positions.getY(i)/2);
      }
      g.computeVertexNormals();add(g,concrete);
    };
    if(landing){slab(-.1,landing,low);slab(landing+run,len+.15,high);}
    for(let i=0;i<count;i++)slab(landing+i*run/count,landing+(i+1)*run/count,low+(i+1)*(high-low)/count);
    if(rails)for(const side of [-1,1]){
      const offset=side*(width/2-.09);
      for(const t of [0,landing,landing+run,len]){
        const y=THREE.MathUtils.lerp(low,high,THREE.MathUtils.clamp((t-landing)/run,0,1));
        tube(at(t,y,offset),at(t,y+.95,offset),.027,metal);
      }
      tube(at(0,low+.95,offset),at(landing,low+.95,offset),.031,metal);
      tube(at(landing,low+.95,offset),at(landing+run,high+.95,offset),.031,metal);
      tube(at(landing+run,high+.95,offset),at(len,high+.95,offset),.031,metal);
    }
    stairRecords.push({a,b,width,low,high,count});
  }
  const sa=eastStair.points[0],sb=eastStair.points[1];
  stairs(sa,sb,eastStair.width,lowerHeight(...sa),upperHeight(...sb)+.02,12,true);
  const ba:Point=[(broadStair[1][0]+broadStair[2][0])/2,(broadStair[1][1]+broadStair[2][1])/2];
  const bb:Point=[(broadStair[0][0]+broadStair[3][0])/2,(broadStair[0][1]+broadStair[3][1])/2];
  stairs(ba,bb,12.5,lowerHeight(...ba)+.02,upperHeight(...bb)+.02,3,false);
  // A narrow concrete approach follows the mapped link to the eastern stairs.
  const approach=data.paths.find(p=>p.id===129347301)!;
  const [pa,pb]=approach.points,u=new THREE.Vector2(pb[0]-pa[0],pb[1]-pa[1]).normalize();
  const offsets=new THREE.Vector2(-u.y,u.x).multiplyScalar(approach.width/2);
  surface([[pa[0]+offsets.x,pa[1]+offsets.y],[pb[0]+offsets.x,pb[1]+offsets.y],
    [pb[0]-offsets.x,pb[1]-offsets.y],[pa[0]-offsets.x,pa[1]-offsets.y]],(x,z)=>lowerHeight(x,z)+.025,concrete);
  const tablePositions:Point[]=[[-43,300],[-49,300.5],[-58,299],[-64,299.5],[-76,297],[-82,297.5],
    [-47,309],[-54,309.5],[-64,308],[-71,308.5]];
  for(const [index,[x,z]] of tablePositions.entries()) {
    const y=lowerHeight(x,z)+.025,angle=.08+(index%3-1)*.06;
    const local=(a:number,b:number,c:number)=>new THREE.Vector3(a,b,c).applyAxisAngle(new THREE.Vector3(0,1,0),angle).add(new THREE.Vector3(x,y,z));
    const plank=(a:number,b:number,c:number,w:number,h:number,d:number,m:THREE.Material)=>{
      const p=local(a,b,c);box(p.x,p.y,p.z,w,h,d,m,angle);
    };
    for(let j=0;j<5;j++)plank(0,.76,(j-2)*.142,2.05,.065,.133,wood);
    for(const side of [-1,1]){
      plank(0,.44,side*.7,2.05,.065,.28,wood);
      for(const end of [-1,1])tube(local(end*.66,.08,side*.74),local(end*.66,.73,side*.28),.045,index%2?metal:orange);
    }
    for(const end of [-1,1])tube(local(end*.66,.4,-.81),local(end*.66,.4,.81),.04,index%2?metal:orange);
  }
  let bannerMap:THREE.CanvasTexture|undefined;
  if(typeof document!=='undefined'){
    const canvas=document.createElement('canvas');canvas.width=128;canvas.height=320;
    const c=canvas.getContext('2d')!;c.fillStyle='#bf5700';c.fillRect(0,0,128,320);
    c.fillStyle='#fff5e7';c.textAlign='center';c.font='bold 33px serif';
    for(const [i,letter] of ['T','E','X','A','S'].entries())c.fillText(letter,64,63+i*45);
    bannerMap=new THREE.CanvasTexture(canvas);bannerMap.colorSpace=THREE.SRGBColorSpace;textures.push(bannerMap);
  }
  const banner=material(0xffffff,.9);banner.map=bannerMap??null;banner.side=THREE.DoubleSide;
  const lamps:Point[]=[[-37.3,297.2],[-39,314],[-82,290],[-63,291.5],[-51.8,330]];
  for(const [x,z] of lamps){
    const y=inside(x,z,upperRing)?upperHeight(x,z):lowerHeight(x,z);
    for(const [r,h,at] of [[.23,.10,.05],[.18,.23,.2],[.11,.16,.39],[.06,3.05,1.98],[.10,.15,3.52]])
      add(new THREE.CylinderGeometry(r,r,h,16).translate(x,y+at,z),metal);
    const profile=[[0,0],[.17,.04],[.24,.15],[.26,.34],[.20,.49],[.11,.55],[0,.56]].map(p=>new THREE.Vector2(...p));
    add(new THREE.LatheGeometry(profile,20).translate(x,y+3.6,z),globe);
    add(new THREE.SphereGeometry(.095,12,8).translate(x,y+4.2,z),metal);
    // Keep normalized UVs for lettering and face the banner toward Speedway.
    add(new THREE.BoxGeometry(.014,1.05,.48).translate(x,y+2.68,z+.31),banner);
    tube(new THREE.Vector3(x,y+3.22,z),new THREE.Vector3(x,y+3.22,z+.58),.016,metal);
  }
  const trees:TreePlacement[]=[[-43.5,304.7,1.15],[-61,302.5,1.25],[-79,301.5,1.05],[-99,295,.95],[-91.5,312,.85],[-60,327.5,.7]]
    .map(([x,z,scale],i)=>({x,z,y:groundHeight(x,z)+.02,rotation:i*1.73,scale,width:1.35,height:.9}));
  const hedges:HedgePlacement[]=[
    {a:[-40.8,318.5],b:[-44,329.9],width:1.1,height:.73},
    {a:[-53.6,317.4],b:[-65.4,316.3],width:1.25,height:.75},
    {a:[-94.7,302.7],b:[-104.5,299.2],width:1.2,height:.8},
  ].map(p=>({...p,a:p.a as Point,b:p.b as Point,y:lowerHeight(...p.a as Point)+.08,endY:lowerHeight(...p.b as Point)+.08}));
  for(const p of hedges){
    const dx=p.b[0]-p.a[0],dz=p.b[1]-p.a[1],len=Math.hypot(dx,dz),segments=Math.ceil(len);
    for(let i=0;i<segments;i++){
      const t=(i+.5)/segments,x=p.a[0]+dx*t,z=p.a[1]+dz*t,y=THREE.MathUtils.lerp(p.y,p.endY,t);
      box(x,y-.02,z,len/segments+.01,.12,p.width+.2,soil,-Math.atan2(dz,dx));
    }
  }
  const meshes:THREE.Mesh[]=[];
  for(const [m,parts] of batches){
    const normalized=parts.map(g=>g.index?g.toNonIndexed():g);
    const g=mergeGeometries(normalized)!;const mesh=new THREE.Mesh(g,m);
    mesh.name='PCL plaza, stairs and furniture';mesh.castShadow=mesh.receiveShadow=true;meshes.push(mesh);
    for(const p of new Set([...parts,...normalized]))p.dispose();
  }
  // Triangulated convex cuts describe exactly the nonconvex plaza boundary.
  const contour=pclPlazaOutline.map(p=>new THREE.Vector2(...p));
  const volumes:CutVolume[]=THREE.ShapeUtils.triangulateShape(contour,[]).map(ids=>{
    const points=ids.map(i=>new THREE.Vector3(contour[i].x,0,contour[i].y));
    const center=points.reduce((sum,p)=>sum.add(p),new THREE.Vector3()).multiplyScalar(1/3);
    const planes=points.map((p,i)=>{
      const edge=points[(i+1)%3].clone().sub(p);
      const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(edge.z,0,-edge.x).normalize(),p);
      if(plane.distanceToPoint(center)>0)plane.negate();return plane;
    });
    const bounds=new THREE.Box3().setFromPoints(points);bounds.min.y=-5;bounds.max.y=28;
    planes.push(new THREE.Plane(new THREE.Vector3(0,-1,0),-5),new THREE.Plane(new THREE.Vector3(0,1,0),-28));
    return {planes,bounds};
  });
  return {meshes,materials,textures,volumes,trees,hedges,stairRecords,groundHeight,lowerHeight,
    tables:tablePositions,lamps,lowerRing,sourceWayIds:[147362092,129347240,129347246,147362093,129347301]};
}
