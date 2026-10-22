import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createCampusGlass } from './campus-glass';
import type { CutVolume } from './clip-volume';
import plan from './dkr-frontage-plan.json' with { type: 'json' };

export type DkrFrontageOptions = {
  /** Caller-owned existing sky. No reflection capture or texture loading here. */
  environment?: THREE.Texture | null;
  environmentIntensity?: number;
  /** World Y of the outer portal landing, not the player centre. */
  groundY?: number;
  /** Recess is usable only with its explicit, narrowly bounded source cut. */
  includePortal?: boolean;
};

/** Read-only ray registration of the retained west wall, in campus metres. */
export function dkrWallX(z: number) {
  const p = plan.wallRegistration;
  let i = 1;
  while (i < p.length - 1 && z > p[i][0]) i++;
  const a = p[i - 1], b = p[i];
  return a[1] + (b[1] - a[1]) * (z - a[0]) / (b[0] - a[0]);
}

function concreteMaterial(aggregate = false) {
  const material = new THREE.MeshStandardMaterial({
    color: aggregate ? 0x96978e : 0xc6c3b4,
    roughness: aggregate ? .96 : .87,
  });
  material.name = aggregate ? 'DKR exposed aggregate infill' : 'DKR warm pale concrete';
  material.onBeforeCompile = shader => {
    for (const token of ['#include <color_fragment>', '#include <normal_fragment_maps>'])
      if (!shader.fragmentShader.includes(token)) throw new Error('DKR concrete requires installed Three shader chunks');
    if (!shader.vertexShader.includes('#include <begin_vertex>')) throw new Error('DKR concrete requires metric coordinates');
    shader.vertexShader = 'varying vec3 vDkrMetres;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvDkrMetres=position;');
    shader.fragmentShader = `varying vec3 vDkrMetres;
      float dkrHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float dkrNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(dkrHash(i),dkrHash(i+vec2(1,0)),f.x),mix(dkrHash(i+vec2(0,1)),dkrHash(i+vec2(1,1)),f.x),f.y);}
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec2 dkrP=vec2(vDkrMetres.z,vDkrMetres.y);
      float dkrFoot=max(max(fwidth(dkrP.x),fwidth(dkrP.y)),.0001);
      float dkrFineFade=1.-smoothstep(.002,.018,dkrFoot);
      float dkrFine=dkrNoise(dkrP*${aggregate ? '110.' : '210.'})-.5;
      float dkrCloud=dkrNoise(dkrP*vec2(2.1,.48))-.5;
      float dkrJoint=1.-smoothstep(.002,.002+dkrFoot,min(fract((dkrP.y+8.65)/3.),1.-fract((dkrP.y+8.65)/3.))*3.);
      diffuseColor.rgb*=1.+dkrCloud*.065+dkrFine*${aggregate ? '.20' : '.06'}*dkrFineFade-dkrJoint*.055;
      float dkrHeight=dkrFine*${aggregate ? '.0017' : '.00025'}*dkrFineFade;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      vec3 dkrDx=dFdx(-vViewPosition),dkrDy=dFdy(-vViewPosition),dkrR1=cross(dkrDy,normal),dkrR2=cross(normal,dkrDx);
      float dkrDet=dot(dkrDx,dkrR1)*faceDirection;
      if(abs(dkrDet)>1e-10)normal=normalize(abs(dkrDet)*normal-sign(dkrDet)*(dFdx(dkrHeight)*dkrR1+dFdy(dkrHeight)*dkrR2));
    `);
  };
  material.customProgramCacheKey = () => `dkr-west-concrete-v1-${aggregate}`;
  return material;
}

/** Five real Bellmont west bays. UT GIS supplies the six pier locations and
 * 9.43–9.56 m bay spacing. Local ray samples register the curved facade. Height,
 * fin depth and the one reconstructed stair entrance are documented estimates.
 * The upper stadium, other facades and foreground trees are never replaced.
 */
