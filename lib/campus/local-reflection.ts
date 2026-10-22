import * as T from 'three';
import type { Sky } from 'three/addons/objects/Sky.js';

/** A static, local reflection of authored scenery. Six faces are captured on
 * separate frames, then filtered once. It never changes the scene's diffuse
 * environment, the physics world, or the streamed tiles' camera/loading state. */
export class CampusLocalReflection {
  private cube?: T.WebGLCubeRenderTarget;
  private camera?: T.CubeCamera;
  private filtered?: T.WebGLRenderTarget;
  private face=0;
  private nearbySince=0;
  private enabled=true;
  private disposed=false;
  private bindings:{material:T.MeshStandardMaterial;previous:T.Texture|null;intensity:number;active:{value:number}}[]=[];
  private warmupMaterials:T.Material[]=[];
  private compilePrograms:{isReady:()=>boolean;program:WebGLProgram}[]=[];
  private warmupStarted=0;
  private readonly linearCapture={value:false};
  private compileSubmitMs=0;
  private compileElapsedMs=0;
  private compiledObjects=0;
  private submitMs:number[]=[];
  private state:'waiting'|'compiling'|'capturing'|'filtering'|'ready'|'failed'|'disposed'='waiting';
  private error='';
  private readonly position=new T.Vector3(-3,8,-5);
  private readonly bounds=new T.Box3(new T.Vector3(-30,2,-72),new T.Vector3(31,38,44));
  constructor(private renderer:T.WebGLRenderer,private scene:T.Scene,
    private sky:Sky,private excluded:T.Object3D[],materials:T.MeshStandardMaterial[],
    private mainRenderTarget:T.WebGLRenderTarget|null=null){
    this.scene.userData.campusLinearCapture=this.linearCapture;
    for(const material of materials){
      const active={value:0};
      this.bindings.push({material,previous:material.envMap,intensity:material.envMapIntensity,active});
      this.addBoxProjection(material,active);
    }
  }
  private addBoxProjection(material:T.MeshStandardMaterial,active:{value:number}){
    const previous=material.onBeforeCompile.bind(material),key=material.customProgramCacheKey();
    material.onBeforeCompile=(shader,renderer)=>{
      previous(shader,renderer);
      shader.uniforms.campusProbePosition={value:this.position};
      shader.uniforms.campusProbeMin={value:this.bounds.min};
      shader.uniforms.campusProbeMax={value:this.bounds.max};
      // Every cached program variant shares this binding. Updating only the
      // most recently compiled program leaves stale uniforms in the others.
      shader.uniforms.campusProbeActive=active;
      shader.vertexShader='varying vec3 campusProbeWorld;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',
        '#include <project_vertex>\ncampusProbeWorld=(modelMatrix*vec4(transformed,1.)).xyz;');
      shader.fragmentShader='varying vec3 campusProbeWorld;\nuniform vec3 campusProbePosition,campusProbeMin,campusProbeMax;\nuniform float campusProbeActive;\n'+shader.fragmentShader;
      const env=T.ShaderChunk.envmap_physical_pars_fragment.replace(
        'vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );',`
        if(campusProbeActive>.5 && all(greaterThanEqual(campusProbeWorld,campusProbeMin)) && all(lessThanEqual(campusProbeWorld,campusProbeMax))){
          // Intersect the reflected ray with the local courtyard envelope.
          // This reduces the sliding produced by an infinitely distant sky map.
          vec3 safeDirection=mix(vec3(-1.),vec3(1.),step(vec3(0.),reflectVec))*max(abs(reflectVec),vec3(.0001));
          vec3 distanceToBox=(mix(campusProbeMin,campusProbeMax,step(vec3(0.),reflectVec))-campusProbeWorld)/safeDirection;
          float distanceToFace=max(0.,min(distanceToBox.x,min(distanceToBox.y,distanceToBox.z)));
          reflectVec=normalize(campusProbeWorld+reflectVec*distanceToFace-campusProbePosition);
        }
        vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <envmap_physical_pars_fragment>',env);
    };
    material.customProgramCacheKey=()=>key+'-campus-local-reflection-v2';
    material.needsUpdate=true;
  }
  setEnabled(enabled:boolean){
    this.enabled=enabled;
    for(const b of this.bindings){
      b.material.envMap=enabled&&this.filtered?this.filtered.texture:b.previous;
      // Explicit envMap bypasses scene.environmentIntensity. Match the strength
      // the pane had while sampling the sky; the capture changes reflected
      // detail, not reflection strength (see captureStrength).
      b.material.envMapIntensity=enabled&&this.filtered?this.captureStrength(b):b.intensity;
      b.active.value=enabled&&this.filtered?1:0;
      b.material.needsUpdate=true;
    }
  }
  /** Reflection strength to use with the explicit local capture.
   * - The pane already had an explicit envMap: keep its own envMapIntensity.
   * - It declares the strength it uses on the scene sky (userData.reflectionStrength,
   *   or gdc-glazing's userData.gdcSkyReflection, which that file applies via
   *   its own gain only while envMap is null, so this never double-boosts).
   * - Otherwise three used scene.environmentIntensity for it: keep that (legacy). */
  private captureStrength(b:{material:T.MeshStandardMaterial;previous:T.Texture|null;intensity:number}){
    if(b.previous)return b.intensity;
    const data=b.material.userData as {reflectionStrength?:unknown;gdcSkyReflection?:unknown};
    for(const v of [data.reflectionStrength,data.gdcSkyReflection])
      if(typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=4)return v;
    return this.scene.environmentIntensity;
  }
  update(player:T.Vector3,now:number){
    if(this.disposed||this.state==='ready'||this.state==='failed'||!this.bindings.length)return;
    if(this.state==='compiling'||this.state==='filtering'){
      try{
        if(this.compilePrograms.every(program=>program.isReady())){
          const gl=this.renderer.getContext();
          if(this.compilePrograms.some(program=>!gl.getProgramParameter(program.program,gl.LINK_STATUS)))throw new Error('Reflection shader link failed');
          this.compileElapsedMs+=performance.now()-this.warmupStarted;
          this.compilePrograms=[];
          if(this.state==='compiling')this.state='capturing';
          else{this.state='ready';this.setEnabled(this.enabled);}
        }
      }catch(error){this.fail(error);}
      return;
    }
    if(Math.hypot(player.x-this.position.x,player.z-this.position.z)>60){this.nearbySince=0;return;}
    if(!this.nearbySince){this.nearbySince=now;return;}
    // Let shadow maps and nearby tree LODs settle before the one-time capture.
    if(now-this.nearbySince<1800)return;
    const start=performance.now();
    try{
      if(!this.cube){
        this.cube=new T.WebGLCubeRenderTarget(128,{type:T.HalfFloatType,colorSpace:T.LinearSRGBColorSpace,generateMipmaps:false,minFilter:T.LinearFilter});
        this.camera=new T.CubeCamera(.15,20000,this.cube);
        this.camera.coordinateSystem=this.renderer.coordinateSystem;
        this.camera.updateCoordinateSystem();
        this.camera.position.copy(this.position);this.camera.updateMatrixWorld(true);
        this.state='compiling';
        this.warmUpCapture();
        return;
      }
      if(this.face<6){this.captureFace(this.face++);}
      else{
        const pmrem=new T.PMREMGenerator(this.renderer);
        try{this.filtered=pmrem.fromCubemap(this.cube.texture);}
        finally{pmrem.dispose();}
        this.cube.dispose();this.cube=undefined;this.camera=undefined;
        this.releaseWarmup();
        this.state='filtering';
        this.warmUpFinalGlass();
      }
    }catch(error){
      this.fail(error);
    }finally{this.submitMs.push(performance.now()-start);}
  }
  private cloneForCompile(object:T.Mesh,localGlass=false){
    const clone=object.clone(false) as T.Mesh;
    const copy=(material:T.Material)=>{
      const copy=material.clone();
      // Material.clone does not copy these custom shader hooks.
      copy.onBeforeCompile=(shader,renderer)=>material.onBeforeCompile(shader,renderer);
      copy.customProgramCacheKey=()=>material.customProgramCacheKey();
      if(localGlass&&(copy as T.MeshStandardMaterial).isMeshStandardMaterial){
        (copy as T.MeshStandardMaterial).envMap=this.filtered!.texture;
      }
      this.warmupMaterials.push(copy);return copy;
    };
    clone.material=Array.isArray(object.material)?object.material.map(copy):copy(object.material);
    return clone;
  }
  private warmUpCapture(){
    const group=new T.Group(),excluded=new Set(this.excluded);
    // compile() traverses hidden objects too, unlike render(). Flatten the
    // eligible authored meshes so hidden scan tiles cannot enter the warm-up.
    this.scene.traverseVisible(object=>{
      let parent:T.Object3D|null=object;
      while(parent){if(excluded.has(parent))return;parent=parent.parent;}
      const mesh=object as T.Mesh;
      if(mesh.material)group.add(this.cloneForCompile(mesh));
    });
    this.compiledObjects=group.children.length;
    const renderer=this.renderer,target=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),mip=renderer.getActiveMipmapLevel(),tone=renderer.toneMapping;
    const start=performance.now();
    try{
      renderer.toneMapping=T.NoToneMapping;renderer.setRenderTarget(this.cube!,0);
      this.startCompile(group,this.camera!.children[0] as T.Camera);
    }finally{
      // Restore synchronously: gameplay renders normally while the GPU compiles.
      renderer.setRenderTarget(target,face,mip);renderer.toneMapping=tone;
      this.compileSubmitMs+=performance.now()-start;
    }
  }
  private startCompile(group:T.Group,camera:T.Camera){
    this.warmupStarted=performance.now();
    const materials=this.renderer.compile(group,camera,this.scene);
    // Three r185 compileAsync uses the same isReady/KHR status, but its timer
    // cannot be cancelled and dereferences disposed materials during teardown.
    // Retain the program references and poll only from our live update loop.
    // Warm-up material copies prevent normal rendering from changing the
    // currentProgram while this list is collected. Revisit on a Three upgrade.
    this.compilePrograms=[...new Set([...materials].map(material=>{
      const properties=this.renderer.properties.get(material) as {currentProgram?:{isReady:()=>boolean;program:WebGLProgram}};
      const program=properties.currentProgram;
      if(!program||typeof program.isReady!=='function')throw Error('Unsupported Three shader readiness API');
      return program;
    }))];
  }
  private warmUpFinalGlass(){
    const group=new T.Group(),materials=new Set(this.bindings.map(b=>b.material));
    this.scene.traverseVisible(object=>{
      const mesh=object as T.Mesh;
      if(mesh.material&&(Array.isArray(mesh.material)?mesh.material:[mesh.material]).some(m=>materials.has(m as T.MeshStandardMaterial)))group.add(this.cloneForCompile(mesh,true));
    });
    const start=performance.now();
    const renderer=this.renderer,target=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),mip=renderer.getActiveMipmapLevel();
    try{
      // Match direct rendering or the optional offscreen AO color target.
      renderer.setRenderTarget(this.mainRenderTarget);
      this.startCompile(group,new T.PerspectiveCamera());
    }finally{
      renderer.setRenderTarget(target,face,mip);this.compileSubmitMs+=performance.now()-start;
    }
    // These few final material copies retain their program references until
    // disposal, even when the actual windows are initially outside the view.
  }
  private releaseWarmup(){this.warmupMaterials.forEach(m=>m.dispose());this.warmupMaterials=[];}
  private fail(error:unknown){
    this.error=error instanceof Error?error.name:'Unknown';this.state='failed';
    this.compilePrograms=[];
    this.cube?.dispose();this.cube=undefined;this.camera=undefined;this.releaseWarmup();
  }
  private captureFace(face:number){
    const renderer=this.renderer,oldTarget=renderer.getRenderTarget(),oldFace=renderer.getActiveCubeFace(),oldMip=renderer.getActiveMipmapLevel();
    const oldXr=renderer.xr.enabled,oldAuto=renderer.shadowMap.autoUpdate,oldNeeds=renderer.shadowMap.needsUpdate;
    const visibility=this.excluded.map(o=>o.visible),disc=this.sky.material.uniforms.showSunDisc.value;
    const autoClear=renderer.autoClear,toneMapping=renderer.toneMapping;
    const linearCapture=this.linearCapture.value;
    // render/lighting.ts may scale the visible sky toward physical radiance.
    // Captures keep the raw-scale sky so bound glass keeps its tuned look.
    const skyGain=this.sky.userData.campusSkyGain as {value:number}|undefined,oldGain=skyGain?.value;
    try{
      if(skyGain)skyGain.value=1;
      this.excluded.forEach(o=>{o.visible=false;});
      this.sky.material.uniforms.showSunDisc.value=false;
      this.linearCapture.value=true;
      renderer.xr.enabled=false;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false;
      renderer.autoClear=true;renderer.toneMapping=T.NoToneMapping;
      renderer.setRenderTarget(this.cube!,face);
      renderer.render(this.scene,this.camera!.children[face] as T.Camera);
    }finally{
      this.excluded.forEach((o,i)=>{o.visible=visibility[i];});
      this.sky.material.uniforms.showSunDisc.value=disc;
      if(skyGain&&oldGain!==undefined)skyGain.value=oldGain;
      this.linearCapture.value=linearCapture;
      renderer.setRenderTarget(oldTarget,oldFace,oldMip);renderer.xr.enabled=oldXr;
      renderer.shadowMap.autoUpdate=oldAuto;renderer.shadowMap.needsUpdate=oldNeeds;
      renderer.autoClear=autoClear;renderer.toneMapping=toneMapping;
    }
  }
  snapshot(){return{state:this.state,enabled:this.enabled,facesCaptured:this.face,materials:this.bindings.map(b=>b.material.name),position:this.position.toArray(),resolution:128,submitMs:this.submitMs,compileSubmitMs:this.compileSubmitMs,compileElapsedMs:this.compileElapsedMs,compiledObjects:this.compiledObjects,parallelCompilation:this.renderer.extensions.has('KHR_parallel_shader_compile'),error:this.error,
    strengths:this.bindings.map(b=>({name:b.material.name,envMapIntensity:b.material.envMapIntensity,captureStrength:this.captureStrength(b)})),
    retainedMiB:this.filtered?this.filtered.width*this.filtered.height*8/1048576:0,
    scope:'Static authored scenery and sky; excludes player and streamed scan. Approximate box projection; not live planar reflections.'};}
  dispose(){
    if(this.disposed)return;this.disposed=true;
    this.compilePrograms=[];
    for(const b of this.bindings){b.material.envMap=b.previous;b.material.envMapIntensity=b.intensity;b.active.value=0;}
    this.releaseWarmup();
    this.cube?.dispose();this.filtered?.dispose();this.cube=undefined;this.filtered=undefined;this.camera=undefined;this.state='disposed';
  }
}
