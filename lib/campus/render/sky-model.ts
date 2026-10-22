// Dependency-free CPU port of the three r185 `Sky` (Preetham) shader without
// clouds, plus three's ACES Filmic curve and the sRGB transfer. Used to derive
// fog colour and environment balance at runtime and by Node calibration checks,
// so the numbers in HANDOFF.md are reproducible without a browser.

export interface SkyParameters {
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
}

export type Rgb = [number, number, number];

const TOTAL_RAYLEIGH: Rgb = [5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5];
const MIE_CONST: Rgb = [1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14];

/** Linear radiance of the r185 Sky shader (sun disc and clouds excluded). */
export function skyRadiance(direction: readonly number[], sun: readonly number[], p: SkyParameters): Rgb {
  const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len = Math.hypot(direction[0], direction[1], direction[2]) || 1;
  const dir = [direction[0] / len, direction[1] / len, direction[2] / len];
  const zc = Math.max(-1, Math.min(1, sun[1]));
  const sunE = 1000 * Math.max(0, 1 - Math.exp(-((1.6110731556870734 - Math.acos(zc)) / 1.5)));
  // vSunfade is exactly 1 for any sun above the horizon (sunPosition.y > 0).
  const betaR = TOTAL_RAYLEIGH.map(v => v * p.rayleigh);
  const c = (0.2 * p.turbidity) * 10E-18;
  const betaM = MIE_CONST.map(v => 0.434 * c * v * p.mieCoefficient);
  const zenith = Math.acos(Math.max(0, dir[1]));
  const inverse = 1 / (Math.cos(zenith) + 0.15 * Math.pow(93.885 - zenith * 180 / Math.PI, -1.253));
  const sR = 8.4E3 * inverse, sM = 1.25E3 * inverse;
  const cosTheta = dot(dir, sun);
  const rPhase = 0.05968310365946075 * (1 + Math.pow(cosTheta * 0.5 + 0.5, 2));
  const g = p.mieDirectionalG, g2 = g * g;
  const mPhase = 0.07957747154594767 * ((1 - g2) / Math.pow(1 - 2 * g * cosTheta + g2, 1.5));
  const fade = Math.min(1, Math.max(0, Math.pow(1 - sun[1], 5)));
  const out: Rgb = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const fex = Math.exp(-(betaR[i] * sR + betaM[i] * sM));
    const ratio = (betaR[i] * rPhase + betaM[i] * mPhase) / (betaR[i] + betaM[i]);
    let lin = Math.pow(sunE * ratio * (1 - fex), 1.5);
    lin *= (1 - fade) + fade * Math.pow(sunE * ratio * fex, 0.5);
    out[i] = (lin + 0.1 * fex) * 0.04 + [0, 0.0003, 0.00075][i];
  }
  return out;
}

/** three r185 ACESFilmicToneMapping (GLSL port), input linear, output linear display. */
export function acesFilmic(color: readonly number[], exposure: number): Rgb {
  const x = color.map(v => v * exposure / 0.6);
  const inM = [[0.59719, 0.07600, 0.02840], [0.35458, 0.90834, 0.13383], [0.04823, 0.01566, 0.83777]];
  const outM = [[1.60475, -0.10208, -0.00327], [-0.53108, 1.10813, -0.07276], [-0.07367, -0.00605, 1.07602]];
  const mul = (m: number[][], v: readonly number[]) =>
    [0, 1, 2].map(r => m[0][r] * v[0] + m[1][r] * v[1] + m[2][r] * v[2]);
  const fitted = mul(inM, x).map(a => (a * (a + 0.0245786) - 0.000090537) / (a * (0.983729 * a + 0.4329510) + 0.238081));
  return mul(outM, fitted).map(a => Math.min(1, Math.max(0, a))) as Rgb;
}

export const linearToSrgb8 = (c: readonly number[]): Rgb =>
  c.map(a => Math.round(255 * Math.min(1, Math.max(0, a <= 0.0031308 ? 12.92 * a : 1.055 * Math.pow(a, 1 / 2.4) - 0.055)))) as Rgb;

export const srgbHexToLinear = (hex: number): Rgb =>
  [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map(c => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }) as Rgb;

export const luminance = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** Displayed sRGB (0–255) of the visible sky after a radiance gain, ACES and encoding. */
export function displayedSky(direction: readonly number[], sun: readonly number[], p: SkyParameters, gain: number, exposure: number): Rgb {
  return linearToSrgb8(acesFilmic(skyRadiance(direction, sun, p).map(v => v * gain), exposure));
}

/** Mean displayed horizon colour (average of 8 azimuths at the given elevation), as a 0xRRGGBB number. */
export function horizonDisplayHex(sun: readonly number[], p: SkyParameters, gain: number, exposure: number, elevationDeg = 2.5): number {
  const e = elevationDeg * Math.PI / 180;
  const sum = [0, 0, 0];
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    const d = displayedSky([Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)], sun, p, gain, exposure);
    for (let j = 0; j < 3; j++) sum[j] += d[j] / 8;
  }
  return (Math.round(sum[0]) << 16) | (Math.round(sum[1]) << 8) | Math.round(sum[2]);
}

/** Cosine-weighted sky irradiance on a surface with normal `n` (upper hemisphere only, raw sky units). */
export function skyIrradiance(n: readonly number[], sun: readonly number[], p: SkyParameters, saturation = 1, samples = 2048): Rgb {
  const e: Rgb = [0, 0, 0];
  for (let k = 0; k < samples; k++) {
    const y = 1 - 2 * (k + 0.5) / samples, r = Math.sqrt(1 - y * y), phi = k * 2.399963229728653;
    if (y < 0) continue;
    const d = [Math.cos(phi) * r, y, Math.sin(phi) * r];
    const c = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
    if (c <= 0) continue;
    const l = skyRadiance(d, sun, p), lum = luminance(l);
    for (let j = 0; j < 3; j++) e[j] += (lum + saturation * (l[j] - lum)) * c * 4 * Math.PI / samples;
  }
  return e;
}
