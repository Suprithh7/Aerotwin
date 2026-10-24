// Sim: orchestrates true engine + twin, gusts, sensors, residuals, history.
// Fully deterministic for a given seed and command schedule.
import { atmosphere, type Atmosphere } from './atmosphere';
import {
  CHANNELS,
  EWMA_TAU_S,
  GUST,
  HIST_INTERVAL,
  INITIAL_FUEL_KG,
  PHASES,
  SIM_DT,
  TURB,
} from './constants';
import {
  initialState,
  nominalParams,
  stepEngine,
  type EngineInputs,
  type EngineParams,
  type EngineState,
} from './engineModel';
import { engineParamsWithFaults, faultLabel, rampProgress } from './faults';
import { makeNormal, mulberry32 } from './rng';
import type {
  ActiveFaultInfo,
  ChannelId,
  Channels,
  FaultSpec,
  HistPoint,
  Phase,
  Scenario,
  Snapshot,
} from './types';

export interface SimOptions {
  seed: number;
  scenario: Scenario;
}

// Settled nominal engine states per (phase, altitude, ISA dev): the warm-up
// loop is deterministic and noise-free, so every Sim with the same scenario
// can start from the same cached state.
const warmCache = new Map<string, EngineState>();

function warmState(a: Atmosphere, ph: (typeof PHASES)[Phase], key: string): EngineState {
  let s = warmCache.get(key);
  if (!s) {
    s = initialState(a, ph.rpmTarget, ph.throttle, INITIAL_FUEL_KG);
    const inputs: EngineInputs = {
      atmos: a,
      airspeedMs: ph.airspeedMs,
      rpmTarget: ph.rpmTarget,
      throttleBase: ph.throttle,
      afrCmd: ph.afr,
      propC: ph.propC,
      gustLoad: 1,
      gustThrottle: 0,
      gustRpm: 0,
    };
    const nominal = nominalParams();
    for (let i = 0; i < 12000; i++) s = stepEngine(s!, nominal, inputs).state;
    warmCache.set(key, s);
  }
  return cloneState(s);
}

function cloneState(s: EngineState): EngineState {
  return { ...s, cht: s.cht.slice(), egt: s.egt.slice() };
}

/**
 * Settled nominal engine state for a scenario, without constructing a Sim.
 * Used by the headless mission runner when there is no live twin to copy.
 */
export function settledEngineState(scenario: Scenario): EngineState {
  const ph = PHASES[scenario.phase];
  const a = atmosphere(scenario.altitude, scenario.isaDev);
  return warmState(a, ph, `${scenario.phase}|${scenario.altitude}|${scenario.isaDev}`);
}

export class Sim {
  readonly seed: number;
  scenario: Scenario;
  t = 0;

  private normal: () => number;
  private ou = 0; // Ornstein-Uhlenbeck gust state
  private trueState: EngineState;
  private twinState: EngineState;
  private faults: FaultSpec[] = [];
  private nextId = 1;
  private ewma: Record<ChannelId, number> = {} as Record<ChannelId, number>;
  private stuckFrozen: Map<number, number> = new Map();
  private lastHistT = -HIST_INTERVAL;
  private lastInputs: EngineInputs;
  private trueChannels: Channels;
  private twinChannels: Channels;
  private measChannels: Channels;

