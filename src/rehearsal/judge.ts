// SIH judge mode: a fixed-seed rehearsal with a small, deterministic narrative.
// The pure functions here turn simulation state into the caption shown on the
// FLY stage; the controller lives in judgeStore.ts so this module stays testable
// without a browser worker.
import { REHEARSAL_SIM_SPAN_S, fmtClock } from './clock';
import type { GuardState } from '../payload/types';
import type { ScenarioId } from './types';

export const JUDGE_SEED = 20261026;
export const JUDGE_SCENARIO: ScenarioId = 'cooling-denied';

/** Sim seconds to hold at 1x after the twin flags the fault. */
export const JUDGE_HOLD_S = 8;
/** Sim seconds to show the Data Guard outcome before accelerating. */
export const JUDGE_GUARD_HOLD_S = 6;
/** Sim seconds after which the run accelerates even without a detection. */
export const JUDGE_FALLBACK_S = 75;

export const JUDGE_STEPS = ['SEED', 'FAULT', 'TWIN FLAG', 'DATA GUARD', 'EVIDENCE'] as const;

export type JudgePhaseId =
  | 'armed'
  | 'inject'
  | 'diverge'
  | 'flag'
  | 'guard'
  | 'wrap'
  | 'noflag';

export type JudgeTone = 'info' | 'caution' | 'alert';

export interface JudgeDetection {
  simS: number;
  missionS: number;
  latencyS: number;
}

export interface JudgeInput {
  simT: number;
  detection: JudgeDetection | null;
  accelerated: boolean;
  guardState: GuardState | null;
  guardReason: string | null;
  securedMB: number;
  onboardMB: number;
  eraseMissionS: number | null;
}

export interface JudgeStatus {
  phase: JudgePhaseId;
  /** Index into JUDGE_STEPS. */
  step: number;
  title: string;
  body: string;
  tone: JudgeTone;
}

function mb(value: number): number {
  return Math.round(Math.max(0, value));
}

function guardBody(input: JudgeInput): string {
  if (input.eraseMissionS !== null) {
    return `Mission key erased at T+${fmtClock(input.eraseMissionS)}. Onboard data is unrecoverable; the adversary recovery attempt fails.`;
  }
  if (input.guardState === 'ARMED') {
    return `Data Guard is armed to erase the key if the aircraft enters the denied area. ${mb(input.securedMB)} MB already secured at ground.`;
  }
  if (input.guardState === 'OFFLOAD_PRIORITY') {
    return (
      input.guardReason ??
      `Offloading priority reconnaissance data before the denied area closes. ${mb(input.securedMB)} MB secured.`
    );
  }
  if (input.guardState === 'STANDBY') {
    return `No reachable alternate. Data stays encrypted onboard; ${mb(input.securedMB)} MB already at ground.`;
  }
  return `Data Guard monitoring. ${mb(input.securedMB)} MB secured at ground, ${mb(input.onboardMB)} MB encrypted onboard.`;
}

export function judgeStatus(input: JudgeInput): JudgeStatus {
  const simT = Math.max(0, input.simT);

  if (input.accelerated) {
    return {
      phase: 'wrap',
      step: 4,
      title: 'EVIDENCE CARD',
      body: 'Rehearsal accelerating to the destination. The debrief packages detection latency, Data Guard outcome and engine-life cost into an exportable evidence card.',
      tone: 'info',
    };
  }

  const detection = input.detection;
  if (!detection) {
    if (simT < 0.8) {
      return {
        phase: 'armed',
        step: 0,
        title: 'SEEDED RUN',
        body: `Seed ${JUDGE_SEED}. Twin and measured channels start from the same state; the route and weather are fixed for this run.`,
        tone: 'info',
      };
    }
    if (simT >= JUDGE_FALLBACK_S) {
      return {
        phase: 'noflag',
        step: 4,
        title: 'NO TWIN FLAG',
        body: 'No twin disagreement was recorded before the fallback point. The debrief will show the run as flown.',
        tone: 'alert',
      };
    }
    if (simT < 10) {
      return {
        phase: 'inject',
        step: 1,
        title: 'FAULT INJECTED',
        body: 'Cylinder 3 cooling loss, severity 0.60, 30 s ramp. The measured CHT starts to separate from the twin.',
        tone: 'caution',
      };
    }
    return {
      phase: 'diverge',
      step: 1,
      title: 'TWIN CONVERGING',
      body: 'Twin is accumulating evidence. No measured hard limit has been reached; watch the CHT 3 residual grow.',
      tone: 'caution',
    };
  }

  const since = Math.max(0, simT - detection.simS);
  if (since < JUDGE_HOLD_S) {
    const latency = Math.max(0, Math.round(detection.latencyS));
    return {
      phase: 'flag',
      step: 2,
      title: 'TWIN FLAG',
      body: `Twin flagged the fault ${latency} s after injection at T+${fmtClock(detection.missionS)}. Measured CHT is still inside limits.`,
      tone: 'caution',
    };
  }

  return {
    phase: 'guard',
    step: 3,
    title: 'DATA GUARD',
    body: guardBody(input),
    tone: input.eraseMissionS !== null ? 'alert' : 'caution',
  };
}

/** Fraction of the compressed rehearsal completed, 0..1. */
export function judgeProgress(simT: number): number {
  return Math.max(0, Math.min(1, simT / REHEARSAL_SIM_SPAN_S));
}
