// Mission profile planning and the headless single-run simulator.
// Profile: takeoff -> (climb/descent) -> cruise leg -> loiter holds -> descent
// -> landing. Every segment drives the same lumped engine model as the live
// sim, at the coarser mission integration rate (see ASSUMPTIONS.md).
import { atmosphere } from '../sim/atmosphere';
import { GUST, N_CYL, PHASES, TURB } from '../sim/constants';
import {
  createDerived,
  nominalParams,
  stepEngineInto,
  type EngineInputs,
  type EngineParams,
  type EngineState,
} from '../sim/engineModel';
import { engineParamsWithFaults } from '../sim/faults';
import { CHT_LIMIT_C, OILP_MIN_BAR, OILT_LIMIT_C } from '../sim/limits';
import { makeNormal, mulberry32 } from '../sim/rng';
import type { ActiveFaultInfo, EngineFaultKind, FaultSpec, Phase, Snapshot } from '../sim/types';
import {
  CEILING_DENSITY_ALT_M,
  CLIMB_RATE_MS,
  DESCENT_RATE_MS,
  LANDING_S,
  LONG_MISSION_S,
  LONG_MISSION_DT,
  LOITER_BANK_DEG,
  MC_REFRESH_PARAMS_S,
  MISSION_AIRSPEED,
  MISSION_DT,
  MISSION_POWER,
  MISSION_RESERVE_KG,
  MIN_GROUNDSPEED_MS,
  PWR_MARGIN_FRAC,
  TAKEOFF_S,
  VIB_LIMIT_MM_S,
  type SegKindName,
} from './constants';
import { bearingDeg, legGeometry, windComponents, type Waypoint } from './route';
import { legWeather, weatherOnLegInto, type WaypointWeather } from './weather';
import { destinationPoint, orbitRadiusM } from './geometry';

/** Coarser integration keeps an 8 h+ mission tractable; see ASSUMPTIONS.md. */
export function missionDtFor(totalS: number): number {
  return totalS > LONG_MISSION_S ? LONG_MISSION_DT : MISSION_DT;
}

export type SegKind = SegKindName;

/** Shaft power, kW, the airframe requires at this density ratio and rpm. */
export function requiredPowerKw(kind: SegKind, sigma: number): number {
  if (kind === 'takeoff' || kind === 'landing') return 0;
  const pw = MISSION_POWER[kind];
  const w = (pw.rpmTarget * Math.PI) / 30;
  return (pw.propC * sigma * w * w * w) / 1000;
}

export interface MissionSeg {
  kind: SegKind;
  legIndex: number; // -1 for bookend segments
  wxIndex: number; // waypoint whose weather applies
  phase: Phase;
  altStartM: number;
  altEndM: number;
  durS: number;
  distM: number;
  tasMs: number;
  gsMs: number;
  headwindMs: number;
  fromName: string;
  toName: string;
}

export interface LegPlan {
  index: number;
  fromName: string;
  toName: string;
  distM: number;
  bearingDeg: number;
  altM: number;
  gsMs: number;
  headwindMs: number;
  timeS: number;
  windLimited: boolean;
}

export interface MissionPlan {
  segs: MissionSeg[];
  legs: LegPlan[];
  totalS: number;
  cruiseDistM: number;
  loiterS: number;
  maxAltM: number;
}

export const DEFAULT_WEATHER: WaypointWeather = {
  isaDevC: 0,
  windDirDeg: 0,
  windSpdMs: 0,
  gustMs: 0,
  turb: 'none',
};

export function wxAt(wx: WaypointWeather[], i: number): WaypointWeather {
  if (!wx.length) return DEFAULT_WEATHER;
  return wx[Math.max(0, Math.min(i, wx.length - 1))];
}