  constructor(opts: SimOptions) {
    this.seed = opts.seed;
    this.scenario = opts.scenario;
    const rng = mulberry32(opts.seed >>> 0);
    this.normal = makeNormal(rng);

    const ph = PHASES[this.scenario.phase];
    const a = atmosphere(this.scenario.altitude, this.scenario.isaDev);
    this.lastInputs = {
      atmos: a,
      airspeedMs: ph.airspeedMs,
      rpmTarget: ph.rpmTarget,
      throttleBase: ph.throttle,
      afrCmd: ph.afr,
      propC: ph.propC,
      gustLoad: 1,
      gustThrottle: 0,
      gustRpm: 0,
    };
    const warmKey = `${this.scenario.phase}|${this.scenario.altitude}|${this.scenario.isaDev}`;
    this.trueState = warmState(a, ph, warmKey);
    this.twinState = warmState(a, ph, warmKey);
    this.trueChannels = deriveChannels(this.trueState, nominalParams(), this.lastInputs);
    this.twinChannels = deriveChannels(this.twinState, nominalParams(), this.lastInputs);
    this.measChannels = { ...this.trueChannels };
    for (const c of CHANNELS) this.ewma[c.id] = 0;
  }

  injectFault(spec: Omit<FaultSpec, 'id' | 'tInject'>): number {
    const full: FaultSpec = { ...spec, id: this.nextId++, tInject: this.t };
    if (full.scope === 'sensor' && full.kind === 'stuck') {
      this.stuckFrozen.set(full.id, this.measChannels[full.channel!]);
    }
    this.faults.push(full);
    return full.id;
  }

  clearFault(id: number): void {
    this.faults = this.faults.filter((f) => f.id !== id);
    this.stuckFrozen.delete(id);
  }

  activeFaults(): ActiveFaultInfo[] {
    return this.faults.map((f) => ({
      id: f.id,
      label: faultLabel(f),
      scope: f.scope,
      kind: f.kind,
      severity: f.severity,
      rampTime: f.rampTime,
      cylinder: f.cylinder,
      channel: f.channel,
      tInject: f.tInject,
      elapsed: this.t - f.tInject,
      ramped: rampProgress(f, this.t) >= 1,
    }));
  }

  step(): void {
    const dt = SIM_DT;
    this.t += dt;
    const sc = this.scenario;
    const ph = PHASES[sc.phase];
    const turb = TURB[sc.turbulence];
    const a = atmosphere(sc.altitude, sc.isaDev);

    // Ornstein-Uhlenbeck gust process: dx = -x/tau dt + sigma dW
    if (turb.factor > 0) {
      const sigma = turb.factor * 0.4 * Math.sqrt(2 * turb.tauS);
      this.ou += (-this.ou / turb.tauS) * dt + sigma * Math.sqrt(dt) * this.normal();
      this.ou = Math.max(-3.5, Math.min(3.5, this.ou));
    } else {
      this.ou = 0;
    }
    const g = this.ou;
    const inputs: EngineInputs = {
      atmos: a,
      airspeedMs: ph.airspeedMs * (1 + 0.06 * turb.factor * g),
      rpmTarget: ph.rpmTarget + GUST.rpm * turb.factor * g,
      throttleBase: ph.throttle,
      afrCmd: ph.afr,
      propC: ph.propC,
      gustLoad: 1 + GUST.load * turb.factor * g,
      gustThrottle: GUST.throttle * turb.factor * g,
      gustRpm: 0,
    };
    this.lastInputs = inputs;

    const trueParams = engineParamsWithFaults(nominalParams(), this.faults, this.t);
    const twinParams = nominalParams();

    this.trueState = stepEngine(this.trueState, trueParams, inputs).state;
    this.twinState = stepEngine(this.twinState, twinParams, inputs).state;

    this.trueChannels = deriveChannels(this.trueState, trueParams, inputs);
    this.twinChannels = deriveChannels(this.twinState, twinParams, inputs);

    // sensors: measured = true + gaussian noise, then sensor-fault modifications
    const sensorFaults = this.faults.filter((f) => f.scope === 'sensor');
    const meas = {} as Channels;
    for (const c of CHANNELS) {
      let v = this.trueChannels[c.id];
      let sigma = c.noiseSigma;
      let frozen: number | null = null;
      for (const f of sensorFaults) {
        if (f.channel !== c.id) continue;
        const s = f.severity * rampProgress(f, this.t);
        if (f.kind === 'drift') v += s * c.driftRange;
        else if (f.kind === 'noise') sigma += s * c.driftRange * 0.35;
        else if (f.kind === 'stuck') frozen = this.stuckFrozen.get(f.id) ?? v;
      }
      v += sigma * this.normal();
      if (frozen !== null) v = frozen;
      meas[c.id] = v;
    }
    this.measChannels = meas;

    // residuals vs twin, z-scores, EWMA
    const alpha = dt / (EWMA_TAU_S + dt);
    for (const c of CHANNELS) {
      const resid = meas[c.id] - this.twinChannels[c.id];
      const z = resid / c.noiseSigma;
      this.ewma[c.id] = this.ewma[c.id] * (1 - alpha) + z * alpha;
    }
  }

