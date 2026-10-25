// Six computed pre-flight checks over one Mission. Every number comes from the
// resolved route, the weather cells and the bundled airports; nothing here is
// stored in the mission object.
import { AIRFIELDS, alternatesForSites } from '../data/airfields';
import { atmosphere } from '../sim/atmosphere';
import { settledEngineState } from '../sim/sim';
import { GLIDE_RATIO, airfieldsInGlideRange } from '../nav/alternates';
import { MAX_LINK_RANGE_KM, radioHorizonKm } from '../payload/link';
import {
  CEILING_DENSITY_ALT_M,
  MISSION_RESERVE_KG,
} from './constants';
import { zoneCrossings, routeSamples, type ZoneCrossing } from './geometry';
import { missionDtFor, planMission, runMission, wxAt, type MissionPlan } from './mission';
import { legGeometry, distanceM, type Waypoint } from './route';
import { terrainCached, terrainElevation } from './terrain';
import type { Mission } from './types';
import { engineFuelCapacityKg } from './types';
import type { Airfield } from '../data/airfields';
import type { TurbulenceLevel } from '../sim/types';
import type { WaypointWeather } from './weather';

export type CheckStatus = 'PASS' | 'CAUTION' | 'FAIL';

/** Cruise clearance is assessed outside this buffer at each route end. */
export const TERRAIN_TERMINAL_BUFFER_M = 1000;

export interface PreflightCheck {
  id: 'terrain' | 'zones' | 'fuel' | 'alternates' | 'datalink' | 'weather';
  label: string;
  status: CheckStatus;
  sentence: string;
}

export interface PreflightFuel {
  burnKg: number;
  marginKg: number;
  marginMin: number;
  reserveKg: number;
  loadKg: number;
  capacityKg: number;
}

export interface PreflightReport {
  checks: PreflightCheck[];
  plan: MissionPlan;
  fuel: PreflightFuel | null;
  zoneHits: ZoneCrossing[];
  minAglM: number;
  minAglLeg: string;
  linkKm: number;
  linkPct: number;
  gapLegs: string[];
  maxDensityAltM: number;
  worstTurb: TurbulenceLevel;
  terrainPending: boolean;
}

function fmtM(v: number): string {
  return `${Math.round(v)} m`;
}

function fmtMin(v: number): string {
  return `${Math.max(0, Math.round(v))} min`;
}

/** One nominal full-profile run with a healthy engine, limits not enforced. */
export function nominalFuel(
  wps: Waypoint[],
  weather: WaypointWeather[],
  fuelLoadKg: number,
): { burnKg: number; timeS: number } | null {
  if (wps.length < 2) return null;
  const plan = planMission(wps, weather);
  const start = settledEngineState(
    {
      phase: 'cruise',
      altitude: wps[0].altM,
      isaDev: Math.round(wxAt(weather, 0).isaDevC),
      turbulence: 'none',
    },
    fuelLoadKg,
  );
  const run = runMission({
    plan,
    waypoints: wps,
    items: [],
    weather,
    initState: start,
    seed: 1337,
    growthPerH: 0,
    checkLimits: false,
    dt: missionDtFor(plan.totalS),
    reserveKg: 0,
  });
  return { burnKg: run.fuelUsedKg, timeS: run.timeS };
}

interface TerrainResult {
  status: CheckStatus;
  sentence: string;
  minAglM: number;
  leg: string;
  pending: boolean;
}

function terrainCheck(wps: Waypoint[]): TerrainResult {
  if (wps.length < 2) {
    return {
      status: 'FAIL',
      sentence: 'A route needs at least two nodes.',
      minAglM: 0,
      leg: '—',
      pending: false,
    };
  }
  const legs = legGeometry(wps);
  const starts: number[] = [];
  let cum = 0;
  for (const l of legs) {
    starts.push(cum);
    cum += l.distM;
  }
  const totalM = cum;
  const samples = routeSamples(wps, 1000, 600);
  // The 100 m cruise minimum cannot apply on takeoff or landing, where the
  // planned altitude is the field elevation by definition.
  const bufferM = Math.min(TERRAIN_TERMINAL_BUFFER_M, totalM * 0.1);
  const cruise = samples.filter((s) => s.distM >= bufferM && s.distM <= totalM - bufferM);
  const evaluated = cruise.length ? cruise : samples;
  let minAgl = Infinity;
  let worstLeg = 0;
  let missing = 0;
  for (const s of evaluated) {
    const i = Math.max(0, Math.min(s.legIndex, legs.length - 1));
    const leg = legs[i];
    const f = leg.distM > 0 ? Math.max(0, Math.min(1, (s.distM - starts[i]) / leg.distM)) : 0;
    const alt = wps[i].altM + (wps[i + 1].altM - wps[i].altM) * f;
    if (terrainCached(s.lat, s.lon) === undefined) missing++;
    const agl = alt - terrainElevation(s.lat, s.lon);
    if (agl < minAgl) {
      minAgl = agl;
      worstLeg = i;
    }
  }
  const legName = `${wps[worstLeg]?.name ?? '—'} - ${wps[Math.min(worstLeg + 1, wps.length - 1)]?.name ?? '—'}`;
  const pending = missing > Math.max(4, evaluated.length * 0.1);
  if (pending) {
    return {
      status: 'CAUTION',
      sentence: `Terrain elevations are still resolving for ${missing} of ${samples.length} route samples.`,
      minAglM: minAgl,
      leg: legName,
      pending,
    };
  }
  if (minAgl < 0) {
    return {
      status: 'FAIL',
      sentence: `The planned path goes ${fmtM(-minAgl)} below terrain on ${legName}.`,
      minAglM: minAgl,
      leg: legName,
      pending,
    };
  }
  if (minAgl < 100) {
    return {
      status: 'CAUTION',
      sentence: `Minimum clearance is ${fmtM(minAgl)} AGL on ${legName}, below the 100 m minimum.`,
      minAglM: minAgl,
      leg: legName,
      pending,
    };
  }
  return {
    status: 'PASS',
    sentence: `Minimum clearance is ${fmtM(minAgl)} AGL on ${legName}, above the 100 m minimum.`,
    minAglM: minAgl,
    leg: legName,
    pending,
  };
}

