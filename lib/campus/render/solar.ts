// Dependency-free solar geometry so Node checks and the browser share one
// implementation. NOAA general solar position approximation (fractional-year
// series for declination and equation of time); accuracy is roughly ±0.5° in
// elevation/azimuth, ample for choosing a plausible daylight direction.
// Campus axes: X = east, Y = up, Z = south.

export const CAMPUS_LATITUDE = 30.2861;
export const CAMPUS_LONGITUDE = -97.73716;

export interface SolarPosition {
  /** Degrees above the horizon. */
  elevationDeg: number;
  /** Degrees clockwise from true north (90 = east, 180 = south). */
  azimuthDeg: number;
}

const RAD = Math.PI / 180;

export function solarPosition(date: Date, latitude = CAMPUS_LATITUDE, longitude = CAMPUS_LONGITUDE): SolarPosition {
  const ms = date.getTime();
  if (!Number.isFinite(ms)) throw new Error('solarPosition: invalid date');
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((ms - start) / 86400000) + 1;
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const leap = (date.getUTCFullYear() % 4 === 0 && date.getUTCFullYear() % 100 !== 0) || date.getUTCFullYear() % 400 === 0;
  const gamma = (2 * Math.PI / (leap ? 366 : 365)) * (dayOfYear - 1 + (hour - 12) / 24);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  // True solar time in minutes (UTC clock, longitude east-positive).
  const trueSolar = hour * 60 + eqTime + 4 * longitude;
  const hourAngle = (trueSolar / 4 - 180) * RAD;
  const lat = latitude * RAD;
  const cosZenith = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZenith)));
  // Azimuth clockwise from north.
  const azimuth = Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat),
  ) + Math.PI;
  return { elevationDeg: 90 - zenith / RAD, azimuthDeg: ((azimuth / RAD) % 360 + 360) % 360 };
}

/** Unit vector from the ground toward the sun in campus axes (X east, Y up, Z south). */
export function sunDirection({ elevationDeg, azimuthDeg }: SolarPosition): [number, number, number] {
  const el = elevationDeg * RAD, az = azimuthDeg * RAD;
  const horizontal = Math.cos(el);
  return [Math.sin(az) * horizontal, Math.sin(el), -Math.cos(az) * horizontal];
}

/** Inverse of sunDirection, for reporting an arbitrary direction. */
export function directionToSolar([x, y, z]: readonly [number, number, number]): SolarPosition {
  const length = Math.hypot(x, y, z);
  if (!(length > 0)) throw new Error('directionToSolar: zero vector');
  const elevationDeg = Math.asin(y / length) / RAD;
  const azimuthDeg = ((Math.atan2(x, -z) / RAD) % 360 + 360) % 360;
  return { elevationDeg, azimuthDeg };
}
