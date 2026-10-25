import { beforeEach, describe, expect, it, vi } from 'vitest';

// The mission store reads the live snapshot only when a mission runs; stubbing
// the sim store keeps the Web Worker out of the Node test environment.
vi.mock('../../state/store', () => ({
  useSimStore: { getState: () => ({ snapshot: null }) },
}));

import {
  orbitRadiusM,
  pointInRing,
  pointToRouteM,
  routeSamples,
  segmentCrossesRing,
  segmentsIntersect,
  zoneCrossings,
} from '../geometry';
import { buildPreflight } from '../preflight';
import { distanceM, type Waypoint } from '../route';
import { missionFromGeoJson } from '../geoJson';
import { mergeTerrain, resolveWaypoints, terrainKey } from '../terrain';
import { useMissionStore } from '../missionStore';
import { MAX_NODES, type MissionZone } from '../types';
import type { WaypointWeather } from '../weather';

const store = () => useMissionStore.getState();

function weatherFor(n: number): WaypointWeather[] {
  return Array.from({ length: n }, () => ({
    isaDevC: 0,
    windDirDeg: 250,
    windSpdMs: 5,
    gustMs: 7,
    turb: 'light' as const,
  }));
}

const RING: [number, number][] = [
  [72.0, 26.0],
  [72.2, 26.0],
  [72.2, 26.2],
  [72.0, 26.2],
  [72.0, 26.0],
];

beforeEach(() => {
  store().loadTemplate('rajasthan');
  store().dismissNotice();
});

describe('mission geometry', () => {
  it('casts a point in and out of a closed ring', () => {
    expect(pointInRing(72.1, 26.1, RING)).toBe(true);
    expect(pointInRing(72.5, 26.1, RING)).toBe(false);
    expect(pointInRing(72.1, 26.5, RING)).toBe(false);
  });

  it('detects crossing and disjoint segments', () => {
    expect(segmentsIntersect([71, 26.1], [73, 26.1], [72, 26.0], [72, 26.2])).toBe(true);
    expect(segmentsIntersect([71, 26.5], [73, 26.5], [72, 26.0], [72, 26.2])).toBe(false);
    expect(segmentsIntersect([71, 26.1], [72, 26.1], [72, 26.0], [72, 26.2])).toBe(true);
  });

  it('marks a route that enters, crosses or starts inside a zone', () => {
    expect(segmentCrossesRing({ lat: 26.1, lon: 71.9 }, { lat: 26.1, lon: 72.3 }, RING)).toBe(true);
    expect(segmentCrossesRing({ lat: 26.4, lon: 71.9 }, { lat: 26.4, lon: 72.3 }, RING)).toBe(false);
    expect(segmentCrossesRing({ lat: 26.05, lon: 72.05 }, { lat: 26.1, lon: 72.1 }, RING)).toBe(true);
    expect(segmentCrossesRing({ lat: 26.05, lon: 72.05 }, { lat: 26.1, lon: 72.1 }, RING.slice(0, 4))).toBe(
      true,
    );
  });

  it('reports the first crossing leg and its endpoint names', () => {
    const wps: Waypoint[] = [
      { id: 1, name: 'ALPHA', lat: 26.1, lon: 71.8, altM: 1000, loiterMin: 0 },
      { id: 2, name: 'BRAVO', lat: 26.1, lon: 72.4, altM: 1000, loiterMin: 0 },
      { id: 3, name: 'CHARLIE', lat: 26.1, lon: 72.8, altM: 1000, loiterMin: 0 },
    ];
    const zone: MissionZone = { id: 5, name: 'FENCED', type: 'RESTRICTED', polygon: RING };
    const hits = zoneCrossings([zone], wps);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      zone,
      legIndex: 0,
      fromName: 'ALPHA',
      toName: 'BRAVO',
    });
    expect(zoneCrossings([zone], [wps[0], { ...wps[1], lat: 26.5 }])).toHaveLength(0);
  });

  it('samples the route about every step with monotonic distance', () => {
    const wps: Waypoint[] = [
      { id: 1, name: 'A', lat: 26, lon: 72, altM: 1000, loiterMin: 0 },
      { id: 2, name: 'B', lat: 26.02, lon: 72, altM: 1000, loiterMin: 0 },
      { id: 3, name: 'C', lat: 26.02, lon: 72.03, altM: 1000, loiterMin: 0 },
    ];
    const samples = routeSamples(wps, 500);
    const first = samples[0];
    const last = samples[samples.length - 1];
    expect(first).toMatchObject({ lat: 26, lon: 72, distM: 0, legIndex: 0 });
    expect(last.lat).toBeCloseTo(26.02, 9);
    expect(last.lon).toBeCloseTo(72.03, 9);
    expect(last.distM).toBeCloseTo(
      distanceM(26, 72, 26.02, 72) + distanceM(26.02, 72, 26.02, 72.03),
      3,
    );
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i].distM).toBeGreaterThanOrEqual(samples[i - 1].distM);
    }
    const capped = routeSamples(wps, 10, 50);
    expect(capped.length).toBeLessThanOrEqual(55);
    expect(capped[capped.length - 1].distM).toBeCloseTo(last.distM, 3);
  });

  it('measures a point to the route and sizes the loiter orbit', () => {
    const wps: Waypoint[] = [
      { id: 1, name: 'A', lat: 26, lon: 72, altM: 1000, loiterMin: 0 },
      { id: 2, name: 'B', lat: 26.02, lon: 72, altM: 1000, loiterMin: 0 },
    ];
    const offset = pointToRouteM(26.01, 72.001, wps);
    expect(offset).toBeGreaterThan(80);
    expect(offset).toBeLessThan(120);
    expect(orbitRadiusM(35, 20)).toBeCloseTo(343, 0);
    expect(orbitRadiusM(35, 20)).toBeGreaterThan(orbitRadiusM(25, 20));
  });
});

