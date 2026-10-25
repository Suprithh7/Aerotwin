// Debrief metrics and plain-language summaries. All numbers shown to the crew
// are computed from the simulation or the Monte Carlo result; this module only
// formats them.
import type { Factor } from '../mission/monteCarlo';
import type { WaypointWeather } from '../mission/weather';
import { CHT_NOMINAL_C } from '../sim/limits';
import { REHEARSAL_SIM_SPAN_S, fmtClock, fmtMmSs } from './clock';
import type { DebriefResult, Outcome, RehearsalEvent, TimelineTick } from './types';
import type { DataGuardDebrief } from '../payload/types';

/**
 * Life model: one hour at or below the nominal CHT band consumes one hour of
 * the assumed overhaul life; hotter running consumes exponentially more. The
 * 1200 h overhaul life is the public Rotax 914 figure (ASSUMPTIONS.md).
 */
export const ENGINE_OVERHAUL_H = 1200;
export const LIFE_TEMP_SCALE_C = 15;

export function lifeWeight(maxChtC: number): number {
  return Math.max(1, Math.exp((maxChtC - CHT_NOMINAL_C) / LIFE_TEMP_SCALE_C));
}

/** Equivalent mission seconds consumed in one simulation step. */
export function lifeDoseIncrement(
  simDtS: number,
  missionS: number,
  maxChtC: number,
): number {
  if (!(simDtS > 0) || !(missionS > 0)) return 0;
  const compression = missionS / REHEARSAL_SIM_SPAN_S;
  return simDtS * compression * lifeWeight(maxChtC);
}

export function lifePct(doseMissionS: number): number {
  return (Math.max(0, doseMissionS) / 3600 / ENGINE_OVERHAUL_H) * 100;
}

const COMPASS = [
  'north',
  'north-east',
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
];

function directionName(deg: number): string {
  const i = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return COMPASS[i];
}

function signedC(v: number): string {
  return `${v >= 0 ? '+' : ''}${Math.round(v)}`;
}

/** One plain sentence built only from the selected weather cells. */
export function weatherSentence(cells: WaypointWeather[], lead = 'Forecast'): string {
  if (!cells.length) return 'No weather inputs are set for this route.';
  const isas = cells.map((c) => c.isaDevC);
  const isaMin = Math.min(...isas);
  const isaMax = Math.max(...isas);
  const isa =
    isaMin === isaMax
      ? `air temperature ${Math.abs(Math.round(isaMin))} C ${isaMin >= 0 ? 'above' : 'below'} ISA`
      : `air temperature ${signedC(isaMin)} to ${signedC(isaMax)} C relative to ISA`;
  const spds = cells.map((c) => c.windSpdMs);
  const spdMin = Math.round(Math.min(...spds));
  const spdMax = Math.round(Math.max(...spds));
  const wind = spdMin === spdMax ? `${spdMin} m/s` : `${spdMin} to ${spdMax} m/s`;
  const meanDir = cells.reduce((s, c) => s + c.windDirDeg, 0) / cells.length;
  const turbOrder = ['none', 'light', 'moderate', 'severe'];
  const turb = cells.reduce(
    (best, c) => (turbOrder.indexOf(c.turb) > turbOrder.indexOf(best) ? c.turb : best),
    'none',
  );
  return `${lead}: ${isa}, wind ${wind} from the ${directionName(meanDir)}, ${turb} turbulence at the worst point.`;
}

const FACTOR_NOUN: Record<string, string> = {
  'CRUISE DENSITY ALTITUDE': 'cruise density altitude',
  'ISA DEVIATION': 'ISA temperature',
  'PEAK HEADWIND': 'peak headwind',
  'TURBULENCE EXPOSURE': 'turbulence exposure',
  'STATION-KEEPING TIME': 'station-keeping time',
  'MISSION DURATION': 'mission duration',
  'DEGRADATION GROWTH': 'fault growth',
  'START SEVERITY': 'starting severity',
  'WIND SPEED': 'mean wind speed',
};

