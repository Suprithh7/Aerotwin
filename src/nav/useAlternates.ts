// Live alternate-airfield layer: assembles the NavState from the simulation,
// the mission weather and the diagnosis, and recomputes reachability on a
// one-second cadence (the UI runs at 10 Hz; re-evaluating every nearby field
// every tick would only add noise to the readout).
import { useCallback, useEffect, useRef, useState } from 'react';
import { AIRFIELDS, alternatesForSites, type Airfield } from '../data/airfields';
import { PHASES } from '../sim/constants';
import { useSimStore } from '../state/store';
import { useMissionStore } from '../mission/missionStore';
import { distanceM } from '../mission/route';
import type { Mission } from '../mission/types';
import { wxAt } from '../mission/mission';
import { computeAlternates, nearestReachable, type AlternateRow, type NavState } from './alternates';

/** Fields farther than this from the aircraft are not offered as alternates. */
export const MAX_ALTERNATE_RADIUS_M = 400_000;

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
 * All bundled airports plus the mission's custom landing sites within 400 km of
 * the aircraft, nearest first. The mission's own endpoints are not excluded:
 * the aircraft standing over its destination should see it as the nearest field.
 */
export function alternateFields(mission: Mission, lat: number, lon: number): Airfield[] {
  return [...AIRFIELDS, ...alternatesForSites(mission.customSites)]
    .map((airfield) => ({ airfield, distM: distanceM(lat, lon, airfield.lat, airfield.lon) }))
    .filter((x) => x.distM <= MAX_ALTERNATE_RADIUS_M)
    .sort((a, b) => a.distM - b.distM)
    .map((x) => x.airfield);
}

function buildNavState(pos: NavPosition, mission: Mission): NavLayer {
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
  const rows = computeAlternates(ns, alternateFields(mission, pos.lat, pos.lon));
  return { rows, nearest: rows[0] ?? null, reachable: nearestReachable(rows), alert, state: ns };
}

export function useAlternates(pos: NavPosition | null, mission: Mission | null): NavLayer {
  const [layer, setLayer] = useState<NavLayer>(EMPTY_LAYER);
  const srcRef = useRef({ pos, mission });
  srcRef.current = { pos, mission };

  const recompute = useCallback(() => {
    const { pos: p, mission: m } = srcRef.current;
    setLayer(
      p && m
        ? buildNavState(p, m)
        : { ...EMPTY_LAYER, alert: useSimStore.getState().diagnosis.state !== 'NOMINAL' },
    );
  }, []);

  useEffect(() => {
    recompute();
    const id = window.setInterval(recompute, 1000);
    return () => window.clearInterval(id);
  }, [recompute, mission]);

  return layer;
}
