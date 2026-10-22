import * as T from 'three';
import { addHistoricWindowCoordinates } from './historic-window-coverings';
import { addWaggenerEaves } from './waggener-eaves';
import { applyHistoricRoofDetail, setHistoricRoofMetreUV } from './historic-roof-detail';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import planData from '../../public/data/historic-central-plan.json' with { type: 'json' };

type P = [number, number];
type Rings = P[][];
type Profile = { refs: string[]; doorEdges: Record<string, number[]>; bayCounts: Record<string, number>; doorWidth: number; bayWidth: number; bayHeight: number; frameColumns: number; frameRows: number; plinth: number; roofRise: number; roofOverhang: number; soffitBrackets: boolean; entryStyle: string; doorHeight?: number; archDoor?: boolean; archGroundWindows?: boolean; atticHeight?: number; flatRoof?: boolean; finEdges?: number[] };
/** `eave` (campus Y) overrides base + floors x floorHeight where a measured roof datum exists.
 * JGB is stored as per-tier parts sharing one abbreviation (2017 LiDAR tiers of record 575728):
 * `skipEdges` are internal edges against an equal/higher part (no wall), `stepEdges` are internal
 * edges above a lower part (wall from that part's eave, keyed edge -> lower eave Y). `cutTop` keeps
 * one source-cut height for the whole footprint. */
type Building = { abbr: string; name: string; base: number; floors: number; floorHeight: number; rings: Rings; core: Rings[]; roofRectangle: P[]; roofRectangles?: P[][]; profile: Profile; part?: string; eave?: number; skipEdges?: number[]; stepEdges?: Record<string, number>; cutTop?: number };
type CutVolume = { planes: T.Plane[]; bounds: T.Box3 };
type Sample = { abbr: string; kind: string; origin: number[]; direction: number[]; expectedMinimumDistance?: number };
const plan = planData as unknown as { buildings: Building[] };
export interface HistoricCentralOptions {
  groundHeight: (x: number, z: number) => number;
  /** Explicit opt-in; enables independent regional integration. */
  abbreviations: string[];
  baseElevations?: Record<string, number>;
  /** Optional photo/source-supported west WAG threshold; east portal and all
   * building/foundation/source-cut datums remain unchanged. */
  waggenerWestDoorHeight?: number;
  /** Opt-in, photo-supported GAR north/east basement only. The upper facade
   * datum stays fixed. Integrator supplies the final adjacent outdoor grade. */
  garrisonBasement?: {
    centerY: number;
    height: number;
    groundHeight: (x: number, z: number) => number;
    minimumSillClearance?: number;
    /** Optional GAR geometry-only burial datum, derived from final near-wall
     * grade. Source cuts remain at the original legacy foundation bottom. */
    foundationBottom?: number;
  };
}
function shape(rings: Rings) {
  const s = new T.Shape(rings[0].map(([x,z]) => new T.Vector2(x,-z)));
  s.holes = rings.slice(1).map(r => new T.Path(r.map(([x,z]) => new T.Vector2(x,-z)))); return s;
}
function cut(rings: Rings, low: number, high: number): CutVolume[] {
  const rr = rings.map(r => r.map(p => new T.Vector2(...p))), flat = rr.flat();
  return T.ShapeUtils.triangulateShape(rr[0],rr.slice(1)).map(ids => {
    const p = ids.map(i => new T.Vector3(flat[i].x,0,flat[i].y));
    const center = p.reduce((v,q) => v.add(q), new T.Vector3()).multiplyScalar(1/3);
    const planes = p.map((a,i) => { const b = p[(i+1)%3], plane = new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(b.z-a.z,0,a.x-b.x).normalize(),a); if(plane.distanceToPoint(center)>0) plane.negate(); return plane; });
    planes.push(new T.Plane(new T.Vector3(0,-1,0),low),new T.Plane(new T.Vector3(0,1,0),-high));
    const bounds = new T.Box3().setFromPoints(p); bounds.min.y=low; bounds.max.y=high; return {planes,bounds};
  });
}
/** Photo-informed exteriors only. Existing mall ground and scan-cleanup ownership
 * stays with the integrator; no yards, paths, planting or broad cuts are emitted.
 */
