import RAPIER from '@dimforge/rapier3d-compat';

type V = { x: number; y: number; z: number };
type Q = V & { w: number };
export type ScooterBlock = 'obstacle' | 'rider-clearance' | 'step' | 'drop' | 'slope' | 'unsupported' | 'surface-mismatch' | 'controller' | 'invalid-input';
export interface ScooterGround { point: V; normal: V }
export interface ScooterSupport {
  groundY: number; front: ScooterGround; rear: ScooterGround;
  normal: V; pitch: number; roll: number; rotation: Q;
}
export interface ScooterPose { center: V; heading: number }
export interface ScooterClearanceResult {
  delta: V; center: V; allowedHeading: number; grounded: boolean;
  support: ScooterSupport | null; blockedReason: ScooterBlock | null;
  fraction: number; substeps: number;
}
export interface ScooterClearanceOptions {
  world: RAPIER.World;
  controller: RAPIER.KinematicCharacterController;
  collider: RAPIER.Collider;
  /** Use the same ray bounds as physics. Null means the displayed surface is
   * not ready. Omit only in a scene whose rendered and physical ground agree. */
  renderedGround?: (x: number, z: number, fromY: number, distance: number) => ScooterGround | null;
}
export const SCOOTER_ENVELOPE = Object.freeze({
  riderCenterToFeet: .905, riderHalfSegment: .54, riderRadius: .34,
  frontWheelZ: .58, rearWheelZ: -.45,
  minZ: -.62, maxZ: .79, halfWidth: .49, minY: .14, maxY: 1.20, riderGuardMinY: .30, riderGuardMaxY: 1.76,
  maxSurfaceNoise: .08, minGroundNormalY: .5, maxStep: .12, maxSlope: Math.PI / 12, maxTranslation: .1,
  maxRotation: Math.PI / 60, dismountDistance: .7,
});
const E = SCOOTER_ENVELOPE, EPS = .00001, SKIN = .004, PROBE_UP = .35, PROBE_DOWN = .35;
const add = (a: V, b: V): V => ({ x: a.x+b.x, y: a.y+b.y, z: a.z+b.z });
const sub = (a: V, b: V): V => ({ x: a.x-b.x, y: a.y-b.y, z: a.z-b.z });
const mul = (a: V, t: number): V => ({ x: a.x*t, y: a.y*t, z: a.z*t });
const length = (a: V) => Math.hypot(a.x,a.y,a.z);
const lerp = (a: V,b: V,t: number): V => add(a,mul(sub(b,a),t));
const angle = (a: number) => Math.atan2(Math.sin(a),Math.cos(a));
const finite = (v: V) => [v.x,v.y,v.z].every(Number.isFinite);
const multiply = (a: Q,b: Q): Q => ({x:a.w*b.x+a.x*b.w+a.y*b.z-a.z*b.y,y:a.w*b.y-a.x*b.z+a.y*b.w+a.z*b.x,z:a.w*b.z+a.x*b.y-a.y*b.x+a.z*b.w,w:a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z});
const orientation = (yaw: number,pitch=0,roll=0): Q => multiply(multiply({x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)},{x:Math.sin(-pitch/2),y:0,z:0,w:Math.cos(pitch/2)}),{x:0,y:0,z:Math.sin(roll/2),w:Math.cos(roll/2)});
const rotate = (q: Q,v: V): V => {const p=multiply(multiply(q,{...v,w:0}),{x:-q.x,y:-q.y,z:-q.z,w:q.w});return{x:p.x,y:p.y,z:p.z};};
const qdot=(a: Q,b: Q)=>a.x*b.x+a.y*b.y+a.z*b.z+a.w*b.w;
const qangle=(a: Q,b: Q)=>2*Math.acos(Math.min(1,Math.abs(qdot(a,b))));
function qslerp(a: Q,b: Q,t: number): Q {let dot=qdot(a,b);if(dot<0){b={x:-b.x,y:-b.y,z:-b.z,w:-b.w};dot=-dot;}let u=1-t,v=t;if(dot<.9995){const theta=Math.acos(Math.min(1,dot)),sin=Math.sin(theta);u=Math.sin((1-t)*theta)/sin;v=Math.sin(t*theta)/sin;}const q={x:a.x*u+b.x*v,y:a.y*u+b.y*v,z:a.z*u+b.z*v,w:a.w*u+b.w*v},n=Math.hypot(q.x,q.y,q.z,q.w);return{x:q.x/n,y:q.y/n,z:q.z/n,w:q.w/n};}
type Sample = { support: ScooterSupport; center: V; heading: number };
type SampleResult = { sample: Sample; reason: null } | { sample: null; reason: ScooterBlock };

