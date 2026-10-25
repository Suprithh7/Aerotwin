// The mission planner store. One Mission object is the single source of truth
// for the brief, flight, risk assessment, alternates, payload and Data Guard;
// editing actions snapshot the previous mission for undo/redo.
import { create } from 'zustand';
import {
  healthFromSnapshot,
  planMission,
  positionAtClock,
  type ClockPosition,
  type DegradationItem,
  type MissionPlan,
} from './mission';
import { runMonteCarloPool, type McRequest, type McResult } from './monteCarlo';
import { resolveWaypoints, terrainKey, terrainElevation, fetchTerrain, cachedTerrainMap, type TerrainMap } from './terrain';
import {
  applyOverrides,
  fallbackCell,
  fetchForecast,
  weatherValues as valuesOf,
  type WeatherCell,
  type WeatherOverrides,
  type WaypointWeather,
} from './weather';
import { buildTrack, distanceM } from './route';
import { missionFromGeoJson, missionToGeoJsonText } from './geoJson';
import {
  MAX_NODES,
  clampFuelLoadKg,
  type LandingSite,
  type Mission,
  type MissionNode,
  type MissionZone,
  type NodeType,
  type SiteType,
  type WeatherMode,
} from './types';
import { MISSION_TEMPLATES, templateById } from '../data/templates';
import { useSimStore } from '../state/store';
import { mulberry32 } from '../sim/rng';
import { routeSamples } from './geometry';

export type EditorMode = 'select' | 'draw-zone' | 'add-site';
export type SearchStatus = 'idle' | 'loading' | 'done' | 'error';

export interface PlaceResult {
  id: number;
  name: string;
  detail: string;
  lat: number;
  lon: number;
}

export interface SavedMission {
  id: string;
  name: string;
  savedAt: string;
  mission: Mission;
}

export interface FlyTarget {
  lat: number;
  lon: number;
  seq: number;
}

export type NodePatch = Omit<Partial<MissionNode>, 'speed'> & { speed?: number | null };

export interface MissionStore {
  mission: Mission;
  past: Mission[];
  future: Mission[];
  selectedNodeId: number | null;
  selectedZoneId: number | null;
  selectedSiteId: number | null;
  mode: EditorMode;
  draftZone: [number, number][];
  notice: string | null;
  flyTarget: FlyTarget | null;
  searchQuery: string;
  searchStatus: SearchStatus;
  searchResults: PlaceResult[];
  baseWeather: WeatherCell[];
  weather: WeatherCell[];
  overrides: WeatherOverrides;
  wxNotice: string | null;
  fetchingWx: boolean;
  wxKey: string | null;
  terrain: TerrainMap;
  terrainFetching: boolean;
  saved: SavedMission[];
  /** Bumped when a whole mission is replaced, so the map re-frames the route. */
  fitSeq: number;
  runs: number;
  seed: number;
  mcRunning: boolean;
  mcDone: number;
  mcTotal: number;
  mcResult: McResult | null;
  mcResultKey: string | null;
  mcError: string | null;

  // history
  undo: () => void;
  redo: () => void;

  // mission identity and data
  setMissionName: (name: string) => void;
  setStartTime: (istValue: string) => boolean;
  setWeatherMode: (mode: WeatherMode) => void;
  setEngineProfile: (id: string) => void;
  setFuelLoadKg: (kg: number) => boolean;

  // nodes
  addNodeAt: (lat: number, lon: number, type?: NodeType) => void;
  insertNodeAfter: (index: number, lat: number, lon: number) => void;
  moveNode: (id: number, lat: number, lon: number) => void;
  updateNode: (id: number, patch: NodePatch) => boolean;
  deleteNode: (id: number) => void;
  reorderNode: (from: number, to: number) => void;
  selectNode: (id: number | null) => void;
  autoPlaceRecon: (count: number) => boolean;

  // zones
  startZoneDraw: () => void;
  addZoneVertex: (lat: number, lon: number) => void;
  finishZone: () => void;
  cancelMode: () => void;
  updateZone: (id: number, patch: Partial<Pick<MissionZone, 'name' | 'type'>>) => void;
  moveZoneVertex: (id: number, index: number, lat: number, lon: number) => void;
  deleteZone: (id: number) => void;
  selectZone: (id: number | null) => void;

  // ground station and sites
  setGround: (lat: number, lon: number) => void;
  startSitePlacement: () => void;
  addSiteAt: (lat: number, lon: number) => void;
  updateSite: (id: number, patch: Partial<LandingSite>) => void;
  deleteSite: (id: number) => void;
  selectSite: (id: number | null) => void;

  // weather
  setWeatherOverride: (nodeId: number, patch: Partial<WaypointWeather>) => void;
  clearWeatherOverride: (nodeId: number) => void;
  refreshWeather: () => Promise<void>;
  ensureTerrain: () => Promise<void>;