function zonesCheck(mission: Mission, wps: Waypoint[]): {
  status: CheckStatus;
  sentence: string;
  hits: ZoneCrossing[];
} {
  const hits = zoneCrossings(mission.zones, wps);
  if (!hits.length) {
    return { status: 'PASS', sentence: 'The route crosses no denied or restricted zone.', hits };
  }
  const parts = hits.map(
    (h) => `${h.zone.name} (${h.zone.type}) on ${h.fromName} - ${h.toName}`,
  );
  return {
    status: 'CAUTION',
    sentence: `Route crosses ${parts.join('; ')}.`,
    hits,
  };
}

function fuelCheck(
  mission: Mission,
  wps: Waypoint[],
  weather: WaypointWeather[],
  plan: MissionPlan,
): { status: CheckStatus; sentence: string; fuel: PreflightFuel | null } {
  if (plan.totalS <= 0) {
    return { status: 'FAIL', sentence: 'The profile could not be planned.', fuel: null };
  }
  const fuelLoadKg = mission.fuelLoadKg;
  const nominal = nominalFuel(wps, weather, fuelLoadKg);
  if (!nominal) return { status: 'FAIL', sentence: 'No nominal run was possible.', fuel: null };
  const marginKg = fuelLoadKg - nominal.burnKg - MISSION_RESERVE_KG;
  const burnPerMin = nominal.burnKg / Math.max(1, nominal.timeS / 60);
  const marginMin = marginKg / Math.max(0.01, burnPerMin);
  const fuel: PreflightFuel = {
    burnKg: nominal.burnKg,
    marginKg,
    marginMin,
    reserveKg: MISSION_RESERVE_KG,
    loadKg: fuelLoadKg,
    capacityKg: engineFuelCapacityKg(mission.engineProfileId),
  };
  const sentence =
    `Loaded ${fuelLoadKg} kg; nominal burn ${nominal.burnKg.toFixed(1)} kg leaves ` +
    `${marginKg.toFixed(1)} kg (${fmtMin(marginMin)}) after the 30 min reserve.`;
  if (marginKg < 0) return { status: 'FAIL', sentence, fuel };
  if (marginKg < 6) return { status: 'CAUTION', sentence, fuel };
  return { status: 'PASS', sentence, fuel };
}

function alternatesCheck(
  mission: Mission,
  wps: Waypoint[],
): { status: CheckStatus; sentence: string; gapLegs: string[] } {
  const fields: Airfield[] = [...AIRFIELDS, ...alternatesForSites(mission.customSites)];
  const gaps: string[] = [];
  for (let i = 0; i < wps.length - 1; i++) {
    const a = wps[i];
    const b = wps[i + 1];
    const lat = (a.lat + b.lat) / 2;
    const lon = (a.lon + b.lon) / 2;
    const alt = (a.altM + b.altM) / 2;
    if (!airfieldsInGlideRange(lat, lon, alt, fields).length) {
      gaps.push(`${a.name} - ${b.name}`);
    }
  }
  if (!gaps.length) {
    return {
      status: 'PASS',
      sentence: `Every leg has a landing site inside engine-out glide range (${Math.round(GLIDE_RATIO)}:1).`,
      gapLegs: gaps,
    };
  }
  return {
    status: 'CAUTION',
    sentence: `No landing site in glide range on ${gaps.join('; ')}.`,
    gapLegs: gaps,
  };
}

