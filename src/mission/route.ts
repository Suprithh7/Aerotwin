// Route geometry, waypoints and mission presets.
// Waypoint altitudes are the cruise altitude of the leg FLYING TO that waypoint.
import type { TurbulenceLevel } from '../sim/types';

export interface Waypoint {
  id: number;
  name: string;
  lat: number;
  lon: number;
  altM: number; // leg cruise altitude to this point, m AMSL
  loiterMin: number; // station-keeping hold at this point, minutes
}

export interface RoutePreset {
  id: string;
  name: string;
  region: string;
  suggestedWeather: string;
  /** Airfield roles, so the map and the alternate logic know what the route is for. */
  homeIcao: string;
  destIcao: string;
  alternateIcaos: string[];
  waypoints: Waypoint[];
}

export const EARTH_RADIUS_M = 6371000;

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance, m (spherical law of haversines, R = 6371 km). */
export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial great-circle bearing from point 1 to point 2, degrees true 0..360. */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = rad(lat1);
  const φ2 = rad(lat2);
  const Δλ = rad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Wind component on a leg of the given bearing. Meteorological wind direction
 * is the direction the wind comes FROM, so a wind equal to the bearing is a
 * full headwind.
 */
export function windComponents(
  bearing: number,
  windDirDeg: number,
  windSpdMs: number,
): { headwindMs: number; crosswindMs: number } {
  const ang = rad(bearing - windDirDeg);
  return {
    headwindMs: windSpdMs * Math.cos(ang),
    crosswindMs: windSpdMs * Math.sin(ang),
  };
}

/** Groundspeed over a leg for an assumed true airspeed. */
export function groundspeedMs(
  tasMs: number,
  bearing: number,
  windDirDeg: number,
  windSpdMs: number,
): number {
  const { headwindMs } = windComponents(bearing, windDirDeg, windSpdMs);
  return Math.max(0, tasMs - headwindMs);
}

export interface LegGeometry {
  index: number; // leg i runs from waypoint i to waypoint i+1
  fromName: string;
  toName: string;
  distM: number;
  bearingDeg: number;
}

export function legGeometry(wps: Waypoint[]): LegGeometry[] {
  const out: LegGeometry[] = [];
  for (let i = 0; i < wps.length - 1; i++) {
    const a = wps[i];
    const b = wps[i + 1];
    out.push({
      index: i,
      fromName: a.name,
      toName: b.name,
      distM: distanceM(a.lat, a.lon, b.lat, b.lon),
      bearingDeg: bearingDeg(a.lat, a.lon, b.lat, b.lon),
    });
  }
  return out;
}

export function routeLengthM(wps: Waypoint[]): number {
  return legGeometry(wps).reduce((s, l) => s + l.distM, 0);
}

let idSeq = 1000;
export function nextWaypointId(): number {
  return ++idSeq;
}

export function renameWaypoints(wps: Waypoint[]): Waypoint[] {
  // Keep WP names sequential after edits (WP1, WP2, ... except named endpoints).
  return wps.map((w, i) => ({ ...w, name: w.name || `WP${i + 1}` }));
}

// --- presets -------------------------------------------------------------
// Illustrative waypoint sets only, laid on real Indian geography: the endpoints
// are the civil airfields in src/data/airfields.ts and the intermediate points
// are loiter holds over well-known valleys. Waypoints stay well inside the
// interior, away from international borders and the Line of Control. Profile
// times are 6-10 h on the mission fuel load. NOT operational planning data
// (see ASSUMPTIONS.md).

export const ROUTE_PRESETS: RoutePreset[] = [
  {
    id: 'ladakh',
    name: 'HIGH ALTITUDE',
    region: 'Indus valley, Ladakh - 3.3-5.4 km AMSL',
    suggestedWeather: 'hot-high',
    homeIcao: 'VILH',
    destIcao: 'VILH',
    alternateIcaos: ['VISR', 'VIJU', 'VICG'],
    waypoints: [
      { id: 1, name: 'LEH', lat: 34.135899, lon: 77.546501, altM: 3256, loiterMin: 0 },
      { id: 2, name: 'SHAM', lat: 34.116, lon: 77.1, altM: 5200, loiterMin: 180 },
      { id: 3, name: 'ALCHI', lat: 34.125, lon: 76.792, altM: 5400, loiterMin: 120 },
      { id: 4, name: 'PHEY', lat: 34.1136, lon: 77.4372, altM: 5000, loiterMin: 60 },
      { id: 5, name: 'LEH', lat: 34.135899, lon: 77.546501, altM: 3256, loiterMin: 0 },
    ],
  },
  {
    id: 'rajasthan',
    name: 'HOT DAY',
    region: 'Thar desert, Rajasthan - Jodhpur to Jaisalmer',
    suggestedWeather: 'hot-high',
    homeIcao: 'VIJO',
    destIcao: 'VIJR',
    alternateIcaos: ['VIBK', 'VIJP', 'VAUD', 'VABJ'],
    waypoints: [
      { id: 1, name: 'JODHPUR', lat: 26.251101, lon: 73.048897, altM: 219, loiterMin: 0 },
      { id: 2, name: 'THAR', lat: 26.7, lon: 72.15, altM: 3800, loiterMin: 150 },
      { id: 3, name: 'POKHRAN', lat: 26.8333, lon: 71.5333, altM: 4000, loiterMin: 120 },
      { id: 4, name: 'JAISALMER', lat: 26.8887, lon: 70.864998, altM: 229, loiterMin: 90 },
    ],
  },
  {
    id: 'coastal',
    name: 'HEADWIND',
    region: 'West coast - Mumbai to Kochi via Goa and Mangaluru',
    suggestedWeather: 'headwind',
    homeIcao: 'VABB',
    destIcao: 'VOCI',
    alternateIcaos: ['VOGO', 'VOML', 'VAKP'],
    waypoints: [
      { id: 1, name: 'MUMBAI', lat: 19.088699, lon: 72.867897, altM: 12, loiterMin: 0 },
      { id: 2, name: 'GOA', lat: 15.380062, lon: 73.833328, altM: 3800, loiterMin: 0 },
      { id: 3, name: 'MANGALURU', lat: 12.95471, lon: 74.886812, altM: 4000, loiterMin: 0 },
      { id: 4, name: 'KOCHI', lat: 10.151047, lon: 76.400838, altM: 9, loiterMin: 0 },
    ],
  },
];