  // search
  search: (query: string) => Promise<void>;
  setSearchQuery: (q: string) => void;
  flyTo: (lat: number, lon: number) => void;
  clearSearch: () => void;

  // missions
  loadTemplate: (id: string) => void;
  resetToTemplate: () => void;
  saveMission: (name?: string) => void;
  loadSavedMission: (id: string) => void;
  duplicateSavedMission: (id: string) => void;
  deleteSavedMission: (id: string) => void;
  exportMission: () => string;
  importMission: (text: string) => { ok: boolean; error: string | null };
  dismissNotice: () => void;

  // assessment
  setRuns: (n: number) => void;
  setSeed: (n: number) => void;
  runAssessment: () => Promise<void>;
}

const SAVED_KEY = 'aerotwin.missions.v1';
const HISTORY_LIMIT = 100;
const ID_RESERVED = 1000;

let mcSeq = 0;
let weatherSeq = 0;
let weatherTimer: number | null = null;
let terrainSeq = 0;
let terrainTimer: number | null = null;
let searchSeq = 0;
let flySeq = 0;
let idSeq = 2000;

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function nextItemId(items: { id: number }[]): number {
  const top = items.reduce((m, i) => Math.max(m, i.id), ID_RESERVED);
  idSeq = Math.max(idSeq, top);
  return ++idSeq;
}

function nextNodeName(nodes: MissionNode[], base = 'WP'): string {
  let n = nodes.length + 1;
  const names = new Set(nodes.map((x) => x.name.toUpperCase()));
  while (names.has(`${base}${n}`.toUpperCase())) n++;
  return `${base}${n}`;
}

function hashString(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function safeReadSaved(): SavedMission[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is SavedMission =>
        !!s &&
        typeof s === 'object' &&
        typeof (s as SavedMission).id === 'string' &&
        typeof (s as SavedMission).name === 'string' &&
        !!(s as SavedMission).mission &&
        Array.isArray((s as SavedMission).mission.nodes),
    );
  } catch {
    return [];
  }
}

function writeSaved(saved: SavedMission[]): void {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
  } catch {
    /* storage unavailable: the in-memory list still works for this session */
  }
}

function cloneMission(m: Mission): Mission {
  return {
    ...m,
    fuelLoadKg: clampFuelLoadKg(m.fuelLoadKg, m.engineProfileId),
    nodes: m.nodes.map((n) => ({ ...n })),
    zones: m.zones.map((z) => ({ ...z, polygon: z.polygon.map((p) => [...p] as [number, number]) })),
    customSites: m.customSites.map((s) => ({ ...s })),
    groundStation: { ...m.groundStation },
  };
}

function fallbackCells(n: number): WeatherCell[] {
  return Array.from({ length: n }, () => fallbackCell());
}

function alignWeather(prev: Mission, prevCells: WeatherCell[], next: Mission): WeatherCell[] {
  const byId = new Map(prev.nodes.map((n, i) => [n.id, prevCells[i]]));
  return next.nodes.map((n) => byId.get(n.id) ?? fallbackCell());
}

export function weatherValues(cells: WeatherCell[] | WaypointWeather[]): WaypointWeather[] {
  return valuesOf(cells as WeatherCell[]);
}

/** Input identity for a Monte Carlo result, independent of object identities. */
export function missionInputKey(
  mission: Mission,
  weather: WeatherCell[] | WaypointWeather[],
  runs: number,
  seed: number,
): string {
  return JSON.stringify({ m: mission, wx: weatherValues(weather), runs, seed });
}

let planCache: { key: string; plan: MissionPlan } | null = null;
export function currentPlan(
  waypoints: import('./route').Waypoint[],
  weather: WeatherCell[] | WaypointWeather[],
): MissionPlan {
  const wv = weatherValues(weather);
  const key = `${JSON.stringify(waypoints)}|${JSON.stringify(wv)}`;
  if (planCache && planCache.key === key) return planCache.plan;
  const plan = planMission(waypoints, wv);
  planCache = { key, plan };
  return plan;
}

export function missionClockPosition(
  waypoints: import('./route').Waypoint[],
  weather: WeatherCell[] | WaypointWeather[],
  clockS: number,
): ClockPosition | null {
  if (waypoints.length < 2) return null;
  return positionAtClock(currentPlan(waypoints, weather), waypoints, clockS);
}

