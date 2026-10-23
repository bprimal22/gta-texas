import { FramePacing } from './render/frame-pacing';
import * as THREE from 'three';
import { PERSONAL_CHARACTER_URL } from './character-asset';
import RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { Terrain } from './terrain';
import { capitolGroundReference } from './capitol-area';
import { CampusWorld } from './world';
import { materials } from './materials';
import { FrameProfiler } from './profiler';
import {applyMainBuildingMaterials} from './main-building-materials';
import { buildTower } from './landmarks';
import { buildOfflineTowerBase } from './tower-offline-base';
import { prepareScanTower, prepareScanStand, loadScanField, stadiumScanRequested, SCAN_STAND_SECTOR, type PreparedScanTower, type PreparedScanStand, type ScanTower, type ScanStand, type ScanField } from './scan-landmarks';
import { buildMainBuildingEnvelope } from './main-building-envelope';
import { loadOfflineTerrain } from './offline-terrain-loader';
import { loadLocalSurfaces } from './local-surfaces';
import { buildLocalContext } from './local-context';
import type { RoofsLidar } from './context/massing';
import { createContextMaterials, createStadiumMaterials } from './context-textures';
import { SpeedwayWalkway } from './walkway';
import { characterSupported } from './character-support';
import { ContactShadow } from './contact-shadow';
import { bindCampusGlassEnvironment, createCampusGlazing, setCampusGlassEnvironment } from './campus-glass';
import { POB_GLASS_NAME, POB_GLASS_SKY_INTENSITY } from './pob-glass';
import { CampusLocalReflection } from './local-reflection';
import { CampusAmbientOcclusion, campusAoRequested } from './ambient-occlusion';
import { CampusLighting } from './render/lighting';
import { CameraShotController } from './render/camera-shots';
import { ViewportSync } from './render/viewport';
import { buildContactAo } from './render/contact-ao';
import { installCampusVegetation } from './vegetation/install';
import { mapPoint, mapView, travelCandidates, travelLanding, travelProbe, WALK_SPEED, RUN_SPEED, type MapView } from './map-travel';
import { LocalGroundQuery } from './local-ground-query';
import { ScooterMotion, SCOOTER_TUNING } from './scooter-motion';
import { buildScooterModel } from './scooter-model';
import { createScooterPose } from './scooter-pose';
import { ScooterClearance } from './scooter-clearance';
import { FlightMotion, FLIGHT_TUNING } from './flight-motion';
import { findFlightLanding } from './flight-landing';
import { buildGroundTieIns } from './ground/tie-ins';
import { applyBlockData, installBlocks, type InstalledBlocks, type BlockDataReport } from './blocks/registry';
import { BakedGround } from './baked-ground';
import { heroRouteExtraGround } from './ground/hero-route';
import { createFlightPose } from './flight-pose';
import { loadDeepWest, type DeepWest } from './extension/deep-west';
import { clampToWorld, mapBounds, worldBoundaryWalls } from './extension/deep-west/bounds';
import type { CampusData, TerrainData, GameStatus, Point } from './types';

/** Deep-west campus extension (D37-D40, x < -760). Installed only when its asset validates against
 * the loaded offline terrain seam; any failure keeps the original world, bounds and west wall. */
const DEEP_WEST_EXTENSION = true;

