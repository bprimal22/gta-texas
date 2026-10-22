import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CutVolume } from './clip-volume';
import type { pclMaterials } from './pcl-materials';
import { buildPclEntry } from './pcl-entry';
import { pclEntryPlan } from './pcl-entry-plan';

// GIS face endpoints; bay counts/depths and floor elevations are photo-informed.
// Local streamed roof probes are approximately y=23.06. Do not reuse the old
// procedural footprint's 36.1 m maximum height as the façade's full elevation.
export const pclFaces = [
  { name: 'northeast', a: [-121.17,298.87], b: [-85.87,339.9], bays: 14, margin: 8.5 },
  { name: 'southeast', a: [-55.1,397.23], b: [-103.49,438.95], bays: 17, margin: 9.5 },
  { name: 'east blank wall', a: [-47.52,338.96], b: [-52.46,398.62], bays: 0, margin: 0 },
  { name: 'north blank wall', a: [-85.87,339.9], b: [-47.52,338.96], bays: 0, margin: 0 },
] as const;
export const pclFloors = [
  [-4.2,0.35], [0.35,4.8], [6.35,10.45], [10.45,14.5], [14.5,18.55], [18.55,22.6],
] as const;

export function buildPclFacades(materials: ReturnType<typeof pclMaterials>, ground: THREE.Material, options: {flutedRelief?:boolean; recessedEntry?:boolean} = {}) {
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const volumes: CutVolume[] = [];
  let bayCount = 0, flutedRibs = 0;
  for (const face of pclFaces) {
    const a = new THREE.Vector3(face.a[0],0,face.a[1]);
    const b = new THREE.Vector3(face.b[0],0,face.b[1]);
    const length = a.distanceTo(b);
    const u = b.clone().sub(a).normalize();
    // Endpoints run clockwise around this portion of the building in X/Z.
    const out = new THREE.Vector3(u.z,0,-u.x);
    const rotation = new THREE.Matrix4().makeBasis(u,new THREE.Vector3(0,1,0),out);
    const world = (x: number, y: number, z: number) =>
      a.clone().addScaledVector(u,x).addScaledVector(out,z).setY(y);
    const add = (geometry: THREE.BufferGeometry, material: THREE.Material) => {
      geometry.applyMatrix4(rotation).translate(a.x,0,a.z);
      // U/up/out is reflected relative to Three's right-handed box convention.
      // Reverse triangles as well as transforming positions, preserving culling.
      const index=geometry.index;
      if (index) {
        for (let i=0;i<index.count;i+=3) {
          const saved=index.getX(i+1);
          index.setX(i+1,index.getX(i+2)); index.setX(i+2,saved);
        }
      } else {
        for (const attribute of Object.values(geometry.attributes))
          for (let i=0;i<attribute.count;i+=3)
            for (let c=0;c<attribute.itemSize;c++) {
              const saved=attribute.getComponent(i+1,c);
              attribute.setComponent(i+1,c,attribute.getComponent(i+2,c));
              attribute.setComponent(i+2,c,saved);
            }
      }
      geometry.computeVertexNormals();
      if (!batches.has(material)) batches.set(material,[]);
      batches.get(material)!.push(geometry);
    };
    const box = (x: number, y: number, depth: number,
      width: number, height: number, thickness: number, material: THREE.Material) => {
      const g = new THREE.BoxGeometry(width,height,thickness);
      g.translate(x,y,depth);
      const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
      for (let i=0;i<p.count;i++) {
        const side = Math.abs(n.getX(i))>.5;
        const top = Math.abs(n.getY(i))>.5;
        uv.setXY(i,side?p.getZ(i):p.getX(i),top?p.getZ(i):p.getY(i));
      }
      add(g,material);
    };
    const wall = (start: number, end: number, low: number, high: number) =>
      box((start+end)/2,(low+high)/2,-.75,end-start,high-low,1.9,materials.concrete);
    const angledPanel = (x0: number,z0: number,x1: number,z1: number,
      low: number,high: number,thickness: number,material: THREE.Material) => {
      const span=Math.hypot(x1-x0,z1-z0);
      if (options.flutedRelief && material===materials.fluted) {
        // Real corrugation along the angled precast infill produces grazing
        // highlights and silhouette relief. A1.8cm crest is intentionally
        // shallow; this is concrete texture, not invented large facade fins.
        const count=Math.max(3,Math.round(span/.075));
        const direction=new THREE.Vector2((x1-x0)/span,(z1-z0)/span);
        const normal=new THREE.Vector2(-direction.y,direction.x);
        const profile:THREE.Vector2[]=[];
        for(let rib=0;rib<count;rib++)for(const [fraction,crest] of[[0,0],[.23,.018],[.70,.018],[1,0]])
          profile.push(new THREE.Vector2((rib+fraction)*span/count,thickness/2+crest));
        // Remove coincident vertices where neighboring troughs meet.
        const unique=profile.filter((p,i)=>i===0||p.distanceTo(profile[i-1])>1e-8);
        unique.push(new THREE.Vector2(span,-thickness/2),new THREE.Vector2(0,-thickness/2));
        const shape=new THREE.Shape(unique),g=new THREE.ExtrudeGeometry(shape,{depth:high-low,bevelEnabled:false,steps:1});
        const pos=g.attributes.position,uv=g.attributes.uv;
        for(let k=0;k<pos.count;k++){
          const u=pos.getX(k),depth=pos.getY(k),y=low+pos.getZ(k);
          pos.setXYZ(k,x0+direction.x*u+normal.x*depth,y,z0+direction.y*u+normal.y*depth);uv.setXY(k,u,y);
        }
        // Profile/extrusion basis has negative determinant; correct winding
        // here, then add() applies the facade's separate reflected transform.
        for(const attribute of Object.values(g.attributes))for(let i=0;i<attribute.count;i+=3)
          for(let c=0;c<attribute.itemSize;c++){
            const saved=attribute.getComponent(i+1,c);attribute.setComponent(i+1,c,attribute.getComponent(i+2,c));attribute.setComponent(i+2,c,saved);
          }
        g.computeVertexNormals();add(g,material);flutedRibs+=count;return;
      }
      const g=new THREE.BoxGeometry(span,high-low,thickness);
      g.rotateY(Math.atan2(z0-z1,x1-x0));
      g.translate((x0+x1)/2,(low+high)/2,(z0+z1)/2);
      const p=g.attributes.position,uv=g.attributes.uv;
      for(let k=0;k<p.count;k++) uv.setXY(k,p.getX(k),p.getY(k));
      add(g,material);
    };
    if (face.name==='north blank wall' && options.recessedEntry) {
      wall(0,pclEntryPlan.start,-4.2,23.8);
      wall(pclEntryPlan.end,length,-4.2,23.8);
      wall(pclEntryPlan.start,pclEntryPlan.end,pclEntryPlan.soffitY,23.8);
    } else if (!face.bays) wall(0,length,-4.2,23.8);
    else {
      const end = length-face.margin;
      const bayPitch = (end-face.margin)/face.bays;
      wall(0,face.margin,-4.2,23.8);
      wall(end,length,-4.2,23.8);
      // A backing/recess surface closes the exterior without pretending to
      // supply a library interior. Windows remain opaque reflective glazing.
      box(length/2,9.8,-1.58,length,28,.2,materials.recess);
      wall(face.margin,end,4.8,6.35);
      wall(face.margin,end,22.6,23.8);
      for (const [floorIndex,[low,high]] of pclFloors.entries()) {
        const beam = floorIndex===0?.36:.43;
        wall(face.margin,end,low,low+beam);
        const clearLow = low+beam, clearHigh = high-.12;
        for (let j=0;j<=face.bays;j++)
          box(face.margin+j*bayPitch,(clearLow+high)/2,-.57,.42,high-clearLow,1.54,materials.concrete);
        for (let j=0;j<face.bays;j++) {
          const center = face.margin+(j+.5)*bayPitch;
          const width = bayPitch-.42, height = clearHigh-clearLow;
          const middle = (clearHigh+clearLow)/2;
          if (floorIndex===0) {
            box(center,middle,-1.12,width,height,.08,materials.glass);
            box(center,middle,-1.05,.06,height,.09,materials.frame);
          } else {
            // The official upper-floor plan shows angled window reveals. A
            // recessed V of glazing and fluted infill reads differently from
            // the north and Speedway, as the reference photographs do. A flat
            // panel with a narrow coplanar slit hid all glass at walking angles.
            const left=center-width/2, apex=center-.35, right=center+width/2;
            angledPanel(left,.08,apex,-1.17,clearLow,clearHigh,.055,materials.glass);
            angledPanel(apex,-1.17,right,.08,clearLow,clearHigh,.18,materials.fluted);
            for (const [x,z] of [[left,.08],[apex,-1.17]])
              box(x,middle,z,.05,height,.07,materials.frame);
            angledPanel(left,.10,apex,-1.15,clearLow+.48,clearLow+.53,.07,materials.frame);
            // Solid wedge above each opening, not a texture painted on a plane.
            const shape = new THREE.Shape();
            shape.moveTo(-.82,clearHigh-.82);
            shape.lineTo(.19,clearHigh-.32);
            shape.lineTo(.19,clearHigh);
            shape.lineTo(-.82,clearHigh);
            shape.closePath();
            const wedge = new THREE.ExtrudeGeometry(shape,{depth:width,bevelEnabled:false,steps:1});
            // Shape X is local façade depth; extrusion Z becomes horizontal U.
            const p = wedge.attributes.position, uv = wedge.attributes.uv;
            for (let k=0;k<p.count;k++) {
              const depth=p.getX(k), y=p.getY(k), x=center+width/2-p.getZ(k);
              p.setXYZ(k,x,y,depth); uv.setXY(k,x,y);
            }
            wedge.computeVertexNormals();
            add(wedge,materials.concrete);
          }
          bayCount++;
        }
      }
    }
    // Close the narrow strip removed from the retained source roof.
    box(length/2,23.04,-1.2,length,.16,2.8,materials.concrete);
    // Keep the source-ground boundary covered when its old wall triangles go.
    // The east apron follows low ray samples at 5%,25%,50%,75%,95% of this face;
    // the two diagonal faces border recessed level-1 lightwells near y=-4.2.
    const groundProfile = face.bays
      ? [[0,-4.2],[1,-4.2]]
      : face.name==='north blank wall' ? [[0,.35],[1,.0]]
      : [[0,-1.68],[.05,-1.70],[.25,-1.91],[.5,-2.475],[.75,-2.77],[.95,-3.20],[1,-3.28]];
    for (let i=1;i<groundProfile.length;i++) {
      const [start,y0]=groundProfile[i-1], [end,y1]=groundProfile[i];
      const span=(end-start)*length;
      const g=new THREE.BoxGeometry(span,.25,2.45);
      g.translate((start+end)*length/2,(y0+y1)/2-.11,1.025);
      const p=g.attributes.position,uv=g.attributes.uv;
      for (let j=0;j<p.count;j++) {
        const t=(p.getX(j)-start*length)/span;
        p.setY(j,p.getY(j)+(t-.5)*(y1-y0));
        uv.setXY(j,p.getX(j)/2,p.getZ(j)/2);
      }
      add(g,face.bays?materials.concrete:ground);
    }
    // Only replace this exterior skin; keep the original roof and other faces.
    // These bounded bands are approximate registration. A tile's declared
    // geometric error does not establish that every source fragment is inside.
    const clearance = (inside: number, outside: number, low: number, high: number) => {
      const planes=[
        new THREE.Plane().setFromNormalAndCoplanarPoint(u.clone().negate(),world(-.08,0,0)),
        new THREE.Plane().setFromNormalAndCoplanarPoint(u,world(length+.08,0,0)),
        new THREE.Plane().setFromNormalAndCoplanarPoint(out.clone().negate(),world(0,0,inside)),
        new THREE.Plane().setFromNormalAndCoplanarPoint(out,world(0,0,outside)),
        new THREE.Plane(new THREE.Vector3(0,-1,0),low),
        new THREE.Plane(new THREE.Vector3(0,1,0),-high),
      ];
      const center=world(length/2,(low+high)/2,(inside+outside)/2);
      if (planes.some((plane)=>plane.distanceToPoint(center)>0))
        throw Error('PCL façade clearance orientation is invalid');
      const bounds=new THREE.Box3().setFromPoints(
        [-.08,length+.08].flatMap(x=>[inside,outside].flatMap(z=>[low,high].map(y=>world(x,y,z)))));
      volumes.push({planes,bounds});
    };
    clearance(-2.6,2.25,-4.35,24);
    // Some malformed source triangles project several metres from the wall.
    // Clear that upper band without cutting a wider trench at ground level.
    // The southeast grade is lower; its existing low retaining edge remains.
    clearance(1.9,6,face.name==='southeast'?-1.45:1.5,24);

  }
  const meshes: THREE.Mesh[]=[];
  for (const [material,parts] of batches) {
    // BoxGeometry is indexed; ExtrudeGeometry is not. Normalize only this small
    // authored asset before batching instead of generating hundreds of draws.
    const normalized=parts.map(p=>p.index?p.toNonIndexed():p);
    const geometry=mergeGeometries(normalized)!;
    const mesh=new THREE.Mesh(geometry,material);
    mesh.name='PCL authored façade';
    mesh.castShadow=mesh.receiveShadow=true;
    meshes.push(mesh);
    for (const p of new Set([...parts,...normalized])) p.dispose();
  }
  const entry = options.recessedEntry ? buildPclEntry(materials) : null;
  if (entry) { meshes.push(...entry.meshes); volumes.push(...entry.volumes); }
  return {meshes,volumes,bayCount,flutedRibs,faces:pclFaces.length,entry:entry?.stats};
}
