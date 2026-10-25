// Weather model: per-node hourly forecast at the mission start time, manual
// overrides, and the fallback used when the network is unavailable.
//
// Open-Meteo returns an hourly series in UTC. The cell for a node is the hour
// nearest the mission start, converted to ISA deviation and the existing
// turbulence bands (see mission/constants.ts). Requests are cached per
// coordinate and forecast hour for 30 minutes.
import type { TurbulenceLevel } from '../sim/types';
import { MC_TURB_DOWNGRADE_P, MC_TURB_UPGRADE_P, gustExcessToTurbulence, isaTempC } from './constants';

export interface WaypointWeather {
  isaDevC: number; // ISA temperature deviation, deg C
  windDirDeg: number; // meteorological: direction FROM
  windSpdMs: number; // mean wind speed
  gustMs: number; // peak gust (used for the turbulence mapping)
  turb: TurbulenceLevel;
}

export type WeatherTag = 'LIVE' | 'MANUAL' | 'FALLBACK';

export interface WeatherSource {
  tag: WeatherTag;
  fetchedAt?: number;
  stationTempC?: number;
  groundElevM?: number;
  forecastHourUTC?: string;
}

export interface WeatherCell extends WaypointWeather {
  source: WeatherSource;
}

export type WeatherOverrides = Record<number, Partial<WaypointWeather>>;

export interface FetchResult {
  cells: WeatherCell[];
  notice: string | null;
  liveCount: number;
}

export const WX_CACHE_TTL_MS = 30 * 60 * 1000;
const WX_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const CACHE_KEY = 'aerotwin.wx.v2';

export const TURB_LEVELS: TurbulenceLevel[] = ['none', 'light', 'moderate', 'severe'];

/** Neutral fallback: standard temperature, light gradient wind. */
export const FALLBACK_WEATHER: WaypointWeather = {
  isaDevC: 0,
  windDirDeg: 250,
  windSpdMs: 5,
  gustMs: 7,
  turb: 'light',
};

export function fallbackCell(): WeatherCell {
  return { ...FALLBACK_WEATHER, source: { tag: 'FALLBACK' } };
}

export function weatherTag(cell: WeatherCell | null | undefined): WeatherTag {
  return cell?.source.tag ?? 'FALLBACK';
}

export function isLive(cell: WeatherCell | null | undefined): boolean {
  return cell?.source.tag === 'LIVE';
}

export function jitterTurbulence(level: TurbulenceLevel, up: number, down: number): TurbulenceLevel {
  const i = TURB_LEVELS.indexOf(level);
  if (up < MC_TURB_UPGRADE_P && i < TURB_LEVELS.length - 1) return TURB_LEVELS[i + 1];
  if (down < MC_TURB_DOWNGRADE_P && i > 0) return TURB_LEVELS[i - 1];
  return TURB_LEVELS[i];
}

interface OpenMeteoForecast {
  latitude: number;
  longitude: number;
  elevation?: number;
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    wind_speed_10m?: number[];
    wind_direction_10m?: number[];
    wind_gusts_10m?: number[];
  };
}

interface CachedCell {
  cell: WeatherCell;
  at: number;
}

const memoryCache = new Map<string, CachedCell>();
let storedCache: Record<string, CachedCell> | null = null;

function readStored(): Record<string, CachedCell> {
  if (storedCache) return storedCache;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    storedCache = raw ? (JSON.parse(raw) as Record<string, CachedCell>) : {};
  } catch {
    storedCache = {};
  }
  return storedCache;
}

function writeStored(map: Record<string, CachedCell>): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable: memory cache still applies */
  }
}

