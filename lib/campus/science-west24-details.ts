import * as T from 'three';
type Box=(x:number,y:number,z:number,w:number,h:number,d:number,m:T.Material)=>void;
type Add=(g:T.BufferGeometry,m:T.Material)=>void;
type Entry={kind:'PAI'|'WEL';center:number;base:number;matrix:T.Matrix4;box:Box;add:Add;stone:T.Material;sash:T.Material;metal:T.Material;glass:T.Material;terracotta:T.Material};
/** Two different UT street entrances, derived from the UT Direct and UTeach
 * photos. Dimensions are estimates; they are registered to the official wall.
 * No ground/stair meshes or new scan cuts are introduced by these details. */
export function scienceEntrance(o:Entry){
 const {kind,center:x,base:y,matrix,box,add,stone,sash,metal,glass,terracotta}=o;
 const painter=kind==='PAI',width=painter?2.55:2.65,spring=y+3.9,top=painter?y+8.45:y+13.3;
 const door=new T.Shape().moveTo(x-width/2,y+.12).lineTo(x-width/2,spring);
 if(painter)door.lineTo(x+width/2,spring);else door.absarc(x,spring,width/2,Math.PI,0,true);
 door.lineTo(x+width/2,y+.12).closePath();
 add(new T.ShapeGeometry(door,16).translate(0,0,-.43).applyMatrix4(matrix),glass);
 const portal=new T.Shape().moveTo(x-3.15,y+.04).lineTo(x+3.15,y+.04).lineTo(x+3.15,top).lineTo(x-3.15,top).closePath();
 portal.holes.push(new T.Path(door.getPoints(16)));
 if(!painter){
  // A tall framed sash sits above the round-headed entry, inside the portal.
  const window=new T.Path().moveTo(x-.96,y+9.2).lineTo(x+.96,y+9.2).lineTo(x+.96,y+12.1).lineTo(x-.96,y+12.1).closePath();portal.holes.push(window);
  add(new T.PlaneGeometry(1.92,2.9).translate(x,y+10.65,.017).applyMatrix4(matrix),glass);
  for(let yy=y+9.2;yy<y+12.2;yy+=.48)box(x,yy,.13,1.92,.035,.07,sash);
  for(const xx of [-.96,-.48,0,.48,.96])box(x+xx,y+10.65,.13,.045,2.9,.07,sash);
 }
 add(new T.ExtrudeGeometry(portal,{depth:.14,bevelEnabled:false,curveSegments:16}).translate(0,0,-.005).applyMatrix4(matrix),stone);
 // Thick door jambs, paneled double leaves and a clear recessed transom.
 for(const side of [-1,1])box(x+side*(width/2+.10),y+2,.18,.20,3.8,.28,stone);
 box(x,y+.19,.04,width+.42,.14,.44,stone);
 for(const xx of [-width/2,0,width/2])box(x+xx,y+1.77,-.22,.10,3.16,.15,sash);
 for(const yy of [y+.23,y+1.04,y+1.84,y+2.62,y+3.34])box(x,yy,-.22,width,.10,.15,sash);
 // Painter has a close-spaced grille and deeply paneled painted doors;
 // Welch has larger glazed leaves and a curved transom.
 if(painter){
  for(const xx of [-.90,-.45,.45,.90])box(x+xx,y+1.77,-.22,.065,3.16,.13,sash);
  for(let xx=-1.17;xx<1.2;xx+=.19)box(x+xx,y+3.62,-.16,.025,.50,.06,metal);
 }else{
  const arch=new T.Shape();arch.absarc(x,spring,width/2+.30,0,Math.PI,false);arch.absarc(x,spring,width/2+.04,Math.PI,0,true);arch.closePath();
  add(new T.ExtrudeGeometry(arch,{depth:.25,bevelEnabled:false,curveSegments:18}).translate(0,0,.06).applyMatrix4(matrix),stone);
  for(const t of [.32,.64,1,1.4,1.74,2.12,2.5,2.82]){
   const beam=new T.CylinderGeometry(.016,.016,width/2,5);
   beam.rotateZ(t-Math.PI/2).translate(x+Math.cos(t)*width/4,spring+Math.sin(t)*width/4,-.18).applyMatrix4(matrix);add(beam,metal);
  }
 }
 for(const side of [-1,1]){
  const xx=x+side*2.82;
  // Pilasters and capital shoulders are relief, not flat outline strokes.
  box(xx,(y+3.45+top-.66)/2,.30,.46,top-y-4.11,.45,stone);
  for(const dx of [-.15,0,.15]){
   const shaft=new T.CylinderGeometry(.044,.052,top-y-4.34,6).translate(xx+dx,(y+3.57+top-.77)/2,.55).applyMatrix4(matrix);add(shaft,stone);
  }
  for(const [yy,w,h,d] of [[y+3.40,.72,.18,.72],[y+3.62,.61,.20,.61],[top-.68,.63,.16,.66],[top-.46,.85,.25,.79]])box(xx,yy,.28,w,h,d,stone);
  // Small curving corbel under each pilaster is a tapered profile.
  const profile=new T.Shape().moveTo(-.28,0).lineTo(.28,0).lineTo(.23,-.25).lineTo(.09,-.52).lineTo(-.12,-.42).closePath();
  add(new T.ExtrudeGeometry(profile,{depth:.34,bevelEnabled:false}).translate(xx,y+3.32,.12).applyMatrix4(matrix),stone);
  if(painter){
   const urn=new T.LatheGeometry([[.08,0],[.22,.05],[.18,.19],[.12,.27],[.21,.44],[.18,.60],[.08,.73]].map(v=>new T.Vector2(...v)),10);
   add(urn.translate(xx,top+.35,.23).applyMatrix4(matrix),stone);
   const disc=new T.CylinderGeometry(.36,.36,.07,20).rotateX(Math.PI/2).translate(x+side*1.75,y+6.89,.19).applyMatrix4(matrix);add(disc,stone);
   const inset=new T.CylinderGeometry(.285,.285,.025,20).rotateX(Math.PI/2).translate(x+side*1.75,y+6.89,.238).applyMatrix4(matrix);add(inset,terracotta);
  }
 }
 for(const [yy,w,h,d] of [[top-.24,6.75,.32,.54],[top+.02,6.92,.16,.72],[top+.19,7.13,.16,.83]])box(x,yy,.26,w,h,d,stone);
 if(!painter){
  // Official north-entrance photo shows a square, layered entablature.
  box(x,top+.39,.21,6.48,.22,.61,stone);
  box(x,top+.57,.23,6.73,.13,.73,stone);
 }
}
export function scienceCornice({kind,length,top,box,stone,timber}:{kind:'PAI'|'WEL';length:number;top:number;box:Box;stone:T.Material;timber:T.Material}){
 // Narrow ledges and shadow breaks replace the broad rectangular roof edge.
 box(length/2,top-.52,.075,length,.12,.25,stone);
 box(length/2,top-.35,.24,length,.11,.58,stone);
 box(length/2,top-.11,.49,length,.17,.99,kind==='PAI'?timber:stone);
 if(kind==='WEL')for(let x=.60;x<length-.2;x+=.75)box(x,top-.28,.43,.20,.19,.49,stone);
 if(kind==='PAI')for(let x=.70;x<length-.2;x+=1.2)box(x,top-.24,.39,.12,.26,.85,timber);
}

