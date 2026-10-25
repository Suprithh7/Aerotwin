// Weather model: per-waypoint ISA deviation, wind and turbulence, presets, and
// live acquisition from Open-Meteo with cache + graceful fallback.
import type { TurbulenceLevel } from '../sim/types';
import { MC_TURB_DOWNGRADE_P, MC_TURB_UPGRADE_P, gustExcessToTurbulence, isaTempC } from './constants';
import type { Waypoint } from './route';

export interface WaypointWeather {
  isaDevC: number; // ISA temperature deviation, deg C
  windDirDeg: number; // meteorological: direction FROM
  windSpdMs: number; // mean wind speed
  gustMs: number; // peak gust (used for the turbulence mapping)
  turb: TurbulenceLevel;
}

export interface WeatherPreset {
  id: string;
  name: string;
  isaDevC: number[];
  windDirDeg: number[];
  windSpdMs: number[];
  gustMs: number[];
  turb: TurbulenceLevel[];
}

const MAXW = 6; // presets are authored for up to 6 waypoints

function expand(v: number[], max: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < max; i++) out.push(v[Math.min(i, v.length - 1)]);
  return out;
}

function expandT(v: TurbulenceLevel[], max: number): TurbulenceLevel[] {
  const out: TurbulenceLevel[] = [];
  for (let i = 0; i < max; i++) out.push(v[Math.min(i, v.length - 1)]);
  return out;
}

export const WEATHER_PRESETS: WeatherPreset[] = [
  {
    id: 'standard',
    name: 'STANDARD DAY',
    isaDevC: expand([0, 3, 5, 3, 0, 0], MAXW),
    windDirDeg: expand([240, 245, 250, 250, 245, 240], MAXW),
    windSpdMs: expand([4, 5, 6, 6, 5, 4], MAXW),
    gustMs: expand([6, 8, 10, 10, 8, 6], MAXW),
    turb: expandT(['light', 'light', 'light', 'moderate', 'light', 'none'], MAXW),
  },
  {
    id: 'hot-high',
    name: 'HOT AND HIGH',
    isaDevC: expand([12, 15, 18, 16, 12, 10], MAXW),
    windDirDeg: expand([210, 225, 240, 250, 240, 220], MAXW),
    windSpdMs: expand([6, 8, 10, 9, 7, 6], MAXW),
    gustMs: expand([10, 13, 17, 15, 12, 10], MAXW),
    turb: expandT(['light', 'moderate', 'moderate', 'severe', 'moderate', 'light'], MAXW),
  },
  {
    // A strong wind from the south-southeast: on the coastal preset, whose legs
    // run MUMBAI > GOA > MANGALURU > KOCHI on bearings of about 167, 158 and
    // 150 deg, it is a near-full headwind on every leg. On routes that do not
    // head south it is simply a strong gradient wind. An illustrative worst
    // case, not a synoptic pattern.
    id: 'headwind',
    name: 'HEADWIND + TURBULENCE',
    isaDevC: expand([6, 6, 8, 7, 6, 5], MAXW),
    windDirDeg: expand([165, 168, 170, 168, 165, 165], MAXW),
    windSpdMs: expand([13, 15, 14, 16, 13, 12], MAXW),
    gustMs: expand([20, 24, 22, 26, 20, 19], MAXW),
    turb: expandT(['severe', 'severe', 'severe', 'severe', 'moderate', 'moderate'], MAXW),
  },
];

export function weatherPresetById(id: string): WeatherPreset {
  return WEATHER_PRESETS.find((p) => p.id === id) ?? WEATHER_PRESETS[0];
}

export function applyWeatherPreset(presetId: string, n: number): WaypointWeather[] {
  const p = weatherPresetById(presetId);
  const out: WaypointWeather[] = [];
  for (let i = 0; i < n; i++) {
    const k = Math.min(i, MAXW - 1);
    out.push({
      isaDevC: p.isaDevC[k],
      windDirDeg: p.windDirDeg[k],
      windSpdMs: p.windSpdMs[k],
      gustMs: p.gustMs[k],
      turb: p.turb[k],
    });
  }
  return out;
}

export const TURB_LEVELS: TurbulenceLevel[] = ['none', 'light', 'moderate', 'severe'];

export function jitterTurbulence(level: TurbulenceLevel, up: number, down: number): TurbulenceLevel {
  const i = TURB_LEVELS.indexOf(level);
  if (up < MC_TURB_UPGRADE_P && i < TURB_LEVELS.length - 1) return TURB_LEVELS[i + 1];
  if (down < MC_TURB_DOWNGRADE_P && i > 0) return TURB_LEVELS[i - 1];
  return TURB_LEVELS[i];
}

// --- live weather ---------------------------------------------------------

interface OpenMeteoCurrent {
  latitude: number;
  longitude: number;
  elevation?: number;
  current?: {
    temperature_2m?: number;
    wind_speed_10m?: number;
    wind_direction_10m?: number;
    wind_gusts_10m?: number;
  };
}

