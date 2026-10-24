// Monte Carlo mission risk: randomized weather realization, turbulence
// realization, degradation growth and noise seeds, all drawn from one base
// seed so a run set is reproducible. The pool version spreads the pre-drawn
// runs over worker threads and reports progress; the synchronous version is
// the fallback (and what the tests use) and produces the same run set.
import { settledEngineState } from '../sim/sim';
import {
  CAUTION_MAX_LEG_RISK,
  CAUTION_MIN_MARGIN_KG,
  CAUTION_PROB,
  GO_MAX_LEG_RISK,
  GO_MIN_MARGIN_KG,
  GO_PROB,
  MC_GROWTH_MIN_ABS,
  MC_GROWTH_REL_SIGMA,
  MC_JITTER_ISA_C,
  MC_JITTER_WIND_DIR_DEG,
  MC_JITTER_WIND_FRAC,
  MC_MIN_RUNS,
  MC_WEAR_RATE_PER_H,
  MC_WEAR_SPREAD_PER_H,
  MISSION_DT,
  MISSION_FUEL_KG,
} from './constants';
import { planMission, runMission, wxAt, type DegradationItem, type MissionPlan, type RunResult } from './mission';
import { jitterTurbulence, type WaypointWeather } from './weather';
import { makeNormal, mulberry32 } from '../sim/rng';
import type { EngineState } from '../sim/engineModel';
import type { Waypoint } from './route';
import { toSummary, type MissionRunSummary, type MissionJob, type PreDrawnRun } from './missionWorker';

export interface McRequest {
  waypoints: Waypoint[];
  weather: WaypointWeather[];
  items: DegradationItem[];
  initState: EngineState | null;
  runs?: number;
  seed: number;
  /** severity growth per flight hour from the diagnosis estimate, if any */
  growthPerH: number | null;
}

export interface LegRisk {
  index: number;
  fromName: string;
  toName: string;
  distKm: number;
  timeS: number;
  altM: number;
  headwindMs: number;
  breachFrac: number;
  limitingChannel: string | null;
  healthyMeanPwrKw: number;
  maxChtC: number;
}

export interface Factor {
  label: string;
  corr: number; // point-biserial correlation with mission failure
  meanFail: number;
  meanPass: number;
  unit: string;
}

export interface LandingState {
  medChtMaxC: number;
  p90ChtMaxC: number;
  medOilTC: number;
  medOilPBar: number;
  medMarginKg: number;
  p10MarginKg: number;
  medEndSeverity: number;
  medTimeS: number;
}

export type Verdict = 'GO' | 'CAUTION' | 'NO-GO';

export interface McResult {
  runs: number;
  seed: number;
  completedFrac: number;
  verdict: Verdict;
  missionS: number;
  missionName: string;
  legs: LegRisk[];
  landing: LandingState;
  healthy: HealthyRun;
  current: HealthyRun;
  factors: Factor[];
  fuelBurnMeanKgH: number;
  buildMs: number;
  dtS: number;
  workers: number;
}

export interface HealthyRun {
  completed: boolean;
  maxChtC: number;
  maxOilTC: number;
  minOilPBar: number;
  marginKg: number;
  fuelUsedKg: number;
  timeS: number;
  breach: string | null;
  legs: { meanPwrKw: number; timeS: number; fuelKg: number }[];
}

/** 32-bit run seed: base seed mixed with the run index, exact integer math. */
export function runSeed(base: number, index: number): number {
  return (Math.imul(base >>> 0, 2654435761) + Math.imul(index + 1, 40503)) >>> 0;
}

function drawGrowth(estimate: number | null, normal: () => number): number {
  if (estimate !== null && Number.isFinite(estimate) && estimate > 0) {
    const sigma = Math.max(MC_GROWTH_MIN_ABS, Math.abs(estimate) * MC_GROWTH_REL_SIGMA);
    return Math.max(0, estimate + sigma * normal());
  }
  return Math.max(0, MC_WEAR_RATE_PER_H + MC_WEAR_SPREAD_PER_H * normal());
}

function jitterWeather(base: WaypointWeather[], n: number, normal: () => number): WaypointWeather[] {
  const out: WaypointWeather[] = [];
  for (let i = 0; i < n; i++) {
    const w = wxAt(base, i);
    out.push({
      isaDevC: w.isaDevC + MC_JITTER_ISA_C * normal(),
      windDirDeg: (w.windDirDeg + MC_JITTER_WIND_DIR_DEG * normal() + 360) % 360,
      windSpdMs: Math.max(0, w.windSpdMs * (1 + MC_JITTER_WIND_FRAC * normal())),
      gustMs: Math.max(0, w.gustMs * (1 + MC_JITTER_WIND_FRAC * normal())),
      turb: jitterTurbulence(w.turb, normal(), normal()),
    });
  }
  return out;
}