/** Query-only vehicle clearance. It never translates the player, creates a
 * collider, steps the world, or stores a motion heading. Call with current
 * scene colliders and let the game apply the returned delta to its one body. */
export class ScooterClearance {
  private readonly rider = new RAPIER.Capsule(E.riderHalfSegment,E.riderRadius);
  private readonly half = {x:E.halfWidth,y:(E.maxY-E.minY)/2,z:(E.maxZ-E.minZ)/2};
  private readonly offset = {x:0,y:(E.maxY+E.minY)/2,z:(E.maxZ+E.minZ)/2};
  private readonly upperHalf = {x:E.halfWidth,y:(E.riderGuardMaxY-E.riderGuardMinY)/2,z:(E.maxZ-E.minZ)/2};
  private readonly upperOffset = {x:0,y:(E.riderGuardMaxY+E.riderGuardMinY)/2,z:(E.maxZ+E.minZ)/2};
  private readonly flags = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
  private readonly identity: Q = {x:0,y:0,z:0,w:1};
  constructor(private readonly options: ScooterClearanceOptions) {}

  private ground(x: number,z: number,expectedY: number): { hit: ScooterGround | null; reason: ScooterBlock | null } {
    const fromY=expectedY+PROBE_UP,distance=PROBE_UP+PROBE_DOWN,{world,collider,renderedGround}=this.options;
    const hit=world.castRayAndGetNormal(new RAPIER.Ray({x,y:fromY,z},{x:0,y:-1,z:0}),distance,true,this.flags,undefined,collider);
    if(!hit)return{hit:null,reason:'unsupported'};
    const point={x,y:fromY-hit.timeOfImpact,z},normal={...hit.normal};
    // A photogrammetry triangle can be much steeper than the road under the
    // wheelbase. Only reject wall-like faces here; measured axle and crossfall
    // grades below still enforce the 15-degree road limit.
    if(!finite(normal)||normal.y<=E.minGroundNormalY)return{hit:null,reason:'slope'};
    if(renderedGround){const shown=renderedGround(x,z,fromY,distance);if(!shown||!finite(shown.point)||!finite(shown.normal)||Math.abs(shown.point.y-point.y)>E.maxSurfaceNoise||shown.normal.y<=E.minGroundNormalY)return{hit:null,reason:'surface-mismatch'};}
    return{hit:{point,normal},reason:null};
  }

  private discontinuity(a: ScooterGround,b: ScooterGround): ScooterBlock | null {
    const d=sub(b.point,a.point),gradient=(n: V)=>-(n.x*d.x+n.z*d.z)/n.y;
    const residual=d.y-(gradient(a.normal)+gradient(b.normal))/2;
    return residual>E.maxStep+EPS?'step':residual< -E.maxStep-EPS?'drop':null;
  }

