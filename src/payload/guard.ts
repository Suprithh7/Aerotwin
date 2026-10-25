// Data Guard decision table. Pure inputs in, decision out; the session owns the
// clock and performs the erase. A sensor fault never escalates, a friendly
// landing keeps the data encrypted onboard, and erase needs both an engine
// fault and a predicted loss inside the denied area.
import { GLIDE_RATIO, type AlternateRow } from '../nav/alternates';
import { airfieldLabel } from '../data/airfields';
import { REHEARSAL_SIM_SPAN_S } from '../rehearsal/clock';
import type { MissionZone } from '../mission/types';
import type { OffloadFit } from './offload';
import type { GuardState, LinkState } from './types';

/** Time-to-loss cushion that triggers the erase; assumption in ASSUMPTIONS.md. */
export const ERASE_TIME_MARGIN_S = 20;
/** Stand-in for a real mission-clock conversion of the compressed RUL horizon. */
export function rulP10MissionS(
  p10SimS: number | null,
  totalMissionS: number,
): number | null {
  if (p10SimS === null || !Number.isFinite(p10SimS) || !(totalMissionS > 0)) return null;
  return Math.max(0, p10SimS) * (totalMissionS / REHEARSAL_SIM_SPAN_S);
}

export function glideTimeS(altM: number, tasMs: number): number {
  if (!(tasMs > 0)) return 0;
  return Math.max(0, altM) * GLIDE_RATIO / tasMs;
}

/** Mission seconds to the predicted loss; the RUL horizon or glide, whichever is sooner. */
export function timeToLossMissionS(rulMissionS: number | null, glideS: number): number {
  const g = Number.isFinite(glideS) ? Math.max(0, glideS) : 0;
  if (rulMissionS === null || !Number.isFinite(rulMissionS)) return g;
  return Math.max(0, Math.min(rulMissionS, g));
}

