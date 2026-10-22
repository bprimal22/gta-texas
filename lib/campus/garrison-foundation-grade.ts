import planData from '../../public/data/historic-central-plan.json' with {type:'json'};

/** Derive only the GAR geometry burial datum from the final prepared grade.
 * A <=1m perimeter sampling interval avoids relying on six corner samples;
 * samples are .75m outside the mapped facade, in the retained/rebuilt yard.
 * This does not move a facade, emit geometry or change source-cut ownership.
 */
export function sampleGarrisonFoundation(groundHeight:(x:number,z:number)=>number){
 const building=planData.buildings.find(b=>b.abbr==='GAR');
 if(!building)throw new Error('Garrison footprint unavailable');
 const ring=building.rings[0],area=ring.reduce((sum,p,i)=>sum+p[0]*ring[(i+1)%ring.length][1]-ring[(i+1)%ring.length][0]*p[1],0);
 const samples:{edge:number;x:number;z:number;y:number}[]=[],missing:{edge:number;x:number;z:number}[]=[];
 for(let edge=0;edge<ring.length;edge++){
  const a=ring[edge],b=ring[(edge+1)%ring.length],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),n=Math.ceil(length);
  const nx=dz/length*Math.sign(area),nz=-dx/length*Math.sign(area);let finite=0;
  for(let i=0;i<=n;i++){
   const x=a[0]+dx*i/n+nx*.75,z=a[1]+dz*i/n+nz*.75,y=groundHeight(x,z);
   if(Number.isFinite(y)){samples.push({edge,x,z,y});finite++;}else missing.push({edge,x,z});
  }
  if(finite===0)throw new Error(`Garrison foundation has no grade evidence on edge ${edge}`);
 }
 const minimumGrade=Math.min(...samples.map(p=>p.y)),burial=.6;
 return {bottom:minimumGrade-burial,minimumGrade,burial,sampleSpacingMaximum:1,exteriorOffset:.75,samples,missing};
}