  snapshot(): Snapshot {
    const readings = {} as Snapshot['readings'];
    for (const c of CHANNELS) {
      const m = this.measChannels[c.id];
      const tw = this.twinChannels[c.id];
      const resid = m - tw;
      readings[c.id] = {
        true: this.trueChannels[c.id],
        measured: m,
        twin: tw,
        residual: resid,
        z: resid / c.noiseSigma,
        zEwma: this.ewma[c.id],
      };
    }
    const a = atmosphere(this.scenario.altitude, this.scenario.isaDev);
    return {
      t: this.t,
      phase: this.scenario.phase,
      readings,
      faults: this.activeFaults(),
      scenario: this.scenario,
      seed: this.seed,
      densityAltitude: a.densityAltM,
      sigmaRatio: a.sigma,
      oatC: a.tempC,
    };
  }

  historyDue(): HistPoint | null {
    if (this.t - this.lastHistT < HIST_INTERVAL - 1e-9) return null;
    this.lastHistT = this.t;
    const m = {} as HistPoint['m'];
    const tw = {} as HistPoint['tw'];
    const z = {} as HistPoint['z'];
    for (const c of CHANNELS) {
      m[c.id] = this.measChannels[c.id];
      tw[c.id] = this.twinChannels[c.id];
      z[c.id] = this.ewma[c.id];
    }
    return { t: this.t, m, tw, z };
  }

  /** EWMA-smoothed residual z-score per channel, in CHANNELS order. */
  zEwmaVector(): number[] {
    return CHANNELS.map((c) => this.ewma[c.id]);
  }

  /** Instantaneous (unsmoothed) residual z-score per channel, in CHANNELS order. */
  rawZVector(): number[] {
    const out = new Array<number>(CHANNELS.length);
    for (let i = 0; i < CHANNELS.length; i++) {
      const c = CHANNELS[i];
      out[i] = (this.measChannels[c.id] - this.twinChannels[c.id]) / c.noiseSigma;
    }
    return out;
  }

  /** Twin (healthy-engine prediction) channel values, in CHANNELS order. */
  twinVector(): number[] {
    return CHANNELS.map((c) => this.twinChannels[c.id]);
  }
}

// Read out all sensor channels from an engine state without advancing it:
// stepEngine with dt=0 mutates nothing, only the algebraic outputs are used.
function deriveChannels(s: EngineState, p: EngineParams, inp: EngineInputs): Channels {
  const r = stepEngine(s, p, inp, 0);
  const ch = {} as Channels;
  ch.rpm = s.rpm;
  ch.map = s.mapPa / 1000;
  ch.boost = r.out.boostPa / 1000;
  ch.ff = r.out.ffKgH;
  ch.afr = r.out.afr;
  for (let i = 0; i < 4; i++) {
    ch[(`cht${i + 1}`) as ChannelId] = s.cht[i];
    ch[(`egt${i + 1}`) as ChannelId] = s.egt[i];
  }
  ch.oilT = s.oilTemp;
  ch.oilP = r.out.oilPBar;
  ch.vib = s.vib;
  ch.pwr = r.out.pwrKw;
  ch.fuel = s.fuelKg;
  return ch;
}
