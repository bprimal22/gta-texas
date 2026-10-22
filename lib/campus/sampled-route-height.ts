import {MathUtils} from 'three';

/** A route's terrain samples are static for this scene lifetime. Retain the
 * existing four-metre subdivision and interpolation, but sample each endpoint
 * once rather than looking it up again for every garden/ground vertex. */
export function createRouteHeightSampler(points:number[][],terrainHeight:(x:number,z:number)=>number){
  const segments=points.slice(1).map((b,i)=>{
    const a=points[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
    const count=Math.ceil(length/4);
    const heights=Array.from({length:count+1},(_,j)=>{
      const t=j/count;return terrainHeight(a[0]+dx*t,a[1]+dz*t);
    });
    return {a,dx,dz,length,count,heights};
  });
  return (x:number,z:number)=>{
    let distance=Infinity,height=0;
    for(const {a,dx,dz,length,count,heights} of segments){
      const t=MathUtils.clamp(((x-a[0])*dx+(z-a[1])*dz)/(length*length),0,1);
      const d=Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t);
      if(d>=distance)continue;
      const j=Math.min(count-1,Math.floor(t*count));
      height=MathUtils.lerp(heights[j],heights[j+1],t*count-j)+.04;
      distance=d;
    }
    return height;
  };
}