  private sample(center: V,heading: number,expectedY: number): SampleResult {
    const sin=Math.sin(heading),cos=Math.cos(heading),at=(x: number,z: number)=>({x:center.x+cos*x+sin*z,z:center.z-sin*x+cos*z});
    const count=Math.ceil((E.frontWheelZ-E.rearWheelZ)/(E.maxTranslation/2)),line:ScooterGround[]=[];
    for(let i=0;i<=count;i++){const p=at(0,E.rearWheelZ+(E.frontWheelZ-E.rearWheelZ)*i/count),g=this.ground(p.x,p.z,expectedY);if(!g.hit)return{sample:null,reason:g.reason!};if(i){const reason=this.discontinuity(line.at(-1)!,g.hit);if(reason)return{sample:null,reason};}line.push(g.hit);}
    const rear=line[0],front=line.at(-1)!,groundY=rear.point.y+(front.point.y-rear.point.y)*(-E.rearWheelZ)/(E.frontWheelZ-E.rearWheelZ);
    const pitch=Math.atan2(front.point.y-rear.point.y,E.frontWheelZ-E.rearWheelZ);
    if(Math.abs(pitch)>E.maxSlope+EPS)return{sample:null,reason:'slope'};
    // Tire-width support at both axles, plus a lateral grade check at the rider.
    for(const z of[E.rearWheelZ,E.frontWheelZ])for(const x of[-.08,.08]){const p=at(x,z),g=this.ground(p.x,p.z,expectedY);if(!g.hit)return{sample:null,reason:g.reason!};const reason=this.discontinuity(z===E.rearWheelZ?rear:front,g.hit);if(reason)return{sample:null,reason};}
    // A road can change crossfall continuously across the scooter's width.
    // Comparing only the two distant endpoint normals invents a step at that
    // crease. Validate short adjacent spans, just as along the wheelbase.
    const sides:ScooterGround[]=[],sideCount=Math.ceil(E.halfWidth*2/E.maxTranslation);
    for(let i=0;i<=sideCount;i++){
      const x=-E.halfWidth+E.halfWidth*2*i/sideCount,p=at(x,0),g=this.ground(p.x,p.z,expectedY);
      if(!g.hit)return{sample:null,reason:g.reason!};
      if(i){const reason=this.discontinuity(sides.at(-1)!,g.hit);if(reason)return{sample:null,reason};}
      sides.push(g.hit);
    }
    const roll=Math.atan2(sides.at(-1)!.point.y-sides[0].point.y,E.halfWidth*2);if(Math.abs(roll)>E.maxSlope+EPS)return{sample:null,reason:'slope'};
    const middle=this.ground(center.x,center.z,expectedY);if(!middle.hit)return{sample:null,reason:middle.reason!};
    // The unchanged capsule can touch the upper paving before the axle-pair
    // plane reaches it. Derive the required center from its actual spherical
    // lower hemisphere, retaining the existing .025m foot/contact gap.
    let riderCenterY=groundY+E.riderCenterToFeet;
    const footGap=E.riderCenterToFeet-E.riderHalfSegment-E.riderRadius;
    for(const g of[...line,...sides,middle.hit]){const r2=(g.point.x-center.x)**2+(g.point.z-center.z)**2;if(r2<=E.riderRadius**2)riderCenterY=Math.max(riderCenterY,g.point.y+E.riderHalfSegment+Math.sqrt(E.riderRadius**2-r2)+footGap);}
    // The ray cross establishes terrain eligibility, but it can miss the
    // highest contact on the capsule's circular foot at a diagonal paving edge.
    // Resolve that contact using the unchanged capsule and normal25mm gap.
    // Limit the correction to the already permitted curb height, and reject
    // initial overlaps/non-upward contacts instead of turning a wall into floor.
    const probeLift=E.maxStep+.04,probe={x:center.x,y:riderCenterY+probeLift,z:center.z};
    const exact=this.options.world.castShape(probe,this.identity,{x:0,y:-1,z:0},this.rider,footGap,probeLift+PROBE_DOWN,true,this.flags,undefined,this.options.collider);
    if(!exact)return{sample:null,reason:'unsupported'};
    if(!Number.isFinite(exact.time_of_impact)||exact.time_of_impact<=EPS||!finite(exact.normal1)||exact.normal1.y<=EPS)return{sample:null,reason:'rider-clearance'};
    const exactY=probe.y-exact.time_of_impact;
    if(exactY-riderCenterY>E.maxStep+EPS)return{sample:null,reason:'rider-clearance'};
    riderCenterY=Math.max(riderCenterY,exactY);
    // Derive road orientation from measured support heights rather than the
    // two arbitrary scan triangles under the tire contact points.
    const normal=rotate(orientation(heading,pitch,roll),{x:0,y:1,z:0}),n=length(normal),support={groundY,front,rear,normal:mul(normal,1/n),pitch,roll,rotation:orientation(heading,pitch,roll)};
    if(support.normal.y<Math.cos(E.maxSlope)-EPS)return{sample:null,reason:'slope'};
    return{sample:{center:{x:center.x,y:riderCenterY,z:center.z},heading,support},reason:null};
  }

