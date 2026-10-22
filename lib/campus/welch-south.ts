import * as T from 'three';
import { createCampusGlass } from './campus-glass';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import rawPlan from '../../public/data/welch-south-plan.json' with { type: 'json' };

type P = [number, number];
type Volume = { planes: T.Plane[]; bounds: T.Box3 };
type Facade = { id: string; profile: 'arcade'|'south'|'west'; a: P; b: P; upperBays: number; arcadeBays: number; entranceBay?: number; photoIds: string[]; confidence: string };
type Witness = { kind: string; facade: string; origin: number[]; direction: number[]; minimum?: number };
const plan = rawPlan as unknown as { baseElevation: number; eaveElevation:number; upperFloors: number; eaveHeight: number; roofPitch: number; roofStripDepth: number; roofCapNorthAlong:number; cutDepth: number; cutFringe: number; cutCeiling: number; cutGroundBuffer: number; sourceFootprint: P[]; facades: Facade[]; photoIds: string[]; thresholds:Record<string,number>; photoRatios:{arcadeOverStory:number;glassOverStory:number;headOverStory:number;corniceHeight:number} };

export interface WelchSouthOptions {
  /** Existing authored/native grade only; this package does not create route ground. */
  groundHeight: (x: number, z: number) => number;
  baseElevation?: number;
  /** Thresholds may differ from adjoining paths because the arcade is raised. */
  thresholdElevations?: Partial<Record<'east' | 'south' | 'west', number>>;
  eaveElevation?: number;
  cutCeiling?: number;
  /** Small registration tolerance outside these official walls, never a whole-WEL cut. */
  cutFringe?: number;
  /** Separate roof package owns the south cap. This only bridges the retained
   * north roof above the northern part of our east wall. */
  northRoofEdge?: boolean;
  /** Measured east scan remnants extend ~1 m past the official wall. */
  eastCutFringe?: number;
}

/** Southern Welch frontages only. The source inner roof and historic north wing
 * remain intact. Official UT WEL OBJECTID561 replaces the old City outline.
 * Photos: L177/L176 east arcade; L175/L021 south end; UTeach IMG_8696 west side.
 * Every rendered triangle is also returned as collision geometry.
 */
