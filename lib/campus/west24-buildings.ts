import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import data from '../../public/data/west24-buildings-plan.json' with { type: 'json' };
import type { CutVolume } from './clip-volume';
import type { Point } from './types';
import { scienceEntrance, scienceCornice, biologyEntrance, gearingRoofTurret } from './science-west24-details';

/** `eave` (campus Y) and `roofRise` are fitted to the 2017 LiDAR where measured. GEA is stored as per-range
 * parts (abbr GEA, `part`): `skipEdges` are internal edges against an equal/higher part (no wall), `stepEdges`
 * internal edges above a lower part (wall from that part's roof Y), `edgeSpan` the original facade length of
 * an exterior edge (keeps the arched-flank rule), `court` the open court, `turrets` the stair towers. */
type Building={abbr:string;name:string;base:number;floors:number;floorHeight:number;roof:string;pitch:number;rings:Point[][];core:Point[][][];roofRect:Point[];clearance:Point[][][];yards:Point[][][];part?:string;eave?:number;roofRise?:number;skipEdges?:number[];stepEdges?:Record<string,number>;edgeSpan?:Record<string,number>;court?:Point[];turrets?:boolean};
const plan=data as unknown as {buildings:Building[];nhbFringe:Point[][][];gardens:Point[][][];gardenClearance:Point[][][]};
function shape(rings:Point[][]){
 const s=new T.Shape(rings[0].map(([x,z])=>new T.Vector2(x,-z)));
 s.holes=rings.slice(1).map(r=>new T.Path(r.map(([x,z])=>new T.Vector2(x,-z))));return s;
}
function triangles(rings:Point[][]){
 const r=rings.map(p=>p.map(v=>new T.Vector2(...v))),all=r.flat();
 return T.ShapeUtils.triangulateShape(r[0],r.slice(1)).map(ids=>ids.map(i=>all[i]));
}
function volume(rings:Point[][],low:number,high:number):CutVolume[]{
 return triangles(rings).filter(([a,b,c])=>{
   // Collinear triangulation slivers enclose no footprint. Building their
   // side planes can turn an empty prism into an unbounded half-space.
   const areaTwice=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
   return Number.isFinite(areaTwice)&&Math.abs(areaTwice)>1e-8;
  }).map(tri=>{
  const p=tri.map(v=>new T.Vector3(v.x,0,v.y)),center=p.reduce((s,v)=>s.add(v),new T.Vector3()).multiplyScalar(1/3);
  const planes=p.map((a,i)=>{const b=p[(i+1)%3],plane=new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(b.z-a.z,0,a.x-b.x).normalize(),a);if(plane.distanceToPoint(center)>0)plane.negate();return plane;});
  planes.push(new T.Plane(new T.Vector3(0,-1,0),low),new T.Plane(new T.Vector3(0,1,0),-high));
  const bounds=new T.Box3().setFromPoints(p);bounds.min.y=low;bounds.max.y=high;return {planes,bounds};
 });
}

/** Photograph-informed street architecture. Wall openings have real depth;
 * the same finished triangle buffers are used by rendering and Rapier. */