  private hullPosition(center: V,rotation: Q,offset=this.offset): V {return add({x:center.x,y:center.y-E.riderCenterToFeet,z:center.z},rotate(rotation,offset));}
  private intersects(center: V,rotation: Q,shape: RAPIER.Shape): boolean {const{world,collider}=this.options;return!!world.intersectionWithShape(center,rotation,shape,this.flags,undefined,collider);}
  private clearPose(sample: Sample): ScooterBlock | null {
    if(this.intersects(sample.center,this.identity,this.rider))return'rider-clearance';
    const upperRotation=orientation(sample.heading);if(this.intersects(this.hullPosition(sample.center,upperRotation,this.upperOffset),upperRotation,new RAPIER.Cuboid(this.upperHalf.x,this.upperHalf.y,this.upperHalf.z)))return'rider-clearance';
    if(this.intersects(this.hullPosition(sample.center,sample.support.rotation),sample.support.rotation,new RAPIER.Cuboid(this.half.x,this.half.y,this.half.z)))return'obstacle';
    return null;
  }

  /** A constant-orientation inflated shape encloses every intermediate box
   * rotation. This catches thin railings between yaw samples, not just at the
   * two endpoint poses. Ground-plane orientation changes are included. */
  private sweep(a: Sample,b: Sample): {reason: ScooterBlock | null; steps: number} {
    const distance=length(sub(b.center,a.center)),turn=Math.max(qangle(a.support.rotation,b.support.rotation),Math.abs(angle(b.heading-a.heading))),steps=Math.max(1,Math.ceil(distance/E.maxTranslation),Math.ceil(turn/E.maxRotation)),{world,collider}=this.options;
    const guards=[{half:this.half,offset:this.offset,a:a.support.rotation,b:b.support.rotation,reason:'obstacle' as const},{half:this.upperHalf,offset:this.upperOffset,a:orientation(a.heading),b:orientation(b.heading),reason:'rider-clearance' as const}];
    for(let i=0;i<steps;i++){
      const lo=i/steps,hi=(i+1)/steps,pa=lerp(a.center,b.center,lo),pb=lerp(a.center,b.center,hi);
      for(const guard of guards){const {half,offset}=guard,qa=qslerp(guard.a,guard.b,lo),qb=qslerp(guard.a,guard.b,hi),mid=qslerp(qa,qb,.5);
        // Bound every rotational arc on each midpoint-local axis. Inflating
        // all axes by a sphere radius would spuriously hit level ground on
        // yaw or reject a legal 6cm lip while pitching over it.
        const relative=multiply({x:-mid.x,y:-mid.y,z:-mid.z,w:mid.w},qa),axisLength=Math.hypot(relative.x,relative.y,relative.z),padding={x:SKIN,y:SKIN,z:SKIN};
        if(axisLength>1e-9){const axis={x:relative.x/axisLength,y:relative.y/axisLength,z:relative.z/axisLength},theta=qangle(mid,qa),sin=Math.sin(theta),bend=1-Math.cos(theta);for(const x of[-half.x,half.x])for(const y of[-half.y,half.y])for(const z of[-half.z,half.z]){const v=add(offset,{x,y,z}),dot=axis.x*v.x+axis.y*v.y+axis.z*v.z,cross={x:axis.y*v.z-axis.z*v.y,y:axis.z*v.x-axis.x*v.z,z:axis.x*v.y-axis.y*v.x};for(const k of['x','y','z']as const)padding[k]=Math.max(padding[k],Math.abs(cross[k])*sin+Math.abs(axis[k]*dot-v[k])*bend+SKIN);}}
        const shape=new RAPIER.Cuboid(half.x+padding.x,half.y+padding.y,half.z+padding.z),start=this.hullPosition(pa,mid,offset),end=this.hullPosition(pb,mid,offset),delta=sub(end,start);
        if(this.intersects(start,mid,shape)||world.castShape(start,mid,delta,shape,0,1,true,this.flags,undefined,collider)||this.intersects(end,mid,shape))return{reason:guard.reason,steps:i+1};
      }
      const riderDelta=sub(pb,pa);if(world.castShape(pa,this.identity,riderDelta,this.rider,SKIN,1,true,this.flags,undefined,collider)||this.intersects(pb,this.identity,this.rider))return{reason:'rider-clearance',steps:i+1};
    }
    return{reason:null,steps};
  }