function datalinkCheck(
  mission: Mission,
  wps: Waypoint[],
): { status: CheckStatus; sentence: string; linkKm: number; linkPct: number } {
  const legs = legGeometry(wps);
  const samples = routeSamples(wps, 2000, 500);
  if (samples.length < 2 || !legs.length) {
    return { status: 'FAIL', sentence: 'No route to evaluate.', linkKm: 0, linkPct: 0 };
  }
  let totalM = 0;
  let coveredM = 0;
  for (let i = 1; i < samples.length; i++) {
    const p = samples[i];
    const prev = samples[i - 1];
    const leg = legs[Math.max(0, Math.min(p.legIndex, legs.length - 1))];
    const alt = wps[leg.index].altM;
    const segM = Math.max(0, p.distM - prev.distM);
    const rangeKm = Math.min(MAX_LINK_RANGE_KM, radioHorizonKm(alt));
    const distKm =
      distanceM(p.lat, p.lon, mission.groundStation.lat, mission.groundStation.lon) / 1000;
    totalM += segM;
    if (distKm <= rangeKm) coveredM += segM;
  }
  const pct = totalM > 0 ? coveredM / totalM : 0;
  const linkKm = coveredM / 1000;
  const sentence = `Link to the ground station covers ${linkKm.toFixed(0)} km, ${(pct * 100).toFixed(0)}% of the route.`;
  if (pct >= 0.9) return { status: 'PASS', sentence, linkKm, linkPct: pct };
  if (pct >= 0.6) return { status: 'CAUTION', sentence, linkKm, linkPct: pct };
  return { status: 'FAIL', sentence, linkKm, linkPct: pct };
}

function weatherCheck(
  wps: Waypoint[],
  plan: MissionPlan,
  weather: WaypointWeather[],
): {
  status: CheckStatus;
  sentence: string;
  maxDensityAltM: number;
  worstTurb: TurbulenceLevel;
} {
  const order: TurbulenceLevel[] = ['none', 'light', 'moderate', 'severe'];
  let worst: TurbulenceLevel = 'none';
  for (const w of weather) {
    if (order.indexOf(w.turb) > order.indexOf(worst)) worst = w.turb;
  }
  let maxDa = 0;
  let maxDaAlt = 0;
  for (const seg of plan.segs) {
    const w = wxAt(weather, seg.wxIndex);
    for (const alt of [seg.altStartM, seg.altEndM]) {
      const da = atmosphere(alt, w.isaDevC).densityAltM;
      if (da > maxDa) {
        maxDa = da;
        maxDaAlt = alt;
      }
    }
  }
  for (let i = 0; i < wps.length; i++) {
    const da = atmosphere(wps[i].altM, wxAt(weather, i).isaDevC).densityAltM;
    if (da > maxDa) {
      maxDa = da;
      maxDaAlt = wps[i].altM;
    }
  }
  const marginM = CEILING_DENSITY_ALT_M - maxDa;
  if (maxDa > CEILING_DENSITY_ALT_M) {
    return {
      status: 'FAIL',
      sentence: `Density altitude reaches ${fmtM(maxDa)} near ${Math.round(maxDaAlt)} m AMSL, above the ${Math.round(CEILING_DENSITY_ALT_M / 1000)} km ceiling, with ${worst} turbulence at the worst node.`,
      maxDensityAltM: maxDa,
      worstTurb: worst,
    };
  }
  if (worst === 'severe' || marginM < 500) {
    return {
      status: 'CAUTION',
      sentence: `Density altitude peaks at ${fmtM(maxDa)}, ${fmtM(marginM)} below the ceiling, with ${worst} turbulence at the worst node.`,
      maxDensityAltM: maxDa,
      worstTurb: worst,
    };
  }
  return {
    status: 'PASS',
    sentence: `Density altitude peaks at ${fmtM(maxDa)}, ${fmtM(marginM)} below the ceiling, with ${worst} turbulence at the worst node.`,
    maxDensityAltM: maxDa,
    worstTurb: worst,
  };
}

export function buildPreflight(
  mission: Mission,
  wps: Waypoint[],
  weather: WaypointWeather[],
): PreflightReport {
  const plan = planMission(wps, weather);
  const terrain = terrainCheck(wps);
  const zones = zonesCheck(mission, wps);
  const fuel = fuelCheck(mission, wps, weather, plan);
  const alternates = alternatesCheck(mission, wps);
  const datalink = datalinkCheck(mission, wps);
  const wx = weatherCheck(wps, plan, weather);
  return {
    checks: [
      { id: 'terrain', label: 'TERRAIN CLEARANCE', status: terrain.status, sentence: terrain.sentence },
      { id: 'zones', label: 'ZONES', status: zones.status, sentence: zones.sentence },
      { id: 'fuel', label: 'FUEL', status: fuel.status, sentence: fuel.sentence },
      { id: 'alternates', label: 'ALTERNATES', status: alternates.status, sentence: alternates.sentence },
      { id: 'datalink', label: 'DATALINK', status: datalink.status, sentence: datalink.sentence },
      { id: 'weather', label: 'WEATHER', status: wx.status, sentence: wx.sentence },
    ],
    plan,
    fuel: fuel.fuel,
    zoneHits: zones.hits,
    minAglM: terrain.minAglM,
    minAglLeg: terrain.leg,
    linkKm: datalink.linkKm,
    linkPct: datalink.linkPct,
    gapLegs: alternates.gapLegs,
    maxDensityAltM: wx.maxDensityAltM,
    worstTurb: wx.worstTurb,
    terrainPending: terrain.pending,
  };
}
