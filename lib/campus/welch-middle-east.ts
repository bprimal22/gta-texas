import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createCampusGlass } from './campus-glass';
import rawPlan from './welch-middle-east-plan.json' with { type: 'json' };
type P=[number,number];
type Volume={planes:T.Plane[];bounds:T.Box3};
type Witness={kind:string;origin:number[];direction:number[];minimum?:number};
const plan=rawPlan as unknown as {a:P;b:P;length:number;baseElevation:number;eaveElevation:number;upperFloors:number;upperBays:number;upperOrdinaryBays:number;transitionGlazingWidth:number;ordinaryLowerCenters:number[];ordinaryLowerWidth:number;serviceOpening:{center:number;width:number;heightRatio:number;archRiseRatio:number};northLowerOpening:{center:number;width:number};roofPitch:number;roofStripDepth:number;cutDepth:number;cutFringe:number;cutGroundBuffer:number;photoRatios:{arcadeOverStory:number;glassOverStory:number;headOverStory:number;corniceHeight:number};photoIds:string[]};
export interface WelchMiddleEastOptions {
  /** Authored geometry grade. Do not feed the first tree/canopy scan return. */
  groundHeight:(x:number,z:number)=>number;
  /** Borrow the current Welch-south materials by their names when available. */
  materials?:T.MeshStandardMaterial[];
  baseElevation?:number;
  eaveElevation?:number;
  /** Optional confirmed opening floor; by default follow safe authored grade. */
  recessFloorHeight?:(x:number,z:number)=>number;
  cutFringe?:number;
  cutCeiling?:number;
}
/** The 68.217m east wall gap only. L001's regular arcade, broad northern
 * service recess and dark connector are separated explicitly. This does not
 * reproduce the historic white sash section, which belongs to west24.
 * Every visible triangle is also physical. No new playable interior is opened.
 */