export function planMission(wps: Waypoint[], wx: WaypointWeather[]): MissionPlan {
  const legsGeo = legGeometry(wps);
  const segs: MissionSeg[] = [];
  const legs: LegPlan[] = [];
  if (wps.length < 2) {
    return { segs, legs, totalS: 0, cruiseDistM: 0, loiterS: 0, maxAltM: wps[0]?.altM ?? 0 };
  }
  const base = wps[0];
  let alt = base.altM;
  segs.push({
    kind: 'takeoff',
    legIndex: -1,
    wxIndex: 0,
    phase: 'takeoff',
    altStartM: alt,
    altEndM: alt,
    durS: TAKEOFF_S,
    distM: 0,
    tasMs: MISSION_AIRSPEED.takeoff,
    gsMs: MISSION_AIRSPEED.takeoff,
    headwindMs: 0,
    fromName: base.name,
    toName: base.name,
  });

  for (let i = 0; i < legsGeo.length; i++) {
    const geo = legsGeo[i];
    const dest = wps[i + 1];
    const legWx = legWeather(wx, i);
    if (dest.altM > alt + 1) {
      segs.push({
        kind: 'climb',
        legIndex: i,
        wxIndex: i + 1,
        phase: 'climb',
        altStartM: alt,
        altEndM: dest.altM,
        durS: (dest.altM - alt) / CLIMB_RATE_MS,
        distM: 0,
        tasMs: MISSION_AIRSPEED.climb,
        gsMs: MISSION_AIRSPEED.climb,
        headwindMs: 0,
        fromName: geo.fromName,
        toName: geo.toName,
      });
    } else if (dest.altM < alt - 1) {
      segs.push({
        kind: 'descent',
        legIndex: i,
        wxIndex: i + 1,
        phase: 'descent',
        altStartM: alt,
        altEndM: dest.altM,
        durS: (alt - dest.altM) / DESCENT_RATE_MS,
        distM: 0,
        tasMs: MISSION_AIRSPEED.descent,
        gsMs: MISSION_AIRSPEED.descent,
        headwindMs: 0,
        fromName: geo.fromName,
        toName: geo.toName,
      });
    }
    alt = dest.altM;
    const tas = dest.speedMs ?? MISSION_AIRSPEED.cruise;
    // The leg is flown through interpolated weather, so its groundspeed is
    // planned on the mid-leg wind rather than on the destination's surface value.
    const { headwindMs } = windComponents(geo.bearingDeg, legWx.windDirDeg, legWx.windSpdMs);
    const gs = Math.max(MIN_GROUNDSPEED_MS, tas - headwindMs);
    const timeS = geo.distM / gs;
    segs.push({
      kind: 'cruise',
      legIndex: i,
      wxIndex: i + 1,
      phase: 'cruise',
      altStartM: alt,
      altEndM: alt,
      durS: timeS,
      distM: geo.distM,
      tasMs: tas,
      gsMs: gs,
      headwindMs,
      fromName: geo.fromName,
      toName: geo.toName,
    });
    legs.push({
      index: i,
      fromName: geo.fromName,
      toName: geo.toName,
      distM: geo.distM,
      bearingDeg: geo.bearingDeg,
      altM: alt,
      gsMs: gs,
      headwindMs,
      timeS,
      windLimited: tas - headwindMs < MIN_GROUNDSPEED_MS * 1.5,
    });
    if (dest.loiterMin > 0) {
      segs.push({
        kind: 'loiter',
        legIndex: i,
        wxIndex: i + 1,
        phase: 'loiter',
        altStartM: alt,
        altEndM: alt,
        durS: dest.loiterMin * 60,
        distM: 0,
        tasMs: MISSION_AIRSPEED.loiter,
        gsMs: 0,
        headwindMs: 0,
        fromName: dest.name,
        toName: dest.name,
      });
    }
  }

  const last = wps[wps.length - 1];
  segs.push({
    kind: 'landing',
    legIndex: legsGeo.length - 1,
    wxIndex: wps.length - 1,
    phase: 'descent',
    altStartM: last.altM,
    altEndM: last.altM,
    durS: LANDING_S,
    distM: 0,
    tasMs: MISSION_AIRSPEED.landing,
    gsMs: MISSION_AIRSPEED.landing,
    headwindMs: 0,
    fromName: last.name,
    toName: last.name,
  });

  return {
    segs,
    legs,
    totalS: segs.reduce((s, x) => s + x.durS, 0),
    cruiseDistM: legs.reduce((s, l) => s + l.distM, 0),
    loiterS: segs.filter((s) => s.kind === 'loiter').reduce((s, x) => s + x.durS, 0),
    maxAltM: Math.max(...wps.map((w) => w.altM)),
  };
}

// --- health import from the live simulation ------------------------------

export interface DegradationItem {
  kind: EngineFaultKind;
  cylinder: number; // 0 = whole engine
  severity: number; // 0..1 at mission start
}

export interface MissionHealth {
  items: DegradationItem[];
  state: EngineState | null; // live thermal state at mission start
}