export class CampusGame {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  profiler: FrameProfiler;
  skyEnvironment: THREE.WebGLRenderTarget;
  private sky: Sky;
  private localReflection?: CampusLocalReflection;
  camera = new THREE.PerspectiveCamera(55, 1, 0.12, 2100);
  physics!: RAPIER.World;
  world!: CampusWorld;
  private mainBorrowedTextures = new Set<THREE.Texture>();
  private mainMaterialFinish?: ReturnType<typeof applyMainBuildingMaterials>['stats'];
  private mainBuildingEnvelope?: ReturnType<typeof buildMainBuildingEnvelope>['stats'];
  private scanTower?: ScanTower;
  /** Decoded Tower scan awaiting commit; owned (and disposed) by the game until committed. */
  private scanTowerPrepared?: PreparedScanTower;
  private scanStand?: ScanStand;
  /** Decoded DKR west-stand scan awaiting commit; game-owned until committed. */
  private scanStandPrepared?: PreparedScanStand;
  private scanField?: ScanField;
  private localSurfaces?: Awaited<ReturnType<typeof loadLocalSurfaces>>;
  private blocks?: InstalledBlocks;
  private blockData?: BlockDataReport;
  walkway?: SpeedwayWalkway;
  /** This standalone build only contains the bundled local campus. */
  readonly offline = true;
  private offlineTerrain?: Awaited<ReturnType<typeof loadOfflineTerrain>>['stats'];
  /** Deep-west extension, present only after its asset validated and its colliders were created. */
  private deepWest?: DeepWest;
  private deepWestFailure?: string;
  private groundTieIns?: ReturnType<typeof buildGroundTieIns>['stats'];
  private localContext?: ReturnType<typeof buildLocalContext>['stats'];
  /** Generated buildings and stadium: visible surfaces with matching colliders. */
  private localContextSolid?: THREE.Group;
  /** Shared glazing of generated context buildings (near detail and far shader). */
  private contextGlass?: THREE.MeshPhysicalMaterial;
  /** Shared shadow-depth material of generated facades (mesh.customDepthMaterial, not mesh.material). */
  private contextDepthMaterial?: THREE.Material;
  /** Streams near-camera facade detail (recessed openings) for the generated context. */
  private localContextUpdate?: (camera: THREE.Vector3) => void;
  contactShadow?: ContactShadow;
  ambientOcclusion: CampusAmbientOcclusion;
  lighting: CampusLighting;
  readonly cameraShots = new CameraShotController();
  private viewport: ViewportSync;
  private contactAo?: ReturnType<typeof buildContactAo>;
  private vegetation?: Awaited<ReturnType<typeof installCampusVegetation>>;
  body!: RAPIER.RigidBody;
  collider!: RAPIER.Collider;
  controller!: RAPIER.KinematicCharacterController;
  avatar = new THREE.Group();
  mixer?: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction> = {};
  action = 'Idle';
  characterName = 'Campus visitor';
  characterAssetUrl = PERSONAL_CHARACTER_URL;
  walkCycleSpeed = 1.46;
  runCycleSpeed = 5.7;
  keys = new Set<string>();
  pressedAt = new Map<string, number>();
  airBones: Record<string, THREE.Object3D> = {};
  // Face west from the MLK/East Mall sidewalk toward Speedway and the Tower.
  yaw = 1.48;
  pitch = 0.08;
  distance = 5.4;
  velocity = new THREE.Vector3();
  readonly flight = new FlightMotion();
  private flightPose?: ReturnType<typeof createFlightPose>;
  private flightLean = 0;
  private flightMessage = '';
  private flightMessageUntil = 0;
  private flightGroundTarget: number | null = null;
  private flightGroundLift = 0;
  private flightLandingTarget: THREE.Vector3 | null = null;
  private flightLandingProbeAt = 0;
  private flightHolding = false;
  private flightHoldDirection: 'up' | 'down' = 'up';
  private flightLandingMarker = new THREE.Mesh(new THREE.RingGeometry(.9, 1.15, 32),
    new THREE.MeshBasicMaterial({ color: 0xeac17d, transparent: true, opacity: .8, side: THREE.DoubleSide, depthWrite: false }));
  private scooterGround = new LocalGroundQuery();
  private riderStationary = 1;
  readonly scooter = new ScooterMotion(RUN_SPEED);
  private scooterVisual?: ReturnType<typeof buildScooterModel>;
  private scooterPose?: ReturnType<typeof createScooterPose>;
  private scooterClearance?: ScooterClearance;
  private scooterSupport: ReturnType<ScooterClearance['resolveMove']> | null = null;
  private scooterDismount?: { start: THREE.Vector3; target: THREE.Vector3; path: {x:number;y:number;z:number}[]; heading: number };
  private scooterParkedUntil = 0;
  private scooterMessage = '';
  private scooterMessageUntil = 0;
  private scooterWarningLatched = false;
  private scooterCollisionReady = true;
  private rideCameraBlend = 0;
  private scooterQueryMs: number[] = [];
  grounded = false;
  vertical = 0;
  jumpQueued = false;
  active = false;
  overview = false;
  overviewDistance = 650;
  mapExpanded = false;
  private drawnMap?: MapView;
  private mapCursor?: Point;
  private travel?: { requested: Point; candidates: Point[]; index: number; started: number; candidateSince: number; lastProbe: number; origin: THREE.Vector3 };
  private travelMessage = '';
  private travelMessageUntil = 0;
  private travelCount = 0;
  private lastTravel?: { requested: Point; arrived: number[]; offsetMeters: number };
  disposed = false;
  ready = false;
  raf = 0;
  private readonly pacing = new FramePacing(location.search);
  private interactedAt = performance.now();
  signal = new AbortController();
  last = performance.now();
  accumulator = 0;
  previousPosition = new THREE.Vector3();
  sun = new THREE.DirectionalLight(0xfff0d6, 3.3);
  focus = new THREE.Vector3();
  fpsSamples: number[] = [];
  lastHud = 0;
  startedAt = 0;
  frames = 0;
  contacts = 0;
  jumps = 0;
  spawn = new THREE.Vector3(114, 0, 64.4);
  trail: {
    t: number;
    x: number;
    y: number;
    z: number;
    grounded: boolean;
    action: string;
  }[] = [];
  constructor(
    private host: HTMLDivElement,
    private map: HTMLCanvasElement,
    private report: (s: GameStatus) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      // AO already resolves scene edges with 4x MSAA. The final fullscreen
      // triangle needs no second multisampled default framebuffer.
      antialias: !campusAoRequested(location.search),
      powerPreference: 'high-performance',
    });
    this.profiler = new FrameProfiler(
      this.renderer.getContext() as WebGL2RenderingContext,
    );
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(host.clientWidth, host.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.88;
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute(
      'aria-label',
      'UT Austin exploration game. Arrow keys run and steer; Shift boosts flight. Hold W to rise and Down arrow to descend; release to hover. Flight is capped at 100 metres. Space also flies up. F mounts or dismounts the scooter. Drag mouse to look.',
    );
    this.host.appendChild(this.renderer.domElement);
    this.camera.aspect = host.clientWidth / host.clientHeight;
    this.camera.updateProjectionMatrix();
    this.flightLandingMarker.rotation.x = -Math.PI / 2;
    this.flightLandingMarker.visible = false;
    this.scene.add(this.flightLandingMarker);
    const sky = this.sky = new Sky();
    sky.scale.setScalar(10000);
    this.scene.add(sky);
    // Preserve daylight exposure while allowing deep entries and window reveals
    // to read darker than stone that receives direct sun.
    // Neutral daylight fill reduces the cyan bias in shaded stone. Preserve
    // fill intensity and sun/exposure; photographic tile colors bypass these lights.
    const hemisphere = new THREE.HemisphereLight(0xdde3e8, 0x665e44, 0.55);
    this.scene.add(hemisphere);
    this.scene.add(this.sun, this.sun.target);
    // Sky, sun, fill, environment, fog, exposure and shadows (render lane).
    // ?lighting=legacy restores every previous constant; see render/lighting.ts.
    this.lighting = new CampusLighting(this.renderer, this.scene, this.sun, sky, { camera: this.camera, hemisphere });
    this.skyEnvironment = this.lighting.reflectionEnvironment;
    this.lighting.update(this.spawn);
    this.ambientOcclusion = new CampusAmbientOcclusion(this.renderer, this.scene, this.camera);
    this.viewport = new ViewportSync(this.renderer, this.camera, host, () => this.ambientOcclusion.resize());
    this.bindControls();
  }
  async init() {
    const start = performance.now();
    const boot = { stage: 'assets', marks: [] as { stage: string; elapsedMs: number }[] };
    (window as unknown as { __campusBoot: unknown }).__campusBoot = boot;
    const markBoot = (stage: string) => {
      boot.stage = stage;
      boot.marks.push({ stage, elapsedMs: performance.now() - start });
    };
    const [data, terrain, , gltf, roofsLidar] = await Promise.all([
      fetch('/data/campus.json').then((r) => {
        if (!r.ok) throw Error('Campus data failed to load');
        return r.json() as Promise<CampusData>;
      }),
      fetch('/data/terrain.json').then((r) => r.json() as Promise<TerrainData>),
      RAPIER.init(),
      new GLTFLoader().loadAsync(this.characterAssetUrl),
      // Measured LiDAR roofs (optional): generated context falls back to campus.json heights.
      fetch('/data/derived/roofs-lidar.json').then(r => r.ok ? r.json() as Promise<RoofsLidar> : null).catch(() => null),
    ]);
    if (this.disposed) return;
    data.landmarks.CAP = { name: 'Texas State Capitol · North grounds',
      position: [-278.335, 1179.898] };
    // The original campus bound sliced through the Capitol's south wing.
    // The authored grounds provide visible, collidable support to Congress Ave.
    data.bounds[3] = Math.max(data.bounds[3], 1536);
    data.landmarks.CAPS = { name: 'Texas State Capitol · Great Walk',
      position: [-363.0, 1433.0] };
    const capitol = data.buildings.find(building => building.id === 533822);
    if (capitol) { capitol.name = 'Texas State Capitol'; capitol.abbr = 'CAP'; }
    // Whole-campus block data (lib/campus/blocks/*/context.json): corrected/excluded/added
    // footprints, catalogue entries and massing. Before anything reads data.buildings.
    this.blockData = applyBlockData(data);
    markBoot('world');
    this.physics = new RAPIER.World({ x: 0, y: -24, z: 0 });
    this.physics.timestep = 1 / 60;
    this.world = new CampusWorld(
      data,
      new Terrain(terrain, capitolGroundReference),
      this.physics,
      () => materials(this.renderer),
      this.renderer,
    );
    // Authored pedestrian details, buildings and landscape.
    // URL parameters never select another scene: the local campus is the only one.
    {
      markBoot('buildings-and-ground');
      this.walkway = new SpeedwayWalkway(
        data,
        this.world.terrain,
        this.physics,
        this.renderer,
        true,
        true,
      );
      markBoot('landscape-details');
      await this.walkway.loadDetails();
      if (this.disposed) return;
      markBoot('offline-campus');
      this.scene.add(this.walkway.group);
    }
    if (this.disposed) return;
    {
      if (!this.walkway) throw Error('The local campus scene is missing');
      markBoot('local-terrain');
      // Aligned Tower photogrammetry decodes alongside the terrain without touching physics.
      // Once decoded it belongs to the game (dispose() frees it on every early-return/throw
      // path); aborting the game signal disposes anything still pending or arriving late.
      const scanTowerLoad = prepareScanTower({ signal: this.signal.signal }).then(prepared => {
        if (this.disposed) { prepared.dispose(); return null; }
        this.scanTowerPrepared = prepared;
        return prepared;
      }, error => {
        if (!this.disposed) console.warn('Tower scan unavailable; keeping the authored Tower.', error);
        return null;
      });
      // DKR: the default stadium is fully authored (stadium-bowl.ts, authored turf). The partial MIT west-stand and field
      // captures load ONLY for explicit diagnostic comparison (`?stadiumscan=1`, scan-landmarks.ts stadiumScanRequested);
      // otherwise neither GLB is requested. Same transactional lifecycle as before: decode now, commit after the bowl.
      const standScan = stadiumScanRequested(location.search);
      const scanStandLoad = !standScan ? Promise.resolve(null) : prepareScanStand({ signal: this.signal.signal }).then(prepared => {
        if (this.disposed) { prepared.dispose(); return null; }
        this.scanStandPrepared = prepared;
        return prepared;
      }, error => {
        if (!this.disposed) console.warn('Stand scan unavailable; keeping the generated west stand.', error);
        return null;
      });
      const localTerrain = await loadOfflineTerrain(this.world.mat.grass);
      if (this.disposed) { localTerrain.dispose(); return; }
      this.world.group.add(localTerrain.mesh);
      for (const geometry of localTerrain.colliderGeometries) this.world.collider(geometry);
      this.offlineTerrain = localTerrain.stats;
      // The aligned scan replaces the authored Tower (and its colliders) above the Main roof;
      // without it, restore the authored Tower. The offline core under the old spot stays.
      const prepared = await scanTowerLoad;
      if (this.disposed) return; // dispose() already released this.scanTowerPrepared
      let scanTower: ScanTower | null = null;
      if (prepared) {
        // Colliders are created only now, on a live physics world.
        try { scanTower = prepared.commit(this.physics); } catch (error) {
          console.warn('Tower scan colliders failed; keeping the authored Tower.', error);
          prepared.dispose();
        }
        this.scanTowerPrepared = undefined;
      }
      if (scanTower) { this.scanTower = scanTower; this.world.group.add(scanTower.group); }
      else buildTower(this.world);
      buildOfflineTowerBase(this.world);
      this.world.flush();
      // Reuse the existing Main facade finishes. Independent clones are owned by
      // the scene cleanup, while the original materials remain walkway-owned.
      const mainMaterial = (name: string) => {
        const material = this.walkway?.materials.find(m => m.name === name);
        if (!material) throw Error(`Missing Main Building material: ${name}`);
        return material.clone();
      };
      const mainEnvelope = buildMainBuildingEnvelope({
        groundHeight: (x, z) => this.world.terrain.height(x, z),
        stone: mainMaterial('Main Building warm limestone'),
        trim: mainMaterial('Main Building pale stone blocks'),
        glass: mainMaterial('Main Building bronze dark glazing'),
        frame: mainMaterial('Main Building bronze sash'),
      });
      const mainStone = this.walkway.materials.find(m => m.name === 'Main east limestone');
      if (!(mainStone instanceof THREE.MeshStandardMaterial) || !mainStone.map)
        throw Error('Main limestone material is missing its local texture');
      this.mainBorrowedTextures.add(mainStone.map);
      this.mainBorrowedTextures.add(this.skyEnvironment.texture);
      this.mainMaterialFinish = applyMainBuildingMaterials(mainEnvelope.meshes, {
        region: 'envelope', limestoneTexture: mainStone.map,
        glassEnvironment: this.skyEnvironment.texture,
      }).stats;
      for (const material of this.walkway.materials) {
        if (material.name === 'Main Building bronze dark glazing' && material instanceof THREE.MeshStandardMaterial) {
          material.envMap = this.skyEnvironment.texture;
          material.envMapIntensity = 1.1;
          material.needsUpdate = true;
        }
      }
      this.world.group.add(...mainEnvelope.meshes);
      for (const geometry of mainEnvelope.colliderGeometries) this.world.collider(geometry);
      this.mainBuildingEnvelope = mainEnvelope.stats;
      this.scene.add(this.world.group);
      markBoot('local-road-finishes');
      const paving = this.walkway?.materials.find(m => m.name === 'Speedway golden brick paving');
      if (!paving) throw Error('Shared Speedway paving material is missing');
      const localSurfaces = await loadLocalSurfaces({ asphalt: this.world.mat.asphalt,
        concrete: this.world.mat.concrete, speedway: paving });
      if (this.disposed) { localSurfaces.dispose(); return; }
      this.localSurfaces = localSurfaces;
      this.scene.add(localSurfaces.group);
      // Whole-campus block geometry (lib/campus/blocks/<id>/index.ts): after the authored walkway and
      // local finishes, before tie-ins, the generated context and trees, which all treat it as
      // authored ground/solids (no duplicate footprint, no trees in it, tie-ins avoid it).
      {
        const walkway = this.walkway, world = this.world;
        const baked = new BakedGround(localTerrain.mesh.geometry.getAttribute('position').array, 8, (x, z) => world.terrain.height(x, z));
        this.blocks = installBlocks({
          data, physics: this.physics, renderer: this.renderer,
          terrainHeight: (x, z) => world.terrain.height(x, z), groundHeight: (x, z) => baked.height(x, z),
          authored: { surfaces: walkway.surfaces, world: world.group },
          material: name => walkway.materials.find(m => m.name === name) ?? Object.values(world.mat).find(m => (m as THREE.Material).name === name) as THREE.Material | undefined,
        }, walkway.surfaces, world.group);
      }
      // Graded soil/lawn batters, level infills, paved ramps and limestone walls
      // replace exposed slab skirts on authored ground (ground/tie-ins.ts).
      // Before the context and vegetation: both treat them as authored ground.
      const tieIns = buildGroundTieIns({ sources: [this.walkway.surfaces], obstacles: [this.walkway.surfaces, this.world.group],
        overlays: [localSurfaces.group], terrainPositions: localTerrain.mesh.geometry.getAttribute('position').array,
        terrainFallback: (x, z) => this.world.terrain.height(x, z),
        isTerrain: mesh => mesh === localTerrain.mesh, buildings: data.buildings, lawn: this.world.mat.grass,
        wall: this.walkway.materials.find(m => m.name === 'East Mall limestone walls and steps') ?? this.world.mat.concrete,
        physics: this.physics, extraSources: heroRouteExtraGround });
      this.walkway.surfaces.add(...tieIns.meshes);
      this.walkway.colliders.push(...tieIns.colliders);
      this.groundTieIns = tieIns.stats;
      // Generated context fills only footprints, stadium and roads that no
      // authored package covers; authored geometry is rasterized first.
      markBoot('local-context');
      // Near-detail cells stream in after boot, so the scene traversal below can
      // miss this glass; it is bound explicitly once the environment exists.
      this.contextGlass = createCampusGlazing('lowE', { name: 'Local context glazing' });
      const contextMaterials = createContextMaterials(this.renderer, { glass: this.contextGlass });
      this.contextDepthMaterial = contextMaterials.depthMaterial;
      const stadiumMaterials = createStadiumMaterials(this.renderer);
      const roadAsphalt = this.world.mat.asphalt.clone();
      roadAsphalt.name = 'Local context road asphalt';
      roadAsphalt.polygonOffset = true;
      roadAsphalt.polygonOffsetFactor = -1;
      roadAsphalt.polygonOffsetUnits = -1;
      // The bowl omits its west-straight rows only when the scanned stand is ready to replace them.
      const standPrepared = await scanStandLoad;
      if (this.disposed) return; // dispose() already released this.scanStandPrepared
      const localContext = buildLocalContext({
        data, physics: this.physics,
        contourHeight: (x, z) => this.world.terrain.height(x, z),
        bakedPositions: localTerrain.mesh.geometry.getAttribute('position').array,
        authoredRoots: [this.walkway.surfaces, this.world.group],
        finishRoots: [localSurfaces.group],
        material: key => key === 'roadAsphalt' ? roadAsphalt
          : contextMaterials.materials.get(key) ?? stadiumMaterials.materials.get(key),
        roofs: roofsLidar,
        // Transactional: the bowl drops its west rows only after the scan's colliders are created
        // on the generated field plane; a failed commit keeps the full generated bowl.
        stadium: standPrepared ? {
          scanSector: SCAN_STAND_SECTOR,
          commitScan: fieldY => { this.scanStand = standPrepared.commit(this.physics, fieldY); },
        } : {},
      });
      this.scene.add(localContext.group);
      this.localContext = localContext.stats;
      this.localContextSolid = localContext.solid;
      if (standPrepared) {
        if (this.scanStand) localContext.group.add(this.scanStand.group);
        else standPrepared.dispose(); // commit failed (logged by the bowl): nothing of the scan stays
        this.scanStandPrepared = undefined;
      }
      // Visual-only scanned DKR turf on the generated field plane (its collider stays).
      if (standScan) loadScanField({ fieldY: localContext.stats.stadium.fieldY, signal: this.signal.signal }).then(field => {
        if (this.disposed) { field.dispose(); return; }
        this.scanField = field;
        localContext.group.add(field.group);
      }, error => { if (!this.disposed) console.warn('Field scan unavailable; keeping the generated turf.', error); });
      this.localContextUpdate = camera => localContext.update(camera);
      // Sun shadow map size/reach/biases now come from render/lighting.ts
      // (legacy values: 4096 map, +/-28 m, bias -0.000015, normalBias 0.008).
      if (new URLSearchParams(location.search).get('contactao') === 'on') {
        const ground = (x: number, z: number) => {
          const from = this.world.terrain.height(x, z) + 3;
          const hit = this.physics.castRay(new RAPIER.Ray({ x, y: from, z }, { x: 0, y: -1, z: 0 }), 8, true);
          return hit ? from - hit.timeOfImpact : null;
        };
        this.contactAo = buildContactAo({ footprints: data.buildings, groundAt: ground,
          trees: this.walkway.treePlacements.map(t => ({ x: t.x, z: t.z, radius: 1.4 })) });
        this.scene.add(this.contactAo.mesh);
      }
      // Live oaks (authored placements), LiDAR canopy trees and the lawn finish.
      // After contact AO: its ground rays must not hit new tree colliders.
      markBoot('vegetation');
      const vegetation = await installCampusVegetation({ physics: this.physics, renderer: this.renderer, data,
        foreground: this.walkway.trees, walkable: [this.walkway.surfaces, this.world.group], paved: [localSurfaces.group],
        terrainPositions: localTerrain.mesh.geometry.getAttribute('position').array,
        terrainFallback: (x, z) => this.world.terrain.height(x, z) });
      if (this.disposed) { vegetation.dispose(); return; }
      this.vegetation = vegetation;
      this.scene.add(vegetation.group);
      // Deep-west extension: last, so nothing built above (blocks, tie-ins, context, trees) sees it.
      if (DEEP_WEST_EXTENSION) {
        markBoot('deep-west');
        await this.installDeepWest(localTerrain.mesh.geometry.getAttribute('position').array,
          key => contextMaterials.materials.get(key));
        if (this.disposed) return;
      }
    }
    if (this.disposed) return;
    const model = gltf.scene;
    const rig = model.getObjectByName('UTCampusCivilian');
    if (!rig) throw Error('The civilian character rig is missing.');
    this.characterName = rig.userData.source;
    this.walkCycleSpeed = rig.userData.locomotion.Walk.speedMetersPerSecond;
    this.runCycleSpeed = rig.userData.locomotion.Run.speedMetersPerSecond;
    // Asset conversion already normalizes the rig to meters. Accessories add
    // height; rescaling by their bounds would shrink the body and its stride.
    // Rocketbox's forward direction is +Z, matching avatar.rotation below.
    for (const name of [
      'L_Thigh',
      'R_Thigh',
      'L_Calf',
      'R_Calf',
      'L_UpperArm',
      'R_UpperArm',
    ]) {
      const bone = model.getObjectByName('Bip01_' + name);
      if (bone) this.airBones[name] = bone;
    }
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.avatar.add(model);
    this.scene.add(this.avatar);
    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations)
      this.actions[clip.name] = this.mixer.clipAction(clip);
    this.actions.Idle?.play();
    this.scooterVisual = buildScooterModel();
    this.scooterVisual.root.visible = false;
    this.scene.add(this.scooterVisual.root);
    this.scooterPose = createScooterPose(model);
    this.flightPose = createFlightPose(model);
    this.avatar.rotation.y = this.yaw + Math.PI;
    const x = this.walkway ? this.spawn.x : 0,
      z = this.walkway ? this.spawn.z : 35,
      y = this.world.terrain.height(x, z) + 0.92;
    this.body = this.physics.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z),
    );
    this.collider = this.physics.createCollider(
      RAPIER.ColliderDesc.capsule(0.54, 0.34).setFriction(0),
      this.body,
    );
    this.controller = this.physics.createCharacterController(0.025);
    this.controller.enableAutostep(0.32, 0.2, false);
    this.controller.enableSnapToGround(0.38);
    this.controller.setMaxSlopeClimbAngle(Math.PI * 0.25);
    this.controller.setMinSlopeSlideAngle(Math.PI * 0.28);
    this.scooterClearance = new ScooterClearance({ world: this.physics, controller: this.controller,
      collider: this.collider, renderedGround: (x, z, fromY, distance) => this.scooterGround.sample(x,z,fromY,distance) });
    // Without the extension these are exactly the original four walls; with it the west wall
    // opens only along the seam span and the extension is closed (extension/deep-west/bounds.ts).
    for (const [cx, cz, hx, hz] of worldBoundaryWalls(data.bounds, this.deepWest?.bounds))
      this.physics.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, 150, hz).setTranslation(cx, 0, cz),
      );
    markBoot('physics');
    this.physics.step();
    this.previousPosition.set(x, y, z);
    this.focus.set(x, y + 0.55, z);
    this.camera.position
      .copy(this.focus)
      .add(
        new THREE.Vector3(
          Math.sin(this.yaw) * this.distance,
          2.2,
          Math.cos(this.yaw) * this.distance,
        ),
      );
    this.ready = true;
    if(this.walkway){
      for(const material of this.walkway.materials)
        if(material.name === 'Capitol exterior glazing' && material instanceof THREE.MeshStandardMaterial) {
          material.envMap=this.skyEnvironment.texture;material.envMapIntensity=.25;material.needsUpdate=true;
        }
      // These named facades borrow the existing sky PMREM; each keeps its
      // local reflection strength without changing the scene's lighting.
      for(const material of this.walkway.materials)
        if(material instanceof THREE.MeshPhysicalMaterial) {
          if(material.name===POB_GLASS_NAME)
            setCampusGlassEnvironment(material,this.skyEnvironment.texture,POB_GLASS_SKY_INTENSITY);
          if(material.name==='NHB blue curtain glazing')
            setCampusGlassEnvironment(material,this.skyEnvironment.texture,2.0);
          if(material.name==='NHB lower recessed window depth')
            setCampusGlassEnvironment(material,this.skyEnvironment.texture,.45);
          if(material.name==='DKR west blue-sky glazing')
            setCampusGlassEnvironment(material,this.skyEnvironment.texture,1.3);
        }
      const names=new Set(['Welch east local reflection glazing','GDC Speedway local reflection glazing']);
      this.localReflection=new CampusLocalReflection(this.renderer,this.scene,this.sky,
        [this.avatar],
        this.walkway.materials.filter(m=>names.has(m.name)),this.ambientOcclusion.materialRenderTarget);
    }
    // Factory glass reflects the sky-coloured environment at its own strength
    // (three would otherwise use scene.environmentIntensity). Before warm-up.
    bindCampusGlassEnvironment(this.scene, this.lighting.reflectionEnvironment.texture);
    if (this.contextGlass && !this.contextGlass.envMap) setCampusGlassEnvironment(this.contextGlass, this.lighting.reflectionEnvironment.texture);
    this.ambientOcclusion.prepareMaterials();
    // Compile every program behind the loading screen (parallel where the GPU
    // driver supports it) instead of during the first seconds of play.
    markBoot('shader-warmup');
    await this.ambientOcclusion.warmUp();
    if (this.disposed) return;
    this.startedAt = performance.now();
    this.last = this.startedAt;
    markBoot('local-ready');
    (window as unknown as { __campus: unknown }).__campus = {
      snapshot: (options?: { includeCharacterBounds?: boolean }) => this.disposed ? {ready:false,active:false} : this.snapshot(options),
      // Read-only collision evidence for path replay; never changes movement.
      collisionDetails: () => Array.from({length:this.controller.numComputedCollisions()},(_,i)=>{
        const hit=this.controller.computedCollision(i);
        if(!hit?.collider)return null;
        const collider=hit.collider;
                const owner=this.walkway?.colliders.some(c=>c.handle===collider.handle)?'walkway':'other';
        let closest: {distance:number;triangle:number[][]}|null=null;
        if(collider.shapeType()===RAPIER.ShapeType.TriMesh){
          const vertices=collider.vertices(),indices=collider.indices();
          const witness=new THREE.Vector3(hit.witness1.x,hit.witness1.y,hit.witness1.z);
          if(indices)for(let j=0;j<indices.length;j+=3){
            const points=[0,1,2].map(k=>new THREE.Vector3().fromArray(vertices,indices[j+k]*3));
            const distance=new THREE.Triangle(points[0],points[1],points[2]).closestPointToPoint(witness,new THREE.Vector3()).distanceTo(witness);
            if(!closest||distance<closest.distance)closest={distance,triangle:points.map(p=>p.toArray())};
          }
        }
        return{owner,handle:collider.handle,shape:collider.shapeType(),witness:hit.witness1,normal:hit.normal1,applied:hit.translationDeltaApplied,remaining:hit.translationDeltaRemaining,closest,geometricError:null};
      }),
      // Shading-only A/B diagnostic; never moves the player or changes physics.
      reflectionMode: (mode:'local'|'sky') => {
        if(mode!=='local'&&mode!=='sky')throw Error('Unknown reflection mode');
        this.localReflection?.setEnabled(mode==='local');
        return this.localReflection?.snapshot();
      },
      // Read-only inspection of the visible surface beneath a viewport point.
      // This identifies leftover scan fragments without moving the player.
      inspectAt: (u: number, v: number) => {
        const ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2(u * 2 - 1, 1 - v * 2), this.camera);
        return ray.intersectObject(this.scene, true).filter(hit => {
          for (let object: THREE.Object3D | null = hit.object; object; object = object.parent) {
            if (!object.visible) return false;
          }
          return true;
        }).slice(0, 8).map(hit => {
          const mesh = hit.object instanceof THREE.Mesh ? hit.object : null;
          return {
          position: hit.point.toArray(), distance: hit.distance, name: hit.object.name,
          source: hit.object.userData.tile ? 'streamed' : 'authored',
          normal: hit.face?.normal.clone().transformDirection(hit.object.matrixWorld).toArray(),
          triangle: hit.face && mesh
            ? [hit.face.a, hit.face.b, hit.face.c].map(index => new THREE.Vector3()
              .fromBufferAttribute(mesh.geometry.attributes.position, index)
              .applyMatrix4(hit.object.matrixWorld).toArray())
            : null,
          };
        });
      },
      // Bounded read-only architectural survey. A streamed hit here is the
      // retained active surface, possibly outside the camera. tileState distinguishes
      // rendered versus resident support. Only ?walkway=scan is uncut.
      rayAt: (origin: [number,number,number], direction: [number,number,number], distance = 100, source: 'all'|'streamed'|'authored' = 'all') => {
        if(this.disposed || ![...origin,...direction,distance].every(Number.isFinite) || distance<=0 || distance>500) return [];
        const d=new THREE.Vector3(...direction);
        if(d.lengthSq()<1e-12)return [];
        const ray=new THREE.Raycaster(new THREE.Vector3(...origin),d.normalize(),0,distance);
        const roots=[this.world.group,...(this.walkway?[this.walkway.surfaces]:[])];
        return ray.intersectObjects(roots,true).filter(hit=>{
          for(let object:THREE.Object3D|null=hit.object;object;object=object.parent)if(!object.visible)return false;
          const streamed=!!hit.object.userData.tile;
          return source==='all'||(source==='streamed'&&streamed)||(source==='authored'&&!streamed);
        }).slice(0,12).map(hit=>({position:hit.point.toArray(),distance:hit.distance,name:hit.object.name,
          source:hit.object.userData.tile?'streamed':'authored',geometricError:hit.object.userData.tile?.geometricError??null,
          normal:hit.face?.normal.clone().transformDirection(hit.object.matrixWorld).toArray()}));
      },
      surfaceAt: (x: number, z: number, fromY = 250, distance = 500) => {
        if (this.disposed || ![x, z, fromY, distance].every(Number.isFinite) || distance <= 0 || distance > 500) return null;
        const hit =
          new THREE.Raycaster(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0), 0, distance)
            .intersectObjects(this.groundRoots(), true)
            .find(h => h.face && h.face.normal.clone().transformDirection(h.object.matrixWorld).y > .5);
        if (!hit) return null;
        const tile = hit.object.userData.tile;
        return {
          position: hit.point.toArray(),
          source: tile ? 'streamed' : 'authored',
          geometricError: tile?.geometricError ?? null,
          children: tile?.children?.length ?? 0,
          leaf: tile?.traversal.isLeaf ?? null,
        };
      },
      // Read-only comparison of the actual supporting collider and tile state.
      // Runs only on explicit inspection, never in movement or rendering loops.
      supportWitnessAt: (x:number,z:number,fromY:number,distance=12) => {
        if(this.disposed||![x,z,fromY,distance].every(Number.isFinite)||distance<=0||distance>40)return null;
        const ray=new RAPIER.Ray({x,y:fromY,z},{x:0,y:-1,z:0});
        const hit=this.physics.castRayAndGetNormal(ray,distance,false,undefined,undefined,this.collider,this.body);
        if(!hit)return null;
        const collider=hit.collider,point=ray.pointAt(hit.timeOfImpact);
                let closest:{distance:number;triangle:number[][]}|null=null;
        if(collider.shapeType()===RAPIER.ShapeType.TriMesh){
          const vertices=collider.vertices(),indices=collider.indices(),t=collider.translation(),r=collider.rotation();
          const translation=new THREE.Vector3(t.x,t.y,t.z),rotation=new THREE.Quaternion(r.x,r.y,r.z,r.w);
          const witness=new THREE.Vector3(point.x,point.y,point.z);
          if(indices)for(let i=0;i<indices.length;i+=3){
            const points=[0,1,2].map(k=>new THREE.Vector3().fromArray(vertices,indices[i+k]*3).applyQuaternion(rotation).add(translation));
            const separation=new THREE.Triangle(...points as [THREE.Vector3,THREE.Vector3,THREE.Vector3]).closestPointToPoint(witness,new THREE.Vector3()).distanceTo(witness);
            if(!closest||separation<closest.distance)closest={distance:separation,triangle:points.map(p=>p.toArray())};
          }
        }
        const directMeshes:THREE.Mesh[]=[];
        const directRay=new THREE.Raycaster(new THREE.Vector3(x,fromY,z),new THREE.Vector3(0,-1,0),0,distance);
        const directVisible=directRay.intersectObjects(directMeshes,false).filter(h=>{
          for(let o:THREE.Object3D|null=h.object;o;o=o.parent)if(!o.visible)return false;
          return true;
        }).slice(0,3).map(h=>({position:h.point.toArray(),normal:h.face?.normal.clone().transformDirection(h.object.matrixWorld).toArray(),name:h.object.name}));
        return {position:[point.x,point.y,point.z],normal:hit.normal,closest,directVisible,
          owner:this.walkway?.colliders.some(c=>c.handle===collider.handle)?'walkway':'other',
          geometricError:null,tile:null};
      },
      // Developer camera shots: read-only render-camera override, exits on input.
      shot: (id: string | null) => this.cameraShots.set(id),
      shots: () => this.cameraShots.list(),
      // Start a fresh profiling window (snapshot().timing.window).
      profileMark: (label = '') => this.profiler.mark(label),
      lighting: () => this.lighting.snapshot(),
      loadMs: performance.now() - start,
    };
    this.report({
      ready: this.ready,
      powerSaving: this.pacing.playFps === 30,
      location: 'Speedway · Gates-Dell',
      speed: 0,
      fps: 0,
      mode: 'Offline local campus',
      offline: this.offline,
      imagery: this.imagerySnapshot(),
    });
    this.raf = requestAnimationFrame(this.tick);
  }
  private imagerySnapshot(): NonNullable<GameStatus['imagery']> {
    return (
      {
        provider: 'Bundled authored campus',
        loaded: 0,
        visible: 0,
        errors: 0,
        progress: 1,
        aligned: true,
        credits: 'Local campus assets · Offline build',
      }
    );
  }
  setPowerSaving(enabled: boolean) {
    this.pacing.setPowerSaving(enabled); this.interactedAt = performance.now(); this.lastHud = 0;
  }
  play() {
    this.interactedAt = performance.now(); this.pacing.reset();
    this.active = true;
    this.renderer.domElement.focus();
  }
  setMapExpanded(open: boolean) {
    if (!this.ready || !this.active) return;
    this.mapExpanded = open;
    this.endFlightHold();
    this.pauseScooter();
    this.keys.clear(); this.pressedAt.clear(); this.jumpQueued = false;
    this.velocity.set(0, 0, 0);
    if (document.pointerLockElement) document.exitPointerLock();
    const p = this.body.translation();
    this.mapCursor = open ? [p.x, p.z] : undefined;
    this.drawMap();
    if (open) this.map.focus(); else this.renderer.domElement.focus();
    this.lastHud = 0;
  }
  cancelTravel(message = 'Travel cancelled.') {
    if (!this.travel) return;
    this.travel = undefined;
    this.focus.copy(this.body.translation()).add(new THREE.Vector3(0, .6, 0));
    this.travelMessage = message; this.travelMessageUntil = performance.now() + 5500;
    this.accumulator = 0; this.lastHud = 0;
    this.renderer.domElement.focus();
  }
  travelTo(requested: Point) {
    if (!this.ready || !this.active || this.travel) return;
    const candidates = travelCandidates(this.world.data, requested, this.deepWest?.travelRegion);
    if (!candidates.length) {
      this.travelMessage = 'Choose a path or an open area within campus.';
      this.travelMessageUntil = performance.now() + 5500; this.lastHud = 0;
      return;
    }
    this.setMapExpanded(false);
    const p = this.body.translation(), now = performance.now();
    this.travel = { requested, candidates, index: 0, started: now, candidateSince: now, lastProbe: 0,
      origin: new THREE.Vector3(p.x, p.y, p.z) };
    this.travelMessage = 'Loading your destination…';
    this.travelMessageUntil = Infinity;
    this.overview = false;
    this.avatar.visible = false;
    if(this.scooterVisual)this.scooterVisual.root.visible = false;
  }
  private updateTravel(now: number) {
    const travel = this.travel;
    if (!travel) return;
    const point = travel.candidates[travel.index];
    const target = new THREE.Vector3(point[0], this.groundHeight(...point) + .905, point[1]);
    this.focus.copy(target).add(new THREE.Vector3(0, .6, 0));
    this.camera.position.copy(this.focus).add(new THREE.Vector3(0, 28, 22));
    this.camera.lookAt(this.focus);
    // All collision and visible ground is local and resident from boot, so a
    // rejected candidate will not improve by waiting. Test candidates back to
    // back within a small per-frame budget; move only onto a verified floor.
    const surface = (x: number, z: number, fromY: number, distance: number) => {
      const ray = new THREE.Raycaster(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0), 0, distance);
      return ray
        .intersectObjects(this.groundRoots(), true)
        .find(h => h.face && h.face.normal.clone().transformDirection(h.object.matrixWorld).y > .5) ?? null;
    };
    const budget = performance.now() + 12;
    do {
      const candidate = travel.candidates[travel.index];
      const landing = travelLanding(this.physics, this.collider, candidate,
        this.groundHeight(...candidate), surface, undefined, travelProbe(this.world.data, candidate));
      if (landing) {
        this.leaveScooter();
        this.leaveFlight();
        this.body.setTranslation(landing, true); this.body.setNextKinematicTranslation(landing);
        this.previousPosition.copy(landing); this.focus.copy(landing).add(new THREE.Vector3(0, .6, 0));
        this.physics.step(); this.accumulator = 0; this.vertical = 0; this.grounded = true;
        this.velocity.set(0, 0, 0); this.keys.clear(); this.pressedAt.clear(); this.jumpQueued = false;
        const offset = Math.hypot(landing.x - travel.requested[0], landing.z - travel.requested[1]);
        this.lastTravel = { requested: travel.requested, arrived: landing.toArray(), offsetMeters: offset };
        this.travelCount++; this.travel = undefined;
        this.travelMessage = offset > 2 ? 'Arrived at a clear spot nearby.' : 'You’re here. Explore from this spot.';
        this.travelMessageUntil = now + 4500; this.lastHud = 0;
        this.drawMap();
        return;
      }
      travel.index++;
      travel.candidateSince = now;
      if (travel.index >= travel.candidates.length) {
        this.cancelTravel('No clear landing here. Try a nearby path.');
        return;
      }
    } while (performance.now() < budget);
    if (this.travel && now - travel.started > 45000) this.cancelTravel('That area could not load. You’re still at your original spot.');
  }
  bindControls() {
    const options = { signal: this.signal.signal };
    const canvas = this.renderer.domElement;
    let dragging = false;
    const wake = () => { this.interactedAt = performance.now(); };
    for (const event of ['keydown', 'keyup', 'pointerdown', 'wheel'])
      window.addEventListener(event, wake, { ...options, passive: true });
    window.addEventListener('pointermove', () => {
      if (dragging || document.pointerLockElement === canvas) wake();
    }, { ...options, passive: true });
    const resume = () => {
      wake(); this.pacing.reset(); this.accumulator = 0;
      this.last = performance.now(); this.fpsSamples = []; this.profiler.resetClock();
      this.previousPosition.copy(this.body?.translation() ?? this.spawn);
    };
    window.addEventListener('focus', resume, options);
    window.addEventListener(
      'keydown',
      (e) => {
        if ((e.target as HTMLElement).tagName === 'INPUT') return;
        if (e.code === 'KeyM' && this.active && !e.repeat) {
          e.preventDefault(); this.setMapExpanded(!this.mapExpanded); return;
        }
        if (e.code === 'Escape') {
          if (this.travel) this.cancelTravel();
          if (this.mapExpanded) this.setMapExpanded(false);
        }
        if (this.travel || this.mapExpanded || e.target === this.map) return;
        if (e.code === 'KeyF' && this.active && !this.overview) {
          e.preventDefault(); if(!e.repeat)this.toggleScooter(); return;
        }
        if ((e.code === 'KeyW' || e.code === 'KeyG') && this.active && !this.overview) {
          e.preventDefault(); this.keys.add(e.code); if (!e.repeat) this.beginFlightHold('up'); return;
        }
        if (['KeyC', 'ControlLeft', 'ControlRight', 'ArrowDown'].includes(e.code) && this.active && this.flight.active && !this.overview) {
          e.preventDefault(); this.keys.add(e.code); if (!e.repeat) this.beginFlightHold('down'); return;
        }
        if (
          [
            'KeyW',
            'KeyA',
            'KeyS',
            'KeyD',
            'Space',
            'ShiftLeft',
            'ShiftRight',
            'ControlLeft',
            'ControlRight',
            'KeyC',
            'ArrowLeft',
            'ArrowRight',
            'ArrowUp',
            'ArrowDown',
          ].includes(e.code)
        ) {
          if (this.active) {
            e.preventDefault();
            this.keys.add(e.code);
            if (!e.repeat) this.pressedAt.set(e.code, performance.now());
            if (e.code === 'Space' && !e.repeat && !this.scooter.mounted && !this.flight.active) this.jumpQueued = true;
          }
        }
        if (e.code === 'Escape') {
          this.pauseScooter(); this.endFlightHold();
          this.keys.clear(); this.pressedAt.clear(); this.jumpQueued = false;
          document.exitPointerLock?.();
        }
        if (e.code === 'KeyV' && this.active && !e.repeat) {
          this.overview = !this.overview; this.pauseScooter(); this.endFlightHold();
          this.keys.clear(); this.pressedAt.clear(); this.jumpQueued = false; this.velocity.set(0,0,0);
        }
      },
      options,
    );
    this.map.addEventListener('click', e => {
      if (!this.drawnMap) return;
      const rect = this.map.getBoundingClientRect();
      this.travelTo(mapPoint(this.drawnMap, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height));
    }, options);
    this.map.addEventListener('keydown', e => {
      if (!this.ready || !this.active || !this.drawnMap) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Space'].includes(e.code)) {
        e.preventDefault(); e.stopPropagation();
        const p = this.body.translation(); this.mapCursor ??= [p.x, p.z];
        const amount = this.mapExpanded ? 20 : 5;
        if (e.code === 'ArrowLeft') this.mapCursor[0] -= amount;
        if (e.code === 'ArrowRight') this.mapCursor[0] += amount;
        if (e.code === 'ArrowUp') this.mapCursor[1] -= amount;
        if (e.code === 'ArrowDown') this.mapCursor[1] += amount;
        if (e.code === 'Enter' || e.code === 'Space') this.travelTo([...this.mapCursor]);
        this.drawMap();
      }
    }, options);
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      const upKeys = ['KeyW', 'KeyG'];
      const downKeys = ['KeyC', 'ControlLeft', 'ControlRight', 'ArrowDown'];
      if(upKeys.includes(e.code) && !upKeys.some(k => this.keys.has(k))) {
        this.endFlightHold('up');
        if(downKeys.some(k => this.keys.has(k)))this.beginFlightHold('down');
      }
      if(downKeys.includes(e.code) && !downKeys.some(k => this.keys.has(k))) {
        this.endFlightHold('down');
        if(upKeys.some(k => this.keys.has(k)))this.beginFlightHold('up');
      }
    }, options);
    const clear = () => {
      this.pauseScooter();
      this.keys.clear();
      this.pressedAt.clear();
      dragging = false;
      this.jumpQueued = false;
      this.flight.pause();
      this.endFlightHold();
    };
    window.addEventListener('blur', clear, options);
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) clear();
        this.last = performance.now();
        resume();
      },
      options,
    );
    canvas.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.active || this.mapExpanded || this.travel) return;
        dragging = true;
        canvas.setPointerCapture(e.pointerId);
        canvas.focus();
      },
      options,
    );
    canvas.addEventListener(
      'pointerup',
      () => {
        dragging = false;
      },
      options,
    );
    canvas.addEventListener(
      'pointermove',
      (e) => {
        if (
          !this.active || this.mapExpanded || this.travel ||
          (!dragging && document.pointerLockElement !== canvas)
        )
          return;
        this.yaw -= e.movementX * 0.003;
        this.pitch = THREE.MathUtils.clamp(
          this.pitch + e.movementY * 0.002,
          -0.9,
          1.12,
        );
      },
      options,
    );
    canvas.addEventListener(
      'dblclick',
      () => {
        if (this.active)
          void Promise.resolve(canvas.requestPointerLock?.()).catch(() => {});
      },
      options,
    );
    canvas.addEventListener(
      'wheel',
      (e) => {
        if (this.active) {
          e.preventDefault();
          if (this.overview)
            this.overviewDistance = THREE.MathUtils.clamp(
              this.overviewDistance + e.deltaY * 0.25,
              120,
              1400,
            );
          else
            this.distance = THREE.MathUtils.clamp(
              this.distance + e.deltaY * 0.006,
              2.5,
              16,
            );
        }
      },
      { signal: this.signal.signal, passive: false },
    );
    // Resizing is coalesced per frame by ViewportSync (render/viewport.ts).
  }
  /** Fetch, validate (seam float-identical to the loaded offline terrain) and install the deep-west
   * extension: colliders from the rendered geometries, then the group under world.group so travel,
   * scooter and flight ground queries see it. Any failure removes partial colliders and keeps the
   * original world (the west wall stays closed because this.deepWest stays unset). */
  private async installDeepWest(offlineTerrainPositions: ArrayLike<number>, context: (key: string) => THREE.Material | undefined) {
    let extension: DeepWest | undefined;
    const colliders: RAPIER.Collider[] = [];
    try {
      extension = await loadDeepWest({ offlineTerrainPositions, signal: this.signal.signal,
        materials: { terrain: this.world.mat.grass, asphalt: this.world.mat.asphalt, concrete: this.world.mat.concrete, context } });
      if (this.disposed) { extension.dispose(); return; }
      for (const g of extension.colliderGeometries) {
        const index = g.index?.array ?? Uint32Array.from({ length: g.attributes.position.count }, (_, i) => i);
        colliders.push(this.physics.createCollider(RAPIER.ColliderDesc.trimesh(
          new Float32Array(g.attributes.position.array), new Uint32Array(index)).setFriction(0.8)));
      }
      this.world.group.add(extension.group);
      this.deepWest = extension;
    } catch (error) {
      if (!this.disposed) for (const c of colliders) this.physics.removeCollider(c, false);
      extension?.dispose();
      if (this.disposed) return;
      this.deepWestFailure = error instanceof Error ? error.message : String(error);
      console.warn('Deep West extension unavailable; keeping the original world.', error);
    }
  }
  /** Terrain height for movement, flight and travel: the deep-west extension where it is loaded
   * and owns (x, z), otherwise exactly the original terrain. */
  private groundHeight(x: number, z: number) {
    return this.deepWest?.height(x, z) ?? this.world.terrain.height(x, z);
  }
  /** Visible surfaces that also have colliders (authored and generated). */
  private groundRoots(): THREE.Object3D[] {
    return [this.world.group, ...(this.walkway ? [this.walkway.surfaces] : []),
      ...(this.localContextSolid ? [this.localContextSolid] : []),
      ...(this.scanStand ? [this.scanStand.groundSurface] : [])];
  }
  private prepareScooterGround() {
    // Authored surfaces and the baked terrain are the complete ground source.
    const roots: THREE.Object3D[] = [this.world.group];
    if (this.walkway) roots.push(this.walkway.surfaces);
    if (this.localContextSolid) roots.push(this.localContextSolid);
    if (this.scanStand) roots.push(this.scanStand.groundSurface);
    this.scooterGround.prepare(roots, this.body.translation(), () => true);
  }
  private notifyRide(message: string) {
    this.scooterMessage = message; this.scooterMessageUntil = performance.now() + 3500; this.lastHud = 0;
  }
  private pauseScooter() {
    this.scooter.stop();
    if(this.scooter.mode === 'mounting')this.leaveScooter();
    else if(this.scooter.mode === 'dismounting') {
      // Every completed substep was physically supported; finish on foot there.
      this.leaveScooter();
    }
    this.velocity.set(0,0,0); this.jumpQueued = false;
  }
  private leaveScooter() {
    this.scooterWarningLatched = false;
    this.scooterPose?.restore(); this.scooter.foot(); this.scooterDismount = undefined;
    this.avatar.rotation.x = 0; this.avatar.rotation.z = 0;
    this.scooterParkedUntil = 0;
    if(this.scooterVisual)this.scooterVisual.root.visible = false;
  }
  private toggleScooter() {
    if(!this.ready || !this.scooterClearance || !this.scooterVisual)return;
    if (this.flight.active) { this.notifyRide('Hold C to land before riding.'); return; }
    if(this.scooter.mode === 'foot') {
      if(!this.grounded || !this.scooterCollisionReady) { this.notifyRide('Move onto a clear path to ride.'); return; }
      this.prepareScooterGround();
      const support = this.scooterClearance.canMount(this.avatar.rotation.y);
      this.scooterSupport = support;
      if(!support.allowed) { this.notifyRide('Move onto a clear path to ride.'); return; }
      this.scooter.mount(this.avatar.rotation.y); this.riderStationary=1; this.velocity.set(0,0,0); this.jumpQueued = false;
      this.scooterMessage = ''; this.scooterWarningLatched = false; this.scooterParkedUntil = 0;
    } else this.scooter.requestDismount();
    this.lastHud = 0;
  }
  beginFlightHold(direction: 'up' | 'down' = 'up') {
    this.interactedAt = performance.now();
    if (!this.ready || !this.active || this.overview || this.mapExpanded || this.travel) return;
    if (this.flightHolding && this.flightHoldDirection === direction) return;
    if(direction === 'down' && !this.flight.active)return;
    if (!this.flight.active) {
      this.leaveScooter();
      this.flight.start();
      this.avatar.rotation.order = 'YXZ';
      this.controller.disableSnapToGround(); this.controller.disableAutostep();
      this.grounded = false;
    }
    this.flightHolding = true; this.flightHoldDirection = direction;
    this.flight.mode = direction === 'down' ? 'landing' : 'flying';
    this.jumpQueued = false;
    this.vertical = 0;
    this.flightLandingTarget = null; this.flightLandingProbeAt = 0;
    this.flightLandingMarker.visible = false;
    this.flightMessage = ''; this.scooterMessage = ''; this.lastHud = 0;
  }
  endFlightHold(direction?: 'up' | 'down') {
    if(direction && this.flightHoldDirection !== direction)return;
    if (!this.flightHolding) return;
    this.flightHolding = false;
    if (this.flight.active) this.flight.mode = 'flying';
    this.flight.velocity.y = 0; this.velocity.y = 0; this.vertical = 0;
    this.flightLandingTarget = null; this.flightLandingMarker.visible = false;
    this.lastHud = 0;
  }
  private leaveFlight() {
    this.flightPose?.restore(); this.flight.stop(); this.flightLean = 0;
    this.flightGroundTarget = null; this.flightGroundLift = 0;
    this.flightLandingTarget = null; this.flightLandingMarker.visible = false;
    this.flightHolding = false;
    this.avatar.rotation.x = 0; this.avatar.rotation.z = 0;
    this.controller.enableSnapToGround(.38); this.controller.enableAutostep(.32, .2, false);
    this.vertical = 0; this.velocity.set(0, 0, 0); this.jumpQueued = false;
  }
  private stepFlight(dt: number, held: (code: string) => boolean) {
    const p = this.body.translation();
    const enabled = this.active && !this.overview && !this.mapExpanded;
    const climb = this.flight.mode === 'landing' ? 0 : (held('Space') || (this.flightHolding && this.flightHoldDirection === 'up') ? 1 : 0);
    const steering = held('ArrowUp') || held('ArrowLeft') || held('ArrowRight') || held('KeyS') || held('KeyA') || held('KeyD');
    if (enabled && this.flight.mode === 'landing' && performance.now() >= this.flightLandingProbeAt) {
      this.flightLandingProbeAt = performance.now() + 200;
      this.flightLandingTarget = this.scooterCollisionReady
        ? findFlightLanding(this.physics, this.collider, p,
          undefined,
          steering ? null : this.flightLandingTarget) : null;
      if (!this.flightLandingTarget) {
        this.flightMessage = this.scooterCollisionReady ? 'Descending · steer toward an open path · release Down to hover.' : 'Preparing the landing surface…';
        this.flightMessageUntil = performance.now() + 600;
      }
    }
    const requested = this.flight.update(dt, {
      forward: (held('ArrowUp') ? 1 : 0) - (held('KeyS') ? 1 : 0),
      strafe: (held('KeyD') ? 1 : 0) - (held('KeyA') ? 1 : 0),
      climb, boost: held('ShiftLeft') || held('ShiftRight'), yaw: this.yaw, y: p.y, enabled,
      x: p.x, z: p.z, landingTarget: this.flightLandingTarget,
    });
    this.flightLandingMarker.visible = enabled && this.flight.mode === 'landing' && this.flightLandingTarget !== null;
    if (this.flightLandingTarget) this.flightLandingMarker.position.set(this.flightLandingTarget.x, this.flightLandingTarget.y - .87, this.flightLandingTarget.z);
    const terrainY = this.groundHeight(p.x, p.z);
    const delta = requested.clone().multiplyScalar(dt);
    const [clampedX, clampedZ] = clampToWorld(this.world.data.bounds, this.deepWest?.bounds, p.x + delta.x, p.z + delta.z);
    delta.x = clampedX - p.x;
    delta.z = clampedZ - p.z;
    this.flightGroundTarget = null; this.flightGroundLift = 0;
    const horizontalSpeed = Math.hypot(requested.x, requested.z);
    if (enabled && this.flight.mode === 'flying' && climb === 0 && horizontalSpeed > .25) {
      // Look along the route rather than holding a fixed world Y until a stair
      // riser catches the capsule. Short downward physics probes see the same
      // loaded ground as movement; steep wall faces never qualify as floors.
      const ahead = THREE.MathUtils.clamp(horizontalSpeed * .4, 1.5, 10);
      let floorY = -Infinity;
      for (const distance of [0, ahead * .5, ahead]) {
        const x = p.x + requested.x / horizontalSpeed * distance;
        const z = p.z + requested.z / horizontalSpeed * distance;
        const fromY = p.y + 2;
        const hit = this.physics.castRayAndGetNormal(
          new RAPIER.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 }),
          18, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.collider, this.body,
        );
        if (hit && hit.normal.y > .65) floorY = Math.max(floorY, fromY - hit.timeOfImpact);
      }
      if (Number.isFinite(floorY)) {
        this.flightGroundTarget = floorY + .905 + FLIGHT_TUNING.groundClearance;
        this.flightGroundLift = THREE.MathUtils.clamp((this.flightGroundTarget - p.y) * 4, 0, FLIGHT_TUNING.climbSpeed);
        delta.y = Math.max(delta.y, this.flightGroundLift * dt);
      }
    }
    // The HUD measures feet above terrain, so apply the cap to that same datum.
    delta.y = Math.min(delta.y, Math.max(0, terrainY + .905 + FLIGHT_TUNING.maxHeightAboveTerrain - p.y));
    this.previousPosition.set(p.x, p.y, p.z);
    this.controller.computeColliderMovement(this.collider, delta);
    const movement = this.controller.computedMovement();
    const supported = characterSupported(this.controller, p.y, requested.y);
    this.contacts = this.controller.numComputedCollisions();
    this.flight.blocked = new THREE.Vector3(movement.x, movement.y, movement.z).distanceTo(delta) > .015;
    if (enabled && this.flight.mode === 'landing' && this.flight.blocked && !supported && Math.hypot(movement.x, movement.z) < .001) {
      this.flightMessage = 'Landing route blocked. Steer toward an open path · release the descent key to hover.';
      this.flightMessageUntil = performance.now() + 600;
    }
    this.body.setNextKinematicTranslation({ x: p.x + movement.x, y: p.y + movement.y, z: p.z + movement.z });
    this.physics.step();
    this.velocity.set(movement.x / dt, movement.y / dt, movement.z / dt);
    this.vertical = this.velocity.y; this.grounded = false;
    const speed = Math.hypot(movement.x, movement.z) / dt;
    if (speed > .15) {
      const heading = Math.atan2(movement.x, movement.z);
      this.avatar.rotation.y += (THREE.MathUtils.euclideanModulo(heading - this.avatar.rotation.y + Math.PI, Math.PI * 2) - Math.PI) * (1 - Math.exp(-dt * 7));
    }
    if (this.action !== 'Idle') {
      this.actions[this.action]?.fadeOut(.18); this.actions.Idle?.reset().fadeIn(.18).play(); this.action = 'Idle';
    }
    this.mixer?.update(dt);
    if (enabled && requested.y < -.1 && supported) {
      this.leaveFlight(); this.grounded = true;
      this.flightMessage = 'Landed. Arrow keys to run · hold W to rise again.';
      this.flightMessageUntil = performance.now() + 3000; this.lastHud = 0;
    }
  }
  private updateScooterVisual(position: {x:number;y:number;z:number}) {
    const model=this.scooterVisual;
    if(!model)return;
    const dismount=this.scooterDismount;
    if(this.scooter.mounted) {
      const p=dismount?.start ?? position;
      model.root.position.set(p.x,p.y-.905,p.z);
      const rotation=this.scooterSupport?.support?.rotation;
      if(rotation)model.root.quaternion.set(rotation.x,rotation.y,rotation.z,rotation.w);
      else model.root.rotation.set(0,this.scooter.heading,0,'YXZ');
      model.root.rotateZ(this.scooter.lean);
      model.update({steer:this.scooter.steer,distance:this.scooter.distance,parked:!!dismount});
    }
    model.root.visible = !this.travel && (this.scooter.mounted || performance.now()<this.scooterParkedUntil);
  }
  private stepScooter(dt: number, held: (code:string)=>boolean) {
    const motion=this.scooter, clearance=this.scooterClearance!, p=this.body.translation();
    this.prepareScooterGround();
    this.previousPosition.set(p.x,p.y,p.z); this.jumpQueued=false; this.vertical=0;
    if(this.mapExpanded || this.overview || !this.active || !this.scooterCollisionReady)motion.stop();
    const allowInput=!this.mapExpanded && !this.overview && this.active && this.scooterCollisionReady;
    if(motion.pendingDismount && motion.speed<=SCOOTER_TUNING.dismountSpeed) {
      const landing=clearance.findDismount(motion.heading);
      if(landing.allowed && landing.center) {
        this.scooterDismount={start:new THREE.Vector3(p.x,p.y,p.z),target:new THREE.Vector3(landing.center.x,landing.center.y,landing.center.z),path:landing.path,heading:motion.heading};
        motion.beginDismount();
      } else { motion.stop(); this.notifyRide('Move to a clearer spot to get off.'); }
    }
    const beforeHeading=motion.heading;
    const requested=motion.update(dt,{throttle:allowInput&&held('ArrowUp'),brake:allowInput&&(held('ArrowDown')||held('KeyS')||held('Space')),left:allowInput&&(held('ArrowLeft')||held('KeyA')),right:allowInput&&(held('ArrowRight')||held('KeyD'))});
    let movement: {x:number;y:number;z:number} = {x:0,y:0,z:0};
    let supported=false;
    if(this.scooterDismount) {
      const dismount=this.scooterDismount, progress=motion.mode==='foot'?1:motion.transition;
      const cursor=progress*(dismount.path.length-1),i=Math.min(dismount.path.length-2,Math.floor(cursor));
      const waypoint=new THREE.Vector3().copy(dismount.path[i]).lerp(dismount.path[i+1],cursor-i);
      const checked=clearance.traceDismount({x:p.x,y:p.y,z:p.z},{x:waypoint.x-p.x,z:waypoint.z-p.z});
      let accepted=false;
      if(checked.allowed && checked.center) {
        this.controller.computeColliderMovement(this.collider,{x:checked.center.x-p.x,y:checked.center.y-p.y-.0067,z:checked.center.z-p.z});
        const actual=this.controller.computedMovement();
        const actualPath=clearance.traceDismount({x:p.x,y:p.y,z:p.z},{x:actual.x,z:actual.z});
        const center={x:p.x+actual.x,y:p.y+actual.y,z:p.z+actual.z};
        accepted=actualPath.allowed && !!actualPath.center && Math.abs(center.y-actualPath.center.y)<.04 && clearance.canOccupyPerson(center).allowed;
        if(accepted) {movement=actual;supported=true;}
      }
      if(!accepted) {
        this.leaveScooter();this.notifyRide('The path changed. Stopped here on foot.');
      } else if(motion.mode==='foot') {
        this.scooterDismount=undefined;this.scooterParkedUntil=performance.now()+500;
      }
    } else {
      const queryStarted=performance.now();
      const resolved=clearance.resolveMove({displacement:{x:requested.x,z:requested.z},fromHeading:beforeHeading,heading:requested.heading});
      this.scooterQueryMs.push(performance.now()-queryStarted);
      if(this.scooterQueryMs.length>120)this.scooterQueryMs.shift();
      movement=resolved.delta;supported=resolved.grounded;
      motion.reconcile(movement.x,movement.z,dt,resolved.allowedHeading,!!resolved.blockedReason);
      this.scooterSupport=resolved;
      // Small contact-solver reductions on a supported grade are ordinary
      // riding, not a reason to tell the player to take the stairs on foot.
      const warn=resolved.blockedReason && !(resolved.blockedReason==='controller' && resolved.fraction>=.8);
      if(warn && Math.hypot(requested.x,requested.z)>.0001 && !this.scooterWarningLatched) {
        const reason=resolved.blockedReason;
        const message=reason==='unsupported'||reason==='surface-mismatch'
          ? 'Waiting for the path ahead…'
          : reason==='step'||reason==='drop'||reason==='slope'
            ? 'Steps or rough ground ahead.'
            : 'Path blocked. Brake and steer around.';
        this.notifyRide(message);
        this.scooterWarningLatched=true;
      } else if(!warn && Math.hypot(movement.x,movement.z)>.01) {
        // A stopped obstacle should not renew its toast on every physics tick.
        this.scooterWarningLatched=false;
      }
    }
    this.body.setNextKinematicTranslation({x:p.x+movement.x,y:p.y+movement.y,z:p.z+movement.z});
    this.physics.step();this.contacts=this.controller.numComputedCollisions();
    this.grounded=supported;
    this.velocity.set(movement.x/dt,0,movement.z/dt);
    this.avatar.position.set(p.x+movement.x,p.y+movement.y-.905,p.z+movement.z);
    this.avatar.rotation.set(0,motion.heading,motion.lean,'YXZ');
    if(this.action!=='Idle') {this.actions[this.action]?.fadeOut(.18);this.actions.Idle?.reset().fadeIn(.18).play();this.action='Idle';}
    if(this.actions.Idle)this.actions.Idle.timeScale=1;
    this.mixer?.update(dt);
    this.updateScooterVisual(this.body.translation());
    this.avatar.updateMatrixWorld(true);
    this.riderStationary += ((motion.actualSpeed<.15?1:0)-this.riderStationary)*(1-Math.exp(-dt*8));
    if(motion.mounted && this.scooterVisual)this.scooterPose?.apply({targets:this.scooterVisual.targets,weight:motion.weight,stationary:this.riderStationary});
    else { this.scooterPose?.restore();this.avatar.rotation.x=0;this.avatar.rotation.z=0; }
  }
  step(dt: number) {
    this.flightPose?.restore();
    this.scooterPose?.restore();
    const held = (code: string) =>
      this.keys.has(code) ||
      performance.now() - (this.pressedAt.get(code) ?? -1000) < 65;
    const forward = (held('ArrowUp') ? 1 : 0) - (held('ArrowDown') || held('KeyS') ? 1 : 0),
      strafe = (held('KeyD') ? 1 : 0) - (held('KeyA') ? 1 : 0);
    // Scooters steer their own heading; let the chase camera follow it.
    if(this.scooter.mounted) {
      this.stepScooter(dt,held);
      const targetYaw = this.scooter.heading - Math.PI;
      this.yaw += (THREE.MathUtils.euclideanModulo(targetYaw - this.yaw + Math.PI, Math.PI * 2) - Math.PI) * (1 - Math.exp(-dt * 5));
      return;
    }
    if (this.keys.has('ArrowLeft')) this.yaw += dt * 1.6;
    if (this.keys.has('ArrowRight')) this.yaw -= dt * 1.6;
    if(this.flight.active) { this.stepFlight(dt,held);return; }
    const input = new THREE.Vector3(strafe, 0, -forward);
    if (input.lengthSq() > 0) input.normalize();
    input.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    const speed =
      held('ArrowUp') || held('ArrowDown') || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? RUN_SPEED : WALK_SPEED;
    const alpha = 1 - Math.exp(-dt * (this.grounded ? 13 : 4));
    this.velocity.x = THREE.MathUtils.lerp(
      this.velocity.x,
      input.x * speed,
      alpha,
    );
    this.velocity.z = THREE.MathUtils.lerp(
      this.velocity.z,
      input.z * speed,
      alpha,
    );
    if (this.jumpQueued && this.grounded) {
      this.vertical = 7.2;
      this.grounded = false;
      this.jumps++;
    }
    this.jumpQueued = false;
    this.vertical = Math.max(-35, this.vertical - 24 * dt);
    const p = this.body.translation();
    this.previousPosition.set(p.x, p.y, p.z);
    this.controller.computeColliderMovement(this.collider, {
      x: this.velocity.x * dt,
      y: this.vertical * dt,
      z: this.velocity.z * dt,
    });
    const movement = this.controller.computedMovement();
    this.grounded = characterSupported(this.controller, p.y, this.vertical);
    this.contacts = this.controller.numComputedCollisions();
    if (this.grounded && this.vertical < 0) this.vertical = 0;
    if (this.vertical > 0 && movement.y < this.vertical * dt - 0.01)
      this.vertical = 0;
    this.body.setNextKinematicTranslation({
      x: p.x + movement.x,
      y: p.y + movement.y,
      z: p.z + movement.z,
    });
    this.physics.step();
    // No wall tunneling: rotation and animation use the displacement physics allowed.
    const actualSpeed = Math.hypot(movement.x, movement.z) / dt;
    if (actualSpeed > 0.1) {
      const angle = Math.atan2(movement.x, movement.z);
      this.avatar.rotation.y +=
        (THREE.MathUtils.euclideanModulo(
          angle - this.avatar.rotation.y + Math.PI,
          2 * Math.PI,
        ) -
          Math.PI) *
        (1 - Math.exp(-dt * 14));
    }
    const next = !this.grounded
      ? 'Idle'
      : actualSpeed > 3.3
        ? 'Run'
        : actualSpeed > 0.2
          ? 'Walk'
          : 'Idle';
    if (next !== this.action) {
      this.actions[this.action]?.fadeOut(0.18);
      this.actions[next]?.reset().fadeIn(0.18).play();
      this.action = next;
    }
    if (this.actions[next])
      this.actions[next].timeScale =
        next === 'Run'
          ? actualSpeed / this.runCycleSpeed
          : next === 'Walk'
            ? actualSpeed / this.walkCycleSpeed
            : 1;
    this.mixer?.update(dt);
    if (!this.grounded) {
      const bend = THREE.MathUtils.clamp(
        1 - Math.abs(this.vertical) / 15,
        0.3,
        1,
      );
      for (const [name, bone] of Object.entries(this.airBones)) {
        const amount = name.endsWith('Thigh')
          ? 0.5
          : name.endsWith('Calf')
            ? -0.95
            : 0.2;
        // This rig's limb hinge is local Z. Its matching idle clip resets these
        // rotations each step, preventing procedural airborne pose accumulation.
        bone.rotateZ(amount * bend);
      }
    }
  }
  tick = (now: number) => {
    const cpuFrameStart = performance.now();
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    const moving = this.keys.size > 0 || this.jumpQueued || this.flightHolding
      || this.velocity.lengthSq() > .01 || (!this.grounded && !this.flight.active)
      || (this.scooter.mounted && this.scooter.actualSpeed > .02);
    const quiet = !this.cameraShots.active && !this.travel && (!this.active || this.mapExpanded || (!moving && now - this.interactedAt > 2500));
    const elapsed = this.pacing.sample(now, { hidden: document.hidden, focused: document.hasFocus(), quiet });
    if (elapsed === null) {
      if (document.hidden || !document.hasFocus()) this.accumulator = 0;
      return;
    }
    const rawElapsed = Math.max(0, (now - this.last) / 1000);
    this.last = now;
    this.viewport.apply();
    if (this.travel) {
      this.updateTravel(now);
      this.accumulator = 0;
      this.avatar.visible = false;
      this.walkway?.update(this.camera);
      this.localContextUpdate?.(this.camera.position);
      this.vegetation?.update(this.camera);
      this.ambientOcclusion.render(false);
      if (now - this.lastHud > 250) {
        this.lastHud = now;
        this.report({ ready: this.ready, powerSaving: this.pacing.playFps === 30, location: 'UT Austin', speed: 0, fps: 0,
          mode: 'Travel', mapExpanded: this.mapExpanded, traveling: !!this.travel,
          travelMessage: this.travelMessage, offline: this.offline,
          imagery: this.imagerySnapshot() });
        this.drawMap();
      }
      return;
    }
    if (rawElapsed > 0) this.fpsSamples.push(rawElapsed * 1000);
    if (this.fpsSamples.length > 600) this.fpsSamples.shift();
    this.accumulator += elapsed;
    while (this.accumulator >= 1 / 60) {
      this.step(1 / 60);
      this.accumulator -= 1 / 60;
    }
    const current = this.body.translation(),
      p = this.previousPosition
        .clone()
        .lerp(
          new THREE.Vector3(current.x, current.y, current.z),
          this.accumulator / (1 / 60),
        );
    this.avatar.position.set(p.x, p.y - 0.905, p.z);
    if (this.flight.active) {
      const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
      const lean = this.active && !this.mapExpanded && !this.overview && this.flight.mode !== 'landing'
        ? THREE.MathUtils.smoothstep(horizontalSpeed, 1, 14) * 1.28 : 0;
      this.flightLean = THREE.MathUtils.lerp(this.flightLean, lean, 1 - Math.exp(-elapsed * 6));
      this.avatar.rotation.x = this.flightLean;
      // Tilt around the hips, keeping the flying body's center near its capsule.
      const pivot = new THREE.Vector3(0, .85, 0).sub(new THREE.Vector3(0, .85, 0).applyEuler(this.avatar.rotation));
      this.avatar.position.add(pivot);
      this.flightPose?.apply(this.avatar, this.flightLean / 1.28);
    }
    this.updateScooterVisual(p);
    this.focus.lerp(
      new THREE.Vector3(p.x, p.y + 0.6, p.z),
      1 - Math.exp(-elapsed * 12),
    );
    const overviewCamera = this.overview;
    this.rideCameraBlend += ((this.scooter.mounted?1:0)-this.rideCameraBlend)*(1-Math.exp(-elapsed*4));
    const flightRatio = this.flight.active ? Math.min(1, this.velocity.length() / FLIGHT_TUNING.boostSpeed) : 0;
    const requestedDistance = this.distance + .9*this.rideCameraBlend + 1.8*flightRatio;
    const fov = 55 + 3*this.rideCameraBlend*Math.min(1,this.scooter.actualSpeed/this.scooter.maxSpeed) + 10*flightRatio;
    if(Math.abs(this.camera.fov-fov)>.005) {this.camera.fov=fov;this.camera.updateProjectionMatrix();}
    const viewPitch = overviewCamera ? 0.95 : this.pitch;
    const offset = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(viewPitch),
      Math.sin(viewPitch),
      Math.cos(this.yaw) * Math.cos(viewPitch),
    );
    const hit = this.physics.castShape(
      this.focus,
      { x: 0, y: 0, z: 0, w: 1 },
      offset,
      new RAPIER.Ball(0.23),
      0.03,
      requestedDistance,
      true,
      undefined,
      undefined,
      this.collider,
    );
    const cameraDistance = overviewCamera
      ? this.active
        ? this.overviewDistance
        : 280
      : hit
        ? Math.max(0.03, hit.time_of_impact - 0.035)
        : requestedDistance;
    this.avatar.visible = cameraDistance > 0.85;
    this.camera.position
      .copy(this.focus)
      .addScaledVector(offset, cameraDistance);
    this.camera.lookAt(this.focus);
    // A developer camera shot replaces only the render camera (never the body).
    const viewFocus = this.cameraShots.apply(this.camera) ? this.cameraShots.focus : p;
    // Sun shadows (single texel-snapped map or cascades) follow the view focus.
    this.lighting.update(viewFocus);
    this.contactShadow?.update(p, now);
    this.world.update(viewFocus.x, viewFocus.z);
    this.profiler.begin(this.frames);
    this.walkway?.update(this.camera);
    this.localContextUpdate?.(this.camera.position);
    this.vegetation?.update(this.camera);
    if(this.active&&!overviewCamera)this.localReflection?.update(p,now);
    this.ambientOcclusion.render(!overviewCamera);
    this.profiler.end(performance.now() - cpuFrameStart);
    this.profiler.recordRender(this.renderer.info.render, now);
    this.frames++;
    if (now - this.lastHud > 250) {
      this.lastHud = now;
      let location = 'UT Austin',
        closest = Infinity;
      for (const v of Object.values(this.world.data.landmarks)) {
        const d = Math.hypot(v.position[0] - p.x, v.position[1] - p.z);
        if (d < closest) {
          closest = d;
          location = v.name;
        }
      }
      if (Math.abs(p.x) < 25 && Math.abs(p.z) < 320)
        location = 'Speedway · ' + location;
      // The legacy nearest-landmark search has no distance cutoff; inside the
      // deep-west extension it would name a distant core landmark.
      if (this.deepWest?.contains(p.x, p.z)) location = 'West Campus';
      const recent = this.fpsSamples.slice(-60),
        fps = recent.length ? 1000 / (recent.reduce((a, b) => a + b, 0) / recent.length) : 0;
      this.report({
        ready: true,
        powerSaving: this.pacing.playFps === 30,
        location,
        speed: Math.hypot(this.velocity.x, this.velocity.z),
        fps,
        mode: this.flight.active ? this.flight.mode === 'landing' ? 'Landing' : 'Flight' : this.scooter.mounted ? 'Scooter' : this.grounded ? this.action : 'Jump',
        locomotion: this.flight.active ? this.flight.mode : this.scooter.mode, scooterSpeed: this.scooter.actualSpeed,
        flightSpeed: this.flight.active ? this.velocity.length() : 0,
        flightHeight: Math.max(0, p.y - .905 - this.groundHeight(p.x, p.z)),
        flightMessage: now < this.flightMessageUntil ? this.flightMessage : undefined,
        flightHolding: this.flightHolding,
        rideMessage: now<this.scooterMessageUntil ? this.scooterMessage : undefined,
        offline: this.offline,
        imagery: this.imagerySnapshot(),
        overview: this.overview,
        mapExpanded: this.mapExpanded,
        traveling: false,
        travelMessage: now < this.travelMessageUntil ? this.travelMessage : undefined,
        heading: (() => {
          const deg = THREE.MathUtils.euclideanModulo(
            (-this.yaw * 180) / Math.PI,
            360,
          );
          return (
            ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][
              Math.round(deg / 45) % 8
            ] +
            ' · ' +
            Math.round(deg) +
            '°'
          );
        })(),
      });
      this.trail.push({
        t: Math.round(now - this.startedAt),
        x: p.x,
        y: p.y,
        z: p.z,
        grounded: this.grounded,
        action: this.action,
      });
      if (this.trail.length > 1200) this.trail.shift();
      this.drawMap();
    }
  };
  drawMap() {
    const ctx = this.map.getContext('2d');
    if (!ctx) return;
    const p = this.body.translation(),
      view = mapView(mapBounds(this.world.data.bounds, this.deepWest?.bounds), p, this.mapExpanded),
      { size, scale } = view;
    this.drawnMap = view;
    if (this.map.width !== size) this.map.width = this.map.height = size;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#27352b';
    ctx.fillRect(0, 0, size, size);
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.scale(scale, scale);
    ctx.translate(-view.x, -view.z);
    this.deepWest?.drawMap(ctx);
    ctx.strokeStyle = '#d2cfb899';
    for (const path of this.world.data.paths) {
      if (
        !path.points.some(
          ([x, z]) => Math.abs(x - view.x) < size / scale && Math.abs(z - view.z) < size / scale,
        )
      )
        continue;
      ctx.lineWidth = Math.max(2, path.width);
      ctx.beginPath();
      path.points.forEach(([x, z], i) =>
        i ? ctx.lineTo(x, z) : ctx.moveTo(x, z),
      );
      ctx.stroke();
    }
    ctx.fillStyle = '#c1bca6';
    for (const b of this.world.data.buildings) {
      if (Math.hypot(b.center[0] - view.x, b.center[1] - view.z) > size / scale) continue;
      ctx.beginPath();
      b.rings.forEach((r) => {
        r.forEach(([x, z], i) => (i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)));
        ctx.closePath();
      });
      ctx.fill('evenodd');
    }
    ctx.restore();
    for (const [abbr, l] of Object.entries(this.world.data.landmarks)) {
      const x = (l.position[0] - view.x) * scale + size / 2,
        z = (l.position[1] - view.z) * scale + size / 2;
      if (x < 12 || x > size - 28 || z < 18 || z > size - 8) continue;
      ctx.fillStyle = '#ce702e';
      ctx.beginPath();
      ctx.arc(x, z, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `bold ${this.mapExpanded ? 18 : 13}px Arial`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#203329';
      ctx.strokeText(abbr, x + 7, z + 4);
      ctx.fillStyle = '#fff';
      ctx.fillText(abbr, x + 7, z + 4);
    }
    ctx.save();
    const destination = this.travel?.requested ?? this.mapCursor;
    if (destination) {
      const x = (destination[0] - view.x) * scale + size / 2, z = (destination[1] - view.z) * scale + size / 2;
      ctx.strokeStyle = '#ffb779'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, z, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 14, z); ctx.lineTo(x + 14, z); ctx.moveTo(x, z - 14); ctx.lineTo(x, z + 14); ctx.stroke();
    }
    ctx.translate((p.x - view.x) * scale + size / 2, (p.z - view.z) * scale + size / 2);
    ctx.rotate(-this.yaw);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#1b2423';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6, 7);
    ctx.lineTo(0, 4);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  snapshot({ includeCharacterBounds = false }: { includeCharacterBounds?: boolean } = {}) {
    const p = this.body?.translation(),
      a = [...this.fpsSamples].sort((a, b) => a - b);
    return {
      ready: this.ready,
      active: this.active,
      ambientOcclusion: this.ambientOcclusion.snapshot(),
      lighting: this.lighting.snapshot(),
      cameraShot: this.cameraShots.snapshot(),
      contactAo: this.contactAo?.stats ?? null,
      programs: this.renderer.info.programs?.length ?? null,
      localReflection: this.localReflection?.snapshot(),
      localSurfaces: this.localSurfaces?.stats,
      mainMaterialFinish: this.mainMaterialFinish,
      mainBuildingEnvelope: this.mainBuildingEnvelope,
      position: p,
      grounded: this.grounded,
      vertical: this.vertical,
      yaw: this.yaw,
      pitch: this.pitch,
      action: this.action,
      character: {
        assetUrl: this.characterAssetUrl,
        source: this.characterName,
        walkCycleSpeed: this.walkCycleSpeed,
        runCycleSpeed: this.runCycleSpeed,
      },
      contactShadow: this.contactShadow?.stats,
      jumps: this.jumps,
      contacts: this.contacts,
      keys: [...this.keys],
      camera: this.camera.position.toArray(),
      terrain: p ? this.groundHeight(p.x, p.z) : null,
      frames: this.frames,
      frameMs: {
        median: a[Math.floor(a.length * 0.5)],
        p95: a[Math.floor(a.length * 0.95)],
        sampleCount: a.length,
      },
      timing: this.profiler.snapshot(),
      pacing: this.pacing.snapshot(),
      render: this.renderer.info.render,
      memory: this.renderer.info.memory,
      // GIS footprint counts do not establish rendered building coverage.
      mappedBuildingFootprints: this.world?.data.buildings.length,
      physicsColliderCount: this.physics?.colliders.len(),
      authoredTreePlacements: this.walkway?.treePlacements.length ?? 0,
      legacyWorldCounts: { colliders: this.world?.colliders, stairs: this.world?.stairCount,
        trees: this.world?.treeCount, mappedTrees: this.world?.mappedTreeCount },
      landscape: this.walkway?.snapshot(),
      vegetation: this.vegetation?.stats(),
      offline: this.offline,
      offlineTerrain: this.offlineTerrain,
      deepWest: this.deepWest ? this.deepWest.stats : { loaded: false, enabled: DEEP_WEST_EXTENSION, failure: this.deepWestFailure ?? null },
      groundTieIns: this.groundTieIns,
      blocks: this.blocks ? { stats: this.blocks.stats, replacements: this.blocks.replacements, data: this.blockData?.applied, rejected: this.blockData?.rejected, excluded: this.blockData?.excluded.map(e => e.key), added: this.blockData?.added.map(e => e.key) } : null,
      localContext: this.localContext,
      imagery: this.imagerySnapshot(),
      overview: this.overview,
      mapExpanded: this.mapExpanded,
      mapView: this.drawnMap,
      travel: { pending: !!this.travel, count: this.travelCount, last: this.lastTravel,
        candidate: this.travel?.candidates[this.travel.index], message: this.travelMessage },
      scooter: {...this.scooter.snapshot(),support:this.scooterSupport,collisionReady:this.scooterCollisionReady,groundQuery:{...this.scooterGround.stats},queryMs:this.scooterQueryMs.length ? {mean:this.scooterQueryMs.reduce((a,b)=>a+b,0)/this.scooterQueryMs.length,max:Math.max(...this.scooterQueryMs)} : null,model:this.scooterVisual?.stats,pose:this.scooterPose?.diagnostics({includeBounds:includeCharacterBounds})},
      flight: { mode: this.flight.mode, velocity: this.flight.velocity.toArray(), speed: this.flight.active ? this.velocity.length() : 0,
        landingTarget: this.flightLandingTarget?.toArray() ?? null,
        holding: this.flightHolding, holdDirection: this.flightHoldDirection,
        heightAboveTerrain: p ? Math.max(0, p.y - .905 - this.groundHeight(p.x, p.z)) : 0,
        lean: this.flightLean, blocked: this.flight.blocked, groundTarget: this.flightGroundTarget,
        groundLift: this.flightGroundLift, tuning: FLIGHT_TUNING },
      movement: { walkSpeed: WALK_SPEED, runSpeed: RUN_SPEED, speed: Math.hypot(this.velocity.x, this.velocity.z) },
      viewport: {
        width: this.host.clientWidth,
        height: this.host.clientHeight,
        pixelRatio: this.renderer.getPixelRatio(),
      },
      renderer: this.renderer
        .getContext()
        .getParameter(this.renderer.getContext().RENDERER),
      trail: this.trail.slice(-20),
    };
  }
  dispose() {
    // React hot reload can invoke cleanup more than once for the same instance.
    // Rapier's world.free() is not idempotent.
    if (this.disposed) return;
    this.disposed = true;
    if (this.world) this.world.disposed = true;
    // Before physics.free(): scan disposal removes its own colliders.
    this.scanField?.dispose();
    this.deepWest?.dispose();
    this.scanTower?.dispose();
    this.scanTowerPrepared?.dispose();
    this.scanTowerPrepared = undefined;
    this.scanStand?.dispose();
    this.scanStandPrepared?.dispose();
    this.scanStandPrepared = undefined;
    // Cancels pending scan loads now (they dispose late arrivals themselves); the generic
    // this.signal.abort() below is then a no-op for them.
    this.signal.abort();
    this.contactShadow?.dispose();
    this.ambientOcclusion.dispose();
    this.cameraShots.dispose();
    this.viewport.dispose();
    this.contactAo?.dispose();
    // Road finishes borrow textures from both the walkway and world. Dispose
    // only their clones here, then remove them before generic scene cleanup
    // collects textures already owned by those two source systems.
    this.localSurfaces?.group.removeFromParent();
    this.localSurfaces?.dispose();
    this.vegetation?.dispose();
    this.blocks?.dispose(); // removes block colliders (physics still alive) and meshes
    if (this.walkway && this.physics) this.walkway.dispose(this.physics);
    cancelAnimationFrame(this.raf);
    this.signal.abort();
    this.localReflection?.dispose();
    this.scooterGround.clear();
    this.scooterPose?.dispose();
    this.flightPose?.restore();
    this.scooterVisual?.dispose();
    if (document.pointerLockElement === this.renderer.domElement)
      document.exitPointerLock();
    const geometries = new Set<THREE.BufferGeometry>(),
      mats = new Set<THREE.Material>(),
      textures = new Set<THREE.Texture>();
    for (const root of [this.scene, this.world?.group])
      root?.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) geometries.add(mesh.geometry);
        if (mesh.material)
          for (const material of Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material]) {
            mats.add(material);
            for (const value of Object.values(material))
              if (value instanceof THREE.Texture) textures.add(value);
          }
        if (o instanceof THREE.SkinnedMesh) o.skeleton.dispose();
      });
    for (const material of Object.values(this.world?.loadedMaterials ?? {})) {
      mats.add(material);
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) textures.add(value);
    }
    geometries.forEach((g) => g.dispose());
    // Not reachable through mesh.material: dispose the facade depth material explicitly.
    this.contextDepthMaterial?.dispose();
    mats.forEach((m) => m.dispose());
    for (const texture of this.mainBorrowedTextures) textures.delete(texture);
    this.mainBorrowedTextures.clear();
    textures.forEach((t) => t.dispose());
    this.world?.disposePendingResources();
    // Owns skyEnvironment (its reflection target) and the scene environment.
    this.lighting.dispose();
    this.profiler.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.physics?.free();
  }
}
