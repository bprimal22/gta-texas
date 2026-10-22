import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import footprint from './capitol-footprint.json' with {type:'json'};
import type { CutVolume } from './clip-volume';
import type { TreePlacement } from './foreground-trees';
import { stripGroundHeight } from './blocks/b14-capitol/strip-ground';

const C=Math.cos(footprint.rotation),S=Math.sin(footprint.rotation);
export const capitolPoint=(u:number,v:number):[number,number]=>[-308+C*u-S*v,1266.5+S*u+C*v];
export const capitolLocal=(x:number,z:number):[number,number]=>[(x+308)*C+(z-1266.5)*S,-(x+308)*S+(z-1266.5)*C];
// Ground grades are photo-guided and anchored to the measured north approach.
// They are deliberately gentle, not a survey claim or an invisible physics ramp.
export function capitolGroundHeight(u:number,v:number) {
  const grade=v<35?2.52:2.52-(v-35)*.052;
  return grade-Math.abs(u)*.008;
}
/** The expanded district is outside part of the original elevation grid.
 * Supply the actual authored ground datum for map arrivals and flight height.
 * Keep the retained extension and all other neighborhoods on their old datum.
 */
export function capitolGroundReference(x:number,z:number):number|null {
  const[u,v]=capitolLocal(x,z);
  // b14 round 2: outside the grounds, the south strip (z 1288..1536, beyond terrain.json) is the block's DTM patch
  // (blocks/b14-capitol/strip-ground.ts, the same triangles that are drawn and collide); null elsewhere.
  if(Math.abs(u)>112||v< -105||v>215||(Math.abs(u)<22&&v< -77))return stripGroundHeight(x,z);
  return capitolGroundHeight(u,v);
}

/** Complete above-ground exterior and a bounded landscape replacement. The
 * scanned north extension is a notch in the replacement footprint.
 * All solid meshes are used for both rendering and physics; there are no
 * separate, invisible travel floors. Proportions remain architectural estimates.
 */
