// Severity trend + Remaining Useful Life projection.
// Deterministic Monte Carlo over the trend-fit coefficient covariance plus the
// sensor-noise uncertainty of the end-of-life threshold, so the band does not
// jitter between recomputes.
import { CHANNELS } from '../sim/constants';
import { makeNormal, mulberry32 } from '../sim/rng';
import type { ChannelId } from '../sim/types';

// --- assumptions (see ASSUMPTIONS.md) ---
export const RUL_SAMPLE_S = 1.0; // severity history cadence, sim s
export const RUL_HISTORY_S = 120; // rolling window, sim s
export const RUL_MIN_SAMPLES = 15; // before any trend claim
export const RUL_MIN_SPAN_S = 25; // trend needs this much elapsed fault time
export const RUL_MIN_SEVERITY = 0.1; // below this the anomaly is not actionable
export const RUL_MIN_SLOPE_PER_H = 0.05; // severity gain needed to call a trend
export const RUL_MC_RUNS = 240;
export const RUL_HORIZON_S = 1800; // projection window for the band chart
export const RUL_CAP_S = 7200; // RUL reported above this is "beyond 2 h"
export const RUL_CRITICAL_S = 600; // median below this => CRITICAL
export const RUL_GRID_POINTS = 25;

export const CHT_LIMIT_C = 230; // head over-temperature limit, any cylinder
export const OILP_MIN_BAR = 2.5; // minimum usable oil pressure
export const PWR_MIN_FRAC = 0.85; // minimum shaft power vs healthy phase demand

export interface RulSample {
  t: number; // sim time, s
  sev: number; // severity estimate 0..1
}

export interface EolTarget {
  channel: ChannelId;
  limit: number; // physical limit value
  sevReq: number; // severity at which the limit is reached
  unit: string;
  label: string;
}

export interface RulPoint {
  tRelS: number; // seconds from now
  med: number;
  lo: number;
  hi: number;
}

export type RulStatus = 'INSUFFICIENT_DATA' | 'NO_TREND' | 'OK';

export interface RulEstimate {
  status: RulStatus;
  note: string;
  model: 'linear' | 'exponential' | null;
  sevNow: number;
  slopePerHour: number;
  medianS: number | null;
  p10S: number | null;
  p90S: number | null;
  medianH: number | null;
  p10H: number | null;
  p90H: number | null;
  binding: EolTarget | null;
  targets: EolTarget[];
  series: RulPoint[];
  samples: number;
  spanS: number;
  critical: boolean;
  beyondCap: boolean;
}

export const INSUFFICIENT: RulEstimate = {
  status: 'INSUFFICIENT_DATA',
  note: 'INSUFFICIENT DATA',
  model: null,
  sevNow: 0,
  slopePerHour: 0,
  medianS: null,
  p10S: null,
  p90S: null,
  medianH: null,
  p10H: null,
  p90H: null,
  binding: null,
  targets: [],
  series: [],
  samples: 0,
  spanS: 0,
  critical: false,
  beyondCap: false,
};

interface Ols {
  a: number;
  b: number;
  sse: number;
  n: number;
  varA: number;
  varB: number;
  covAB: number;
}

function ols(xs: number[], ys: number[]): Ols | null {
  const n = xs.length;
  if (n < 3) return null;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
    sxx += xs[i] * xs[i];
    sxy += xs[i] * ys[i];
  }
  const den = n * sxx - sx * sx;
  if (Math.abs(den) < 1e-12) return null;
  const b = (n * sxy - sx * sy) / den;
  const a = (sy - b * sx) / n;
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const r = ys[i] - (a + b * xs[i]);
    sse += r * r;
  }
  const s2 = sse / (n - 2);
  return { a, b, sse, n, varA: (s2 * sxx) / den, varB: (s2 * n) / den, covAB: (-s2 * sx) / den };
}

export interface TrendFit {
  model: 'linear' | 'exponential';
  a: number;
  b: number;
  sse: number;
  varA: number;
  varB: number;
  covAB: number;
  slopePerHour: number;
}

/**
 * Fit linear and exponential growth to the severity history (x in seconds from
 * the first sample) and keep the better one by sum-of-squared-error in severity
 * space.
 */
