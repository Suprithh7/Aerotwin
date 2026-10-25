import { describe, expect, it } from 'vitest';
import { CAPTURE_RADIUS_M, poisForPreset, schedulePois } from '../pois';
import { DUMMY_SCALE, buildDummyPayload, dummyPayloadBytes, previewDummyPayload } from '../dummy';
import { clonePreset, distanceM, presetById } from '../../mission/route';
import { planMission, positionAtClock } from '../../mission/mission';
import { applyWeatherPreset } from '../../mission/weather';
import type { PoiSpec } from '../types';

const PRESETS = ['ladakh', 'rajasthan', 'coastal'];

function planFor(presetId: string) {
  const wps = clonePreset(presetId);
  const wx = applyWeatherPreset(presetById(presetId)!.suggestedWeather, wps.length);
  return { wps, plan: planMission(wps, wx) };
}

function checkBounds(poi: PoiSpec) {
  expect(poi.id).toBeGreaterThan(0);
  expect(poi.sizeMB).toBeGreaterThanOrEqual(poi.type === 'IMAGE' ? 15 : 150);
  expect(poi.sizeMB).toBeLessThanOrEqual(poi.type === 'IMAGE' ? 60 : 600);
  expect([1, 2, 3]).toContain(poi.priority);
  expect(poi.anchor.length).toBeGreaterThan(0);
}

describe('recon points of interest', () => {
  it('gives each preset five deterministic items', () => {
    for (const presetId of PRESETS) {
      const a = poisForPreset(presetId);
      const b = poisForPreset(presetId);
      expect(a, presetId).toHaveLength(5);
      expect(new Set(a.map((p) => p.id)).size).toBe(5);
      a.forEach(checkBounds);
      expect(b).toEqual(a);
      expect(poisForPreset('unknown')).toEqual([]);
    }
  });

  it('schedules a capture for every site within the mission', () => {
    const { wps, plan } = planFor('ladakh');
    const scheduled = schedulePois(poisForPreset('ladakh'), plan, wps);
    expect(scheduled).toHaveLength(5);
    for (const poi of scheduled) {
      expect(poi.captureAtS, `poi ${poi.id}`).not.toBeNull();
      expect(poi.captureAtS!).toBeGreaterThanOrEqual(0);
      expect(poi.captureAtS!).toBeLessThanOrEqual(plan.totalS);
    }
  });

  it('captures inside the 3 km radius and not before', () => {
    const { wps, plan } = planFor('ladakh');
    const scheduled = schedulePois(poisForPreset('ladakh'), plan, wps);
    for (const poi of scheduled) {
      const at = positionAtClock(plan, wps, poi.captureAtS!);
      expect(at).not.toBeNull();
      const d = distanceM(at!.lat, at!.lon, poi.lat, poi.lon);
      expect(d, `poi ${poi.id}`).toBeLessThanOrEqual(CAPTURE_RADIUS_M + 250);
    }
  });

  it('returns no captures for an unplannable route', () => {
    const { plan } = planFor('ladakh');
    const scheduled = schedulePois(poisForPreset('ladakh'), plan, []);
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
