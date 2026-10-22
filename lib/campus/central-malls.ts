import * as T from 'three';
import { speedwayMallEdgeHeight } from './speedway-mall-edge';
import { calibrateEastMallMaterials } from './central-mall-materials';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import planData from '../../public/data/central-mall-plan.json' with { type: 'json' };
import westData from '../../public/data/west-mall-plan.json' with { type: 'json' };
import type { Point } from './types';
import type { CutVolume } from './clip-volume';
import type { TreePlacement, HedgePlacement } from './foreground-trees';
import { tagGroundTieIn } from './ground/tag';

type Area = { name: string; rings: Point[][]; profile: string; eastX?: number; westX?: number };
type Stair = { sourceId: number; a: Point; b: Point; width: number; low: number; high: number; count: number };
type MallPlan = { areas: Area[]; stairs: Stair[]; clearance: Point[][][]; gardens: Point[][][] };
const eastPlan = planData as unknown as MallPlan;
const westPlan = westData as unknown as MallPlan & { beds: Point[][][]; eastGardenRemainder: Point[][][] };
const plan: MallPlan = { areas:[...eastPlan.areas,...westPlan.areas], stairs:[...eastPlan.stairs,...westPlan.stairs],
  clearance:[...eastPlan.clearance,...westPlan.clearance], gardens:[...westPlan.eastGardenRemainder,...westPlan.gardens] };
