import * as THREE from 'three';
import catalogData from '../../../public/data/building-catalog.json' with { type: 'json' };
import type { Building } from '../types';
import { hash01 } from '../context-geometry';

/** Typed access to public/data/building-catalog.json (built by
 * tools/context/build-catalog.mjs) and per-building spec resolution. */

export type WallFamily = 'buffBrick' | 'brownBrick' | 'limestone' | 'precast' | 'stucco' | 'siding' | 'metal';
export type RoofFamily = 'clayTile' | 'shingle' | 'membrane';
export type RoofForm = 'hip-tile' | 'hip-shingle' | 'hip-metal' | 'flat';
export type WindowType = 'punched' | 'ribbon' | 'glazed' | 'open' | 'none';
export type FrameKind = 'dark' | 'bronze' | 'light';
export type Basis = 'known' | 'estimate' | 'district-default';

export interface WindowSpec {
  bay: number; width: number; sill: number; head: number;
  mullions: number; transom: boolean; type: WindowType; frame: FrameKind; surround?: boolean;
}

export interface Archetype {
  label: string; era: string;
  wall: WallFamily; wallColor: string; ground: WallFamily; groundColor: string;
  base: WallFamily; baseColor: string; baseHeight: number;
  trim: WallFamily; trimColor: string;
  roof: RoofForm; roofColor: string; roofSlope: number; overhang: number; brackets: boolean;
  parapet: number; cornice: number; belt: boolean; floor: number; groundFloor: number;
  sunshades?: boolean; storefront?: boolean; deepReveal?: boolean;
  window: WindowSpec; groundWindow: WindowSpec;
  door: { width: number; height: number; vehicle?: boolean };
  reference: string;
}

export interface CatalogEntry {
  abbr?: string; archetype: string; basis: Basis; district: string; note: string;
  overrides?: { wallFamily?: WallFamily; wallColor?: string; storefront?: boolean };
}

export interface BuildingCatalog {
  version: number;
  archetypes: Record<string, Archetype>;
  buildings: Record<string, CatalogEntry>;
  stats: { basis: Record<Basis, number>; archetypes: Record<string, number> };
}

export const CATALOG = catalogData as unknown as BuildingCatalog;

/** Resolved, per-building architectural spec (tone/module variation applied). */
export interface BuildingSpec {
  archetype: string;
  arch: Archetype;
  basis: Basis;
  district: string;
  wall: WallFamily; wallColor: THREE.Color;
  ground: WallFamily; groundColor: THREE.Color;
  base: WallFamily; baseColor: THREE.Color;
  trim: WallFamily; trimColor: THREE.Color;
  roof: RoofForm; roofColor: THREE.Color;
  window: WindowSpec; groundWindow: WindowSpec;
  storefront: boolean;
}

const color = (hex: string, id: number, salt: number, amount: number) => {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  // Subtle per-building variation inside the archetype: lightness ±amount, tiny hue/saturation drift.
  hsl.l = THREE.MathUtils.clamp(hsl.l + (hash01(id, salt) - 0.5) * 2 * amount, 0.05, 0.95);
  hsl.s = THREE.MathUtils.clamp(hsl.s * (0.9 + hash01(id, salt + 1) * 0.2), 0, 1);
  hsl.h = (hsl.h + (hash01(id, salt + 2) - 0.5) * 0.012 + 1) % 1;
  return c.setHSL(hsl.h, hsl.s, hsl.l);
};

/** Fallback when a footprint is missing from the catalogue (should not happen). */
function fallbackEntry(): CatalogEntry {
  return { archetype: 'master-plan', basis: 'district-default', district: 'unknown', note: 'not in catalogue' };
}

export function catalogEntry(b: Building, catalog = CATALOG): CatalogEntry {
  return catalog.buildings[String(b.id)] ?? fallbackEntry();
}

export function resolveSpec(b: Building, catalog = CATALOG): BuildingSpec {
  const entry = catalogEntry(b, catalog);
  // Own properties only: an inherited name such as "toString" must never resolve as an archetype.
  const arch = Object.hasOwn(catalog.archetypes, entry.archetype) ? catalog.archetypes[entry.archetype] : catalog.archetypes['master-plan'];
  const o = entry.overrides ?? {};
  // Module variation: bays ±4 %, window widths ±5 % (never between unrelated styles).
  const k = 0.96 + hash01(b.id, 21) * 0.08, w = 0.95 + hash01(b.id, 22) * 0.1;
  const mod = (s: WindowSpec): WindowSpec => ({ ...s, bay: s.bay * k, width: Math.min(s.width * w, s.bay * k - 0.3) });
  const wall = o.wallFamily ?? arch.wall;
  return {
    archetype: entry.archetype, arch, basis: entry.basis, district: entry.district,
    wall, wallColor: color(o.wallColor ?? arch.wallColor, b.id, 1, 0.035),
    ground: o.wallFamily && arch.ground === arch.wall ? wall : arch.ground,
    groundColor: color(o.wallColor && arch.ground === arch.wall ? o.wallColor : arch.groundColor, b.id, 1, 0.035),
    base: arch.base, baseColor: color(arch.baseColor, b.id, 5, 0.025),
    trim: arch.trim, trimColor: color(arch.trimColor, b.id, 8, 0.02),
    roof: arch.roof, roofColor: color(arch.roofColor, b.id, 11, 0.04),
    window: mod(arch.window), groundWindow: mod(arch.groundWindow),
    storefront: o.storefront ?? arch.storefront ?? false,
  };
}

/** Spec for a building rendered with another archetype (per-volume facade composition by a block). */
export function resolveSpecWith(b: Building, archetype: string, catalog = CATALOG): BuildingSpec {
  if (!Object.hasOwn(catalog.archetypes, archetype)) throw new Error(`unknown archetype ${archetype}`);
  const entry = catalogEntry(b, catalog);
  return resolveSpec(b, { ...catalog, buildings: { ...catalog.buildings, [String(b.id)]: { ...entry, archetype, overrides: undefined } } });
}