describe('pre-flight zone check', () => {
  it('flags a denied zone across a leg by name', () => {
    const wps = resolveWaypoints(store().mission);
    const zone: MissionZone = {
      id: 900,
      name: 'TEST ZONE',
      type: 'DENIED',
      polygon: [
        [72.75, 26.35],
        [72.85, 26.35],
        [72.85, 26.45],
        [72.75, 26.45],
        [72.75, 26.35],
      ],
    };
    const mission = { ...store().mission, zones: [zone] };
    const report = buildPreflight(mission, wps, weatherFor(wps.length));
    const check = report.checks.find((c) => c.id === 'zones')!;
    expect(check.status).toBe('CAUTION');
    expect(check.sentence).toContain('TEST ZONE');
    expect(check.sentence).toContain('JODHPUR - THAR EAST');
    expect(report.zoneHits).toHaveLength(1);

    const clear = buildPreflight(
      { ...mission, zones: [] },
      wps,
      weatherFor(wps.length),
    );
    expect(clear.checks.find((c) => c.id === 'zones')!.status).toBe('PASS');
  });

  it('keeps all six checks in the report', () => {
    const wps = resolveWaypoints(store().mission);
    const report = buildPreflight(store().mission, wps, weatherFor(wps.length));
    expect(report.checks.map((c) => c.id)).toEqual([
      'terrain',
      'zones',
      'fuel',
      'alternates',
      'datalink',
      'weather',
    ]);
    for (const check of report.checks) {
      expect(check.sentence.length).toBeGreaterThan(0);
    }
  });
});

