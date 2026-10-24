import { create } from 'zustand';
import { MISSION_FUEL_KG, MISSION_RESERVE_KG } from './constants';
import {
  healthFromSnapshot,
  planMission,
  positionAtClock,
  type ClockPosition,
  type DegradationItem,
  type MissionPlan,
} from './mission';
import { runMonteCarloPool, type McRequest, type McResult } from './monteCarlo';
import { clonePreset, presetById, ROUTE_PRESETS, renameWaypoints, type Waypoint } from './route';
import { applyWeatherPreset, fetchLiveWeather, WEATHER_PRESETS, type WeatherCell, type WaypointWeather } from './weather';
import { useSimStore } from '../state/store';

export interface MissionStore {
  waypoints: Waypoint[];
  routePresetId: string;
  weatherPresetId: string;
  weather: WeatherCell[];
  wxNotice: string | null;
  fetchingWx: boolean;
  runs: number;
  seed: number;
  mcRunning: boolean;
  mcDone: number;
  mcTotal: number;
  mcResult: McResult | null;
  mcError: string | null;
  setRoute: (presetId: string) => void;
  addWaypoint: (lat: number, lon: number) => void;
  moveWaypoint: (id: number, lat: number, lon: number) => void;
  setWaypointAlt: (id: number, altM: number) => void;
  setWaypointLoiter: (id: number, minutes: number) => void;
  deleteWaypoint: (id: number) => void;
  setWeatherPreset: (presetId: string) => void;
  setWeatherAt: (index: number, patch: Partial<WaypointWeather>) => void;
  fetchLive: () => Promise<void>;
  setRuns: (n: number) => void;
  setSeed: (n: number) => void;
  runMission: () => Promise<void>;
  resetMission: () => void;
}

let wpId = 5000;

function cellsFromPreset(presetId: string, n: number): WeatherCell[] {
  const wx = applyWeatherPreset(presetId, n);
  return wx.map((w) => ({ ...w, source: { kind: 'preset' as const } }));
}

function syncWeatherLength(cells: WeatherCell[], presetId: string, n: number): WeatherCell[] {
  const out = cells.slice(0, n);
  const base = cellsFromPreset(presetId, n);
  for (let i = out.length; i < n; i++) out.push(base[i]);
  return out;
}

export function weatherValues(cells: WeatherCell[]): WaypointWeather[] {
  return cells.map((c) => ({
    isaDevC: c.isaDevC,
    windDirDeg: c.windDirDeg,
    windSpdMs: c.windSpdMs,
    gustMs: c.gustMs,
    turb: c.turb,
  }));
}

/** Engine degradation carried into the mission: live faults plus their state. */
export function missionHealthInput(): { items: DegradationItem[]; state: McRequest['initState'] } {
  const snap = useSimStore.getState().snapshot;
  const h = healthFromSnapshot(snap);
  return { items: h.items, state: h.state };
}