  private result(from: ScooterPose,sample: Sample | null,reason: ScooterBlock | null,fraction=0,steps=0): ScooterClearanceResult {
    const base=finite(from.center)?from.center:{...this.options.collider.translation()},center=sample?.center??{...base};return{delta:sub(center,base),center,allowedHeading:sample?.heading??(Number.isFinite(from.heading)?from.heading:0),grounded:!!sample,support:sample?.support??null,blockedReason:reason,fraction,substeps:steps};
  }

  canOccupy(from: ScooterPose): ScooterClearanceResult & {allowed: boolean} {
    const {center,heading}=from;if(!finite(center)||!Number.isFinite(heading))return{...this.result(from,null,'invalid-input'),allowed:false};
    const result=this.sample(center,heading,center.y-E.riderCenterToFeet);if(!result.sample)return{...this.result(from,null,result.reason),allowed:false};
    if(Math.abs(result.sample.center.y-center.y)>E.maxStep)return{...this.result(from,null,'unsupported'),allowed:false};
    result.sample.center=center;const reason=this.clearPose(result.sample);return{...this.result(from,result.sample,reason,reason?0:1),allowed:!reason};
  }

  canMount(heading: number): ScooterClearanceResult & {allowed: boolean} {
    return this.canOccupy({center:{...this.options.collider.translation()},heading});
  }

  /** Stateless lookahead/clearance; also usable with a braking-distance query.
   * A rejected station returns the last fully validated center and heading. */
  traceMove(from: ScooterPose,displacement: {x: number;z: number},heading: number): ScooterClearanceResult {
    if(!finite(from.center)||![from.heading,heading,displacement.x,displacement.z].every(Number.isFinite))return this.result(from,null,'invalid-input');
    const initial=this.sample(from.center,from.heading,from.center.y-E.riderCenterToFeet);if(!initial.sample)return this.result(from,null,initial.reason);
    initial.sample.center={...from.center};const initialBlock=this.clearPose(initial.sample);if(initialBlock)return this.result(from,null,initialBlock);
    const turn=angle(heading-from.heading),count=Math.max(1,Math.ceil(Math.hypot(displacement.x,displacement.z)/E.maxTranslation),Math.ceil(Math.abs(turn)/E.maxRotation));
    // Avoid unbounded work from a bad elapsed-time or accidental distant target.
    if(count>256)return this.result(from,initial.sample,'invalid-input');
    let previous=initial.sample,completed=0,steps=0;
    for(let i=1;i<=count;i++){
      const t=i/count,candidate={x:from.center.x+displacement.x*t,y:previous.center.y,z:from.center.z+displacement.z*t},hit=this.sample(candidate,from.heading+turn*t,previous.support.groundY);
      if(!hit.sample)return this.result(from,previous,hit.reason,completed,steps);
      const shift=this.discontinuity({point:{x:previous.center.x,y:previous.support.groundY,z:previous.center.z},normal:previous.support.normal},{point:{x:hit.sample.center.x,y:hit.sample.support.groundY,z:hit.sample.center.z},normal:hit.sample.support.normal});if(shift)return this.result(from,previous,shift,completed,steps);
      const check=this.sweep(previous,hit.sample);steps+=check.steps;if(check.reason)return this.result(from,previous,check.reason,completed,steps);
      previous=hit.sample;completed=t;
    }
    return this.result(from,previous,null,1,steps);
  }

