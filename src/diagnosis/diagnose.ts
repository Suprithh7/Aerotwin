// Live diagnosis: match the smoothed residual z-vector against the signature
// library and classify the engine state. Ground truth (the injected fault list)
// is deliberately not read here - the diagnoser sees what the sensors see.
import { CHANNELS } from '../sim/constants';
import { CHT_LIMIT_C, OILP_MIN_BAR, OILT_LIMIT_C } from '../sim/limits';
import {
  estimateRul,
  RUL_HISTORY_S,
  RUL_SAMPLE_S,
  sevToLimit,
  type RulEstimate,
  type RulSample,
} from './rul';
import {
  channelIndexOf,
  nearestLibraryPhase,
  sigIndexKey,
  signaturesForPhase,
  type EngineSignature,
  type SignatureLibrary,
} from './signatures';
import type { Phase, Snapshot } from '../sim/types';

// --- assumptions (see ASSUMPTIONS.md) ---
/** Residual RMS (z units) below which the engine reads healthy. */
export const ANOMALY_MAG = 2;
/** Cosine similarity required before a signature is believed. */
export const MIN_CONFIDENCE = 0.4;
/** Severity at which a detected anomaly becomes an alert. */
export const WARN_SEVERITY = 0.2;
/** Severity at which the anomaly is treated as critical. */
export const CRIT_SEVERITY = 0.7;
/** Candidates reported per update. */
export const TOP_CANDIDATES = 3;
/** Severity-history refresh cadence for the RUL projection, sim s. */
export const RUL_RECOMPUTE_S = 5;
/** Engine-life P10 horizon that on its own makes the state critical, s. */
export const RUL_CRIT_P10_S = 900;

export type DiagState = 'NOMINAL' | 'WARNING' | 'CRITICAL';
export type AlertType = 'LIMIT' | 'FAULT';

/**
 * A LIMIT is a measured channel beyond its operating limit, independent of the
 * twin. A FAULT is a twin disagreement the signature library can name.
 */
export interface DiagAlert {
  type: AlertType;
  state: Exclude<DiagState, 'NOMINAL'>;
  text: string;
}

export interface LimitBreachInfo {
  channel: string;
  label: string;
  value: number;
  limit: number;
  unit: string;
  direction: 'above' | 'below';
}

export interface FaultCandidate {
  key: string; // `${kind}|${cylinder}`
  label: string;
  kind: string;
  cylinder: number;
  severity: number;
  confidence: number;
}

export interface Diagnosis {
  t: number;
  state: DiagState;
  ready: boolean; // signature library complete
  libraryNote: string;
  anomaly: number; // residual RMS, z units
  severity: number;
  confidence: number;
  dominant: FaultCandidate | null;
  candidates: FaultCandidate[];
  rul: RulEstimate | null;
  /** LIMIT and FAULT alerts, most severe first. */
  alerts: DiagAlert[];
  note: string;
}

export const NO_DIAGNOSIS: Diagnosis = {
  t: 0,
  state: 'NOMINAL',
  ready: false,
  libraryNote: 'SIGNATURE LIBRARY NOT BUILT',
  anomaly: 0,
  severity: 0,
  confidence: 0,
  dominant: null,
  candidates: [],
  rul: null,
  alerts: [],
  note: 'NO DIAGNOSIS',
};

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function norm(a: number[]): number {
  return Math.sqrt(dot(a, a));
}

export interface Fit {
  candidates: FaultCandidate[];
  anomaly: number;
}

/**
 * Severity implied by a live residual, read off the candidate's own simulated
 * response curve at that fault's peak channel. The engine model is strongly
 * non-linear in severity - the cooling templates move the affected head by
 * +2.9 C at 0.3, +20.6 C at 0.6 and +215 C at 1.0 - so scaling the
 * severity-1.0 template alone under-reads a mid-severity fault by an order of
 * magnitude. The peak channel is used rather than the whole-vector projection
 * because the library signatures of a cylinder fault are a single-channel
 * spike.
 */