/**
 * The run set for a request: weather realization, growth draw and seed per run,
 * generated in index order from one stream so the set does not depend on how
 * the runs are later split across workers.
 */
export function drawRunSet(req: McRequest, runs: number): PreDrawnRun[] {
  const normal = makeNormal(mulberry32((req.seed ^ 0x5bf03635) >>> 0));
  const out: PreDrawnRun[] = [];
  for (let i = 0; i < runs; i++) {
    out.push({
      index: i,
      weather: jitterWeather(req.weather, req.waypoints.length, normal),
      growthPerH: drawGrowth(req.growthPerH, normal),
      seed: runSeed(req.seed, i),
    });
  }
  return out;
}

/** Engine state a mission starts from when there is no live twin to copy. */
export function missionStartState(req: McRequest): EngineState {
  const base = req.initState
    ? { ...req.initState, cht: req.initState.cht.slice(), egt: req.initState.egt.slice() }
    : settledEngineState({
        // Warm, power-settled engine on the ground: the mission starts from the
        // cruise equilibrium at field elevation rather than a takeoff state.
        phase: 'cruise',
        altitude: req.waypoints[0]?.altM ?? 0,
        isaDev: Math.round(wxAt(req.weather, 0).isaDevC),
        turbulence: 'none',
      });
  base.fuelKg = MISSION_FUEL_KG;
  return base;
}

export interface ProgressFn {
  (done: number, total: number): void;
}

/** Integrate every run on this thread. Used as the worker-pool fallback. */
function runSetSync(
  req: McRequest,
  base: EngineState,
  runs: PreDrawnRun[],
  onProgress?: ProgressFn,
): MissionRunSummary[] {
  const out: MissionRunSummary[] = [];
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    out.push(
      toSummary(
        runMission({
          waypoints: req.waypoints,
          items: req.items,
          weather: r.weather,
          initState: base,
          seed: r.seed,
          growthPerH: r.growthPerH,
          dt: MISSION_DT,
          checkLimits: true,
        }),
        r.index,
      ),
    );
    onProgress?.(i + 1, runs.length);
  }
  return out;
}

function workerCount(runs: number): number {
  const hw = typeof navigator === 'undefined' ? 1 : navigator.hardwareConcurrency ?? 4;
  return Math.max(1, Math.min(4, Math.min(hw, Math.ceil(runs / 25))));
}

function chunkRuns(runs: PreDrawnRun[], n: number): PreDrawnRun[][] {
  const out: PreDrawnRun[][] = [];
  for (let i = 0; i < n; i++) out.push([]);
  runs.forEach((r, i) => out[i % n].push(r));
  return out.filter((c) => c.length > 0);
}