describe('node editing and validation', () => {
  it('appends, drags, inserts and deletes nodes, then undoes and redoes each step', () => {
    const templateNames = store().mission.nodes.map((n) => n.name);

    store().addNodeAt(26.5, 72.5);
    const addedId = store().selectedNodeId!;
    expect(store().mission.nodes).toHaveLength(templateNames.length + 1);
    expect(store().mission.nodes[store().mission.nodes.length - 1]).toMatchObject({
      lat: 26.5,
      lon: 72.5,
    });

    store().moveNode(addedId, 26.6, 72.4);
    const moved = store().mission.nodes.find((n) => n.id === addedId)!;
    expect(moved.lat).toBeCloseTo(26.6, 9);
    expect(moved.lon).toBeCloseTo(72.4, 9);

    store().insertNodeAfter(0, 26.4, 73.0);
    const insertedId = store().selectedNodeId!;
    expect(store().mission.nodes[1].id).toBe(insertedId);
    expect(store().mission.nodes).toHaveLength(templateNames.length + 2);

    const beforeDelete = store().mission.nodes.map((n) => n.name);
    store().deleteNode(store().mission.nodes[2].id);
    const finalNames = store().mission.nodes.map((n) => n.name);
    expect(store().mission.nodes).toHaveLength(templateNames.length + 1);

    store().undo();
    expect(store().mission.nodes.map((n) => n.name)).toEqual(beforeDelete);
    store().undo();
    expect(store().mission.nodes).toHaveLength(templateNames.length + 1);
    expect(store().mission.nodes.find((n) => n.id === addedId)).toMatchObject({
      lat: 26.6,
      lon: 72.4,
    });
    store().undo();
    expect(store().mission.nodes.find((n) => n.id === addedId)).toMatchObject({
      lat: 26.5,
      lon: 72.5,
    });
    store().undo();
    expect(store().mission.nodes.map((n) => n.name)).toEqual(templateNames);
    expect(store().past).toHaveLength(0);

    store().redo();
    store().redo();
    store().redo();
    store().redo();
    expect(store().mission.nodes.map((n) => n.name)).toEqual(finalNames);
    expect(store().future).toHaveLength(0);
  });

  it('caps the undo history at 100 steps', () => {
    const id = store().mission.nodes[0].id;
    const startAlt = store().mission.nodes[0].alt;
    for (let k = 1; k <= 105; k++) {
      expect(store().updateNode(id, { alt: startAlt + k })).toBe(true);
    }
    expect(store().past).toHaveLength(100);
    for (let k = 0; k < 100; k++) store().undo();
    expect(store().past).toHaveLength(0);
    expect(store().mission.nodes[0].alt).toBe(startAlt + 5);
    expect(store().future).toHaveLength(100);
    store().redo();
    expect(store().mission.nodes[0].alt).toBe(startAlt + 6);
  });

  it('rejects invalid fields without touching the mission or history', () => {
    const id = store().mission.nodes[1].id;
    const before = JSON.stringify(store().mission);
    expect(store().updateNode(id, { lat: 91 })).toBe(false);
    expect(store().updateNode(id, { lon: -181 })).toBe(false);
    expect(store().updateNode(id, { alt: -5 })).toBe(false);
    expect(store().updateNode(id, { loiterMin: -1 })).toBe(false);
    expect(store().updateNode(id, { speed: 3 })).toBe(false);
    expect(store().updateNode(id, { name: '   ' })).toBe(false);
    expect(JSON.stringify(store().mission)).toBe(before);
    expect(store().past).toHaveLength(0);
  });

  it('clears an optional speed override', () => {
    const id = store().mission.nodes[1].id;
    expect(store().updateNode(id, { speed: 60 })).toBe(true);
    expect(store().mission.nodes.find((n) => n.id === id)!.speed).toBe(60);
    expect(store().updateNode(id, { speed: null })).toBe(true);
    expect(store().mission.nodes.find((n) => n.id === id)!.speed).toBeUndefined();
  });

  it('resolves an AGL node against cached terrain', () => {
    mergeTerrain({ [terrainKey(26.3, 72.9)]: 3000 });
    const id = store().mission.nodes[0].id;
    expect(
      store().updateNode(id, { lat: 26.3, lon: 72.9, alt: 500, altRef: 'AGL' }),
    ).toBe(true);
    const wps = resolveWaypoints(store().mission);
    expect(wps[0].altM).toBe(3500);
  });

  it('stops at 50 nodes', () => {
    while (store().mission.nodes.length < MAX_NODES) store().addNodeAt(26.5, 72.5);
    expect(store().mission.nodes).toHaveLength(MAX_NODES);
    store().addNodeAt(26.5, 72.5);
    expect(store().mission.nodes).toHaveLength(MAX_NODES);
    expect(store().notice).toContain('NODE LIMIT');
  });
});