function severityFromCurve(sig: EngineSignature, z: number[]): number {
  const index = channelIndexOf(sig.peakChannel);
  const c = CHANNELS[index];
  const hit = sevToLimit(sig.templates, index, c.noiseSigma, 0, z[index] * c.noiseSigma);
  return hit ? Math.max(0, Math.min(1.5, hit.sevReq)) : 0;
}

/**
 * Match the live EWMA residual z-vector against the phase's signatures. The
 * shape (cosine similarity) decides which fault; the displacement of the
 * signature's peak channel, read off that fault's response curve, decides
 * severity.
 */
export function fitSignatures(z: number[], lib: SignatureLibrary, phase: Phase): Fit {
  const anomaly = norm(z) / Math.sqrt(z.length);
  const candidates: FaultCandidate[] = [];
  const zv = norm(z);
  if (zv < 1e-9) return { candidates, anomaly };
  for (const sig of signaturesForPhase(lib, phase)) {
    const v = sig.sev1;
    const vv = dot(v, v);
    if (vv < 1e-9) continue;
    const proj = dot(z, v) / Math.sqrt(vv); // component of z along the signature
    if (!(proj > 0)) continue;
    const confidence = proj / zv;
    if (confidence < MIN_CONFIDENCE) continue;
    candidates.push({
      key: sig.key,
      label: sig.label,
      kind: sig.kind,
      cylinder: sig.cylinder,
      severity: severityFromCurve(sig, z),
      confidence,
    });
  }
  // Rank by shape match only. A template that absorbs more amplitude but has the
  // wrong shape would otherwise outrank the true fault.
  candidates.sort((p, q) => q.confidence - p.confidence || q.severity - p.severity);
  return { candidates: candidates.slice(0, TOP_CANDIDATES), anomaly };
}

/** Hard-limit checks on the measured values, independent of any signature fit. */
export function limitBreaches(snap: Snapshot): LimitBreachInfo[] {
  const r = snap.readings;
  const out: LimitBreachInfo[] = [];
  for (const c of CHANNELS) {
    if (!c.id.startsWith('cht')) continue;
    if (r[c.id].measured > CHT_LIMIT_C) {
      out.push({
        channel: c.id,
        label: c.label,
        value: r[c.id].measured,
        limit: CHT_LIMIT_C,
        unit: 'C',
        direction: 'above',
      });
    }
  }
  if (r.oilT.measured > OILT_LIMIT_C) {
    out.push({
      channel: 'oilT',
      label: 'Oil Temp',
      value: r.oilT.measured,
      limit: OILT_LIMIT_C,
      unit: 'C',
      direction: 'above',
    });
  }
  if (r.oilP.measured < OILP_MIN_BAR) {
    out.push({
      channel: 'oilP',
      label: 'Oil Press',
      value: r.oilP.measured,
      limit: OILP_MIN_BAR,
      unit: 'bar',
      direction: 'below',
    });
  }
  return out;
}

export function formatLimitBreach(b: LimitBreachInfo): string {
  const val = b.unit === 'bar' ? b.value.toFixed(2) : b.value.toFixed(1);
  const lim = b.unit === 'bar' ? b.limit.toFixed(2) : b.limit.toFixed(0);
  return `${b.label} ${b.direction} operating limit (${val} ${b.unit} / ${lim} ${b.unit})`;
}

export class Diagnoser {
  private samples: RulSample[] = [];
  private tracked: string | null = null;
  private lastSampleT = -Infinity;
  private lastRulT = -Infinity;
  private rul: RulEstimate | null = null;

  constructor(private lib: SignatureLibrary) {}

  setLibrary(lib: SignatureLibrary): void {
    this.lib = lib;
  }

