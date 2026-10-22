import * as T from 'three';

type Point = [number, number, number];
export type WelchApronVolume = { planes: T.Plane[]; bounds: T.Box3 };
export type WelchApronEntrance = {
  facade: 'west' | 'east' | 'south'; position: Point; normal: Point;
  /** Width of the complete facade opening, including its glazing. */
  openingWidth?: number;
};
export interface WelchDoorwayApronOptions {
  /** Authoritative authored terrain only, sampled BEFORE trimming it. Never scan/canopy heights. */
  groundHeight: (x: number, z: number) => number;
  /** Borrowed material: this builder does not change or dispose its shaders. */
  material: T.MeshStandardMaterial;
  /** Optional current facade entrancePoints. Unlisted facades are not built. */
  entrances?: WelchApronEntrance[];
}
export const welchApronEntrances: WelchApronEntrance[] = [
  { facade:'west',position:[-47.472303022398776,6,16.32924984291715],normal:[-.9961769724079679,0,-.08735811149569886],openingWidth:5.8 },
  { facade:'east',position:[-26.145402894922842,5.8,12.561845886167465],normal:[.9959343768496564,0,.09008172405702755],openingWidth:3.32 },
  { facade:'south',position:[-38.90528227871023,6.2,37.93899038593919],normal:[-.08629701582403679,0,.9962694540433655],openingWidth:3 },
];

/** Provisional, footprint-bounded doorstep connections. The west photograph
 * establishes downsteps and retaining cheeks; dimensions and riser count are
 * inferred from the supplied threshold and the caller's current ground.
 * Trim OLD authored ground before registering ANY approach colliders. */
