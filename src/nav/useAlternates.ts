// Live alternate-airfield layer: assembles the NavState from the simulation,
// the mission weather and the diagnosis, and recomputes reachability on a
// one-second cadence (the UI runs at 10 Hz; re-evaluating fifteen great-circle
// problems every tick would only add noise to the readout).
import { useCallback, useEffect, useRef, useState } from 'react';
import { AIRFIELDS, airfieldsByIcao, type Airfield } from '../data/airfields';
import { PHASES } from '../sim/constants';
import { useSimStore } from '../state/store';
import { useMissionStore } from '../mission/missionStore';
import { presetById, distanceM, type Waypoint } from '../mission/route';
import { wxAt } from '../mission/mission';
import { computeAlternates, nearestReachable, type AlternateRow, type NavState } from './alternates';

/** The airfields offered as alternates when the route is hand-drawn. */
const CUSTOM_ALTERNATE_COUNT = 6;

export interface NavPosition {
  lat: number;
  lon: number;
  legIndex: number;
}

export interface NavLayer {
  rows: AlternateRow[];
  nearest: AlternateRow | null;
  reachable: AlternateRow | null;
  /** True while the diagnosis is WARNING or CRITICAL: the divert line is drawn. */
  alert: boolean;
  state: NavState | null;
}

const EMPTY_LAYER: NavLayer = { rows: [], nearest: null, reachable: null, alert: false, state: null };

/**
 * The airfields the active route is planned around. A preset's home and
 * destination are the mission's endpoints, not its alternates: the field under
 * the aircraft would otherwise read as the nearest alternate at zero distance.
 */
export function activeAirfields(presetId: string, wps: Waypoint[]): Airfield[] {
  const preset = presetById(presetId);
  if (preset) return airfieldsByIcao(preset.alternateIcaos);
  if (wps.length < 2) return [];
  const mid = {
    lat: wps.reduce((s, w) => s + w.lat, 0) / wps.length,
    lon: wps.reduce((s, w) => s + w.lon, 0) / wps.length,
  };
  return [...AIRFIELDS]
    .sort((p, q) => distanceM(mid.lat, mid.lon, p.lat, p.lon) - distanceM(mid.lat, mid.lon, q.lat, q.lon))
    .slice(0, CUSTOM_ALTERNATE_COUNT);
}

export function airfieldRole(presetId: string, icao: string): 'home' | 'dest' | 'alt' | null {
  const preset = presetById(presetId);
  if (!preset) return null;
  if (icao === preset.homeIcao) return 'home';
  if (icao === preset.destIcao) return 'dest';
  return preset.alternateIcaos.includes(icao) ? 'alt' : null;
}

function buildNavState(pos: NavPosition, fields: Airfield[]): NavLayer {
  const sim = useSimStore.getState();
  const alert = sim.diagnosis.state !== 'NOMINAL';
  if (!sim.snapshot) return { ...EMPTY_LAYER, alert };
  const w = wxAt(useMissionStore.getState().weather, pos.legIndex + 1);
  const ns: NavState = {
    lat: pos.lat,
    lon: pos.lon,
    // Altitude, density ratio, phase, power and fuel are the twin's own state;
    // the planned route altitude is a different quantity and is not substituted.
    altM: sim.snapshot.scenario.altitude,
    sigmaRatio: sim.snapshot.sigmaRatio,
    tasMs: PHASES[sim.snapshot.phase].airspeedMs,
    shaftPowerKw: sim.snapshot.readings.pwr.true,
    phase: sim.snapshot.phase,
    fuelKg: sim.snapshot.readings.fuel.measured,
    ffKgH: sim.ffSmoothKgH,
    windDirDeg: w.windDirDeg,
    windSpdMs: w.windSpdMs,
    rulP10S: sim.diagnosis.rul?.status === 'OK' ? sim.diagnosis.rul.p10S : null,
  };
  const rows = computeAlternates(ns, fields);
  return { rows, nearest: rows[0] ?? null, reachable: nearestReachable(rows), alert, state: ns };
}

export function useAlternates(pos: NavPosition | null, fields: Airfield[]): NavLayer {
  const [layer, setLayer] = useState<NavLayer>(EMPTY_LAYER);
  const srcRef = useRef({ pos, fields });
  srcRef.current = { pos, fields };

  const recompute = useCallback(() => {
    const { pos: p, fields: f } = srcRef.current;
    setLayer(
      p && f.length
        ? buildNavState(p, f)
        : { ...EMPTY_LAYER, alert: useSimStore.getState().diagnosis.state !== 'NOMINAL' },
    );
  }, []);

  useEffect(() => {
    recompute();
    const id = window.setInterval(recompute, 1000);
    return () => window.clearInterval(id);
  }, [recompute, fields]);

  return layer;
}