  /** Deterministic update from one snapshot; safe to call every tick. */
  update(z: number[], twin: number[], snap: Snapshot, ready: boolean): Diagnosis {
    if (!ready) {
      return { ...NO_DIAGNOSIS, t: snap.t, libraryNote: 'SIGNATURE LIBRARY BUILDING' };
    }
    const { candidates, anomaly } = fitSignatures(z, this.lib, snap.phase);
    const top = candidates[0] ?? null;
    const breaches = limitBreaches(snap);
    const detected = !!top && anomaly >= ANOMALY_MAG && top.severity >= WARN_SEVERITY;
    // "Residual is small" is the same RMS gate the fault detector uses.
    const smallResidual = anomaly < ANOMALY_MAG;

    this.trackHistory(detected ? top : null, snap.t);
    const rul = this.projectRul(twin, snap, detected);

    const alerts: DiagAlert[] = breaches.map((b) => ({
      type: 'LIMIT',
      state: 'CRITICAL',
      text: `${formatLimitBreach(b)}.${!detected && smallResidual ? ' Engine behaving as modelled.' : ''}`,
    }));

    if (detected) {
      const critical =
        top!.severity >= CRIT_SEVERITY ||
        (rul?.critical ?? false) ||
        (rul?.p10S ?? Infinity) < RUL_CRIT_P10_S;
      alerts.push({
        type: 'FAULT',
        state: critical ? 'CRITICAL' : 'WARNING',
        text: `Twin disagreement: ${top!.label} (severity ${top!.severity.toFixed(2)}, confidence ${top!.confidence.toFixed(2)}).`,
      });
    }

    // Highest severity wins; a measured hard limit outranks a fault on a tie.
    const rank = (a: DiagAlert) => (a.state === 'CRITICAL' ? 2 : 1);
    alerts.sort(
      (a, b) => rank(b) - rank(a) || (a.type === b.type ? 0 : a.type === 'LIMIT' ? -1 : 1),
    );
    const primary = alerts[0] ?? null;
    const state: DiagState = primary ? primary.state : 'NOMINAL';
    const note = primary
      ? `${primary.type}: ${primary.text}`
      : top && anomaly >= ANOMALY_MAG
        ? `LOW CONFIDENCE FIT: ${top.label}`
        : 'NO ANOMALY';

    return {
      t: snap.t,
      state,
      ready: true,
      libraryNote: '',
      anomaly,
      severity: detected ? top!.severity : 0,
      confidence: detected ? top!.confidence : 0,
      dominant: detected ? top : null,
      candidates,
      rul: detected ? rul : null,
      alerts,
      note,
    };
  }

  /** Severity history of the tracked fault only; a new fault restarts it. */
  private trackHistory(dominant: FaultCandidate | null, t: number): void {
    if (!dominant) {
      this.samples = [];
      this.tracked = null;
      this.rul = null;
      return;
    }
    if (this.tracked !== dominant.key) {
      this.tracked = dominant.key;
      this.samples = [];
      this.rul = null;
      this.lastSampleT = -Infinity;
      this.lastRulT = -Infinity;
    }
    if (t - this.lastSampleT >= RUL_SAMPLE_S - 1e-9) {
      this.lastSampleT = t;
      this.samples.push({ t, sev: dominant.severity });
      while (this.samples.length && t - this.samples[0].t > RUL_HISTORY_S) this.samples.shift();
    }
  }

  private projectRul(twin: number[], snap: Snapshot, detected: boolean): RulEstimate | null {
    if (!detected || !this.tracked) return null;
    const sig = this.lib.index[sigIndexKey(nearestLibraryPhase(snap.phase), this.tracked.split('|')[0], Number(this.tracked.split('|')[1]))];
    if (!sig) return null;
    // An under-filled history is cheap to re-evaluate, so it is not cached; a
    // completed estimate is reused for the refresh interval.
    const cacheable = this.rul && this.rul.status !== 'INSUFFICIENT_DATA';
    if (cacheable && snap.t - this.lastRulT < RUL_RECOMPUTE_S) return this.rul;
    this.lastRulT = snap.t;
    this.rul = estimateRul({
      samples: this.samples,
      tNow: snap.t,
      templates: sig.templates,
      twin,
      seed: (snap.seed ^ 0x5f3759df) >>> 0,
    });
    return this.rul;
  }
}
