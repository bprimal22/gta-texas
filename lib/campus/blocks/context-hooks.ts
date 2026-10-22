// Lookups the generated context reads, keyed by immutable source-record key ("<id>:<recordIndex>").
// Filled by blocks/registry.ts: massing in applyBlockData (validated, atomic per block); replacements
// only by installBlocks AFTER the replacing geometry installed successfully. Kept apart from the
// registry so context code never imports block geometry modules.
import type { Building, Point } from '../types';
import type { Massing, Volume } from '../context/massing';
import { resolveSpecWith } from '../context/catalog';
import type { BlockMassingVolume } from './types';

/** Committed replacements: record key -> block. */
export const BLOCK_REPLACES = new Map<string, string>();
/** Explicit massing: record key -> volumes + resolved height base (undefined = generator grade). */
export const BLOCK_MASSING = new Map<string, { block: string; volumes: BlockMassingVolume[]; heightBase?: number }>();

export const recordKey = (b: Building) => b.key ?? `${b.id}:?`;
export const isReplaced = (b: Building) => BLOCK_REPLACES.has(recordKey(b));

/** Explicit block massing for a generated building, or null to use LiDAR / campus.json. */
export function blockMassing(b: Building, rings: Point[][]): Massing | null {
  const m = BLOCK_MASSING.get(recordKey(b));
  if (!m) return null;
  const volumes: Volume[] = m.volumes.map(v => ({
    rings: v.rings ?? (v.ring ? [v.ring] : rings), bottom: v.bottom, top: v.top, roof: v.roof,
    slope: v.slope ?? (v.roof === 'flat' ? 0 : 0.45), role: v.role ?? 'main',
    ...(v.archetype ? { spec: resolveSpecWith(b, v.archetype) } : {}),
  }));
  return { volumes, source: 'block', height: Math.max(...volumes.map(v => v.top)), heightBase: m.heightBase };
}
