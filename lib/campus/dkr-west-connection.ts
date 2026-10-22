import * as THREE from 'three';
import type { CutVolume } from './clip-volume';
import plan from './dkr-west-connection-plan.json' with { type: 'json' };

/** Small supported connection from the retained west street to the existing
 * DKR apron. The supplied concrete material is borrowed from that apron. */
export function buildDkrWestConnection(material: THREE.Material) {
  const rows=plan.rows.length,cols=plan.columns,n=plan.vertices.length;
  const position=plan.vertices.flatMap(p=>p),indices:number[]=[];
  for(const[x,y,z]of plan.vertices)position.push(x,y-plan.depth,z);
  for(let r=0;r<rows-1;r++)for(let c=0;c<cols-1;c++){
    const a=r*cols+c,b=a+1,d=a+cols,e=d+1;
    indices.push(a,d,b,b,d,e,a+n,b+n,d+n,b+n,e+n,d+n);
  }
  const perimeter:number[]=[];
  for(let c=0;c<cols;c++)perimeter.push(c);
  for(let r=1;r<rows;r++)perimeter.push(r*cols+cols-1);
  for(let c=cols-2;c>=0;c--)perimeter.push((rows-1)*cols+c);
  for(let r=rows-2;r>0;r--)perimeter.push(r*cols);
  for(let i=0;i<perimeter.length;i++){
    const a=perimeter[i],b=perimeter[(i+1)%perimeter.length];indices.push(a,b,a+n,b,b+n,a+n);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(position,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(position.flatMap((_,i)=>i%3===0?[position[i]*.45,position[i+2]*.45]:[]),2));
  geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const mesh=new THREE.Mesh(geometry,material);mesh.name='DKR supported western entrance connection';mesh.castShadow=mesh.receiveShadow=true;
  const volumes:CutVolume[]=[];
  for(let r=0;r<rows-1;r++){
    const strip=plan.vertices.slice(r*cols,(r+2)*cols);
    const min=new THREE.Vector3(306,Math.min(...strip.map(p=>p[1]))-plan.depth+.004,plan.rows[r]);
    // The tiny eastern overlap is wholly inside the already-backed apron.
    const max=new THREE.Vector3(310.02,plan.clearanceTop,plan.rows[r+1]);
    const bounds=new THREE.Box3(min,max);
    volumes.push({bounds,planes:[
      new THREE.Plane(new THREE.Vector3(-1,0,0),min.x),new THREE.Plane(new THREE.Vector3(1,0,0),-max.x),
      new THREE.Plane(new THREE.Vector3(0,-1,0),min.y),new THREE.Plane(new THREE.Vector3(0,1,0),-max.y),
      new THREE.Plane(new THREE.Vector3(0,0,-1),min.z),new THREE.Plane(new THREE.Vector3(0,0,1),-max.z),
    ]});
  }
  const heightAt=(x:number,z:number):number|null=>{
    if(x<306||x>310||z<plan.rows[0]||z>plan.rows[rows-1])return null;
    let r=0;while(r<rows-2&&z>plan.rows[r+1])r++;
    const zt=(z-plan.rows[r])/(plan.rows[r+1]-plan.rows[r]);
    const xt=x-306,c=Math.min(cols-2,Math.floor(xt)),u=xt-c;
    const a=plan.vertices[r*cols+c][1],b=plan.vertices[r*cols+c+1][1],d=plan.vertices[(r+1)*cols+c][1],e=plan.vertices[(r+1)*cols+c+1][1];
    return u+zt<=1?a+(b-a)*u+(d-a)*zt:e+(d-e)*(1-u)+(b-e)*(1-zt);
  };
  const stats={scope:plan.scope,areaM2:4*(plan.rows[rows-1]-plan.rows[0]),rows,columns:cols,triangles:indices.length/3,batches:1,sourceVolumes:volumes.length,ownedGeometries:1,ownedMaterials:0,ownedTextures:0,borrowedMaterials:1};
  let disposed=false;
  const dispose=()=>{if(disposed)return;disposed=true;mesh.removeFromParent();geometry.dispose();};
  return{meshes:[mesh],colliderGeometries:[geometry],volumes,heightAt,stats,dispose};
}
