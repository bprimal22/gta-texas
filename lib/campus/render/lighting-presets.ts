// Pure data (no runtime imports) so Node checks can load it directly.
// `legacy` reproduces the pre-overhaul game.ts values exactly (rollback).
// `austin-late-morning` is the calibrated daylight; see HANDOFF.md for the
// numeric derivation (lib/campus/render/checks/lighting-calibration.mjs).
import type { SkyParameters } from './sky-model';

export type ShadowMode = 'single' | 'csm';

export interface LightingPreset {
  id: string;
  /** Sun from an explicit direction (legacy) or a local civil time in Austin. */
  sun: { direction: [number, number, number] } | { time: string };
  sunColor: number;
  sunIntensity: number;
  sky: SkyParameters & {
    /** Radiance gain of the VISIBLE sky only (1 = unpatched three Sky). */
    visibleGain: number;
    cloudCoverage: number;
  };
  environment: {
    /** scene.environmentIntensity applied to the raw-scale sky PMREM. */
    intensity: number;
    /** 1 = raw Sky chroma; lower values neutralise the very saturated Preetham blue for diffuse light. */
    saturation: number;
    /** Below-horizon radiance as average ground albedo (null = legacy horizon haze below the horizon). */
    groundAlbedo: number | null;
    groundTint: number;
  };
  hemisphere: { sky: number; ground: number; intensity: number };
  exposure: number;
  fog: {
    /** 'exp2' = legacy FogExp2; 'height' = exponential height fog + far-distance fade. */
    kind: 'exp2' | 'height';
    /** null = derive from the displayed sky horizon (sky-model.horizonDisplayHex). */
    color: number | null;
    /** exp2: FogExp2 density. height: extinction per metre at `baseHeight`. */
    density: number;
    baseHeight: number;
    /** 1/m; extinction halves every ln2/falloff metres of height. */
    falloff: number;
    /** View distance (m) over which everything fades fully into the fog colour. */
    edgeNear: number;
    edgeFar: number;
  };
  shadow: {
    /** Single-map half extent (m), map size, biases. */
    singleReach: number;
    singleMapSize: number;
    bias: number;
    normalBias: number;
    radius: number;
    /** Snap the single map to light-space texels (removes shimmer while walking). */
    texelSnap: boolean;
  };
}

export const LEGACY_LIGHTING: LightingPreset = {
  id: 'legacy',
  sun: { direction: [80, 105, 45] },
  sunColor: 0xfff0d6,
  sunIntensity: 3.3,
  sky: { turbidity: 2.3, rayleigh: 1.5, mieCoefficient: 0.003, mieDirectionalG: 0.8, visibleGain: 1, cloudCoverage: 0.4 },
  environment: { intensity: 0.25, saturation: 1, groundAlbedo: null, groundTint: 0x8a7f62 },
  hemisphere: { sky: 0xdde3e8, ground: 0x665e44, intensity: 0.55 },
  exposure: 0.88,
  fog: { kind: 'exp2', color: 0xb5ced9, density: 0.00065, baseHeight: 0, falloff: 0, edgeNear: 0, edgeFar: 0 },
  shadow: { singleReach: 28, singleMapSize: 4096, bias: -0.000015, normalBias: 0.008, radius: 1, texelSnap: false },
};

export const AUSTIN_LATE_MORNING: LightingPreset = {
  id: 'austin-late-morning',
  // Autumn equinox, 10:45 CDT: elevation 41.9 deg, azimuth 121.2 deg (ESE).
  // Close to the legacy direction (48.8 / 119.4) so authored shading stays familiar.
  sun: { time: '2026-09-23T10:45:00-05:00' },
  sunColor: 0xfff3e6,
  sunIntensity: 4.6,
  sky: { turbidity: 3, rayleigh: 2.5, mieCoefficient: 0.004, mieDirectionalG: 0.8, visibleGain: 0.2, cloudCoverage: 0 },
  environment: { intensity: 0.17, saturation: 0.4, groundAlbedo: 0.18, groundTint: 0x8a7f62 },
  hemisphere: { sky: 0xdde3e8, ground: 0x665e44, intensity: 0.1 },
  exposure: 0.88,
  // Far fade pushed out from 1300-2050 m (the old world edge) so the downtown skyline (2.3-3.6 km from campus)
  // stays visible through the unchanged exponential height fog; it still ends inside the 4600 m far plane.
  fog: { kind: 'height', color: null, density: 0.00028, baseHeight: 0, falloff: 1 / 180, edgeNear: 3200, edgeFar: 4400 },
  shadow: { singleReach: 28, singleMapSize: 4096, bias: -0.000015, normalBias: 0.008, radius: 2, texelSnap: true },
};

export const LIGHTING_PRESETS: Record<string, LightingPreset> = {
  legacy: LEGACY_LIGHTING,
  'austin-late-morning': AUSTIN_LATE_MORNING,
};

export const DEFAULT_LIGHTING_PRESET = 'austin-late-morning';
export const DEFAULT_SHADOW_MODE: ShadowMode = 'single';