describe('zone and search editing', () => {
  it('draws a closed zone and undoes it', () => {
    store().startZoneDraw();
    store().addZoneVertex(26.3, 72.7);
    store().addZoneVertex(26.3, 72.8);
    store().addZoneVertex(26.4, 72.8);
    expect(store().draftZone).toHaveLength(3);
    store().finishZone();
    const zone = store().mission.zones[store().mission.zones.length - 1];
    expect(zone.type).toBe('DENIED');
    expect(zone.polygon).toHaveLength(4);
    expect(zone.polygon[0]).toEqual(zone.polygon[zone.polygon.length - 1]);
    expect(store().mode).toBe('select');
    expect(store().draftZone).toHaveLength(0);

    store().undo();
    expect(store().mission.zones.find((z) => z.id === zone.id)).toBeUndefined();
  });

  it('accepts pasted coordinates and geocodes a place name', async () => {
    await store().search('12.9716, 77.5946');
    expect(store().searchStatus).toBe('done');
    expect(store().searchResults[0]).toMatchObject({
      name: 'PASTED COORDINATES',
      lat: 12.9716,
      lon: 77.5946,
    });

    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        return {
          ok: true,
          json: async () => ({
            results: [
              {
                id: 7,
                name: 'Mysuru',
                admin1: 'Karnataka',
                country: 'India',
                latitude: 12.2958,
                longitude: 76.6394,
              },
            ],
          }),
        };
      }),
    );
    await store().search('Mysuru');
    vi.unstubAllGlobals();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('geocoding-api.open-meteo.com');
    expect(calls[0]).toContain('name=Mysuru');
    expect(calls[0]).toContain('count=5');
    expect(store().searchResults[0]).toMatchObject({
      name: 'Mysuru',
      detail: 'Karnataka, India',
      lat: 12.2958,
      lon: 76.6394,
    });
    store().flyTo(12.2958, 76.6394);
    expect(store().flyTarget?.lat).toBe(12.2958);
    store().clearSearch();
    expect(store().searchResults).toHaveLength(0);
  });
});