/** Monte Carlo over a worker pool, with cross-worker progress reporting. */
export function runMonteCarloPool(req: McRequest, onProgress?: ProgressFn): Promise<McResult> {
  const runs = Math.max(MC_MIN_RUNS, Math.round(req.runs ?? MC_MIN_RUNS));
  const started = Date.now();
  const plan = planMission(req.waypoints, req.weather);
  const base = missionStartState(req);
  const drawn = drawRunSet(req, runs);
  const refs = comparisonRuns(req, plan);
  if (typeof Worker === 'undefined') {
    const summaries = runSetSync(req, base, drawn, onProgress);
    return Promise.resolve(aggregate(req, plan, drawn.length, summaries, refs, started, 1));
  }
  return new Promise((resolve) => {
    const chunks = chunkRuns(drawn, workerCount(runs));
    const n = chunks.length;
    const summaries: MissionRunSummary[] = [];
    let finished = 0;
    let done = 0;
    let errored = false;
    const settle = () => {
      for (const w of workers) w.terminate();
      if (errored) {
        const fallback = runSetSync(req, base, drawn, onProgress);
        resolve(aggregate(req, plan, drawn.length, fallback, refs, started, 1));
        return;
      }
      resolve(aggregate(req, plan, drawn.length, summaries, refs, started, n));
    };
    const workers = chunks.map((chunk) => {
      const w = new Worker(new URL('./missionWorker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<import('./missionWorker').MissionWorkerMessage>) => {
        const msg = e.data;
        if (msg.type === 'progress') {
          done = Math.min(runs, done + 1);
          onProgress?.(done, runs);
        } else if (msg.type === 'done') {
          summaries.push(...msg.summaries);
          finished++;
          if (finished === n) settle();
        } else {
          errored = true;
          finished++;
          if (finished === n) settle();
        }
      };
      w.onerror = () => {
        errored = true;
        finished++;
        if (finished === n) settle();
      };
      const job: MissionJob = {
        kind: 'runs',
        waypoints: req.waypoints,
        items: req.items,
        initState: base,
        dt: MISSION_DT,
        runs: chunk,
      };
      w.postMessage(job);
      return w;
    });
  });
}

/** Single-thread Monte Carlo: same run set, no workers. */
export function runMonteCarlo(req: McRequest, onProgress?: ProgressFn): McResult {
  const started = Date.now();
  const runs = Math.max(MC_MIN_RUNS, Math.round(req.runs ?? MC_MIN_RUNS));
  const plan = planMission(req.waypoints, req.weather);
  const base = missionStartState(req);
  const drawn = drawRunSet(req, runs);
  const refs = comparisonRuns(req, plan);
  const summaries = runSetSync(req, base, drawn, onProgress);
  return aggregate(req, plan, drawn.length, summaries, refs, started, 1);
}

/** One deterministic, full-length run for the side-by-side comparison bars. */
function referenceRun(
  req: McRequest,
  plan: MissionPlan,
  items: DegradationItem[],
  initState: EngineState,
): HealthyRun {
  // Limits are not enforced, so every comparison run flies the whole profile.
  // Truncating on the first breach would compare a short run against a long one
  // and flatter whichever channel lags: a cooling-degraded engine that quits on
  // leg 1 never warms the sump, so its oil temperature would read better than
  // the healthy engine's.
  const r = runMission({
    plan,
    items,
    weather: req.weather,
    initState,
    seed: req.seed >>> 0,
    growthPerH: 0,
    checkLimits: false,
    dt: MISSION_DT,
  });
  return toHealthy(r);
}

/**
 * Healthy engine vs the engine as it is now, on the same mission. Both start
 * from the same settled state at the first waypoint, so the only difference
 * between the bars is the degradation acting during the flight. Inheriting the
 * live twin's instantaneous temperatures would compare two different starts
 * instead - and an engine already hot from a fault being ramped on screen would
 * make the "healthy" bar hotter than healthy is.
 */
function comparisonRuns(req: McRequest, plan: MissionPlan) {
  const start = missionStartState({ ...req, initState: null });
  return {
    healthy: referenceRun(req, plan, [], start),
    current: referenceRun(req, plan, req.items, start),
  };
}

function toHealthy(r: RunResult): HealthyRun {
  return {
    completed: r.completed,
    maxChtC: r.maxChtC,
    maxOilTC: r.maxOilTC,
    minOilPBar: r.minOilPBar,
    marginKg: r.marginKg,
    fuelUsedKg: r.fuelUsedKg,
    timeS: r.timeS,
    breach: r.breach?.channel ?? null,
    legs: r.legs.map((l) => ({ meanPwrKw: l.meanPwrKw, timeS: l.timeS, fuelKg: l.fuelKg })),
  };
}

function quantileSorted(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, q * (sorted.length - 1)));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function sortedCopy(xs: number[]): number[] {
  return xs.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
}

function median(xs: number[]): number {
  return quantileSorted(sortedCopy(xs), 0.5);
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 4) return 0;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx < 1e-12 || syy < 1e-12) return 0;
  return sxy / Math.sqrt(sxx * syy);
}

// Only pre-flight (exogenous) quantities: an outcome such as fuel burnt is
// truncated by an early breach, which fakes a perfect correlation with failure.
const FACTOR_DEFS: { label: string; unit: string; get: (r: MissionRunSummary) => number }[] = [
  { label: 'CRUISE DENSITY ALTITUDE', unit: 'm', get: (r) => r.drivers.densAltMaxM },
  { label: 'ISA DEVIATION', unit: 'degC', get: (r) => r.drivers.isaMeanC },
  { label: 'PEAK HEADWIND', unit: 'm/s', get: (r) => r.drivers.headwindMaxMs },
  { label: 'TURBULENCE EXPOSURE', unit: 'index', get: (r) => r.drivers.turbIndex },
  { label: 'STATION-KEEPING TIME', unit: 'h', get: (r) => r.drivers.loiterH },
  { label: 'MISSION DURATION', unit: 'h', get: (r) => r.drivers.totalH },
  { label: 'DEGRADATION GROWTH', unit: 'sev/h', get: (r) => r.drivers.growthPerH },
  { label: 'START SEVERITY', unit: 'frac', get: (r) => r.drivers.sevStart },
  { label: 'WIND SPEED', unit: 'm/s', get: (r) => r.drivers.windMeanMs },
];