export function itemsFromFaults(faults: ActiveFaultInfo[]): DegradationItem[] {
  return faults
    .filter((f) => f.scope === 'engine')
    .map((f) => ({ kind: f.kind as EngineFaultKind, cylinder: f.cylinder ?? 0, severity: f.severity }));
}

/** Mission start state taken from the live twin, faults and all. */
export function healthFromSnapshot(snap: Snapshot | null, fuelLoadKg: number): MissionHealth {
  if (!snap) return { items: [], state: null };
  const r = snap.readings;
  const ph = PHASES[snap.phase];
  const state: EngineState = {
    rpm: r.rpm.true,
    mapPa: r.map.true * 1000,
    cht: [r.cht1.true, r.cht2.true, r.cht3.true, r.cht4.true],
    egt: [r.egt1.true, r.egt2.true, r.egt3.true, r.egt4.true],
    oilTemp: r.oilT.true,
    throttle: ph.throttle,
    govInt: 0,
    vib: r.vib.true,
    fuelKg: Math.max(0, fuelLoadKg),
  };
  return { items: itemsFromFaults(snap.faults), state };
}

/** Engine parameters for the current degradation, with severity scaled. */
export function paramsForItems(items: DegradationItem[], scale: number): EngineParams {
  if (!items.length) return nominalParams();
  const specs: FaultSpec[] = items.map((it, i) => ({
    id: i + 1,
    scope: 'engine',
    kind: it.kind,
    severity: Math.max(0, Math.min(1, it.severity * scale)),
    rampTime: 0,
    cylinder: it.cylinder > 0 ? it.cylinder : undefined,
    tInject: 0,
  }));
  // rampProgress returns 1 for rampTime <= 0, so tInject is irrelevant here.
  return engineParamsWithFaults(nominalParams(), specs, 0);
}

export interface Breach {
  tS: number;
  legIndex: number;
  segKind: SegKind;
  channel: string;
  value: number;
  limit: number;
}

export interface LegStat {
  timeS: number;
  fuelKg: number;
  maxChtC: number;
  maxOilTC: number;
  minOilPBar: number;
  minPwrKw: number;
  meanPwrKw: number;
  breach: string | null;
  pwrSum: number;
}

/**
 * Weather and health quantities of the *planned* mission. They are read off the
 * profile before integration so they stay exogenous: an outcome-based driver
 * would be truncated by an early breach and would then "correlate" with failure
 * only because the failed run flew less of the route.
 */
export interface RunDrivers {
  isaMeanC: number;
  densAltMaxM: number;
  headwindMeanMs: number;
  headwindMaxMs: number;
  windMeanMs: number;
  turbIndex: number;
  loiterH: number;
  cruiseH: number;
  totalH: number;
  growthPerH: number;
  sevStart: number;
}

export function plannedDrivers(
  plan: MissionPlan,
  wx: WaypointWeather[],
  growthPerH: number,
  sevStart: number,
): RunDrivers {
  let isaSum = 0;
  let windSum = 0;
  let turbSum = 0;
  let densAltMax = -Infinity;
  let hwSum = 0;
  let hwMax = 0;
  let loiterS = 0;
  let cruiseS = 0;
  for (const seg of plan.segs) {
    const w = wxAt(wx, seg.wxIndex);
    const tf = TURB[w.turb].factor;
    isaSum += w.isaDevC * seg.durS;
    windSum += w.windSpdMs * seg.durS;
    turbSum += tf * seg.durS;
    for (const alt of [seg.altStartM, seg.altEndM]) {
      const d = atmosphere(alt, w.isaDevC).densityAltM;
      if (d > densAltMax) densAltMax = d;
    }
    if (seg.kind === 'loiter') loiterS += seg.durS;
    if (seg.kind === 'cruise') {
      cruiseS += seg.durS;
      hwSum += Math.max(0, seg.headwindMs) * seg.durS;
      if (seg.headwindMs > hwMax) hwMax = seg.headwindMs;
    }
  }
  const total = plan.totalS;
  return {
    isaMeanC: total > 0 ? isaSum / total : 0,
    densAltMaxM: Number.isFinite(densAltMax) ? densAltMax : 0,
    headwindMeanMs: cruiseS > 0 ? hwSum / cruiseS : 0,
    headwindMaxMs: hwMax,
    windMeanMs: total > 0 ? windSum / total : 0,
    turbIndex: total > 0 ? turbSum / total : 0,
    loiterH: loiterS / 3600,
    cruiseH: cruiseS / 3600,
    totalH: total / 3600,
    growthPerH,
    sevStart,
  };
}

