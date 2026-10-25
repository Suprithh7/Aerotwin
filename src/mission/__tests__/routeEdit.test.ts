import { beforeEach, describe, expect, it, vi } from 'vitest';

// The mission store reads the live snapshot only when a mission runs; stubbing
// the sim store keeps the Web Worker out of the Node test environment.
vi.mock('../../state/store', () => ({
  useSimStore: { getState: () => ({ snapshot: null }) },
}));

import { useMissionStore } from '../missionStore';
import { PRESET_EDIT_MARGIN_DEG, presetEditBox, ROUTE_PRESETS } from '../route';

const store = () => useMissionStore.getState();
const hot = ROUTE_PRESETS.find((p) => p.id === 'rajasthan')!;

beforeEach(() => {
  store().setRoute('rajasthan');
  store().dismissRouteNotice();
});

describe('route locking', () => {
  it('HOT DAY carries exactly the four named desert points', () => {
    expect(hot.waypoints.map((w) => w.name)).toEqual(['JODHPUR', 'THAR', 'POKHRAN', 'JAISALMER']);
  });

  it('starts locked and ignores hand-placed additions', () => {
    expect(store().routeEditMode).toBe(false);
    const n = store().waypoints.length;
    store().addWaypoint(26.5, 72.5);
    expect(store().waypoints.length).toBe(n);
  });

  it('accepts additions only while edit route is on', () => {
    store().setRouteEditMode(true);
    store().addWaypoint(26.5, 72.5);
    expect(store().waypoints.length).toBe(hot.waypoints.length + 1);
    expect(store().routeNotice).toBeNull();
  });
});

describe('preset region clamp', () => {
  it('box is the preset waypoint bounds plus the documented margin', () => {
    const b = presetEditBox('rajasthan');
    const lats = hot.waypoints.map((w) => w.lat);
    const lons = hot.waypoints.map((w) => w.lon);
    expect(b.minLat).toBeCloseTo(Math.min(...lats) - PRESET_EDIT_MARGIN_DEG, 9);
    expect(b.maxLon).toBeCloseTo(Math.max(...lons) + PRESET_EDIT_MARGIN_DEG, 9);
  });

  it('clamps a far-away addition, records it and warns', () => {
    store().setRouteEditMode(true);
    store().addWaypoint(10, 60);
    const b = presetEditBox('rajasthan');
    const wps = store().waypoints;
    const wp = wps[wps.length - 1];
    expect(wp.lat).toBe(b.minLat);
    expect(wp.lon).toBe(b.minLon);
    expect(store().routeNotice).toContain('CLAMPED');
  });

  it('clamps a dragged waypoint to the same box', () => {
    store().setRouteEditMode(true);
    const id = store().waypoints[1].id;
    store().moveWaypoint(id, 35, 85);
    const b = presetEditBox('rajasthan');
    const wp = store().waypoints.find((w) => w.id === id)!;
    expect(wp.lat).toBe(b.maxLat);
    expect(wp.lon).toBe(b.maxLon);
    expect(store().routeNotice).toContain('CLAMPED');
  });

  it('returns the untouched coordinates when inside the box', () => {
    store().setRouteEditMode(true);
    const id = store().waypoints[1].id;
    store().moveWaypoint(id, 26.6, 72.3);
    const wp = store().waypoints.find((w) => w.id === id)!;
    expect(wp.lat).toBeCloseTo(26.6, 9);
    expect(wp.lon).toBeCloseTo(72.3, 9);
    expect(store().routeNotice).toBeNull();
  });
});

describe('reset preset', () => {
  it('restores the base preset and locks the route again', () => {
    store().setRouteEditMode(true);
    store().addWaypoint(26.5, 72.5);
    expect(store().waypoints.length).toBe(5);
    store().resetPreset();
    expect(store().waypoints.map((w) => w.name)).toEqual([
      'JODHPUR',
      'THAR',
      'POKHRAN',
      'JAISALMER',
    ]);
    expect(store().routePresetId).toBe('rajasthan');
    expect(store().routeEditMode).toBe(false);
  });
});
