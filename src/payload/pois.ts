// Reconnaissance points of interest derived from the mission's RECON nodes.
// A RECON node is the survey target: its name is the anchor in the manifest and
// its position is the site. Sizes, types and priorities are seeded from the
// mission and node ids so every rehearsal of a mission collects the same items
// (ASSUMPTIONS.md).
import { distanceM } from '../mission/route';
import { positionAtClock, type MissionPlan } from '../mission/mission';
import type { Waypoint } from '../mission/route';
import type { Mission } from '../mission/types';
import { mulberry32 } from '../sim/rng';
import type { PayloadPriority, PayloadType, PoiSpec, ScheduledPoi } from './types';

/** The aircraft captures an item the first time it comes this close. */
export const CAPTURE_RADIUS_M = 3000;
const CAPTURE_SAMPLE_S = 5;

function hashString(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function clampSize(type: PayloadType, mb: number): number {
  const lo = type === 'IMAGE' ? 15 : 150;
  const hi = type === 'IMAGE' ? 60 : 600;
  return Math.round(Math.max(lo, Math.min(hi, mb)));
}

function priorityOf(roll: number): PayloadPriority {
  if (roll < 0.28) return 1;
  if (roll < 0.76) return 2;
  return 3;
}

/**
 * Deterministic manifest: one item per RECON node, in route order. The seeded
 * roll only varies the type, nominal size (+/-10 %), priority and a
 * sub-kilometre offset, so a mission always sees the same items.
 */
export function poisForMission(mission: Mission): PoiSpec[] {
  const nodes = mission.nodes
    .map((node, routeIndex) => ({ node, routeIndex }))
    .filter(({ node }) => node.type === 'RECON');
  const seedBase = `${mission.templateId ?? mission.id}:${mission.id}`;
  const out: PoiSpec[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const { node, routeIndex } = nodes[i];
    const rng = mulberry32(hashString(`${seedBase}:${node.id}:${node.name}`));
    const type: PayloadType = rng() < 0.55 ? 'VIDEO' : 'IMAGE';
    const baseMB = type === 'VIDEO' ? 280 + rng() * 300 : 28 + rng() * 34;
    const lat = node.lat + (rng() - 0.5) * 0.004;
    const lon = node.lon + (rng() - 0.5) * 0.004;
    out.push({
      id: i + 1,
      type,
      sizeMB: clampSize(type, baseMB * (0.9 + rng() * 0.2)),
      priority: priorityOf(rng()),
      lat,
      lon,
      routeIndex,
      anchor: node.name,
    });
  }
  return out;
}

/**
 * Ordered capture times. Items are scheduled by route order: a site becomes
 * eligible on the leg that leads into its own waypoint, and only after every
 * earlier RECON item has been captured. A later node that happens to lie near
 * an earlier leg is therefore never collected by proximity.
 */
export function schedulePois(
  pois: PoiSpec[],
  plan: MissionPlan,
  wps: Waypoint[],
): ScheduledPoi[] {
  const out: ScheduledPoi[] = pois.map((p) => ({ ...p, captureAtS: null }));
  if (wps.length < 2 || !(plan.totalS > 0) || out.length === 0) return out;

  const times: number[] = [];
  for (let t = 0; t <= plan.totalS; t += CAPTURE_SAMPLE_S) times.push(t);
  if (times[times.length - 1] !== plan.totalS) times.push(plan.totalS);
  const positions = times.map((t) => positionAtClock(plan, wps, t));

  let from = 0;
  for (const poi of out) {
    // Leg into the site's own waypoint; the first waypoint is eligible at T+0.
    const ownLeg = Math.max(0, Math.min(poi.routeIndex - 1, wps.length - 2));
    for (let i = from; i < times.length; i++) {
      const pos = positions[i];
      if (!pos) continue;
      if (poi.routeIndex > 0 && pos.legIndex < ownLeg) continue;
      if (distanceM(pos.lat, pos.lon, poi.lat, poi.lon) <= CAPTURE_RADIUS_M) {
        poi.captureAtS = times[i];
        from = i;
        break;
      }
    }
    // Never let a later item overtake one that could not be captured.
    if (poi.captureAtS === null) break;
  }
  return out;
}