export interface RunResult {
  completed: boolean;
  timeS: number;
  fuelUsedKg: number;
  fuelRemainingKg: number;
  marginKg: number;
  maxChtC: number;
  maxEgtC: number;
  maxOilTC: number;
  minOilPBar: number;
  maxVib: number;
  endSeverity: number;
  breach: Breach | null;
  legs: LegStat[];
  drivers: RunDrivers;
}

export interface RunOptions {
  plan?: MissionPlan; // derived from waypoints+weather when omitted
  waypoints?: Waypoint[];
  items: DegradationItem[];
  weather: WaypointWeather[]; // jittered for this run
  initState: EngineState;
  seed: number;
  growthPerH: number; // severity added per flight hour, per item
  dt?: number;
  checkLimits?: boolean;
  reserveKg?: number;
}

function newLegStat(): LegStat {
  return {
    timeS: 0,
    fuelKg: 0,
    maxChtC: -999,
    maxOilTC: -999,
    minOilPBar: 999,
    minPwrKw: 999,
    meanPwrKw: 0,
    pwrSum: 0,
    breach: null,
  };
}

/** Integrate one mission; the step loop allocates nothing. */
export function runMission(opts: RunOptions): RunResult {
  const dt = opts.dt ?? MISSION_DT;
  const checkLimits = opts.checkLimits !== false;
  const reserve = opts.reserveKg ?? MISSION_RESERVE_KG;
  const state: EngineState = {
    ...opts.initState,
    cht: opts.initState.cht.slice(),
    egt: opts.initState.egt.slice(),
  };
  const out = createDerived();
  const normal = makeNormal(mulberry32(opts.seed >>> 0));
  const plan = opts.plan ?? planMission(opts.waypoints ?? [], opts.weather);
  const segs = plan.segs;
  const legStats: LegStat[] = plan.legs.map(newLegStat);

  let t = 0;
  let ou = 0;
  let paramsT = -1e9;
  let params = paramsForItems(opts.items, 1);
  const inputs: EngineInputs = {
    atmos: atmosphere(0, 0),
    airspeedMs: 0,
    rpmTarget: 0,
    throttleBase: 0,
    afrCmd: 0,
    propC: 0,
    gustLoad: 1,
    gustThrottle: 0,
    gustRpm: 0,
  };

  let maxCht = -999;
  let maxEgt = -999;
  let maxOilT = -999;
  let minOilP = 999;
  let maxVib = 0;
  let breach: Breach | null = null;
  const startFuel = state.fuelKg;
  // Cruise weather is interpolated along the leg; reuse one object per run.
  const stepWx: WaypointWeather = {
    isaDevC: 0,
    windDirDeg: 0,
    windSpdMs: 0,
    gustMs: 0,
    turb: 'none',
  };

  for (let si = 0; si < segs.length && !breach; si++) {
    const seg = segs[si];
    const segWx = wxAt(opts.weather, seg.wxIndex);
    const pw = MISSION_POWER[seg.kind];
    const exemptThermal = seg.kind === 'takeoff' || seg.kind === 'landing';
    const checkPower = seg.kind === 'climb' || seg.kind === 'cruise' || seg.kind === 'loiter';
    const steps = Math.max(1, Math.round(seg.durS / dt));
    const stepDur = seg.durS / steps;
    const legIdx = seg.legIndex;
    const stat = legIdx >= 0 ? legStats[legIdx] : null;
    const fuelAtSegStart = state.fuelKg;
    let reqSum = 0;
    let reqTime = 0;
    let segPwrSum = 0;

    for (let k = 0; k < steps; k++) {
      const f = k / steps;
      const w =
        seg.kind === 'cruise'
          ? weatherOnLegInto(stepWx, opts.weather, legIdx, f)
          : segWx;
      const turb = TURB[w.turb];
      const alt = seg.altStartM + (seg.altEndM - seg.altStartM) * f;
      const a = atmosphere(alt, w.isaDevC);
      if (turb.factor > 0) {
        const sigma = turb.factor * 0.4 * Math.sqrt(2 * turb.tauS);
        ou += (-ou / turb.tauS) * stepDur + sigma * Math.sqrt(stepDur) * normal();
        if (ou > 3.5) ou = 3.5;
        else if (ou < -3.5) ou = -3.5;
      } else {
        ou = 0;
      }
      inputs.atmos = a;
      inputs.airspeedMs = seg.tasMs * (1 + 0.06 * turb.factor * ou);
      inputs.rpmTarget = pw.rpmTarget;
      inputs.throttleBase = pw.throttleBase;
      inputs.afrCmd = pw.afr;
      inputs.propC = pw.propC * a.sigma;
      inputs.gustLoad = 1 + GUST.load * turb.factor * ou;
      inputs.gustThrottle = GUST.throttle * turb.factor * ou;
      inputs.gustRpm = 0;
      if (checkPower) {
        reqSum += requiredPowerKw(seg.kind, a.sigma) * stepDur;
        reqTime += stepDur;
      }

      if (t - paramsT > MC_REFRESH_PARAMS_S) {
        paramsT = t;
        params = paramsForItems(opts.items, 1 + (opts.growthPerH * t) / 3600);
      }
      stepEngineInto(state, out, params, inputs, stepDur);
      t += stepDur;
      if (checkPower) segPwrSum += out.pwrKw * stepDur;

      let chtTop = -999;
      let egtTop = -999;
      for (let c = 0; c < N_CYL; c++) {
        const cv = state.cht[c];
        if (cv > chtTop) chtTop = cv;
        const ev = state.egt[c];
        if (ev > egtTop) egtTop = ev;
      }
      if (chtTop > maxCht) maxCht = chtTop;
      if (egtTop > maxEgt) maxEgt = egtTop;
      if (state.oilTemp > maxOilT) maxOilT = state.oilTemp;
      if (out.oilPBar < minOilP) minOilP = out.oilPBar;
      if (state.vib > maxVib) maxVib = state.vib;
      if (stat) {
        if (chtTop > stat.maxChtC) stat.maxChtC = chtTop;
        if (state.oilTemp > stat.maxOilTC) stat.maxOilTC = state.oilTemp;
        if (out.oilPBar < stat.minOilPBar) stat.minOilPBar = out.oilPBar;
        if (out.pwrKw < stat.minPwrKw) stat.minPwrKw = out.pwrKw;
        stat.pwrSum += out.pwrKw * stepDur;
        stat.timeS += stepDur;
      }

      if (checkLimits) {
        const b = checkBreach(t, seg, legIdx, chtTop, state.oilTemp, out.oilPBar, state.vib, a.densityAltM, exemptThermal);
        if (b) {
          breach = b;
          if (stat) stat.breach = b.channel;
          break;
        }
      }
    }
    if (stat) stat.fuelKg += fuelAtSegStart - state.fuelKg;
    if (checkLimits && !breach && checkPower && reqTime > 0) {
      const meanPwr = segPwrSum / reqTime;
      const req = reqSum / reqTime;
      if (meanPwr < PWR_MARGIN_FRAC * req) {
        breach = {
          tS: t,
          legIndex: legIdx,
          segKind: seg.kind,
          channel: 'Shaft Power',
          value: meanPwr,
          limit: PWR_MARGIN_FRAC * req,
        };
        if (stat) stat.breach = 'Shaft Power';
      }
    }
    if (state.fuelKg <= 0) {
      breach = { tS: t, legIndex: legIdx, segKind: seg.kind, channel: 'Fuel', value: 0, limit: reserve };
    }
  }

  if (checkLimits && !breach && state.fuelKg < reserve) {
    breach = {
      tS: t,
      legIndex: -1,
      segKind: 'landing',
      channel: 'Fuel',
      value: state.fuelKg,
      limit: reserve,
    };
  }

  for (const s of legStats) {
    s.meanPwrKw = s.timeS > 0 ? s.pwrSum / s.timeS : 0;
    if (s.maxChtC < -900) s.maxChtC = s.timeS > 0 ? maxCht : NaN;
  }

  const sevStart = opts.items.reduce((s, i) => Math.max(s, i.severity), 0);
  const endScale = 1 + (opts.growthPerH * t) / 3600;
  return {
    completed: !breach,
    timeS: t,
    fuelUsedKg: startFuel - state.fuelKg,
    fuelRemainingKg: state.fuelKg,
    marginKg: state.fuelKg - reserve,
    maxChtC: maxCht,
    maxEgtC: maxEgt,
    maxOilTC: maxOilT,
    minOilPBar: minOilP,
    maxVib: maxVib,
    endSeverity: Math.min(1, sevStart * endScale),
    breach,
    legs: legStats,
    drivers: plannedDrivers(plan, opts.weather, opts.growthPerH, sevStart),
  };
}

