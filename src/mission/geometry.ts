// Mission geometry: zone intersections, route sampling and orbit sizing.
import { bearingDeg, distanceM, type Waypoint } from './route';
import type { MissionZone } from './types';

const DEG = Math.PI / 180;
const M_PER_DEG = 111320;

/** Ray casting on a closed [lon, lat] ring. */
export function pointInRing(lon: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function orient(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): number {
  const v = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  return Math.abs(v) < 1e-14 ? 0 : Math.sign(v);
}

function onSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
): boolean {
  return (
    Math.min(ax, bx) - 1e-12 <= px &&
    px <= Math.max(ax, bx) + 1e-12 &&
    Math.min(ay, by) - 1e-12 <= py &&
    py <= Math.max(ay, by) + 1e-12
  );
}

export function segmentsIntersect(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number],
): boolean {
  const o1 = orient(a[0], a[1], b[0], b[1], c[0], c[1]);
  const o2 = orient(a[0], a[1], b[0], b[1], d[0], d[1]);
  const o3 = orient(c[0], c[1], d[0], d[1], a[0], a[1]);
  const o4 = orient(c[0], c[1], d[0], d[1], b[0], b[1]);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a[0], a[1], b[0], b[1], c[0], c[1])) return true;
  if (o2 === 0 && onSegment(a[0], a[1], b[0], b[1], d[0], d[1])) return true;
  if (o3 === 0 && onSegment(c[0], c[1], d[0], d[1], a[0], a[1])) return true;
  if (o4 === 0 && onSegment(c[0], c[1], d[0], d[1], b[0], b[1])) return true;
  return false;
}

/** True when a route segment enters or crosses the ring. */
export function segmentCrossesRing(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  ring: [number, number][],
): boolean {
  if (ring.length < 3) return false;
  if (pointInRing(a.lon, a.lat, ring) || pointInRing(b.lon, b.lat, ring)) return true;
  const pa: [number, number] = [a.lon, a.lat];
  const pb: [number, number] = [b.lon, b.lat];
  for (let i = 0; i < ring.length - 1; i++) {
    if (segmentsIntersect(pa, pb, ring[i], ring[i + 1])) return true;
  }
  // Tolerate rings stored without the repeated first vertex.
  if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
    if (segmentsIntersect(pa, pb, ring[ring.length - 1], ring[0])) return true;
  }
  return false;
}

export interface ZoneCrossing {
  zone: MissionZone;
  legIndex: number;
  fromName: string;
  toName: string;
}

/** First crossing of each zone by the route, in leg order. */
export function zoneCrossings(zones: MissionZone[], wps: Waypoint[]): ZoneCrossing[] {
  const out: ZoneCrossing[] = [];
  for (const zone of zones) {
    for (let i = 0; i < wps.length - 1; i++) {
      if (segmentCrossesRing(wps[i], wps[i + 1], zone.polygon)) {
        out.push({
          zone,
          legIndex: i,
          fromName: wps[i].name,
          toName: wps[i + 1].name,
        });
        break;
      }
    }
  }
  return out.sort((a, b) => a.legIndex - b.legIndex);
}

export interface RouteSample {
  lat: number;
  lon: number;
  legIndex: number;
  distM: number;
}

/**
 * Points spaced about `stepM` apart along the route, including both endpoints.
 * A cap keeps a very long route from generating an unbounded sample set.
 */
export function routeSamples(wps: Waypoint[], stepM = 1000, maxSamples = 1000): RouteSample[] {
  if (wps.length < 2) return wps.map((w) => ({ lat: w.lat, lon: w.lon, legIndex: 0, distM: 0 }));
  const legs: { distM: number; n: number }[] = [];
  let total = 0;
  for (let i = 0; i < wps.length - 1; i++) {
    const d = distanceM(wps[i].lat, wps[i].lon, wps[i + 1].lat, wps[i + 1].lon);
    legs.push({ distM: d, n: Math.max(1, Math.ceil(d / stepM)) });
    total += d;
  }
  const baseCount = legs.reduce((s, l) => s + l.n, 0) + 1;
  const scale = baseCount > maxSamples ? baseCount / maxSamples : 1;
  const out: RouteSample[] = [];
  let cum = 0;
  for (let i = 0; i < wps.length - 1; i++) {
    const a = wps[i];
    const b = wps[i + 1];
    const n = Math.max(1, Math.ceil(legs[i].n / scale));
    for (let k = 0; k < n; k++) {
      const f = k / n;
      out.push({
        lat: a.lat + (b.lat - a.lat) * f,
        lon: a.lon + (b.lon - a.lon) * f,
        legIndex: i,
        distM: cum + legs[i].distM * f,
      });
    }
    cum += legs[i].distM;
  }
  const last = wps[wps.length - 1];
  out.push({
    lat: last.lat,
    lon: last.lon,
    legIndex: wps.length - 2,
    distM: total,
  });
  return out;
}

/** Distance from a point to a segment on a local flat-earth projection. */
export function pointToSegmentM(
  lat: number,
  lon: number,
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const kx = Math.cos(lat * DEG) * M_PER_DEG;
  const ky = M_PER_DEG;
  const ax = (a.lon - lon) * kx;
  const ay = (a.lat - lat) * ky;
  const bx = (b.lon - lon) * kx;
  const by = (b.lat - lat) * ky;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return Math.hypot(ax + dx * t, ay + dy * t);
}

/** Distance from a point to the route polyline. */
export function pointToRouteM(
  lat: number,
  lon: number,
  wps: Waypoint[],
): number {
  let best = Infinity;
  for (let i = 0; i < wps.length - 1; i++) {
    best = Math.min(best, pointToSegmentM(lat, lon, wps[i], wps[i + 1]));
  }
  return best;
}

/** Radius of a level, co-ordinated turn: v^2 / (g tan bank). */
export function orbitRadiusM(tasMs: number, bankDeg = 20): number {
  const g = 9.80665;
  const v = Math.max(0, tasMs);
  return (v * v) / (g * Math.tan(Math.min(60, Math.max(1, bankDeg)) * DEG));
}

/** Midpoint of a leg and its bearing, used for insert handles and labels. */
export function legMidpoint(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): { lat: number; lon: number; bearingDeg: number; distM: number } {
  return {
    lat: (a.lat + b.lat) / 2,
    lon: (a.lon + b.lon) / 2,
    bearingDeg: bearingDeg(a.lat, a.lon, b.lat, b.lon),
    distM: distanceM(a.lat, a.lon, b.lat, b.lon),
  };
}

/** Great-circle point a distance along a bearing; used for the link ring hint. */
export function destinationPoint(
  lat: number,
  lon: number,
  bearing: number,
  distM: number,
): { lat: number; lon: number } {
  const d = distM / 6371000;
  const b = bearing * DEG;
  const p1 = lat * DEG;
  const l1 = lon * DEG;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 / DEG, lon: ((l2 / DEG + 540) % 360) - 180 };
}

/** Polygon ring for a circle, used by the datalink range overlay. */
export function circleRing(
  lat: number,
  lon: number,
  radiusM: number,
  steps = 72,
): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const p = destinationPoint(lat, lon, (i / steps) * 360, radiusM);
    ring.push([p.lon, p.lat]);
  }
  return ring;
}
