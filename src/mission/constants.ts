// Mission-layer assumptions. Every value here is an engineering assumption for
// this prototype and is listed in ASSUMPTIONS.md.
import type { TurbulenceLevel } from '../sim/types';

export type SegKindName = 'takeoff' | 'climb' | 'cruise' | 'loiter' | 'descent' | 'landing';

// Integration rate for headless mission runs. The live sim runs at 0.05 s;
// mission runs use 0.25 s, which keeps the Euler-integrated thermal and crank
// states stable (first-order lags use the analytic step).
export const MISSION_DT = 0.25;

// Assumed constant airspeeds per profile segment, m/s true airspeed.
export const MISSION_AIRSPEED = {
  takeoff: 30,
  climb: 45,
  cruise: 55,
  loiter: 35,
  descent: 50,
  landing: 25,
};

// Mission power schedule. propC is the sea-level propeller load constant,
// N m / (rad/s)^2; the runner scales it by the air density ratio of the
// current altitude so the same airspeed and rpm demand proportionally less
// torque as the air thins. The pair (rpmTarget, propC) therefore fixes the
// shaft power the airframe requires on that segment:
//   P = propC * sigma * (rpm * pi / 30)^3
// Sea-level values: takeoff 55 kW, climb 54 kW, cruise 45 kW, loiter 24 kW,
// descent 15 kW, landing 40 kW. The schedule is capped at the power the
// model's cooling envelope sustains at field elevation, not at the
// 75 kW rating; see ASSUMPTIONS.md. throttleBase is chosen so the governor
// floor (base - 0.3) sits just under the throttle that holds the target rpm
// against this load at sea level, keeping the schedule controllable from sea
// level to 6 km. afr only moves the throttle needed to hold the load, so each
// row pairs a mixture with the throttle band its load requires.
export interface MissionPower {
  rpmTarget: number;
  throttleBase: number;
  afr: number;
  propC: number;
}

export const MISSION_POWER: Record<SegKindName, MissionPower> = {
  takeoff: { rpmTarget: 2400, throttleBase: 0.58, afr: 13.4, propC: 3.6e-3 },
  climb: { rpmTarget: 2150, throttleBase: 0.62, afr: 14.5, propC: 4.7e-3 },
  cruise: { rpmTarget: 2100, throttleBase: 0.72, afr: 16.5, propC: 4.2e-3 },
  loiter: { rpmTarget: 1800, throttleBase: 0.5, afr: 17.0, propC: 3.7e-3 },
  descent: { rpmTarget: 1650, throttleBase: 0.32, afr: 17.5, propC: 2.9e-3 },
  landing: { rpmTarget: 2000, throttleBase: 0.62, afr: 14.5, propC: 4.4e-3 },
};

// Assumed constant vertical rates, m/s.
export const CLIMB_RATE_MS = 3.0;
export const DESCENT_RATE_MS = 5.0;

// Fixed-duration profile bookends, s. Takeoff is a short transient at rated
// power; the thermal limits are not applied during it (see ASSUMPTIONS.md).
export const TAKEOFF_S = 30;
export const LANDING_S = 120;

// Lowest groundspeed the profile planner will accept; below this a leg is
// flagged wind-limited rather than becoming infinite.
export const MIN_GROUNDSPEED_MS = 10;

// Mission fuel load (kg) and the reserve that must remain at landing.
export const MISSION_FUEL_KG = 95;
export const MISSION_RESERVE_KG = 12;

// Vibration is a mission-layer monitoring limit; thermal and oil limits live
// in src/sim/limits.ts so the sim, diagnosis and mission layers share one set.
export const VIB_LIMIT_MM_S = 5.0;
export const PWR_MARGIN_FRAC = 0.85; // minimum fraction of the healthy leg power

// Service ceiling, expressed as the highest density altitude at which the
// airframe is assumed able to hold level flight. This is a mission-planning
// rule, not part of the engine model: it is what makes a hot day at high
// altitude cost altitude rather than merely cost cooling margin.
// Calibrated against this atmosphere model: density altitude rises only about
// 10 m per degC of ISA deviation at 6 km (20 m/degC near the surface), so a
// 6.1 km cruise waypoint is 6100 m on a standard day and 6287 m at +18 degC.
export const CEILING_DENSITY_ALT_M = 6300;

// Monte Carlo
export const MC_MIN_RUNS = 200;
export const MC_JITTER_ISA_C = 5; // 1-sigma ISA deviation uncertainty
export const MC_JITTER_WIND_FRAC = 0.18; // 1-sigma relative wind-speed uncertainty
export const MC_JITTER_WIND_DIR_DEG = 12; // 1-sigma wind direction uncertainty
export const MC_TURB_UPGRADE_P = 0.2; // probability the turbulence level steps up
export const MC_TURB_DOWNGRADE_P = 0.15;
export const MC_WEAR_RATE_PER_H = 0.02; // nominal-wear prior mean, severity/h
export const MC_WEAR_SPREAD_PER_H = 0.03; // nominal-wear prior sigma
export const MC_GROWTH_REL_SIGMA = 0.5; // sigma when scaling an estimated slope
export const MC_GROWTH_MIN_ABS = 0.01;
export const MC_REFRESH_PARAMS_S = 60; // health refresh cadence, sim s

// Verdict thresholds on P(mission complete within limits).
export const GO_PROB = 0.9;
export const CAUTION_PROB = 0.75;
export const GO_MAX_LEG_RISK = 0.25;
export const CAUTION_MAX_LEG_RISK = 0.55;
export const GO_MIN_MARGIN_KG = 6;
export const CAUTION_MIN_MARGIN_KG = 0;

// Open-Meteo gust excess (gust minus mean wind, m/s) to turbulence level.
export const GUST_TO_TURB: { maxExcess: number; level: TurbulenceLevel }[] = [
  { maxExcess: 1.5, level: 'none' },
  { maxExcess: 3.5, level: 'light' },
  { maxExcess: 6.0, level: 'moderate' },
  { maxExcess: Infinity, level: 'severe' },
];
// Sustained mean wind that forces at least this level, regardless of gusts.
export const WIND_FLOOR_MODERATE_MS = 12;
export const WIND_FLOOR_SEVERE_MS = 17;

export const ISA_LAPSE_C_PER_KM = 6.5;
export const ISA_SL_TEMP_C = 15;

export function gustExcessToTurbulence(gustMs: number, meanMs: number): TurbulenceLevel {
  const excess = Math.max(0, gustMs - meanMs);
  let level: TurbulenceLevel = 'none';
  for (const band of GUST_TO_TURB) {
    if (excess <= band.maxExcess) {
      level = band.level;
      break;
    }
  }
  if (meanMs >= WIND_FLOOR_SEVERE_MS) level = 'severe';
  else if (meanMs >= WIND_FLOOR_MODERATE_MS && level !== 'severe') level = 'moderate';
  return level;
}

/** ISA standard-atmosphere temperature (deg C) at a given altitude, m AMSL. */
export function isaTempC(altM: number): number {
  return ISA_SL_TEMP_C - (ISA_LAPSE_C_PER_KM * altM) / 1000;
}