export function buildWest24Buildings(groundHeight:(x:number,z:number)=>number,grass?:T.MeshStandardMaterial){
 const materials:T.MeshStandardMaterial[]=[];
 const mat=(name:string,color:number,roughness=.86,metalness=0)=>{const m=new T.MeshStandardMaterial({color,roughness,metalness});m.name=`24th ${name}`;materials.push(m);return m;};
 const brick=mat('buff brick',0xc59c75),stone=mat('limestone',0xbfb69f),trim=mat('cut stone trim',0xbeb49c);
 const gearingStone=mat('Gearing rubble limestone',0xbab49e,.93);
 const glass=mat('recessed glass',0x1e3037,.16,.36),glassShade=mat('shaded glass',0x35434a,.24,.25);
 glass.envMapIntensity=2.3;glassShade.envMapIntensity=1.6;
 const frame=mat('painted sash',0x676d64,.58,.14),pipe=mat('rainwater pipes',0x414b43,.7,.2);
 const timber=mat('Gearing exposed timber',0x4b3625,.89);
 const roof=mat('roof tile',0x945d43,.88),flat=mat('flat roof',0x73746b,.96),soil=mat('foundation gravel',0x7a7664,.98);
 soil.map=grass?.map??null;soil.color.set(0x818066);
 // Pore-scale relief and mortar joints respond to light, rather than being
 // a flat, repeating line drawing. These metric UVs preserve material scale.
 for(const [m,w,h,depth] of [[brick,.228,.077,.0013],[stone,.94,.43,.0008],[gearingStone,.59,.22,.0010],[roof,.22,.38,.004]] as const){
  const rubble=m===gearingStone;
  const mortar=rubble?'vec3(.94,.93,.89)':m===stone?'vec3(.91,.90,.87)':'vec3(.78,.77,.73)';
  m.onBeforeCompile=s=>{
   if(s.vertexShader.includes('varying vec2 streetWallUv;'))return;
   s.vertexShader='varying vec2 streetWallUv;\n'+s.vertexShader;
   s.vertexShader=s.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nstreetWallUv=uv;');
   s.fragmentShader=`varying vec2 streetWallUv;
    float streetHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float streetNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(streetHash(i),streetHash(i+vec2(1,0)),f.x),mix(streetHash(i+vec2(0,1)),streetHash(i+vec2(1,1)),f.x),f.y);}
    vec3 streetCell(vec2 uv){
      vec2 q=uv/vec2(${w},${h});
      ${rubble?`float course=floor(uv.y/.21);float blockWidth=.35+.38*streetHash(vec2(course,11.));q.x=uv.x/blockWidth+streetHash(vec2(course,5.))*2.1;q.y=uv.y/.21;`:'q.x+=mod(floor(q.y),2.)*.5;'}
      vec2 f=fract(q),edge=min(f,1.-f),aa=max(fwidth(q),vec2(.0001));
      float body=smoothstep(${rubble?'.004':'.012'},${rubble?'.010':'.032'}+aa.x,edge.x)*smoothstep(${rubble?'.007':'.020'},${rubble?'.015':'.048'}+aa.y,edge.y);
      return vec3(body,streetHash(floor(q)),min(edge.x,edge.y));
    }\n`+s.fragmentShader;
   s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
    vec3 wallCell=streetCell(streetWallUv);
    float mineral=streetNoise(streetWallUv*10.7),broad=streetNoise(streetWallUv*.71)+.45*streetNoise(streetWallUv*2.7);
    vec3 warm=mix(vec3(${rubble?'.90,.90,.86':'.88,.84,.76'}),vec3(${rubble?'1.05,1.03,.97':'1.12,1.035,.90'}),wallCell.y);
    diffuseColor.rgb*=mix(${mortar},warm,wallCell.x)*(.91+.07*mineral+.09*broad);
    float streetRelief=wallCell.x*${depth}+(mineral-.5)*${depth*.42};`);
   s.fragmentShader=s.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
    roughnessFactor=clamp(roughnessFactor+(mineral-.5)*.10, .58, 1.);`);
   s.fragmentShader=s.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
    vec3 sx=dFdx(-vViewPosition),sy=dFdy(-vViewPosition);
    vec3 rx=cross(sy,normal),ry=cross(normal,sx);
    float det=dot(sx,rx);
    vec3 grad=sign(det)*(dFdx(streetRelief)*rx+dFdy(streetRelief)*ry);
    normal=normalize(abs(det)*normal-grad);`);
  };m.customProgramCacheKey=()=>`street-wall-${m.name}-4`;
 }
 // Glazing carries subdued blind slats and room variation under the reflected
 // sky. Per-pane IDs are baked into UV.z-equivalent uv.y bands, without meshes
 // for curtains or another transparent pass per window.
 for(const m of [glass,glassShade]){
  m.onBeforeCompile=s=>{
   if(s.vertexShader.includes('varying vec2 streetGlassUv;'))return;
   s.vertexShader='varying vec2 streetGlassUv;\n'+s.vertexShader;
   s.vertexShader=s.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nstreetGlassUv=uv;');
   s.fragmentShader='varying vec2 streetGlassUv;\n'+s.fragmentShader;
   s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
    vec2 paneUv=vec2(streetGlassUv.x,fract(streetGlassUv.y));
    float room=fract(sin(floor(streetGlassUv.y)*127.1+19.3)*43758.5453);
    float blindHeight=mix(.10,.88,room);
    float blind=smoothstep(blindHeight-.015,blindHeight+.015,paneUv.y)*step(.33,room);
    float slat=mix(.68+.20*smoothstep(.23,.47,fract(paneUv.y*42.)),.78,clamp(fwidth(paneUv.y*42.)*2.,0.,1.));
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.19,.185,.16)*slat,blind*.80);
    diffuseColor.rgb*=.82+.25*room;`);
  };m.customProgramCacheKey=()=>`street-glass-${m.name}-1`;
 }
 const batches=new Map<T.Material,T.BufferGeometry[]>();let windows=0,archedWindows=0,roofWings=0;
 const perBuilding:Record<string,{triangles:number;windows:number;entrances:number}>={};let active='';
 const witnesses:{building:string;kind:string;origin:number[];direction:number[]}[]=[];
 const add=(g:T.BufferGeometry,m:T.Material)=>{if(!batches.has(m))batches.set(m,[]);batches.get(m)!.push(g);if(active)perBuilding[active].triangles+=(g.index?.count??g.attributes.position.count)/3;};
 const volumes:CutVolume[]=[];
 for(const b of plan.buildings){
  active=b.abbr;perBuilding[active]??={triangles:0,windows:0,entrances:0};
  const top=b.eave??b.base+b.floors*b.floorHeight,bottom=Math.min(b.base-3,...b.rings[0].map(([x,z])=>groundHeight(x,z)-1));
  // The closed inner mass sits behind the recessed glass, with no walkable voids.
  for(const core of b.core)if(core[0]?.length>=3)add(new T.ExtrudeGeometry(shape(core),{depth:top-bottom,bevelEnabled:false}).rotateX(-Math.PI/2).translate(0,bottom,0),stone);
  add(new T.ExtrudeGeometry(shape(b.rings),{depth:.4,bevelEnabled:false}).rotateX(-Math.PI/2).translate(0,top,0),b.roof==='tile'?roof:flat);
  for(const sourceRing of b.rings){
   const ring=[...sourceRing],area=ring.reduce((s,p,i)=>s+p[0]*ring[(i+1)%ring.length][1]-ring[(i+1)%ring.length][0]*p[1],0);
   if(area>0)ring.reverse();
   for(let i=0;i<ring.length;i++){
    const a=ring[i],c=ring[(i+1)%ring.length],dx=c[0]-a[0],dz=c[1]-a[1],length=Math.hypot(dx,dz);if(length<.05)continue;
    // Parts: no wall against an equal/higher part; a step wall starts 0.3 m under the lower part's roof.
    if(b.skipEdges?.includes(i))continue;
    const stepFrom=b.stepEdges?.[String(i)],span=b.edgeSpan?.[String(i)]??length;
    const along=new T.Vector3(dx/length,0,dz/length),out=new T.Vector3(-dz/length,0,dx/length);
    const matrix=new T.Matrix4().makeBasis(along,new T.Vector3(0,1,0),out).setPosition(a[0],0,a[1]);
    const box=(x:number,y:number,z:number,w:number,h:number,d:number,m:T.Material)=>{const g=new T.BoxGeometry(w,h,d).translate(x,y,z);const pos=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv;for(let k=0;k<pos.count;k++)uv.setXY(k,Math.abs(n.getX(k))>.7?pos.getZ(k):pos.getX(k),pos.getY(k));g.applyMatrix4(matrix);add(g,m);};
    // Fine 2 cm glazing bars only need a front face at walking distance;
    // the substantial sash/reveals retain volume. This saves eight tiny
    // boxes per window while preserving their visible silhouette.
    const glazingBar=(x:number,y:number,w:number,h:number)=>add(new T.PlaneGeometry(w,h).translate(x,y,-.245).applyMatrix4(matrix),frame);
    // Foundation and individual perforated floor panels, with visible reveals.
    if(stepFrom===undefined)box(length/2,(bottom+b.base)/2,-.25,length,b.base-bottom,.5,stone);
    const bays=Math.max(0,Math.floor((length-1.2)/b.pitch));
    // North-front doors are observed in the official UT images, not inferred
    // by stamping identical entrances on every wall. Grounds stay untouched.
    const entry=['PAI','WEL'].includes(b.abbr)&&out.z<-.95&&length>(b.abbr==='PAI'?55:80);
    const center=length/2,entryWidth=b.abbr==='PAI'?2.55:2.65;
    const bioEntry=b.abbr==='BIO'&&out.z>.95&&length>50;
    const bioDoorX=(-267-a[0])/along.x;
    if(bioEntry){biologyEntrance({x:bioDoorX,base:b.base,matrix,box,add,stone:trim,metal:pipe,sash:frame,glass:glassShade});perBuilding[active].entrances++;
     witnesses.push({building:b.abbr,kind:'door',origin:new T.Vector3(bioDoorX,b.base+1.7,2).applyMatrix4(matrix).toArray(),direction:out.clone().negate().toArray()});
    }
    if(entry){
     scienceEntrance({kind:b.abbr as 'PAI'|'WEL',center,base:b.base,matrix,box,add,stone:trim,sash:frame,metal:pipe,glass:glassShade,terracotta:roof});
     perBuilding[active].entrances++;
     const position=new T.Vector3(center,b.base+1.8,2).applyMatrix4(matrix);
     witnesses.push({building:b.abbr,kind:'door',origin:position.toArray(),direction:out.clone().negate().toArray()});
    }
    for(let floor=0;floor<b.floors;floor++){
     const lo=b.base+floor*b.floorHeight,hi=lo+b.floorHeight;
     if(stepFrom!==undefined&&hi<=stepFrom)continue;
     if(stepFrom!==undefined&&lo<stepFrom){
      // Plain masonry from below the lower roof to this floor line; openings only in whole storeys above it.
      box(length/2,(stepFrom-.3+hi)/2,-.24,length,hi-stepFrom+.3,.48,b.abbr==='GEA'?gearingStone:brick);continue;
     }
     const wall=new T.Shape([new T.Vector2(0,lo),new T.Vector2(length,lo),new T.Vector2(length,hi),new T.Vector2(0,hi)]);
     // Gearing's middle-storey arched openings occur on the two exterior
     // flanks (March 2025 L020-h270); courtyard/top windows are rectangular.
     const arched=(b.abbr==='GEA'&&floor===1&&span>30&&Math.abs(out.x)>.9)||(b.abbr==='PAI'&&floor===2&&out.x<-.95&&a[1]>-107&&c[1]>-107&&length>15);
     const width=arched?2.45:b.abbr==='GEA'?1.35:b.abbr==='PAI'?(floor===3?2.38:1.72):1.6;
     const height=arched?3.5:b.abbr==='GEA'?(floor===0?1.65:1.85):b.abbr==='PAI'&&floor===3?1.88:floor===0?2.05:2.7;
     const y=lo+b.floorHeight*.52;
     for(let j=0;j<bays;j++){
      const x=(j+.5)*length/bays,w=width,h=height,low=y-h/2,high=y+h/2;
      if(entry&&floor<2&&Math.abs(x-center)<4.1)continue;
      if(bioEntry&&floor===0&&Math.abs(x-bioDoorX)<2.5)continue;
      const outline=new T.Path();
      outline.moveTo(x-w/2,low);outline.lineTo(x-w/2,arched?high-w/2:high);
      if(arched)outline.absarc(x,high-w/2,w/2,Math.PI,0,true);else outline.lineTo(x+w/2,high);
      outline.lineTo(x+w/2,low);outline.closePath();wall.holes.push(outline);
      const pane=new T.Shape(outline.getPoints(arched?12:1));
      const paneGeometry=new T.ShapeGeometry(pane,12).translate(0,0,-.455);
      const panePosition=paneGeometry.attributes.position,paneUv=paneGeometry.attributes.uv;
      // Integral UV bands identify windows; fractional coordinates identify
      // position within one pane and keep the slat pattern local to it.
      for(let k=0;k<panePosition.count;k++)paneUv.setXY(k,(panePosition.getX(k)-x)/w+.5,(panePosition.getY(k)-low)/h*.998+windows*2);
      add(paneGeometry.applyMatrix4(matrix),(j+floor)%4===0?glassShade:glass);
      if(arched){
       // True curved stone voussoirs cast shadows across the recessed head.
       const spring=high-w/2,radius=w/2;
       for(let n=0;n<11;n++){
        const t0=n*Math.PI/11+.009,t1=(n+1)*Math.PI/11-.009;
        const wedge=new T.Shape();
        wedge.absarc(x,spring,radius+.27,t0,t1,false);
        wedge.lineTo(x+Math.cos(t1)*radius,spring+Math.sin(t1)*radius);
        wedge.absarc(x,spring,radius,t1,t0,true);wedge.closePath();
        add(new T.ExtrudeGeometry(wedge,{depth:.16,bevelEnabled:false,curveSegments:3}).translate(0,0,-.05).applyMatrix4(matrix),trim);
       }
       for(const side of [-1,1])box(x+side*(radius+.13),(low+spring)/2,.015,.26,spring-low,.20,trim);
       const arc=new T.Shape();arc.absarc(x,spring,radius-.025,0,Math.PI,false);arc.absarc(x,spring,radius-.085,Math.PI,0,true);arc.closePath();
       add(new T.ExtrudeGeometry(arc,{depth:.055,bevelEnabled:false,curveSegments:12}).translate(0,0,-.225).applyMatrix4(matrix),frame);
       archedWindows++;
      }
      const spring=arched?high-w/2:high;
      for(const side of [-1,1])box(x+side*(w/2-.035),(low+spring)/2,-.25,.055,spring-low,.095,frame);
      for(const yy of [low+.03,y, ...(arched?[spring]:[high-.03])])box(x,yy,-.25,w,.055,.095,frame);
      const columns=b.abbr==='GEA'?3:b.abbr==='PAI'&&floor===3?6:4,rows=b.abbr==='GEA'?4:6;
      if(b.abbr==='PAI'&&floor===3)box(x,y,-.20,.13,h+.18,.18,trim);
      for(let col=1;col<columns;col++){
       const localX=-w/2+w*col/columns,cap=arched?spring+Math.sqrt(Math.max(0,w*w/4-localX*localX)):high;
       glazingBar(x+localX,(low+cap)/2,.022,cap-low);
      }
      for(let row=1;row<rows;row++){
       const yy=low+h*row/rows,half=arched&&yy>spring?Math.sqrt(Math.max(0,w*w/4-(yy-spring)**2)):w/2;
       glazingBar(x,yy,2*half,.021);
      }
      box(x,low-.07,.07,w+.25,.14,.35,trim);
      if(b.abbr==='BIO'&&floor===0){
       // L184/185: cut-stone console brackets beneath the first-storey sash.
       for(const side of [-1,1]){
        const xx=x+side*(w/2-.10),profile=new T.Shape().moveTo(-.13,0).lineTo(.13,0).lineTo(.09,-.36).lineTo(0,-.51).lineTo(-.08,-.35).closePath();
        add(new T.ExtrudeGeometry(profile,{depth:.20,bevelEnabled:false}).translate(xx,low-.15,.06).applyMatrix4(matrix),trim);
        for(let k=0;k<4;k++)box(xx,low-.20-k*.075,.274,.22-k*.025,.018,.035,trim);
       }
      }
      if(!arched){
       // Splayed outer reveals retain a thin, darker contact at the glazing.
       for(const side of [-1,1])box(x+side*(w/2+.035),y,-.032,.055,h+.1,.06,trim);
       box(x,high+.045,-.015,w+.09,.09,.11,trim);
      }
      windows++;perBuilding[active].windows++;
     }
     if(bioEntry&&floor===0){
      const r=.95,spring=b.base+2.86,hole=new T.Path().moveTo(bioDoorX-r,b.base+.10).lineTo(bioDoorX-r,spring);
      hole.absarc(bioDoorX,spring,r,Math.PI,0,true).lineTo(bioDoorX+r,b.base+.10).closePath();wall.holes.push(hole);
     }
     if(entry&&floor===0){
      const door=new T.Path().moveTo(center-entryWidth/2,b.base+.12).lineTo(center-entryWidth/2,b.base+3.9);
      if(b.abbr==='WEL')door.absarc(center,b.base+3.9,entryWidth/2,Math.PI,0,true);
      else door.lineTo(center+entryWidth/2,b.base+3.9);
      door.lineTo(center+entryWidth/2,b.base+.12).closePath();
      // Welch's arched head rises into storey two; clip at the floor boundary
      // and continue it there so triangulation never receives an outside hole.
      if(b.abbr==='WEL'){
       door.curves=[];door.moveTo(center-entryWidth/2,b.base+.12).lineTo(center-entryWidth/2,hi-.001).lineTo(center+entryWidth/2,hi-.001).lineTo(center+entryWidth/2,b.base+.12).closePath();
      }
      wall.holes.push(door);
     }
     if(entry&&floor===1&&b.abbr==='WEL'){
      const radius=entryWidth/2,spring=b.base+3.9,clip=lo+.001,half=Math.sqrt(radius*radius-(clip-spring)**2);
      const head=new T.Path().moveTo(center-half,clip);
      const angle=Math.asin((clip-spring)/radius);head.absarc(center,spring,radius,Math.PI-angle,angle,true);head.closePath();wall.holes.push(head);
     }
     add(new T.ExtrudeGeometry(wall,{depth:.48,bevelEnabled:false,curveSegments:12}).translate(0,0,-.48).applyMatrix4(matrix),b.abbr==='GEA'?gearingStone:floor===0?stone:brick);
    }
    if(stepFrom===undefined)box(length/2,b.base+b.floorHeight,.06,length,.18,.26,trim);
    box(length/2,top-.21,.11,length,.22,.40,trim);
    box(length/2,top+.04,.19,length,.13,.59,trim);
    if(b.abbr==='BIO'){
     // Deep ventilated eave and regularly spaced corbels are observed in UT's
     // exterior photograph. Keep these under the retained hipped roof.
     box(length/2,top-.43,.18,length,.24,.45,timber);
     box(length/2,top-.12,.49,length,.21,.99,timber);
     for(let x=.8;x<length;x+=1.18)box(x,top-.31,.34,.19,.38,.77,trim);
     box(length/2,b.base+.50,.035,length,.10,.12,trim);
    }
    if(['PAI','WEL'].includes(b.abbr))scienceCornice({kind:b.abbr as 'PAI'|'WEL',length,top,box,stone:trim,timber});
    if(b.abbr==='GEA'&&length>5){
     // Timber rafter ends and a deep soffit are conspicuous in CNS photos.
     box(length/2,top-.11,.39,length,.16,.83,timber);
     for(let x=.5;x<length;x+=.92)box(x,top-.23,.36,.12,.26,1.1,timber);
     box(length/2,top+.005,.87,length,.24,.10,timber);
    }
    if(length>16&&stepFrom===undefined)for(const x of [1.2,length-1.2])box(x,(b.base+top)/2,.16,.105,top-b.base,.12,pipe);
   }
  }
  const hipRoof=(points:Point[],rise:number)=>{
   const r=points.map(([x,z])=>new T.Vector3(x,top+.4,z));
   if(r[0].distanceTo(r[1])<r[1].distanceTo(r[2]))r.push(r.shift()!);
   const l=r[0].clone().lerp(r[3],.5),q=r[1].clone().lerp(r[2],.5);
   const p=l.clone().lerp(q,.14),s=l.clone().lerp(q,.86);p.y+=rise;s.y+=rise;
   const faces=[[r[0],r[1],s],[r[0],s,p],[r[1],r[2],s],[r[2],r[3],p],[r[2],p,s],[r[3],r[0],p]];
   const positions:number[]=[],uv:number[]=[];
   for(const face of faces){
    const along=new T.Vector3().subVectors(face[1],face[0]).normalize(),normal=new T.Vector3().crossVectors(along,new T.Vector3().subVectors(face[2],face[0])).normalize();
    const up=new T.Vector3().crossVectors(normal,along);
    for(const v of face){positions.push(v.x,v.y,v.z);const local=v.clone().sub(face[0]);uv.push(local.dot(along),local.dot(up));}
   }
   const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.computeVertexNormals();roof.side=T.DoubleSide;add(g,roof);roofWings++;
   // Curved ridge-cap silhouette is real geometry, merged into the tile batch.
   const axis=new T.Vector3().subVectors(s,p),cap=new T.CylinderGeometry(.14,.14,axis.length()+.22,8,1,true);
   cap.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),axis.clone().normalize())).translate(...p.clone().lerp(s,.5).toArray());add(cap,roof);
  };
  if(b.roof==='tile'&&['WEL','BIO'].includes(b.abbr))hipRoof(b.roofRect,b.roofRise??3.2);
  // LiDAR-tiered parts (GEA ranges, PAI wings): one hip per part that carries roofRise.
  if(b.part&&b.roof==='tile'&&b.roofRise)hipRoof(b.roofRect,b.roofRise);
  if(b.abbr==='PAI'&&!b.part){
   // The main 24th wing has a shallow tiled hip; retain the rear flat roof
   // around the observatory instead of inventing a complete pitched roof.
   const r=b.rings[0];hipRoof([r[0],r[1],r[2],[r[0][0]+r[2][0]-r[1][0],r[0][1]+r[2][1]-r[1][1]]],b.roofRise??1.65);
  }
  if(b.abbr==='GEA'&&b.part){
   // LiDAR-tiered parts: hipped tile central range, flat-deck wings (b06-r1).
   if(b.turrets)for(const [x,z] of [[-214.5,-187.2],[-180.7,-184.2]])gearingRoofTurret({x,z,top,add,stone:gearingStone,trim,timber,roof,sash:glassShade});
   if(b.court){
    const court=b.court.map(p=>new T.Vector2(...p)),center=court.reduce((sum,p)=>sum.add(p),new T.Vector2()).multiplyScalar(.25);
    volumes.push(...volume([court.map(p=>p.lerp(center,.06).toArray() as Point)],b.base+3,top+12));
   }
  }else if(b.abbr==='GEA'){
   // Three roofs follow the existing U-shaped footprint, leaving the court
   // open. Coordinates are interpolated from the registered official ring.
   const r=b.rings[0];
   hipRoof([r[15],r[0],r[12],r[14]],1.65);
   hipRoof([r[7],r[8],r[9],r[11]],1.65);
   hipRoof([r[3],r[4],r[11],r[12]],1.3);
   // CNS exterior: two raised square stair towers bookend the court, plus
   // narrow chimneys. The earlier U-roof alone omitted this silhouette.
   for(const [x,z] of [[-214.5,-187.2],[-180.7,-184.2]])gearingRoofTurret({x,z,top,add,stone:gearingStone,trim,timber,roof,sash:glassShade});
   // The courtyard is open sky in the references. Clear only its upper air:
   // the old scan retains a detached roof beam above the new three-wing roof.
   // Inset from the inner walls and retain all ground/steps below this cut.
   const court=[r[2],r[3],r[4],r[5]].map(p=>new T.Vector2(...p));
   const center=court.reduce((sum,p)=>sum.add(p),new T.Vector2()).multiplyScalar(.25);
   const inset=court.map(p=>p.lerp(center,.06).toArray() as Point);
   volumes.push(...volume([inset],b.base+3,top+12));
  }
  for(const cell of b.yards){
   const positions:number[]=[],uv:number[]=[];
   for(const source of triangles(cell)){
    const [p,q,r]=source,cross=(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
    for(const v of cross>0?[p,r,q]:source){positions.push(v.x,groundHeight(v.x,v.y),v.y);uv.push(v.x,v.y);}
   }
   const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.computeVertexNormals();add(g,soil);
  }
  for(const rings of b.clearance)volumes.push(...volume(rings,bottom-2,top+12));
 }
 active='';
 for(const cell of plan.gardens){
  const positions:number[]=[],uv:number[]=[];
  for(const source of triangles(cell)){
   const [p,q,r]=source,cross=(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
   for(const v of cross>0?[p,r,q]:source){positions.push(v.x,groundHeight(v.x,v.y),v.y);uv.push(v.x*.5,v.y*.5);}
  }
  const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.computeVertexNormals();add(g,soil);
 }
 for(const rings of plan.gardenClearance)volumes.push(...volume(rings,Math.min(...rings[0].map(([x,z])=>groundHeight(x,z)))-2,48));
 // This fringe already has authored soil/sidewalk beneath it. Keep scan ground
 // below the road while removing detached foliage that intersects the NHB wall.
 for(const rings of plan.nhbFringe)volumes.push(...volume(rings,Math.min(...rings[0].map(([x,z])=>groundHeight(x,z)))-.2,45));
 const meshes:T.Mesh[]=[];
 for(const [m,parts] of batches){const flatParts=parts.map(g=>g.index?g.toNonIndexed():g),g=mergeGeometries(flatParts)!;const mesh=new T.Mesh(g,m);mesh.name=`West 24th architecture: ${m.name}`;mesh.castShadow=mesh.receiveShadow=true;meshes.push(mesh);for(const part of new Set([...parts,...flatParts]))part.dispose();}
 return {meshes,materials,volumes,witnesses,stats:{buildings:plan.buildings.length,windows,archedWindows,roofWings,perBuilding,triangles:meshes.reduce((n,m)=>n+m.geometry.attributes.position.count/3,0)}};
}
