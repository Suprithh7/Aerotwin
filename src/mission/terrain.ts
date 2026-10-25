// Terrain elevation cache and the AGL -> AMSL conversion shared by the map,
// profile planner, weather fetch and pre-flight checks.
//
// The map does not enable terrain, so the fallback source is the Open-Meteo
// elevation endpoint (batches of up to 100 points). Values are cached by a
// 4-decimal coordinate key; that is about 11 m at the equator, finer than the
// DEM resolution, and keeps a dragged node from refetching on every pixel.
import type { Mission, MissionNode } from './types';
import type { Waypoint } from './route';

export const TERRAIN_CACHE_PREFIX = 'aerotwin.terrain.v1';
const KEY_DECIMALS = 4;
const MAX_STORED = 4000;

export type TerrainMap = Record<string, number>;

export function terrainKey(lat: number, lon: number): string {
  return `${lat.toFixed(KEY_DECIMALS)},${lon.toFixed(KEY_DECIMALS)}`;
}

let memory: TerrainMap | null = null;

function load(): TerrainMap {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(TERRAIN_CACHE_PREFIX);
    memory = raw ? (JSON.parse(raw) as TerrainMap) : {};
  } catch {
    memory = {};
  }
  return memory;
}

function persist(map: TerrainMap): void {
  try {
    const keys = Object.keys(map);
    if (keys.length > MAX_STORED) {
      for (const k of keys.slice(0, keys.length - MAX_STORED)) delete map[k];
    }
    localStorage.setItem(TERRAIN_CACHE_PREFIX, JSON.stringify(map));
  } catch {
    /* storage unavailable: the memory cache still applies */
  }
}

export function terrainCached(lat: number, lon: number): number | undefined {
  return load()[terrainKey(lat, lon)];
}

export function terrainElevation(lat: number, lon: number): number {
  return terrainCached(lat, lon) ?? 0;
}

/** Merge externally fetched elevations into the cache and return the full map. */
export function mergeTerrain(patch: TerrainMap): TerrainMap {
  const map = load();
  let changed = false;
  for (const [k, v] of Object.entries(patch)) {
    if (Number.isFinite(v) && map[k] !== v) {
      map[k] = v;
      changed = true;
    }
  }
  if (changed) persist(map);
  return map;
}

export function cachedTerrainMap(): TerrainMap {
  return { ...load() };
}

interface ElevationResponse {
  elevation?: number[];
}

/**
 * Fetch elevations for points not already cached. Never throws; a failed batch
 * is simply absent from the returned map.
 */
export async function fetchTerrain(
  points: { lat: number; lon: number }[],
  signal?: AbortSignal,
): Promise<TerrainMap> {
  const map = load();
  const missing = new Map<string, { lat: number; lon: number }>();
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    const k = terrainKey(p.lat, p.lon);
    if (!(k in map)) missing.set(k, p);
  }
  const all = [...missing.entries()];
  const patch: TerrainMap = {};
  for (let i = 0; i < all.length; i += 100) {
    const batch = all.slice(i, i + 100);
    const lat = batch.map(([, p]) => p.lat.toFixed(5)).join(',');
    const lon = batch.map(([, p]) => p.lon.toFixed(5)).join(',');
    try {
      const res = await fetch(
        `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`,
        { signal },
      );
      if (!res.ok) continue;
      const j = (await res.json()) as ElevationResponse;
      const values = j.elevation ?? [];
      batch.forEach(([k], idx) => {
        const v = values[idx];
        if (typeof v === 'number' && Number.isFinite(v)) patch[k] = v;
      });
    } catch {
      if (signal?.aborted) break;
    }
  }
  mergeTerrain(patch);
  return patch;
}

export function nodeTerrain(node: Pick<MissionNode, 'lat' | 'lon'>): number {
  return terrainElevation(node.lat, node.lon);
}

export function nodeAltAmsl(node: MissionNode): number {
  return node.altRef === 'AGL' ? node.alt + nodeTerrain(node) : node.alt;
}

/** Resolve every mission node to the AMSL waypoint the profile planner uses. */
export function resolveWaypoints(mission: Mission): Waypoint[] {
  return mission.nodes.map((n) => ({
    id: n.id,
    name: n.name,
    lat: n.lat,
    lon: n.lon,
    altM: Math.max(0, Math.round(nodeAltAmsl(n))),
    loiterMin: n.loiterMin,
    ...(n.speed !== undefined ? { speedMs: n.speed } : {}),
  }));
}

export function aglAt(lat: number, lon: number, altM: number): number {
  return altM - terrainElevation(lat, lon);
}
