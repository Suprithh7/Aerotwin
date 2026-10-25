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
import { clonePreset, clampToPresetBox, presetById, ROUTE_PRESETS, renameWaypoints, type Waypoint } from './route';
import { applyWeatherPreset, fetchLiveWeather, WEATHER_PRESETS, type WeatherCell, type WaypointWeather } from './weather';
import { useSimStore } from '../state/store';

export interface MissionStore {
  waypoints: Waypoint[];
  routePresetId: string;
  routeBasePresetId: string;
  routeEditMode: boolean;
  routeNotice: string | null;
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
  /** Identity of the inputs the stored result was computed from. */
  mcResultKey: string | null;
  mcError: string | null;
  setRoute: (presetId: string) => void;
  setRouteEditMode: (on: boolean) => void;
  resetPreset: () => void;
  dismissRouteNotice: () => void;
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
let mcSeq = 0;

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
  const clampNotice = 'WAYPOINT CLAMPED TO PRESET REGION (+/-2 DEG)';
  const editGuard = () => get().routeEditMode;
  const flagClamp = (clamped: boolean) => {
    if (clamped) set({ routeNotice: clampNotice });
  };
  return {
    waypoints: first.waypoints.map((w) => ({ ...w })),
    routePresetId: first.id,
    routeBasePresetId: first.id,
    routeEditMode: false,
    routeNotice: null,
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
    mcResultKey: null,
    mcError: null,

    setRoute: (presetId) => {
      const preset = presetById(presetId);
      if (!preset) return;
      const wps = clonePreset(presetId);
      set({
        waypoints: wps,
        routePresetId: presetId,
        routeBasePresetId: presetId,
        routeEditMode: false,
        routeNotice: null,
        weather: syncWeatherLength(get().weather, get().weatherPresetId, wps.length),
        mcResult: null,
        mcResultKey: null,
      });
    },

    setRouteEditMode: (on) => set({ routeEditMode: on, routeNotice: on ? get().routeNotice : null }),

    resetPreset: () => {
      const base = get().routeBasePresetId;
      const wps = clonePreset(base);
      set({
        waypoints: wps,
        routePresetId: base,
        routeEditMode: false,
        routeNotice: null,
        weather: syncWeatherLength(get().weather, get().weatherPresetId, wps.length),
        mcResult: null,
        mcResultKey: null,
      });
    },

    dismissRouteNotice: () => set({ routeNotice: null }),

    addWaypoint: (lat, lon) => {
      if (!editGuard()) return;
      const wps = get().waypoints;
      const last = wps[wps.length - 1];
      const p = clampToPresetBox(get().routeBasePresetId, lat, lon);
      const wp: Waypoint = {
        id: ++wpId,
        name: `WP${wps.length + 1}`,
        lat: p.lat,
        lon: p.lon,
        altM: last ? last.altM : 3000,
        loiterMin: 0,
      };
      const next = renameWaypoints([...wps, wp]);
      set({
        waypoints: next,
        routePresetId: 'custom',
        weather: syncWeatherLength(get().weather, get().weatherPresetId, next.length),
        mcResult: null,
        mcResultKey: null,
      });
      flagClamp(p.clamped);
    },

    moveWaypoint: (id, lat, lon) => {
      if (!editGuard()) return;
      const p = clampToPresetBox(get().routeBasePresetId, lat, lon);
      const next = get().waypoints.map((w) => (w.id === id ? { ...w, lat: p.lat, lon: p.lon } : w));
      set({ waypoints: next, routePresetId: 'custom', mcResult: null, mcResultKey: null });
      flagClamp(p.clamped);
    },

    setWaypointAlt: (id, altM) => {
      if (!editGuard()) return;
      const next = get().waypoints.map((w) => (w.id === id ? { ...w, altM: Math.max(0, Math.round(altM)) } : w));
      set({ waypoints: next, routePresetId: 'custom', mcResult: null, mcResultKey: null });
    },

    setWaypointLoiter: (id, minutes) => {
      if (!editGuard()) return;
      const next = get().waypoints.map((w) =>
        w.id === id ? { ...w, loiterMin: Math.max(0, Math.round(minutes)) } : w,
      );
      set({ waypoints: next, routePresetId: 'custom', mcResult: null, mcResultKey: null });
    },

    deleteWaypoint: (id) => {
      if (!editGuard()) return;
      const next = renameWaypoints(get().waypoints.filter((w) => w.id !== id));
      if (next.length < 2) return;
      set({
        waypoints: next,
        routePresetId: 'custom',
        weather: syncWeatherLength(get().weather, get().weatherPresetId, next.length),
        mcResult: null,
        mcResultKey: null,
      });
    },

    setWeatherPreset: (presetId) => {
      set({
        weatherPresetId: presetId,
        weather: cellsFromPreset(presetId, get().waypoints.length),
        wxNotice: null,
        mcResult: null,
        mcResultKey: null,
      });
    },

    setWeatherAt: (index, patch) => {
      const next = get().weather.map((c, i) => (i === index ? { ...c, ...patch } : c));
      set({ weather: next, mcResult: null, mcResultKey: null });
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
        mcResultKey: null,
      });
    },

    setRuns: (n) =>
      set({
        runs: Math.max(200, Math.min(1000, Math.round(n) || 200)),
        mcResult: null,
        mcResultKey: null,
      }),
    setSeed: (n) =>
      set({ seed: Math.max(0, Math.round(n) || 0) >>> 0, mcResult: null, mcResultKey: null }),

    runMission: async () => {
      const s = get();
      if (s.waypoints.length < 2) return;
      // A newer request supersedes an in-flight pool: only the latest request is
      // allowed to publish progress or results.
      const seq = ++mcSeq;
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
      const key = missionInputKey(s.waypoints, s.weather, s.runs, s.seed);
      set({ mcRunning: true, mcError: null, mcDone: 0, mcTotal: s.runs, mcResult: null, mcResultKey: null });
      try {
        const result = await runMonteCarloPool(req, (done, total) => {
          if (seq === mcSeq) set({ mcDone: done, mcTotal: total });
        });
        if (seq !== mcSeq) return;
        // The route, weather, runs or seed may have changed while the pool was
        // working; a result computed from inputs that no longer exist is dropped.
        if (missionInputKey(get().waypoints, get().weather, get().runs, get().seed) !== key) {
          set({ mcRunning: false });
          return;
        }
        set({ mcResult: result, mcResultKey: key, mcRunning: false });
      } catch (e) {
        if (seq === mcSeq) {
          set({ mcRunning: false, mcError: e instanceof Error ? e.message : String(e) });
        }
      }
    },

    resetMission: () => set({ mcResult: null, mcResultKey: null, mcError: null, mcDone: 0, mcTotal: 0 }),
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

/** Input identity for a Monte Carlo result, independent of object identities. */
export function missionInputKey(
  waypoints: Waypoint[],
  weather: WeatherCell[],
  runs: number,
  seed: number,
): string {
  return JSON.stringify({ w: waypoints, wx: weatherValues(weather), runs, seed });
}