const FACTOR_UNIT: Record<string, { text: string; digits: number }> = {
  m: { text: 'm', digits: 0 },
  degC: { text: 'C', digits: 0 },
  'm/s': { text: 'm/s', digits: 1 },
  index: { text: 'index points', digits: 2 },
  h: { text: 'h', digits: 1 },
  'sev/h': { text: 'severity points per hour', digits: 2 },
  frac: { text: 'severity fraction', digits: 2 },
};

/** A Monte Carlo factor as a plain sentence with labelled units. */
export function factorSentence(factor: Factor): string {
  const noun = FACTOR_NOUN[factor.label] ?? factor.label.toLowerCase();
  if (!Number.isFinite(factor.meanFail) || !Number.isFinite(factor.meanPass)) {
    return `No clear separation in ${noun}.`;
  }
  const unit = FACTOR_UNIT[factor.unit] ?? { text: factor.unit, digits: 1 };
  const diff = factor.meanFail - factor.meanPass;
  if (Math.abs(diff) < 10 ** -unit.digits / 2) {
    return `Failed and successful runs had similar ${noun}.`;
  }
  const amount = Math.abs(diff).toFixed(unit.digits);
  return `Failed runs averaged ${amount} ${unit.text} ${diff > 0 ? 'more' : 'less'} ${noun}.`;
}

export function outcomeHeadline(outcome: Outcome): string {
  if (outcome === 'complete') return 'MISSION COMPLETE';
  if (outcome === 'aborted') return 'MISSION ABORTED';
  return 'AIRCRAFT LOST';
}

export interface BuildDebriefInput {
  outcome: Outcome;
  plannedS: number;
  missionS: number;
  flightS: number;
  distanceM: number;
  lifeDoseS: number;
  events: RehearsalEvent[];
  flagS: number | null;
  limitS: number | null;
  limitLabel: string | null;
  sensorOnly: boolean;
  dataGuard?: DataGuardDebrief;
}

function computedLine(input: BuildDebriefInput): string {
  const { flagS, limitS, limitLabel, sensorOnly, outcome } = input;
  if (sensorOnly) {
    return 'Twin held the instrument fault at advisory; no engine limit was reached.';
  }
  if (flagS !== null && limitS !== null && limitS >= flagS) {
    return `Twin flagged the fault ${fmtMmSs(limitS - flagS)} before the ${
      limitLabel ?? 'engine'
    } limit.`;
  }
  if (limitS !== null) {
    return `The ${limitLabel ?? 'engine'} limit was reached before the twin could flag a fault.`;
  }
  if (flagS !== null) {
    return outcome === 'complete'
      ? `Twin flagged the fault at T+${fmtClock(flagS)}; no engine limit was reached before landing.`
      : `Twin flagged the fault at T+${fmtClock(flagS)}; no engine limit was recorded.`;
  }
  if (outcome === 'complete') {
    return 'Twin flagged no fault before landing.';
  }
  return 'The rehearsal ended without a recorded limit.';
}

export function buildDebrief(input: BuildDebriefInput): DebriefResult {
  const ticks: TimelineTick[] = input.events
    .filter((e) => e.tick)
    .map((e) => ({ missionS: Math.max(0, Math.min(input.flightS, e.missionS)), label: e.label }))
    .sort((a, b) => a.missionS - b.missionS);
  return {
    outcome: input.outcome,
    plannedS: input.plannedS,
    missionS: input.missionS,
    flightS: input.flightS,
    distanceKm: Math.max(0, input.distanceM) / 1000,
    engineLifePct: lifePct(input.lifeDoseS),
    lifeEqH: Math.max(0, input.lifeDoseS) / 3600,
    leadLine: computedLine(input),
    sensorOnly: input.sensorOnly,
    ticks,
    ...(input.dataGuard ? { dataGuard: input.dataGuard } : {}),
  };
}