export function biologyEntrance({x,base:y,matrix,box,add,stone,metal,sash,glass}:{x:number;base:number;matrix:T.Matrix4;box:Box;add:Add;stone:T.Material;metal:T.Material;sash:T.Material;glass:T.Material}){
 const r=.95,spring=y+2.86;
 const opening=new T.Shape().moveTo(x-r,y+.10).lineTo(x-r,spring);opening.absarc(x,spring,r,Math.PI,0,true);opening.lineTo(x+r,y+.1).closePath();
 add(new T.ShapeGeometry(opening,16).translate(0,0,-.44).applyMatrix4(matrix),glass);
 const arch=new T.Shape();arch.absarc(x,spring,r+.18,0,Math.PI,false);arch.absarc(x,spring,r,Math.PI,0,true);arch.closePath();
 add(new T.ExtrudeGeometry(arch,{depth:.17,bevelEnabled:false,curveSegments:16}).translate(0,0,-.025).applyMatrix4(matrix),stone);
 for(const xx of [x-r,x,x+r])box(xx,y+1.43,-.25,.075,2.66,.12,sash);
 for(const yy of [y+.16,y+.63,spring])box(x,yy,-.25,r*2,.075,.12,sash);
 for(let i=1;i<12;i++){
  const angle=i*Math.PI/12,v=new T.Vector3(Math.cos(angle),Math.sin(angle),0);
  const bar=new T.CylinderGeometry(.014,.014,r-.035,5).applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),v)).translate(x+v.x*r/2,spring+v.y*r/2,-.20).applyMatrix4(matrix);add(bar,metal);
 }
 for(const side of [-1,1]){
  const xx=x+side*1.47;
  box(xx,y+2.96,.23,.30,.59,.32,metal);
  box(xx,y+2.96,.404,.19,.39,.025,glass);
  box(xx,y+3.28,.24,.40,.09,.40,metal);
  box(xx,y+2.58,.13,.12,.20,.33,metal);
 }
}
export function gearingRoofTurret({x,z,top,add,stone,trim,timber,roof,sash}:{x:number;z:number;top:number;add:Add;stone:T.Material;trim:T.Material;timber:T.Material;roof:T.Material;sash:T.Material}){
 const matrix=new T.Matrix4().makeRotationY(-.0873).setPosition(x,top+.30,z);
 const box=(a:number,y:number,b:number,w:number,h:number,d:number,m:T.Material)=>add(new T.BoxGeometry(w,h,d).translate(a,y,b).applyMatrix4(matrix),m);
 box(0,1.98,0,4.0,3.96,4.0,stone);
 for(const yy of [3.68,3.90])box(0,yy,0,4.32,.13,4.32,trim);
 box(0,4.07,0,4.68,.17,4.68,timber);
 box(0,4.24,0,4.72,.15,4.72,roof);
 // Shallow inward roof facets close the turret without a generic pyramid.
 const pts=[[-2.36,4.32,-2.36],[2.36,4.32,-2.36],[2.36,4.32,2.36],[-2.36,4.32,2.36]],a=new T.Vector3(-.65,4.65,0),b=new T.Vector3(.65,4.65,0);
 const vertices=pts.map(p=>new T.Vector3(...p)),faces=[[vertices[0],vertices[1],b],[vertices[0],b,a],[vertices[1],vertices[2],b],[vertices[2],vertices[3],a],[vertices[2],a,b],[vertices[3],vertices[0],a]];
 const pos=faces.flatMap(f=>f.flatMap(v=>v.toArray())),g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(pos,3));
 g.setAttribute('uv',new T.Float32BufferAttribute(faces.flatMap(f=>f.flatMap(v=>[v.x,v.z])),2));g.computeVertexNormals();add(g.applyMatrix4(matrix),roof);
 for(const rot of [0,Math.PI/2,Math.PI,Math.PI*1.5]){
  const wall=new T.Matrix4().makeRotationY(rot).multiply(new T.Matrix4().makeTranslation(0,0,2.012));
  const vent=new T.Shape().moveTo(-.27,2.03).lineTo(-.27,2.86);vent.absarc(0,2.86,.27,Math.PI,0,true);vent.lineTo(.27,2.03).closePath();
  add(new T.ShapeGeometry(vent,12).applyMatrix4(wall).applyMatrix4(matrix),sash);
  for(let y=2.09;y<2.89;y+=.12)add(new T.BoxGeometry(.48,.04,.04).translate(0,y,.035).applyMatrix4(wall).applyMatrix4(matrix),timber);
 }
 // The narrow masonry chimney beside each tower is conspicuous in the photo.
 box(2.88,1.95,-.45,.84,3.9,.94,stone);box(2.88,3.96,-.45,1.03,.16,1.12,roof);
}
