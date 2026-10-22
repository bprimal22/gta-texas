import {applyMainBuildingMaterials} from './main-building-materials';
import { buildCapitolDome } from './capitol-dome';
import { buildCapitolArea } from './capitol-area';
import {applyHistoricGlazing} from './historic-glazing';
import {applyHistoricMasonry} from './historic-masonry';
import {engineeringSouthwestSeamTrim} from './engineering-southwest-seam';
import {buildEngineeringNorthTransition} from './engineering-north-transition';
import { createRouteHeightSampler } from './sampled-route-height';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { CampusData, Path } from './types';
import type { Terrain } from './terrain';
import { subtractVolumes, type CutVolume } from './clip-volume';
import { ForegroundTrees, type TreePlacement, type HedgePlacement } from './foreground-trees';
import { garrisonGardenTrees } from './garrison-garden';
import { garrisonGardenExtraTrees } from './garrison-garden-extra';
import { prepareGarrisonGround, garrisonNorthDoorApproach } from './garrison-ground';
import { sampleGarrisonFoundation } from './garrison-foundation-grade';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildPclParapet } from './pcl-forecourt';
import { pclMaterials } from './pcl-materials';
import { buildPclFacades } from './pcl-facade';
import { buildPclPlaza, inPclPlaza } from './pcl-plaza';
import { buildGarrisonLandscape } from './garrison-landscape';
import { buildGregoryWalk } from './gregory-walk';
import { buildGregoryNorth } from './gregory-north';
import { buildCentralMalls, inCentralMall } from './central-malls';
import { speedwayCrossingSoilTrim } from './speedway-crossing-soil';
import { brbYardGroundPriority, correctBrbYardGround, inBrbYard, compactBrbGroundTriangles } from './brb-yard-priority';
import { wcpYardGroundPriority, compactWcpGroundTriangles } from './wcp-yard-priority';
import { buildHackermanForecourt, inHackermanForecourt } from './hackerman-forecourt';
import { buildHackermanBuilding } from './hackerman-building';
import { buildMbbFrontage, inMbbFrontage } from './mbb-frontage';
import { buildMlkMall, inMlkMall } from './mlk-mall';
import { applyMlkSurfaces } from './mlk-surfaces';
import { applyMallYardSurfaces } from './mall-yard-surfaces';
import { buildMlkMemorial } from './mlk-memorial';
import { buildMallBuildings } from './mall-buildings';
import { buildHistoricCentralBuildings } from './historic-central-buildings';
import { buildEastSouthModern } from './east-south-modern';
import { buildWillCHogg } from './wch-building';
import { buildMainBuildingBase } from './main-building-base';
import { buildMainEastEntry } from './main-east-entry';
import { buildMainEastApron } from './main-east-apron';
import { buildWelchSouth } from './welch-south';
import { buildWelchSouthRoof } from './welch-south-roof';
import { buildWelchEastYard } from './welch-east-yard';
import { buildWelchDoorwayAprons } from './welch-doorway-aprons';
import { buildWelchApproachGround, compactWelchRouteTriangles } from './welch-approach-ground';
import { buildWelchMiddleEast } from './welch-middle-east';
import { buildWelchMiddleYard } from './welch-middle-yard';
import { buildWelchNorthExit } from './welch-north-exit';
import { buildWelchWestGap } from './welch-west-gap';
import { buildWelchWestCap } from './welch-west-cap';
import { buildWelchNorthSeamClearance } from './welch-north-seam';
import { buildWelchInnerRoof } from './welch-inner-roof';
import { buildMonochromeSculpture } from './monochrome-sculpture';
import { buildGdcFacades } from './gdc-facade';
import { buildGdcNorthNeck } from './gdc-north-neck';
import { buildGdcFrontage, inGdcFrontage } from './gdc-frontage';
import { buildGdcCourtyard } from './gdc-courtyard';
import { buildGdcAtrium } from './gdc-atrium';
import { buildGdcEastCourt } from './gdc-east-court';
import { buildEngineeringPaths } from './engineering-paths';
import { buildEngineeringCourtyard, inEngineeringCourt } from './engineering-courtyard';
import { buildEngineeringEntryClearance, keepEngineeringEntryTree } from './engineering-entry-clearance';
import { buildDkrCorridor } from './dkr-corridor';
import { buildDkrFrontage } from './dkr-frontage';
import { buildDkrForecourt } from './dkr-forecourt';
import { buildDkrWestConnection } from './dkr-west-connection';
import { buildDkrEntranceFinish } from './dkr-entrance-finish';
import { buildDkrEntranceFragmentClearance } from './dkr-entrance-fragments';
import { buildDkrPortalApproachClearance } from './dkr-portal-approach-clearance';
import { buildPobFrontage } from './pob-frontage';
import { buildPobBoundaries } from './pob-boundaries';
import { buildPobSouth } from './pob-south';
import { buildPobSouthClearance } from './pob-south-clearance';
import { buildPobUpperProjection } from './pob-upper-projection';
import { buildPobSouthConnection } from './pob-south-connection';
import { buildPobCourtConnection } from './pob-court-connection';
import { buildPobConnector } from './pob-connector';
import { buildPobUpperClearance } from './pob-upper-clearance';
import pobSouthApronGrade from './pob-south-apron-grade.json' with { type: 'json' };
import { buildWest24 } from './west24';
import { buildWest24Buildings } from './west24-buildings';
import { buildInnerCampus, buildGradedGround } from './inner-campus';
import { buildFlawnBuilding } from './flawn-building';
import { buildHoggBuilding } from './hogg-building';
import { buildUnionBuilding } from './union-building';
import { buildUnionApproach } from './union-approach';
import flawnGroundPlan from '../../public/data/flawn-ground-plan.json' with { type: 'json' };
import speedwayInventory from '../../public/data/speedway-tree-inventory.json' with { type: 'json' };

function distanceToPath(x: number, z: number, path: Path) {
  let nearest = Infinity;
  for (let i = 1; i < path.points.length; i++) {
    const [ax, az] = path.points[i - 1],
      [bx, bz] = path.points[i];
    const dx = bx - ax,
      dz = bz - az;
    const t = Math.max(
      0,
      Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)),
    );
    nearest = Math.min(nearest, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return nearest;
}

