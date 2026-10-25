import { describe, expect, it } from 'vitest';
import { CAPTURE_RADIUS_M, poisForMission, schedulePois } from '../pois';
import { DUMMY_SCALE, buildDummyPayload, dummyPayloadBytes, previewDummyPayload } from '../dummy';
import { cloneTemplate } from '../../data/templates';
import { resolveWaypoints } from '../../mission/terrain';
import { distanceM } from '../../mission/route';
import { planMission, positionAtClock } from '../../mission/mission';
import type { WaypointWeather } from '../../mission/weather';
import type { PoiSpec } from '../types';

const TEMPLATES = ['ladakh', 'rajasthan', 'coastal'];

function weatherFor(n: number): WaypointWeather[] {
  return Array.from({ length: n }, () => ({
    isaDevC: 0,
    windDirDeg: 250,
    windSpdMs: 5,
    gustMs: 7,
    turb: 'none' as const,
  }));
}

function planFor(templateId: string) {
  const mission = cloneTemplate(templateId);
  const wps = resolveWaypoints(mission);
  return { mission, wps, plan: planMission(wps, weatherFor(wps.length)) };
}

function checkBounds(poi: PoiSpec) {
  expect(poi.id).toBeGreaterThan(0);
  expect(poi.sizeMB).toBeGreaterThanOrEqual(poi.type === 'IMAGE' ? 15 : 150);
  expect(poi.sizeMB).toBeLessThanOrEqual(poi.type === 'IMAGE' ? 60 : 600);
  expect([1, 2, 3]).toContain(poi.priority);
  expect(poi.anchor.length).toBeGreaterThan(0);
}

describe('recon points of interest', () => {
  it('gives each template one deterministic item per recon node', () => {
    for (const templateId of TEMPLATES) {
      const mission = cloneTemplate(templateId);
      const recon = mission.nodes.filter((n) => n.type === 'RECON').length;
      const a = poisForMission(mission);
      const b = poisForMission(mission);
      expect(a, templateId).toHaveLength(recon);
      expect(recon, templateId).toBe(5);
      expect(new Set(a.map((p) => p.id)).size).toBe(recon);
      a.forEach(checkBounds);
      expect(b).toEqual(a);
      expect(poisForMission({ ...mission, nodes: mission.nodes.map((n) => ({ ...n, type: 'WAYPOINT' as const })) })).toEqual([]);
    }
  });

  it('schedules a capture for every site within the mission', () => {
    const { mission, wps, plan } = planFor('ladakh');
    const scheduled = schedulePois(poisForMission(mission), plan, wps);
    expect(scheduled).toHaveLength(5);
    for (const poi of scheduled) {
      expect(poi.captureAtS, `poi ${poi.id}`).not.toBeNull();
      expect(poi.captureAtS!).toBeGreaterThanOrEqual(0);
      expect(poi.captureAtS!).toBeLessThanOrEqual(plan.totalS);
    }
  });

  it('captures in route order, not by proximity to a later node', () => {
    const { mission, wps, plan } = planFor('ladakh');
    const scheduled = schedulePois(poisForMission(mission), plan, wps);
    for (let i = 1; i < scheduled.length; i++) {
      expect(scheduled[i].id).toBe(scheduled[i - 1].id + 1);
      expect(
        scheduled[i].captureAtS!,
        `item ${scheduled[i].id} must not overtake item ${scheduled[i - 1].id}`,
      ).toBeGreaterThanOrEqual(scheduled[i - 1].captureAtS!);
    }
    // PHEY is the last RECON node but sits within 3 km of the outbound leg.
    // It may only be captured on the leg into its own waypoint (leg 7).
    const phey = scheduled.find((p) => p.anchor === 'PHEY')!;
    const at = positionAtClock(plan, wps, phey.captureAtS!);
    expect(at!.legIndex).toBe(7);
  });

  it('captures inside the 3 km radius and not before', () => {
    const { mission, wps, plan } = planFor('ladakh');
    const scheduled = schedulePois(poisForMission(mission), plan, wps);
    for (const poi of scheduled) {
      const at = positionAtClock(plan, wps, poi.captureAtS!);
      expect(at).not.toBeNull();
      const d = distanceM(at!.lat, at!.lon, poi.lat, poi.lon);
      expect(d, `poi ${poi.id}`).toBeLessThanOrEqual(CAPTURE_RADIUS_M + 250);
    }
  });

  it('returns no captures for an unplannable route', () => {
    const { mission, plan } = planFor('ladakh');
    const scheduled = schedulePois(poisForMission(mission), plan, []);
    expect(scheduled.every((p) => p.captureAtS === null)).toBe(true);
    expect(schedulePois([], plan, [])).toEqual([]);
  });
});

describe('dummy recon payload', () => {
  const poi: PoiSpec = {
    id: 4,
    type: 'VIDEO',
    sizeMB: 600,
    priority: 1,
    lat: 34.12,
    lon: 77.1,
    routeIndex: 3,
    anchor: 'SHAM',
  };

  it('scales the encrypted blob down by the documented factor', () => {
    expect(DUMMY_SCALE).toBe(100_000);
    expect(dummyPayloadBytes(600)).toBe(6000);
    expect(dummyPayloadBytes(15)).toBe(192);
    expect(dummyPayloadBytes(0)).toBe(192);
  });

  it('builds a deterministic plaintext with a readable header', () => {
    const a = buildDummyPayload(poi, 1450);
    const b = buildDummyPayload(poi, 1450);
    const c = buildDummyPayload(poi, 1451);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a.length).toBe(dummyPayloadBytes(poi.sizeMB));
    const preview = previewDummyPayload(a);
    expect(preview.startsWith('AEROTWIN RECON // VIDEO // ITEM 04')).toBe(true);
    expect(preview).toContain('PRIORITY 1');
    expect(preview).toContain('600 MB NOMINAL');
    expect(preview).toContain('1:100000');
  });
});