export const useMissionStore = create<MissionStore>((set, get) => {
  const first = ROUTE_PRESETS[0];
  return {
    waypoints: first.waypoints.map((w) => ({ ...w })),
    routePresetId: first.id,
    weatherPresetId: first.suggestedWeather,
    weather: cellsFromPreset(first.suggestedWeather, first.waypoints.length),
    wxNotice: null,
    fetchingWx: false,
    runs: 200,
    seed: 1337,
    mcRunning: false,
    mcDone: 0,
    mcTotal: 0,
    mcResult: null,
    mcError: null,

    setRoute: (presetId) => {
      const preset = presetById(presetId);
      if (!preset) return;
      const wps = clonePreset(presetId);
      set({
        waypoints: wps,
        routePresetId: presetId,
        weather: syncWeatherLength(get().weather, get().weatherPresetId, wps.length),
        mcResult: null,
      });
    },

    addWaypoint: (lat, lon) => {
      const wps = get().waypoints;
      const last = wps[wps.length - 1];
      const wp: Waypoint = {
        id: ++wpId,
        name: `WP${wps.length + 1}`,
        lat,
        lon,
        altM: last ? last.altM : 3000,
        loiterMin: 0,
      };
      const next = renameWaypoints([...wps, wp]);
      set({
        waypoints: next,
        routePresetId: 'custom',
        weather: syncWeatherLength(get().weather, get().weatherPresetId, next.length),
        mcResult: null,
      });
    },

    moveWaypoint: (id, lat, lon) => {
      const next = get().waypoints.map((w) => (w.id === id ? { ...w, lat, lon } : w));
      set({ waypoints: next, routePresetId: 'custom', mcResult: null });
    },

    setWaypointAlt: (id, altM) => {
      const next = get().waypoints.map((w) => (w.id === id ? { ...w, altM: Math.max(0, Math.round(altM)) } : w));
      set({ waypoints: next, routePresetId: 'custom', mcResult: null });
    },

    setWaypointLoiter: (id, minutes) => {
      const next = get().waypoints.map((w) =>
        w.id === id ? { ...w, loiterMin: Math.max(0, Math.round(minutes)) } : w,
      );
      set({ waypoints: next, routePresetId: 'custom', mcResult: null });
    },

    deleteWaypoint: (id) => {
      const next = renameWaypoints(get().waypoints.filter((w) => w.id !== id));
      if (next.length < 2) return;
      set({
        waypoints: next,
        routePresetId: 'custom',
        weather: syncWeatherLength(get().weather, get().weatherPresetId, next.length),
        mcResult: null,
      });
    },

    setWeatherPreset: (presetId) => {
      set({
        weatherPresetId: presetId,
        weather: cellsFromPreset(presetId, get().waypoints.length),
        wxNotice: null,
        mcResult: null,
      });
    },

    setWeatherAt: (index, patch) => {
      const next = get().weather.map((c, i) => (i === index ? { ...c, ...patch } : c));
      set({ weather: next, mcResult: null });
    },

    fetchLive: async () => {
      if (get().fetchingWx) return;
      set({ fetchingWx: true, wxNotice: null });
      const fallback = weatherValues(get().weather);
      const res = await fetchLiveWeather(get().waypoints, fallback);
      set({
        weather: res.cells.map((c) => c as WeatherCell),
        fetchingWx: false,
        wxNotice: res.notice,
        mcResult: null,
      });
    },

    setRuns: (n) => set({ runs: Math.max(200, Math.min(1000, Math.round(n) || 200)) }),
    setSeed: (n) => set({ seed: Math.max(0, Math.round(n) || 0) >>> 0 }),

    runMission: async () => {
      const s = get();
      if (s.mcRunning || s.waypoints.length < 2) return;
      const health = missionHealthInput();
      const req: McRequest = {
        waypoints: s.waypoints,
        weather: weatherValues(s.weather),
        items: health.items,
        initState: health.state,
        runs: s.runs,
        seed: s.seed,
        growthPerH: null,
      };
      set({ mcRunning: true, mcError: null, mcDone: 0, mcTotal: s.runs, mcResult: null });
      try {
        const result = await runMonteCarloPool(req, (done, total) => set({ mcDone: done, mcTotal: total }));
        set({ mcResult: result, mcRunning: false });
      } catch (e) {
        set({ mcRunning: false, mcError: e instanceof Error ? e.message : String(e) });
      }
    },

    resetMission: () => set({ mcResult: null, mcError: null, mcDone: 0, mcTotal: 0 }),
  };
});

/** Derived plan for the current route and weather; cheap enough to memoize by identity. */
let planCache: { key: string; plan: MissionPlan } | null = null;
export function currentPlan(waypoints: Waypoint[], weather: WeatherCell[]): MissionPlan {
  const key = `${JSON.stringify(waypoints)}|${JSON.stringify(weatherValues(weather))}`;
  if (planCache && planCache.key === key) return planCache.plan;
  const plan = planMission(waypoints, weatherValues(weather));
  planCache = { key, plan };
  return plan;
}

export function missionClockPosition(
  waypoints: Waypoint[],
  weather: WeatherCell[],
  clockS: number,
): ClockPosition | null {
  if (waypoints.length < 2) return null;
  return positionAtClock(currentPlan(waypoints, weather), waypoints, clockS);
}

export const MISSION_FUEL = { loadedKg: MISSION_FUEL_KG, reserveKg: MISSION_RESERVE_KG };

export function legRiskColor(breachFrac: number): string {
  // blue -> red ramp over the per-leg breach probability
  const t = Math.max(0, Math.min(1, breachFrac));
  const a = [91, 141, 184];
  const b = [196, 68, 63];
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export const WX_PRESET_LIST = WEATHER_PRESETS.map((p) => ({ id: p.id, name: p.name }));
export const ROUTE_LIST = ROUTE_PRESETS.map((p) => ({ id: p.id, name: p.name, region: p.region }));