export function buildHistoricCentralBuildings(options: HistoricCentralOptions) {
  const selected = plan.buildings.filter(b => options.abbreviations.includes(b.abbr));
  for(const abbr of options.abbreviations) if(!selected.some(b => b.abbr === abbr)) throw new Error(`Historic central asset unavailable: ${abbr}`);
  const materials:T.MeshStandardMaterial[]=[];
  const material=(name:string,color:number,roughness=.84,metalness=0)=> {const m=new T.MeshStandardMaterial({color,roughness,metalness});m.name=`Historic campus ${name}`;materials.push(m);return m;};
  const brick=material('buff varied brick',0xb39977),stone=material('warm limestone',0xc2b69e),glass=material('deep green glass',0x30483f,.28,.18),shade=material('shadowed panes',0x263d37,.36,.12),frame=material('painted green steel',0x596b58,.63,.2),wood=material('dark wood doors',0x393129),roof=material('red tile',0x8c5841,.9),soffit=material('shadowed eaves',0x6f634c,.94),iron=material('dark iron',0x363b33,.67,.3);
  const stairConcrete=selected.some(b=>b.abbr==='EPS')?material('Schoch exposed aggregate stairs',0x948d80,.96):stone;
  const waggenerFrame=selected.some(b=>b.abbr==='WAG')?material('Waggener oxide painted steel',0x78554b,.68,.08):frame;
  for(const [m,unit,mode] of [[brick,[.235,.075],'brick'],[stone,[.68,.32],'stone'],[roof,[.19,.34],'tile']] as const){
    m.onBeforeCompile=s=>{if(s.vertexShader.includes('varying vec2 vHistoricMetres;'))return;s.vertexShader='varying vec2 vHistoricMetres;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nvHistoricMetres=uv;');s.fragmentShader='varying vec2 vHistoricMetres;\nfloat hcHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\n'+s.fragmentShader;s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      vec2 q=vHistoricMetres/vec2(${unit[0]},${unit[1]});q.x+=mod(floor(q.y),2.)*.5;
      vec2 aa=max(fwidth(q),vec2(.0001)),edge=min(fract(q),1.-fract(q));float mortar=1.-smoothstep(.025,.025+max(aa.x,aa.y),min(edge.x,edge.y));
      float tone=hcHash(floor(q));diffuseColor.rgb*=(${mode==='brick'?'.87+.23*tone':'.93+.12*tone'})*(1.-mortar*${mode==='brick'?'.16':'.10'});
      ${mode==='tile'?'diffuseColor.rgb*=.87+.13*pow(.5+.5*cos(q.x*6.2831853),.7);':''}`);};m.customProgramCacheKey=()=>`historic-central-${mode}-v1`;
  }
  if (selected.some(b => !b.profile.flatRoof)) applyHistoricRoofDetail(roof);
  const basementOpenings: {edge:number;position:number[];width:number;height:number;groundSamples:number[];sillClearance:number}[]=[];
  const meshes:T.Mesh[]=[],volumes:CutVolume[]=[],samples:Sample[]=[],entrancePoints:{abbr:string;position:number[];normal:number[]}[]=[],buildingStats:Record<string,unknown>[]=[];
  // Parts of one building (JGB tiers) share material batches: one draw per material per building.
  let batches=new Map<T.Material,T.BufferGeometry[]>(),windows=0,doors=0,brackets=0,basementWindows=0,start=0,roofPeak=-Infinity;
  for(const [buildingIndex,b] of selected.entries()){
    const base=options.baseElevations?.[b.abbr]??b.base,profile=b.profile,top=b.eave??base+b.floors*b.floorHeight+(profile.atticHeight??0),masonry=b.abbr==='JGB'?stone:brick;
    const legacyBottom=Math.min(base-2,...b.rings[0].map(([x,z])=>options.groundHeight(x,z)-1));
    const requestedBottom=b.abbr==='GAR'?options.garrisonBasement?.foundationBottom:undefined;
    if(requestedBottom!==undefined&&!Number.isFinite(requestedBottom))throw new Error('Invalid GAR foundation burial datum');
    const bottom=requestedBottom===undefined?legacyBottom:Math.min(legacyBottom,requestedBottom);
    if(![base,top,bottom].every(Number.isFinite))throw new Error(`Invalid ${b.abbr} ground samples`);
    const add=(g:T.BufferGeometry,m:T.Material,preserveUV=false)=>{const p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv??new T.BufferAttribute(new Float32Array(p.count*2),2);if(!preserveUV)for(let i=0;i<p.count;i++)uv.setXY(i,Math.abs(n?.getY(i)??0)>.8?p.getX(i):Math.abs(n?.getX(i)??0)>.6?p.getZ(i):p.getX(i),Math.abs(n?.getY(i)??0)>.8?p.getZ(i):p.getY(i));g.setAttribute('uv',uv);if(!batches.has(m))batches.set(m,[]);batches.get(m)!.push(g);};
    // A recessed inner core closes the exterior without covering any window or
    // doorway; visible outer walls are built around explicit apertures below.
    for(const r of b.core)if(r[0]?.length>=3)add(new T.ExtrudeGeometry(shape(r),{depth:top-bottom,steps:1,bevelEnabled:false}).rotateX(-Math.PI/2).translate(0,bottom,0),masonry);
    for(const ring of b.rings){
      const area=ring.reduce((sum,p,i)=>sum+p[0]*ring[(i+1)%ring.length][1]-ring[(i+1)%ring.length][0]*p[1],0);
      for(let edge=0;edge<ring.length;edge++){
        const a=ring[edge],q=ring[(edge+1)%ring.length],dx=q[0]-a[0],dz=q[1]-a[1],length=Math.hypot(dx,dz),sign=Math.sign(area),u=new T.Vector3(dx/length,0,dz/length),out=new T.Vector3(dz/length*sign,0,-dx/length*sign);
        if(length<.1||b.skipEdges?.includes(edge))continue;
        // A step wall rises from the lower neighbouring part's eave (sealed 0.3 m below it).
        const stepFrom=b.stepEdges?.[String(edge)],edgeBottom=stepFrom===undefined?bottom:stepFrom-.3;
        // World basis may be reflected for clockwise polygons. Correct winding
        // after transform ensures that visible and physical normals agree.
        const transform=new T.Matrix4().makeBasis(u,new T.Vector3(0,1,0),out).setPosition(a[0],0,a[1]);
        const placed=(g:T.BufferGeometry,m:T.Material)=>{g.applyMatrix4(transform);if(transform.determinant()<0){if(g.index){const ix=g.index;for(let i=0;i<ix.count;i+=3){const t=ix.getX(i);ix.setX(i,ix.getX(i+2));ix.setX(i+2,t);}}else{for(const attr of Object.values(g.attributes))for(let i=0;i<attr.count;i+=3)for(let j=0;j<attr.itemSize;j++){const a=i*attr.itemSize+j,c=(i+2)*attr.itemSize+j,t=attr.array[a];attr.array[a]=attr.array[c];attr.array[c]=t;}}}add(g,m);};
        const box=(x:number,y:number,w:number,h:number,d:number,m:T.Material,offset=-.37,covering=false)=>{if(w<.001||h<.001)return;const g=new T.BoxGeometry(w,h,d).translate(x,y,offset);if(m===glass||m===shade)addHistoricWindowCoordinates(g,x,y,w,h,u,edge*409+x*47+b.abbr.charCodeAt(0),covering);g.applyMatrix4(transform);if(transform.determinant()<0){const ix=g.index!;for(let i=0;i<ix.count;i+=3){const t=ix.getX(i);ix.setX(i,ix.getX(i+2));ix.setX(i+2,t);}}add(g,m);};
        const witness=(x:number,y:number,kind:string,expectedMinimumDistance?:number)=>{const o=new T.Vector3(x,y,2).applyMatrix4(transform);samples.push({abbr:b.abbr,kind,origin:o.toArray(),direction:out.clone().negate().toArray(),expectedMinimumDistance});};
        type Opening={x:number;y:number;w:number;h:number;door:boolean;arch?:boolean;doorwayBase?:number;basement?:boolean};const openings:Opening[]=[];
        const doorPositions=profile.doorEdges[String(edge)]??[],count=profile.bayCounts[String(edge)]??0;
        for(const t of doorPositions){
          const w=Math.min(profile.doorWidth,length-.5),h=profile.doorHeight??3.5;
          // These two approaches rise above their buildings' global datums.
          // Fit the portal to retained yard geometry without moving the shell.
          const approach=new T.Vector3(length*t,0,2).applyMatrix4(transform);
          const followsYard=(b.abbr==='WAG'&&out.x<-.9)||(b.abbr==='GAR'&&out.z<-.9);
          const localGround=b.abbr==='WAG'&&out.x<-.9&&options.waggenerWestDoorHeight!==undefined
            ?options.waggenerWestDoorHeight
            :followsYard?options.groundHeight(approach.x,approach.z):base;
          if(!Number.isFinite(localGround))throw new Error(`Invalid ${b.abbr} doorway ground sample`);
          // L007 south entrance rises over a short stair flight. Keep the west
          // entry datum unchanged; its reference shows a level/ramped approach.
          const doorwayBase=Math.max(base,localGround)+(b.abbr==='EPS'&&edge===3?.9:0);
          openings.push({x:length*t,y:doorwayBase+h/2,w,h,door:true,arch:profile.archDoor,doorwayBase});
        }
        for(let f=0;f<b.floors;f++)for(let j=0;j<count;j++){
          const x=length*(j+.5)/count;if(f===0&&doorPositions.some(t=>Math.abs(x-length*t)<profile.doorWidth/2+(profile.finEdges?.includes(edge)?4.8:profile.bayWidth)/2+1))continue;
          // Schoch's west return has one narrow vertical bay above its portal.
          const isFin=profile.finEdges?.includes(edge);
          // L007-h000/L175-h090: broad lower steel sash and narrower upper
          // windows on the mall-facing wings. Do not project this pattern onto
          // the unsurveyed north return or the narrow west entrance bay.
          const schochFront=b.abbr==='EPS'&&(edge===0||edge===5);
          const requestedWidth=schochFront?(f===0?3.05:2.05):isFin?4.8:profile.bayWidth;
          const w=Math.min(requestedWidth,(length/count)-.65)*(b.abbr==='EPS'&&edge===8?.68:1);
          let y=base+f*b.floorHeight+b.floorHeight*(isFin?.77:.55);
          const h=schochFront?(f===0?2.55:2.45):isFin?1.5:profile.bayHeight;
          if(schochFront&&f===0)y=base+.65+h/2;if(stepFrom!==undefined&&y-h/2<stepFrom+.75)continue;if(f>0){const portals=openings.filter(o=>o.door&&Math.abs(x-o.x)<profile.doorWidth);for(const portal of portals){const clearance=portal.y+portal.h/2+1.1;if(y-h/2<clearance)y=clearance+h/2;}}openings.push({x,y,w,h,door:false,arch:profile.archGroundWindows&&f===0});
        }
        if(profile.atticHeight&&count>0)for(let j=0;j<count;j++)openings.push({x:length*(j+.5)/count,y:top-profile.atticHeight*.52,w:Math.min(b.abbr==='WAG'?1.4:1.18,length/count-.6),h:b.abbr==='WAG'?1.85:1.48,door:false});
        // The architect aerial and L021 south view show a rectangular lower
        // row on the north/east elevations. The west courtyard is higher: do
        // not wrap this band around the west/south sides or invent new doors.
        const basement=b.abbr==='GAR'?options.garrisonBasement:undefined;
        if(basement&&(edge===2||edge===3)&&count>0){
          const y=basement.centerY,h=basement.height,minSill=basement.minimumSillClearance??.3;
          if(![y,h,minSill].every(Number.isFinite)||h<.8||h>2.5||minSill<.2)throw new Error('Invalid GAR basement dimensions');
          if(y+h/2>base-.25||y-h/2<bottom+.25)throw new Error('GAR basement must stay inside existing lower wall');
          for(let j=0;j<count;j++){
            const x=length*(j+.5)/count,w=Math.min(profile.bayWidth,length/count-.65);
            // Reserve the full north door/stair axis, including its side cheeks.
            if(doorPositions.some(t=>Math.abs(x-length*t)<profile.doorWidth/2+w/2+1.25))continue;
            const grounds=[-w/2,0,w/2].map(offset=>{
              const point=new T.Vector3(x+offset,0,.75).applyMatrix4(transform);
              return basement.groundHeight(point.x,point.z);
            });
            // Unknown or rising grade leaves the original solid foundation.
            if(grounds.some(v=>!Number.isFinite(v)))continue;
            const sillClearance=y-h/2-Math.max(...grounds);
            if(sillClearance<minSill)continue;
            openings.push({x,y,w,h,door:false,arch:false,basement:true});
            basementOpenings.push({edge,position:new T.Vector3(x,y,0).applyMatrix4(transform).toArray(),width:w,height:h,groundSamples:grounds,sillClearance});
          }
        }
        // Partition masonry into strips around the openings. This creates true
        // 0.6 m reveals rather than attaching opaque window patches to a box.
        const levels=[edgeBottom,legacyBottom,top,...openings.flatMap(o=>[o.y-o.h/2,o.y+o.h/2])].filter(y=>y>=edgeBottom&&y<=top).sort((a,b)=>a-b);
        for(let k=0;k<levels.length-1;k++){const lo=levels[k],hi=levels[k+1];if(hi-lo<.001)continue;const blocked=openings.filter(o=>o.y-o.h/2<(lo+hi)/2&&o.y+o.h/2>(lo+hi)/2).sort((a,b)=>a.x-b.x);let cursor=0;for(const o of blocked){box((cursor+o.x-o.w/2)/2,(lo+hi)/2,o.x-o.w/2-cursor,hi-lo,.76,masonry);cursor=Math.max(cursor,o.x+o.w/2);}box((cursor+length)/2,(lo+hi)/2,length-cursor,hi-lo,.76,masonry);}
        const plinthTop=stepFrom===undefined?base+profile.plinth:-Infinity,plinthLevels=[bottom,legacyBottom,plinthTop,...openings.flatMap(o=>[o.y-o.h/2,o.y+o.h/2])].filter(y=>y>=bottom&&y<=plinthTop).sort((a,b)=>a-b);
        for(let k=0;k<plinthLevels.length-1;k++){const lo=plinthLevels[k],hi=plinthLevels[k+1];if(hi-lo<.001)continue;const blocked=openings.filter(o=>o.y-o.h/2<(lo+hi)/2&&o.y+o.h/2>(lo+hi)/2).sort((a,b)=>a.x-b.x);let cursor=0;for(const o of blocked){box((cursor+o.x-o.w/2)/2,(lo+hi)/2,o.x-o.w/2-cursor,hi-lo,.14,stone,.035);cursor=Math.max(cursor,o.x+o.w/2);}box((cursor+length)/2,(lo+hi)/2,length-cursor,hi-lo,.14,stone,.035);}

        // Keep the floor belt fixed, but interrupt it at an elevated portal.
        // Otherwise this horizontal trim would run through the relocated door.
        const beltY=base+(b.abbr==='WAG'?4.6:b.floorHeight)-.1;
        const elevatedPortals=openings.filter(o=>o.door&&o.y-o.h/2>base+.001&&beltY+.12>o.y-o.h/2&&beltY-.12<o.y+o.h/2).sort((a,b)=>a.x-b.x);
        let beltCursor=0;
        for(const portal of elevatedPortals){const left=Math.max(0,portal.x-portal.w/2-.3),right=Math.min(length,portal.x+portal.w/2+.3);box((beltCursor+left)/2,beltY,left-beltCursor,.24,.24,stone,.02);beltCursor=Math.max(beltCursor,right);}
        if(beltY>edgeBottom)box((beltCursor+length)/2,beltY,length-beltCursor,.24,.24,stone,.02);
        box(length/2,top-.35,length,.25,.45,stone,.1);
        if(profile.finEdges?.includes(edge)){
          for(let f=1;f<=b.floors;f++)box(length/2,base+f*b.floorHeight-.16,length,.4,1.05,stone,.3);
          // Piers stand on the foundation (no floating 0.4 m gap over the planting soil).
          for(let j=0;j<=count;j++)box(length*j/count,(edgeBottom+top+.175)/2,.45,top+.175-edgeBottom,1.45,stone,.35);
        }
        if(profile.flatRoof)box(length/2,top+.22,length,.42,.45,stone,-.08);
        if(b.abbr==='WAG'&&profile.atticHeight){
          // The photographed attic is a continuous limestone band, not brick
          // with white outlines. Partition it around the actual pane apertures.
          const low=top-profile.atticHeight;
          const levels=[low,top,...openings.flatMap(o=>[o.y-o.h/2,o.y+o.h/2])].filter(y=>y>=low&&y<=top).sort((a,b)=>a-b);
          for(let k=0;k<levels.length-1;k++){
            const lo=levels[k],hi=levels[k+1];if(hi-lo<.001)continue;
            const row=openings.filter(o=>o.y-o.h/2<(lo+hi)/2&&o.y+o.h/2>(lo+hi)/2).sort((a,b)=>a.x-b.x);
            let cursor=0;
            for(const o of row){box((cursor+o.x-o.w/2)/2,(lo+hi)/2,o.x-o.w/2-cursor,hi-lo,.14,stone,.035);cursor=Math.max(cursor,o.x+o.w/2);}
            box((cursor+length)/2,(lo+hi)/2,length-cursor,hi-lo,.14,stone,.035);
          }
          box(length/2,low-.19,length,.2,.44,stone,.1);
          box(length/2,low-.04,length,.1,.55,stone,.13);
        }
        if(profile.atticHeight)box(length/2,top-profile.atticHeight-.07,length,.22,.34,stone,.08);
        if(b.abbr==='WAG'){
          // The Barera corner photograph shows shallow rusticated brick ends
          // and exposed downpipes, which break up the otherwise flat elevations.
          for(let y=plinthTop+.2;y<top-(profile.atticHeight??0)-.3;y+=.74)
            for(const x of [.53,length-.53])box(x,y,1.06,.27,.18,brick,.075);
          const pipes=length>30?[.22,.78]:[];
          for(const t of pipes){
            const low=plinthTop+.12,high=top-.5;
            placed(new T.CylinderGeometry(.06,.06,high-low,8).translate(length*t,(low+high)/2,.22),iron);
            for(let y=low+.5;y<high;y+=2.1)box(length*t,y,.19,.05,.23,iron,.15);
          }
        }
        for(const o of openings){
          const depth=.63,trimWidth=o.door?.3:.105;
          const attic=!!profile.atticHeight&&o.y>top-profile.atticHeight;
          const trim=b.abbr==='WAG'&&!o.door&&!attic&&o.y>base+profile.plinth?brick:stone;
          for(const side of [-1,1])box(o.x+side*(o.w/2+trimWidth/2),o.y,trimWidth,o.h+trimWidth*2,.83,trim,-.32);
          box(o.x,o.y+o.h/2+trimWidth/2,o.w+trimWidth*2,trimWidth,.84,trim,-.32);
          box(o.x,o.y-o.h/2-.07,o.w+.35,.14,1.0,stone,-.22);
          box(o.x,o.y,o.w,o.h,.09,o.door?wood:((o.basement?basementWindows:windows)%4===0?shade:glass),-depth,!o.door&&(b.abbr==='EPS'||b.abbr==='BRB'));
          const schochFrontPane=b.abbr==='EPS'&&(edge===0||edge===5)&&!o.door;
          const schochLower=schochFrontPane&&o.y<base+b.floorHeight;
          const columns=o.door?2:b.abbr==='WAG'&&attic?2:schochLower?6:profile.frameColumns,rows=o.door?2:o.basement?3:b.abbr==='WAG'&&attic?4:profile.frameRows;
          const paneFrame=b.abbr==='WAG'&&!attic?waggenerFrame:frame;
          if(b.abbr==='EPS'&&!o.door){
            // Steel sash has a perimeter frame and a stronger center mullion;
            // the fine 28 mm glazing bars alone leave floating panes.
            for(const side of [-1,1]){
              box(o.x+side*(o.w/2-.035),o.y,.07,o.h,.09,frame,-depth+.065);
              box(o.x,o.y+side*(o.h/2-.035),o.w,.07,.09,frame,-depth+.065);
            }
            box(o.x,o.y,.065,o.h,.10,frame,-depth+.075);
          }
          if(b.abbr==='WAG'&&!o.door){
            const outer=attic?stone:waggenerFrame;
            for(const side of [-1,1]){
              box(o.x+side*(o.w/2-.035),o.y,.07,o.h,.08,outer,-depth+.055);
              box(o.x,o.y+side*(o.h/2-.035),o.w,.07,.08,outer,-depth+.055);
            }
          }
          for(let j=1;j<columns;j++)box(o.x-o.w/2+o.w*j/columns,o.y,.028,o.h,.07,paneFrame,-depth+.06);
          for(let j=1;j<rows;j++)box(o.x,o.y-o.h/2+o.h*j/rows,o.w,.027,.07,paneFrame,-depth+.06);
          if(o.arch){
            const radius=o.w/2,spring=o.y+o.h/2-radius;
            // Fill the two corners of the rectangular construction opening.
            // Their curved inner edge leaves a true round-headed aperture.
            const cap=new T.Shape();cap.moveTo(-radius,spring);cap.lineTo(-radius,o.y+o.h/2);cap.lineTo(radius,o.y+o.h/2);cap.lineTo(radius,spring);cap.absarc(0,spring,radius,0,Math.PI,false);cap.closePath();
            placed(new T.ExtrudeGeometry(cap,{depth:.74,steps:1,bevelEnabled:false,curveSegments:18}).translate(o.x,0,-.74),stone);
            const surround=new T.Shape();surround.absarc(0,spring,radius+.21,0,Math.PI,false);surround.lineTo(-radius,spring);surround.absarc(0,spring,radius,Math.PI,0,true);surround.closePath();
            placed(new T.ExtrudeGeometry(surround,{depth:.23,steps:1,bevelEnabled:false,curveSegments:18}).translate(o.x,0,.05),stone);
          }
          // Probe inside a pane, avoiding frame bars.
          witness(o.x-o.w/2+o.w/columns*.38,o.y-o.h/2+o.h/rows*(o.door?.38:Math.floor(rows/2)+.38),o.door?'recessed doorway':o.basement?'recessed basement window':'recessed multipane window',2.45);
          if(o.door){doors++;const doorwayBase=o.doorwayBase??base;entrancePoints.push({abbr:b.abbr,position:new T.Vector3(o.x,doorwayBase,0).applyMatrix4(transform).toArray(),normal:out.toArray()});
            for(const side of [-1,1]){box(o.x+side*(o.w/2+.55),doorwayBase+(o.h+.8)/2,.42,o.h+.8,.4,stone,.16);box(o.x+side*(o.w/2+.85),doorwayBase+2.65,.12,.68,.2,iron,.34);}
            box(o.x,doorwayBase+o.h+.72,o.w+1.7,.25,.82,stone,.3);box(o.x,doorwayBase+o.h+.97,o.w+1.98,.16,.96,stone,.33);
            if(profile.entryStyle==='paired-pilaster'){for(const side of [-1,1])box(o.x+side*(o.w/2+.48),(top+doorwayBase+4.5)/2,.25,top-doorwayBase-4.5,.23,stone,.11);}
            if(profile.entryStyle==='arched-balcony'){
              const y=doorwayBase+b.floorHeight+.05;box(o.x,y,o.w+2.9,.25,1.15,stone,.6);
              for(let k=0;k<19;k++)box(o.x-(o.w+2.7)/2+k*(o.w+2.7)/18,y+.65,.038,1.05,.045,iron,1.14);
              box(o.x,y+1.16,o.w+2.9,.065,.08,iron,1.14);
              for(const side of [-1,1])box(o.x+side*(o.w/2+.5),y-.55,.32,.9,.8,stone,.3);
            }
            if(profile.entryStyle==='arched-central-bay')for(const side of [-1,1]){box(o.x+side*(o.w/2+.8),(doorwayBase+top)/2,.5,top-doorwayBase,.3,stone,.16);for(const dx of [-.13,.13])box(o.x+side*(o.w/2+1.22)+dx,doorwayBase+3.1,.035,1.05,.18,iron,.52);box(o.x+side*(o.w/2+1.22),doorwayBase+3.64,.36,.08,.25,iron,.52);}
            if(profile.entryStyle==='stepped-lintel'){
              box(o.x,doorwayBase+3.98,o.w+.36,.15,.35,stone,.31);
              box(o.x,doorwayBase+4.76,.8,.36,.22,stone,.18);
              if(b.abbr==='EPS'){
                // Reference-supported layered lintel and recessed rectangular
                // pilaster panels break up the generic solid doorway blocks.
                for(const side of [-1,1])for(const y of [.55,1.25,1.95,2.65]){
                  box(o.x+side*(o.w/2+.55),doorwayBase+y,.34,.52,.035,soffit,.377);
                  box(o.x+side*(o.w/2+.55),doorwayBase+y,.28,.45,.028,stone,.399);
                }
                box(o.x,doorwayBase+o.h+.4,o.w+.6,.14,.47,stone,.18);
                // Door transom, recessed leaves, stile and visible handles.
                box(o.x,doorwayBase+o.h-.48,o.w-.12,.72,.055,glass,-depth+.055);
                box(o.x,doorwayBase+o.h-.9,o.w,.06,.09,wood,-depth+.095);
                for(const side of [-1,1]){
                  box(o.x+side*.11,doorwayBase+1.25,.025,.34,.10,iron,-depth+.17);
                  box(o.x+side*(o.w/4),doorwayBase+1.25,o.w/2-.20,1.75,.035,glass,-depth+.054);
                }
                if(edge===3){
                  const width=4.35,landing=1.25,run=.34;
                  // Use the installed approach grade, not an independent flat
                  // elevation. Keep the first riser short enough for walking.
                  const estimate=new T.Vector3(o.x,0,4.25).applyMatrix4(transform);
                  const foot=options.groundHeight(estimate.x,estimate.z);
                  const steps=Math.max(1,Math.ceil((doorwayBase-foot)/.15));
                  if(!Number.isFinite(foot)||steps>14||doorwayBase<=foot)
                    throw new Error('Schoch south stairs need a lower, finite approach grade');
                  const rise=(doorwayBase-foot)/steps,reach=landing+run*steps;
                  const fillBottom=foot-.25;
                  box(o.x,(fillBottom+doorwayBase)/2,width,doorwayBase-fillBottom,landing,stairConcrete,landing/2);
                  for(let k=0;k<steps;k++){
                    const y=doorwayBase-(k+1)*rise,z=landing+(k+.5)*run;
                    box(o.x,(fillBottom+y)/2,width,y-fillBottom,run,stairConcrete,z);
                    // Shallow projecting nosings retain a solid matching
                    // collision surface, with no displacement-only steps.
                    box(o.x,y-.023,width+.04,.046,.065,stairConcrete,z+run/2-.012);
                  }
                  // Continuous side curbs follow the flight, as in L007,
                  // instead of a separate vertical block for each tread.
                  for(const side of [-1,1]){
                    const cheek=new T.Shape([
                      new T.Vector2(0,fillBottom),new T.Vector2(-reach,fillBottom),
                      new T.Vector2(-reach,foot+.24),new T.Vector2(-landing,doorwayBase+.24),
                      new T.Vector2(0,doorwayBase+.24),
                    ]);
                    placed(new T.ExtrudeGeometry(cheek,{depth:.3,bevelEnabled:false,steps:1})
                      .rotateY(Math.PI/2).translate(o.x+side*(width/2+.16)-.15,0,0),stairConcrete);
                  }
                  const rail=(a:T.Vector3,b:T.Vector3)=>{
                    const direction=b.clone().sub(a);
                    const g=new T.CylinderGeometry(.024,.024,direction.length(),8)
                      .applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),direction.normalize()))
                      .translate(...a.clone().add(b).multiplyScalar(.5).toArray() as [number,number,number]);
                    placed(g,iron);
                  };
                  // Paired slim central rails are visible in L007. Leave the
                  // landing clear in front of the closed exterior doorway.
                  for(const side of [-1,1]){
                    const x=o.x+side*.11;
                    rail(new T.Vector3(x,doorwayBase+.9,landing+.16),new T.Vector3(x,foot+.9,reach-.1));
                    for(const fraction of [0,.5,1]){
                      const z=T.MathUtils.lerp(landing+.16,reach-.1,fraction);
                      const surface=doorwayBase-Math.min(steps,Math.floor((z-landing)/run)+1)*rise;
                      const topY=T.MathUtils.lerp(doorwayBase+.9,foot+.9,fraction);
                      rail(new T.Vector3(x,surface,z),new T.Vector3(x,topY,z));
                    }
                  }
                }
              }
            }
          }else if(o.basement)basementWindows++;else windows++;
        }
        if(length>5)witness(.3*length,top-.85,'upper masonry');
      }
    }
    // A pitched roof uses the main mass even when an entrance adds footprint
    // vertices. The old implementation silently omitted Schoch's roof slope.
    if(profile.flatRoof){add(new T.ExtrudeGeometry(shape(b.rings),{depth:.2,bevelEnabled:false,steps:1}).rotateX(-Math.PI/2).translate(0,top,0),soffit);}else for(const roofRectangle of b.roofRectangles??[b.roofRectangle]){
    const corners=roofRectangle.map(p=>new T.Vector3(p[0],top+.05,p[1]));
    if(corners[0].distanceTo(corners[1])<corners[1].distanceTo(corners[2]))corners.push(corners.shift()!);
    const center=corners.reduce((v,p)=>v.add(p),new T.Vector3()).multiplyScalar(.25);
    for(const p of corners){
      if(b.abbr==='WAG'){
        // Capture stable axes from the original rectangle, not mutated corners.
        const axis=new T.Vector3(roofRectangle[1][0]-roofRectangle[0][0],0,roofRectangle[1][1]-roofRectangle[0][1]).normalize();
        const cross=new T.Vector3(-axis.z,0,axis.x),delta=p.clone().sub(center);
        p.addScaledVector(axis,Math.sign(delta.dot(axis))*profile.roofOverhang).addScaledVector(cross,Math.sign(delta.dot(cross))*profile.roofOverhang);
      }else{const d=p.clone().sub(center);d.y=0;p.addScaledVector(d.normalize(),profile.roofOverhang);}
    }
    const left=corners[0].clone().lerp(corners[3],.5),right=corners[1].clone().lerp(corners[2],.5),inset=b.abbr==='WAG'?corners[0].distanceTo(corners[3])/(2*left.distanceTo(right)):.16,ridgeA=left.clone().lerp(right,inset),ridgeB=left.clone().lerp(right,1-inset);ridgeA.y+=profile.roofRise;ridgeB.y+=profile.roofRise;
    const roofFaces=[[corners[0],corners[1],ridgeB],[corners[0],ridgeB,ridgeA],[corners[1],corners[2],ridgeB],[corners[2],corners[3],ridgeA],[corners[2],ridgeA,ridgeB],[corners[3],corners[0],ridgeA]];
    const vertices=roofFaces.flatMap(tri=>{if(new T.Vector3().crossVectors(tri[1].clone().sub(tri[0]),tri[2].clone().sub(tri[0])).y<0)return[tri[0],tri[2],tri[1]];return tri;});const roofGeometry=new T.BufferGeometry().setFromPoints(vertices);roofGeometry.computeVertexNormals();
    setHistoricRoofMetreUV(roofGeometry,[
      {start:0,count:6,eaveStart:corners[0],eaveEnd:corners[1]},
      {start:6,count:3,eaveStart:corners[1],eaveEnd:corners[2]},
      {start:9,count:6,eaveStart:corners[2],eaveEnd:corners[3]},
      {start:15,count:3,eaveStart:corners[3],eaveEnd:corners[0]},
    ]);
    add(roofGeometry,roof,true);
    if(b.abbr==='WAG')brackets+=addWaggenerEaves(corners,top,profile.roofOverhang,{stone,soffit,roof,wood},add);
    else for(let i=0;i<4;i++){const a=corners[i],q=corners[(i+1)%4],length=a.distanceTo(q),direction=q.clone().sub(a).normalize(),normal=new T.Vector3(-direction.z,0,direction.x),matrix=new T.Matrix4().makeBasis(direction,new T.Vector3(0,1,0),normal).setPosition(a.x,0,a.z);
      add(new T.BoxGeometry(length,.2,.8).translate(length/2,top-.08,0).applyMatrix4(matrix),soffit);
      // Barrel ends and brackets give the eaves depth in pedestrian views.
      const tiles=Math.ceil(length/.24);for(let j=0;j<tiles;j++){const g=new T.CylinderGeometry(.09,.09,.36,6,1,true,Math.PI/2,Math.PI).rotateX(Math.PI/2).translate(length*(j+.5)/tiles,top+.1,.1).applyMatrix4(matrix);add(g,roof);}
      if(profile.soffitBrackets)for(let j=0;j<Math.floor(length/2.3);j++){add(new T.BoxGeometry(.17,.4,.75).translate((j+.5)*length/Math.floor(length/2.3),top-.3,-.15).applyMatrix4(matrix),soffit);brackets++;}
    }
    }
    volumes.push(...cut(b.rings,legacyBottom-.1,b.cutTop??top+profile.roofRise+1));
    roofPeak=Math.max(roofPeak,profile.flatRoof?top+.43:top+.05+profile.roofRise);
    if(selected[buildingIndex+1]?.abbr===b.abbr)continue;
    for(const [m,parts]of batches){const flat=parts.map(g=>g.index?g.toNonIndexed():g),g=mergeGeometries(flat)!;g.computeBoundingBox();g.computeBoundingSphere();const mesh=new T.Mesh(g,m);mesh.name=`${b.abbr} ${m.name}`;mesh.castShadow=mesh.receiveShadow=true;meshes.push(mesh);for(const part of new Set([...parts,...flat]))part.dispose();}
    const own=meshes.slice(start),parts=selected.filter(q=>q.abbr===b.abbr);
    buildingStats.push({abbr:b.abbr,referenceIds:profile.refs,parts:parts.length,eaves:[...new Set(parts.map(q=>q.eave??null))],windows:windows+basementWindows,basementWindows,doors,eaveBrackets:brackets,triangles:own.reduce((n,m)=>n+m.geometry.attributes.position.count/3,0),materialBatches:own.length,baseElevation:base,roofPeak});
    batches=new Map();windows=doors=brackets=basementWindows=0;start=meshes.length;roofPeak=-Infinity;
  }
  const abbreviations=[...new Set(selected.map(b=>b.abbr))];
  return {meshes,materials,basementOpenings,colliderGeometries:meshes.map(m=>m.geometry),volumes,samples,entrancePoints,stats:{buildings:abbreviations.length,perBuilding:buildingStats,triangles:meshes.reduce((n,m)=>n+m.geometry.attributes.position.count/3,0),materialBatches:meshes.length},replacementAbbreviations:abbreviations};
}