export interface WeatherSource {
  kind: 'live' | 'cache' | 'preset';
  fetchedAt?: number;
  stationTempC?: number;
  groundElevM?: number;
}

export interface WeatherCell extends WaypointWeather {
  source: WeatherSource;
}

const WX_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const CACHE_KEY = 'aerotwin.wx.v1';
export const WX_CACHE_TTL_MS = 30 * 60 * 1000;

const memoryCache = new Map<string, { cell: WeatherCell; at: number }>();
let storedCache: Record<string, { cell: WeatherCell; at: number }> | null = null;

function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

function readStored(): Record<string, { cell: WeatherCell; at: number }> {
  if (storedCache) return storedCache;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    storedCache = raw ? (JSON.parse(raw) as Record<string, { cell: WeatherCell; at: number }>) : {};
  } catch {
    storedCache = {};
  }
  return storedCache;
}

function writeStored(map: Record<string, { cell: WeatherCell; at: number }>): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable: memory cache still applies */
  }
}

function cached(key: string, now: number): WeatherCell | null {
  const stamp = (c: WeatherCell): WeatherCell => ({
    ...c,
    source: { ...c.source, kind: 'cache' },
  });
  const hit = memoryCache.get(key);
  if (hit && now - hit.at < WX_CACHE_TTL_MS) return stamp(hit.cell);
  const stored = readStored()[key];
  if (stored && now - stored.at < WX_CACHE_TTL_MS) {
    memoryCache.set(key, stored);
    return stamp(stored.cell);
  }
  return null;
}

function store(key: string, cell: WeatherCell, now: number): void {
  const wrapped = { cell, at: now };
  memoryCache.set(key, wrapped);
  const map = readStored();
  map[key] = wrapped;
  writeStored(map);
}

/**
 * ISA deviation from a reported surface temperature. The deviation measured at
 * ground elevation is carried to cruise altitude unchanged (standard lapse on
 * both sides of the comparison).
 */
export function isaDevFromSurface(surfaceTempC: number, groundElevM: number): number {
  return surfaceTempC - isaTempC(groundElevM);
}

export interface FetchResult {
  cells: (WeatherCell | null)[];
  notice: string | null;
  liveCount: number;
}

/** Fetch one waypoint; never throws. */
async function fetchOne(wp: Waypoint, now: number): Promise<WeatherCell | null> {
  const key = cacheKey(wp.lat, wp.lon);
  const hit = cached(key, now);
  if (hit) return hit;
  const url =
    `${WX_ENDPOINT}?latitude=${wp.lat.toFixed(4)}&longitude=${wp.lon.toFixed(4)}` +
    '&current=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m' +
    '&wind_speed_unit=ms';
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const j = (await res.json()) as OpenMeteoCurrent;
    const c = j.current;
    if (!c || typeof c.temperature_2m !== 'number') return null;
    const elev = typeof j.elevation === 'number' ? j.elevation : 0;
    const mean = c.wind_speed_10m ?? 0;
    const gust = c.wind_gusts_10m ?? mean;
    const cell: WeatherCell = {
      isaDevC: Math.round(isaDevFromSurface(c.temperature_2m, elev)),
      windDirDeg: Math.round(c.wind_direction_10m ?? 0),
      windSpdMs: Math.round(mean * 10) / 10,
      gustMs: Math.round(gust * 10) / 10,
      turb: gustExcessToTurbulence(gust, mean),
      source: {
        kind: 'live',
        fetchedAt: now,
        stationTempC: c.temperature_2m,
        groundElevM: elev,
      },
    };
    store(key, cell, now);
    return cell;
  } catch {
    return null;
  }
}

/**
 * Live weather for every waypoint. Individual failures fall back to the given
 * preset cell; a total failure reports a notice and leaves the presets in place.
 */
export async function fetchLiveWeather(
  waypoints: Waypoint[],
  fallback: WaypointWeather[],
): Promise<FetchResult> {
  const now = Date.now();
  const settled = await Promise.all(
    waypoints.map(async (wp) => {
      const cell = await fetchOne(wp, now);
      return cell ?? null;
    }),
  );
  const cells: (WeatherCell | null)[] = settled.map((c, i) => {
    if (c) return c;
    const fb = fallback[Math.min(i, fallback.length - 1)];
    return { ...fb, source: { kind: 'preset' } };
  });
  const liveCount = settled.filter((c) => c && c.source.kind === 'live').length;
  const cachedCount = settled.filter((c) => c && c.source.kind === 'cache').length;
  let notice: string | null = null;
  if (liveCount + cachedCount === 0) {
    notice = 'LIVE WEATHER UNAVAILABLE - USING PRESET VALUES';
  } else if (liveCount + cachedCount < waypoints.length) {
    notice = `PARTIAL LIVE WEATHER: ${liveCount + cachedCount}/${waypoints.length} POINTS, PRESETS FOR THE REST`;
  }
  return { cells, notice, liveCount };
}

/** Mark cache hits so the UI can show their age. */
export function isLive(cell: WeatherCell | null): boolean {
  return !!cell && cell.source.kind !== 'preset';
}
