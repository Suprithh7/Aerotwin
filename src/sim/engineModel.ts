// Lumped-parameter piston engine model.
// stepEngine() is a pure function: same state + params + inputs => same output.
// stepEngineInto() applies the identical algebra to a caller-owned state object
// with no per-call allocation, which is what the headless mission runner needs
// to integrate hours of flight thousands of times.
import { ENG, N_CYL, SIM_DT } from './constants';
import type { Atmosphere } from './atmosphere';

export interface EngineParams {
  // per-cylinder health factors, 1 = nominal
  firing: number[]; // fraction of fuel energy released by combustion (misfire)
  injector: number[]; // fuel flow multiplier
  ignition: number[]; // combustion efficiency multiplier (timing)
  compression: number[]; // volumetric-efficiency multiplier
  cooling: number[]; // cooling coefficient multiplier
  // global health factors
  turbo: number; // boost capability multiplier
  oilSeal: number; // oil-system integrity (pressure + friction heat)
  exhaust: number; // back-pressure severity 0..1 (0 = nominal)
}

export function nominalParams(): EngineParams {
  const one = () => new Array(N_CYL).fill(1);
  return {
    firing: one(),
    injector: one(),
    ignition: one(),
    compression: one(),
    cooling: one(),
    turbo: 1,
    oilSeal: 1,
    exhaust: 0,
  };
}

export interface EngineInputs {
  atmos: Atmosphere;
  airspeedMs: number;
  rpmTarget: number;
  throttleBase: number; // schedule value (governor may adjust)
  afrCmd: number;
  propC: number; // propeller load constant, N m / (rad/s)^2
  gustLoad: number; // -1..1, scales prop load
  gustThrottle: number;
  gustRpm: number;
}

export interface EngineState {
  rpm: number;
  mapPa: number;
  cht: number[];
  egt: number[];
  oilTemp: number;
  throttle: number; // current commanded value (governor state)
  govInt: number; // governor integral offset
  vib: number;
  fuelKg: number;
}

export interface EngineDerived {
  boostPa: number;
  ffKgH: number;
  afr: number;
  oilPBar: number;
  pwrKw: number;
  cylPowerKw: number[];
}

export function initialState(a: Atmosphere, rpmTarget: number, throttle: number, fuelKg: number): EngineState {
  const mapPa =
    a.pressPa *
    Math.min(ENG.prRef, 1 + (ENG.prRef - 1) * Math.pow(rpmTarget / ENG.prRpmRef, 1.8)) *
    (ENG.mapThrFloor + (1 - ENG.mapThrFloor) * throttle);
  const cht0 = a.tempC + 68;
  const egt0 = a.tempC + 320;
  return {
    rpm: rpmTarget,
    mapPa,
    cht: new Array(N_CYL).fill(cht0),
    egt: new Array(N_CYL).fill(egt0),
    oilTemp: a.tempC + 42,
    throttle,
    govInt: 0,
    vib: ENG.vibBase,
    fuelKg,
  };
}

function pressureRatio(s: EngineState, p: EngineParams): number {
  const spin = Math.pow(Math.min(s.rpm, ENG.prRpmRef * 1.15) / ENG.prRpmRef, 1.8);
  return 1 + (ENG.prRef - 1) * p.turbo * spin;
}

export interface StepResult {
  state: EngineState;
  out: EngineDerived;
}

// First-order lags are integrated with the analytic (exponential) step:
// x += (target - x) * (1 - exp(-dt/tau)), identical to Euler to O(dt^2) but
// stable at the coarse step the mission runner uses. Cached per dt.
const VIB_TAU_S = 0.4;
interface LagFactors {
  map: number;
  egt: number;
  vib: number;
}
const LAG_CACHE = new Map<number, LagFactors>();

function lagFactors(dt: number): LagFactors {
  let k = LAG_CACHE.get(dt);
  if (!k) {
    k = {
      map: 1 - Math.exp(-dt / ENG.mapTauS),
      egt: 1 - Math.exp(-dt / ENG.egtTauS),
      vib: 1 - Math.exp(-dt / VIB_TAU_S),
    };
    LAG_CACHE.set(dt, k);
  }
  return k;
}