export function buildWelchSouth(options: WelchSouthOptions) {
  const base = options.baseElevation ?? plan.baseElevation;
  const eave = options.eaveElevation ?? plan.eaveElevation;
  const ceiling = options.cutCeiling ?? eave + .15;
  const fringe = options.cutFringe ?? plan.cutFringe;
  const eastFringe = options.eastCutFringe ?? fringe;
  if (!Number.isFinite(eastFringe) || eastFringe < 0 || eastFringe > 1.25) throw new Error('Invalid Welch east registration fringe');
  if (![base, eave, ceiling, fringe].every(Number.isFinite) || eave - base < 12 || eave - base > 23 || fringe < 0 || fringe > .65 || ceiling < eave || ceiling > 34) throw new Error('Invalid Welch south envelope');
  // Ratios are measured within vertical columns of L177. Changing eave/base
  // redistributes the whole floor stack, not just blank space over the windows.
  const story=(eave-base-plan.photoRatios.corniceHeight)/(plan.upperFloors+plan.photoRatios.arcadeOverStory);
  const arcade=story*plan.photoRatios.arcadeOverStory;
  const windowHeight=story*plan.photoRatios.glassOverStory;
  const headHeight=story*plan.photoRatios.headOverStory;
  const ground = (x: number, z: number) => {
    const y = options.groundHeight(x, z);
    if (!Number.isFinite(y)) throw new Error('Nonfinite Welch south ground');
    return y;
  };
  const materials: T.MeshStandardMaterial[] = [], meshes: T.Mesh[] = [], volumes: Volume[] = [], samples: Witness[] = [];
  const batches = new Map<T.MeshStandardMaterial, T.BufferGeometry[]>();
  const mat = (name: string, color: number, roughness = .88, metalness = 0) => {
    const m = new T.MeshStandardMaterial({ color, roughness, metalness });
    m.name = `Welch south ${name}`; materials.push(m); return m;
  };
  const brick = mat('mottled buff brick', 0xbc9879);
  const stone = mat('pale stone arcade', 0xbab39e);
  const trim = mat('stone heads and soffits', 0xb5ad98);
  const glass = createCampusGlass({ name:'Welch south recessed dark glazing' });
  const eastGlass = createCampusGlass({ name:'Welch east local reflection glazing' });
  materials.push(glass,eastGlass);
  const frame = mat('dark bronze window frames', 0x414a48, .56, .25);
  const roof = mat('muted terracotta eave tiles', 0x855941, .93);
  const joint = mat('shadow courses and rainwater pipe', 0x797260, .87, .06);

  // Metric UVs keep brick joints fine enough to read as masonry. No downloaded
  // facade photograph is pasted onto the mesh; the layout comes from references.
  for (const [m, cell, relief] of [[brick, [.24, .076], .0011], [stone, [.92, .53], .00025]] as const) {
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
    m.customProgramCacheKey = () => `welch-south-metric-${m.name}-${m===brick?2:1}`;
  }

  const add = (g: T.BufferGeometry, m: T.MeshStandardMaterial, matrix: T.Matrix4) => {
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, Math.abs(n.getX(i)) > .7 ? p.getZ(i) : p.getX(i), p.getY(i));
    g.applyMatrix4(matrix);
    // Our facade bases are right handed; reject an accidental reversed side.
    if (matrix.determinant() < .99) throw new Error('Welch south facade winding');
    if (!batches.has(m)) batches.set(m, []);
    batches.get(m)!.push(g);
  };
  const entrancePoints: { facade: string; position: number[]; normal: number[]; groundSample: number; estimated: boolean; openingWidth:number; sillWidth:number; sillOutwardRange:number[]; sillThickness:number; glazingOutwardDepth:number }[] = [];
  const facadeStats: { id: string; length: number; threshold: number; windowBays: number; arcadeBays: number; groundOpenings:number; sourcePhotos: string[] }[] = [];
  for (const f of plan.facades) {
    const along = new T.Vector3(f.b[0] - f.a[0], 0, f.b[1] - f.a[1]).normalize();
    const outward = new T.Vector3(-along.z, 0, along.x);
    const length = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]);
    const matrix = new T.Matrix4().makeBasis(along, new T.Vector3(0, 1, 0), outward).setPosition(f.a[0], 0, f.a[1]);
    const point = (x: number, y: number, d: number) => new T.Vector3(x, y, d).applyMatrix4(matrix);
    const estimatedThreshold=plan.thresholds[f.id];
    const threshold = options.thresholdElevations?.[f.id as keyof NonNullable<WelchSouthOptions['thresholdElevations']>] ?? estimatedThreshold;
    if (!Number.isFinite(threshold) || Math.abs(threshold - base) > 4) throw new Error('Invalid Welch south threshold');
    const bottom = Math.min(base - .25, ...[0, .25, .5, .75, 1].map(t => { const p = point(t * length, 0, .2); return ground(p.x, p.z) - .3; }));
    const box = (x: number, y: number, d: number, w: number, h: number, depth: number, m: T.MeshStandardMaterial) => {
      if (w > .0001 && h > .0001 && depth > .0001) add(new T.BoxGeometry(w, h, depth).translate(x, y, d), m, matrix);
    };
    const probe = (x: number, y: number, kind: string, minimum = 0, d = 2.2) => samples.push({ kind, facade: f.id, origin: point(x, y, d).toArray(), direction: outward.clone().negate().toArray(), minimum });
    type Opening = { x: number; w: number; bottom: number; h: number; rise: number; depth: number; door?: boolean; tall?: boolean };
    const lower: Opening[] = [], upper: Opening[] = [];
    if (f.profile === 'arcade') {
      for (let i = 0; i < f.arcadeBays; i++) {
        const x = length * (i + .5) / f.arcadeBays, pitch = length / f.arcadeBays;
        lower.push({ x, w: Math.min(3.32, pitch*.70), bottom: threshold, h: arcade*.66, rise: arcade*.10, depth: 1.06, door: i === f.entranceBay });
      }
    } else if(f.profile==='south') {
      lower.push({x:length*.5,w:3.0,bottom:threshold,h:3.05,rise:0,depth:.92,door:true});
      for(const t of[.18,.82])lower.push({x:length*t,w:2.2,bottom:base+1.30,h:2.1,rise:0,depth:.72});
    } else {
      // The actual west reference is rectangular, with a wide glazed entry
      // and a tall bay at the southwest end; it is not a second arcade facade.
      lower.push({x:length*.30,w:5.8,bottom:threshold,h:2.82,rise:0,depth:.96,door:true});
      for(const t of[.08,.54,.70]){const p=point(length*t,0,.2),lo=Math.max(base+1.15,ground(p.x,p.z)+.25);lower.push({x:length*t,w:1.38,bottom:lo,h:Math.max(.9,Math.min(1.65,base+arcade-lo-.30)),rise:0,depth:.65});}
      const cornerX=length-2.7;
      lower.push({x:cornerX,w:3.1,bottom:threshold+.1,h:Math.min(2.55,base+arcade-threshold-.30),rise:0,depth:1.02});
      upper.push({x:cornerX,w:3.1,bottom:base+arcade+.10,h:eave-base-arcade-.82,rise:0,depth:.28,tall:true});
    }
    for (let row = 0; row < plan.upperFloors; row++) for (let i = 0; i < f.upperBays-(f.profile==='west'?1:0); i++)
      upper.push({x:length*(i+.5)/f.upperBays,w:1.24,bottom:base+arcade+row*story+.025,h:windowHeight,rise:0,depth:.30});
    // These contours carve the actual wall, including the curved soffits. No
    // separate jamb is placed on the same surface, avoiding z-fighting reveals.
    const aperture = (o: Opening) => {
      const p = new T.Path(), x0 = o.x - o.w / 2, x1 = o.x + o.w / 2, y0 = o.bottom, y1 = o.bottom + o.h;
      p.moveTo(x0, y0); p.lineTo(x0, y1 - o.rise);
      if (o.rise) p.quadraticCurveTo(o.x, y1 + o.rise, x1, y1 - o.rise);
      else p.lineTo(x1, y1);
      p.lineTo(x1, y0); p.closePath(); return p;
    };
    const perforatedWall = (lo: number, hi: number, openings: Opening[], depth: number, m: T.MeshStandardMaterial) => {
      const s = new T.Shape([new T.Vector2(0, lo), new T.Vector2(length, lo), new T.Vector2(length, hi), new T.Vector2(0, hi)]);
      for (const o of openings) s.holes.push(aperture(o));
      add(new T.ExtrudeGeometry(s, { depth, steps: 1, bevelEnabled: false, curveSegments: 10 }).translate(0, 0, -depth), m, matrix);
    };
    const lowerTop = base + arcade;
    perforatedWall(bottom, lowerTop, lower, 1.12, stone);
    perforatedWall(lowerTop, eave - .28, upper, .56, brick);
    for (const o of [...lower, ...upper]) {
      const isLower = lower.includes(o), darkDepth = isLower ? 1.15 : o.depth + .30;
      const pane = new T.ShapeGeometry(new T.Shape(aperture(o).getPoints(12)), 12).translate(0, 0, -darkDepth);
      add(pane, f.id==='east'?eastGlass:glass, matrix);
      // Thin sash sits ahead of the pane, inset from masonry, with no duplicate
      // aperture-side surfaces. In arcade bays, the frame is rectangular below
      // the arch; the dark arch cap reads as the deeper concourse shadow.
      const frameH = o.h - o.rise, frameY = o.bottom + frameH / 2;
      for (const sign of [-1, 1]) box(o.x + sign * (o.w / 2 - .044), frameY, -darkDepth + .055, .062, frameH, .065, frame);
      box(o.x, o.bottom + .03, -darkDepth + .055, o.w - .08, .06, .065, frame);
      box(o.x, o.bottom + frameH - .03, -darkDepth + .055, o.w - .08, .06, .065, frame);
      if (o.tall) {
        for (let row = 1; row < 7; row++) box(o.x, o.bottom + o.h * row / 7, -darkDepth + .06, o.w - .08, .052, .065, frame);
        box(o.x, frameY, -darkDepth + .065, .052, frameH, .065, frame);
      } else if (!isLower) {
        box(o.x, o.bottom + .58, -darkDepth + .06, o.w - .08, .043, .07, frame);
        // Pale rectangular window heads are flush cladding panels observed in
        // L177, with a narrow gap rather than oversized classical decoration.
        box(o.x, o.bottom + o.h + .035 + headHeight/2, .017, o.w + .08, headHeight, .035, trim);
        box(o.x, o.bottom - .036, .035, o.w + .11, .072, .11, trim);
      } else {
        const transom = o.bottom + (o.door?2.36:frameH*.76);
        box(o.x, transom, -darkDepth + .062, o.w - .08, .055, .075, frame);
        const verticalH=Math.min(2.34,frameH-.10);
        box(o.x,o.bottom+verticalH/2,-darkDepth+.06,.058,verticalH,.075,frame);
        if (o.door) {
          if(o.w>4)for(const sign of[-1,1])box(o.x+sign*1.04,o.bottom+1.18,-darkDepth+.065,.058,2.34,.075,frame);
          for (const sign of [-1, 1]) box(o.x + sign * .14, o.bottom + 1.16, -darkDepth + .13, .024, .32, .055, frame);
          // This threshold supports only the recessed doorway; no surrounding
          // campus ground/ramp is invented. Root must inspect the outside join.
          box(o.x, o.bottom - .055, -.54, o.w - .10, .11, 1.20, trim);
          entrancePoints.push({ facade: f.id, position: point(o.x, o.bottom, 0).toArray(), normal: outward.toArray(), groundSample: (() => { const p = point(o.x, 0, .3); return ground(p.x, p.z); })(), estimated: true, openingWidth:o.w, sillWidth:o.w-.10, sillOutwardRange:[-1.14,.06], sillThickness:.11, glazingOutwardDepth:-darkDepth });
        }
      }
      // All ground-level arcade recesses need a floor, including the closed
      // window bays. Otherwise the capsule can step into an unsupported pocket.
      if(isLower && f.profile==='arcade' && !o.door)box(o.x,o.bottom-.055,-.54,o.w-.10,.11,1.20,trim);
      probe(o.x - o.w * .24, o.bottom + o.h * (isLower ? .44 : .48), isLower ? 'recessed ground arcade glazing' : o.tall ? 'southwest corner glazed bay' : 'slender upper window', isLower ? 3.2 : 2.75);
    }
    // Continuous shallow horizontal courses, projecting soffit and eave create
    // a clear building silhouette without thick floating roof/balcony strips.
    for (let row = 1; row < 3; row++) {
      const stop=f.profile==='west'?length-4.30:length;
      box(stop/2,base+arcade+row*story-.06,.016,stop,.034,.038,joint);
    }
    box(length / 2, eave - .23, -.13, length, .18, .87, trim);
    box(length / 2, eave - .09, -.24, length, .13, 1.14, trim);
    // The roof package owns all three sides of the projecting south cap.
    // Only the north part of the east frontage keeps a narrow continuation
    // into the retained northern roof; there is no fake north gable/end hip.
    if(f.id==='east'&&options.northRoofEdge!==false){
    const start=plan.roofCapNorthAlong;
    const d = plan.roofStripDepth, outer = .34, y0 = eave + .005, y1 = y0 + (d + outer) * plan.roofPitch;
    const r = new T.BufferGeometry();
    r.setAttribute('position', new T.Float32BufferAttribute([start,y0,outer,length,y0,outer,length,y1,-d,start,y0,outer,length,y1,-d,start,y1,-d],3));
    r.setAttribute('uv',new T.Float32BufferAttribute([0,0,length,0,length,d,0,0,length,d,0,d],2));r.computeVertexNormals();add(r,roof,matrix);
    box((start+length)/2,eave+.045,.33,length-start,.09,.115,roof);
    }
    // Small downpipes mark several real facade subdivisions; no drain is
    // projected onto the path or used as a gameplay obstruction.
    if (f.id === 'east') for (const t of [.32, .72]) {
      box(length * t, (base + eave - .18) / 2, .08, .07, eave - base - .18, .075, joint);
    }
    for (const x of [.27, length - .27]) probe(x, base + 2.2, 'solid end pier');
    facadeStats.push({ id: f.id, length, threshold, windowBays: upper.length, arcadeBays:f.arcadeBays, groundOpenings:lower.length, sourcePhotos: f.photoIds });

    // Short cut cells stay in a narrow band around only these replacement walls.
    // Floors are sampled cell-by-cell to preserve the sloping ground underneath.
    const facadeFringe = f.id === 'east' ? eastFringe : fringe;
    const cells = Math.ceil(length / 3.8);
    for (let i = 0; i < cells; i++) {
      const a = length * i / cells, b = length * (i + 1) / cells;
      const pts = [[a, -plan.cutDepth], [b, -plan.cutDepth], [b, facadeFringe], [a, facadeFringe]].map(([x, z]) => point(x, 0, z));
      const center = pts.reduce((s, p) => s.add(p), new T.Vector3()).multiplyScalar(.25);
      const low = Math.max(...pts.map(p => ground(p.x,p.z)), ground(center.x,center.z)) + plan.cutGroundBuffer;
      const planes = pts.map((a, j) => { const b = pts[(j + 1) % 4], p = new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(b.z-a.z,0,a.x-b.x).normalize(),a); if(p.distanceToPoint(center)>0)p.negate();return p; });
      planes.push(new T.Plane(new T.Vector3(0,-1,0),low),new T.Plane(new T.Vector3(0,1,0),-ceiling));
      const bounds = new T.Box3().setFromPoints(pts);bounds.min.y=low;bounds.max.y=ceiling;volumes.push({planes,bounds});
    }
  }
  for (const [m, parts] of batches) {
    const flat = parts.map(g => g.index ? g.toNonIndexed() : g), g = mergeGeometries(flat)!;
    g.computeBoundingBox();g.computeBoundingSphere();
    const mesh = new T.Mesh(g,m);mesh.name=`WEL south frontage: ${m.name}`;mesh.castShadow=mesh.receiveShadow=true;meshes.push(mesh);
    for (const part of new Set([...parts,...flat])) part.dispose();
  }
  return { meshes, materials, colliderGeometries: meshes.map(m => m.geometry), volumes, candidateClearanceVolumes: volumes, samples, entrancePoints,
    stats: { building:'WEL', scope:'Officially registered east/south frontages and full west face of south leg', base, eave, storyPitch:story,arcadeHeight:arcade,windowHeight,headHeight,cutCeiling:ceiling, eastCutFringe:eastFringe, sourcePhotoIds:plan.photoIds, facades:facadeStats, triangles:meshes.reduce((n,m)=>n+m.geometry.attributes.position.count/3,0), materialBatches:meshes.length, cutVolumes:volumes.length, calibratedEnvelope:true,exactArchitecturalSurvey:false, routeGroundCreated:false, wholeRoofReplaced:false,southCapRoofStrips:false } };
}