  resolveMove(input: {fromHeading: number;heading: number;displacement: {x: number;z: number}}): ScooterClearanceResult {
    const from={center:{...this.options.collider.translation()},heading:input.fromHeading},planned=this.traceMove(from,input.displacement,input.heading);if(!planned.support)return planned;
    const c=this.options.controller,old={step:c.autostepEnabled(),height:c.autostepMaxHeight(),width:c.autostepMinWidth(),dynamic:c.autostepIncludesDynamicBodies(),snap:c.snapToGroundDistance(),climb:c.maxSlopeClimbAngle(),slideAngle:c.minSlopeSlideAngle(),slide:c.slideEnabled()};let movement: V;
    // Triangle eligibility is deliberately wider than the measured road grade.
    // Keep the KCC consistent so a permitted centimetric facet cannot undo
    // the wheelbase validation. All walking settings are restored below.
    try{c.enableAutostep(E.maxStep,.2,false);c.disableSnapToGround();c.setMaxSlopeClimbAngle(Math.acos(E.minGroundNormalY));c.setMinSlopeSlideAngle(E.maxSlope);c.setSlideEnabled(true);c.computeColliderMovement(this.options.collider,planned.delta,this.flags,undefined,other=>other.handle!==this.options.collider.handle);movement={...c.computedMovement()};}
    finally{if(old.step)c.enableAutostep(old.height!,old.width!,old.dynamic!);else c.disableAutostep();if(old.snap!==null)c.enableSnapToGround(old.snap);else c.disableSnapToGround();c.setMaxSlopeClimbAngle(old.climb);c.setMinSlopeSlideAngle(old.slideAngle);c.setSlideEnabled(old.slide);}
    // KCC may shorten movement or add slope correction. Verify its actual path
    // and endpoint before the game commits it; never return an unchecked slide.
    const wanted=Math.hypot(planned.delta.x,planned.delta.z),actual=Math.hypot(movement.x,movement.z),ratio=wanted>1e-8?Math.min(1,actual/wanted):1,allowedHeading=from.heading+angle(planned.allowedHeading-from.heading)*ratio,checked=this.traceMove(from,{x:movement.x,z:movement.z},allowedHeading),center=add(from.center,movement);
    if(checked.fraction<1||!checked.support||Math.abs(center.y-checked.center.y)>E.maxStep)return this.result(from,{center:from.center,heading:from.heading,support:planned.support},checked.blockedReason??'controller');
    const pose:Sample={center,heading:allowedHeading,support:checked.support},reason=this.clearPose(pose);if(reason)return this.result(from,{center:from.center,heading:from.heading,support:planned.support},reason);
    const shortened=actual<wanted-.001;return{...checked,center,delta:movement,allowedHeading,blockedReason:planned.blockedReason??(shortened?'controller':null),fraction:planned.fraction*ratio,substeps:planned.substeps+checked.substeps};
  }

