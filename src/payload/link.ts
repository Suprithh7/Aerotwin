// Simulated line-of-sight datalink to the mission's ground station. The radio
// horizon is a smooth-earth approximation and terrain masking is not modelled
// (see README/ASSUMPTIONS). Jamming is modelled as an absolute loss of rate.
import { distanceM } from '../mission/route';
import type { GroundStation } from '../mission/types';
import type { LinkStatus } from './types';

// --- assumptions (see ASSUMPTIONS.md) ---
export const MAX_LINK_RANGE_KM = 250;
export const MAX_RATE_MBPS = 2;
export const MIN_RATE_MBPS = 0.2;
export const GROUND_ANTENNA_M = 10;
export const HORIZON_COEFFICIENT = 4.12;
/** Manual link degradation offered by the instructor station. */
export const LINK_DEGRADE_FACTOR = 0.25;

/** Smooth-earth radio horizon in km for heights in metres. */
export function radioHorizonKm(uavAltM: number, gsAltM = GROUND_ANTENNA_M): number {
  return HORIZON_COEFFICIENT * (Math.sqrt(Math.max(0, uavAltM)) + Math.sqrt(Math.max(0, gsAltM)));
}

export interface LinkInput {
  lat: number;
  lon: number;
  altM: number;
  gs: GroundStation;
  jammed: boolean;
  /** Instructor-imposed rate reduction to LINK_DEGRADE_FACTOR of the link. */
  degraded?: boolean;
}

/**
 * Rate is the maximum inside 20 % of range, then falls linearly to the minimum
 * at the range edge and is zero beyond it. Jamming wins over every geometry.
 */
export function linkStatus(input: LinkInput): LinkStatus {
  const distanceKm = distanceM(input.lat, input.lon, input.gs.lat, input.gs.lon) / 1000;
  const horizonKm = radioHorizonKm(input.altM);
  const rangeKm = Math.min(MAX_LINK_RANGE_KM, horizonKm);
  const fraction = rangeKm > 0 ? distanceKm / rangeKm : Infinity;

  if (input.jammed) {
    return { state: 'JAMMED', rateMbps: 0, rangeKm, horizonKm, distanceKm, fraction };
  }
  if (!(rangeKm > 0) || distanceKm > rangeKm) {
    return { state: 'LOST', rateMbps: 0, rangeKm, horizonKm, distanceKm, fraction };
  }
  const scale = input.degraded ? LINK_DEGRADE_FACTOR : 1;
  if (fraction <= 0.2) {
    return {
      state: input.degraded ? 'DEGRADED' : 'UP',
      rateMbps: MAX_RATE_MBPS * scale,
      rangeKm,
      horizonKm,
      distanceKm,
      fraction,
    };
  }
  const t = Math.min(1, (fraction - 0.2) / 0.8);
  const rateMbps = Math.max(MIN_RATE_MBPS, MAX_RATE_MBPS - (MAX_RATE_MBPS - MIN_RATE_MBPS) * t);
  return { state: 'DEGRADED', rateMbps: rateMbps * scale, rangeKm, horizonKm, distanceKm, fraction };
}