export function legRiskColor(breachFrac: number): string {
  const t = Math.max(0, Math.min(1, breachFrac));
  const a = [91, 141, 184];
  const b = [196, 68, 63];
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export const TEMPLATE_LIST = MISSION_TEMPLATES.map((t) => ({
  id: t.id,
  name: t.name,
  region: t.region,
  description: t.description,
}));

/** Engine degradation and fuel load carried into the mission. */
export function missionHealthInput(mission: Mission): {
  items: DegradationItem[];
  state: McRequest['initState'];
} {
  const snap = useSimStore.getState().snapshot;
  const h = healthFromSnapshot(snap, mission.fuelLoadKg);
  return { items: h.items, state: h.state };
}

const INITIAL_MISSION = (() => {
  const m = cloneMission(MISSION_TEMPLATES[0] as Mission);
  return m;
})();

export const useMissionStore = create<MissionStore>((set, get) => {
  const wxKeyFor = (m: Mission): string =>
    `${m.weatherMode}|${m.startTimeUTC}|${m.nodes.map((n) => `${n.lat.toFixed(4)},${n.lon.toFixed(4)}`).join(';')}`;

  const scheduleWeather = (delay = 1500): void => {
    if (typeof window === 'undefined') return;
    if (weatherTimer !== null) window.clearTimeout(weatherTimer);
    weatherTimer = window.setTimeout(() => {
      weatherTimer = null;
      void get().refreshWeather();
    }, delay);
  };

  const scheduleTerrain = (delay = 500): void => {
    if (typeof window === 'undefined') return;
    if (terrainTimer !== null) window.clearTimeout(terrainTimer);
    terrainTimer = window.setTimeout(() => {
      terrainTimer = null;
      void get().ensureTerrain();
    }, delay);
  };

  /** Commit an edited mission as one undoable step. */
  const commit = (next: Mission, extra: Partial<MissionStore> = {}): void => {
    const s = get();
    const mission = cloneMission(next);
    const baseWeather = alignWeather(s.mission, s.baseWeather, mission);
    set({
      mission,
      baseWeather,
      weather: applyOverrides(
        baseWeather,
        mission.nodes.map((n) => n.id),
        s.overrides,
      ),
      past: [...s.past, s.mission].slice(-HISTORY_LIMIT),
      future: [],
      ...extra,
    });
    scheduleWeather();
    scheduleTerrain();
  };

  const commitWith = (patch: Partial<Mission>, extra: Partial<MissionStore> = {}): void =>
    commit({ ...get().mission, ...patch }, extra);

  const replaceMission = (mission: Mission, resetHistory: boolean): void => {
    const s = get();
    const base = fallbackCells(mission.nodes.length);
    const applied = applyOverrides(
      base,
      mission.nodes.map((n) => n.id),
      s.overrides,
    );
    set({
      mission,
      baseWeather: base,
      weather: applied,
      past: resetHistory ? [] : s.past,
      future: resetHistory ? [] : s.future,
      selectedNodeId: null,
      selectedZoneId: null,
      selectedSiteId: null,
      mode: 'select',
      draftZone: [],
      notice: null,
      wxKey: null,
      fitSeq: s.fitSeq + 1,
    });
    scheduleWeather(0);
    scheduleTerrain(0);
  };

  const currentKey = (): string => {
    const s = get();
    return missionInputKey(s.mission, s.weather, s.runs, s.seed);
  };

  return {
    mission: INITIAL_MISSION,
    past: [],
    future: [],
    selectedNodeId: null,
    selectedZoneId: null,
    selectedSiteId: null,
    mode: 'select',
    draftZone: [],
    notice: null,
    flyTarget: null,
    searchQuery: '',
    searchStatus: 'idle',
    searchResults: [],
    baseWeather: fallbackCells(INITIAL_MISSION.nodes.length),
    weather: fallbackCells(INITIAL_MISSION.nodes.length),
    overrides: {},
    wxNotice: null,
    fetchingWx: false,
    wxKey: null,
    terrain: cachedTerrainMap(),
    terrainFetching: false,
    saved: safeReadSaved(),
    fitSeq: 0,
    runs: 200,
    seed: 1337,
    mcRunning: false,
    mcDone: 0,
    mcTotal: 0,
    mcResult: null,
    mcResultKey: null,
    mcError: null,

    undo: () => {
      const s = get();
      if (!s.past.length) return;
      const prev = s.past[s.past.length - 1];
      const baseWeather = alignWeather(s.mission, s.baseWeather, prev);
      set({
        mission: prev,
        past: s.past.slice(0, -1),
        future: [s.mission, ...s.future].slice(0, HISTORY_LIMIT),
        baseWeather,
        weather: applyOverrides(baseWeather, prev.nodes.map((n) => n.id), s.overrides),
        selectedNodeId:
          s.selectedNodeId !== null && prev.nodes.some((n) => n.id === s.selectedNodeId)
            ? s.selectedNodeId
            : null,
        selectedZoneId:
          s.selectedZoneId !== null && prev.zones.some((z) => z.id === s.selectedZoneId)
            ? s.selectedZoneId
            : null,
        selectedSiteId:
          s.selectedSiteId !== null && prev.customSites.some((x) => x.id === s.selectedSiteId)
            ? s.selectedSiteId
            : null,
        mode: 'select',
        draftZone: [],
      });
      scheduleWeather();
      scheduleTerrain();
    },

    redo: () => {
      const s = get();
      if (!s.future.length) return;
      const next = s.future[0];
      const baseWeather = alignWeather(s.mission, s.baseWeather, next);
      set({
        mission: next,
        past: [...s.past, s.mission].slice(-HISTORY_LIMIT),
        future: s.future.slice(1),
        baseWeather,
        weather: applyOverrides(baseWeather, next.nodes.map((n) => n.id), s.overrides),
        mode: 'select',
        draftZone: [],
      });
      scheduleWeather();
      scheduleTerrain();
    },

    setMissionName: (name) => {
      const clean = name.trim();
      if (!clean) return;
      if (clean === get().mission.name) return;
      commitWith({ name: clean.slice(0, 60) });
    },

    setStartTime: (istValue) => {
      const parsed = parseIstInput(istValue);
      if (!parsed) return false;
      commitWith({ startTimeUTC: parsed });
      return true;
    },

    setWeatherMode: (mode) => {
      if (mode === get().mission.weatherMode) return;
      commitWith({ weatherMode: mode });
    },

    setEngineProfile: (id) => {
      if (!id || id === get().mission.engineProfileId) return;
      commitWith({ engineProfileId: id });
    },

    setFuelLoadKg: (kg) => {
      if (!Number.isFinite(kg)) return false;
      const mission = get().mission;
      const fuelLoadKg = clampFuelLoadKg(kg, mission.engineProfileId);
      if (fuelLoadKg !== mission.fuelLoadKg) commitWith({ fuelLoadKg });
      return true;
    },

    addNodeAt: (lat, lon, type = 'WAYPOINT') => {
      const nodes = get().mission.nodes;
      if (nodes.length >= MAX_NODES) {
        set({ notice: `NODE LIMIT REACHED (${MAX_NODES})` });
        return;
      }
      if (!validLatLon(lat, lon)) {
        set({ notice: 'INVALID COORDINATES' });
        return;
      }
      const last = nodes[nodes.length - 1];
      const alt = last ? Math.round(resolveWaypoints(get().mission)[nodes.length - 1].altM) : 1000;
      const node: MissionNode = {
        id: nextItemId(nodes),
        type: nodes.length === 0 ? 'LAUNCH' : type,
        name: nextNodeName(nodes),
        lat,
        lon,
        alt: Math.max(0, alt),
        altRef: 'AMSL',
        loiterMin: 0,
      };
      commitWith(
        { nodes: [...nodes, node] },
        { selectedNodeId: node.id, selectedZoneId: null, selectedSiteId: null, mode: 'select' },
      );
    },

    insertNodeAfter: (index, lat, lon) => {
      const nodes = get().mission.nodes;
      if (nodes.length >= MAX_NODES) {
        set({ notice: `NODE LIMIT REACHED (${MAX_NODES})` });
        return;
      }
      if (!validLatLon(lat, lon)) return;
      const i = Math.max(0, Math.min(index, nodes.length - 2));
      const a = resolveWaypoints(get().mission)[i];
      const b = resolveWaypoints(get().mission)[i + 1];
      const alt = Math.round((a.altM + b.altM) / 2);
      const node: MissionNode = {
        id: nextItemId(nodes),
        type: 'WAYPOINT',
        name: nextNodeName(nodes),
        lat,
        lon,
        alt: Math.max(0, alt),
        altRef: 'AMSL',
        loiterMin: 0,
      };
      const next = [...nodes.slice(0, i + 1), node, ...nodes.slice(i + 1)];
      commitWith(
        { nodes: next },
        { selectedNodeId: node.id, selectedZoneId: null, selectedSiteId: null, mode: 'select' },
      );
    },

    moveNode: (id, lat, lon) => {
      if (!validLatLon(lat, lon)) return;
      const nodes = get().mission.nodes.map((n) => (n.id === id ? { ...n, lat, lon } : n));
      commitWith({ nodes });
    },

    updateNode: (id, patch) => {
      const nodes = get().mission.nodes;
      const node = nodes.find((n) => n.id === id);
      if (!node) return false;
      if (patch.name !== undefined && !patch.name.trim()) return false;
      if (patch.lat !== undefined && !(Number.isFinite(patch.lat) && patch.lat >= -90 && patch.lat <= 90)) {
        return false;
      }
      if (patch.lon !== undefined && !(Number.isFinite(patch.lon) && patch.lon >= -180 && patch.lon <= 180)) {
        return false;
      }
      if (patch.alt !== undefined && !(Number.isFinite(patch.alt) && patch.alt >= 0 && patch.alt <= 20000)) {
        return false;
      }
      if (patch.loiterMin !== undefined && !(Number.isFinite(patch.loiterMin) && patch.loiterMin >= 0)) {
        return false;
      }
      if (
        patch.speed !== undefined &&
        patch.speed !== null &&
        !(Number.isFinite(patch.speed) && patch.speed >= 5 && patch.speed <= 150)
      ) {
        return false;
      }
      const clean: MissionNode = { ...node };
      if (patch.name !== undefined) clean.name = patch.name.trim().slice(0, 40);
      if (patch.type !== undefined) clean.type = patch.type;
      if (patch.lat !== undefined) clean.lat = patch.lat;
      if (patch.lon !== undefined) clean.lon = patch.lon;
      if (patch.alt !== undefined) clean.alt = Math.round(patch.alt);
      if (patch.altRef !== undefined) clean.altRef = patch.altRef;
      if (patch.loiterMin !== undefined) clean.loiterMin = Math.round(patch.loiterMin);
      if (patch.speed === null) delete clean.speed;
      else if (patch.speed !== undefined) clean.speed = patch.speed;
      commitWith({ nodes: nodes.map((n) => (n.id === id ? clean : n)) });
      return true;
    },

    deleteNode: (id) => {
      const nodes = get().mission.nodes;
      if (nodes.length <= 2) {
        set({ notice: 'A MISSION NEEDS AT LEAST TWO NODES' });
        return;
      }
      const next = nodes.filter((n) => n.id !== id);
      commitWith(
        { nodes: next },
        { selectedNodeId: null, selectedZoneId: null, selectedSiteId: null },
      );
    },

    reorderNode: (from, to) => {
      const nodes = [...get().mission.nodes];
      if (from < 0 || from >= nodes.length || to < 0 || to >= nodes.length || from === to) return;
      const [moved] = nodes.splice(from, 1);
      nodes.splice(to, 0, moved);
      commitWith({ nodes });
    },

    selectNode: (id) => set({ selectedNodeId: id, selectedZoneId: null, selectedSiteId: null }),

    autoPlaceRecon: (count) => {
      const mission = get().mission;
      const nodes = mission.nodes;
      if (nodes.length < 2) return false;
      const n = Math.max(1, Math.min(10, Math.round(count)));
      const wps = resolveWaypoints(mission);
      const legs = wps.slice(0, -1).map((w, i) => ({
        a: w,
        b: wps[i + 1],
        distM: Math.sqrt(
          ((wps[i + 1].lat - w.lat) * 111320) ** 2 +
            ((wps[i + 1].lon - w.lon) * 111320 * Math.cos((w.lat * Math.PI) / 180)) ** 2,
        ),
      }));
      const total = legs.reduce((s, l) => s + l.distM, 0);
      if (!(total > 0)) return false;
      const rng = mulberry32(hashString(`${mission.id}:${nodes.length}:${n}`));
      const inserts = new Map<number, MissionNode[]>();
      let added = 0;
      for (let k = 0; k < n; k++) {
        const target = (total * (k + 1)) / (n + 1) + (rng() - 0.5) * (total / (n + 1)) * 0.4;
        let cum = 0;
        for (let i = 0; i < legs.length; i++) {
          const l = legs[i];
          if (target <= cum + l.distM || i === legs.length - 1) {
            const f = Math.max(0.08, Math.min(0.92, (target - cum) / Math.max(1, l.distM)));
            const lat = l.a.lat + (l.b.lat - l.a.lat) * f;
            const lon = l.a.lon + (l.b.lon - l.a.lon) * f;
            // A small seeded lateral offset keeps auto points from sitting
            // exactly on the drawn leg while staying within capture range.
            const brg = Math.atan2(l.b.lon - l.a.lon, l.b.lat - l.a.lat);
            const offM = (rng() - 0.5) * 300;
            const dLat = (Math.cos(brg) * offM) / 111320;
            const dLon = (Math.sin(brg) * offM) / (111320 * Math.cos((lat * Math.PI) / 180));
            const alt = Math.round(l.a.altM + (l.b.altM - l.a.altM) * f);
            const node: MissionNode = {
              id: nextItemId([...nodes, ...Array.from(inserts.values()).flat()]),
              type: 'RECON',
              name: `RECON ${nodes.filter((x) => x.type === 'RECON').length + added + 1}`,
              lat: Math.max(-89.9, Math.min(89.9, lat + dLat)),
              lon: Math.max(-180, Math.min(180, lon + dLon)),
              alt: Math.max(0, alt),
              altRef: 'AMSL',
              loiterMin: 0,
            };
            const list = inserts.get(i) ?? [];
            list.push(node);
            inserts.set(i, list);
            added++;
            break;
          }
          cum += l.distM;
        }
      }
      if (!added) return false;
      const next: MissionNode[] = [];
      for (let i = 0; i < nodes.length - 1; i++) {
        next.push(nodes[i], ...(inserts.get(i) ?? []));
      }
      next.push(nodes[nodes.length - 1]);
      commitWith({ nodes: next }, { selectedNodeId: null, notice: `${added} RECON NODES PLACED` });
      return true;
    },

    startZoneDraw: () =>
      set({
        mode: 'draw-zone',
        draftZone: [],
        selectedNodeId: null,
        selectedZoneId: null,
        selectedSiteId: null,
        notice: null,
      }),

    addZoneVertex: (lat, lon) => {
      if (get().mode !== 'draw-zone' || !validLatLon(lat, lon)) return;
      set({ draftZone: [...get().draftZone, [lon, lat]] });
    },

    finishZone: () => {
      const draft = get().draftZone;
      const cleaned = draft.filter(
        (p, i) => i === 0 || distanceM(draft[i - 1][1], draft[i - 1][0], p[1], p[0]) > 5,
      );
      if (cleaned.length < 3) {
        set({ notice: 'A ZONE NEEDS AT LEAST THREE VERTICES', mode: 'select', draftZone: [] });
        return;
      }
      const zones = get().mission.zones;
      const zone: MissionZone = {
        id: nextItemId(zones),
        name: `ZONE ${zones.length + 1}`,
        type: 'DENIED',
        polygon: [...cleaned, cleaned[0]],
      };
      commitWith(
        { zones: [...zones, zone] },
        { mode: 'select', draftZone: [], selectedZoneId: zone.id, selectedNodeId: null },
      );
    },

    cancelMode: () => set({ mode: 'select', draftZone: [], notice: null }),

    updateZone: (id, patch) => {
      if (patch.name !== undefined && !patch.name.trim()) return;
      const zones = get().mission.zones.map((z) =>
        z.id === id
          ? {
              ...z,
              ...(patch.name !== undefined ? { name: patch.name.trim().slice(0, 40) } : {}),
              ...(patch.type !== undefined ? { type: patch.type } : {}),
            }
          : z,
      );
      commitWith({ zones });
    },

    moveZoneVertex: (id, index, lat, lon) => {
      if (!validLatLon(lat, lon)) return;
      const zones = get().mission.zones.map((z) => {
        if (z.id !== id || index < 0 || index >= z.polygon.length) return z;
        const poly = z.polygon.map((p) => [...p] as [number, number]);
        poly[index] = [lon, lat];
        if (index === 0) poly[poly.length - 1] = [lon, lat];
        if (index === poly.length - 1) poly[0] = [lon, lat];
        return { ...z, polygon: poly };
      });
      commitWith({ zones });
    },

    deleteZone: (id) => {
      const zones = get().mission.zones.filter((z) => z.id !== id);
      commitWith({ zones }, { selectedZoneId: null });
    },

    selectZone: (id) => set({ selectedZoneId: id, selectedNodeId: null, selectedSiteId: null }),

    setGround: (lat, lon) => {
      if (!validLatLon(lat, lon)) return;
      commitWith({ groundStation: { lat, lon } });
    },

    startSitePlacement: () =>
      set({
        mode: 'add-site',
        selectedNodeId: null,
        selectedZoneId: null,
        selectedSiteId: null,
        notice: null,
      }),

    addSiteAt: (lat, lon) => {
      if (!validLatLon(lat, lon)) return;
      const sites = get().mission.customSites;
      const site: LandingSite = {
        id: nextItemId(sites),
        name: `LANDING SITE ${sites.length + 1}`,
        type: 'STRIP',
        lat,
        lon,
        elevM: Math.round(terrainElevation(lat, lon)),
      };
      commitWith(
        { customSites: [...sites, site] },
        { mode: 'select', selectedSiteId: site.id },
      );
      void fetchTerrain([{ lat, lon }]).then((patch) => {
        const elev = patch[terrainKey(lat, lon)];
        if (elev === undefined) return;
        const current = get().mission.customSites.find((x) => x.id === site.id);
        if (!current) return;
        set({
          terrain: cachedTerrainMap(),
          mission: {
            ...get().mission,
            customSites: get().mission.customSites.map((x) =>
              x.id === site.id ? { ...x, elevM: Math.round(elev) } : x,
            ),
          },
        });
      });
    },

    updateSite: (id, patch) => {
      if (patch.name !== undefined && !patch.name.trim()) return;
      const site = get().mission.customSites.find((x) => x.id === id);
      if (!site) return;
      if (
        (patch.lat !== undefined || patch.lon !== undefined) &&
        !validLatLon(patch.lat ?? site.lat, patch.lon ?? site.lon)
      ) {
        return;
      }
      if (patch.elevM !== undefined && !Number.isFinite(patch.elevM)) return;
      const sites = get().mission.customSites.map((s) =>
        s.id === id
          ? {
              ...s,
              ...(patch.name !== undefined ? { name: patch.name.trim().slice(0, 40) } : {}),
              ...(patch.type !== undefined ? { type: patch.type as SiteType } : {}),
              ...(patch.lat !== undefined ? { lat: patch.lat } : {}),
              ...(patch.lon !== undefined ? { lon: patch.lon } : {}),
              ...(patch.elevM !== undefined ? { elevM: Math.round(patch.elevM) } : {}),
            }
          : s,
      );
      commitWith({ customSites: sites });
    },

    deleteSite: (id) => {
      commitWith({ customSites: get().mission.customSites.filter((s) => s.id !== id) }, {
        selectedSiteId: null,
      });
    },

    selectSite: (id) => set({ selectedSiteId: id, selectedNodeId: null, selectedZoneId: null }),

    setWeatherOverride: (nodeId, patch) => {
      const overrides: WeatherOverrides = {
        ...get().overrides,
        [nodeId]: { ...(get().overrides[nodeId] ?? {}), ...patch },
      };
      const weather = applyOverrides(
        get().baseWeather,
        get().mission.nodes.map((n) => n.id),
        overrides,
      );
      set({ overrides, weather });
    },

    clearWeatherOverride: (nodeId) => {
      const overrides = { ...get().overrides };
      delete overrides[nodeId];
      const weather = applyOverrides(
        get().baseWeather,
        get().mission.nodes.map((n) => n.id),
        overrides,
      );
      set({ overrides, weather });
    },

    refreshWeather: async () => {
      const s = get();
      const m = s.mission;
      if (m.nodes.length === 0) return;
      const key = wxKeyFor(m);
      if (m.weatherMode === 'manual') {
        const base = fallbackCells(m.nodes.length);
        set({
          baseWeather: base,
          weather: applyOverrides(base, m.nodes.map((n) => n.id), s.overrides),
          wxKey: key,
          wxNotice: null,
          fetchingWx: false,
        });
        return;
      }
      if (s.fetchingWx) return;
      const seq = ++weatherSeq;
      set({ fetchingWx: true, wxNotice: null });
      const res = await fetchForecast(m.nodes, m.startTimeUTC);
      if (seq !== weatherSeq) return;
      if (wxKeyFor(get().mission) !== key) {
        set({ fetchingWx: false });
        return;
      }
      const base = res.cells;
      set({
        baseWeather: base,
        weather: applyOverrides(base, m.nodes.map((n) => n.id), get().overrides),
        wxKey: key,
        wxNotice: res.notice,
        fetchingWx: false,
      });
    },

    ensureTerrain: async () => {
      const s = get();
      const wps = resolveWaypoints(s.mission);
      const samples = routeSamples(wps, 1000, 1000);
      const points = [
        ...s.mission.nodes.map((n) => ({ lat: n.lat, lon: n.lon })),
        ...samples.map((p) => ({ lat: p.lat, lon: p.lon })),
      ];
      const seq = ++terrainSeq;
      set({ terrainFetching: true });
      await fetchTerrain(points);
      if (seq !== terrainSeq) return;
      set({ terrain: cachedTerrainMap(), terrainFetching: false });
    },

    search: async (query) => {
      const q = query.trim();
      set({ searchQuery: query });
      if (!q) {
        set({ searchStatus: 'idle', searchResults: [] });
        return;
      }
      const pasted = parseLatLon(q);
      if (pasted) {
        set({
          searchStatus: 'done',
          searchResults: [
            {
              id: 0,
              name: 'PASTED COORDINATES',
              detail: `${pasted.lat.toFixed(5)}, ${pasted.lon.toFixed(5)}`,
              lat: pasted.lat,
              lon: pasted.lon,
            },
          ],
        });
        return;
      }
      const seq = ++searchSeq;
      set({ searchStatus: 'loading', searchResults: [] });
      try {
        const res = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`,
        );
        if (!res.ok) throw new Error('request failed');
        const j = (await res.json()) as {
          results?: {
            id: number;
            name: string;
            admin1?: string;
            country?: string;
            latitude: number;
            longitude: number;
          }[];
        };
        if (seq !== searchSeq) return;
        const results: PlaceResult[] = (j.results ?? []).map((r) => ({
          id: r.id,
          name: r.name,
          detail: [r.admin1, r.country].filter(Boolean).join(', '),
          lat: r.latitude,
          lon: r.longitude,
        }));
        set({ searchStatus: results.length ? 'done' : 'error', searchResults: results });
      } catch {
        if (seq === searchSeq) set({ searchStatus: 'error', searchResults: [] });
      }
    },

    setSearchQuery: (q) => set({ searchQuery: q }),

    flyTo: (lat, lon) => {
      if (!validLatLon(lat, lon)) return;
      set({ flyTarget: { lat, lon, seq: ++flySeq } });
    },

    clearSearch: () => {
      searchSeq++;
      set({ searchQuery: '', searchStatus: 'idle', searchResults: [] });
    },

    loadTemplate: (id) => {
      const t = templateById(id);
      if (!t) return;
      replaceMission(cloneMission(t as Mission), true);
    },

    resetToTemplate: () => {
      const m = get().mission;
      const t = templateById(m.templateId ?? '') ?? MISSION_TEMPLATES[0];
      const clone = cloneMission(t as Mission);
      const next: Mission = {
        ...clone,
        id: m.id,
        name: m.name,
        startTimeUTC: m.startTimeUTC,
        engineProfileId: m.engineProfileId,
      };
      set({ overrides: {} });
      commit(next, {
        selectedNodeId: null,
        selectedZoneId: null,
        selectedSiteId: null,
        fitSeq: get().fitSeq + 1,
      });
    },

    saveMission: (name) => {
      const current = get().mission;
      const clean = (name ?? current.name).trim();
      if (!clean) return;
      const mission = cloneMission({ ...current, name: clean.slice(0, 60) });
      let saved = [...get().saved];
      const byId = saved.findIndex((s) => s.id === mission.id);
      if (byId >= 0) {
        saved[byId] = { ...saved[byId], name: mission.name, savedAt: new Date().toISOString(), mission };
      } else {
        const byName = saved.findIndex((s) => s.name.toLowerCase() === mission.name.toLowerCase());
        if (byName >= 0) {
          saved[byName] = {
            ...saved[byName],
            name: mission.name,
            savedAt: new Date().toISOString(),
            mission,
          };
        } else {
          saved.push({
            id: mission.id,
            name: mission.name,
            savedAt: new Date().toISOString(),
            mission,
          });
        }
      }
      writeSaved(saved);
      set({ saved, mission, notice: `SAVED ${mission.name}` });
    },

    loadSavedMission: (id) => {
      const entry = get().saved.find((s) => s.id === id);
      if (!entry) return;
      set({ overrides: {} });
      replaceMission(cloneMission(entry.mission), true);
    },

    duplicateSavedMission: (id) => {
      const entry = get().saved.find((s) => s.id === id);
      if (!entry) return;
      const copy = cloneMission(entry.mission);
      copy.id = newId('mission');
      copy.name = `${entry.name} COPY`.slice(0, 60);
      const saved = [
        ...get().saved,
        { id: copy.id, name: copy.name, savedAt: new Date().toISOString(), mission: copy },
      ];
      writeSaved(saved);
      set({ saved, overrides: {} });
      replaceMission(copy, true);
    },

    deleteSavedMission: (id) => {
      const saved = get().saved.filter((s) => s.id !== id);
      writeSaved(saved);
      set({ saved });
    },

    exportMission: () => missionToGeoJsonText(get().mission),

    importMission: (text) => {
      const res = missionFromGeoJson(text);
      if (!res.mission) return { ok: false, error: res.error ?? 'IMPORT FAILED' };
      set({ overrides: {} });
      replaceMission(res.mission, true);
      set({ notice: `IMPORTED ${res.mission.name}` });
      return { ok: true, error: null };
    },

    dismissNotice: () => set({ notice: null }),

    setRuns: (n) =>
      set({
        runs: Math.max(200, Math.min(1000, Math.round(n) || 200)),
      }),
    setSeed: (n) => set({ seed: Math.max(0, Math.round(n) || 0) >>> 0 }),

    runAssessment: async () => {
      const s = get();
      const wps = resolveWaypoints(s.mission);
      if (wps.length < 2) return;
      const seq = ++mcSeq;
      const health = missionHealthInput(s.mission);
      const req: McRequest = {
        waypoints: wps,
        weather: weatherValues(s.weather),
        items: health.items,
        initState: health.state,
        fuelLoadKg: s.mission.fuelLoadKg,
        runs: s.runs,
        seed: s.seed,
        growthPerH: null,
      };
      const key = currentKey();
      set({ mcRunning: true, mcError: null, mcDone: 0, mcTotal: s.runs, mcResult: null, mcResultKey: null });
      try {
        const result = await runMonteCarloPool(req, (done, total) => {
          if (seq === mcSeq) set({ mcDone: done, mcTotal: total });
        });
        if (seq !== mcSeq) return;
        if (currentKey() !== key) {
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
  };
});

function validLatLon(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

export function parseLatLon(text: string): { lat: number; lon: number } | null {
  const m = text.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  return validLatLon(lat, lon) ? { lat, lon } : null;
}

function parseIstInput(value: string): string | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  const utcMs = Date.UTC(y, mo - 1, d, h, mi) - 330 * 60_000;
  if (!Number.isFinite(utcMs)) return null;
  const back = new Date(utcMs + 330 * 60_000);
  if (
    back.getUTCFullYear() !== y ||
    back.getUTCMonth() !== mo - 1 ||
    back.getUTCDate() !== d ||
    back.getUTCHours() !== h ||
    back.getUTCMinutes() !== mi
  ) {
    return null;
  }
  return new Date(utcMs).toISOString();
}

// Start the initial forecast and terrain fetch once the store exists.
if (typeof window !== 'undefined') {
  setTimeout(() => {
    void useMissionStore.getState().refreshWeather();
    void useMissionStore.getState().ensureTerrain();
  }, 0);
}

/** Route length for a mission, for the header summary. */
export function missionTrackDistanceM(mission: Mission): number {
  const wps = resolveWaypoints(mission);
  const track = buildTrack(wps);
  return track.length ? track[track.length - 1].cumM : 0;
}
