import * as T from 'three';
import type {CutVolume} from './clip-volume';
import {engineeringCourtPoint} from './engineering-courtyard';

/** The original contour-registration skirt overlaps this existing EER walk,
 * ending about 25cm above its floor. Remove only that obsolete skirt, within
 * the unchanged court's continuous, physically backed ground rectangle.
 * No floor, material, collision setting, northern grade or building changes. */
export function engineeringSouthwestSeamTrim():CutVolume {
  const corners=[[-4,6.3],[12,6.3],[12,12],[-4,12]].map(([s,t])=>engineeringCourtPoint(s,t));
  const center=engineeringCourtPoint(4,9.15);
  const planes=corners.map((a,i)=>{
    const b=corners[(i+1)%corners.length],plane=new T.Plane().setFromNormalAndCoplanarPoint(
      new T.Vector3(b.z-a.z,0,a.x-b.x).normalize(),a);
    if(plane.distanceToPoint(center)>0)plane.negate();
    return plane;
  });
  // Match the enclosing court's existing supported-ground volume vertically.
  const bounds=new T.Box3().setFromPoints(corners);bounds.min.y=-4;bounds.max.y=23;
  planes.push(new T.Plane(new T.Vector3(0,-1,0),-4),new T.Plane(new T.Vector3(0,1,0),-23));
  return{planes,bounds};
}