describe('missions', () => {
  it('resets edits to the template but keeps the mission identity', () => {
    const templateNames = store().mission.nodes.map((n) => n.name);
    const id = store().mission.nodes[0].id;
    store().updateNode(id, { name: 'EDITED LAUNCH' });
    store().setMissionName('MY MISSION');
    expect(store().mission.nodes[0].name).toBe('EDITED LAUNCH');

    store().resetToTemplate();
    expect(store().mission.nodes.map((n) => n.name)).toEqual(templateNames);
    expect(store().mission.name).toBe('MY MISSION');
    expect(store().past).toHaveLength(3);
    store().undo();
    expect(store().mission.nodes[0].name).toBe('EDITED LAUNCH');
  });

  it('saves and reloads a mission by name', () => {
    store().loadTemplate('coastal');
    store().setMissionName('SAVED COAST');
    const id = store().mission.id;
    const count = store().mission.nodes.length;
    store().saveMission();
    expect(store().saved.some((s) => s.name === 'SAVED COAST')).toBe(true);

    store().addNodeAt(15.5, 73.8);
    expect(store().mission.nodes).toHaveLength(count + 1);
    store().loadSavedMission(id);
    expect(store().mission.name).toBe('SAVED COAST');
    expect(store().mission.nodes).toHaveLength(count);
  });

  it('round-trips its own GeoJSON export', () => {
    store().loadTemplate('coastal');
    store().setMissionName('ROUNDTRIP TEST');
    const id = store().mission.nodes[2].id;
    store().updateNode(id, { type: 'LOITER', altRef: 'AGL', alt: 300, speed: 60, loiterMin: 12 });
    store().startZoneDraw();
    store().addZoneVertex(15.3, 73.7);
    store().addZoneVertex(15.3, 73.9);
    store().addZoneVertex(15.5, 73.9);
    store().finishZone();

    const before = JSON.parse(JSON.stringify(store().mission));
    const text = store().exportMission();
    const fc = JSON.parse(text);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features.filter((f: { properties?: { kind?: string } }) => f.properties?.kind === 'node')).toHaveLength(
      before.nodes.length,
    );
    expect(fc.features.filter((f: { properties?: { kind?: string } }) => f.properties?.kind === 'zone')).toHaveLength(
      before.zones.length,
    );
    expect(
      fc.features.filter(
        (f: { properties?: { kind?: string } }) => f.properties?.kind === 'groundStation',
      ),
    ).toHaveLength(1);

    const res = store().importMission(text);
    expect(res).toEqual({ ok: true, error: null });
    expect(JSON.parse(JSON.stringify(store().mission))).toEqual(before);
  });

  it('reconstructs a foreign FeatureCollection without a mission member', () => {
    const foreign = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { kind: 'route', name: 'FOREIGN' },
          geometry: {
            type: 'LineString',
            coordinates: [
              [77.5, 12.9],
              [77.6, 13.0],
              [77.7, 13.1],
            ],
          },
        },
        {
          type: 'Feature',
          properties: { kind: 'node', type: 'LAUNCH', name: 'A', alt: 900, altRef: 'AGL', loiterMin: 0 },
          geometry: { type: 'Point', coordinates: [77.5, 12.9] },
        },
        {
          type: 'Feature',
          properties: { kind: 'node', type: 'WAYPOINT', name: 'B', alt: 950, altRef: 'AGL', loiterMin: 5 },
          geometry: { type: 'Point', coordinates: [77.6, 13.0] },
        },
        {
          type: 'Feature',
          properties: { kind: 'node', type: 'LAND', name: 'C', alt: 900, altRef: 'AGL', loiterMin: 0 },
          geometry: { type: 'Point', coordinates: [77.7, 13.1] },
        },
        {
          type: 'Feature',
          properties: { kind: 'zone', name: 'FOREIGN ZONE', zoneType: 'RESTRICTED' },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [77.55, 12.95],
                [77.65, 12.95],
                [77.65, 13.05],
                [77.55, 13.05],
                [77.55, 12.95],
              ],
            ],
          },
        },
        {
          type: 'Feature',
          properties: { kind: 'groundStation' },
          geometry: { type: 'Point', coordinates: [77.5, 12.9] },
        },
        {
          type: 'Feature',
          properties: { kind: 'site', name: 'FOREIGN STRIP', siteType: 'FIELD', elevM: 880 },
          geometry: { type: 'Point', coordinates: [77.72, 13.12] },
        },
      ],
    };
    const res = missionFromGeoJson(JSON.stringify(foreign));
    expect(res.error).toBeNull();
    const m = res.mission!;
    expect(m.name).toBe('FOREIGN');
    expect(m.nodes.map((n) => n.type)).toEqual(['LAUNCH', 'WAYPOINT', 'LAND']);
    expect(m.nodes[1].loiterMin).toBe(5);
    expect(m.zones[0]).toMatchObject({ name: 'FOREIGN ZONE', type: 'RESTRICTED' });
    expect(m.groundStation).toEqual({ lat: 12.9, lon: 77.5 });
    expect(m.customSites[0]).toMatchObject({ name: 'FOREIGN STRIP', type: 'FIELD', elevM: 880 });
  });

  it('rejects malformed GeoJSON and leaves the mission alone', () => {
    const before = JSON.stringify(store().mission);
    expect(store().importMission('{').ok).toBe(false);
    expect(store().importMission('{"type":"FeatureCollection","features":[]}').error).toContain(
      'no route LineString',
    );
    expect(JSON.stringify(store().mission)).toBe(before);
  });
});
