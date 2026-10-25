// Alternate-airfield reachability. Every input is a live value: the aircraft
// state comes from the simulation, the wind from the mission weather layer and
// the engine-life margin from the diagnosis layer. Terrain clearance is NOT
// modelled - glide range is a still-air, obstacle-free figure (README.md).
import type { Airfield } from '../data/airfields';
import type { Phase } from '../sim/types';
import {
  MIN_GROUNDSPEED_MS,
  PWR_MARGIN_FRAC,
} from '../mission/constants';
import { requiredPowerKw } from '../mission/mission';
import { bearingDeg, distanceM, windComponents } from '../mission/route';

// --- assumptions (see ASSUMPTIONS.md) ---
/** Hold-out fuel reserved before diverting: 30 min at the current flow rate. */
export const ALTERNATE_RESERVE_S = 1800;
/** Mean-fuel-flow smoothing window used by the caller, sim s. */
export const FF_SMOOTH_WINDOW_S = 30;
/** Engine-out lift-to-drag ratio of the airframe. */
export const GLIDE_RATIO = 12;
/** Margin over the requirement that still counts as comfortably reachable. */
export const REACHABLE_MARGIN_FRAC = 0.2;

export type AltMode = 'POWERED' | 'GLIDE';
export type AltVerdict = 'REACHABLE' | 'MARGINAL' | 'NOT REACHABLE';
export type LimitingFactor = 'FUEL' | 'GLIDE' | 'ENGINE LIFE';

/** Aircraft and engine state at the point the alternates are evaluated. */
export interface NavState {
  lat: number;
  lon: number;
  altM: number; // altitude above mean sea level, m
  sigmaRatio: number; // air density ratio from the sim
  tasMs: number; // true airspeed, m/s
  shaftPowerKw: number; // shaft power the engine is delivering, kW
  phase: Phase;
  fuelKg: number; // fuel remaining, kg
  ffKgH: number; // smoothed fuel flow, kg/h
  windDirDeg: number; // meteorological: direction FROM
  windSpdMs: number;
  rulP10S: number | null; // diagnosis engine-life horizon, s (null = unknown)
}

export interface AlternateRow {
  airfield: Airfield;
  distM: number;
  bearingDeg: number;
  gsMs: number; // groundspeed held along that bearing in the current wind
  eteS: number;
  mode: AltMode;
  verdict: AltVerdict;
  limiting: LimitingFactor;
  marginFrac: number; // binding margin, fraction of the requirement
  poweredRangeM: number;
  glideRangeM: number;
  rangeM: number; // range in the active mode
  rulMarginS: number | null; // RUL P10 minus ETE, s
}

/** Power needed to hold level flight at the current density altitude. */
export function levelPowerRequiredKw(phase: Phase, sigmaRatio: number): number {
  return requiredPowerKw(phase, sigmaRatio);
}

/** Engine-out glide range over the ground from an altitude above a field. */
export function glideRangeM(altM: number, fieldElevM: number): number {
  return Math.max(0, altM - fieldElevM) * GLIDE_RATIO;
}

/** Reachable distance on the fuel left, after the hold-out reserve. */
export function poweredRangeM(fuelKg: number, ffKgH: number, gsMs: number): number {
  if (ffKgH <= 0 || gsMs <= 0) return 0;
  const enduranceS = (fuelKg / ffKgH) * 3600;
  return Math.max(0, enduranceS - ALTERNATE_RESERVE_S) * gsMs;
}

/** Groundspeed along a bearing: TAS less the headwind component, floored. */
export function gsOnBearing(tasMs: number, bearing: number, windDirDeg: number, windSpdMs: number): number {
  const { headwindMs } = windComponents(bearing, windDirDeg, windSpdMs);
  return Math.max(MIN_GROUNDSPEED_MS, tasMs - headwindMs);
}

function verdictOf(marginFrac: number): AltVerdict {
  if (marginFrac < 0) return 'NOT REACHABLE';
  return marginFrac >= REACHABLE_MARGIN_FRAC ? 'REACHABLE' : 'MARGINAL';
}

export function evaluateAlternate(ns: NavState, airfield: Airfield): AlternateRow {
  const distM = distanceM(ns.lat, ns.lon, airfield.lat, airfield.lon);
  const bearing = bearingDeg(ns.lat, ns.lon, airfield.lat, airfield.lon);
  const gsMs = gsOnBearing(ns.tasMs, bearing, ns.windDirDeg, ns.windSpdMs);
  const eteS = distM / gsMs;

  const required = levelPowerRequiredKw(ns.phase, ns.sigmaRatio);
  const powered = required <= 0 || ns.shaftPowerKw >= PWR_MARGIN_FRAC * required;
  const mode: AltMode = powered ? 'POWERED' : 'GLIDE';

  const pRange = poweredRangeM(ns.fuelKg, ns.ffKgH, gsMs);
  const gRange = glideRangeM(ns.altM, airfield.elevationM);
  const rangeM = mode === 'GLIDE' ? gRange : pRange;
  const marginFrac = distM > 0 ? (rangeM - distM) / distM : Infinity;

  const rulMarginS = ns.rulP10S === null ? null : ns.rulP10S - eteS;
  const rulMarginFrac = rulMarginS === null ? Infinity : rulMarginS / eteS;

  const limiting: LimitingFactor =
    rulMarginFrac <= marginFrac ? 'ENGINE LIFE' : mode === 'GLIDE' ? 'GLIDE' : 'FUEL';
  const binding = Math.min(marginFrac, rulMarginFrac);

  return {
    airfield,
    distM,
    bearingDeg: bearing,
    gsMs,
    eteS,
    mode,
    verdict: verdictOf(binding),
    limiting,
    marginFrac: binding,
    poweredRangeM: pRange,
    glideRangeM: gRange,
    rangeM,
    rulMarginS,
  };
}

export function computeAlternates(ns: NavState, airfields: Airfield[]): AlternateRow[] {
  return airfields
    .map((a) => evaluateAlternate(ns, a))
    .sort((p, q) => p.distM - q.distM);
}

/** Distance-sorted rows; the first is the nearest, reachable rows keep order. */
export function nearestReachable(rows: AlternateRow[]): AlternateRow | null {
  return rows.find((r) => r.verdict !== 'NOT REACHABLE') ?? null;
}

/**
 * Airfields an engine-out glide can reach from a point on the route. Used by the
 * Mission Risk per-leg table, where there is no live fuel figure to reason about.
 */
export function airfieldsInGlideRange(
  lat: number,
  lon: number,
  altM: number,
  airfields: Airfield[],
): Airfield[] {
  return airfields.filter((a) => distanceM(lat, lon, a.lat, a.lon) <= glideRangeM(altM, a.elevationM));
}

export function midPointLeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }): { lat: number; lon: number } {
  return { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
}