/** Ray casting on a closed [lon, lat] ring. */
export function pointInPolygon(lon: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** True when the point lies inside any mission zone (denied or restricted). */
export function insideDeniedZone(
  zones: Pick<MissionZone, 'polygon'>[] | undefined,
  lat: number,
  lon: number,
): boolean {
  return zones ? zones.some((zone) => pointInPolygon(lon, lat, zone.polygon)) : false;
}

/**
 * A field counts as a friendly landing when the range verdict is REACHABLE and
 * the engine-life margin does not contradict it. If the RUL is not available
 * yet, the field must also lie outside the predicted-loss denied area: with no
 * life estimate, a range-only reachable field is not enough when the aircraft
 * is forecast to come down in denied territory.
 */
export function recoverableAlternate(
  rows: AlternateRow[],
  predictedInsideDenied: boolean,
): AlternateRow | null {
  for (const row of rows) {
    if (row.verdict !== 'REACHABLE') continue;
    if (row.rulMarginS !== null && row.rulMarginS < 0) continue;
    if (row.rulMarginS === null && predictedInsideDenied) continue;
    return row;
  }
  return null;
}

function fmtMB(mb: number): string {
  return String(Math.max(0, Math.round(mb)));
}

/** "4m12s" style, used in the plain-language reasons. */
export function fmtSpanS(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return `${m}m${String(s % 60).padStart(2, '0')}s`;
}

function transferSentence(pendingMB: number, collectedMB: number): string {
  if (collectedMB <= 0) return 'No recon data has been collected yet.';
  if (pendingMB <= 1e-6) return `All ${fmtMB(collectedMB)} MB is at the ground station.`;
  return `Sending ${fmtMB(pendingMB)} MB of ${fmtMB(collectedMB)} MB, priority 1 first.`;
}

function armedTransferSentence(
  input: GuardInput,
  timeToLossS: number,
): string {
  const pending = input.pendingMB;
  if (input.collectedMB <= 0) return 'No recon data has been collected yet.';
  if (pending <= 1e-6) return `All ${fmtMB(input.collectedMB)} MB is at the ground station.`;
  const required = Number.isFinite(input.offloadFit.requiredS)
    ? `${fmtSpanS(input.offloadFit.requiredS)} of transfer needed`
    : 'no usable link';
  if (input.offloadFit.fitsAll) {
    return `Sending ${fmtMB(pending)} MB of ${fmtMB(input.collectedMB)} MB, priority 1 first; all pending data fits in ${fmtSpanS(timeToLossS)}.`;
  }
  return `Sending ${fmtMB(pending)} MB of ${fmtMB(input.collectedMB)} MB, priority 1 first; ${fmtMB(input.offloadFit.fittingMB)} MB in ${input.offloadFit.fittingItems} items fits before predicted loss (${required}).`;
}

export interface GuardInput {
  sensorOnly: boolean;
  /** A twin-named engine fault is active (not a sensor fault, not limit-only). */
  engineFault: boolean;
  /** Plain sentence naming the engine fault, e.g. "Cooling failure on CYL 3." */
  faultText: string;
  /** RUL P10 already converted to mission seconds; null while unavailable. */
  rulP10MissionS: number | null;
  glideS: number;
  currentInsideDenied: boolean;
  predictedInsideDenied: boolean;
  linkState: LinkState;
  pendingMB: number;
  collectedMB: number;
  /** Rate x time-to-loss, and the whole priority items it can carry. */
  offloadFit: OffloadFit;
  alternates: AlternateRow[];
  remoteZeroize: boolean;
  forcedLandingInDenied: boolean;
  priorState: GuardState;
  priorEraseReason: string | null;
}

export interface GuardDecision {
  state: GuardState;
  reason: string;
  action: 'NONE' | 'ZEROIZE';
  eraseReason: string | null;
  timeToLossS: number;
  recoverableIcao: string | null;
}

function terminal(input: GuardInput): GuardDecision {
  return {
    state: 'ZEROIZED',
    reason: input.priorEraseReason ?? 'Session key destroyed; onboard data unreadable.',
    action: 'NONE',
    eraseReason: null,
    timeToLossS: timeToLossMissionS(input.rulP10MissionS, input.glideS),
    recoverableIcao: null,
  };
}

function eraseTrigger(input: GuardInput, timeToLossS: number): string | null {
  if (input.remoteZeroize) return 'Operator remote zeroize confirmed.';
  if (input.forcedLandingInDenied) return 'Forced landing begins inside the denied area.';
  if (input.linkState === 'JAMMED') {
    return `Datalink jammed before the payload was secured; ${fmtMB(input.pendingMB)} MB was still onboard.`;
  }
  if (input.linkState === 'LOST') {
    return `Datalink lost before the payload was secured; ${fmtMB(input.pendingMB)} MB was still onboard.`;
  }
  if (timeToLossS < ERASE_TIME_MARGIN_S) {
    return `Predicted loss in ${fmtSpanS(timeToLossS)}, inside the ${ERASE_TIME_MARGIN_S} s erase margin.`;
  }
  if (input.pendingMB <= 1e-6 && input.collectedMB > 0) {
    return `Offload finished; all ${fmtMB(input.collectedMB)} MB was at the ground station.`;
  }
  return null;
}

export function decideGuard(input: GuardInput): GuardDecision {
  if (input.priorState === 'ZEROIZED') return terminal(input);

  const timeToLossS = timeToLossMissionS(input.rulP10MissionS, input.glideS);
  const noEngineFault: GuardDecision = {
    state: 'MONITOR',
    reason: input.sensorOnly
      ? 'Sensor fault only; engine healthy. Data Guard stays in monitor.'
      : 'No engine fault. Data Guard stays in monitor; data follows the link.',
    action: 'NONE',
    eraseReason: null,
    timeToLossS,
    recoverableIcao: null,
  };
  if (input.sensorOnly || !input.engineFault) return noEngineFault;

  const reachable = recoverableAlternate(input.alternates, input.predictedInsideDenied);
  if (reachable) {
    return {
      state: 'STANDBY',
      reason: `${input.faultText} ${airfieldLabel(reachable.airfield)} is reachable. Data stays encrypted onboard and offload continues.`,
      action: 'NONE',
      eraseReason: null,
      timeToLossS,
      recoverableIcao: reachable.airfield.icao,
    };
  }

  if (input.predictedInsideDenied) {
    const eraseReason = eraseTrigger(input, timeToLossS);
    if (eraseReason) {
      return {
        state: 'ZEROIZED',
        reason: eraseReason,
        action: 'ZEROIZE',
        eraseReason,
        timeToLossS,
        recoverableIcao: null,
      };
    }
    const overArea = input.currentInsideDenied ? ' The aircraft is already over the area.' : '';
    return {
      state: 'ARMED',
      reason: `${input.faultText} No friendly landing reachable. Predicted loss inside the denied area in ${fmtSpanS(timeToLossS)}.${overArea} ${armedTransferSentence(input, timeToLossS)}`,
      action: 'NONE',
      eraseReason: null,
      timeToLossS,
      recoverableIcao: null,
    };
  }

  return {
    state: 'OFFLOAD_PRIORITY',
    reason: `${input.faultText} No friendly landing reachable. Predicted loss is outside the denied area. ${transferSentence(input.pendingMB, input.collectedMB)}`,
    action: 'NONE',
    eraseReason: null,
    timeToLossS,
    recoverableIcao: null,
  };
}