export function buildCapitolArea(domeMaterials:T.MeshStandardMaterial[]) {
  const sourceStone=domeMaterials.find(m=>m.name==='Capitol pink granite')!;
  const trim=domeMaterials.find(m=>m.name==='Capitol carved pale granite')!;
  const materials:T.MeshStandardMaterial[]=[];
  const material=(name:string,color:number,roughness=.85,metalness=0)=>{
    const m=new T.MeshStandardMaterial({color,roughness,metalness});m.name=name;materials.push(m);return m;
  };
  const stone=material('Capitol exterior granite blockwork',0x7d6053);
  stone.onBeforeCompile=(shader,renderer)=>{
    sourceStone.onBeforeCompile(shader,renderer);
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
vec2 masonry=vec2((vCapitolMetres.x+308.)*${C}+(vCapitolMetres.z-1266.5)*${S},vCapitolMetres.y);
masonry.x+=mod(floor(masonry.y/.65),2.)*.75;
vec2 bq=abs(fract(masonry/vec2(1.5,.65))-.5),ba=fwidth(masonry/vec2(1.5,.65));
float mortar=max(smoothstep(.494-ba.x,.494+ba.x,bq.x),smoothstep(.488-ba.y,.488+ba.y,bq.y));
diffuseColor.rgb*=1.-mortar*.16;`);
  };stone.customProgramCacheKey=()=> 'capitol-exterior-blockwork-86-v1';
  const glass=new T.MeshPhysicalMaterial({color:0x172224,roughness:.38,metalness:.06,clearcoat:.12});
  glass.name='Capitol exterior glazing';materials.push(glass);
  const frame=material('Capitol bronze window sash',0x5d5544,.48,.45);
  const roof=material('Capitol patinated standing seam roof',0x546d64,.76,.22);
  const path=material('Capitol pale granite paving',0x928573);
  const lawn=material('Capitol varied lawn',0x4d622e,.97);
  const dark=material('Capitol iron street furniture',0x303c32,.72,.25);
  const light=material('Capitol frosted lamp globes',0xd5cbb4,.45);
  for(const [m,kind] of [[path,'paving'],[lawn,'lawn']] as const){
    m.onBeforeCompile=shader=>{
      shader.vertexShader='varying vec3 vCapArea;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvCapArea=position;');
      shader.fragmentShader=`varying vec3 vCapArea;
float caHash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float caNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
return mix(mix(mix(caHash(i),caHash(i+vec3(1,0,0)),f.x),mix(caHash(i+vec3(0,1,0)),caHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(caHash(i+vec3(0,0,1)),caHash(i+vec3(1,0,1)),f.x),mix(caHash(i+vec3(0,1,1)),caHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
`+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
float grain=caNoise(vCapArea*80.)-.5;
float pixel=max(length(fwidth(vCapArea)),.001);
diffuseColor.rgb*=1.+grain*.12*(1.-smoothstep(.015,.07,pixel));
${kind==='paving'?`vec2 local=vec2((vCapArea.x+308.)*${C}+(vCapArea.z-1266.5)*${S},-(vCapArea.x+308.)*${S}+(vCapArea.z-1266.5)*${C});
vec2 q=abs(fract(local/vec2(1.4,1.0))-.5);vec2 a=fwidth(local/vec2(1.4,1.0));
float joint=max(smoothstep(.492-a.x,.492+a.x,q.x),smoothstep(.492-a.y,.492+a.y,q.y));diffuseColor.rgb*=1.-joint*.19;`:
`vec2 local=vec2((vCapArea.x+308.)*${C}+(vCapArea.z-1266.5)*${S},-(vCapArea.x+308.)*${S}+(vCapArea.z-1266.5)*${C});
float sideWalk=local.y>45.?38.+8.*sin(clamp((local.y-45.)/170.,0.,1.)*3.14159265):98.;
float route=min(abs(local.x)-7.,abs(abs(local.x)-sideWalk)-4.5);
route=min(route,abs(local.y-52.)-3.);route=min(route,abs(local.y-205.)-3.);
if(local.y< -55.)route=-1.;
float aa=max(length(fwidth(local)),.025),pave=1.-smoothstep(-aa,aa,route);
vec2 q=abs(fract(local/vec2(1.4,1.))-.5),a=fwidth(local/vec2(1.4,1.));
float joint=max(smoothstep(.492-a.x,.492+a.x,q.x),smoothstep(.492-a.y,.492+a.y,q.y));
diffuseColor.rgb*=.92+.16*caNoise(vCapArea*.45);
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(${new T.Color(0x928573).toArray().join(',')})*(1.-joint*.19),pave);`}`);
    };m.customProgramCacheKey=()=>`capitol-area-${kind}-86-v1`;
  }
  const batches=new Map<T.Material,T.BufferGeometry[]>();
  const matrix=new T.Matrix4().makeRotationY(-footprint.rotation).setPosition(-308,0,1266.5);
  const put=(g:T.BufferGeometry,m:T.Material)=>{g.applyMatrix4(matrix);if(!batches.has(m))batches.set(m,[]);batches.get(m)!.push(g);};
  const box=(u:number,y:number,v:number,w:number,h:number,d:number,m:T.Material,angle=0)=>
    put(new T.BoxGeometry(w,h,d).rotateY(angle).translate(u,y,v),m);
  const column=(u:number,v:number,y:number,h:number,r:number,m:T.Material)=>
    put(new T.CylinderGeometry(r*.86,r,h,16).translate(u,y,v),m);
  let windowCount=0;
  const facade=(u:number,v:number,length:number,height:number,angle:number)=>{
    const normal=new T.Vector3(Math.sin(angle),0,Math.cos(angle));
    const along=new T.Vector3(Math.cos(angle),0,-Math.sin(angle));
    const place=(s:number,y:number,depth:number,w:number,h:number,d:number,m:T.Material)=>
      box(u+along.x*s+normal.x*depth,y,v+along.z*s+normal.z*depth,w,h,d,m,angle);
    const bays=Math.max(1,Math.floor(length/4.4)),spacing=length/bays;
    const levels=height>29?[5.3,12,18.6,25.9]:[5.3,11.9,18.5,23.7];
    let lower=2.4;
    for(let row=0;row<levels.length;row++){
      const y=levels[row],h=row===3?2.7:3.9,w=Math.min(1.85,spacing*.49),bottom=y-h/2;
      if(bottom>lower)place(0,(bottom+lower)/2,-.4,length,bottom-lower,.8,stone);
      for(let i=0;i<bays;i++){
        const s=-length/2+spacing*(i+.5),gap=(spacing-w)/2;
        place(s-spacing/2+gap/2,y,-.4,gap,h,.8,stone);
        place(s+spacing/2-gap/2,y,-.4,gap,h,.8,stone);
        // A genuine recess, backed by closed glazing and four inset reveals.
        place(s,y,-.32,w,h,.08,glass);
        place(s,y,.035,.055,h,.09,frame);
        for(const dy of [-h*.25,0,h*.25])place(s,y+dy,.035,w,.05,.09,frame);
        for(const dx of [-w/2-.1,w/2+.1])place(s+dx,y,.08,.2,h+.36,.24,trim);
        place(s,y+h/2+.13,.12,w+.52,.26,.42,trim);
        place(s,y-h/2-.1,.18,w+.55,.22,.5,trim);
        windowCount++;
      }
      lower=y+h/2;
    }
    place(0,(height+lower)/2,-.4,length,height-lower,.8,stone);
    for(const [y,h,depth] of [[3,.65,.22],[9.3,.28,.16],[22,.25,.14],[height-.6,.35,.38],[height,.48,.6],[height+.4,.25,.45]])
      place(0,y,depth,length+.4,h,.8,trim);
    // Paired pilasters make the corner mass read as masonry, with actual relief.
    for(const s of [-length/2+.4,length/2-.4]){
      place(s,(height+2.5)/2,.18,.7,height-2.5,.42,trim);
      place(s,height-.8,.3,1.1,.45,.65,trim);
    }
  };
  const block=(u:number,v:number,w:number,d:number,h:number)=>{
    facade(u,v-d/2,w,h,Math.PI);facade(u,v+d/2,w,h,0);
    facade(u-w/2,v,d,h,-Math.PI/2);facade(u+w/2,v,d,h,Math.PI/2);
    box(u,2.3,v,w,.25,d,stone);box(u,h-.25,v,w,.3,d,stone);
    // Low hip roofs with raised seam strips instead of flat extrusion caps.
    const pts=[[-w/2,0,-d/2],[w/2,0,-d/2],[w/2,0,d/2],[-w/2,0,d/2],[-w/2+3,2.2,0],[w/2-3,2.2,0]];
    const tris=[[0,1,5],[0,5,4],[1,2,5],[2,3,4],[2,4,5],[3,0,4]];
    const data=tris.flatMap(t=>[t[2],t[1],t[0]].flatMap(i=>[pts[i][0]+u,pts[i][1]+h+.5,pts[i][2]+v]));
    const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(data,3));g.setAttribute('uv',new T.Float32BufferAttribute(new Float32Array(data.length/3*2),2));g.computeVertexNormals();put(g,roof);
    for(let s=-w/2+4;s<w/2-3;s+=1.25)for(const side of [-1,1]){
      const a=new T.Vector3(u+s,h+.54,v+side*d/2),b=new T.Vector3(u+s,h+2.74,v);
      const line=new T.LineCurve3(a,b);put(new T.TubeGeometry(line,1,.025,4,false),roof);
    }
  };
  // b14 (2026-10-20): central block north face at v=-48.5 (City 2023 footprint 533822 ring; 2017 LiDAR main roof
  // reaches v=-48), was -43. South face unchanged (v=37, City 36.1..37.6).
  block(3.5,-5.75,42,85.5,32.8);
  block(-38,0,40,34,26.2);block(40.5,0,34,34,26.2);
  for(const u of [-69,70]){
    block(u,-1,27,53,28.8);
    const profile=[[0,29.3],[13,29.3],[12.4,30],[11.4,31],[9.2,32.3],[5,33.8],[0,34.2]];
    put(new T.LatheGeometry(profile.map(([r,y])=>new T.Vector2(r,y)),48).scale(1,1,1.45).translate(u,0,-1),roof);
    column(u,-1,34.5,.8,.25,trim);
  }
  const arch=(w:number,h:number)=>{const s=new T.Shape(),r=w/2;s.moveTo(-r,-h/2);s.lineTo(r,-h/2);s.lineTo(r,h/2-r);s.absarc(0,h/2-r,r,0,Math.PI,false);s.lineTo(-r,-h/2);return s;};
  // North triple-arched ground entry and the south monumental portico.
  for(const side of [-1,1]){
    // North: the projecting entrance pavilion measured by the 2017 LiDAR (deck Y 24.3 from the facade at v=-48.5
    // to v~-54.5, u -6.5..10.5; research/whole-campus-92/b14-capitol/EVIDENCE.md). Arches on its front, columns
    // standing on it, entablature on top; the pediment stays on the main facade line.
    const porchU=2,porchW=17,porchFront=-52.7,porchOuter=-54.6;
    const front=side===-1?-49.1:39,entryU=side<0?porchU:3.5;
    if(side===-1)box(porchU,2.4+(22.4-2.4)/2,(porchFront-48.5)/2,porchW,22.4-2.4,-48.5-porchFront,stone);
    for(const u of side<0?[porchU-5,porchU,porchU+5]:[-5,3.5,12]){
      const doorFront=side<0?porchFront-.03:37.25;
      const placement=new T.Matrix4().makeRotationY(side<0?Math.PI:0).setPosition(u,5.4,doorFront);
      const g=new T.ShapeGeometry(arch(3.0,5.7),18).applyMatrix4(placement);put(g,glass);
      box(u,5.4,doorFront+side*.04,.065,5.6,.08,frame);
      box(u,3.05,doorFront,3.25,.25,.7,trim);
    }
    if(side===-1){
      for(const du of [-6,-2,2,6]){
        const u=porchU+du,v=porchFront-.9;
        column(u,v,15.4,13.4,.68,stone);
        column(u,v,8.7,.5,.95,trim);column(u,v,22.25,.65,1.05,trim);
      }
      box(porchU,23.35,(porchOuter-48.5)/2,porchW+1.2,1.9,-48.5-porchOuter,trim);
    }else{
      // South entrance: a deep stone arch on paired piers. The photo's
      // recessed balcony and doors sit behind it, not on a flat facade decal.
      const outer=new T.Shape(arch(22.4,23.3).getPoints(48).map(p=>p.add(new T.Vector2(0,.45))));
      outer.holes.push(new T.Path(arch(19.6,21.4).getPoints(48)));
      put(new T.ExtrudeGeometry(outer,{depth:3.3,bevelEnabled:false,curveSegments:48}).translate(3.5,14,front-1.2),stone);
      // Separate radial voussoirs and keystone give the arch real relief.
      for(let i=0;i<19;i++){
        const a=i*Math.PI/19+.008,b=(i+1)*Math.PI/19-.008;
        const shape=new T.Shape();shape.moveTo(Math.cos(a)*9.8,Math.sin(a)*9.8);
        shape.absarc(0,0,9.8,a,b,false);shape.lineTo(Math.cos(b)*11.2,Math.sin(b)*11.2);
        shape.absarc(0,0,11.2,b,a,true);shape.closePath();
        put(new T.ExtrudeGeometry(shape,{depth:.24,bevelEnabled:false,curveSegments:8}).translate(3.5,14.9,front+2.12),trim);
      }
      box(3.5,25.65,front+2.35,1.25,2.0,.55,trim);
      for(const sidePier of[-1,1])for(const offset of[12.2,15.6]){
        const u=3.5+sidePier*offset;
        box(u,14.1,front+.8,1.65,21.4,1.8,stone);
        box(u,14.1,front+1.76,.22,19.9,.15,trim);
        box(u,3.3,front+1.0,2.1,.5,2.2,trim);
        box(u,24.9,front+1.0,2.2,.7,2.3,trim);
      }
      box(3.5,8.9,front-.45,19.4,.55,2.0,trim);
      box(3.5,10.45,front+.22,19.4,.22,.38,trim);
      for(let i=0;i<27;i++)column(-5.8+i*.715,front+.22,9.65,1.3,.09,trim);
      box(3.5,26.65,front+.65,33,.72,4.7,trim);
      box(3.5,27.2,front+.6,34,.38,5.1,stone);
      // Attic storey and seven medallions below the pediment.
      box(3.5,29.7,front+.35,30.5,4.3,2.5,stone);
      for(let i=0;i<7;i++){
        const u=-8.5+i*4;
        box(u,30.0,front+1.7,2.65,2.7,.32,trim);
        put(new T.CircleGeometry(.67,24).translate(u,30.0,front+1.89),roof);
        put(new T.TorusGeometry(.67,.085,8,24).translate(u,30.0,front+1.91),trim);
        const star=new T.Shape();for(let j=0;j<10;j++){const a=Math.PI/2+j*Math.PI/5,r=j%2?.20:.48;const x=Math.cos(a)*r,y=Math.sin(a)*r;if(j===0)star.moveTo(x,y);else star.lineTo(x,y);}star.closePath();
        put(new T.ExtrudeGeometry(star,{depth:.045,bevelEnabled:false}).translate(u,30.0,front+1.93),trim);
      }
    }
    // Pediment is a thick triangular prism, not a flat photograph.
    const tri=new T.Shape();tri.moveTo(-16,0);tri.lineTo(16,0);tri.lineTo(0,6.5);tri.closePath();
    const ped=new T.ExtrudeGeometry(tri,{depth:1.2,bevelEnabled:false}).translate(3.5,32.3,front-.6);put(ped,stone);
    box(3.5,32.5,front,33,.42,1.8,trim);
    const ring=new T.TorusGeometry(.82,.12,8,24).translate(3.5,35.2,front+side*.7);put(ring,trim);
    const seal=new T.CircleGeometry(.69,24).rotateY(side<0?Math.PI:0).translate(3.5,35.2,front+side*.72);put(seal,roof);
    if(side===-1)for(let i=0;i<7;i++)box(-8.5+i*4,30.5,front+side*.7,1.4,1.4,.1,trim);
    for(const sideRoof of[-1,1]){
      const a=new T.Vector3(3.5+sideRoof*16,32.65,front+side*.75),b=new T.Vector3(3.5,39.15,front+side*.75);
      put(new T.TubeGeometry(new T.LineCurve3(a,b),1,.18,8,false),trim);
    }
    // Short stairs are real stairs; side circulation is the rideable route.
    const stairFront=side<0?porchOuter:front;
    const ground=capitolGroundHeight(entryU,stairFront+side*8),rise=(3.1-ground)/5;
    for(let i=0;i<5;i++)box(entryU,ground+rise*(i+1)/2,stairFront+side*(5-i)*.55,side<0?porchW+2:30,rise*(i+1),.55,path);
  }

  const volumes:CutVolume[]=[];
  const polygonVolume=(ring:number[][],minY:number,maxY:number)=>{
    const points=ring.map(([u,v])=>{const[x,z]=capitolPoint(u,v);return new T.Vector3(x,0,z);});
    const center=points.reduce((a,b)=>a.add(b),new T.Vector3()).multiplyScalar(1/points.length);
    const planes=points.map((a,i)=>{const b=points[(i+1)%points.length],n=new T.Vector3(-(b.z-a.z),0,b.x-a.x).normalize(),p=new T.Plane().setFromNormalAndCoplanarPoint(n,a);if(p.distanceToPoint(center)>0)p.negate();return p;});
    planes.push(new T.Plane(new T.Vector3(0,-1,0),minY),new T.Plane(new T.Vector3(0,1,0),-maxY));
    const bounds=new T.Box3().setFromPoints(points);bounds.min.y=minY;bounds.max.y=maxY;volumes.push({planes,bounds});
  };
  // Bounded overlapping rectangles cover the full measured building footprint.
  for(const[u,v,w,d]of[[3.5,-5,45,94],[-38,0,43,38],[41,0,37,39],[-69,-1,30,57],[70,-1,33,57]])
    polygonVolume([[u-w/2-4,v-d/2-4],[u+w/2+4,v-d/2-4],[u+w/2+4,v+d/2+4],[u-w/2-4,v+d/2+4]],-5,39);

  // A shared regular grid avoids T-junctions where independently subdivided
  // triangles would give Rapier false edges on an otherwise smooth road.
  // Include grade breaks and notch corners as explicit grid lines.
  // b14: quads inside (or within 1.5 m of) neighbouring City footprints (Supreme Court / Clark / Price Daniel
  // union 486339, Sam Houston 505989) are left to the terrain so those buildings are generated, not suppressed.
  const lawnHoles=new Set(footprint.lawnHoles.map(([u,v])=>`${u},${v}`));
  const us=[...new Set([...Array.from({length:57},(_,i)=>-112+i*4),-22,22])].sort((a,b)=>a-b);
  const vs=Array.from({length:81},(_,i)=>-105+i*4);
  const floorPositions:number[]=[],floorUvs:number[]=[],floorIndices:number[]=[];
  for(const v of vs)for(const u of us){floorPositions.push(u,capitolGroundHeight(u,v),v);floorUvs.push(u/2,v/2);}
  for(let j=0;j<vs.length-1;j++)for(let i=0;i<us.length-1;i++){
    const u=(us[i]+us[i+1])/2,v=(vs[j]+vs[j+1])/2;
    if(Math.abs(u)<22&&v< -77)continue;
    if(lawnHoles.has(`${u},${v}`))continue;
    const a=j*us.length+i,b=a+1,c=a+us.length,d=c+1;
    floorIndices.push(a,c,b,b,c,d);
  }
  const floor=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(floorPositions,3)).setAttribute('uv',new T.Float32BufferAttribute(floorUvs,2)).setIndex(floorIndices);
  floor.computeVertexNormals();put(floor,lawn);
  // The three convex cuts have the exact same footprint as the visible grid.
  // Their north notch retains the existing extension skylights and rotunda.
  for(const[u0,u1,v0,v1]of[[-112,112,-77,215],[-112,-22,-105,-77],[22,112,-105,-77]])
    polygonVolume([[u0,v0],[u1,v0],[u1,v1],[u0,v1]],-16,32);

  // Photo-guided distant monument silhouettes. Detailed bronze figures and
  // inscriptions are intentionally approximate; not scanned replicas.
  const bronze=frame;
  const figure=(u:number,v:number,y:number,scale=1)=>{
    put(new T.SphereGeometry(.17*scale,12,8).translate(u,y+1.72*scale,v),bronze);
    put(new T.CylinderGeometry(.24*scale,.20*scale,.73*scale,12).translate(u,y+1.15*scale,v),bronze);
    for(const side of[-1,1]){
      column(u+side*.12*scale,v,y+.45*scale,.85*scale,.105*scale,bronze);
      put(new T.CylinderGeometry(.07*scale,.095*scale,.65*scale,8).rotateZ(side*.18).translate(u+side*.28*scale,y+1.03*scale,v),bronze);
    }
  };
  const monuments=[[-13,106,'equestrian'],[13,106,'alamo'],[-13,185,'firemen'],[13,185,'soldiers']] as const;
  for(const[u,v,kind]of monuments){const y=capitolGroundHeight(u,v);
    box(u,y+.22,v,5,.44,4.2,trim);box(u,y+.6,v,4.3,.32,3.6,stone);
    if(kind==='alamo'||kind==='soldiers'){
      box(u,y+1.8,v,3.2,2.2,2.8,stone);box(u,y+3.1,v,3.7,.4,3.2,trim);
      box(u,y+4.8,v,1.9,3.1,1.8,stone);box(u,y+6.5,v,2.6,.4,2.4,trim);figure(u,v,y+6.7,1.25);
    }else if(kind==='equestrian'){
      box(u,y+1.6,v,3.7,1.9,2.7,stone);
      put(new T.SphereGeometry(1,16,10).scale(1.25,.52,.55).translate(u,y+3.3,v),bronze);
      for(const a of[-.75,.75])for(const b of[-.32,.32])column(u+a,v+b,y+2.7,1.2,.10,bronze);
      put(new T.SphereGeometry(.42,12,8).scale(.65,1.5,.8).translate(u+1.0,y+3.9,v),bronze);
      figure(u,v,y+3.3,.8);
    }else{box(u,y+2,v,2.8,2.7,2.8,stone);box(u,y+3.5,v,3.2,.3,3.2,trim);figure(u,v,y+3.7,1.3);}
  }

  const trees:TreePlacement[]=[];
  const treeSites:number[][]=[];
  for(const side of[-1,1])for(const v of[-90,-64,48,78,112,143,178,207])for(const band of[0,1]){
    const u=side*(band===0?82:60)+(v%7)*.15;treeSites.push([u,v]);
  }
  for(const[u,v]of treeSites){const[x,z]=capitolPoint(u,v),scale=2.0+(Math.abs(v)%13)/35,height=.95;
    trees.push({x,z,y:capitolGroundHeight(u,v)+.017011718824505806*2.5*scale*height-.04,scale,width:1.12,height,rotation:u*.137+v*.019});}
  const lampSites:number[][]=[];
  for(const v of[58,84,118,151,184,205])for(const u of[-9,9])lampSites.push([u,v]);
  for(const u of[-100,100])for(const v of[-90,-62,12,53])if(!(u===-100&&v===-90))lampSites.push([u,v]); // (-100,-90) lies inside City footprint 486339
  for(const[u,v]of lampSites){const y=capitolGroundHeight(u,v);column(u,v,y+1.7,3.4,.095,dark);column(u,v,y+.15,.3,.22,dark);put(new T.SphereGeometry(.22,12,8).scale(1,1.25,1).translate(u,y+3.65,v),light);column(u,v,y+3.38,.15,.2,dark);}
  for(const side of[-1,1])for(const v of[67,128,190]){
    const u=side*12,y=capitolGroundHeight(u,v);
    box(u,y+.48,v,2,.12,.6,dark);box(u,y+.8,v+.29,2,.58,.06,dark);
    for(const du of[-.8,.8])box(u+du,y+.24,v,.08,.48,.46,dark);
  }
  // Border planting, with leaf clusters rather than cubic green blocks.
  for(const side of[-1,1])for(const v of[-91,-70,55,73,132,150,197])for(let j=0;j<8;j++){
    const u=side*(v<0?34:53)+j*.6,y=capitolGroundHeight(u,v);
    put(new T.IcosahedronGeometry(.55,1).scale(1,.72,.9).translate(u,y+.36,v),lawn);
  }
  const meshes:T.Mesh[]=[];
  for(const[m,parts]of batches){const flat=parts.map(g=>g.index?g.toNonIndexed():g),g=mergeGeometries(flat)!;g.computeBoundingBox();g.computeBoundingSphere();const mesh=new T.Mesh(g,m);mesh.name=m.name;mesh.castShadow=m!==lawn&&m!==path;mesh.receiveShadow=true;meshes.push(mesh);for(const part of new Set([...parts,...flat]))part.dispose();}
  return {meshes,materials,volumes,trees,colliderGeometries:meshes.map(m=>m.geometry),
    stats:{scope:'Complete Capitol exterior, bounded north terrace and south grounds',frontPortico:'Deep south arch, radial stonework, paired piers, recessed balcony and medallions',approximateDimensions:true,footprintSource:footprint.source,windows:windowCount,trees:trees.length,lamps:lampSites.length,approximateMonuments:monuments.length,preservedNorthExtension:true,triangles:meshes.reduce((n,m)=>n+m.geometry.attributes.position.count/3,0),materialBatches:meshes.length,groundGrade:.052,sourceCutVolumes:volumes.length}};
}