export function fitTrend(samples: RulSample[]): TrendFit | null {
  if (samples.length < RUL_MIN_SAMPLES) return null;
  const t0 = samples[0].t;
  const xs = samples.map((s) => s.t - t0);
  const ys = samples.map((s) => s.sev);
  const span = xs[xs.length - 1];
  if (span < RUL_MIN_SPAN_S) return null;

  const lin = ols(xs, ys);
  let expFit: Ols | null = null;
  const lx: number[] = [];
  const ly: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    if (ys[i] > 1e-3) {
      lx.push(xs[i]);
      ly.push(Math.log(ys[i]));
    }
  }
  if (lx.length >= RUL_MIN_SAMPLES) {
    const e = ols(lx, ly);
    if (e && e.b > 0) {
      let sse = 0;
      for (let i = 0; i < xs.length; i++) {
        const pred = Math.exp(e.a + e.b * xs[i]);
        const r = ys[i] - pred;
        sse += r * r;
      }
      expFit = { ...e, sse };
    }
  }

  const cands: { f: Ols; model: 'linear' | 'exponential' }[] = [];
  if (lin && lin.b > 0) cands.push({ f: lin, model: 'linear' });
  if (expFit) cands.push({ f: expFit, model: 'exponential' });
  if (!cands.length) return null;
  cands.sort((p, q) => p.f.sse - q.f.sse);
  const best = cands[0];
  // report the growth rate as severity fraction per flight hour
  const perHour = best.model === 'linear' ? best.f.b * 3600 : (Math.exp(best.f.b * 3600) - 1) * Math.exp(best.f.a);
  return {
    model: best.model,
    a: best.f.a,
    b: best.f.b,
    sse: best.f.sse,
    varA: best.f.varA,
    varB: best.f.varB,
    covAB: best.f.covAB,
    slopePerHour: perHour,
  };
}

function sevAt(fit: TrendFit, x: number): number {
  return fit.model === 'linear' ? fit.a + fit.b * x : Math.exp(fit.a + fit.b * x);
}

function crossing(fit: TrendFit, sevReq: number, xNow: number): number | null {
  if (sevAt(fit, xNow) >= sevReq) return xNow; // already at the limit
  if (sevReq <= 0) return xNow;
  if (fit.model === 'linear') {
    if (fit.b <= 1e-12) return null;
    return (sevReq - fit.a) / fit.b;
  }
  if (fit.b <= 1e-12) return null;
  return (Math.log(sevReq) - fit.a) / fit.b;
}

/**
 * End-of-life thresholds expressed as required severity, using the severity-1.0
 * signature template as the physical gain (z x noise sigma = degC / bar / kW).
 * The shaft-power floor is a fraction of the healthy (twin) power for the phase.
 */
export function eolTargets(sev1: number[], twin: number[]): EolTarget[] {
  const out: EolTarget[] = [];
  for (let i = 0; i < CHANNELS.length; i++) {
    const c = CHANNELS[i];
    const gain = sev1[i] * c.noiseSigma; // physical delta at severity 1.0
    if (c.id.startsWith('cht')) {
      if (gain < 1e-6) continue;
      const need = CHT_LIMIT_C - twin[i];
      if (need <= 0) {
        out.push({ channel: c.id, limit: CHT_LIMIT_C, sevReq: 0, unit: c.unit, label: c.label });
        continue;
      }
      out.push({ channel: c.id, limit: CHT_LIMIT_C, sevReq: need / gain, unit: c.unit, label: c.label });
    } else if (c.id === 'oilP') {
      if (gain > -1e-6) continue;
      const need = twin[i] - OILP_MIN_BAR; // positive headroom
      out.push({
        channel: c.id,
        limit: OILP_MIN_BAR,
        sevReq: need / -gain,
        unit: c.unit,
        label: c.label,
      });
    } else if (c.id === 'pwr') {
      if (gain > -1e-6) continue;
      const floor = PWR_MIN_FRAC * twin[i];
      const need = twin[i] - floor;
      out.push({ channel: c.id, limit: floor, sevReq: need / -gain, unit: c.unit, label: c.label });
    }
  }
  return out.filter((t) => Number.isFinite(t.sevReq) && t.sevReq > 0 && t.sevReq <= 4);
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, q * (sorted.length - 1)));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export interface RulInput {
  samples: RulSample[];
  tNow: number; // sim time of the latest sample
  sev1: number[]; // severity-1.0 signature (z units)
  twin: number[]; // twin physical channel values (CHANNELS order)
  seed?: number;
}