// An explicitly bounded repair pilot: the mapped Speedway segment beside GDC.
// Heights are a contour-based approximation; this is not survey-grade terrain.
export class SpeedwayWalkway {
  group = new THREE.Group();
  // Ground queries must not land the player on decorative leaves or branches.
  surfaces = new THREE.Group();
  volumes: CutVolume[] = [];
  colliders: RAPIER.Collider[] = [];
  /** Rendered geometry backed by matching physics, for local terrain masking. */
  readonly groundMaskGeometries = new Set<THREE.BufferGeometry>();
  textures: THREE.Texture[] = [];
  materials: THREE.MeshStandardMaterial[] = [];
  length = 0;
  trees?: ForegroundTrees;
  treePlacements: TreePlacement[] = [];
  hedgePlacements: HedgePlacement[] = [];
  excludedTrees = 0;
  inventoriedTrees = 0;
  sourceWayIds: number[] = [];
  pclParapetMeters = 0;
  pclArchitecture = { faces: 0, bays: 0, triangles: 0 };
  pclPlaza = { tables:0, lamps:0, trees:0, hedges:0, stairFlights:0 };
  centralMalls = { areas:0, stairFlights:0, gradedRisers:0, trees:0, lamps:0, triangles:0, cutVolumes:0 };
  hackerman = { windows:0, roofBlades:0, boats:0, triangles:0, benches:0 };
  mbb = { frontageMeters:0, windows:0, trees:0, lamps:0, skybridges:0, triangles:0 };
  mlk = { areaM2:0, trees:0, lamps:0, benches:0, surfaceCells:0, triangles:0 };
  west24Buildings = { buildings:0, windows:0, triangles:0 };
  mallBuildings = { buildings:0, windows:0, doors:0, triangles:0 };
  historicCentral: ReturnType<typeof buildHistoricCentralBuildings>['stats'] | null = null;
  garrisonLandscape: ReturnType<typeof buildGarrisonLandscape>['stats'] | null = null;
  eastSouthModern: ReturnType<typeof buildEastSouthModern>['stats'] | null = null;
  willCHogg: ReturnType<typeof buildWillCHogg>['stats'] | null = null;
  mainBuilding: ReturnType<typeof buildMainBuildingBase>['stats'] | null = null;
  mainMaterialFinish?: {base: ReturnType<typeof applyMainBuildingMaterials>['stats']; east: ReturnType<typeof applyMainBuildingMaterials>['stats']};
  mainEastEntry: ReturnType<typeof buildMainEastEntry>['stats'] | null = null;
  mainEastApron: ReturnType<typeof buildMainEastApron>['stats'] | null = null;
  welchSouth: ReturnType<typeof buildWelchSouth>['stats'] | null = null;
  welchSouthRoof: ReturnType<typeof buildWelchSouthRoof>['stats'] | null = null;
  welchFrontage: ReturnType<typeof buildWelchEastYard>['stats'] | null = null;
  welchApproaches: ReturnType<typeof buildWelchApproachGround>['stats'] | null = null;
  welchMiddleEast: ReturnType<typeof buildWelchMiddleEast>['stats'] | null = null;
  welchMiddleYard: ReturnType<typeof buildWelchMiddleYard>['stats'] | null = null;
  welchNorthExit: ReturnType<typeof buildWelchNorthExit>['stats'] | null = null;
  welchWestGap: ReturnType<typeof buildWelchWestGap>['stats'] | null = null;
  welchWestCap: ReturnType<typeof buildWelchWestCap>['stats'] | null = null;
  welchNorthSeam: ReturnType<typeof buildWelchNorthSeamClearance>['stats'] | null = null;
  welchInnerRoof: ReturnType<typeof buildWelchInnerRoof>['stats'] | null = null;
  welchAprons: ReturnType<typeof buildWelchDoorwayAprons>['stats'] | null = null;
  facadeSamples: {name:string;origin:number[];direction:number[];minimum:number}[] = [];
  gdc = { faces:0, floors:0, windows:0, triangles:0, hedges:0, towers:0, atriumBands:0 };
  engineering = {routeMeters:0,stairFlights:0,risers:0,triangles:0};
  gregoryWalk: ReturnType<typeof buildGregoryWalk>['stats'] | null = null;
  gregoryNorth: ReturnType<typeof buildGregoryNorth>['stats'] | null = null;
  engineeringCourtyard = {trees:0,lamps:0,benches:0,windows:0,braces:0,triangles:0};
  engineeringEntryClearance: ReturnType<typeof buildEngineeringEntryClearance>['stats'] | null = null;
  dkr = {routeMeters:0,surfaceCells:0,triangles:0};
  dkrFrontage: ReturnType<typeof buildDkrFrontage>['stats'] | null = null;
  dkrForecourt: ReturnType<typeof buildDkrForecourt>['stats'] | null = null;
  dkrWestConnection: ReturnType<typeof buildDkrWestConnection>['stats'] | null = null;
  pobFrontage: ReturnType<typeof buildPobFrontage>['stats'] | null = null;
  pobBoundaries: ReturnType<typeof buildPobBoundaries>['stats'] | null = null;
  gdcNorthNeck: ReturnType<typeof buildGdcNorthNeck>['stats'] | null = null;
  pobConnector: ReturnType<typeof buildPobConnector>['stats'] | null = null;
  pobCourtConnection: ReturnType<typeof buildPobCourtConnection>['stats'] | null = null;
  pobSouthConnection: ReturnType<typeof buildPobSouthConnection>['stats'] | null = null;
  pobUpperClearance: ReturnType<typeof buildPobUpperClearance>['stats'] | null = null;
  pobSouth: ReturnType<typeof buildPobSouth>['stats'] | null = null;
  pobSouthClearance: ReturnType<typeof buildPobSouthClearance>['stats'] | null = null;
  pobUpperProjection: ReturnType<typeof buildPobUpperProjection>['stats'] | null = null;
  dkrEntranceFinish: ReturnType<typeof buildDkrEntranceFinish>['stats'] | null = null;
  west24 = {routeMeters:0,surfaceCells:0,trees:0,planarSlivers:0,triangles:0};
  innerCampus = {routeMeters:0,surfaceCells:0,trees:0,planarSlivers:0,triangles:0};
  flawn: ReturnType<typeof buildFlawnBuilding>['stats'] | null = null;
  hogg: ReturnType<typeof buildHoggBuilding>['stats'] | null = null;
  union: ReturnType<typeof buildUnionBuilding>['stats'] | null = null;
  capitolDome: ReturnType<typeof buildCapitolDome>['stats'] | null = null;
  capitolArea: ReturnType<typeof buildCapitolArea>['stats'] | null = null;
  private auxiliaryGeometries: THREE.BufferGeometry[] = [];
  private seamGeometry?: THREE.BufferGeometry;
  private seamMesh?: THREE.Mesh;
  private seamTrimVolumes: CutVolume[]=[];
  private seamCollider?: RAPIER.Collider;
  private seamSamples: {
    index: number;
    linkedIndex: number;
    x: number;
    z: number;
    y: number;
    done: boolean;
  }[] = [];
  private nextSeamSample = 0;
  private seamDirty = false;
  private lastSeamCommit = 0;
  constructor(
    data: CampusData,
    terrain: Terrain,
    physics: RAPIER.World,
    renderer: THREE.WebGLRenderer,
    landscape = false,
    localOnly = true,
  ) {
    const firstSpeedway = data.paths.find((p) => p.id === 126307538);
    if (!firstSpeedway)
      throw Error('The mapped Speedway pilot path is missing.');
    this.sourceWayIds = landscape
      ? [
          126307538, 581040963, 581040954, 127009032, 31954550, 31960732,
          127824678, 28928126, 570134436,
        ]
      : [126307538];
    const sources = this.sourceWayIds.map((id) => {
      const path = data.paths.find((p) => p.id === id);
      if (!path) throw Error('A mapped Speedway route section is missing.');
      return path;
    });
    const points = [
      ...new Map(
        sources.flatMap((path) =>
          path.points.map((p) => [p.join(','), p] as const),
        ),
      ).values(),
    ].sort((a, b) => b[1] - a[1]);
    const edgeKey = (a: number[], b: number[]) =>
      [a.join(','), b.join(',')].sort().join('|');
    const sourceEdges = new Set(
      sources.flatMap((path) =>
        path.points.slice(1).map((p, i) => edgeKey(path.points[i], p)),
      ),
    );
    for (let i = 1; i < points.length; i++)
      if (!sourceEdges.has(edgeKey(points[i - 1], points[i])))
        throw Error('The mapped Speedway sections are disconnected.');
    const speedway = { ...firstSpeedway, points };
    const paths = [speedway];
    if (landscape) {
      const approach = data.paths.find((p) => p.id === 15381080)!;
      paths.push({
        ...approach,
        // Continue west through the Hackerman/Welch junction. Stopping exactly
        // at Speedway left the scanned canopy hanging over the new forecourt.
        // The endpoint is interpolated on OSM's existing 24th Street segment.
        points: [...approach.points.filter((p) => p[0] >= 12), [-70, -142.867]],
      });
      const road = data.paths.find((p) => p.id === 571500825)!;
      paths.push({
        ...road,
        points: [...road.points.slice(0, 3), [120, -127.17]],
      });
    }
    this.group.name = 'Speedway mapped walkway repair';
    this.surfaces.name = 'Authored pedestrian surfaces';
    this.group.add(this.surfaces);
    const texture = (file: string, srgb = false) => {
      const t = new THREE.TextureLoader().load(`/assets/${file}.jpg`);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      this.textures.push(t);
      return t;
    };
    // NHB and Main east borrow one image; its lifetime belongs to this walkway.
    let sharedLimestoneTexture: THREE.Texture | undefined;
    const limestoneTexture = () => sharedLimestoneTexture ??= texture('main-east-limestone-color', true);
    // GDC and historic masonry borrow the same texture objects and disposal owner.
    let sharedBrickColor: THREE.Texture | undefined, sharedBrickNormal: THREE.Texture | undefined;
    const brickColor = () => sharedBrickColor ??= texture('brick-diff', true);
    const brickNormal = () => sharedBrickNormal ??= texture('brick-normal');
    const material = new THREE.MeshStandardMaterial({
      map: texture('speedway-diff', true),
      normalMap: texture('speedway-normal'),
      roughnessMap: texture('speedway-rough'),
      roughness: 1,
      normalScale: new THREE.Vector2(0.4, 0.4),
      color: 0xffffff,
    });
    material.name = 'Speedway golden brick paving';
    // Retain the independently sourced brick relief, but match Speedway's pale
    // golden sand-moulded brick rather than the source's dark grey-brown finish.
    material.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #include <map_fragment>
        float brickLuminance = dot(diffuseColor.rgb, vec3(.2126,.7152,.0722));
        float brickTone = smoothstep(.008,.26,brickLuminance);
        diffuseColor.rgb = mix(vec3(.18,.10,.025),vec3(.72,.43,.13),brickTone);
      `);
    };
    material.customProgramCacheKey = () => 'speedway-golden-brick-v2';
    this.materials.push(material);
    const drain = new THREE.MeshStandardMaterial({color:0x414342,roughness:.76,metalness:.25,
      polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
    drain.onBeforeCompile = shader => {
      shader.vertexShader='varying vec2 drainMetres;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\ndrainMetres=uv*2.0;');
      shader.fragmentShader='varying vec2 drainMetres;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
        float spacing=drainMetres.y/.045;
        float aa=max(fwidth(spacing),.015);
        float slot=1.0-smoothstep(.12,.12+aa,abs(fract(spacing)-.5));
        diffuseColor.rgb*=1.0-slot*.45;`);
    };
    drain.customProgramCacheKey=()=> 'speedway-central-drain-v1';
    const grass = new THREE.MeshStandardMaterial({
      map: texture('grass-diff', true),
      color: 0x7b815d,
      roughness: 1,
      side: THREE.DoubleSide,
    });
    // Campus lawn finish target (vegetation/lawn.ts); clones inherit userData.
    grass.userData.lawn = true;
    const concrete = new THREE.MeshStandardMaterial({
      map: texture('concrete-diff', true),
      roughness: 0.96,
      color: 0xc9c3ae,
    });
    const asphalt = new THREE.MeshStandardMaterial({
      map: texture('concrete-diff', true),
      roughness: 0.98,
      color: 0x3e4245,
    });
    this.materials.push(grass, concrete, asphalt, drain);
    const pcl=landscape?pclMaterials():null;
    const plaza=pcl?buildPclPlaza(data,(x,z)=>terrain.height(x,z),concrete,pcl.brick):null;
    if(pcl)this.materials.push(...Object.values(pcl));
    if(plaza){this.materials.push(...plaza.materials);this.textures.push(...plaza.textures);}
    // Reproduce Speedway's four-metre sampling and linear segment elevations.
    // The mall entry lies just below the retained brick paving at the junction.
    const routeSamplers=new Map<number[][],ReturnType<typeof createRouteHeightSampler>>();
    const sampleRouteHeight=(routePoints:number[][],x:number,z:number)=>{
      let sampler=routeSamplers.get(routePoints);
      if(!sampler){sampler=createRouteHeightSampler(routePoints,(px,pz)=>terrain.height(px,pz));routeSamplers.set(routePoints,sampler);}
      return sampler(x,z);
    };
    const speedwayHeight=(x:number,z:number)=>sampleRouteHeight(points,x,z);
    const malls=landscape?buildCentralMalls(speedwayHeight,(x,z)=>terrain.height(x,z),concrete,grass):null;
    const mainEastApron=malls?buildMainEastApron({material:malls.groundMaterial}):null;
    if(malls&&mainEastApron){
      // The original soil boundary crosses this newly supported entrance about
      // 6 cm above its floor. Trim only that grass batch inside the apron mask,
      // before both display and collider registration, retaining the paving.
      for(const mesh of malls.meshes)if(mesh.material===grass){
        const clipped=subtractVolumes(mesh.geometry,new THREE.Matrix4(),mainEastApron.volumes);
        if(clipped){mesh.geometry.dispose();mesh.geometry=clipped;}
      }
      malls.stats.triangles=malls.meshes.reduce((sum,mesh)=>sum+(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3,0);
    }
    if(malls)this.materials.push(...malls.materials);
    const mlk=landscape?buildMlkMall(speedwayHeight,(x,z)=>terrain.height(x,z),concrete,grass):null;
    if(mlk){
      // Walkway owns these four local images; the helpers borrow their maps.
      applyMlkSurfaces(mlk.meshes, {
        gravelColor: texture('mlk-gravel-color-65', true),
        gravelNormal: texture('mlk-gravel-normal-65'),
        aggregateColor: texture('mlk-aggregate-color-65', true),
        aggregateNormal: texture('mlk-aggregate-normal-65'),
      });
      applyMallYardSurfaces(mlk.meshes, grass, {target:'mlk'});
      this.materials.push(...mlk.materials);
    }
    const hackermanCourt=landscape?buildHackermanForecourt(speedwayHeight,concrete,
      (x,z)=>sampleRouteHeight(paths[1].points,x,z)):null;
    if(hackermanCourt)this.materials.push(...hackermanCourt.materials);
    const mbb=hackermanCourt?buildMbbFrontage(speedwayHeight,(x,z)=>terrain.height(x,z),hackermanCourt.height,concrete,grass):null;
    if(mbb)this.materials.push(...mbb.materials);
    const gdcFrontage=landscape?buildGdcFrontage(data,speedwayHeight,grass,concrete):null;
    if(gdcFrontage)this.materials.push(gdcFrontage.material);
    const engineering=landscape?buildEngineeringPaths(speedwayHeight,concrete):null;
    if(engineering)this.materials.push(...engineering.materials);
    const engineeringCourt=engineering?buildEngineeringCourtyard(engineering.routes[0].height,engineering.materials[0],grass,{photoFacades:true,localPodium:localOnly}):null;
    if(engineeringCourt)this.materials.push(...engineeringCourt.materials);
    const dkr=landscape?buildDkrCorridor(concrete,(x,z)=>sampleRouteHeight(paths[2].points,x,z)):null;
    if(dkr){
      this.materials.push(...dkr.materials);
      // Both authored pieces of 24th use the same asphalt response at their join.
      asphalt.color.set(0xffffff);
      asphalt.onBeforeCompile=(shader,renderer)=>dkr.materials[1].onBeforeCompile(shader,renderer);
      asphalt.customProgramCacheKey=()=>dkr.materials[1].customProgramCacheKey();
    }
    const west24=landscape?buildWest24((x,z)=>sampleRouteHeight(paths[1].points,x,z),
      asphalt,dkr?.materials[0]??concrete,grass):null;
    if(west24)this.materials.push(...west24.materials);
    const innerCampus=landscape?buildInnerCampus(asphalt,dkr?.materials[0]??concrete,grass):null;
    if(innerCampus)this.materials.push(...innerCampus.materials);
    const strips: {
      positions: number[];
      uv: number[];
      indices: number[];
      material: THREE.Material;
    }[] = [];
    const seamPositions: number[] = [],
      seamUv: number[] = [],
      seamIndices: number[] = [];
    const grassMeshes: THREE.Mesh[] = [];
    const colliderByGeometry=new Map<THREE.BufferGeometry,RAPIER.Collider>();
    const addCollider = (geometry: THREE.BufferGeometry) => {
      const position = geometry.attributes.position;
      if (!position.count) return;
      const collider=physics.createCollider(RAPIER.ColliderDesc.trimesh(
        position.array as Float32Array,
        geometry.index ? new Uint32Array(geometry.index.array) : Uint32Array.from({ length: position.count }, (_v, i) => i),
        RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES,
      ).setFriction(0.8));
      this.colliders.push(collider);
      colliderByGeometry.set(geometry,collider);
    };
    for (const path of paths) {
      const fullHalfWidth = landscape
        ? path === speedway
          ? 16
          : path.kind === 'unclassified'
            ? 9
            : 11
        : path.width / 2;
      const activeMaterial = path.kind === 'unclassified' || path.id === 15381080 ? asphalt : material;
      const junctionHeight=(x:number,z:number,y:number)=>path.id===15381080
        ? THREE.MathUtils.lerp(y,speedwayHeight(x,z),1-THREE.MathUtils.smoothstep(distanceToPath(x,z,speedway),4.2,11))
        : y;
      const joinNormal = (index: number) => {
        const p = new THREE.Vector2(...path.points[index]);
        const before = new THREE.Vector2(
          ...path.points[Math.max(0, index - 1)],
        );
        const after = new THREE.Vector2(
          ...path.points[Math.min(path.points.length - 1, index + 1)],
        );
        const a = p.clone().sub(before).normalize(),
          b = after.clone().sub(p).normalize();
        if (!a.lengthSq()) a.copy(b);
        if (!b.lengthSq()) b.copy(a);
        const normal = new THREE.Vector2(-a.y - b.y, a.x + b.x).normalize();
        return normal.multiplyScalar(
          1 / Math.max(0.5, normal.dot(new THREE.Vector2(-b.y, b.x))),
        );
      };
      const surfaceStrip = (
        a: THREE.Vector3,
        b: THREE.Vector3,
        startNormal: THREE.Vector2,
        endNormal: THREE.Vector2,
        left: number,
        right: number,
        mat: THREE.Material,
        raise = 0,
      ) => {
        const positions: number[] = [],
          uv: number[] = [],
          indices = [0, 1, 2, 1, 3, 2];
        for (const [center, normal] of [
          [a, startNormal],
          [b, endNormal],
        ] as const)
          for (const offset of [left, right]) {
            positions.push(
              center.x + normal.x * offset,
              junctionHeight(center.x+normal.x*offset,center.z+normal.y*offset,center.y) + raise,
              center.z + normal.y * offset,
            );
            uv.push(offset / 2, center.z / 2 + center.x / 2);
          }
        strips.push({ positions, uv, indices, material: mat });
      };
      const positions: number[] = [],
        uv: number[] = [],
        indices: number[] = [];
      let distance = 0;
      for (let i = 0; i < path.points.length - 1; i++) {
        const [ax, az] = path.points[i],
          [bx, bz] = path.points[i + 1];
        const length = Math.hypot(bx - ax, bz - az);
        const n = Math.ceil(length / (path.id===15381080?1:4)),
          dx = (bx - ax) / length,
          dz = (bz - az) / length;
        const halfWidth = fullHalfWidth;
        for (let j = 0; j < n; j++) {
          const l = length / n,
            x = ax + dx * l * j,
            z = az + dz * l * j;
          const x2 = x + dx * l,
            z2 = z + dz * l;
          const y = terrain.height(x, z) + 0.04,
            y2 = terrain.height(x2, z2) + 0.04;
          const slope = (y2 - y) / l;
          const ns = j === 0 ? joinNormal(i) : new THREE.Vector2(-dz, dx);
          const ne =
            j === n - 1 ? joinNormal(i + 1) : new THREE.Vector2(-dz, dx);
          const corners = [
            new THREE.Vector3(x + ns.x * halfWidth, y, z + ns.y * halfWidth),
            new THREE.Vector3(x - ns.x * halfWidth, y, z - ns.y * halfWidth),
            new THREE.Vector3(x2 + ne.x * halfWidth, y2, z2 + ne.y * halfWidth),
            new THREE.Vector3(x2 - ne.x * halfWidth, y2, z2 - ne.y * halfWidth),
          ];
          for(const corner of corners)corner.y=junctionHeight(corner.x,corner.z,corner.y);
          const base = positions.length / 3;
          for (const p of corners) positions.push(p.x, p.y, p.z);
          uv.push(
            0,
            distance / 2,
            path.width / 2,
            distance / 2,
            0,
            (distance + l) / 2,
            path.width / 2,
            (distance + l) / 2,
          );
          indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
          if (landscape) {
            // The source terrain and contour terrain have different heights.
            // Close the underside at their boundary instead of leaving a view
            // through the world. These skirts share the visible ground collider.
            // They are a temporary seam treatment, not surveyed retaining walls.
            for (const side of [0, 1]) {
              const a = corners[side],
                b = corners[side + 2];
              const edgeBase = positions.length / 3;
              positions.push(
                a.x,
                a.y,
                a.z,
                b.x,
                b.y,
                b.z,
                a.x,
                a.y - 4.05,
                a.z,
                b.x,
                b.y - 4.05,
                b.z,
              );
              uv.push(
                0,
                distance / 2,
                0,
                (distance + l) / 2,
                2,
                distance / 2,
                2,
                (distance + l) / 2,
              );
              const order =
                side === 0 ? [0, 2, 1, 1, 2, 3] : [0, 1, 2, 1, 3, 2];
              indices.push(...order.map((index) => edgeBase + index));
              const sign = side === 0 ? 1 : -1;
              const inner = [
                new THREE.Vector3(
                  x + ns.x * (halfWidth - 5) * sign,
                  y,
                  z + ns.y * (halfWidth - 5) * sign,
                ),
                new THREE.Vector3(
                  x2 + ne.x * (halfWidth - 5) * sign,
                  y2,
                  z2 + ne.y * (halfWidth - 5) * sign,
                ),
              ];
              const outer = [
                new THREE.Vector3(
                  x + ns.x * (halfWidth + 0.35) * sign,
                  y,
                  z + ns.y * (halfWidth + 0.35) * sign,
                ),
                new THREE.Vector3(
                  x2 + ne.x * (halfWidth + 0.35) * sign,
                  y2,
                  z2 + ne.y * (halfWidth + 0.35) * sign,
                ),
              ];
              const probes = [
                ...inner,
                ...outer,
                inner[0].clone().lerp(outer[1], 0.5),
                inner[1].clone().lerp(outer[0], 0.5),
              ];
              // At a junction another path supplies the surface. Do not raise a
              // grass ramp through its paving or create an invisible obstacle.
              if (
                (plaza && probes.some(p=>inPclPlaza(p.x,p.z))) ||
                (hackermanCourt && probes.some(p=>inHackermanForecourt(p.x,p.z))) ||
                (mbb && probes.some(p=>inMbbFrontage(p.x,p.z))) ||
                (gdcFrontage && probes.some(p=>inGdcFrontage(p.x,p.z))) ||
                (engineering && probes.some(p=>engineering.contains(p.x,p.z))) ||
                (dkr && probes.some(p=>dkr.contains(p.x,p.z))) ||
                (west24 && probes.some(p=>west24.contains(p.x,p.z))) ||
                (malls && probes.some(p=>inCentralMall(p.x,p.z))) ||
                (mlk && probes.some(p=>inMlkMall(p.x,p.z))) || paths.some(
                  (other) =>
                    other !== path &&
                    probes.some(
                      (p) =>
                        distanceToPath(p.x, p.z, other) < other.width / 2 + 0.6,
                    ),
                )
              )
                continue;
              // Reach source height before the capsule touches the cut edge.
              // The short landing also avoids requiring an automatic step from
              // a sloping transition onto a rough, triangulated source surface.
              const landing = [
                new THREE.Vector3(
                  x + ns.x * (halfWidth - 0.6) * sign,
                  y,
                  z + ns.y * (halfWidth - 0.6) * sign,
                ),
                new THREE.Vector3(
                  x2 + ne.x * (halfWidth - 0.6) * sign,
                  y2,
                  z2 + ne.y * (halfWidth - 0.6) * sign,
                ),
              ];
              const seamBase = seamPositions.length / 3;
              for (const [index, p] of [
                ...inner,
                ...landing,
                ...outer,
              ].entries()) {
                seamPositions.push(p.x, p.y - 0.015, p.z);
                seamUv.push(p.x / 2, p.z / 2);
                if (index >= 4)
                  this.seamSamples.push({
                    index: seamBase + index,
                    linkedIndex: seamBase + index - 2,
                    x: p.x,
                    z: p.z,
                    y: p.y,
                    done: false,
                  });
              }
              const seamOrder =
                side === 0 ? [0, 2, 1, 1, 2, 3] : [0, 1, 2, 1, 3, 2];
              seamIndices.push(...seamOrder.map((index) => seamBase + index));
              seamIndices.push(
                ...seamOrder.map((index) => seamBase + 2 + index),
              );
            }
          }
          const plane = (
            nx: number,
            ny: number,
            nz: number,
            px: number,
            py: number,
            pz: number,
          ) =>
            new THREE.Plane().setFromNormalAndCoplanarPoint(
              new THREE.Vector3(nx, ny, nz).normalize(),
              new THREE.Vector3(px, py, pz),
            );
          const bounds = new THREE.Box3().setFromPoints(corners);
          const startPad = i === 0 && j === 0 ? 0 : 0.75;
          const endPad = i === path.points.length - 2 && j === n - 1 ? 0 : 0.75;
          bounds.expandByVector(
            new THREE.Vector3(Math.abs(dx) * 0.75, 0, Math.abs(dz) * 0.75),
          );
          bounds.min.y -= landscape ? 4 : 1.2;
          bounds.max.y += landscape ? 22 : 6;
          this.volumes.push({
            bounds,
            planes: [
              plane(-dx, 0, -dz, x - dx * startPad, y, z - dz * startPad),
              plane(dx, 0, dz, x2 + dx * endPad, y2, z2 + dz * endPad),
              plane(-dz, 0, dx, corners[0].x, y, corners[0].z),
              plane(dz, 0, -dx, corners[1].x, y, corners[1].z),
              plane(
                slope * dx,
                -1,
                slope * dz,
                x,
                y - (landscape ? 4 : 1.2),
                z,
              ),
              plane(
                -slope * dx,
                1,
                -slope * dz,
                x,
                y + (landscape ? 22 : 6),
                z,
              ),
            ],
          });
          if (landscape) {
            const a = new THREE.Vector3(x, y, z),
              b = new THREE.Vector3(x2, y2, z2);
            surfaceStrip(
              a,
              b,
              ns,
              ne,
              -path.width / 2,
              path.width / 2,
              activeMaterial,
              0.02,
            );
            if(path===speedway)surfaceStrip(a,b,ns,ne,-.19,.19,drain,.02);
            for (const side of [-1, 1]) {
              const offsets = [
                (side * path.width) / 2,
                side * (path.width / 2 + 0.45),
              ].sort((a, b) => a - b);
              surfaceStrip(
                a,
                b,
                ns,
                ne,
                offsets[0],
                offsets[1],
                concrete,
                0.025,
              );
            }
          }
          distance += l;
        }
      }
      this.length += distance;
      const g = new THREE.BufferGeometry();
      g.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(positions, 3),
      );
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(indices);
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, landscape ? grass : material);
      mesh.receiveShadow = true;
      this.surfaces.add(mesh);
      if (landscape) grassMeshes.push(mesh);
      else addCollider(g);
      if (landscape) {
        // Planting positions are authored from the reference's arrangement, not
        // an inventory of individual surveyed campus trees.
        let chainage = 0,
          nextTree = path === speedway ? 14 : 13;
        for (let i = 0; i < path.points.length - 1; i++) {
          const [ax, az] = path.points[i],
            [bx, bz] = path.points[i + 1];
          const len = Math.hypot(bx - ax, bz - az),
            dx = (bx - ax) / len,
            dz = (bz - az) / len;
          while (nextTree < chainage + len) {
            const f = (nextTree - chainage) / len,
              x = ax + (bx - ax) * f,
              z = az + (bz - az) * f;
            if (path.kind !== 'unclassified')
              for (const side of [-1, 1]) {
                const offset = path === speedway ? 11.5 : 7.8;
                const tx = x - dz * offset * side,
                  tz = z + dx * offset * side;
                if (
                  (hackermanCourt && inHackermanForecourt(tx,tz)) ||
                  (mbb && inMbbFrontage(tx,tz)) ||
                  (plaza && inPclPlaza(tx,tz)) || (malls && inCentralMall(tx,tz)) || data.paths.some(
                    (route) =>
                      distanceToPath(tx, tz, route) < route.width / 2 + 3,
                  )
                ) {
                  this.excludedTrees++;
                  continue;
                }
                this.treePlacements.push({
                  x: tx,
                  y: terrain.height(x, z) + 0.015,
                  z: tz,
                  rotation: nextTree * 0.61 + side,
                  scale: 0.85 + 0.18 * Math.sin(nextTree) ** 2,
                });
              }
            nextTree += path === speedway ? 23 : 24;
          }
          chainage += len;
        }
      }
    }
    // Cut grass and its collider out of the complete paving network. Independent
    // contour strips can otherwise put one route's grass above another's paving.
    const pavedVolumes: CutVolume[] = strips
      .filter((strip) => strip.material !== concrete && strip.material !== drain)
      .map((strip) => {
        const points = [0, 1, 3, 2].map((index) =>
          new THREE.Vector3().fromArray(strip.positions, index * 3),
        );
        const lateral = points[1]
          .clone()
          .sub(points[0])
          .setY(0)
          .normalize()
          .multiplyScalar(0.45);
        points[0].sub(lateral);
        points[3].sub(lateral);
        points[1].add(lateral);
        points[2].add(lateral);
        const center = points
          .reduce((sum, p) => sum.add(p), new THREE.Vector3())
          .multiplyScalar(0.25);
        const planes = points.map((p, i) => {
          const next = points[(i + 1) % 4],
            dx = next.x - p.x,
            dz = next.z - p.z;
          const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
            new THREE.Vector3(dz, 0, -dx).normalize(),
            p,
          );
          if (plane.distanceToPoint(center) > 0) plane.negate();
          return plane;
        });
        const bounds = new THREE.Box3().setFromPoints(points);
        bounds.min.y = -1000;
        bounds.max.y = 1000;
        return { planes, bounds };
      });
    if(malls){
      const crossingTrim=speedwayCrossingSoilTrim(strips.filter(strip=>strip.material===material));
      for(const mesh of malls.meshes)if(mesh.material===grass){
        const trimmed=subtractVolumes(mesh.geometry,new THREE.Matrix4(),crossingTrim);
        if(trimmed){mesh.geometry.dispose();mesh.geometry=trimmed;}
      }
      malls.stats.triangles=malls.meshes.reduce((sum,mesh)=>sum+(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3,0);
    }
    for (const mesh of grassMeshes) {
      const trimmed = subtractVolumes(
        mesh.geometry,
        new THREE.Matrix4(),
        [...pavedVolumes,...(plaza?.volumes??[]),...(malls?.volumes??[]),...(mlk?.volumes??[]),...(hackermanCourt?.volumes??[]),...(mbb?.volumes??[]),...(gdcFrontage?.volumes??[]),...(engineering?.volumes??[]),...(engineeringCourt?.volumes??[]),...(dkr?.volumes??[]),...(west24?.volumes??[])],
      );
      if (trimmed) {
        mesh.geometry.dispose();
        mesh.geometry = trimmed;
      }
      addCollider(mesh.geometry);
    }
    const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
    for (const strip of strips) {
      const g = new THREE.BufferGeometry();
      g.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(strip.positions, 3),
      );
      g.setAttribute('uv', new THREE.Float32BufferAttribute(strip.uv, 2));
      g.setIndex(strip.indices);
      g.computeVertexNormals();
      if (!batches.has(strip.material)) batches.set(strip.material, []);
      batches.get(strip.material)!.push(g);
    }
    for (const [material, geometries] of batches) {
      let geometry=mergeGeometries(geometries)!;
      if(west24&&(material===asphalt||material===concrete)){
        const trimmed=subtractVolumes(geometry,new THREE.Matrix4(),
          [...west24.volumes,...(material===asphalt?west24.crossingVolumes:[])]);
        if(trimmed){geometry.dispose();geometry=trimmed;}
      }
      const mesh = new THREE.Mesh(geometry, material);
      mesh.receiveShadow = true;
      this.surfaces.add(mesh);
      // The narrow metal grate sits flush over the already solid brick mesh.
      if(material!==drain)addCollider(mesh.geometry);
      for (const geometry of geometries) geometry.dispose();
    }
    if (landscape) {
      this.seamGeometry = new THREE.BufferGeometry();
      this.seamGeometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(seamPositions, 3),
      );
      this.seamGeometry.setAttribute(
        'uv',
        new THREE.Float32BufferAttribute(seamUv, 2),
      );
      this.seamGeometry.setIndex(seamIndices);
      this.seamGeometry.computeVertexNormals();
      const seams = new THREE.Mesh(this.seamGeometry, grass);
      this.seamMesh=seams;
      seams.name = 'Ground registration transitions';
      seams.receiveShadow = true;
      this.surfaces.add(seams);
      this.commitSeams(physics);
      this.trees = new ForegroundTrees(physics);
      this.group.add(this.trees.group);
      const parapet = buildPclParapet();
      const brick = pcl!.brick;
      for (const [geometries, material, name] of [
        [parapet.walls, brick, 'PCL brick lightwell parapet'],
        [parapet.coping, brick, 'PCL parapet coping'],
        [parapet.paving, concrete, 'PCL parapet paved edge'],
      ] as const) {
        const geometry = mergeGeometries(geometries)!;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = name;
        mesh.castShadow = mesh.receiveShadow = true;
        this.surfaces.add(mesh);
        addCollider(geometry);
        for (const part of geometries) part.dispose();
      }
      this.volumes.push(...parapet.volumes);
      this.pclParapetMeters = parapet.length;
      const facades = buildPclFacades(pcl!, grass, {flutedRelief:true,recessedEntry:true});
      for (const mesh of facades.meshes) {
        this.surfaces.add(mesh);
        addCollider(mesh.geometry);
        this.pclArchitecture.triangles += mesh.geometry.attributes.position.count / 3;
      }
      this.volumes.push(...facades.volumes);
      this.pclArchitecture.faces = facades.faces;
      this.pclArchitecture.bays = facades.bayCount;
      if(plaza){
        for(const mesh of plaza.meshes){this.surfaces.add(mesh);addCollider(mesh.geometry);}
        this.volumes.push(...plaza.volumes);
        this.treePlacements.push(...plaza.trees);
        this.hedgePlacements.push(...plaza.hedges);
        this.pclPlaza={tables:plaza.tables.length,lamps:plaza.lamps.length,trees:plaza.trees.length,
          hedges:plaza.hedges.length,stairFlights:plaza.stairRecords.length};
      }
      if(malls){
        for(const mesh of malls.meshes){this.surfaces.add(mesh);addCollider(mesh.geometry);}
        this.volumes.push(...malls.volumes);
        this.treePlacements.push(...malls.trees);
        this.hedgePlacements.push(...malls.hedges);
        this.centralMalls=malls.stats;
      }
      if(hackermanCourt){
        for(const mesh of hackermanCourt.meshes)this.surfaces.add(mesh);
        for(const geometry of hackermanCourt.colliderGeometries)addCollider(geometry);
        const renderedCourtGeometry=new Set(hackermanCourt.meshes.map(mesh=>mesh.geometry));
        this.auxiliaryGeometries.push(...hackermanCourt.colliderGeometries.filter(g=>!renderedCourtGeometry.has(g)));
        this.volumes.push(...hackermanCourt.volumes);
        this.treePlacements.push(...hackermanCourt.trees);
        this.hedgePlacements.push(...hackermanCourt.hedges);
        const nhb=buildHackermanBuilding({baseElevation:4.74,canopyHeight:31.36,penthouseHeight:37.46,stoneTexture:limestoneTexture()});
        for(const mesh of nhb.meshes)this.surfaces.add(mesh);
        for(const geometry of nhb.colliderGeometries)addCollider(geometry);
        this.materials.push(...Object.values(nhb.materials));
        this.volumes.push(...nhb.candidateClearanceVolumes,...nhb.canopyClearanceVolumes);
        const artwork=buildMonochromeSculpture();
        // Published pedestal GPS, projected into the same metre frame as UT's
        // building data. Its height joins the authored pedestrian forecourt.
        const x=2.6915,z=-150.97906,y=hackermanCourt.height(x,z);
        for(const geometry of artwork.geometries)geometry.translate(x,y,z);
        this.group.add(artwork.group);
        addCollider(artwork.supportCollisionGeometry);
        this.materials.push(...artwork.materials);
        this.hackerman={windows:nhb.stats.windows,roofBlades:nhb.stats.roofBlades,
          boats:artwork.stats.boats,triangles:nhb.stats.triangles+artwork.stats.triangles,benches:hackermanCourt.benches};
      }
      if(gdcFrontage){
        // The lower clearance follows measured south grade: 2.60 m at the
        // western join to 2.02 m east, above the retained 2.30..1.85 m ground.
        const facades=buildGdcFacades({baseElevation:2.45,floors:6,floorHeight:4.45,returnDepth:12,courtyardDepth:34,screenReturns:true,southExteriorDepth:59.6033935149,southExteriorCutMinY:2.60,southExteriorCutEndY:2.02,northExteriorDepth:90.435411,northExteriorCutMinY:6.5,completeEnvelope:true,
          masonryTextures:{brickColor:brickColor(),brickNormal:brickNormal(),stoneColor:limestoneTexture()}});
        const southFace=facades.records.find(f=>f.name==='south wing south return')!;
        const southAlong=new THREE.Vector3(southFace.b[0]-southFace.a[0],0,southFace.b[1]-southFace.a[1]).normalize();
        const southOut=new THREE.Vector3(...southFace.outward as [number,number,number]);
        for(let floor=0;floor<6;floor++)for(let bay=0;bay<15;bay++){
          const origin=new THREE.Vector3(southFace.a[0],2.45+floor*4.45+1.8,southFace.a[1])
            .addScaledVector(southAlong,.12+southFace.bayPitch*(bay+.35)).addScaledVector(southOut,2.2);
          this.facadeSamples.push({name:`GDC south floor ${floor+1} bay ${bay+1}`,origin:origin.toArray(),direction:southOut.clone().negate().toArray(),minimum:2.35});
        }
        const courtyard=buildGdcCourtyard(gdcFrontage.height);
        const atrium=buildGdcAtrium({clearancePadding:1.05,eastVolume:true});
        const eastCourt=buildGdcEastCourt({height:(x,z)=>terrain.height(x,z),pavingMap:concrete.map});
        this.surfaces.add(gdcFrontage.mesh,...facades.meshes,...courtyard.meshes,...atrium.meshes,...eastCourt.meshes);
        addCollider(gdcFrontage.mesh.geometry);
        for(const asset of [facades,courtyard,atrium,eastCourt]){
          for(const geometry of asset.colliderGeometries)addCollider(geometry);
          // Separate simplified sculpture colliders are not traversed with the
          // rendered scene, so retain their ownership for teardown explicitly.
          const rendered=new Set(asset.meshes.map(mesh=>mesh.geometry));
          this.auxiliaryGeometries.push(...asset.colliderGeometries.filter(g=>!rendered.has(g)));
        }
        this.materials.push(...Object.values(facades.materials),...courtyard.materials,...Object.values(atrium.materials),...eastCourt.materials);
        this.volumes.push(...gdcFrontage.volumes,...facades.volumes,...courtyard.volumes,...atrium.volumes);
        this.hedgePlacements.push(...gdcFrontage.hedges,...courtyard.hedges);
        this.gdc={faces:facades.stats.faces,floors:facades.stats.floors,windows:facades.stats.windows,
          triangles:facades.stats.triangles+courtyard.stats.triangles+atrium.stats.triangles+eastCourt.stats.triangles,
          hedges:gdcFrontage.hedges.length+courtyard.hedges.length,towers:courtyard.stats.towers,atriumBands:atrium.stats.bands};
      }
      if(engineering){
        this.surfaces.add(...engineering.meshes);
        for(const geometry of engineering.colliderGeometries)addCollider(geometry);
        this.volumes.push(...engineering.volumes);
        this.engineering=engineering.stats;
      }
      if(dkr){
        this.surfaces.add(...dkr.meshes);
        for(const geometry of dkr.colliderGeometries)addCollider(geometry);
        this.volumes.push(...dkr.volumes);
        this.dkr=dkr.stats;
        const frontage=buildDkrFrontage({includePortal:true,groundY:-8.56});
        this.surfaces.add(...frontage.meshes);
        for(const geometry of frontage.colliderGeometries)addCollider(geometry);
        this.auxiliaryGeometries.push(...frontage.colliderGeometries);
        this.materials.push(...Object.values(frontage.materials));
        this.volumes.push(...frontage.candidateClearanceVolumes);
        this.dkrFrontage=frontage.stats;
        const forecourt=buildDkrForecourt(concrete.map);
        this.surfaces.add(...forecourt.meshes);
        for(const geometry of forecourt.colliderGeometries)addCollider(geometry);
        this.materials.push(...forecourt.materials);
        this.volumes.push(...forecourt.volumes);
        this.volumes.push(...buildDkrPortalApproachClearance());
        this.treePlacements.push(...forecourt.trees);
        this.dkrForecourt=forecourt.stats;
        const westConnection=buildDkrWestConnection(forecourt.materials[0]);
        this.surfaces.add(...westConnection.meshes);
        for(const geometry of westConnection.colliderGeometries)addCollider(geometry);
        this.volumes.push(...westConnection.volumes,...buildDkrEntranceFragmentClearance());
        this.dkrWestConnection=westConnection.stats;
        const entranceFinish=buildDkrEntranceFinish(frontage.materials.concrete);
        this.surfaces.add(...entranceFinish.meshes);
        for(const geometry of entranceFinish.colliderGeometries)addCollider(geometry);
        this.volumes.push(...entranceFinish.volumes);
        this.dkrEntranceFinish=entranceFinish.stats;
      }
      if(west24){
        const architecture=buildWest24Buildings((x,z)=>west24.height(x,z,'soil'),grass);
        this.surfaces.add(...architecture.meshes);
        for(const mesh of architecture.meshes)addCollider(mesh.geometry);
        this.materials.push(...architecture.materials);
        this.volumes.push(...architecture.volumes);
        this.west24Buildings=architecture.stats;
        this.surfaces.add(...west24.meshes);
        for(const geometry of west24.colliderGeometries)addCollider(geometry);
        this.volumes.push(...west24.volumes);
        this.west24=west24.stats;
        this.length+=west24.stats.routeMeters;
      }
      if(innerCampus){
        this.surfaces.add(...innerCampus.meshes);
        for(const geometry of innerCampus.colliderGeometries)addCollider(geometry);
        this.volumes.push(...innerCampus.volumes);
        this.innerCampus=innerCampus.stats;
        this.length+=innerCampus.stats.routeMeters;
        const flawnGround=buildGradedGround(flawnGroundPlan,asphalt,concrete,grass,'Flawn approach');
        this.surfaces.add(...flawnGround.meshes);
        for(const geometry of flawnGround.colliderGeometries)addCollider(geometry);
        this.materials.push(...flawnGround.materials);
        this.volumes.push(...flawnGround.volumes);
        const groundRay=new THREE.Raycaster();
        const groundMeshes=[...innerCampus.meshes,...flawnGround.meshes];
        groundMeshes.forEach(mesh=>mesh.updateMatrixWorld(true));
        const groundHeight=(x:number,z:number)=>{
          groundRay.set(new THREE.Vector3(x,24,z),new THREE.Vector3(0,-1,0));
          return groundRay.intersectObjects(groundMeshes,false)[0]?.point.y??terrain.height(x,z);
        };
        const flawn=buildFlawnBuilding({groundHeight});
        const hogg=buildHoggBuilding({baseHeight:17.67,groundHeight,includeRegistrationFringe:false});
        // Resolve the apron against already-built grounds, before registering
        // the Union walls, so a ground ray cannot mistake a window sill for a path.
        this.surfaces.updateWorldMatrix(true,true);
        const existingGround=[...this.surfaces.children];
        const unionGround=(x:number,z:number)=>{
          groundRay.set(new THREE.Vector3(x,15,z),new THREE.Vector3(0,-1,0));
          return groundRay.intersectObjects(existingGround,true).find(h=>h.face&&h.face.normal.clone().transformDirection(h.object.matrixWorld).y>.6)?.point.y??terrain.height(x,z);
        };
        const apron=buildUnionApproach(unionGround,dkr?.materials[0]??concrete);
        this.surfaces.add(...apron.meshes);
        for(const mesh of apron.meshes)addCollider(mesh.geometry);
        this.materials.push(...apron.materials);
        this.volumes.push(...apron.volumes);
        const union=buildUnionBuilding({southBaseElevation:14.25,serviceBaseElevation:16.9,groundHeight});
        for(const building of [flawn,hogg,union]){
          this.surfaces.add(...building.meshes);
          for(const mesh of building.meshes)addCollider(mesh.geometry);
          this.materials.push(...building.materials);
          this.volumes.push(...building.volumes);
        }
        this.flawn=flawn.stats;
        this.hogg=hogg.stats;
        this.union=union.stats;
      }
      // Replace our invented regular tree rows along GDC with public UT tree
      // locations. Species-specific scanned crowns are still an asset gap.
      this.treePlacements = this.treePlacements.filter(p =>
        p.z < -125 || p.z > 60 || distanceToPath(p.x,p.z,speedway) > 16);
      for (const tree of speedwayInventory.trees) {
        if (tree.species !== 'Oak, Southern Live' || tree.z > 60 ||
          distanceToPath(tree.x,tree.z,speedway) > 12 || tree.state !== 'active') continue;
        // The source model's height is 3.4062 m before the shared 2.5x scale.
        // Height follows the inventory; crown spread remains an approximation.
        this.treePlacements.push({
          x:tree.x, z:tree.z, y:speedwayHeight(tree.x,tree.z)-.025,
          rotation:tree.siteId*2.3999632297,
          // Simple shared crowns are enough for this pass. Cap their size so
          // generic trunks do not overwhelm the architecture from Speedway.
          scale:THREE.MathUtils.clamp(tree.heightMetres/(3.4062*2.5),.85,1.25),
          width:1.03 + .07*Math.sin(tree.siteId),
        });
        this.inventoriedTrees++;
      }
      if(gdcFrontage){
        this.treePlacements=this.treePlacements.filter(p=>!inGdcFrontage(p.x,p.z)||!gdcFrontage.paved(p.x,p.z));
        for(const p of this.treePlacements)if(inGdcFrontage(p.x,p.z)){
          p.y=gdcFrontage.height(p.x,p.z)-.025;p.scale=Math.min(p.scale,1);p.width=.9;
        }
      }
      if(engineering)this.treePlacements=this.treePlacements.filter(p=>!engineering.contains(p.x,p.z));
      if(engineeringCourt){
        this.treePlacements=this.treePlacements.filter(p=>!inEngineeringCourt(p.x,p.z));
        const entranceTrees=engineeringCourt.trees.filter(keepEngineeringEntryTree);
        this.treePlacements.push(...entranceTrees);
        this.surfaces.add(...engineeringCourt.meshes);
        for(const geometry of engineeringCourt.colliderGeometries)addCollider(geometry);
        this.auxiliaryGeometries.push(...engineeringCourt.colliderGeometries);
        // The old registration skirt ends above the existing southwest walk.
        // Persist its bounded removal through every subsequent seam rebuild.
        this.seamTrimVolumes.push(engineeringSouthwestSeamTrim());
        this.commitSeams(physics);
        // Court render batches borrow a combined collider, so identity matching
        // at the end of construction cannot discover their backed floor faces.
        for(const mesh of engineeringCourt.groundMeshes)this.groundMaskGeometries.add(mesh.geometry);
        if (localOnly) {
        const northTransition=buildEngineeringNorthTransition({groundMeshes:engineeringCourt.groundMeshes,terrain,
          concrete:engineeringCourt.materials.find(m=>m.name==='Engineering courtyard concrete')!,
          grass});
        this.surfaces.add(...northTransition.meshes);
        for(const geometry of northTransition.colliderGeometries)addCollider(geometry);
        }
        this.volumes.push(...engineeringCourt.volumes);
        this.engineeringCourtyard={...engineeringCourt.stats,trees:entranceTrees.length};
      }
      if(engineering){
        const entryClearance=buildEngineeringEntryClearance({concrete:engineering.materials[0]});
        this.surfaces.add(...entryClearance.meshes);
        for(const geometry of entryClearance.colliderGeometries)addCollider(geometry);
        this.volumes.push(...entryClearance.volumes);
        this.engineeringEntryClearance=entryClearance.stats;
        // The old Dean underpass scan repair is not needed in the local-only
        // scene. Its scan-specific floor datum would create a ledge against
        // the continuous bundled contour terrain.
      }
      if(dkr)this.treePlacements=this.treePlacements.filter(p=>!dkr.contains(p.x,p.z));
      if(west24){
        this.treePlacements=this.treePlacements.filter(p=>!west24.contains(p.x,p.z));
        this.treePlacements.push(...west24.trees);
      }
      if(innerCampus){
        this.treePlacements=this.treePlacements.filter(p=>!innerCampus.contains(p.x,p.z));
        this.treePlacements.push(...innerCampus.trees);
      }
      if(mbb){
        this.treePlacements=this.treePlacements.filter(p=>!inMbbFrontage(p.x,p.z));
        this.treePlacements.push(...mbb.trees);
        this.hedgePlacements.push(...mbb.hedges);
        this.surfaces.add(...mbb.meshes);
        for(const geometry of mbb.colliderGeometries)addCollider(geometry);
        const visible=new Set(mbb.meshes.map(m=>m.geometry));
        this.auxiliaryGeometries.push(...mbb.colliderGeometries.filter(g=>!visible.has(g)));
        this.volumes.push(...mbb.volumes);
        this.mbb=mbb.stats;
      }
      if(mlk){
        this.treePlacements=this.treePlacements.filter(p=>!inMlkMall(p.x,p.z));
        this.treePlacements.push(...mlk.trees);
        this.surfaces.add(...mlk.meshes);
        for(const geometry of mlk.colliderGeometries)addCollider(geometry);
        this.volumes.push(...mlk.volumes);
        const memorial=buildMlkMemorial();
        for(const geometry of [...memorial.geometries,...memorial.colliderGeometries])geometry.translate(100.973214,mlk.statueY,70.853432);
        this.surfaces.add(...memorial.meshes);
        for(const geometry of memorial.colliderGeometries)addCollider(geometry);
        this.auxiliaryGeometries.push(...memorial.colliderGeometries);
        this.materials.push(...memorial.materials);
        this.mlk={...mlk.stats,triangles:mlk.stats.triangles+memorial.stats.triangles};
      }
      if(mlk&&malls&&mainEastApron){
        const grade=(x:number,z:number)=>x>=0?mlk.height(x,z):malls.groundHeight(x,z);
        const yardGrade=(x:number,z:number)=>x>=0?mlk.height(x,z):malls.yardHeight(x,z);
        // Let the existing physical brick and border triangles own their area.
        // This removes only obsolete EPS soil overlapping that supported paving.
        const speedwaySupportStrips=this.surfaces.children.flatMap(object=>{
          if(!(object instanceof THREE.Mesh)||object.name!==''||
            (object.material!==material&&object.material!==concrete))return [];
          const geometry=object.geometry as THREE.BufferGeometry;
          const position=geometry.attributes.position as THREE.BufferAttribute;
          return [{positions:Array.from(position.array),indices:geometry.index
            ?Array.from(geometry.index.array)
            :Array.from({length:position.count},(_,i)=>i)}];
        });
        const buildings=buildMallBuildings(grade,{exclude:['WCP','RLP','WCH'],excludeShells:['EPS','BRB','JGB','WAG','GAR'],speedwaySupportStrips,yardHeight:yardGrade});
        applyMallYardSurfaces(buildings.meshes, grass);
        this.surfaces.add(...buildings.meshes);
        for(const mesh of buildings.meshes)addCollider(mesh.geometry);
        this.materials.push(...buildings.materials);
        this.volumes.push(...buildings.volumes);
        this.mallBuildings=buildings.stats;
        // Query the authored terrace and Inner Campus street at each facade.
        // The nearest-mall approximation alone is insufficient on the west face.
        this.surfaces.updateWorldMatrix(true,true);
        const mainGroundRay=new THREE.Raycaster();
        const mainGround=(x:number,z:number)=>{
          mainGroundRay.set(new THREE.Vector3(x,24,z),new THREE.Vector3(0,-1,0));
          mainGroundRay.far=18;
          const hit=mainGroundRay.intersectObject(this.surfaces,true).find(h=>h.face&&h.face.normal.y>.6);
          return hit?.point.y??grade(x,z);
        };
        // The Welch south cap shares one measured cornice with its complete
        // roof. Sample only existing authored ground before adding its walls.
        const willCHogg=buildWillCHogg(grade,yardGrade);
        applyMallYardSurfaces(willCHogg.meshes,grass,{target:'wch'});
        const welchYard=buildWelchEastYard({concrete:malls.groundMaterial,grass});
        const welchMiddleYard=buildWelchMiddleYard({concrete:malls.groundMaterial,grass});
        const welchNorthExit=buildWelchNorthExit({concrete:malls.groundMaterial,grass});
        const welchWestGap=buildWelchWestGap({concrete:malls.groundMaterial,grass});
        const welchWestCap=buildWelchWestCap({grass});
        const welchNorthSeam=buildWelchNorthSeamClearance();
        const welchGroundRay=new THREE.Raycaster();
        const west24Gravel=this.surfaces.children.filter((m):m is THREE.Mesh=>m instanceof THREE.Mesh&&!Array.isArray(m.material)&&m.material.name==='24th foundation gravel');
        const welchGroundMeshes=[...grassMeshes,...malls.meshes,...(innerCampus?.meshes??[]),...west24Gravel,...willCHogg.meshes.filter(m=>m.name.includes('yard')),...buildings.meshes.filter(m=>!Array.isArray(m.material)&&['Mall planting soil','Mall edge paving'].includes(m.material.name))];
        welchGroundMeshes.forEach(m=>m.updateMatrixWorld(true));
        const strictWelchGround=(x:number,z:number)=>{
          welchGroundRay.set(new THREE.Vector3(x,14,z),new THREE.Vector3(0,-1,0));
          welchGroundRay.far=20;
          return welchGroundRay.intersectObjects(welchGroundMeshes,false).find(h=>h.face&&h.face.normal.y>.6)?.point.y;
        };
        const welchRoutes=buildWelchApproachGround({groundHeight:strictWelchGround,material:malls.groundMaterial,westLandingElevation:7.1,southLandingElevation:6.1,bottomElevation:4.2});
        const welchGround=(x:number,z:number)=>welchRoutes.height(x,z)??(welchYard.contains(x,z)?welchYard.height(x,z):strictWelchGround(x,z)??grade(x,z));
        const welch=buildWelchSouth({groundHeight:welchGround,baseElevation:5.8,eaveElevation:25.5,eastCutFringe:1.15,thresholdElevations:{east:5.8,south:6.2,west:6.0}});
        // Low-origin live ground probes 2 m outside the modern middle wall.
        // Interpolate those ground returns, not canopy/roof hits or the older
        // nearest-Mall approximation. This does not add or flatten route ground.
        const welchMiddleGrade=(_x:number,z:number)=>{
          const anchors=[[-80,5.282954],[-56,5.938743],[-30,5.746559]];
          if(z<=anchors[0][0])return anchors[0][1];
          for(let i=1;i<anchors.length;i++)if(z<=anchors[i][0]){
            const a=anchors[i-1],b=anchors[i];return THREE.MathUtils.lerp(a[1],b[1],(z-a[0])/(b[0]-a[0]));
          }
          return anchors.at(-1)![1];
        };
        const welchMiddle=buildWelchMiddleEast({groundHeight:welchMiddleGrade,materials:welch.materials,baseElevation:5.8,eaveElevation:25.5});
        const welchRoof=buildWelchSouthRoof({eaveElevation:25.5,pitch:.45});
        const welchInnerRoof=buildWelchInnerRoof();
        const welchAprons=buildWelchDoorwayAprons({groundHeight:welchGround,material:malls.groundMaterial});
        // Lower the existing yard only inside the supported doorway recesses.
        // Already-registered grounds have their collider replaced immediately;
        // the newly built WCH yard is updated before its first registration.
        for(const mesh of welchGroundMeshes){
          const previous=mesh.geometry;
          const clipped=subtractVolumes(previous,mesh.matrixWorld,[...welchYard.oldGroundTrimVolumes,...welchMiddleYard.oldGroundTrimVolumes,...welchNorthExit.oldGroundTrimVolumes,...welchWestGap.oldGroundTrimVolumes,...welchWestCap.oldGroundTrimVolumes,...welchRoutes.authoredGroundTrimVolumes,...welchAprons.authoredGroundTrimVolumes]);
          if(!clipped)continue;
          const collider=colliderByGeometry.get(previous);
          if(collider){physics.removeCollider(collider,true);this.colliders.splice(this.colliders.indexOf(collider),1);colliderByGeometry.delete(previous);}
          mesh.geometry=clipped;
          const pendingIndex=willCHogg.colliderGeometries.indexOf(previous);
          if(pendingIndex>=0)willCHogg.colliderGeometries[pendingIndex]=clipped;
          previous.dispose();
          if(collider)addCollider(clipped);
        }
        const triangleCount=(meshes:THREE.Mesh[])=>meshes.reduce((n,m)=>n+(m.geometry.index?.count??m.geometry.attributes.position.count)/3,0);
        malls.stats.triangles=triangleCount(malls.meshes);
        this.west24Buildings.triangles=triangleCount(this.surfaces.children.filter((m):m is THREE.Mesh=>m instanceof THREE.Mesh&&m.name.startsWith('West 24th architecture:')));
        willCHogg.stats.triangles=triangleCount(willCHogg.meshes);
        for(const mesh of welchYard.meshes){
          const previous=mesh.geometry,clipped=subtractVolumes(previous,new THREE.Matrix4(),welchAprons.authoredGroundTrimVolumes);
          if(clipped){mesh.geometry=clipped;welchYard.colliderGeometries[welchYard.colliderGeometries.indexOf(previous)]=clipped;previous.dispose();}
        }
        welchYard.stats.triangles=triangleCount(welchYard.meshes);
        for(const mesh of welchRoutes.meshes){
          const previous=mesh.geometry,clipped=subtractVolumes(previous,new THREE.Matrix4(),welchAprons.authoredGroundTrimVolumes);
          if(clipped){compactWelchRouteTriangles(clipped);mesh.geometry=clipped;welchRoutes.colliderGeometries[welchRoutes.colliderGeometries.indexOf(previous)]=clipped;previous.dispose();}
        }
        welchRoutes.stats.triangles=triangleCount(welchRoutes.meshes);
        this.welchApproaches=welchRoutes.stats;
        this.treePlacements=this.treePlacements.filter(p=>!welchYard.paved(p.x,p.z)&&!welchMiddleYard.paved(p.x,p.z)&&!welchNorthExit.paved(p.x,p.z)&&!welchWestGap.paved(p.x,p.z)&&!welchRoutes.contains(p.x,p.z));
        for(const p of this.treePlacements){
          if(welchYard.contains(p.x,p.z))p.y=welchYard.height(p.x,p.z)-.025;
          else if(welchMiddleYard.contains(p.x,p.z))p.y=welchMiddleYard.height(p.x,p.z)-.025;
          else if(welchNorthExit.contains(p.x,p.z))p.y=welchNorthExit.height(p.x,p.z)-.025;
          else if(welchWestGap.contains(p.x,p.z))p.y=welchWestGap.height(p.x,p.z)-.025;
        }
        // Keep existing simple trees on the new planting grade, and fill only
        // genuinely empty areas; stair branches and the inner walk stay clear.
        for(const tree of [...welchNorthExit.trees,...welchWestGap.trees]){
          if(!this.treePlacements.some(p=>Math.hypot(p.x-tree.x,p.z-tree.z)<6))this.treePlacements.push(tree);
        }
        // Preserve canonical seam indices for later source-height sampling,
        // but never reinstall the obsolete transition surface inside this yard.
        this.seamTrimVolumes.push(...welchMiddleYard.oldGroundTrimVolumes,...welchNorthExit.oldGroundTrimVolumes,...welchWestGap.oldGroundTrimVolumes,...welchWestCap.oldGroundTrimVolumes);
        this.commitSeams(physics);
        this.welchFrontage=welchYard.stats;
        // Prepare the corrected grade without changing the scene queried by
        // existing foundation/door builders. Only GAR's new basement uses it.
        const gardenSoil=buildings.meshes.find(mesh=>mesh.name==='Smooth East Mall buildings: Mall planting soil');
        if(!gardenSoil)throw new Error('Garrison planting ground is unavailable');
        const garrisonPortal=garrisonNorthDoorApproach();
        const garrisonGround=prepareGarrisonGround({soil:gardenSoil,
          terrainHeight:(x,z)=>terrain.height(x,z),
          stone:buildings.materials.find(m=>m.name==='Mall limestone trim')!,
          concrete:malls.groundMaterial,
          doorHeight:Math.max(14.8,mainGround(garrisonPortal.x,garrisonPortal.z))});
        const garrisonFoundation=sampleGarrisonFoundation(garrisonGround.height);
        // These heights and cut boundaries belong to the photographic source.
        // The optional local campus keeps its independently baked terrain.
        if(Array.isArray(gardenSoil.material))throw new Error('Garrison soil requires one material');
        const garrisonLandscape=localOnly?null:buildGarrisonLandscape({
          soil:gardenSoil.material,asphalt,concrete:malls.groundMaterial});
        const historic=buildHistoricCentralBuildings({groundHeight:mainGround,
          waggenerWestDoorHeight:garrisonLandscape?.entry.threshold,
          abbreviations:['EPS','BRB','JGB','WAG','GAR'],
          garrisonBasement:{centerY:13.1,height:1.8,minimumSillClearance:.3,
            groundHeight:garrisonGround.height,foundationBottom:garrisonFoundation.bottom}});
        // Dark interior radiance and sky reflections replace diffuse green paint
        // on the existing panes. Keep the mesh/collider and source-cut ownership.
        applyHistoricGlazing(historic.meshes);
        applyHistoricMasonry(historic.meshes,{brickColor:brickColor(),brickNormal:brickNormal(),stoneColor:limestoneTexture()});
        // WCP's west paving crosses X=0 but belongs to the Speedway/MLK grade
        // on both sides. The legacy building-datum callback switches to the
        // higher Central Mall there, creating an artificial ledge in this yard.
        const modern=buildEastSouthModern(grade,['WCP','RLP'],{WCP:mlk.height});
        const main=buildMainBuildingBase({groundHeight:mainGround,southBaseElevation:18.52,westBaseElevation:16.45});
        // Low-origin live probes at the door were 18.506–18.520 m. Preserve
        // the existing doorstep datum; the approach scan rises farther outside.
        const mainEast=buildMainEastEntry({groundHeight:mainGround,baseElevation:18.52,
          stoneTexture:limestoneTexture()});
        if (localOnly) {
          const mainFinish=applyMainBuildingMaterials(main.meshes,{region:'base',limestoneTexture:limestoneTexture()});
          const mainEastFinish=applyMainBuildingMaterials(mainEast.meshes,{region:'east',limestoneTexture:limestoneTexture()});
          this.mainMaterialFinish={base:mainFinish.stats,east:mainEastFinish.stats};
        }
        this.facadeSamples.push(
          ...welch.samples.map(s=>({name:`WEL south ${s.facade} ${s.kind}`,origin:s.origin,direction:s.direction,minimum:s.minimum??0})),
          ...welchMiddle.samples.map(s=>({name:`WEL middle east ${s.kind}`,origin:s.origin,direction:s.direction,minimum:s.minimum??0})),
          ...mainEast.samples.map(s=>({name:`MAI east ${s.kind}`,origin:s.origin,direction:s.direction,minimum:s.minimum})),
          ...historic.samples.map(s=>({name:`${s.abbr} ${s.kind}`,origin:s.origin,direction:s.direction,minimum:s.expectedMinimumDistance??0})),
          ...main.samples.map(s=>({name:`MAI ${s.kind}`,origin:s.origin,direction:s.direction,minimum:s.minimum})),
        );
        for(const asset of [historic,modern,willCHogg,main,mainEast,mainEastApron,welch,welchMiddle,welchRoof,welchInnerRoof,welchYard,welchMiddleYard,welchNorthExit,welchWestGap,welchWestCap,welchNorthSeam,welchRoutes,welchAprons]){
          if(asset.meshes.length)this.surfaces.add(...asset.meshes);
          for(const geometry of asset.colliderGeometries)addCollider(geometry);
          this.materials.push(...asset.materials);
          this.volumes.push(...asset.volumes);
        }
        this.welchAprons=welchAprons.stats;
        this.welchSouth=welch.stats;
        this.welchMiddleEast=welchMiddle.stats;
        this.welchMiddleYard=welchMiddleYard.stats;
        this.welchNorthExit=welchNorthExit.stats;
        this.welchWestGap=welchWestGap.stats;
        this.welchWestCap=welchWestCap.stats;
        this.welchNorthSeam=welchNorthSeam.stats;
        this.welchInnerRoof=welchInnerRoof.stats;
        this.welchSouthRoof=welchRoof.stats;
        this.historicCentral=historic.stats;
        this.eastSouthModern=modern.stats;
        this.willCHogg=willCHogg.stats;
        this.mainBuilding=main.stats;
        this.mainEastEntry=mainEast.stats;
        this.mainEastApron=mainEastApron.stats;
        // POB: sample the existing stable grass before replacing its overlap.
        const pobRay=new THREE.Raycaster();
        const pobFixedGround=(x:number,z:number)=>{
          pobRay.set(new THREE.Vector3(x,8,z),new THREE.Vector3(0,-1,0));pobRay.far=6;
          return pobRay.intersectObjects(grassMeshes,false).find(h=>h.face&&h.face.normal.y>.5)?.point.y??NaN;
        };
        const pob=buildPobFrontage({concrete:malls.groundMaterial,grass,fixedGroundHeight:pobFixedGround});
        for(const mesh of grassMeshes){
          const previous=mesh.geometry,clipped=subtractVolumes(previous,mesh.matrixWorld,pob.oldGroundTrimVolumes);
          if(!clipped)continue;
          const collider=colliderByGeometry.get(previous);
          if(collider){physics.removeCollider(collider,true);this.colliders.splice(this.colliders.indexOf(collider),1);colliderByGeometry.delete(previous);}
          mesh.geometry=clipped;previous.dispose();if(collider)addCollider(clipped);
        }
        this.seamTrimVolumes.push(...pob.oldGroundTrimVolumes);
        this.commitSeams(physics);
        this.treePlacements=this.treePlacements.filter(p=>!pob.paved(p.x,p.z));
        for(const tree of this.treePlacements)if(pob.contains(tree.x,tree.z))tree.y=pob.height(tree.x,tree.z)-.025;
        this.surfaces.add(...pob.meshes);
        for(const geometry of pob.colliderGeometries)addCollider(geometry);
        this.materials.push(...pob.materials);
        this.volumes.push(...pob.volumes);
        this.pobFrontage=pob.stats;
        const pob59Ray=new THREE.Raycaster();
        const pob59Fixed=(x:number,z:number)=>{
          const sample=(xx:number)=>{pob59Ray.set(new THREE.Vector3(xx,8,z),new THREE.Vector3(0,-1,0));pob59Ray.far=6;return pob59Ray.intersectObjects(grassMeshes,false).find(h=>h.face&&h.face.normal.y>.5)?.point.y??NaN;};
          const y=sample(x);return Number.isFinite(y)?y:sample(x-.02);
        };
        // Match the existing uppermost authored boundary, including the small
        // western grass shoulder; interior heights use the baked road topology.
        const pob59RoadMeshes=new Set<THREE.Mesh>();
        const pob59Road=(x:number,z:number)=>{
          pob59Ray.set(new THREE.Vector3(x,5,z),new THREE.Vector3(0,-1,0));pob59Ray.far=3;
          const hits=pob59Ray.intersectObjects(this.surfaces.children,false).filter(h=>h.face&&h.face.normal.y>.5&&h.object.name!=='Ground registration transitions');
          for(const hit of hits)pob59RoadMeshes.add(hit.object as THREE.Mesh);
          return hits[0]?.point.y??NaN;
        };
        const pob59=buildPobBoundaries({fixedRoadHeight:pob59Road,concrete:malls.groundMaterial,grass,stone:pob.materials[0],westYardHeight:pob.yard.height,fixedGroundHeight:pob59Fixed});
        for(const mesh of new Set([...grassMeshes,...pob.yard.meshes,...pob59RoadMeshes])){
          const previous=mesh.geometry,clipped=subtractVolumes(previous,mesh.matrixWorld,pob59.oldGroundTrimVolumes);
          if(!clipped)continue;
          const collider=colliderByGeometry.get(previous);
          if(collider){physics.removeCollider(collider,true);this.colliders.splice(this.colliders.indexOf(collider),1);colliderByGeometry.delete(previous);}
          previous.dispose();mesh.geometry=clipped;if(collider)addCollider(clipped);
        }
        this.seamTrimVolumes.push(...pob59.oldGroundTrimVolumes);
        this.commitSeams(physics);
        this.treePlacements=this.treePlacements.filter(t=>!pob59.paved(t.x,t.z));
        for(const tree of this.treePlacements)if(pob59.contains(tree.x,tree.z))tree.y=pob59.height(tree.x,tree.z)-.025;
        this.surfaces.add(...pob59.meshes);
        for(const geometry of pob59.colliderGeometries)addCollider(geometry);
        this.volumes.push(...pob59.volumes);
        this.pobBoundaries=pob59.stats;
        const pobSouthConnection=buildPobSouthConnection({concrete:malls.groundMaterial,grass,existingCapHeight:pob59.height,existingGroundHeight:pob59Fixed,gdcGround:gdcFrontage!.mesh});
        for(const mesh of [...grassMeshes,...pob59.ground.meshes]){
          const previous=mesh.geometry,clipped=subtractVolumes(previous,mesh.matrixWorld,pobSouthConnection.oldGroundTrimVolumes);
          if(!clipped)continue;
          const collider=colliderByGeometry.get(previous);
          if(collider){physics.removeCollider(collider,true);this.colliders.splice(this.colliders.indexOf(collider),1);colliderByGeometry.delete(previous);}
          previous.dispose();mesh.geometry=clipped;if(collider)addCollider(clipped);
        }
        this.seamTrimVolumes.push(...pobSouthConnection.oldGroundTrimVolumes);
        this.commitSeams(physics);
        this.treePlacements=this.treePlacements.filter(t=>!pobSouthConnection.paved(t.x,t.z));
        for(const tree of this.treePlacements)if(pobSouthConnection.contains(tree.x,tree.z))tree.y=pobSouthConnection.height(tree.x,tree.z)-.025;
        this.surfaces.add(...pobSouthConnection.meshes);
        for(const geometry of pobSouthConnection.colliderGeometries)addCollider(geometry);
        this.volumes.push(...pobSouthConnection.volumes);
        this.pobSouthConnection=pobSouthConnection.stats;
        const pobSouth=buildPobSouth({stone:pob.materials[0],glass:pob.materials[2],metal:pob.materials[3]});
        this.surfaces.add(...pobSouth.meshes);
        for(const geometry of pobSouth.colliderGeometries)addCollider(geometry);
        this.volumes.push(...pobSouth.volumes);
        this.pobSouth=pobSouth.stats;
        const pobSouthClearance=buildPobSouthClearance({frontage:pobSouth,concrete:malls.groundMaterial,outerGrade:pobSouthApronGrade.outerGrade as [number,number][],westCapHeight:(x,z)=>pobSouthConnection.contains(x,z)?pobSouthConnection.height(x,z):pob59.height(x,z)});
        this.surfaces.add(...pobSouthClearance.meshes);
        for(const geometry of pobSouthClearance.colliderGeometries)addCollider(geometry);
        // This apron meets the old authored floors at their edges; only the
        // scanned source needs removal. Preserve the stone wall and its sills.
        this.volumes.push(...pobSouthClearance.volumes);
        this.pobSouthClearance=pobSouthClearance.stats;
        const pobCourt=buildPobCourtConnection({apron:pobSouthClearance,along:pobSouth.frame.along,westHeight:pobSouthConnection.height,gdcGround:gdcFrontage!.mesh,concrete:malls.groundMaterial});
        for(const mesh of grassMeshes){
          const previous=mesh.geometry,clipped=subtractVolumes(previous,mesh.matrixWorld,pobCourt.oldGroundTrimVolumes);
          if(!clipped)continue;
          const collider=colliderByGeometry.get(previous);
          if(collider){physics.removeCollider(collider,true);this.colliders.splice(this.colliders.indexOf(collider),1);colliderByGeometry.delete(previous);}
          previous.dispose();mesh.geometry=clipped;if(collider)addCollider(clipped);
        }
        this.seamTrimVolumes.push(...pobCourt.oldGroundTrimVolumes);
        this.commitSeams(physics);
        this.treePlacements=this.treePlacements.filter(t=>!pobCourt.contains(t.x,t.z));
        this.surfaces.add(...pobCourt.meshes);
        for(const geometry of pobCourt.colliderGeometries)addCollider(geometry);
        this.volumes.push(...pobCourt.volumes);
        this.pobCourtConnection=pobCourt.stats;
        const pobUpper=buildPobUpperProjection({frontage:pobSouth,stone:pob.materials[0],glass:pob.materials[2],metal:pob.materials[3]});
        this.surfaces.add(...pobUpper.meshes);
        for(const geometry of pobUpper.colliderGeometries)addCollider(geometry);
        this.volumes.push(...pobUpper.volumes);
        this.pobUpperProjection=pobUpper.stats;
        const pobUpperClearance=buildPobUpperClearance({frontage:pobSouth,upper:pobUpper});
        this.volumes.push(...pobUpperClearance.volumes);
        this.pobUpperClearance=pobUpperClearance.stats;
        const connector=buildPobConnector({stone:pob.materials[0],brick:pob.materials[1],glass:pob.materials[2],metal:pob.materials[3],concrete:malls.groundMaterial});
        this.surfaces.add(...connector.meshes);
        for(const geometry of connector.colliderGeometries)addCollider(geometry);
        this.volumes.push(...connector.volumes);
        this.pobConnector=connector.stats;
        const neck=buildGdcNorthNeck({stone:pob.materials[0],brick:pob.materials[1],metal:pob.materials[3],concrete:malls.groundMaterial});
        this.surfaces.add(...neck.meshes);
        for(const geometry of neck.colliderGeometries)addCollider(geometry);
        this.volumes.push(...neck.volumes);
        this.gdcNorthNeck=neck.stats;

        // All original ground-dependent builders have finished. Swap the
        // shared yard renderer and collider together before sampling tree roots.
        const previousGarden=gardenSoil.geometry;
        const previousGardenCollider=colliderByGeometry.get(previousGarden);
        if(!previousGardenCollider)throw new Error('Garrison ground collider is unavailable');
        physics.removeCollider(previousGardenCollider,true);
        this.colliders.splice(this.colliders.indexOf(previousGardenCollider),1);
        colliderByGeometry.delete(previousGarden);
        gardenSoil.geometry=garrisonGround.geometry;
        previousGarden.dispose();
        addCollider(garrisonGround.geometry);
        this.surfaces.add(...garrisonGround.meshes);
        for(const geometry of garrisonGround.colliderGeometries)addCollider(geometry);
        buildings.stats.triangles=triangleCount(buildings.meshes);

        // Plant only on the final soil. A scene-wide ray could select a
        // streamed canopy or roof and suspend a tree above the actual garden.
        gardenSoil?.updateWorldMatrix(true,false);
        const gardenRay=new THREE.Raycaster();
        const retainedGardenHeight=(x:number,z:number):number|null=>{
          if(!gardenSoil)return null;
          gardenRay.set(new THREE.Vector3(x,80,z),new THREE.Vector3(0,-1,0));
          gardenRay.far=100;
          return gardenRay.intersectObject(gardenSoil,false).find(hit=>hit.face&&
            hit.face.normal.clone().transformDirection(gardenSoil.matrixWorld).y>.5)?.point.y??null;
        };
        this.treePlacements.push(...garrisonGardenTrees(retainedGardenHeight,this.treePlacements));
        this.treePlacements.push(...garrisonGardenExtraTrees(retainedGardenHeight,this.treePlacements));

        // BRB's existing yard supplies the lower floor joining MLK. The generic
        // Speedway grass and source-registration seams must not float above it.
        // Install late so original facade/door/foundation datum queries remain
        // unchanged; displayed and physical ground always share this result.
        const brbSoil=correctBrbYardGround(gardenSoil.geometry,mlk!.height);
        if(brbSoil){
          const previous=gardenSoil.geometry,collider=colliderByGeometry.get(previous);
          if(!collider)throw new Error('BRB ground collider is unavailable');
          physics.removeCollider(collider,true);
          this.colliders.splice(this.colliders.indexOf(collider),1);
          colliderByGeometry.delete(previous);
          gardenSoil.geometry=brbSoil;
          previous.dispose();
          addCollider(brbSoil);
        }
        // WCP also has an obsolete generic fringe above its sloping paving.
        // Give the actual yard floor ownership after all building datum queries.
        const wcpPaving=modern.meshes.find(mesh=>mesh.name==='WCP existing perimeter paving');
        if(!wcpPaving)throw new Error('WCP perimeter paving is unavailable');
        const yardPriority=[...brbYardGroundPriority(),...wcpYardGroundPriority(wcpPaving.geometry)];
        for(const mesh of grassMeshes){
          const previous=mesh.geometry,clipped=subtractVolumes(previous,mesh.matrixWorld,yardPriority);
          if(!clipped)continue;
          compactBrbGroundTriangles(clipped);
          compactWcpGroundTriangles(clipped);
          const collider=colliderByGeometry.get(previous);
          if(!collider)throw new Error('Speedway fringe collider is unavailable');
          physics.removeCollider(collider,true);
          this.colliders.splice(this.colliders.indexOf(collider),1);
          colliderByGeometry.delete(previous);
          mesh.geometry=clipped;
          previous.dispose();
          addCollider(clipped);
        }
        this.seamTrimVolumes.push(...yardPriority);
        this.commitSeams(physics);
        gardenSoil.updateWorldMatrix(true,false);
        for(const tree of this.treePlacements)if(inBrbYard(tree.x,tree.z)){
          const floor=retainedGardenHeight(tree.x,tree.z);
          if(floor!==null)tree.y=floor-.025;
        }
        buildings.stats.triangles=triangleCount(buildings.meshes);

        if(garrisonLandscape){
          // Replace only the connected WAG west yard. Keep the previously
          // accepted GAR faces and the disjoint BRB correction in this batch.
          const previous=gardenSoil.geometry,normalized=previous.clone();
          normalized.clearGroups();
          const clipped=subtractVolumes(normalized,gardenSoil.matrixWorld,garrisonLandscape.oldGroundTrimVolumes);
          normalized.dispose();
          if(!clipped)throw new Error('Waggener west ground replacement is unavailable');
          const collider=colliderByGeometry.get(previous);
          if(!collider)throw new Error('Waggener west ground collider is unavailable');
          physics.removeCollider(collider,true);
          this.colliders.splice(this.colliders.indexOf(collider),1);
          colliderByGeometry.delete(previous);
          gardenSoil.geometry=clipped;
          previous.dispose();
          addCollider(clipped);
          this.surfaces.add(...garrisonLandscape.meshes);
          for(const geometry of garrisonLandscape.colliderGeometries)addCollider(geometry);
          this.volumes.push(...garrisonLandscape.volumes);
          // Keep future source-registration rebuilds below the new floor.
          this.seamTrimVolumes.push(...garrisonLandscape.volumes);
          this.commitSeams(physics);
          this.treePlacements.push(...garrisonLandscape.treePlacements(this.treePlacements));
          this.garrisonLandscape=garrisonLandscape.stats;
          buildings.stats.triangles=triangleCount(buildings.meshes);
        }

        if(!localOnly){
          const groundMeshes=[wcpPaving,...modern.meshes.filter(m=>m.name==='WCP existing planting soil'),...grassMeshes];
          groundMeshes.forEach(m=>m.updateWorldMatrix(true,false));
          const ray=new THREE.Raycaster(),westSamples=new Map<number,number>();
          const westHeight=(z:number)=>{
            if(westSamples.has(z))return westSamples.get(z)!;
            ray.set(new THREE.Vector3(-1,7,z),new THREE.Vector3(0,-1,0));ray.far=12;
            const y=ray.intersectObjects(groundMeshes,false).find(h=>h.face&&h.face.normal.y>.5)?.point.y??mlk.height(-1,z);
            westSamples.set(z,y);return y;
          };
          const mlkGravel=mlk.meshes.find(m=>m.name==='MLK East Mall gravel')?.material;
          if(!(mlkGravel instanceof THREE.MeshStandardMaterial)||!mlkGravel.map||!mlkGravel.normalMap)throw Error('Gregory ground texture sources are unavailable');
          const gregory=buildGregoryWalk({groundHeight:mlk.height,westHeight,concrete,
            brickColor:brickColor(),brickNormal:brickNormal(),gravelColor:mlkGravel.map,gravelNormal:mlkGravel.normalMap});
          for(const mesh of groundMeshes){
            const previous=mesh.geometry,clipped=subtractVolumes(previous,mesh.matrixWorld,gregory.groundVolumes);
            if(!clipped)continue;
            const collider=colliderByGeometry.get(previous);
            if(!collider)throw Error('Gregory old ground collider is unavailable');
            physics.removeCollider(collider,true);this.colliders.splice(this.colliders.indexOf(collider),1);colliderByGeometry.delete(previous);
            mesh.geometry=clipped;previous.dispose();addCollider(clipped);
          }
          this.surfaces.add(...gregory.meshes);
          for(const geometry of gregory.colliderGeometries)addCollider(geometry);
          this.materials.push(...gregory.materials);this.volumes.push(...gregory.volumes);
          this.seamTrimVolumes.push(...gregory.groundVolumes);this.commitSeams(physics);
          this.treePlacements=this.treePlacements.filter(p=>!gregory.contains(p.x,p.z));
          // The legacy generated tree blocked this real pedestrian junction.
          // Move it to nearby public inventory site 5004, with its root on the
          // retained Speedway ground. Keep the visible trunk collider intact.
          const relocation=gregory.treeRelocation;
          for(const tree of this.treePlacements)if(Math.hypot(tree.x-relocation.from[0],tree.z-relocation.from[1])<.1){
            const [x,z]=relocation.to;
            this.surfaces.updateWorldMatrix(true,true);
            ray.set(new THREE.Vector3(x,7,z),new THREE.Vector3(0,-1,0));ray.far=12;
            const ground=ray.intersectObject(this.surfaces,true).find(h=>h.face&&h.face.normal.clone().transformDirection(h.object.matrixWorld).y>.5)?.point.y;
            if(ground===undefined)throw Error('Gregory junction tree support is unavailable');
            tree.x=x;tree.z=z;tree.y=ground+.017011718824505806*2.5*tree.scale*(tree.height??1)-.03;
          }
          this.treePlacements.push(...gregory.trees);this.gregoryWalk=gregory.stats;
          const frontageFloors=[...groundMeshes,...gregory.meshes.filter(m=>m.name.startsWith('Gregory north walk '))];
          frontageFloors.forEach(m=>m.updateWorldMatrix(true,false));
          const north=buildGregoryNorth({stoneTexture:limestoneTexture(),gravelColor:mlkGravel.map,gravelNormal:mlkGravel.normalMap,groundHeight:(x,z)=>{
            ray.set(new THREE.Vector3(x,3,z),new THREE.Vector3(0,-1,0));ray.far=8;
            return ray.intersectObjects(frontageFloors,false).find(h=>h.face&&h.face.normal.clone().transformDirection(h.object.matrixWorld).y>.5)?.point.y??mlk.height(x,z);
          }});
          for(const mesh of frontageFloors){
            const previous=mesh.geometry,clipped=subtractVolumes(previous,mesh.matrixWorld,north.groundVolumes);
            if(!clipped)continue;
            const collider=colliderByGeometry.get(previous);if(!collider)throw Error('Gregory north old floor collider is unavailable');
            physics.removeCollider(collider,true);this.colliders.splice(this.colliders.indexOf(collider),1);colliderByGeometry.delete(previous);
            mesh.geometry=clipped;previous.dispose();addCollider(clipped);
          }
          this.surfaces.add(...north.meshes);for(const geometry of north.colliderGeometries)addCollider(geometry);
          this.materials.push(...north.materials);this.volumes.push(...north.volumes);
          this.seamTrimVolumes.push(...north.groundVolumes);this.commitSeams(physics);
          this.gregoryNorth=north.stats;

        }

      }
    }
    if (landscape) {
      const capitol = buildCapitolDome();
      this.surfaces.add(...capitol.meshes);
      for (const geometry of capitol.colliderGeometries) addCollider(geometry);
      this.materials.push(...capitol.materials); this.volumes.push(...capitol.volumes);
      this.capitolDome = capitol.stats;
      const area = buildCapitolArea(capitol.materials);
      this.surfaces.add(...area.meshes);
      for (const geometry of area.colliderGeometries) addCollider(geometry);
      this.materials.push(...area.materials); this.volumes.push(...area.volumes);
      this.treePlacements.push(...area.trees); this.capitolArea = area.stats;
    }
    this.surfaces.traverse(object => {
      if (object instanceof THREE.Mesh && colliderByGeometry.has(object.geometry))
        this.groundMaskGeometries.add(object.geometry);
    });
    if (this.seamMesh && this.seamCollider)
      this.groundMaskGeometries.add(this.seamMesh.geometry);
  }
  async loadDetails() {
    await this.trees?.load(this.treePlacements,this.hedgePlacements);
  }
  update(camera: THREE.Camera) {
    this.trees?.update(camera);
  }
  snapshot() {
    return {
      mlk:this.mlk,
      capitolDome:this.capitolDome,
      capitolArea:this.capitolArea,
      mallBuildings:this.mallBuildings,
      historicCentral:this.historicCentral,
      garrisonLandscape:this.garrisonLandscape,
      gregoryWalk:this.gregoryWalk,gregoryNorth:this.gregoryNorth,
      eastSouthModern:this.eastSouthModern,
      willCHogg:this.willCHogg,
      mainBuilding:this.mainBuilding,
      mainMaterialFinish:this.mainMaterialFinish,
      mainEastEntry:this.mainEastEntry,
      mainEastApron:this.mainEastApron,
      welchSouth:this.welchSouth,
      welchMiddleEast:this.welchMiddleEast,
      welchMiddleYard:this.welchMiddleYard,
      welchNorthExit:this.welchNorthExit,
      welchWestGap:this.welchWestGap,
      welchWestCap:this.welchWestCap,
      welchNorthSeam:this.welchNorthSeam,
      welchInnerRoof:this.welchInnerRoof,
      welchSouthRoof:this.welchSouthRoof,
      welchFrontage:this.welchFrontage,
      welchAprons:this.welchAprons,
      welchApproaches:this.welchApproaches,
      west24Buildings:this.west24Buildings,
      routeMeters: Math.round(this.length),
      trees: this.trees?.count ?? 0,
      hedges: this.trees?.hedgeStats ?? null,
      inventoriedTrees: this.inventoriedTrees,
      excludedTrees: this.excludedTrees,
      sourceWayIds: this.sourceWayIds,
      pclParapetMeters: Math.round(this.pclParapetMeters),
      pclArchitecture: this.pclArchitecture,
      pclPlaza:this.pclPlaza,
      centralMalls:this.centralMalls,
      hackerman:this.hackerman,
      mbb:this.mbb,
      engineering:this.engineering,
      engineeringCourtyard:this.engineeringCourtyard,
      engineeringEntryClearance:this.engineeringEntryClearance,
      dkr:this.dkr,
      dkrFrontage:this.dkrFrontage,
      dkrForecourt:this.dkrForecourt,
      dkrWestConnection:this.dkrWestConnection,
      pobFrontage:this.pobFrontage,
      pobBoundaries:this.pobBoundaries,
      gdcNorthNeck:this.gdcNorthNeck,
      pobConnector:this.pobConnector,
      pobCourtConnection:this.pobCourtConnection,
      pobSouthConnection:this.pobSouthConnection,
      pobUpperClearance:this.pobUpperClearance,
      pobSouth:this.pobSouth,
      pobSouthClearance:this.pobSouthClearance,
      pobUpperProjection:this.pobUpperProjection,
      dkrEntranceFinish:this.dkrEntranceFinish,
      west24:this.west24,
      innerCampus:this.innerCampus,
      flawn:this.flawn,
      hogg:this.hogg,
      union:this.union,
      gdc:this.gdc,
      transitionSamples: this.seamSamples.length,
      matchedSamples: this.seamSamples.filter((sample) => sample.done).length,
    };
  }
  // Sample only a few nearby edge points per frame. A low ray origin excludes
  // roofs and most foliage; the source callback also rejects coarse tiles.
  stitchGround(
    physics: RAPIER.World,
    player: THREE.Vector3,
    sample: (x: number, z: number, referenceY: number) => number | null,
  ) {
    if (!this.seamGeometry || !this.seamSamples.length) return;
    const start = performance.now();
    let queried = 0;
    for (
      let examined = 0;
      examined < this.seamSamples.length && queried < 4;
      examined++
    ) {
      const edge =
        this.seamSamples[this.nextSeamSample++ % this.seamSamples.length];
      if (edge.done || Math.hypot(edge.x - player.x, edge.z - player.z) > 90)
        continue;
      if(this.seamTrimVolumes.some(v=>edge.x>=v.bounds.min.x&&edge.x<=v.bounds.max.x&&edge.z>=v.bounds.min.z&&edge.z<=v.bounds.max.z&&
        v.planes.every(p=>Math.abs(p.normal.y)>.5||p.normal.x*edge.x+p.normal.z*edge.z+p.constant<=1e-6))){
        edge.done=true;continue;
      }
      queried++;
      const y = sample(edge.x, edge.z, edge.y);
      if (y !== null) {
        // A large difference signals an unreliable surface, not a new ramp.
        if (Math.abs(y - edge.y) <= 2.8) {
          this.seamGeometry.attributes.position.setY(edge.index, y - 0.015);
          this.seamGeometry.attributes.position.setY(
            edge.linkedIndex,
            y - 0.015,
          );
          this.seamDirty = true;
        }
        edge.done = true;
      }
      if (performance.now() - start > 2) break;
    }
    if (this.seamDirty && performance.now() - this.lastSeamCommit > 500)
      this.commitSeams(physics);
  }
  private commitSeams(physics: RAPIER.World) {
    if (!this.seamGeometry) return;
    this.seamGeometry.attributes.position.needsUpdate = true;
    this.seamGeometry.computeVertexNormals();
    this.seamGeometry.computeBoundingSphere();
    const geometry=this.seamTrimVolumes.length
      ? subtractVolumes(this.seamGeometry,new THREE.Matrix4(),this.seamTrimVolumes)??this.seamGeometry
      : this.seamGeometry;
    if(geometry!==this.seamGeometry)compactWelchRouteTriangles(geometry);
    const replacement = physics.createCollider(
      RAPIER.ColliderDesc.trimesh(
        geometry.attributes.position.array as Float32Array,
        geometry.index?new Uint32Array(geometry.index.array):Uint32Array.from({length:geometry.attributes.position.count},(_,i)=>i),
        RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES,
      ).setFriction(0.8),
    );
    const previous=this.seamMesh?.geometry;
    if(this.seamMesh)this.seamMesh.geometry=geometry;
    if (this.seamCollider) physics.removeCollider(this.seamCollider, true);
    if(previous&&previous!==this.seamGeometry&&previous!==geometry)previous.dispose();
    this.seamCollider = replacement;
    this.lastSeamCommit = performance.now();
    this.seamDirty = false;
  }
  dispose(physics: RAPIER.World) {
    this.groundMaskGeometries.clear();
    this.trees?.dispose();
    if (this.seamCollider) physics.removeCollider(this.seamCollider, true);
    this.group.removeFromParent();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    if(this.seamGeometry&&this.seamGeometry!==this.seamMesh?.geometry)this.seamGeometry.dispose();
    for (const c of this.colliders) physics.removeCollider(c, true);
    for (const g of this.auxiliaryGeometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
  }
}
