// Route geometry and the resolved waypoint type used by the simulator.
// Node altitudes arrive with a reference (AGL/AMSL); by the time they reach the
// profile planner they are resolved to metres AMSL (see mission/resolve.ts).
import type { TurbulenceLevel } from '../sim/types';

export interface Waypoint {
  id: number;
  name: string;
  lat: number;
  lon: number;
  altM: number; // leg cruise altitude to this point, m AMSL
  loiterMin: number; // station-keeping hold at this point, minutes
  speedMs?: number;
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
  const p1 = rad(lat1);
  const p2 = rad(lat2);
  const dl = rad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
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

export function renameWaypoints(wps: Waypoint[]): Waypoint[] {
  return wps.map((w, i) => ({ ...w, name: w.name || `WP${i + 1}` }));
}

/** Interpolated position along a route for markers and terrain sampling. */
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