function cacheKey(lat: number, lon: number, hourISO: string): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}@${hourISO.slice(0, 13)}`;
}

function cached(key: string, now: number): WeatherCell | null {
  const hit = memoryCache.get(key);
  if (hit && now - hit.at < WX_CACHE_TTL_MS) return { ...hit.cell, source: { ...hit.cell.source, tag: 'LIVE' } };
  const stored = readStored()[key];
  if (stored && now - stored.at < WX_CACHE_TTL_MS) {
    memoryCache.set(key, stored);
    return { ...stored.cell, source: { ...stored.cell.source, tag: 'LIVE' } };
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

/** ISA deviation from a reported surface temperature and ground elevation. */
export function isaDevFromSurface(surfaceTempC: number, groundElevM: number): number {
  return surfaceTempC - isaTempC(groundElevM);
}

/** Open-Meteo returns zone-less ISO times when timezone=UTC; parse them as UTC. */
function parseHourUtc(value: string): number {
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value)) return Date.parse(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return Date.parse(`${value}T00:00:00Z`);
  if (value.length === 16) return Date.parse(`${value}:00Z`);
  return Date.parse(`${value}Z`);
}

function nearestHourIndex(times: string[], startMs: number): number {
  let best = -1;
  let bestDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    const t = parseHourUtc(times[i]);
    if (!Number.isFinite(t)) continue;
    const diff = Math.abs(t - startMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return best;
}

async function fetchOne(
  node: { lat: number; lon: number },
  startISO: string,
  now: number,
  signal?: AbortSignal,
): Promise<WeatherCell | null> {
  const startMs = Date.parse(startISO);
  if (!Number.isFinite(startMs)) return null;
  const day = new Date(startMs).toISOString().slice(0, 10);
  const key = cacheKey(node.lat, node.lon, new Date(startMs).toISOString());
  const hit = cached(key, now);
  if (hit) return hit;
  const url =
    `${WX_ENDPOINT}?latitude=${node.lat.toFixed(4)}&longitude=${node.lon.toFixed(4)}` +
    '&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m' +
    `&start_date=${day}&end_date=${day}&timezone=UTC&wind_speed_unit=ms`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const j = (await res.json()) as OpenMeteoForecast;
    const hourly = j.hourly;
    if (!hourly?.time?.length) return null;
    const idx = nearestHourIndex(hourly.time, startMs);
    if (idx < 0) return null;
    const temp = hourly.temperature_2m?.[idx];
    if (typeof temp !== 'number') return null;
    const elev = typeof j.elevation === 'number' ? j.elevation : 0;
    const mean = hourly.wind_speed_10m?.[idx] ?? 0;
    const gust = hourly.wind_gusts_10m?.[idx] ?? mean;
    const cell: WeatherCell = {
      isaDevC: Math.round(isaDevFromSurface(temp, elev)),
      windDirDeg: Math.round(hourly.wind_direction_10m?.[idx] ?? 0),
      windSpdMs: Math.round(mean * 10) / 10,
      gustMs: Math.round(gust * 10) / 10,
      turb: gustExcessToTurbulence(gust, mean),
      source: {
        tag: 'LIVE',
        fetchedAt: now,
        stationTempC: temp,
        groundElevM: elev,
        forecastHourUTC: hourly.time[idx],
      },
    };
    store(key, cell, now);
    return cell;
  } catch {
    return null;
  }
}

/**
 * Forecast cells for every node. Individual failures fall back to the neutral
 * cell; a total failure reports a small notice.
 */
export async function fetchForecast(
  nodes: { lat: number; lon: number }[],
  startISO: string,
  signal?: AbortSignal,
): Promise<FetchResult> {
  const now = Date.now();
  const cells = await Promise.all(
    nodes.map(async (node) => (await fetchOne(node, startISO, now, signal)) ?? fallbackCell()),
  );
  const liveCount = cells.filter((c) => c.source.tag === 'LIVE').length;
  const notice =
    nodes.length === 0
      ? null
      : liveCount === 0
        ? 'FORECAST UNAVAILABLE - USING FALLBACK WEATHER'
        : liveCount < nodes.length
          ? `PARTIAL FORECAST: ${liveCount}/${nodes.length} NODES`
          : null;
  return { cells, notice, liveCount };
}

/** Apply per-node manual overrides (keyed by node id); a touched node is tagged MANUAL. */
export function applyOverrides(
  cells: WeatherCell[],
  ids: number[],
  overrides: WeatherOverrides,
): WeatherCell[] {
  return cells.map((cell, i) => {
    const patch = overrides[ids[i]];
    if (!patch || Object.keys(patch).length === 0) return cell;
    return { ...cell, ...patch, source: { ...cell.source, tag: 'MANUAL' } };
  });
}

export function weatherValues(cells: WeatherCell[]): WaypointWeather[] {
  return cells.map(({ isaDevC, windDirDeg, windSpdMs, gustMs, turb }) => ({
    isaDevC,
    windDirDeg,
    windSpdMs,
    gustMs,
    turb,
  }));
}

/** Linear/vector interpolation of the weather along a leg. */
export function interpolateWeather(
  a: WaypointWeather,
  b: WaypointWeather,
  frac: number,
): WaypointWeather {
  return interpolateWeatherInto(
    { isaDevC: 0, windDirDeg: 0, windSpdMs: 0, gustMs: 0, turb: 'none' },
    a,
    b,
    frac,
  );
}

/** In-place form used by the mission integrator to avoid per-step allocation. */
export function interpolateWeatherInto(
  out: WaypointWeather,
  a: WaypointWeather,
  b: WaypointWeather,
  frac: number,
): WaypointWeather {
  const f = Math.max(0, Math.min(1, frac));
  const rad = Math.PI / 180;
  const au = a.windSpdMs * Math.sin(a.windDirDeg * rad);
  const av = a.windSpdMs * Math.cos(a.windDirDeg * rad);
  const bu = b.windSpdMs * Math.sin(b.windDirDeg * rad);
  const bv = b.windSpdMs * Math.cos(b.windDirDeg * rad);
  const u = au + (bu - au) * f;
  const v = av + (bv - av) * f;
  const wi = TURB_LEVELS.indexOf(a.turb);
  const wj = TURB_LEVELS.indexOf(b.turb);
  out.isaDevC = a.isaDevC + (b.isaDevC - a.isaDevC) * f;
  out.windSpdMs = Math.hypot(u, v);
  out.windDirDeg = (Math.atan2(u, v) / rad + 360) % 360;
  out.gustMs = a.gustMs + (b.gustMs - a.gustMs) * f;
  out.turb = TURB_LEVELS[Math.max(wi, wj)];
  return out;
}

/** Weather valid on leg `i` at fraction `f` (0 at the from-node, 1 at the to-node). */
export function weatherOnLeg(
  wx: WaypointWeather[],
  legIndex: number,
  frac: number,
): WaypointWeather {
  return weatherOnLegInto(
    { isaDevC: 0, windDirDeg: 0, windSpdMs: 0, gustMs: 0, turb: 'none' },
    wx,
    legIndex,
    frac,
  );
}

/** In-place form used by the mission integrator to avoid per-step allocation. */
export function weatherOnLegInto(
  out: WaypointWeather,
  wx: WaypointWeather[],
  legIndex: number,
  frac: number,
): WaypointWeather {
  const a = wx[Math.max(0, Math.min(wx.length - 1, legIndex))] ?? FALLBACK_WEATHER;
  const b = wx[Math.max(0, Math.min(wx.length - 1, legIndex + 1))] ?? a;
  return interpolateWeatherInto(out, a, b, frac);
}

/** A representative cell for a whole leg; used by the profile planner. */
export function legWeather(wx: WaypointWeather[], legIndex: number): WaypointWeather {
  return weatherOnLeg(wx, legIndex, 0.5);
}
