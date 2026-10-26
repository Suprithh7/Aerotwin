// Engine-out glide range shown on the stage map. Radius is height above the
// sampled terrain times the airframe L/D; the circle is shifted downwind by the
// drift accumulated during the glide. Terrain masking is not modelled.
import { GLIDE_RATIO } from '../nav/alternates';
import { destinationPoint } from '../mission/geometry';
import type { HudState } from './presentation';

export interface GlideRing {
  lat: number;
  lon: number;
  radiusM: number;
}

/** Height above ground in metres to still-air engine-out range in metres. */
export function glideRangeM(aglM: number): number {
  return Math.max(0, aglM) * GLIDE_RATIO;
}

/**
 * The ring appears only with a warning/critical diagnosis and either no
 * reachable alternate or a forced glide (the best option is engine-out).
 */
export function glideRingVisible(
  state: HudState,
  alternateReachable: boolean,
  glideMode = false,
): boolean {
  return (state === 'WARNING' || state === 'CRITICAL') && (!alternateReachable || glideMode);
}

/** Time to descend the glide, using the current phase's airspeed. */
export function glideTimeS(radiusM: number, speedMs: number): number {
  if (!(speedMs > 0)) return 0;
  return Math.max(0, radiusM) / speedMs;
}

/**
 * Centre of the engine-out range: the aircraft, moved downwind by the drift
 * accumulated over the glide. Returns null when there is no height to trade.
 */
export function glideRing(
  lat: number,
  lon: number,
  altM: number,
  terrainElevM: number,
  windDirDeg: number,
  windSpdMs: number,
  speedMs: number,
): GlideRing | null {
  const radiusM = glideRangeM(altM - terrainElevM);
  if (!(radiusM > 0)) return null;
  const timeS = glideTimeS(radiusM, speedMs);
  const towardDeg = (windDirDeg + 180) % 360;
  const driftM = Math.max(0, windSpdMs) * timeS;
  const center = destinationPoint(lat, lon, towardDeg, driftM);
  return { lat: center.lat, lon: center.lon, radiusM };
}