export function buildDkrFrontage(options: DkrFrontageOptions = {}) {
  const groundY = options.groundY ?? plan.groundY;
  const includePortal = options.includePortal ?? false;
  const intensity = options.environmentIntensity ?? 1.3;
  if (!Number.isFinite(groundY) || groundY < -10 || groundY > -7 || !Number.isFinite(intensity) || intensity < 0 || intensity > 4)
    throw new Error('Invalid DKR frontage calibration');
  const materials = {
    concrete: concreteMaterial(), aggregate: concreteMaterial(true),
    glass: createCampusGlass({name:'DKR west blue-sky glazing', envMap:options.environment, envMapIntensity:intensity, roughness:.085, ior:1.55, interiorLevel:.007}),
    shadow: new THREE.MeshStandardMaterial({color:0x343834, roughness:.97}),
    metal: new THREE.MeshStandardMaterial({color:0x56605d, metalness:.62, roughness:.32}),
    orange: new THREE.MeshStandardMaterial({color:0xa54b20, roughness:.75}),
    ivory: new THREE.MeshStandardMaterial({color:0xeee9dd, roughness:.75}),
  };
  materials.shadow.name='DKR shaded entrance soffit';materials.metal.name='DKR dark bronze mullions';
  materials.orange.name='DKR gate-four burnt-orange wayfinding';materials.ivory.name='DKR gate-four lettering';
  const parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const colliderParts: THREE.BufferGeometry[] = [];
  const ownedGeometries = new Set<THREE.BufferGeometry>();
  const featureCounts = {piers:0,fins:0,glazedBays:0,windowPanes:0,stairRisers:0,handrails:0};
  // Local axes: u is campus south/Z; v is depth/east/X behind the wall. Map
  // every point through the measured curved wall; recompute flat face normals.
  const point = (u:number,y:number,v:number) => new THREE.Vector3(dkrWallX(u)+v,groundY+y,u);
  const mapGeometry = (g:THREE.BufferGeometry) => {
    if(g.index){const indexed=g;g=g.toNonIndexed();indexed.dispose();}
    // Swapping local U/V into campus Z/X reverses handedness. Reverse each
    // triangle once, including UVs, so visible and collider normals stay outward.
    for(const attribute of Object.values(g.attributes))for(let i=0;i<attribute.count;i+=3)for(let k=0;k<attribute.itemSize;k++){
      const a=attribute.getComponent(i+1,k);attribute.setComponent(i+1,k,attribute.getComponent(i+2,k));attribute.setComponent(i+2,k,a);
    }
    const p=g.attributes.position;
    for(let i=0;i<p.count;i++){
      const q=point(p.getX(i),p.getY(i),p.getZ(i));p.setXYZ(i,q.x,q.y,q.z);
    }
    g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();return g;
  };
  const add=(g:THREE.BufferGeometry,mat:THREE.Material,collision=false)=>{
    g=mapGeometry(g);if(!parts.has(mat))parts.set(mat,[]);parts.get(mat)!.push(g);
    if(collision)colliderParts.push(g);return g;
  };
  const box=(u:number,y:number,v:number,w:number,h:number,d:number,mat:THREE.Material,collision=false)=>{
    const g=new THREE.BoxGeometry(w,h,d);g.translate(u,y,v);return add(g,mat,collision);
  };
  // Extrude a bevelled Y/depth profile across a fin or hood width. This is a
  // real solid wedge with end caps, not shading painted on a rectangular wall.
  const wedge=(u:number,w:number,profile:readonly(readonly[number,number])[],mat:THREE.Material,collision=false)=>{
    const pos:number[]=[];const tri=(a:number[],b:number[],c:number[])=>pos.push(...a,...b,...c);
    const a=profile.map(([y,v])=>[u-w/2,y,v]),b=profile.map(([y,v])=>[u+w/2,y,v]);
    let area=0;for(let i=0;i<profile.length;i++){const j=(i+1)%profile.length;area+=profile[i][0]*profile[j][1]-profile[j][0]*profile[i][1];}
    // Polygon profile is normalized counterclockwise in the Y/V plane.
    if(area<0){a.reverse();b.reverse();}
    for(let i=1;i<a.length-1;i++){tri(a[0],a[i+1],a[i]);tri(b[0],b[i],b[i+1]);}
    for(let i=0;i<a.length;i++){const j=(i+1)%a.length;tri(a[i],a[j],b[j]);tri(a[i],b[j],b[i]);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(pos.flatMap((_,i)=>i%3===0?[pos[i],pos[i+1]]:[]),2));
    return add(g,mat,collision);
  };
  const cylinderBetween=(a:THREE.Vector3,b:THREE.Vector3,radius:number,mat:THREE.Material)=>{
    const d=b.clone().sub(a),g=new THREE.CylinderGeometry(radius,radius,d.length(),8);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),d.clone().normalize()));g.translate(...a.clone().add(b).multiplyScalar(.5).toArray());
    return add(g,mat);
  };
  const portalIndex=plan.portalBay,portalLeft=plan.piers[portalIndex].z,portalRight=plan.piers[portalIndex+1].z;
  const centre=(portalLeft+portalRight)/2,halfWidth=plan.portalWidth/2;
  for(const pier of plan.piers){
    const w=pier.width;
    // I-shaped UT polygon: twin projecting cheeks with recessed centre web.
    box(pier.z,(plan.levels.top-.65)/2,-.34,w,plan.levels.top+.65,.59,materials.concrete,true);
    box(pier.z-w*.34,(plan.levels.top-.65)/2,-.78,w*.28,plan.levels.top+.65,.59,materials.concrete,true);
    box(pier.z+w*.34,(plan.levels.top-.65)/2,-.78,w*.28,plan.levels.top+.65,.59,materials.concrete,true);
    featureCounts.piers++;
  }
  for(let i=0;i<plan.piers.length-1;i++){
    const left=plan.piers[i].z+plan.piers[i].width/2,right=plan.piers[i+1].z-plan.piers[i+1].width/2;
    const u=(left+right)/2,w=right-left;
    const bayIsPortal=includePortal&&i===portalIndex;
    // Thin forward-facing sheets cover only this measured wall. They never
    // enclose the whole building or change its actual stadium silhouette.
    box(u,7.45,-.10,w,5.4,.10,materials.concrete);
    box(u,(plan.levels.finsTop+plan.levels.finsBottom)/2,-.095,w,plan.levels.finsTop-plan.levels.finsBottom,.10,materials.aggregate);
    for(let j=0;j<12;j++){
      const at=left+(j+.5)*w/12;
      wedge(at,.19,[[plan.levels.finsBottom,-.14],[plan.levels.finsTop,-.14],[plan.levels.finsTop,-.81],[plan.levels.finsBottom+.48,-.81]],materials.concrete);
      // Intermittent narrow upper blue slots sit between the real fins.
      if(j%2===1){box(at+w/24,18.7,-.16,.20,2.85,.035,materials.glass);featureCounts.windowPanes++;}
      featureCounts.fins++;
    }
    const ry=(plan.levels.ribbonBottom+plan.levels.ribbonTop)/2,rh=plan.levels.ribbonTop-plan.levels.ribbonBottom;
    box(u,ry,-.205,w-.46,rh,.035,materials.glass);
    for(let j=0;j<=6;j++)box(left+.23+j*(w-.46)/6,ry,-.26,.065,rh,.085,materials.metal);
    wedge(u,w,[[plan.levels.ribbonTop,-.15],[plan.levels.ribbonTop+.35,-.15],[plan.levels.ribbonTop+.35,-.7],[plan.levels.ribbonTop+.17,-.7]],materials.concrete);
    box(u,plan.levels.ribbonBottom-.10,-.40,w,.20,.62,materials.concrete);
    featureCounts.windowPanes+=6;
    if(!bayIsPortal){
      // A low plinth and buried pier feet accommodate the observed street
      // crossfall without inventing a new level sidewalk for the five bays.
      box(u,-.19,-.20,w,.82,.26,materials.concrete,true);
      box(u,2.39,-.115,w-.22,4.58,.045,materials.glass,true);
      for(let j=0;j<=6;j++)box(left+.11+j*(w-.22)/6,2.39,-.22,.070,4.58,.17,materials.metal);
      for(let j=0;j<=4;j++)box(u,.1+j*4.58/4,-.22,w-.22,.065,.17,materials.metal);
      // Narrow reveals establish an actual shadow edge at walking height.
      box(left+.05,2.39,-.35,.10,4.78,.59,materials.concrete,true);
      box(right-.05,2.39,-.35,.10,4.78,.59,materials.concrete,true);
      featureCounts.windowPanes+=24;featureCounts.glazedBays++;
    }
  }
  const candidateClearanceVolumes:CutVolume[]=[];
  const portalRecord={enabled:includePortal,centreZ:centre,width:plan.portalWidth,depth:plan.portalDepth,groundY,rise:plan.portalRise,riserCount:plan.riserCount,doorDepth:plan.portalDepth-.32,landingFrontDepth:-.10};
  if(includePortal){
    const w=plan.portalWidth,depth=plan.portalDepth,h=plan.portalHeight;
    // Full enclosure: floors, eight solid treads, side walls, ceiling and closed
    // rear doors. Render geometry also supplies the corresponding Rapier floor.
    box(centre,-.14,depth/2-.09,w,.28,depth+.18,materials.concrete,true);
    box(centre-w/2-.14,h/2,depth/2,.28,h,depth,materials.concrete,true);
    box(centre+w/2+.14,h/2,depth/2,.28,h,depth,materials.concrete,true);
    box(centre,h+.14,depth/2,w+.56,.28,depth,materials.shadow,true);
    const stepStart=.38,rise=plan.portalRise/plan.riserCount;
    for(let j=0;j<plan.riserCount;j++){
      const top=(j+1)*rise,v0=stepStart+j*plan.tread,v1=stepStart+(j+1)*plan.tread;
      box(centre,top/2,(v0+v1)/2,w,top,v1-v0,materials.concrete,true);featureCounts.stairRisers++;
      box(centre,top-.022,v0+.018,w,.018,.035,materials.shadow,false);
    }
    const landingStart=stepStart+plan.riserCount*plan.tread,doorV=portalRecord.doorDepth;
    box(centre,plan.portalRise/2,(landingStart+depth)/2,w,plan.portalRise,depth-landingStart,materials.concrete,true);
    box(centre,(plan.portalRise+h)/2,doorV,w,h-plan.portalRise,.10,materials.glass,true);
    for(let j=0;j<=6;j++)box(centre-w/2+j*w/6,(plan.portalRise+h)/2,doorV-.12,.075,h-plan.portalRise,.18,materials.metal,false);
    for(const y of [plan.portalRise,plan.portalRise+2.38,h])box(centre,y,doorV-.12,w,.085,.18,materials.metal,false);
    for(let j=0;j<6;j++)box(centre-w/2+(j+.8)*w/6,plan.portalRise+1.08,doorV-.25,.04,.45,.08,materials.ivory,false);
    // Handrails sit wholly inside side margins, leaving a broad clear route.
    for(const side of [-1,1]){
      const u=centre+side*(w/2-.42);
      for(const v of [.40,1.52,2.80]){
        const y=Math.min(plan.portalRise,Math.max(0,(v-stepStart)/plan.tread)*rise);
        cylinderBetween(new THREE.Vector3(u,y+.04,v),new THREE.Vector3(u,y+.95,v),.032,materials.metal);
      }
      cylinderBetween(new THREE.Vector3(u,.95,.40),new THREE.Vector3(u,plan.portalRise+.95,.38+plan.riserCount*plan.tread),.037,materials.metal);featureCounts.handrails++;
    }
    // Convex subdivisions follow the measured wall, not one campus-wide box.
    // Only the portal enclosure is removed from source. Top >= 5m remains scan.
    const us=[centre-halfWidth-.29,centre,centre+halfWidth+.29];
    for(let i=0;i<us.length-1;i++){
      const a=us[i],b=us[i+1],slope=(dkrWallX(b)-dkrWallX(a))/(b-a);
      const at=(z:number,v:number)=>new THREE.Vector3(dkrWallX(a)+(z-a)*slope+v,0,z);
      const front=-.16,back=depth+.06,low=groundY-.29,high=groundY+h+.29;
      const points=[at(a,front),at(a,back),at(b,front),at(b,back)];
      const bounds=new THREE.Box3().setFromPoints(points);bounds.min.y=low;bounds.max.y=high;
      const westN=new THREE.Vector3(-1,0,slope).normalize(),eastN=westN.clone().negate();
      const planes=[new THREE.Plane().setFromNormalAndCoplanarPoint(westN,at(a,front)),new THREE.Plane().setFromNormalAndCoplanarPoint(eastN,at(a,back)),
        new THREE.Plane(new THREE.Vector3(0,0,-1),a),new THREE.Plane(new THREE.Vector3(0,0,1),-b),new THREE.Plane(new THREE.Vector3(0,-1,0),low),new THREE.Plane(new THREE.Vector3(0,1,0),-high)];
      candidateClearanceVolumes.push({planes,bounds});
    }
  }
  // Vector gate-four marker: flat signage, not a facade photograph/texture.
  const markerU=portalRight-.10;
  box(markerU,2.8,-1.10,.43,.80,.045,materials.orange);
  // The numeral 4 is three strokes. Small geometry shares existing batches.
  box(markerU-.075,2.90,-1.14,.035,.26,.012,materials.ivory);
  box(markerU+.055,2.77,-1.14,.035,.43,.012,materials.ivory);
  box(markerU-.01,2.77,-1.14,.18,.035,.012,materials.ivory);

  const meshes:THREE.Mesh[]=[];
  for(const [material,geometries] of parts){
    const merged=mergeGeometries(geometries,false)!;ownedGeometries.add(merged);
    const mesh=new THREE.Mesh(merged,material);mesh.name=material.name;mesh.castShadow=true;mesh.receiveShadow=true;meshes.push(mesh);
  }
  // Merge the identical solid triangles, rather than substitute bounding boxes
  // that would block the recess or float the player above the staircase.
  const colliderGeometry=mergeGeometries(colliderParts,false)!;ownedGeometries.add(colliderGeometry);
  const colliderGeometries=[colliderGeometry];
  for(const geometries of parts.values())for(const g of geometries)g.dispose();
  const group=new THREE.Group();group.name='DKR Bellmont five-bay west frontage';group.add(...meshes);
  const bounds=new THREE.Box3().setFromObject(group);
  const stats={...featureCounts,bays:5,triangles:meshes.reduce((n,m)=>n+m.geometry.attributes.position.count/3,0),batches:meshes.length,colliderTriangles:colliderGeometry.attributes.position.count/3,ownedGeometries:ownedGeometries.size,ownedMaterials:Object.keys(materials).length,ownedTextures:0,borrowedTextures:options.environment?1:0,sourceCutVolumes:candidateClearanceVolumes.length};
  let disposed=false;
  const dispose=()=>{if(disposed)return;disposed=true;group.removeFromParent();for(const g of ownedGeometries)g.dispose();for(const mat of Object.values(materials))mat.dispose();};
  return{group,meshes,materials,colliderGeometries,candidateClearanceVolumes,portal:portalRecord,bounds,stats,dispose};
}