  private humanSupport(center: V,expectedY: number): {center: V;ground: ScooterGround} | ScooterBlock {
    const g=this.ground(center.x,center.z,expectedY);if(!g.hit)return g.reason!;
    if(g.hit.normal.y<Math.cos(E.maxSlope)-EPS)return 'slope';
    for(const [dx,dz]of[[-.22,0],[.22,0],[0,-.22],[0,.22]]){const edge=this.ground(center.x+dx,center.z+dz,expectedY);if(!edge.hit)return edge.reason!;if(edge.hit.normal.y<Math.cos(E.maxSlope)-EPS)return 'slope';const reason=this.discontinuity(g.hit,edge.hit);if(reason)return reason;}
    const footGap=E.riderCenterToFeet-E.riderHalfSegment-E.riderRadius;
    return{center:{x:center.x,y:g.hit.point.y+E.riderHalfSegment+E.riderRadius/g.hit.normal.y+footGap,z:center.z},ground:g.hit};
  }

  canOccupyPerson(center: V): {allowed: boolean;blockedReason: ScooterBlock | null} {
    if(!finite(center))return{allowed:false,blockedReason:'invalid-input'};
    const hit=this.humanSupport(center,center.y-E.riderCenterToFeet);if(typeof hit==='string')return{allowed:false,blockedReason:hit};
    if(Math.abs(hit.center.y-center.y)>.06)return{allowed:false,blockedReason:'unsupported'};
    if(this.intersects(center,this.identity,this.rider))return{allowed:false,blockedReason:'rider-clearance'};
    return{allowed:true,blockedReason:null};
  }

  /** Capsule-only query for each root-owned dismount interpolation increment.
   * Both its swept path and its support are checked without moving the body. */
  traceDismount(from: V,displacement: {x: number;z: number}): {allowed: boolean;center: V | null;path: V[];blockedReason: ScooterBlock | null} {
    if(!finite(from)||![displacement.x,displacement.z].every(Number.isFinite))return{allowed:false,center:null,path:[],blockedReason:'invalid-input'};
    const count=Math.max(1,Math.ceil(Math.hypot(displacement.x,displacement.z)/E.maxTranslation));if(count>256)return{allowed:false,center:null,path:[],blockedReason:'invalid-input'};
    const path=[from];let previousGround:ScooterGround|null=null;const{world,collider}=this.options;
    for(let i=0;i<=count;i++){const t=i/count,p={x:from.x+displacement.x*t,y:path.at(-1)!.y,z:from.z+displacement.z*t},hit=this.humanSupport(p,path.at(-1)!.y-E.riderCenterToFeet);if(typeof hit==='string')return{allowed:false,center:null,path:[],blockedReason:hit};
      if(previousGround){const reason=this.discontinuity(previousGround,hit.ground);if(reason)return{allowed:false,center:null,path:[],blockedReason:reason};}
      const delta=sub(hit.center,path.at(-1)!);if(this.intersects(hit.center,this.identity,this.rider)||world.castShape(path.at(-1)!,this.identity,delta,this.rider,SKIN,1,true,this.flags,undefined,collider))return{allowed:false,center:null,path:[],blockedReason:'rider-clearance'};
      if(i>0)path.push(hit.center);previousGround=hit.ground;
    }
    return{allowed:true,center:path.at(-1)!,path,blockedReason:null};
  }

  /** Validate both complete side paths before root begins its .35s transition.
   * Reuse traceDismount for fresh incremental checks during the transition. */
  findDismount(heading: number): {allowed: boolean;center: V | null;path: V[];side: 'left'|'right'|null;blockedReason: ScooterBlock | null} {
    const start={...this.options.collider.translation()};if(!finite(start)||!Number.isFinite(heading))return{allowed:false,center:null,path:[],side:null,blockedReason:'invalid-input'};
    let lastReason:ScooterBlock|null='obstacle';
    for(const side of[-1,1]){const distance=side*E.dismountDistance,result=this.traceDismount(start,{x:Math.cos(heading)*distance,z:-Math.sin(heading)*distance});if(result.allowed)return{...result,side:side<0?'left':'right'};lastReason=result.blockedReason;}
    return{allowed:false,center:null,path:[],side:null,blockedReason:lastReason};
  }
}
