import * as THREE from 'three';

export type HedgeStrip = { a:[number,number]; b:[number,number]; y:number; endY:number; width:number; height:number };
export type HedgeCell = { x:number; y:number; z:number; width:number; height:number };

/** Keep the original 0.8 m sampling and collider inputs exactly unchanged. */
export function hedgeCells(hedges:HedgeStrip[]):HedgeCell[] {
  return hedges.flatMap(h=>{
    const length=Math.hypot(h.b[0]-h.a[0],h.b[1]-h.a[1]),count=Math.ceil(length/.8);
    return Array.from({length:count},(_,i)=>{
      const t=(i+.5)/count;
      return{x:THREE.MathUtils.lerp(h.a[0],h.b[0],t),z:THREE.MathUtils.lerp(h.a[1],h.b[1],t),
        y:THREE.MathUtils.lerp(h.y,h.endY,t),width:h.width,height:h.height};
    });
  });
}
function randomSource(seed:number){return()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return(seed>>>0)/4294967296;};}

/** Five overlapping ellipsoidal leaf clusters form a loose, rounded shrub.
 * There is deliberately NO opaque core, planar wall or solid sphere: the
 * contour and every visible surface consist of individual small leaf fans.
 * Leaves use the second TOP atlas leaf (GLTFLoader flipY=false). The final
 * envelope stays normalized to [-.5,.5], preserving placement and collisions.
 */
export function hedgeCellGeometry(leavesPerCluster=256){
  const random=randomSource(55329),positions:number[]=[],uvs:number[]=[],normals:number[]=[],colors:number[]=[];
  const clusters=[
    {center:[-.19,-.035,-.12],radius:[.32,.39,.30]},
    {center:[.16,.065,-.13],radius:[.34,.43,.29]},
    {center:[-.16,.015,.19],radius:[.34,.38,.30]},
    {center:[.19,-.065,.17],radius:[.29,.37,.32]},
    {center:[.015,-.02,.015],radius:[.30,.41,.31]},
  ];
  const outline=[[.274,.069],[.304,.195],[.266,.321],[.204,.195]],centerUv=[.257,.191];
  const texture=[centerUv,...outline],up=new THREE.Vector3(0,0,1),spanScale=Math.sqrt(256/leavesPerCluster);
  for(const [clusterIndex,cluster]of clusters.entries()){
    const radius=new THREE.Vector3(...cluster.radius),center=new THREE.Vector3(...cluster.center);
    const phase=random()*Math.PI*2;
    for(let i=0;i<leavesPerCluster;i++){
      // A jittered Fibonacci shell gives even coverage without latitude rows.
      const y=1-2*(i+.18+random()*.64)/leavesPerCluster,angle=i*2.399963229728653+phase+(random()-.5)*.24;
      const side=Math.sqrt(Math.max(0,1-y*y)),direction=new THREE.Vector3(Math.cos(angle)*side,y,Math.sin(angle)*side);
      const depth=clusterIndex===4?.36+random()*.60:.76+random()*.24;
      const offset=direction.clone().multiply(radius).multiplyScalar(depth).add(center);
      // A few centimetres of uneven crown height keeps the leaf cloud organic.
      offset.y+=.018*Math.sin(offset.x*17+offset.z*13)*(direction.y*.5+.5);
      const outward=direction.clone().divide(radius).normalize();
      const q=new THREE.Quaternion().setFromUnitVectors(up,outward)
        .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler((random()-.5)*1.25,(random()-.5)*1.25,random()*Math.PI*2)));
      const span=(.047+random()*.012)*spanScale,curl=.0015+random()*.0025;
      const vertices=[new THREE.Vector3(0,0,curl),...outline.map(([u,v])=>new THREE.Vector3((u-centerUv[0])*span/.252,(centerUv[1]-v)*span/.252,0))]
        .map(point=>point.applyQuaternion(q).add(offset));
      const normal=up.clone().applyQuaternion(q).lerp(outward,.14).normalize();
      const tint=(clusterIndex===4?.71:.83)+random()*.17;
      for(let edge=0;edge<4;edge++)for(const index of[0,(edge+1)%4+1,edge+1]){
        positions.push(...vertices[index].toArray());uvs.push(...texture[index]);normals.push(...normal.toArray());
        colors.push(tint*.91,tint,tint*.85);
      }
    }
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.computeBoundingBox();const box=geometry.boundingBox!,size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
  geometry.translate(-center.x,-center.y,-center.z);geometry.scale(1/size.x,1/size.y,1/size.z);geometry.computeBoundingBox();geometry.computeBoundingSphere();
  geometry.name='Natural hedge: five rounded clusters of individual small leaves';
  geometry.userData={coreTriangles:0,leafTriangles:clusters.length*leavesPerCluster*4,leafCount:clusters.length*leavesPerCluster,leafVertexStride:12,
    clusterCount:clusters.length,leafSpanBeforeNormalization:[.047,.059],cellNormalization:size.toArray()};
  return geometry;
}