export function buildWelchDoorwayAprons(options: WelchDoorwayApronOptions) {
  if (!options?.groundHeight || !options.material) throw new Error('Welch aprons require authored groundHeight and a borrowed material');
  const meshes: T.Mesh[] = [], colliderGeometries: T.BufferGeometry[] = [];
  const authoredGroundTrimVolumes: WelchApronVolume[] = [], sourceClearanceVolumes: WelchApronVolume[] = [];
  const samples: {facade:string;kind:string;position:Point;minimumNormalY:number}[] = [];
  const entrances: Record<string, unknown>[] = [];
  let triangleCount = 0;
  const used = new Set<string>();
  for (const entrance of options.entrances ?? welchApronEntrances) {
    const fallback = welchApronEntrances.find(e => e.facade === entrance.facade);
    if (!fallback || used.has(entrance.facade)) throw new Error('Invalid or repeated Welch apron facade');
    used.add(entrance.facade);
    const { facade, position, normal } = entrance;
    if (![...position,...normal].every(Number.isFinite) || Math.abs(normal[1]) > 1e-6 || Math.abs(Math.hypot(...normal)-1) > 1e-5) throw new Error('Invalid Welch apron frame');
    const openingWidth = entrance.openingWidth ?? fallback.openingWidth!;
    const west = facade === 'west', width = openingWidth - (west ? .60 : .20);
    if (width < 2 || width > 6) throw new Error('Invalid Welch apron width');
    const threshold = position[1], innerY = threshold - .003, lo = -.04, hi = west ? 3.6 : 1.8;
    const out = new T.Vector3(...normal), along = new T.Vector3(out.z,0,-out.x), origin = new T.Vector3(...position);
    const point = (u:number,d:number,y:number) => origin.clone().addScaledVector(along,u).addScaledVector(out,d).setY(y);
    const sampled: {u:number;d:number;position:Point;height:number}[] = [];
    const ground = (u:number,d:number) => {
      const p = point(u,d,0), y = options.groundHeight(p.x,p.z);
      if (!Number.isFinite(y)) throw new Error(`Nonfinite authored Welch ${facade} apron ground`);
      sampled.push({u,d,position:[p.x,y,p.z],height:y}); return y;
    };
    const us = [-width/2,0,width/2], outer = us.map(u=>ground(u,hi));
    const outerMean = (outer[0]+outer[1]*2+outer[2])/4, difference = outerMean-innerY;
    if (Math.max(...outer)-Math.min(...outer) > .65) throw new Error(`Excessive authored Welch ${facade} cross grade`);
    if (west ? difference < .15 || difference > 1.35 : Math.max(...outer.map(y=>Math.abs(y-innerY))) > .75) throw new Error(`Unsupported authored Welch ${facade} grade: ${JSON.stringify({outer,threshold,difference})}`);
    const risers = west ? Math.ceil(difference/.18) : 0, rise = west ? difference/risers : 0;
    const landingEnd = west ? .75 : .30, tread = .30, stairEnd = landingEnd + risers*tread;
    type Row = {d:number;ys:number[]};
    const rows: Row[] = [{d:lo,ys:us.map(()=>innerY)},{d:landingEnd,ys:us.map(()=>innerY)}];
    for(let i=1;i<=risers;i++) {
      const d=landingEnd+(i-1)*tread,y=innerY+i*rise;
      rows.push({d,ys:us.map(()=>y)},{d:d+tread,ys:us.map(()=>y)});
    }
    rows.push({d:hi,ys:outer});
    const bottom = Math.min(innerY,...outer)-.24;
    const raw:number[]=[], normals:number[]=[];
    const tri=(a:T.Vector3,b:T.Vector3,c:T.Vector3)=>{
      const cross=new T.Vector3().crossVectors(b.clone().sub(a),c.clone().sub(a));
      if(cross.lengthSq()<1e-16)return;
      const n=cross.normalize();raw.push(...a.toArray(),...b.toArray(),...c.toArray());normals.push(...n.toArray(),...n.toArray(),...n.toArray());
    };
    const quad=(a:T.Vector3,b:T.Vector3,c:T.Vector3,d:T.Vector3)=>{tri(a,b,c);tri(a,c,d);};
    const grid=rows.map(r=>us.map((u,j)=>point(u,r.d,r.ys[j])));
    for(let r=0;r<rows.length-1;r++){
     const flat=rows[r].ys.every(y=>Math.abs(y-rows[r].ys[0])<1e-9)&&rows[r+1].ys.every(y=>Math.abs(y-rows[r+1].ys[0])<1e-9);
     const columns=flat?[0,2]:[0,1,2];
     for(let k=0;k<columns.length-1;k++){
      const j=columns[k],next=columns[k+1];
      const a=grid[r][j],b=grid[r+1][j],c=grid[r+1][next],d=grid[r][next];quad(a,b,c,d);
      if(rows[r+1].d-rows[r].d>.001){
        const p=a.clone().add(b).add(c).multiplyScalar(1/3);
        const n=new T.Vector3().crossVectors(b.clone().sub(a),c.clone().sub(a)).normalize();
        samples.push({facade,kind:west&&r>1&&r<rows.length-2?'stair tread':'landing or grade join',position:p.toArray() as Point,minimumNormalY:Math.max(.75,n.y-.005)});
      }
    }
    }
    // Boundary faces close the floor into one solid. Risers are genuine visible
    // vertical faces, not a hidden ramp under a staircase decoration.
    const edge=[...grid[0],...grid.slice(1).map(r=>r[2]),...grid.at(-1)!.slice(0,2).reverse(),...grid.slice(1,-1).reverse().map(r=>r[0])];
    const center=point(0,(lo+hi)/2,bottom-.01);
    for(let i=0;i<edge.length;i++){
      const a=edge[i],b=edge[(i+1)%edge.length],c=b.clone().setY(bottom),d=a.clone().setY(bottom);
      const n=new T.Vector3().crossVectors(b.clone().sub(a),c.clone().sub(a));
      if(n.dot(a.clone().sub(center))>0)quad(a,b,c,d);else quad(a,d,c,b);
    }
    quad(point(-width/2,lo,bottom),point(width/2,lo,bottom),point(width/2,hi,bottom),point(-width/2,hi,bottom));
    const floorAt=(u:number,d:number) => {
      // At a vertical riser, the higher (outer) tread owns the point.
      for(let i=rows.length-2;i>=0;i--){const a=rows[i],b=rows[i+1];if(d>=a.d-1e-8&&b.d-a.d>1e-8){const t=T.MathUtils.clamp((d-a.d)/(b.d-a.d),0,1),j=u<0?0:1,q=T.MathUtils.clamp((u-us[j])/(us[j+1]-us[j]),0,1);return t>=q ? a.ys[j]*(1-t)+b.ys[j]*(t-q)+b.ys[j+1]*q : a.ys[j]*(1-q)+b.ys[j+1]*t+a.ys[j+1]*(q-t);}}
      return innerY;
    };
    const cheekWidth=west?.18:0;
    if(west)for(const sign of [-1,1]){
      const u0=sign<0?-width/2-cheekWidth:width/2,u1=u0+cheekWidth;
      // Follow the surrounding authored grade, then taper the end into the
      // upper landing. No rail or retaining wall crosses the exit.
      const ds=[lo,landingEnd,stairEnd,hi],tops=ds.map((d,i)=>Math.max(floorAt(sign*width/2,d),ground(sign*(width/2+cheekWidth),d))+(i===3?.015:.12));
      for(let i=0;i<ds.length-1;i++){
        const a=point(u0,ds[i],bottom),b=point(u1,ds[i],bottom),c=point(u1,ds[i+1],bottom),d=point(u0,ds[i+1],bottom);
        const aa=a.clone().setY(tops[i]),bb=b.clone().setY(tops[i]),cc=c.clone().setY(tops[i+1]),dd=d.clone().setY(tops[i+1]);
        quad(aa,dd,cc,bb);quad(a,b,c,d);quad(a,aa,bb,b);quad(d,c,cc,dd);quad(a,d,dd,aa);quad(b,bb,cc,c);
      }
    }
    // Position+normal welding keeps coplanar triangles connected while giving
    // the masonry sharp edges. Physics consumes these exact same buffers.
    const unique:number[]=[],ns:number[]=[],indices:number[]=[],map=new Map<string,number>();
    for(let i=0;i<raw.length;i+=3){const p=raw.slice(i,i+3).map(Math.fround),n=normals.slice(i,i+3).map(Math.fround),key=[...p,...n.map(v=>Math.round(v*1e6))].join(',');let index=map.get(key);if(index===undefined){index=unique.length/3;map.set(key,index);unique.push(...p);ns.push(...n);}indices.push(index);}
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(unique,3));g.setAttribute('normal',new T.Float32BufferAttribute(ns,3));g.setIndex(indices);
    const uv:number[]=[];for(let i=0;i<unique.length;i+=3)uv.push(unique[i]*.5,unique[i+2]*.5);g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.computeBoundingBox();g.computeBoundingSphere();
    const mesh=new T.Mesh(g,options.material);mesh.name=`Welch ${facade}: ${west?'recessed downsteps':'doorway ground join'}`;mesh.castShadow=mesh.receiveShadow=true;meshes.push(mesh);colliderGeometries.push(g);triangleCount+=indices.length/3;
    const volume=(halfWidth:number,minY:number,maxY:number) => {
      // Also clear the already-modeled sill recess so its old high terrain
      // cannot block the capsule before it reaches the new downstep landing.
      // Stop 20 mm in front of the closed glazing at d=-1.15.
      const trimLo=-1.13;
      const corners=[point(-halfWidth,trimLo,minY),point(halfWidth,trimLo,minY),point(halfWidth,hi,minY),point(-halfWidth,hi,minY)],c=point(0,(trimLo+hi)/2,(minY+maxY)/2);
      const planes=corners.map((a,i)=>{const b=corners[(i+1)%4],p=new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(b.z-a.z,0,a.x-b.x).normalize(),a);if(p.distanceToPoint(c)>0)p.negate();return p;});
      planes.push(new T.Plane(new T.Vector3(0,-1,0),minY),new T.Plane(new T.Vector3(0,1,0),-maxY));
      const bounds=new T.Box3().setFromPoints(corners);bounds.max.y=maxY;return{planes,bounds};
    };
    const groundMax=Math.max(...sampled.map(s=>s.height),threshold),groundMin=Math.min(...sampled.map(s=>s.height),innerY);
    // These two lists target different owners. Ground trimming must never be
    // applied to the new stairs, facade sill, doors, or adjacent landscaping.
    authoredGroundTrimVolumes.push(volume(width/2+cheekWidth,groundMin-.40,groundMax+.30));
    sourceClearanceVolumes.push(volume(width/2+cheekWidth,groundMin-.10,groundMax+2.50));
    entrances.push({facade,position,normal,openingWidth,clearWidth:width,retainerWidth:cheekWidth,innerDistance:lo,groundTrimInnerDistance:-1.13,outerDistance:hi,threshold,innerTop:innerY,outerElevations:outer,outerMean,riserCount:risers,riserHeight:rise,treadDepth:west?tread:0,landingDepth:landingEnd-lo,stairEnd,triangles:indices.length/3,footprintArea:(width+2*cheekWidth)*(hi-lo),sampledGround:sampled,bounds:{min:g.boundingBox!.min.toArray(),max:g.boundingBox!.max.toArray()}});
    for(const u of us.map(v=>v===0?0:v-Math.sign(v)*.025))for(const d of[lo+.015,landingEnd/2,hi-.015])samples.push({facade,kind:'join endpoint',position:point(u,d,floorAt(u,d)).toArray() as Point,minimumNormalY:.75});
  }
  return{meshes,materials:[] as T.MeshStandardMaterial[],colliderGeometries,authoredGroundTrimVolumes,sourceClearanceVolumes,volumes:sourceClearanceVolumes,candidateClearanceVolumes:sourceClearanceVolumes,samples,stats:{scope:'Welch doorway connections; estimated geometry with caller sampled outer grade',triangles:triangleCount,meshCount:meshes.length,materialBatches:meshes.length,uniqueMaterials:1,authoredGroundTrimVolumes:authoredGroundTrimVolumes.length,sourceClearanceVolumes:sourceClearanceVolumes.length,entrances}};
}