export function estimateRul(input: RulInput): RulEstimate {
  const samples = input.samples;
  if (samples.length < RUL_MIN_SAMPLES) {
    return { ...INSUFFICIENT, samples: samples.length, sevNow: samples.length ? samples[samples.length - 1].sev : 0 };
  }
  const sevNow = samples[samples.length - 1].sev;
  if (sevNow < RUL_MIN_SEVERITY) {
    return { ...INSUFFICIENT, samples: samples.length, sevNow };
  }
  const fit = fitTrend(samples);
  if (!fit) {
    return { ...INSUFFICIENT, samples: samples.length, sevNow, note: 'INSUFFICIENT DATA - NO GROWTH TREND' };
  }
  if (fit.slopePerHour < RUL_MIN_SLOPE_PER_H) {
    return {
      ...INSUFFICIENT,
      model: fit.model,
      samples: samples.length,
      sevNow,
      slopePerHour: fit.slopePerHour,
      note: 'INSUFFICIENT DATA - NO GROWTH TREND',
    };
  }

  const targets = eolTargets(input.sev1, input.twin);
  if (!targets.length) {
    return {
      ...INSUFFICIENT,
      model: fit.model,
      samples: samples.length,
      sevNow,
      slopePerHour: fit.slopePerHour,
      note: 'NO PROJECTED LIMIT BREACH',
    };
  }

  const t0 = samples[0].t;
  const xNow = input.tNow - t0;
  const spanS = samples[samples.length - 1].t - t0;

  const normal = makeNormal(mulberry32((input.seed ?? 7919) >>> 0));
  // Cholesky factor of the 2x2 coefficient covariance
  const l11 = Math.sqrt(Math.max(1e-15, fit.varA));
  const l21 = fit.covAB / l11;
  const l22 = Math.sqrt(Math.max(1e-15, fit.varB - l21 * l21));

  const runs: number[] = [];
  const grid = RUL_GRID_POINTS;
  const stepS = RUL_HORIZON_S / (grid - 1);
  const curves: number[][] = [];
  for (let r = 0; r < RUL_MC_RUNS; r++) {
    const n1 = normal();
    const n2 = normal();
    const a = fit.a + l11 * n1;
    const b = fit.b + l21 * n1 + l22 * n2;
    const sampled: TrendFit = { ...fit, a, b };
    if (!(b > 0)) continue;
    const curve = new Array<number>(grid);
    for (let g = 0; g < grid; g++) {
      curve[g] = Math.max(0, Math.min(1.6, sevAt(sampled, g * stepS)));
    }
    curves.push(curve);
    let best: number | null = null;
    for (const tgt of targets) {
      // sensor-noise uncertainty on the threshold severity
      const idx = CHANNELS.findIndex((c) => c.id === tgt.channel);
      const zGain = input.sev1[idx];
      const sevJitter = zGain !== 0 ? (tgt.sevReq * normal()) / zGain : 0;
      const req = Math.max(1e-3, tgt.sevReq + sevJitter);
      const x = crossing(sampled, req, xNow);
      if (x === null) continue;
      const rel = x - xNow;
      if (best === null || rel < best) best = rel;
    }
    if (best !== null) runs.push(Math.max(0, Math.min(RUL_CAP_S, best)));
  }
  runs.sort((p, q) => p - q);

  const series: RulPoint[] = [];
  if (curves.length) {
    for (let g = 0; g < grid; g++) {
      const vals = curves.map((c) => c[g]).sort((p, q) => p - q);
      series.push({
        tRelS: g * stepS,
        med: quantile(vals, 0.5),
        lo: quantile(vals, 0.1),
        hi: quantile(vals, 0.9),
      });
    }
  }

  if (runs.length < RUL_MC_RUNS * 0.2) {
    return {
      ...INSUFFICIENT,
      model: fit.model,
      samples: samples.length,
      sevNow,
      slopePerHour: fit.slopePerHour,
      targets,
      series,
      spanS,
      note: 'NO PROJECTED LIMIT BREACH',
    };
  }

  const medianS = quantile(runs, 0.5);
  const p10S = quantile(runs, 0.1);
  const p90S = quantile(runs, 0.9);
  const beyondCap = medianS >= RUL_CAP_S - 1e-6;
  let binding: EolTarget | null = null;
  let bestT = Infinity;
  for (const tgt of targets) {
    const x = crossing(fit, tgt.sevReq, xNow);
    if (x === null) continue;
    if (x - xNow < bestT) {
      bestT = x - xNow;
      binding = tgt;
    }
  }
  const toH = (s: number) => s / 3600;
  return {
    status: 'OK',
    note: binding
      ? `PROJECTION TO ${binding.label} ${binding.limit.toFixed(1)} ${binding.unit}`
      : 'PROJECTION',
    model: fit.model,
    sevNow,
    slopePerHour: fit.slopePerHour,
    medianS,
    p10S,
    p90S,
    medianH: toH(medianS),
    p10H: toH(p10S),
    p90H: toH(p90S),
    binding,
    targets,
    series,
    samples: samples.length,
    spanS,
    critical: medianS < RUL_CRITICAL_S,
    beyondCap,
  };
}