/** Borrow the existing leaf maps; own only one compact geometry/material and
 * its spatial InstancedMesh batches. Rendering is split into 40 m X/Z cells
 * so an offscreen campus hedge never submits every distant hedge instance.
 * No placement, hedge dimension, terrain height or collider is changed here.
 */
export function buildHedgeBatches(hedges:HedgeStrip[],source:THREE.MeshStandardMaterial){
  if(!source?.isMeshStandardMaterial||!source.map)throw new Error('Hedges require the existing leaf PBR material and atlas');
  const cells=hedgeCells(hedges),geometry=hedgeCellGeometry(),material=source.clone();
  material.name='Rounded leaf-cluster hedge (existing Island Tree atlas)';
  material.transparent=false;material.opacity=1;material.depthWrite=true;material.alphaTest=0;
  material.side=THREE.DoubleSide;material.vertexColors=true;
  // The tree ARM map is glossy at shrub scale; keep only the borrowed diffuse
  // and normal maps for this matte hedge clone. The tree source stays untouched.
  material.roughnessMap=null;material.metalnessMap=null;material.metalness=0;material.roughness=.96;
  material.normalScale.set(.18,.18);material.color.multiply(new THREE.Color().setRGB(.90,.97,.87));
  const grid=40,partition=new Map<string,{x:number;z:number;indices:number[]}>();
  cells.forEach((p,i)=>{const x=Math.floor(p.x/grid),z=Math.floor(p.z/grid),key=`${x},${z}`;
    if(!partition.has(key))partition.set(key,{x,z,indices:[]});partition.get(key)!.indices.push(i);});
  const random=randomSource(55103),tints=cells.map(()=>.94+random()*.12);
  const batches=[...partition.values()].map(tile=>{
    const mesh=new THREE.InstancedMesh(geometry,material,tile.indices.length);
    mesh.name=`Campus hedge batch ${tile.x},${tile.z}`;mesh.position.set((tile.x+.5)*grid,0,(tile.z+.5)*grid);
    mesh.castShadow=mesh.receiveShadow=true;
    mesh.userData.hedgeCellIndices=tile.indices;
    tile.indices.forEach((index,i)=>{const p=cells[index];
      const matrix=new THREE.Matrix4().makeTranslation(p.x-mesh.position.x,p.y+p.height/2,p.z-mesh.position.z)
        .multiply(new THREE.Matrix4().makeRotationY((index%4)*Math.PI/2)).multiply(new THREE.Matrix4().makeScale(p.width,p.height,p.width));
      mesh.setMatrixAt(i,matrix);mesh.setColorAt(i,new THREE.Color().setRGB(tints[index],tints[index],tints[index]));
    });
    mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
    mesh.computeBoundingBox();mesh.computeBoundingSphere();return mesh;
  });
  let disposed=false;
  // Distance LOD per 40 m batch: same cells, instances and colliders; beyond
  // ~70 m each cell uses 48 larger leaves per cluster (960 instead of 5120 tris).
  const lowGeometry=hedgeCellGeometry(48),detail=new Map<THREE.InstancedMesh,boolean>(batches.map(b=>[b,true]));
  const centre=new THREE.Vector3();
  const update=(camera:THREE.Vector3)=>{
    for(const mesh of batches){
      centre.copy(mesh.position);const d=Math.hypot(centre.x-camera.x,centre.z-camera.z)-grid*.71;
      const near=detail.get(mesh)?d<85:d<70;
      if(near!==detail.get(mesh)){detail.set(mesh,near);mesh.geometry=near?geometry:lowGeometry;}
    }
  };
  return{cells,geometry,lowGeometry,material,batches,update,stats:{hedgeStrips:hedges.length,cells:cells.length,batches:batches.length,gridMetres:grid,
    lowTrianglesPerCell:lowGeometry.attributes.position.count/3,lodSwitchMetres:70,
    trianglesPerCell:geometry.attributes.position.count/3,totalInstanceTriangles:geometry.attributes.position.count/3*cells.length,
    ownedGeometries:1,ownedMaterials:1,borrowedTextures:new Set([material.map,material.normalMap,material.roughnessMap,material.metalnessMap].filter(Boolean)).size},
    dispose(){if(disposed)return;disposed=true;for(const batch of batches)batch.dispose();geometry.dispose();lowGeometry.dispose();material.dispose();}};
}