export function presetById(id: string): RoutePreset | undefined {
  return ROUTE_PRESETS.find((p) => p.id === id);
}

export function clonePreset(id: string): Waypoint[] {
  const p = presetById(id) ?? ROUTE_PRESETS[0];
  return p.waypoints.map((w) => ({ ...w }));
}

/**
 * Hand edits are confined to a box around the selected preset's waypoint
 * bounding box, expanded by this many degrees on every side (see ASSUMPTIONS.md).
 */
export const PRESET_EDIT_MARGIN_DEG = 2;

export interface GeoBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export function presetEditBox(presetId: string): GeoBox {
  const p = presetById(presetId) ?? ROUTE_PRESETS[0];
  const lats = p.waypoints.map((w) => w.lat);
  const lons = p.waypoints.map((w) => w.lon);
  const m = PRESET_EDIT_MARGIN_DEG;
  return {
    minLat: Math.min(...lats) - m,
    maxLat: Math.max(...lats) + m,
    minLon: Math.min(...lons) - m,
    maxLon: Math.max(...lons) + m,
  };
}

/** Clamp a hand-placed point to the preset edit box; reports whether it moved. */
export function clampToPresetBox(
  presetId: string,
  lat: number,
  lon: number,
): { lat: number; lon: number; clamped: boolean } {
  const b = presetEditBox(presetId);
  const cLat = Math.min(b.maxLat, Math.max(b.minLat, lat));
  const cLon = Math.min(b.maxLon, Math.max(b.minLon, lon));
  return { lat: cLat, lon: cLon, clamped: cLat !== lat || cLon !== lon };
}

/** Interpolated position along a route for the live monitor marker. */
export interface TrackPoint {
  lat: number;
  lon: number;
  cumM: number; // cumulative distance from the start of the route
  bearingDeg: number; // heading of the outbound leg from this point
}

export function buildTrack(wps: Waypoint[], samplesPerLeg = 24): TrackPoint[] {
  const out: TrackPoint[] = [];
  if (wps.length < 2) return out;
  let cum = 0;
  for (let i = 0; i < wps.length - 1; i++) {
    const a = wps[i];
    const b = wps[i + 1];
    const legM = distanceM(a.lat, a.lon, b.lat, b.lon);
    const brg = bearingDeg(a.lat, a.lon, b.lat, b.lon);
    for (let s = 0; s < samplesPerLeg; s++) {
      const f = s / samplesPerLeg;
      out.push({
        lat: a.lat + (b.lat - a.lat) * f,
        lon: a.lon + (b.lon - a.lon) * f,
        cumM: cum + legM * f,
        bearingDeg: brg,
      });
    }
    cum += legM;
  }
  const last = wps[wps.length - 1];
  const prev = wps[wps.length - 2];
  out.push({
    lat: last.lat,
    lon: last.lon,
    cumM: cum,
    bearingDeg: bearingDeg(prev.lat, prev.lon, last.lat, last.lon),
  });
  return out;
}

/**
 * Position and heading at a distance along the track (linear interpolation on
 * the drawn polyline, which is what the marker needs).
 */
export function positionAlongTrack(
  track: TrackPoint[],
  distM: number,
): { lat: number; lon: number; bearingDeg: number } | null {
  if (track.length < 2) return null;
  const total = track[track.length - 1].cumM;
  if (total <= 0) return null;
  const d = Math.max(0, Math.min(total, distM));
  for (let i = 1; i < track.length; i++) {
    if (track[i].cumM >= d) {
      const a = track[i - 1];
      const b = track[i];
      const f = (d - a.cumM) / Math.max(1e-9, b.cumM - a.cumM);
      return {
        lat: a.lat + (b.lat - a.lat) * f,
        lon: a.lon + (b.lon - a.lon) * f,
        bearingDeg: b.bearingDeg,
      };
    }
  }
  const l = track[track.length - 1];
  return { lat: l.lat, lon: l.lon, bearingDeg: l.bearingDeg };
}

export type TurbInput = TurbulenceLevel;