function checkBreach(
  t: number,
  seg: MissionSeg,
  legIdx: number,
  cht: number,
  oilT: number,
  oilP: number,
  vib: number,
  densAltM: number,
  exemptThermal: boolean,
): Breach | null {
  const mk = (channel: string, value: number, limit: number): Breach => ({
    tS: t,
    legIndex: legIdx,
    segKind: seg.kind,
    channel,
    value,
    limit,
  });
  // Above the density-altitude ceiling the airframe cannot hold level flight.
  if (densAltM > CEILING_DENSITY_ALT_M) return mk('Ceiling', densAltM, CEILING_DENSITY_ALT_M);
  // Takeoff and landing are short transients at rated power: the published
  // thermal limits apply to the sustained segments (see ASSUMPTIONS.md).
  if (!exemptThermal) {
    if (cht > CHT_LIMIT_C) return mk('CHT', cht, CHT_LIMIT_C);
    if (oilT > OILT_LIMIT_C) return mk('Oil Temp', oilT, OILT_LIMIT_C);
    if (oilP < OILP_MIN_BAR) return mk('Oil Press', oilP, OILP_MIN_BAR);
  }
  if (vib > VIB_LIMIT_MM_S) return mk('Vibration', vib, VIB_LIMIT_MM_S);
  return null;
}

