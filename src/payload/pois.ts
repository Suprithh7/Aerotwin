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
  const nodes = mission.nodes.filter((n) => n.type === 'RECON');
  const seedBase = `${mission.templateId ?? mission.id}:${mission.id}`;
  const out: PoiSpec[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
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
      anchor: node.name,
    });
  }
  return out;
}

/**
 * First mission-clock time each site comes inside the capture radius. The plan
 * is sampled at the same cadence the rehearsal clock uses for the marker, so a
 * loiter hold yields a capture as soon as the aircraft arrives.
 */
export function schedulePois(
  pois: PoiSpec[],
  plan: MissionPlan,
  wps: Waypoint[],
): ScheduledPoi[] {
  const out: ScheduledPoi[] = pois.map((p) => ({ ...p, captureAtS: null }));
  if (wps.length < 2 || !(plan.totalS > 0)) return out;
  let remaining = out.length;
  const visit = (clockS: number): void => {
    if (remaining <= 0) return;
    const pos = positionAtClock(plan, wps, clockS);
    if (!pos) return;
    for (const poi of out) {
      if (poi.captureAtS !== null) continue;
      if (distanceM(pos.lat, pos.lon, poi.lat, poi.lon) <= CAPTURE_RADIUS_M) {
        poi.captureAtS = clockS;
        remaining--;
      }
    }
  };
  for (let t = 0; t <= plan.totalS; t += CAPTURE_SAMPLE_S) visit(t);
  visit(plan.totalS);
  return out;
}
