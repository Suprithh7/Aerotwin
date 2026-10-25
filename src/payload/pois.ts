// Reconnaissance points of interest: five fixed sites per route preset, close
// to a hold or a waypoint. Sizes and priorities come from a per-preset seed so
// every rehearsal of a preset collects the same manifest (ASSUMPTIONS.md).
import { distanceM } from '../mission/route';
import { positionAtClock, type MissionPlan } from '../mission/mission';
import type { Waypoint } from '../mission/route';
import { mulberry32 } from '../sim/rng';
import type {
  PayloadPriority,
  PayloadType,
  PoiSpec,
  ScheduledPoi,
} from './types';

/** The aircraft captures an item the first time it comes this close. */
export const CAPTURE_RADIUS_M = 3000;
const CAPTURE_SAMPLE_S = 5;

interface PoiAnchor {
  type: PayloadType;
  baseMB: number;
  priority: PayloadPriority;
  lat: number;
  lon: number;
  anchor: string;
}

interface PresetSeed {
  seed: number;
  anchors: PoiAnchor[];
}

const POI_SEEDS: Record<string, PresetSeed> = {
  ladakh: {
    seed: 0x1a2b3c,
    anchors: [
      { type: 'VIDEO', baseMB: 600, priority: 1, lat: 34.118, lon: 77.104, anchor: 'SHAM' },
      { type: 'IMAGE', baseMB: 58, priority: 3, lat: 34.113, lon: 77.096, anchor: 'SHAM' },
      { type: 'IMAGE', baseMB: 44, priority: 2, lat: 34.127, lon: 76.795, anchor: 'ALCHI' },
      { type: 'VIDEO', baseMB: 260, priority: 2, lat: 34.122, lon: 76.788, anchor: 'ALCHI' },
      { type: 'IMAGE', baseMB: 36, priority: 3, lat: 34.112, lon: 77.44, anchor: 'PHEY' },
    ],
  },
  rajasthan: {
    seed: 0x2b3c4d,
    anchors: [
      { type: 'VIDEO', baseMB: 480, priority: 1, lat: 26.68, lon: 72.16, anchor: 'THAR' },
      { type: 'IMAGE', baseMB: 52, priority: 3, lat: 26.705, lon: 72.147, anchor: 'THAR' },
      { type: 'VIDEO', baseMB: 340, priority: 2, lat: 26.835, lon: 71.536, anchor: 'POKHRAN' },
      { type: 'IMAGE', baseMB: 27, priority: 3, lat: 26.831, lon: 71.531, anchor: 'POKHRAN' },
      { type: 'IMAGE', baseMB: 60, priority: 3, lat: 26.887, lon: 70.868, anchor: 'JAISALMER' },
    ],
  },
  coastal: {
    seed: 0x3c4d5e,
    anchors: [
      { type: 'VIDEO', baseMB: 520, priority: 1, lat: 15.382, lon: 73.835, anchor: 'GOA' },
      { type: 'IMAGE', baseMB: 33, priority: 3, lat: 15.378, lon: 73.831, anchor: 'GOA' },
      { type: 'VIDEO', baseMB: 410, priority: 2, lat: 12.956, lon: 74.889, anchor: 'MANGALURU' },
      { type: 'IMAGE', baseMB: 49, priority: 2, lat: 12.952, lon: 74.884, anchor: 'MANGALURU' },
      { type: 'IMAGE', baseMB: 41, priority: 3, lat: 10.153, lon: 76.403, anchor: 'KOCHI' },
    ],
  },
};

const cache = new Map<string, PoiSpec[]>();

function clampSize(type: PayloadType, mb: number): number {
  const lo = type === 'IMAGE' ? 15 : 150;
  const hi = type === 'IMAGE' ? 60 : 600;
  return Math.round(Math.max(lo, Math.min(hi, mb)));
}

/**
 * Deterministic manifest. The seed only varies the nominal size (+/-10 %) and a
 * sub-kilometre position offset, so every run of a preset sees the same items.
 */
export function poisForPreset(presetId: string): PoiSpec[] {
  const cached = cache.get(presetId);
  if (cached) return cached;
  const seed = POI_SEEDS[presetId];
  if (!seed) return [];
  const rng = mulberry32(seed.seed);
  const pois = seed.anchors.map((a, i) => {
    const lat = a.lat + (rng() - 0.5) * 0.006;
    const lon = a.lon + (rng() - 0.5) * 0.006;
    return {
      id: i + 1,
      type: a.type,
      sizeMB: clampSize(a.type, a.baseMB * (0.9 + rng() * 0.2)),
      priority: a.priority,
      lat,
      lon,
      anchor: a.anchor,
    } satisfies PoiSpec;
  });
  cache.set(presetId, pois);
  return pois;
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