function insideRing(x: number, z: number, ring: Point[]) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}
function inside(x: number, z: number, rings: Point[][]) {
  return insideRing(x, z, rings[0]) && !rings.slice(1).some((ring) => insideRing(x, z, ring));
}
export function inCentralMall(x: number, z: number) {
  return plan.clearance.some((rings) => inside(x, z, rings));
}
function sample(knots: Point[], x: number) {
  if (x >= knots[0][0]) return knots[0][1];
  for (let i = 1; i < knots.length; i++) {
    const a = knots[i - 1], b = knots[i];
    if (x >= b[0]) return T.MathUtils.lerp(a[1], b[1], (x - a[0]) / (b[0] - a[0]));
  }
  return knots.at(-1)![1];
}
function fittedPlane(points: [number, number, number][]) {
  const p = new T.Plane().setFromCoplanarPoints(...points.map((v) => new T.Vector3(...v)) as [T.Vector3, T.Vector3, T.Vector3]);
  return (x: number, z: number) => -(p.normal.x * x + p.normal.z * z + p.constant) / p.normal.y;
}
function triangulate(rings: Point[][]) {
  const contours = rings.map((ring) => ring.map((p) => new T.Vector2(...p)));
  const points = contours.flat();
  return T.ShapeUtils.triangulateShape(contours[0], contours.slice(1))
    .map((ids) => ids.map((i) => points[i]) as [T.Vector2, T.Vector2, T.Vector2]);
}
export function buildCentralMalls(corridorHeight: (x: number, z: number) => number,
  terrainHeight: (x: number, z: number) => number, concrete: T.MeshStandardMaterial, grass: T.MeshStandardMaterial) {
  const materials: T.MeshStandardMaterial[] = [];
  function material(name: string, color: number, roughness = 1, metalness = 0) {
    const m = new T.MeshStandardMaterial({ name, color, roughness, metalness }); materials.push(m); return m;
  }
  // Names identify finishes in checks (stairs, walls and planter curbs are
  // intentional steps; paving and lawn edges are graded to the terrain).
  const aggregate = material('East Mall aggregate paving', 0xb6b4ab), stone = material('East Mall limestone walls and steps', 0xdad3bf, .93);
  const westAggregate = material('West Mall aggregate paving', 0xa59f90), westStone = material('West Mall limestone stairs, walls and bed curbs', 0xc7bea7,.94);
  const metal = material('Mall lamp and rail metal', 0x393d3b, .57, .65), steel = material('East Mall perforated steel spheres', 0xa2a6a4, .45, .72);
  const globe = material('Mall lamp globe', 0xe5e5d6, .34), orange = material('Mall lamp banner', 0xad502a, .8), soil = material('Mall tree pit mulch', 0x50422f);
  aggregate.map = concrete.map; stone.map = concrete.map;
  function detail(m: T.MeshStandardMaterial, masonry: boolean) {
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = 'varying vec2 mallUv;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nmallUv=uv*2.0;');
      shader.fragmentShader = 'varying vec2 mallUv;\nfloat mallHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\n' + shader.fragmentShader;
      // Use the existing map's luminance as restrained weathering. Multiplying
      // its brown/green color by a tint made the pale reference stone look mossy.
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec4 mallSample=texture2D(map,vMapUv);
          float mallTone=dot(mallSample.rgb,vec3(.2126,.7152,.0722));
          diffuseColor.rgb*=mix(${masonry ? '.94,1.04' : '.83,1.08'},smoothstep(.08,.65,mallTone));
          diffuseColor.a*=mallSample.a;
        #endif`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', masonry ? `#include <color_fragment>
        vec2 cell=vec2(mallUv.x/.72+mod(floor(mallUv.y/.30),2.0)*.5,mallUv.y/.30);
        vec2 edge=min(fract(cell),1.0-fract(cell))*vec2(.72,.30);
        float joint=1.0-smoothstep(.002,.002+max(fwidth(mallUv.x),fwidth(mallUv.y)),min(edge.x,edge.y));
        diffuseColor.rgb*= (.96+mallHash(floor(cell))*.08)*(1.0-joint*.22);` : `#include <color_fragment>
        vec2 cell=floor(mallUv*115.0);float grain=mallHash(cell);
        float fade=1.0-smoothstep(.003,.018,max(fwidth(mallUv.x),fwidth(mallUv.y)));
        diffuseColor.rgb*=mix(1.0,.90+grain*.20,fade);
        vec2 slab=min(fract(mallUv/3.2),1.0-fract(mallUv/3.2))*3.2;
        float joint=1.0-smoothstep(.0015,.0015+max(fwidth(mallUv.x),fwidth(mallUv.y)),min(slab.x,slab.y));
        diffuseColor.rgb*=1.0-joint*.12;`);
    };
    m.customProgramCacheKey = () => masonry ? 'central-mall-limestone-v2' : 'central-mall-aggregate-v2';
  }
  detail(aggregate, false); detail(stone, true);
  westAggregate.map=concrete.map; westStone.map=concrete.map;
  detail(westAggregate,false); detail(westStone,true);
  calibrateEastMallMaterials(aggregate, stone);
  // Round 2b (b04): Main/South Mall finishes of their own, so East Mall tuning is untouched.
  // Reference: accepted overview b04-r0-b2 (pale warm tan forecourt vs mid-green lawns) and
  // the Daderot 2015 CC0 photograph (pale slabs, pale grey drive/sidewalks). No pixels used.
  const mainPaving = material('Main Mall pale limestone paving', 0xd3c6aa, .96);
  const mallWalk = material('South Mall pale concrete walks', 0xbdb9ae, .97);
  for (const [m, slabU, slabV, key] of [[mainPaving, 1.8, 1.8, 'main-mall-paving-v1'], [mallWalk, 1.5, 3.0, 'south-mall-walk-v1']] as const) {
    m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -2;
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = 'varying vec3 mmWorld;\n' + shader.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nmmWorld=(modelMatrix*vec4(transformed,1.0)).xyz;');
      shader.fragmentShader = 'varying vec3 mmWorld;\nfloat mmHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\n' + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        vec2 mmCell=mmWorld.xz/vec2(${slabU.toFixed(2)},${slabV.toFixed(2)});
        vec2 mmEdge=min(fract(mmCell),1.0-fract(mmCell))*vec2(${slabU.toFixed(2)},${slabV.toFixed(2)});
        float mmAa=max(fwidth(mmWorld.x),fwidth(mmWorld.z))+.0001;
        float mmJoint=1.0-smoothstep(.006,.006+mmAa,min(mmEdge.x,mmEdge.y));
        // restrained slab-to-slab variation and joints (no checkerboard contrast)
        diffuseColor.rgb*=(.975+.05*mmHash(floor(mmCell)))*(1.0-mmJoint*.10*(1.0-smoothstep(.02,.12,mmAa)));`);
    };
    m.customProgramCacheKey = () => key;
  }
  // Source-supported grade, with small noisy scan samples fitted monotonically.
  const eastKnots: Point[] = [[-14,3.072],[-20,4.115],[-24,4.48],[-28,4.59],[-32,4.892],
    [-40,5.98],[-48,6.653],[-56,7.346],[-64,8.587],[-70,9.40],[-78,9.41],[-86,9.718],[-92.445,10.217]];
  const eastHeight = (x: number, z: number) => {
    const join = corridorHeight(x,z);
    const y = sample(eastKnots,x);
    return T.MathUtils.lerp(join,y,T.MathUtils.smoothstep(-x,12,25));
  };
  const lowerWall = fittedPlane([[-115.227,13.836,52.92],[-122.6,15.269,58.308],[-121.62,14.720,45.815]]);
  const upperCourt = fittedPlane([[-122.84,16.055,61.334],[-121.35,16.267,42.256],[-136.952,16.336,50.659]]);
  const upperWalk = (x: number) => sample([[-136.952,16.336],[-147.795,16.349],[-158.484,16.348],[-165.386,16.604]],x);
  const tower = (x: number) => 18.52 - .473 * Math.exp(-Math.max(0,-169.154-x)/4);
  // Contour-informed approximation in a coordinate parallel to West Mall.
  // The Tower top matches the previously verified terrace exactly. These fitted
  // grades are not surveyed step heights; keep them explicit for later revision.
  const westAxis=(x:number,z:number)=>-269.011+(x+269.011)*.99652+(z-39.208)*.08336;
  const westHeight=(x:number,z:number)=>sample([[-269.011,16.52],[-280,16.40],[-300,16.06],
    [-320,15.70],[-340,15.16],[-360,14.61],[-380,13.92],[-400,13.30],
    [westAxis(-411.903,26.527),12.80]],westAxis(x,z));
  const gateA=new T.Vector2(-413.893,26.36),gateB=new T.Vector2(-411.903,26.527),
    gateDirection=gateB.clone().sub(gateA),gateLength=gateDirection.length();gateDirection.normalize();
  const gatewayAlong=(x:number,z:number)=>new T.Vector2(x,z).sub(gateA).dot(gateDirection);
  const westLow=(x:number,z:number)=>12.20+Math.min(0,gatewayAlong(x,z))*.004;
  const frontageHeight=(x:number,z:number)=>{
    const base=terrainHeight(x,z)+.04;
    return T.MathUtils.lerp(westLow(x,z),base,T.MathUtils.smoothstep(20.308-z,0,30));
  };
  // Round 2 (b04): Main Mall plaza / paired lawns / drive crossing on the Main Building
  // axis, from the 2017 LiDAR ground profile (campus Y; axis origin = centre of the
  // Main Building south face). Treads of both flights are in plan.stairs.
  const mainMallKnots:Point[]=[[25.4,16.69],[28,16.65],[30,16.62],[34,16.55],[40,16.48],[46,16.38],[50,16.33],[54,16.26],
    [60,16.25],[64,16.23],[70,16.18],[74,16.13],[76.5,16.10],[80,14.66],[82,14.62],[86,14.47],[88,14.47],[90,14.53]];
  const mainMallAxis=(x:number,z:number)=>(x+217.36)*-0.08387655737226869+(z-36.64)*0.9964761528121866;
  const mainMallHeight=(x:number,z:number)=>{
    const t=mainMallAxis(x,z),k=mainMallKnots;
    if(t<=k[0][0])return k[0][1];
    for(let i=1;i<k.length;i++)if(t<=k[i][0])return T.MathUtils.lerp(k[i-1][1],k[i][1],(t-k[i-1][0])/(k[i][0]-k[i-1][0]));
    return k.at(-1)![1];
  };
  // The baked contour terrain is not cut by clearance volumes and smooths the real
  // steps (0.3-0.7 m off the LiDAR here). Never lay the plaza below it: the surface is
  // the LiDAR profile wherever that is above the terrain (shared request b04-r2-4 asks
  // ground/ to lower the terrain inside this clearance so the LiDAR profile applies).
  const mainMallSurface=(x:number,z:number)=>Math.max(mainMallHeight(x,z),terrainHeight(x,z)+.04);
  function profile(area: Area, x: number, z: number) {
    switch (area.profile) {
      case 'east': return eastHeight(x,z);
      case 'east-step': {
        // Twenty-one shallow risers plus graded landings. Exact historical
        // riser spacing is not resolved by the available reference photos.
        const f = T.MathUtils.clamp((area.eastX! - x)/(area.eastX! - area.westX!),0,1);
        return eastHeight(x,z) + .16 * (1-f);
      }
      case 'sphere-landing': return sample([[-96.607,11.464],[-111.392,12.920]],x);
      case 'lower-wall': return lowerWall(x,z);
      case 'upper-court': return upperCourt(x,z);
      case 'upper-walk': return upperWalk(x);
      case 'tower': return tower(x);
      case 'west': return westHeight(x,z);
      case 'west-low': return westLow(x,z);
      case 'west-gateway': return T.MathUtils.lerp(12.20,12.80,T.MathUtils.clamp(gatewayAlong(x,z)/gateLength,0,1));
      case 'union-frontage': return frontageHeight(x,z);
      case 'main-mall': return mainMallSurface(x,z);
      case 'main-mall-lawn': return mainMallSurface(x,z)+.02;
      // Head of the South Mall (round 2b): contour-following, just above the baked terrain.
      case 'south-mall-lawn': return terrainHeight(x,z)+.06;
      case 'south-mall-walk': return terrainHeight(x,z)+.08;
      default: throw new Error(`Unknown mall surface profile: ${area.profile}`);
    }
  }
  const stairRecords = plan.stairs.map((stair) => ({...stair}));
  // Main Mall flights (round 2): endpoints follow the plaza surface actually laid,
  // risers kept near the LiDAR 0.15 m (counts re-derived from the real rise).
  for(const stair of stairRecords){
    if(stair.sourceId===129733836)stair.low=mainMallSurface(...stair.a);
    else if(stair.sourceId===-40401){stair.high=mainMallSurface(...stair.b);stair.low=mainMallSurface(...stair.a);}
    else continue;
    stair.count=Math.max(2,Math.round((stair.high-stair.low)/.15));
  }
  function stairSides(stair: Stair, side: number) {
    const dx=stair.b[0]-stair.a[0], dz=stair.b[1]-stair.a[1], len=Math.hypot(dx,dz);
    const a: Point=[stair.a[0]+dz/len*side,stair.a[1]-dx/len*side];
    const b: Point=[stair.b[0]+dz/len*side,stair.b[1]-dx/len*side];
    if(stair.sourceId===126328787 || stair.sourceId===126328792) return [lowerWall(...a),upperCourt(...b)];
    return [stair.low,stair.high];
  }
  function stairHeight(stair: Stair, x: number, z: number) {
    const dx=stair.b[0]-stair.a[0],dz=stair.b[1]-stair.a[1],len=Math.hypot(dx,dz);
    const along=((x-stair.a[0])*dx+(z-stair.a[1])*dz)/len;
    const side=((x-stair.a[0])*dz-(z-stair.a[1])*dx)/len;
    const [low,high]=stairSides(stair,side);
    return T.MathUtils.lerp(low,high,Math.min(stair.count,Math.floor(Math.max(0,along)/len*stair.count)+1)/stair.count);
  }
  // Round-2 Main Mall areas/flights only influence the nearest-surface grade near
  // themselves (axis band), so soil/yards elsewhere (e.g. beside Garrison) keep their
  // previous grade exactly.
  const mainMallStair=(stair:Stair)=>stair.sourceId===129733836||stair.sourceId===-40401;
  const nearMainMall=(x:number,z:number)=>{const t=mainMallAxis(x,z),o=(x+217.36)*0.9964761528121866+(z-36.64)*0.08387655737226869;return t>15&&t<96&&Math.abs(o)<53;};
  const skipMainMall=(x:number,z:number,area?:Area,stair?:Stair)=>!nearMainMall(x,z)&&(area?area.profile.startsWith('main-mall'):stair?mainMallStair(stair):false);
  function nearestSurface(x: number, z: number) {
    let distance=Infinity, px=0, pz=0;
    let nearestArea:Area|undefined, nearestStair:Stair|undefined;
    for(const area of plan.areas) {
      if(skipMainMall(x,z,area))continue;
      if(inside(x,z,area.rings)) return {height:profile(area,x,z),distance:0};
      if(area.profile.startsWith('south-mall'))continue;
      for(const ring of area.rings) for(let i=0;i<ring.length;i++) {
        const a=ring[i],b=ring[(i+1)%ring.length],dx=b[0]-a[0],dz=b[1]-a[1];
        const t=T.MathUtils.clamp(((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz),0,1);
        const qx=a[0]+dx*t,qz=a[1]+dz*t,d=Math.hypot(x-qx,z-qz);
        if(d<distance){distance=d;px=qx;pz=qz;nearestArea=area;}
      }
    }
    for(const stair of stairRecords) {
      if(skipMainMall(x,z,undefined,stair))continue;
      const dx=stair.b[0]-stair.a[0],dz=stair.b[1]-stair.a[1],len=Math.hypot(dx,dz);
      const along=T.MathUtils.clamp(((x-stair.a[0])*dx+(z-stair.a[1])*dz)/len,0,len);
      const side=T.MathUtils.clamp(((x-stair.a[0])*dz-(z-stair.a[1])*dx)/len,-stair.width/2,stair.width/2);
      const qx=stair.a[0]+dx/len*along+dz/len*side,qz=stair.a[1]+dz/len*along-dx/len*side;
      const d=Math.hypot(x-qx,z-qz);
      if(d<distance){distance=d;px=qx;pz=qz;nearestStair=stair;}
    }
    // The search depends only on horizontal distance. Evaluate the expensive
    // elevation profile once, after the winning edge or stair is known.
    const height=nearestStair?stairHeight(nearestStair,px,pz):nearestArea?profile(nearestArea,px,pz):0;
    return {height,distance};
  }
  // Planting beds beside the east approach cross the nearest-surface regions
  // of several terraces. A winner-takes-all query creates metre-high cliffs at
  // those region boundaries. Blend nearby edge elevations for soil only; the
  // actual paving profiles and discrete stair heights remain authoritative.
  const yardHeightCache=new Map<string,number>();
  const approachInfluence=(x:number,z:number)=>T.MathUtils.smoothstep(x,-120,-116)
    *(1-T.MathUtils.smoothstep(x,-40,-28))*T.MathUtils.smoothstep(z,-2,14)
    *(1-T.MathUtils.smoothstep(z,78,86));
  const yardHeight=(x:number,z:number)=>{
    const key=`${x},${z}`,cached=yardHeightCache.get(key);
    if(cached!==undefined)return cached;
    const original=nearestSurface(x,z).height;
    const influence=approachInfluence(x,z);
    if(!influence)return original;
    const samples:{distance:number;height:number}[]=[];
    for(const area of plan.areas){
      if(skipMainMall(x,z,area))continue;
      if(inside(x,z,area.rings))return original;
      if(area.profile.startsWith('south-mall'))continue;
      let distance=Infinity,px=x,pz=z;
      for(const ring of area.rings)for(let i=0;i<ring.length;i++){
        const a=ring[i],b=ring[(i+1)%ring.length],dx=b[0]-a[0],dz=b[1]-a[1],length2=dx*dx+dz*dz;
        const t=length2?T.MathUtils.clamp(((x-a[0])*dx+(z-a[1])*dz)/length2,0,1):0;
        const qx=a[0]+dx*t,qz=a[1]+dz*t,d=Math.hypot(x-qx,z-qz);
        if(d<distance){distance=d;px=qx;pz=qz;}
      }
      samples.push({distance,height:profile(area,px,pz)});
    }
    for(const stair of stairRecords){
      if(skipMainMall(x,z,undefined,stair))continue;
      const dx=stair.b[0]-stair.a[0],dz=stair.b[1]-stair.a[1],len=Math.hypot(dx,dz);
      const along=T.MathUtils.clamp(((x-stair.a[0])*dx+(z-stair.a[1])*dz)/len,0,len);
      const side=T.MathUtils.clamp(((x-stair.a[0])*dz-(z-stair.a[1])*dx)/len,-stair.width/2,stair.width/2);
      const px=stair.a[0]+dx/len*along+dz/len*side,pz=stair.a[1]+dz/len*along-dx/len*side;
      samples.push({distance:Math.hypot(x-px,z-pz),height:stairHeight(stair,px,pz)});
    }
    samples.sort((a,b)=>a.distance-b.distance);
    // Preserve the existing seam immediately next to supported routes. The
    // blend is a landscape approximation, not a new surveyed ground dataset.
    if(samples[0].distance<.15)return original;
    let weight=0,height=0;
    for(const sample of samples){
      const w=1/Math.pow(sample.distance*sample.distance+.01,2);
      weight+=w;height+=sample.height*w;
    }
    const blend=influence*T.MathUtils.smoothstep(samples[0].distance,.15,1.5);
    const result=T.MathUtils.lerp(original,height/weight,blend);
    yardHeightCache.set(key,result);return result;
  };
  const gardenHeight=(x:number,z:number)=>{
    const nearest=nearestSurface(x,z);
    const height=yardHeight(x,z);
    const outer=T.MathUtils.clamp(terrainHeight(x,z),height-1.4,height+1.4);
    const original=T.MathUtils.lerp(height+.025,outer,T.MathUtils.smoothstep(nearest.distance,1.5,4.6));
    return speedwayMallEdgeHeight(x,z,original,corridorHeight);
  };
  // Graded ground surfaces batch apart from stairs, walls and furniture, so
  // only their outer edges receive terrain tie-ins (ground/tie-ins.ts).
  type Group='ground'|'stairs'|'other';
  const batches:Record<Group,Map<T.Material,T.BufferGeometry[]>>={ground:new Map(),stairs:new Map(),other:new Map()};
  function add(g:T.BufferGeometry,m:T.Material,group:Group='other') { const target=batches[group];if(!target.has(m))target.set(m,[]);target.get(m)!.push(g); }
  function surface(rings:Point[][],height:(x:number,z:number)=>number,m:T.Material,ground=true) {
    const positions:number[]=[],uv:number[]=[];
    // Adjacent triangles share vertices. Cache exact coordinates for this one
    // surface, with no rounding that could alter a step or a terrain join.
    const heights=new Map<number,Map<number,number>>();
    const vertexHeight=(x:number,z:number)=>{
      let row=heights.get(x);
      if(!row){row=new Map();heights.set(x,row);}
      let y=row.get(z);
      if(y===undefined){y=height(x,z);row.set(z,y);}
      return y;
    };
    function triangle(a:T.Vector2,b:T.Vector2,c:T.Vector2) {
      if(Math.max(a.distanceTo(b),b.distanceTo(c),c.distanceTo(a))>2.5) {
        const ab=a.clone().lerp(b,.5),bc=b.clone().lerp(c,.5),ca=c.clone().lerp(a,.5);
        triangle(a,ab,ca);triangle(ab,b,bc);triangle(ca,bc,c);triangle(ab,bc,ca);return;
      }
      const cross=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
      for(const p of cross>0?[a,c,b]:[a,b,c]){positions.push(p.x,vertexHeight(p.x,p.y),p.y);uv.push(p.x/2,p.y/2);}
    }
    for(const tri of triangulate(rings))triangle(...tri);
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));
    g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.computeVertexNormals();add(g,m,ground?'ground':'other');
  }
  function box(x:number,y:number,z:number,w:number,h:number,d:number,m:T.Material,angle=0) {
    const g=new T.BoxGeometry(w,h,d).rotateY(angle).translate(x,y,z),p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv;
    for(let i=0;i<p.count;i++)uv.setXY(i,(Math.abs(n.getX(i))>.5?p.getZ(i):p.getX(i))/2,(Math.abs(n.getY(i))>.5?p.getZ(i):p.getY(i))/2);
    add(g,m);
  }
  function tube(a:T.Vector3,b:T.Vector3,r:number,m:T.Material) {
    const delta=b.clone().sub(a),g=new T.CylinderGeometry(r,r,delta.length(),10);
    g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize()));
    g.translate(...a.clone().lerp(b,.5).toArray());add(g,m);
  }
  for(const area of plan.areas) {
    const finish=area.profile==='main-mall-lawn'||area.profile==='south-mall-lawn'?grass
      :area.name==='Main Mall plaza'||area.name.startsWith('South Mall statue apron')?mainPaving
      :area.name==='Main Mall drive crossing'||area.profile==='south-mall-walk'?mallWalk
      :area.profile.startsWith('west')||area.profile==='union-frontage'?westAggregate:aggregate;
    surface(area.rings,(x,z)=>profile(area,x,z),finish);
    if(area.profile==='east-step') for(const ring of area.rings) for(let i=0;i<ring.length;i++) {
      const a=ring[i],b=ring[(i+1)%ring.length];
      if(Math.abs(a[0]-area.eastX!)>.001 || Math.abs(b[0]-area.eastX!)>.001)continue;
      const length=Math.hypot(b[0]-a[0],b[1]-a[1]),count=Math.ceil(length);
      for(let j=0;j<count;j++){
        const p:Point=[T.MathUtils.lerp(a[0],b[0],j/count),T.MathUtils.lerp(a[1],b[1],j/count)];
        const q:Point=[T.MathUtils.lerp(a[0],b[0],(j+1)/count),T.MathUtils.lerp(a[1],b[1],(j+1)/count)];
        const positions=[p[0],eastHeight(...p)-.05,p[1],q[0],eastHeight(...q)-.05,q[1],
          p[0],profile(area,...p)+.012,p[1],q[0],profile(area,...q)+.012,q[1]];
        const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));
        g.setAttribute('uv',new T.Float32BufferAttribute([0,0,length/count/2,0,0,.11,length/count/2,.11],2));
        g.setIndex([0,1,2,1,3,2]);g.computeVertexNormals();add(g,aggregate,'stairs');
      }
    }
  }
  for(const rings of plan.gardens) surface(rings,gardenHeight,grass);
  // The legacy plan deliberately inset its planting boundary 15 mm from the
  // entry polygon. At this shared ground transition that leaves a literal ray
  // and visible-floor slit. Close only the existing southern entry seam, using
  // its measured plan endpoints; the majority remains under retained Speedway.
  surface([[[ -6.565,72.219 ],[ 0,72.8389 ],[ 0,72.8539 ],
    [ -.0014,72.8538 ],[ -6.5664,72.2339 ]]],corridorHeight,grass);
  // Seal the cut boundary below its surface. This prevents looking through the
  // world where contour ground and the coarse scan disagree; it is a temporary
  // soil skirt, not a claim that every edge is a surveyed retaining wall.
  for(const rings of plan.clearance)for(const ring of rings)for(let i=0;i<ring.length;i++) {
    const a=ring[i],b=ring[(i+1)%ring.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    const count=Math.max(1,Math.ceil(length/1.5));
    for(let j=0;j<count;j++){
      const p:Point=[T.MathUtils.lerp(a[0],b[0],j/count),T.MathUtils.lerp(a[1],b[1],j/count)];
      const q:Point=[T.MathUtils.lerp(a[0],b[0],(j+1)/count),T.MathUtils.lerp(a[1],b[1],(j+1)/count)];
      // Join adjacent independently authored repair polygons without a thin
      // vertical skirt crossing the walkable stair opening.
      const midpoint:Point=[(p[0]+q[0])/2,(p[1]+q[1])/2];
      if(plan.clearance.some(other=>other!==rings && inside(...midpoint,other)))continue;
      const g=new T.BufferGeometry();
      g.setAttribute('position',new T.Float32BufferAttribute([p[0],gardenHeight(...p)+(p[0]===0&&p[1]>=70&&p[1]<=80?0:.035),p[1],q[0],gardenHeight(...q)+(q[0]===0&&q[1]>=70&&q[1]<=80?0:.035),q[1],p[0],-4.04,p[1],q[0],-4.04,q[1]],3));
      g.setAttribute('uv',new T.Float32BufferAttribute([0,0,length/count/2,0,0,3,length/count/2,3],2));
      g.setIndex([0,2,1,1,2,3]);g.computeVertexNormals();add(g,grass);
    }
  }
  for(const stair of stairRecords) {
    const dx=stair.b[0]-stair.a[0],dz=stair.b[1]-stair.a[1],len=Math.hypot(dx,dz),angle=-Math.atan2(dz,dx);
    for(let i=0;i<stair.count;i++) {
      const t=(i+.5)/stair.count,top=T.MathUtils.lerp(stair.low,stair.high,(i+1)/stair.count),bottom=stair.low-.35;
      const g=new T.BoxGeometry(len/stair.count+.006,top-bottom,stair.width).rotateY(angle)
        .translate(stair.a[0]+dx*t,(top+bottom)/2,stair.a[1]+dz*t);
      const positions=g.attributes.position,uv=g.attributes.uv,n=g.attributes.normal;
      for(let k=0;k<positions.count;k++) {
        const x=positions.getX(k),z=positions.getZ(k),side=((x-stair.a[0])*dz-(z-stair.a[1])*dx)/len;
        const [low,high]=stairSides(stair,side);
        positions.setY(k,positions.getY(k)+T.MathUtils.lerp(low-stair.low,high-stair.high,(i+1)/stair.count));
        uv.setXY(k,x/2,Math.abs(n.getY(k))>.5?z/2:positions.getY(k)/2);
      }
      g.computeVertexNormals();add(g,westPlan.stairs.some(s=>s.sourceId===stair.sourceId)?westStone:mainMallStair(stair)?mainPaving:aggregate,'stairs');
    }
    // Flanking limestone walls, outside the full walkable stair width.
    if(stair.sourceId===129733858) {
      // The photographed Tower west flight has level coping and substantial
      // end piers, rather than a saw-toothed wall following every tread.
      for(const side of [-1,1]) {
        const offset=side*(stair.width/2+.35),x=(stair.a[0]+stair.b[0])/2+dz/len*offset,
          z=(stair.a[1]+stair.b[1])/2-dx/len*offset,low=stair.low-.3,top=stair.high+.83;
        box(x,(low+top)/2,z,len+.35,top-low,.60,westStone,angle);
        box(x,top+.06,z,len+.49,.12,.76,westStone,angle);
        const px=stair.a[0]+dz/len*offset,pz=stair.a[1]-dx/len*offset;
        box(px,(low+top)/2,pz,.90,top-low,.90,westStone,angle);
        box(px,top+.12,pz,1.06,.18,1.06,westStone,angle);
      }
    } else if(stair.width>10 && stair.sourceId!==130356116)for(const side of [-1,1]) for(let i=0;i<16;i++) {
      const t=(i+.5)/16,s=side*(stair.width/2+.22),x=stair.a[0]+dx*t+dz/len*s,z=stair.a[1]+dz*t-dx/len*s;
      const y=T.MathUtils.lerp(stair.low,stair.high,t);
      box(x,y+.42,z,len/16+.012,.94,.40,stone,angle);
    }
  }
  // Retain the real central barrier. Both mapped side flights remain the route
  // to the higher court instead of hiding the level change with a straight ramp.
  const wa:Point=[-124.734,41.004],wb:Point=[-126.561,62.564];
  const wd=new T.Vector3(wb[0]-wa[0],0,wb[1]-wa[1]),wl=wd.length(),wu=wd.clone().normalize();
  const wallAngle=-Math.atan2(wd.z,wd.x);
  for(let i=0;i<32;i++) {
    const t=(i+.5)/32,x=T.MathUtils.lerp(wa[0],wb[0],t),z=T.MathUtils.lerp(wa[1],wb[1],t);
    const high=upperCourt(x,z)+.16,low=lowerWall(x+1,z)-.25;
    box(x,(high+low)/2,z,wl/32+.015,high-low,.42,stone,wallAngle);
    if(t<.18 || t>.82)box(x,high+.47,z,wl/32+.015,.94,.46,stone,wallAngle);
  }
  for(let i=0;i<=26;i++) {
    const t=.18+.64*i/26,x=T.MathUtils.lerp(wa[0],wb[0],t),z=T.MathUtils.lerp(wa[1],wb[1],t),y=upperCourt(x,z)+.16;
    tube(new T.Vector3(x,y,z),new T.Vector3(x,y+.95,z),.021,metal);
  }
  const railA=new T.Vector3(wa[0],0,wa[1]).addScaledVector(wu,wl*.18),railB=railA.clone().addScaledVector(wu,wl*.64);
  railA.y=upperCourt(railA.x,railA.z)+1.11;railB.y=upperCourt(railB.x,railB.z)+1.11;tube(railA,railB,.035,metal);
  const spheres:Point[]=[[-103.2,51.9],[-103.5,54.6]];
  const sphereY=sample([[-96.607,11.464],[-111.392,12.920]],-103.3);
  box(-103.35,sphereY+.15,53.25,2.65,.3,6,stone,.09);
  steel.onBeforeCompile=(shader)=>{
    shader.vertexShader='varying vec2 sphereUv;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nsphereUv=uv;');
    shader.fragmentShader='varying vec2 sphereUv;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      vec2 cell=sphereUv*vec2(72.0,36.0);float d=length(fract(cell)-.5);
      if(d<.19)discard;`);
  };
  steel.customProgramCacheKey=()=> 'east-mall-paired-spheres-v1';
  for(const [x,z] of spheres)add(new T.SphereGeometry(1.12,48,32).translate(x,sphereY+1.42,z),steel);
  const lamps:Point[]=[[-30,70.5],[-52,68.5],[-83,64.8],[-103,61.8],[-132,65.8],[-139,39],[-162,39.3]];
  for(const [x,z] of lamps) {
    const y=nearestSurface(x,z).height;
    box(x,y+.08,z,.38,.16,.38,stone);
    tube(new T.Vector3(x,y+.16,z),new T.Vector3(x,y+4.8,z),.055,metal);
    add(new T.SphereGeometry(.23,16,12).scale(.88,1.38,.88).translate(x,y+5.05,z),globe);
    box(x+.28,y+3.8,z,.46,1.05,.016,orange);
  }
  // Match the photographed garden walk's pale edging and red cross bands.
  for(const side of [-1,1])for(let i=0;i<20;i++) {
    const t=(i+.5)/20,x=-137-21*t,z=50.65-1.98*t+side*4.55;
    box(x,upperWalk(x)+.15,z,21/20+.025,.3,.27,stone,-Math.atan2(-2.64,-28));
  }
  for(const x of [-145,-157])box(x,upperWalk(x)+.015,50.65+(x+137)*2.64/28,.32,.025,8.9,orange,.09);
  for(const [x,z] of [[-159.5,44.9],[-159.9,50.1],[-160.2,54.6]]) {
    const y=upperWalk(x);add(new T.CylinderGeometry(.33,.33,.92,24).translate(x,y+.46,z),aggregate);
    add(new T.CylinderGeometry(.34,.34,.09,24).translate(x,y+.99,z),aggregate);
  }
  const trees:TreePlacement[]=[];
  for(const [i,[x,z]] of [[-30,46],[-32,77],[-50,45],[-53,75],[-80,38],[-83,72],[-99,43],[-107,64],[-143,42],[-151,58],[-163,58]].entries()) {
    if(!inCentralMall(x,z) || nearestSurface(x,z).distance<1.6)continue;
    trees.push({x,z,y:gardenHeight(x,z),rotation:i*1.73,scale:.84+(i%3)*.10,width:1.28,height:.93});
    box(x,gardenHeight(x,z)-.04,z,1.6,.08,1.6,soil);
  }
  const hedges:HedgePlacement[]=[];
  for(const [bedIndex,rings] of westPlan.beds.entries()) {
    // Raised beds inside limestone curbs: intentional, not graded.
    surface(rings,(x,z)=>westHeight(x,z)+.23,grass,false);
    for(const ring of rings)for(let i=0;i<ring.length;i++) {
      const a=ring[i],b=ring[(i+1)%ring.length],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz),angle=-Math.atan2(dz,dx);
      const segments=Math.ceil(len/1.2);
      for(let j=0;j<segments;j++) {
        const f=(j+.5)/segments,x=a[0]+dx*f,z=a[1]+dz*f,y=westHeight(x,z);
        box(x,y+.14,z,len/segments+.01,.28,.42,westStone,angle);
        box(x,y+.31,z,len/segments+.012,.08,.53,westStone,angle);
      }
      if(len>12){
        const center=rings[0].reduce((sum,p)=>sum.add(new T.Vector2(...p)),new T.Vector2()).divideScalar(rings[0].length);
        const pa=new T.Vector2(...a).lerp(center,.09),pb=new T.Vector2(...b).lerp(center,.09);
        hedges.push({a:pa.toArray(),b:pb.toArray(),y:westHeight(pa.x,pa.y)+.25,endY:westHeight(pb.x,pb.y)+.25,width:.65,height:.48});
      }
    }
    const center=rings[0].reduce((sum,p)=>sum.add(new T.Vector2(...p)),new T.Vector2()).divideScalar(rings[0].length);
    for(const offset of [-6.3,1.0,6.2]) {
      const x=center.x+offset,z=center.y+offset*.088;
      trees.push({x,z,y:westHeight(x,z)+.23,rotation:bedIndex*2.3+offset,scale:.97,width:1.45,height:.91});
    }
  }
  const westLamps:Point[]=[[-285,47.8],[-306,25.4],[-339,42.2],[-377,18.1],[-402,36.9]];
  for(const [x,z] of westLamps) {
    const y=westHeight(x,z);lamps.push([x,z]);
    add(new T.CylinderGeometry(.18,.26,.18,12).translate(x,y+.09,z),westStone);
    tube(new T.Vector3(x,y+.18,z),new T.Vector3(x,y+4.8,z),.06,metal);
    add(new T.SphereGeometry(.24,16,12).scale(.88,1.35,.88).translate(x,y+5.04,z),globe);
    box(x+.31,y+3.7,z,.50,1.12,.02,orange);
  }
  const meshes:T.Mesh[]=[];
  for(const group of ['ground','stairs','other'] as const)for(const [m,parts] of batches[group]) {
    const normalized=parts.map((g)=>g.index?g.toNonIndexed():g),g=mergeGeometries(normalized)!;
    const mesh=new T.Mesh(g,m);mesh.name=group==='stairs'?'East and West Mall stairs and graded risers':group==='other'?'East and West Mall walls, lamps and furniture':'East and West Mall foreground';mesh.castShadow=mesh.receiveShadow=true;meshes.push(mesh);
    if(group==='ground')tagGroundTieIn(mesh,'East and West Mall',m===grass?'lawn':'paved');
    for(const part of new Set([...parts,...normalized]))part.dispose();
  }
  const volumes:CutVolume[]=plan.clearance.flatMap((rings)=>triangulate(rings).map((triangle)=>{
    const points=triangle.map((p)=>new T.Vector3(p.x,0,p.y));
    const center=points.reduce((sum,p)=>sum.add(p),new T.Vector3()).multiplyScalar(1/3);
    const planes=points.map((p,i)=>{
      const edge=points[(i+1)%3].clone().sub(p),plane=new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(edge.z,0,-edge.x).normalize(),p);
      if(plane.distanceToPoint(center)>0)plane.negate();return plane;
    });
    const bounds=new T.Box3().setFromPoints(points);bounds.min.y=-4;bounds.max.y=42;
    planes.push(new T.Plane(new T.Vector3(0,-1,0),-4),new T.Plane(new T.Vector3(0,1,0),-42));
    return {planes,bounds};
  }));
  return {meshes,materials,volumes,trees,hedges,stairRecords,lamps,spheres,eastHeight,upperCourt,groundMaterial:aggregate,
    westHeight,frontageHeight,
    // The adjoining building yards must share the garden's outer grade too;
    // blending only their base elevation leaves a ledge at the repair boundary.
    yardHeight:(x:number,z:number)=>{
      const influence=approachInfluence(x,z),original=nearestSurface(x,z).height;
      return influence?T.MathUtils.lerp(original,gardenHeight(x,z),influence):original;
    },
    groundHeight:(x:number,z:number)=>nearestSurface(x,z).height,
    stats:{areas:plan.areas.length,stairFlights:stairRecords.length,gradedRisers:21,trees:trees.length,lamps:lamps.length,
      triangles:meshes.reduce((n,m)=>n+m.geometry.attributes.position.count/3,0),cutVolumes:volumes.length}};
}
