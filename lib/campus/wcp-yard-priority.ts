import * as T from 'three';
import type { CutVolume } from './clip-volume';

/** Only the west WCP paving owns these footprints. Remove the old generic
 * grass/seam layer above it, never the photographic tiles or building bodies.
 * Use the final visible floor vertices so render and collision share edges. */
export function wcpYardGroundPriority(geometry: T.BufferGeometry): CutVolume[] {
  const p=geometry.attributes.position,volumes:CutVolume[]=[];
  const count=geometry.index?.count??p.count;
  for(let i=0;i<count;i+=3){
    const vertices=[0,1,2].map(j=>{
      const k=geometry.index?geometry.index.getX(i+j):i+j;
      return new T.Vector3(p.getX(k),0,p.getZ(k));
    });
    const bounds=new T.Box3().setFromPoints(vertices);
    if(bounds.min.x>=10||new T.Triangle(vertices[0],vertices[1],vertices[2]).getArea()<1e-10)continue;
    bounds.max.x=Math.min(bounds.max.x,10);bounds.min.y=-1000;bounds.max.y=1000;
    const center=vertices.reduce((s,v)=>s.add(v),new T.Vector3()).multiplyScalar(1/3);
    const planes=vertices.map((a,j)=>{
      const d=vertices[(j+1)%3].clone().sub(a);
      const plane=new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(d.z,0,-d.x).normalize(),a);
      if(plane.distanceToPoint(center)>0)plane.negate();return plane;
    });
    volumes.push({planes,bounds});
  }
  return volumes;
}

/** Intersections rounded into Float32 can collapse to a line at a cut edge.
 * Drop only those zero-area remnants in this west-yard region. */
export function compactWcpGroundTriangles(geometry:T.BufferGeometry):void {
  const p=geometry.attributes.position,count=geometry.index?.count??p.count,indices:number[]=[];
  for(let i=0;i<count;i+=3){
    const ids=[0,1,2].map(j=>geometry.index?geometry.index.getX(i+j):i+j);
    const v=ids.map(j=>new T.Vector3().fromBufferAttribute(p,j));
    const bounds=new T.Box3().setFromPoints(v);
    const nearby=bounds.max.x>=-9&&bounds.min.x<=10&&bounds.max.z>=119&&bounds.min.z<=159;
    if(nearby&&new T.Triangle(v[0],v[1],v[2]).getArea()<1e-10)continue;
    indices.push(...ids);
  }
  geometry.setIndex(indices);geometry.clearGroups();
}
