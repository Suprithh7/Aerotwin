import { describe, expect, it } from 'vitest';
import {
  JUDGE_FALLBACK_S,
  JUDGE_GUARD_HOLD_S,
  JUDGE_HOLD_S,
  JUDGE_SCENARIO,
  JUDGE_SEED,
  JUDGE_STEPS,
  judgeProgress,
  judgeStatus,
  type JudgeDetection,
} from '../judge';
import {
  buildEvidence,
  detectionNote,
  detectionValue,
  eraseValue,
  evidenceLines,
  evidenceNarrative,
  recoveryValue,
} from '../evidence';
import { buildDebrief } from '../metrics';
import type { DebriefResult } from '../types';
import type { DataGuardDebrief } from '../../payload/types';

const GUARD: DataGuardDebrief = {
  collectedMB: 120,
  securedMB: 96,
  onboardMB: 24,
  lostMB: 0,
  byPriority: [],
  eraseMissionS: 8000,
  eraseReason: 'Denied area',
  recovery: {
    status: 'FAILED',
    attempted: 12,
    failed: 12,
    atMs: 0,
    detail: 'authentication failed',
  },
  items: [],
  link: null,
};

function makeDebrief(patch: Partial<DebriefResult> = {}): DebriefResult {
  return {
    outcome: 'complete',
    plannedS: 24000,
    missionS: 24000,
    flightS: 24000,
    distanceKm: 500,
    engineLifePct: 0.002,
    lifeEqH: 0.024,
    leadLine: 'Twin flagged the fault 00:32 before the CHT limit.',
    sensorOnly: false,
    ticks: [],
    seed: JUDGE_SEED,
    judge: true,
    flagS: 6400,
    limitS: null,
    limitLabel: null,
    director: [
      {
        missionS: 0,
        label: 'Cooling, cylinder 3',
        scope: 'engine',
        surprise: false,
        detectedS: 32,
        detectedMissionS: 6400,
      },
    ],
    dataGuard: GUARD,
    ...patch,
  };
}

const OPTS = {
  missionName: 'Ladakh Valley Recon',
  scenarioTitle: 'Cooling over denied area',
  now: new Date('2026-10-26T12:00:00Z'),
};

const BASE = {
  detection: null,
  accelerated: false,
  guardState: null,
  guardReason: null,
  securedMB: 0,
  onboardMB: 0,
  eraseMissionS: null,
} as const;

describe('SIH judge mode', () => {
  it('pins the seed and scenario', () => {
    expect(JUDGE_SEED).toBe(20261026);
    expect(JUDGE_SCENARIO).toBe('cooling-denied');
    expect(JUDGE_STEPS).toHaveLength(5);
    expect(JUDGE_HOLD_S).toBe(8);
    expect(JUDGE_GUARD_HOLD_S).toBe(6);
    expect(JUDGE_FALLBACK_S).toBe(75);
  });

  it('walks from seed to fault to flag to guard to evidence', () => {
    expect(judgeStatus({ ...BASE, simT: 0.2 }).phase).toBe('armed');
    expect(judgeStatus({ ...BASE, simT: 5 }).phase).toBe('inject');
    expect(judgeStatus({ ...BASE, simT: 20 }).phase).toBe('diverge');

    const detection: JudgeDetection = { simS: 32, missionS: 6400, latencyS: 32 };
    const flag = judgeStatus({ ...BASE, simT: 33, detection });
    expect(flag.phase).toBe('flag');
    expect(flag.step).toBe(2);
    expect(flag.body).toContain('32 s');

    const guard = judgeStatus({
      ...BASE,
      simT: 32 + JUDGE_HOLD_S,
      detection,
      guardState: 'ARMED',
      securedMB: 40,
    });
    expect(guard.phase).toBe('guard');
    expect(guard.step).toBe(3);
    expect(guard.body).toContain('armed');

    const wrap = judgeStatus({
      ...BASE,
      simT: 50,
      detection,
      accelerated: true,
    });
    expect(wrap.phase).toBe('wrap');
    expect(wrap.step).toBe(4);
  });

  it('falls back when no twin flag arrives', () => {
    expect(judgeStatus({ ...BASE, simT: JUDGE_FALLBACK_S }).phase).toBe('noflag');
    expect(judgeProgress(0)).toBe(0);
    expect(judgeProgress(60)).toBeCloseTo(0.5, 10);
    expect(judgeProgress(200)).toBe(1);
  });

  it('builds the evidence card from the debrief', () => {
    const data = buildEvidence(makeDebrief(), OPTS);
    expect(data.seed).toBe(20261026);
    expect(data.detectionLatencyS).toBe(32);
    expect(data.detectionMissionS).toBe(6400);
    expect(detectionValue(data)).toBe('+32 s');
    expect(detectionNote(data)).toContain('T+1:46:40');
    expect(eraseValue(data)).toBe('T+2:13:20');
    expect(recoveryValue(data)).toBe('FAILED');
    expect(evidenceNarrative(data)).toContain('96 MB');
    expect(evidenceNarrative(data)).toContain('key was destroyed');

    const text = evidenceLines(data).join('\n');
    expect(text).toContain('Seed: 20261026');
    expect(text).toContain('Twin flagged the fault');
    expect(text).toContain('Synthetic data');
  });

  it('uses the mission flag when the director summary is missing', () => {
    const data = buildEvidence(makeDebrief({ director: [], flagS: 120 }), OPTS);
    expect(detectionValue(data)).toBe('FLAGGED');
    expect(detectionNote(data)).toContain('T+0:02:00');
  });

  it('handles a run with no flag, no payload and a reached limit', () => {
    const noFlag = buildEvidence(makeDebrief({ director: [], flagS: null }), OPTS);
    expect(detectionValue(noFlag)).toBe('NO FLAG');
    expect(detectionNote(noFlag)).toBe('no twin disagreement');

    const noPayload = buildEvidence(makeDebrief({ dataGuard: undefined }), OPTS);
    expect(eraseValue(noPayload)).toBe('N/A');
    expect(recoveryValue(noPayload)).toBe('N/A');
    expect(evidenceNarrative(noPayload)).toContain('No reconnaissance payload');

    const limited = buildEvidence(makeDebrief({ limitS: 9000, limitLabel: 'CHT' }), OPTS);
    expect(evidenceNarrative(limited)).toContain('CHT limit was reached');
  });

  it('carries judge metadata through the debrief builder', () => {
    const built = buildDebrief({
      outcome: 'complete',
      plannedS: 24000,
      missionS: 24000,
      flightS: 24000,
      distanceM: 500000,
      lifeDoseS: 0,
      events: [],
      flagS: 6400,
      limitS: null,
      limitLabel: null,
      sensorOnly: false,
      seed: JUDGE_SEED,
      judge: true,
    });
    expect(built.seed).toBe(JUDGE_SEED);
    expect(built.judge).toBe(true);
    expect(built.flagS).toBe(6400);
    expect(built.limitS).toBeNull();
    expect(built.limitLabel).toBeNull();
  });
});