// Per-cylinder scratch: single-threaded per module instance, reused every step.
const scFuel = new Array<number>(N_CYL);
const scAir = new Array<number>(N_CYL);
const scWaste = new Array<number>(N_CYL);
const scExh = new Array<number>(N_CYL);
const scCylPower = new Array<number>(N_CYL);

function integrate(s: EngineState, out: EngineDerived, p: EngineParams, inp: EngineInputs, dt: number): void {
  const a = inp.atmos;
  const K = lagFactors(dt);

  // --- electronic governor: hold phase rpm target around schedule throttle ---
  const rpmT = inp.rpmTarget + inp.gustRpm;
  const err = rpmT - s.rpm;
  s.govInt = clamp(s.govInt + ENG.govKp * err * dt, -ENG.govClamp, ENG.govClamp);
  s.throttle = clamp(inp.throttleBase * (1 + inp.gustThrottle) + s.govInt, 0.02, 1);

  // --- turbo / manifold pressure ---
  const pr = pressureRatio(s, p);
  const tManK = a.tempK + ENG.compHeatBase + ENG.compHeatPerPR * (pr - 1);
  const mapTarget =
    a.pressPa * pr * (ENG.mapThrFloor + (1 - ENG.mapThrFloor) * s.throttle) * (1 - 0.18 * p.exhaust);
  s.mapPa += (mapTarget - s.mapPa) * K.map;
  const boostPa = Math.max(0, s.mapPa - a.pressPa);

  // --- air, fuel, combustion per cylinder ---
  const rhoMan = s.mapPa / (287.052 * tManK);
  let shaftW = 0;
  let wFuelTot = 0;
  let wAirTot = 0;
  for (let i = 0; i < N_CYL; i++) {
    const ve = ENG.veBase * p.compression[i] * (1 - 0.22 * p.exhaust);
    const wAir = ve * (ENG.dispM3 / N_CYL) * (s.rpm / 120) * rhoMan; // kg/s
    const wFuel = (wAir / inp.afrCmd) * p.injector[i];
    const fuelPowerW = wFuel * ENG.lhvJkg;
    // thermal efficiency: weaker charge (compression) and late burn (ignition) cut it;
    // back-pressure pumps against the piston
    const eta =
      ENG.etaBase *
      p.ignition[i] *
      (0.55 + 0.45 * p.compression[i]) *
      (1 - 0.28 * p.exhaust);
    const burn = p.firing[i] * fuelPowerW; // W actually released
    const cylPowerW = eta * burn * ENG.mechEff;
    shaftW += cylPowerW;
    const unburnt = (1 - p.firing[i]) * fuelPowerW; // passes through the exhaust
    const waste = burn - cylPowerW / ENG.mechEff;
    // retarded ignition dumps unconverted energy late, heating the exhaust;
    // back-pressure traps hot residual gas
    const lateBurn = (1 - p.ignition[i]) * burn * 0.5;
    const bpHeat = ENG.bpExhHeatFrac * p.exhaust * fuelPowerW;
    scAir[i] = wAir;
    scFuel[i] = wFuel;
    scWaste[i] = waste;
    scCylPower[i] = cylPowerW;
    scExh[i] = ENG.exhHeatFrac * waste + lateBurn + 0.25 * unburnt + bpHeat;
    wFuelTot += wFuel;
    wAirTot += wAir;
  }
  out.pwrKw = shaftW / 1000;

  // --- crankshaft speed: shaft torque vs propeller load torque ---
  const w = (s.rpm * Math.PI) / 30;
  const tLoad = inp.propC * w * w * inp.gustLoad;
  const tNet = shaftW / Math.max(w, 5) - tLoad;
  const dwdt = tNet / ENG.inertiaKgM2;
  s.rpm = Math.max(400, s.rpm + (dwdt * dt * 30) / Math.PI);

  // --- cylinder head temperature ODEs ---
  const hBase = ENG.hCylBase + ENG.hCylPerMs * inp.airspeedMs;
  let meanChT = 0;
  for (let i = 0; i < N_CYL; i++) {
    const qIn =
      (ENG.chtHeatFrac + ENG.radFrac) * scWaste[i] +
      ENG.bpCylHeatFrac * p.exhaust * scFuel[i] * ENG.lhvJkg +
      0.02 * (shaftW / N_CYL); // friction share
    const qOut =
      hBase * p.cooling[i] * (s.cht[i] - a.tempC) +
      ENG.cylRadiate * (s.cht[i] - a.tempC) +
      ENG.cylToOilCond * (s.cht[i] - s.oilTemp);
    s.cht[i] += ((qIn - qOut) / ENG.chtCapJk) * dt;
    meanChT += s.cht[i];
    out.cylPowerKw[i] = scCylPower[i] / 1000;
  }
  meanChT /= N_CYL;

  // --- exhaust gas temperature ---
  for (let i = 0; i < N_CYL; i++) {
    const wGas = Math.max(1e-5, scAir[i] + scFuel[i]);
    let egtTarget = a.tempC + scExh[i] / (wGas * ENG.cpExhaust);
    // over-fuelled cylinder: excess fuel quenches combustion temperature
    egtTarget *= 1 - 0.55 * (p.injector[i] - 1);
    egtTarget = Math.max(a.tempC + 15, egtTarget);
    s.egt[i] += (egtTarget - s.egt[i]) * K.egt;
  }

  // --- oil temperature & pressure ---
  const fricW =
    ENG.oilFrictPowerFrac * shaftW * (1 + 1.6 * (1 - p.oilSeal)) +
    ENG.oilFrictRpmK * Math.pow(s.rpm / 1000, 3);
  const hOil = ENG.hOilBase + ENG.hOilPerMs * inp.airspeedMs;
  const qOil = fricW + ENG.cylToOilCond * (meanChT - s.oilTemp);
  s.oilTemp += ((qOil - hOil * (s.oilTemp - a.tempC)) / ENG.oilCapJk) * dt;
  const visc = Math.exp(-ENG.oilVisicPerK * (s.oilTemp - 80));
  out.oilPBar = clamp(ENG.oilPRef * (s.rpm / 2000) * visc * p.oilSeal, 0.05, 7);

  // --- vibration RMS ---
  const meanP = shaftW / N_CYL;
  let imb = 0;
  for (let i = 0; i < N_CYL; i++) imb += Math.abs(scCylPower[i] - meanP);
  const imbRel = meanP > 1 ? imb / (N_CYL * meanP) : 1;
  let ignDeg = 0;
  for (let i = 0; i < N_CYL; i++) ignDeg += 1 - p.ignition[i];
  const vibTarget =
    ENG.vibBase +
    ENG.vibImbalanceK * imbRel +
    ENG.vibOilK * (1 - p.oilSeal) +
    ENG.vibIgnK * (ignDeg / N_CYL);
  s.vib += (vibTarget - s.vib) * K.vib;

  // --- fuel remaining ---
  s.fuelKg = Math.max(0, s.fuelKg - wFuelTot * dt);

  out.ffKgH = wFuelTot * 3600;
  out.afr = wFuelTot > 1e-9 ? wAirTot / wFuelTot : 30;
  out.boostPa = boostPa;
}

export function stepEngine(
  prev: EngineState,
  p: EngineParams,
  inp: EngineInputs,
  dt = SIM_DT,
): StepResult {
  const s: EngineState = {
    ...prev,
    cht: prev.cht.slice(),
    egt: prev.egt.slice(),
  };
  const out: EngineDerived = {
    boostPa: 0,
    ffKgH: 0,
    afr: 0,
    oilPBar: 0,
    pwrKw: 0,
    cylPowerKw: new Array(N_CYL).fill(0),
  };
  integrate(s, out, p, inp, dt);
  return { state: s, out };
}

/** Same algebra as stepEngine, mutating the caller's state and output objects. */
export function stepEngineInto(
  s: EngineState,
  out: EngineDerived,
  p: EngineParams,
  inp: EngineInputs,
  dt: number,
): void {
  integrate(s, out, p, inp, dt);
}

/** Allocate a derived-output object for reuse with stepEngineInto. */
export function createDerived(): EngineDerived {
  return {
    boostPa: 0,
    ffKgH: 0,
    afr: 0,
    oilPBar: 0,
    pwrKw: 0,
    cylPowerKw: new Array(N_CYL).fill(0),
  };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
