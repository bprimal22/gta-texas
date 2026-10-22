export type Point = [number, number];
export interface Building {
  id: number;
  /** Immutable source-record key "<id>:<recordIndex in campus.json>" (set by blocks/registry applyBlockData before any edit). */
  key?: string;
  name: string;
  abbr: string;
  h: number;
  center: Point;
  rings: Point[][];
}
export interface Path {
  id: number;
  kind: string;
  name: string;
  width: number;
  points: Point[];
  area: boolean;
}
export interface CampusData {
  origin: Point;
  bounds: number[];
  buildings: Building[];
  paths: Path[];
  trees?: { id: number; position: Point; species?: string }[];
  landmarks: Record<string, { name: string; position: Point }>;
  metadata: Record<string, string>;
}
export interface TerrainData {
  x0: number;
  z0: number;
  step: number;
  nx: number;
  nz: number;
  heights: number[];
}
export interface GameStatus {
  ready: boolean;
  location: string;
  speed: number;
  fps: number;
  mode: string;
  /** True when the game is using only files bundled with the local app. */
  offline?: boolean;
  locomotion?: 'foot'|'mounting'|'riding'|'dismounting'|'flying'|'landing';
  flightSpeed?: number;
  flightHeight?: number;
  flightMessage?: string;
  flightHolding?: boolean;
  scooterSpeed?: number;
  rideMessage?: string;
  heading?: string;
  overview?: boolean;
  mapExpanded?: boolean;
  traveling?: boolean;
  travelMessage?: string;
  error?: string;
  imagery?: {
    provider: string;
    loaded: number;
    visible: number;
    errors: number;
    progress: number;
    aligned: boolean;
    credits: string;
    downloadRecovery?: {
      state: 'ready' | 'cooldown' | 'paused';
      retryInSeconds: number;
    };
  };
}