function meanWhere(xs: number[], flag: number[], want: number): number {
  let s = 0;
  let n = 0;
  for (let i = 0; i < xs.length; i++) {
    if (flag[i] === want && Number.isFinite(xs[i])) {
      s += xs[i];
      n++;
    }
  }
  return n ? s / n : NaN;
}

function aggregate(
  req: McRequest,
  plan: MissionPlan,
  runs: number,
  summaries: MissionRunSummary[],
  refs: { healthy: HealthyRun; current: HealthyRun },
  started: number,
  workers: number,
): McResult {
  const wps = req.waypoints;
  const ordered = [...summaries].sort((a, b) => a.index - b.index);
  const failFlag = ordered.map((r) => (r.completed ? 0 : 1));
  const completed = ordered.filter((r) => r.completed);
  const completedFrac = ordered.length ? completed.length / ordered.length : 0;

  const legs: LegRisk[] = plan.legs.map((l) => {
    const breaches = ordered.filter((r) => !r.completed && r.breachLegIndex === l.index);
    const counts = new Map<string, number>();
    for (const b of breaches) {
      const ch = b.breachChannel ?? 'unknown';
      counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    let limiting: string | null = null;
    let best = 0;
    for (const [ch, n] of counts) {
      if (n > best) {
        best = n;
        limiting = ch;
      }
    }
    return {
      index: l.index,
      fromName: l.fromName,
      toName: l.toName,
      distKm: l.distM / 1000,
      timeS: l.timeS,
      altM: l.altM,
      headwindMs: l.headwindMs,
      breachFrac: ordered.length ? breaches.length / ordered.length : 0,
      limitingChannel: limiting,
      healthyMeanPwrKw: refs.healthy.legs[l.index]?.meanPwrKw ?? 0,
      maxChtC: median(breaches.map((b) => b.maxChtC)),
    };
  });

  const chtMax = sortedCopy(ordered.map((r) => r.maxChtC));
  const margins = sortedCopy(completed.map((r) => r.marginKg));
  // Thermal peaks are taken over every run: a failed run's peak is what the
  // engine experienced before the mission ended, which is the useful number
  // when most runs fail. Fuel margin and time stay conditioned on completion,
  // because an early breach leaves fuel unburnt.
  const landing: LandingState = {
    medChtMaxC: median(ordered.map((r) => r.maxChtC)),
    p90ChtMaxC: quantileSorted(chtMax, 0.9),
    medOilTC: median(ordered.map((r) => r.maxOilTC)),
    medOilPBar: median(ordered.map((r) => r.minOilPBar)),
    medMarginKg: median(completed.map((r) => r.marginKg)),
    p10MarginKg: quantileSorted(margins, 0.1),
    medEndSeverity: median(ordered.map((r) => r.endSeverity)),
    medTimeS: median(completed.map((r) => r.timeS)),
  };

  const factors: Factor[] = FACTOR_DEFS.map((def) => {
    const xs = ordered.map(def.get);
    return {
      label: def.label,
      corr: pearson(xs, failFlag),
      meanFail: meanWhere(xs, failFlag, 1),
      meanPass: meanWhere(xs, failFlag, 0),
      unit: def.unit,
    };
  })
    .sort((a, b) => Math.abs(b.corr) - Math.abs(a.corr))
    .slice(0, 3);

  const maxLegRisk = legs.reduce((s, l) => Math.max(s, l.breachFrac), 0);
  let verdict: Verdict = 'NO-GO';
  if (
    completedFrac >= CAUTION_PROB &&
    maxLegRisk <= CAUTION_MAX_LEG_RISK &&
    landing.medMarginKg >= CAUTION_MIN_MARGIN_KG
  ) {
    verdict =
      completedFrac >= GO_PROB && maxLegRisk <= GO_MAX_LEG_RISK && landing.medMarginKg >= GO_MIN_MARGIN_KG
        ? 'GO'
        : 'CAUTION';
  }

  return {
    runs: ordered.length || runs,
    seed: req.seed,
    completedFrac,
    verdict,
    missionS: plan.totalS,
    missionName: wps.length > 1 ? `${wps[0].name} - ${wps[wps.length - 1].name}` : 'UNPLANNED',
    legs,
    landing,
    healthy: refs.healthy,
    current: refs.current,
    factors,
    fuelBurnMeanKgH: completed.length
      ? median(completed.map((r) => (r.fuelUsedKg / Math.max(1, r.timeS)) * 3600))
      : NaN,
    buildMs: Date.now() - started,
    dtS: MISSION_DT,
    workers,
  };
}