export function buildWelchMiddleEast(options:WelchMiddleEastOptions){
  const base=options.baseElevation??plan.baseElevation,eave=options.eaveElevation??plan.eaveElevation;
  const fringe=options.cutFringe??plan.cutFringe,ceiling=options.cutCeiling??eave+.15;
  if(![base,eave,fringe,ceiling].every(Number.isFinite)||eave-base<12||eave-base>23||fringe<0||fringe>1.25||ceiling<eave||ceiling>eave+.8)throw new Error('Invalid Welch middle envelope');
  const ground=(x:number,z:number)=>{const y=options.groundHeight(x,z);if(!Number.isFinite(y))throw new Error('Nonfinite Welch middle ground');return y;};
  const story=(eave-base-plan.photoRatios.corniceHeight)/(plan.upperFloors+plan.photoRatios.arcadeOverStory),arcade=story*plan.photoRatios.arcadeOverStory;
  const windowHeight=story*plan.photoRatios.glassOverStory,headHeight=story*plan.photoRatios.headOverStory;
  const materials: T.MeshStandardMaterial[] = [], meshes: T.Mesh[] = [], volumes: Volume[] = [], samples: Witness[] = [];
  const batches = new Map<T.MeshStandardMaterial, T.BufferGeometry[]>();
  const mat = (name: string, color: number, roughness = .88, metalness = 0) => {
    const shared = options.materials?.find(m => m.name === `Welch south ${name}`);
    if (shared) return shared;
    const m = new T.MeshStandardMaterial({ color, roughness, metalness });
    m.name = `Welch middle east ${name}`; materials.push(m); return m;
  };
  const brick = mat('mottled buff brick', 0xbc9879);
  const stone = mat('pale stone arcade', 0xbab39e);
  const trim = mat('stone heads and soffits', 0xb5ad98);
  const glass = createCampusGlass({ name: 'Welch middle east recessed dark glazing' });
  materials.push(glass);
  const frame = mat('dark bronze window frames', 0x414a48, .56, .25);
  const roof = mat('muted terracotta eave tiles', 0x855941, .93);
  const joint = mat('shadow courses and rainwater pipe', 0x797260, .87, .06);

  // Metric UVs keep brick joints fine enough to read as masonry. No downloaded
  // facade photograph is pasted onto the mesh; the layout comes from references.
  for (const [m, cell, relief] of [[brick, [.24, .076], .0011], [stone, [.92, .53], .00025]] as const) {
    if (!materials.includes(m)) continue;
    m.onBeforeCompile = shader => {
      shader.vertexShader = 'varying vec2 welchUv;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nwelchUv=uv;');
      shader.fragmentShader = `varying vec2 welchUv;
        float welchHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float welchNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(welchHash(i),welchHash(i+vec2(1,0)),f.x),mix(welchHash(i+vec2(0,1)),welchHash(i+vec2(1,1)),f.x),f.y);}
      ` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        vec2 wq=welchUv/vec2(${cell[0]},${cell[1]});wq.x+=mod(floor(wq.y),2.)*.5;
        vec2 we=min(fract(wq),1.-fract(wq)),wa=max(fwidth(wq),vec2(.0001));
        float wb=smoothstep(.008,.018+wa.x,we.x)*smoothstep(.019,.045+wa.y,we.y);
        float wn=welchNoise(welchUv*16.0),wr=welchHash(floor(wq));
        vec3 wt=mix(vec3(.91,.88,.82),vec3(1.08,1.045,.98),wr);
        ${m===brick?`
        // Filter subpixel courses toward their area-weighted brick/mortar mean,
        // not the mortar color. Derivatives precede the discontinuous row offset.
        vec2 wp=max(fwidth(welchUv/vec2(.24,.076)),vec2(.0001));
        float wf=1.-smoothstep(.22,1.30,max(wp.x,wp.y));
        float wbf=smoothstep(.008,.018+wp.x,we.x)*smoothstep(.019,.045+wp.y,we.y);
        vec3 wdetail=mix(vec3(.82,.815,.79),wt,wbf)*(.96+.06*wn);
        vec3 wmean=mix(vec3(.82,.815,.79),vec3(.995,.9625,.90),.911664)*.99;
        // Restrained metre-scale buff/salmon mottling survives the fine-pattern
        // filter; no additional normal relief or coarse grime is introduced.
        float wm=clamp((.65*welchNoise(welchUv/vec2(.75,.60))+.35*welchNoise(welchUv/vec2(1.45,1.10)+vec2(13.7,4.1))-.5)*2.2,-1.,1.);
        vec3 wmottle=vec3(1.)+wm*vec3(.075,.043,-.025);
        diffuseColor.rgb*=mix(wmean,wdetail,wf)*wmottle;
        float wh=(wbf*${relief}+(wn-.5)*${relief * .35})*wf;
        `:`diffuseColor.rgb*=mix(vec3(.82,.815,.79),wt,wb)*(.96+.06*wn);
        float wh=wb*${relief}+(wn-.5)*${relief * .35};`}`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec3 wx=dFdx(-vViewPosition),wy=dFdy(-vViewPosition),wrx=cross(wy,normal),wry=cross(normal,wx);
        float wd=dot(wx,wrx);vec3 wg=sign(wd)*(dFdx(wh)*wrx+dFdy(wh)*wry);
        normal=normalize(abs(wd)*normal-wg);`);
    };
    m.customProgramCacheKey = () => `welch-south-metric-Welch south ${m===brick?"mottled buff brick":"pale stone arcade"}-${m===brick?2:1}`;
  }


  const along=new T.Vector3(plan.b[0]-plan.a[0],0,plan.b[1]-plan.a[1]).normalize();
  const outward=new T.Vector3(-along.z,0,along.x),length=Math.hypot(plan.b[0]-plan.a[0],plan.b[1]-plan.a[1]);
  const matrix=new T.Matrix4().makeBasis(along,new T.Vector3(0,1,0),outward).setPosition(plan.a[0],0,plan.a[1]);
  const point=(x:number,y:number,d:number)=>new T.Vector3(x,y,d).applyMatrix4(matrix);
  const add=(g:T.BufferGeometry,m:T.MeshStandardMaterial)=>{
    const p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv;
    for(let i=0;i<p.count;i++)uv.setXY(i,Math.abs(n.getX(i))>.7?p.getZ(i):p.getX(i),p.getY(i));
    g.applyMatrix4(matrix);if(!batches.has(m))batches.set(m,[]);batches.get(m)!.push(g);
  };
  const box=(x:number,y:number,d:number,w:number,h:number,depth:number,m:T.MeshStandardMaterial)=>{if(w>.0001&&h>.0001&&depth>.0001)add(new T.BoxGeometry(w,h,depth).translate(x,y,d),m);};
  const probe=(x:number,y:number,kind:string,minimum=0,d=2.2)=>samples.push({kind,origin:point(x,y,d).toArray(),direction:outward.clone().negate().toArray(),minimum});
  type Opening={x:number;w:number;bottom:number;h:number;rise:number;kind:'arcade'|'service'|'upper'|'connector'};
  const lower:Opening[]=[],upper:Opening[]=[],floorSamples:{kind:string;position:number[];height:number;width:number;ground:number[]}[]=[];
  const lowerTop=base+arcade;
  const recess=(x:number,w:number,kind:'arcade'|'service')=>{
    const ps=[-.48,0,.48].map(t=>point(x+w*t,0,.2)),grades=ps.map(p=>ground(p.x,p.z));
    const target=options.recessFloorHeight?Math.max(...ps.map(p=>options.recessFloorHeight!(p.x,p.z))):Math.max(base,...grades.map(y=>y+.055));
    if(!Number.isFinite(target)||target>lowerTop-1.65||target<base-1)throw new Error(`Unsupported Welch middle ${kind} floor ${target}`);
    const crown=kind==='service'?lowerTop-.40:lowerTop-.58;
    const rise=Math.min(kind==='service'?.38:.46,(crown-target)*.18);
    lower.push({x,w,bottom:target,h:crown-target,rise,kind});
    floorSamples.push({kind,position:point(x,target,0).toArray(),height:target,width:w,ground:grades});
  };
  for(const x of plan.ordinaryLowerCenters)recess(x,plan.ordinaryLowerWidth,'arcade');
  recess(plan.serviceOpening.center,plan.serviceOpening.width,'service');
  recess(plan.northLowerOpening.center,plan.northLowerOpening.width,'arcade');
  const upperPitch=length/plan.upperBays;
  for(let row=0;row<3;row++)for(let i=0;i<plan.upperOrdinaryBays;i++)upper.push({x:(i+.5)*upperPitch,w:1.24,bottom:lowerTop+row*story+.025,h:windowHeight,rise:0,kind:'upper'});
  // Narrow vertical glazing marks the modern/historic join in L001/L002. Width
  // and exact last-bay location are estimates; the historic facade is untouched.
  upper.push({x:length-upperPitch*.5,w:plan.transitionGlazingWidth,bottom:lowerTop+.025,h:eave-lowerTop-.54,rise:0,kind:'connector'});
  const aperture=(o:Opening)=>{
    const p=new T.Path(),x0=o.x-o.w/2,x1=o.x+o.w/2,y1=o.bottom+o.h;
    p.moveTo(x0,o.bottom);p.lineTo(x0,y1-o.rise);
    if(o.rise)p.quadraticCurveTo(o.x,y1+o.rise,x1,y1-o.rise);else p.lineTo(x1,y1);
    p.lineTo(x1,o.bottom);p.closePath();return p;
  };
  const bottom=Math.min(base-.25,...Array.from({length:18},(_,i)=>{const p=point(length*i/17,0,.2);return ground(p.x,p.z)-.3;}));
  const wall=(lo:number,hi:number,openings:Opening[],depth:number,m:T.MeshStandardMaterial)=>{
    const s=new T.Shape([new T.Vector2(0,lo),new T.Vector2(length,lo),new T.Vector2(length,hi),new T.Vector2(0,hi)]);
    for(const o of openings)s.holes.push(aperture(o));
    add(new T.ExtrudeGeometry(s,{depth,steps:1,bevelEnabled:false,curveSegments:10}).translate(0,0,-depth),m);
  };
  wall(bottom,lowerTop,lower,1.12,stone);wall(lowerTop,eave-.28,upper,.56,brick);
  for(const o of [...lower,...upper]){
    const isLower=o.kind==='arcade'||o.kind==='service',depth=isLower?1.15:.60;
    add(new T.ShapeGeometry(new T.Shape(aperture(o).getPoints(12)),12).translate(0,0,-depth),glass);
    const h=o.h-o.rise,cy=o.bottom+h/2;
    for(const sign of[-1,1])box(o.x+sign*(o.w/2-.044),cy,-depth+.055,.062,h,.065,frame);
    for(const y of[o.bottom+.03,o.bottom+h-.03])box(o.x,y,-depth+.055,o.w-.08,.06,.065,frame);
    if(o.kind==='upper'){
      box(o.x,o.bottom+.58,-depth+.06,o.w-.08,.043,.07,frame);
      box(o.x,o.bottom+o.h+.035+headHeight/2,.017,o.w+.08,headHeight,.035,trim);
      box(o.x,o.bottom-.036,.035,o.w+.11,.072,.11,trim);
    }else if(o.kind==='connector'){
      for(let i=1;i<9;i++)box(o.x,o.bottom+o.h*i/9,-depth+.06,o.w-.08,.052,.065,frame);
      box(o.x,cy,-depth+.065,.052,h,.075,frame);
    }else{
      const panes=o.kind==='service'?5:2;
      for(let i=1;i<panes;i++)box(o.x-o.w/2+o.w*i/panes,cy,-depth+.06,.052,h,.065,frame);
      box(o.x,o.bottom+h*.76,-depth+.06,o.w-.08,.055,.075,frame);
      // Each closed recess has a solid stone floor, preventing an unsupported
      // pocket. It remains a closed facade; no doorway/route claims are made.
      box(o.x,o.bottom-.055,-.54,o.w-.10,.11,1.20,trim);
      for(const t of[-.32,.32])samples.push({kind:`${o.kind} recess floor`,origin:point(o.x+o.w*t,o.bottom+.6,-.54).toArray(),direction:[0,-1,0]});
    }
    probe(o.x-o.w*.24,o.bottom+o.h*.44,`${o.kind} recessed glazing`,isLower?3.2:2.75);
  }
  for(let row=1;row<3;row++)box((length-upperPitch)/2,lowerTop+row*story-.06,.016,length-upperPitch,.034,.038,joint);
  box(length/2,eave-.23,-.13,length,.18,.87,trim);
  box(length/2,eave-.09,-.24,length,.13,1.14,trim);
  // Closed, shallow triangular eave prism bridges into retained roof. It does
  // not leave a paper-thin floating sheet or alter the interior roof/courtyard.
  const d=plan.roofStripDepth,outer=.34,y0=eave+.005,y1=y0+(d+outer)*plan.roofPitch;
  const cross=new T.Shape([new T.Vector2(-d,eave-.05),new T.Vector2(outer,eave-.05),new T.Vector2(outer,y0),new T.Vector2(-d,y1)]);
  // Extrude in local X by orienting the shape's (depth,height) frame explicitly.
  const roofG=new T.ExtrudeGeometry(cross,{depth:length,steps:1,bevelEnabled:false});
  const pp=roofG.attributes.position,nn=roofG.attributes.normal;
  for(let i=0;i<pp.count;i++){const x=pp.getX(i),y=pp.getY(i),z=pp.getZ(i),nx=nn.getX(i),ny=nn.getY(i),nz=nn.getZ(i);pp.setXYZ(i,length-z,y,x);nn.setXYZ(i,-nz,ny,nx);}
  // Proper rotation/translation retains the closed solid winding.
  add(roofG,roof);
  box(length/2,eave+.045,.33,length,.09,.115,roof);
  for(const x of[20.4,48.2,60.7])box(x,(base+eave-.18)/2,.08,.07,eave-base-.18,.075,joint);
  for(const x of[.27,length-.27,plan.serviceOpening.center-plan.serviceOpening.width/2-.2])probe(x,lowerTop+.5,'solid masonry pier');
  const cells=Math.ceil(length/3.8);
  for(let i=0;i<cells;i++){
    const a=length*i/cells,b=length*(i+1)/cells;
    const pts=[[a,-plan.cutDepth],[b,-plan.cutDepth],[b,fringe],[a,fringe]].map(([x,d])=>point(x,0,d));
    const center=pts.reduce((s,p)=>s.add(p),new T.Vector3()).multiplyScalar(.25);
    const low=Math.max(...pts.map(p=>ground(p.x,p.z)),ground(center.x,center.z))+plan.cutGroundBuffer;
    const planes=pts.map((a,j)=>{const b=pts[(j+1)%4],p=new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(b.z-a.z,0,a.x-b.x).normalize(),a);if(p.distanceToPoint(center)>0)p.negate();return p;});
    planes.push(new T.Plane(new T.Vector3(0,-1,0),low),new T.Plane(new T.Vector3(0,1,0),-ceiling));
    const bounds=new T.Box3().setFromPoints(pts);bounds.min.y=low;bounds.max.y=ceiling;volumes.push({planes,bounds});
  }
  for(const[m,parts]of batches){
    const flat=parts.map(g=>g.index?g.toNonIndexed():g),g=mergeGeometries(flat)!;g.computeBoundingBox();g.computeBoundingSphere();
    const mesh=new T.Mesh(g,m);mesh.name=`WEL middle east frontage: ${m.name}`;mesh.castShadow=mesh.receiveShadow=true;meshes.push(mesh);
    for(const part of new Set([...parts,...flat]))part.dispose();
  }
  return{meshes,materials,colliderGeometries:meshes.map(m=>m.geometry),volumes,candidateClearanceVolumes:volumes,samples,floorSamples,glassMaterial:glass,
    stats:{building:'WEL',scope:'68.217m modern Speedway gap only',length,base,eave,storyPitch:story,arcadeHeight:arcade,ordinaryArcades:lower.filter(o=>o.kind==='arcade').length,serviceRecesses:1,upperWindows:upper.filter(o=>o.kind==='upper').length,verticalConnectors:1,materialBatches:meshes.length,ownedMaterials:materials.length,triangles:meshes.reduce((n,m)=>n+m.geometry.attributes.position.count/3,0),cutVolumes:volumes.length,cutFringe:fringe,cutDepth:plan.cutDepth,cutCeiling:ceiling,sourcePhotoIds:plan.photoIds,lectureProjectionUnchanged:true,historicNorthUnchanged:true,southPackageUnchanged:true,routeGroundCreated:false,exactSurvey:false}};
}