/**
 * Distance flown along the planned route at a mission clock value, used by the
 * live monitor marker. Cruise legs advance along their polyline; a loiter flies
 * a level orbit of radius V^2/(g tan bank) around its hold point; climb and
 * bookend segments hold position.
 */
export interface ClockPosition {
  lat: number;
  lon: number;
  bearingDeg: number;
  legIndex: number;
  kind: SegKind;
  distM: number;
}

export function positionAtClock(plan: MissionPlan, wps: Waypoint[], clockS: number): ClockPosition | null {
  if (wps.length < 2 || plan.segs.length === 0) return null;
  const total = plan.totalS;
  if (total <= 0) return null;
  let rem = ((clockS % total) + total) % total;
  let dist = 0;
  for (const seg of plan.segs) {
    if (rem < seg.durS) {
      const legIndex = Math.max(0, Math.min(seg.legIndex < 0 ? 0 : seg.legIndex, wps.length - 2));
      if (seg.kind === 'loiter') {
        const center = wps[Math.min(seg.legIndex + 1, wps.length - 1)];
        const radius = orbitRadiusM(seg.tasMs, LOITER_BANK_DEG);
        const periodS = seg.tasMs > 0 ? (2 * Math.PI * radius) / seg.tasMs : seg.durS;
        const angle = ((((rem / Math.max(1e-6, periodS)) % 1) + 1) % 1) * 360;
        const p = destinationPoint(center.lat, center.lon, angle, radius);
        return {
          lat: p.lat,
          lon: p.lon,
          bearingDeg: (angle + 90) % 360,
          legIndex,
          kind: seg.kind,
          distM: dist,
        };
      }
      const frac =
        seg.kind === 'cruise' ? rem / seg.durS : seg.kind === 'landing' ? 1 : 0;
      dist += seg.distM * frac;
      const a = wps[legIndex];
      const b = wps[Math.min(legIndex + 1, wps.length - 1)];
      return {
        lat: a.lat + (b.lat - a.lat) * frac,
        lon: a.lon + (b.lon - a.lon) * frac,
        bearingDeg: bearingBetween(a, b),
        legIndex,
        kind: seg.kind,
        distM: dist,
      };
    }
    rem -= seg.durS;
    dist += seg.distM;
  }
  const last = wps[wps.length - 1];
  const prev = wps[wps.length - 2];
  return {
    lat: last.lat,
    lon: last.lon,
    bearingDeg: bearingBetween(prev, last),
    legIndex: wps.length - 2,
    kind: 'landing',
    distM: dist,
  };
}

function bearingBetween(a: Waypoint, b: Waypoint): number {
  return bearingDeg(a.lat, a.lon, b.lat, b.lon);
}
