import { describe, expect, it, vi } from 'vitest';
import {
  bearingDeg,
  buildTrack,
  clonePreset,
  distanceM,
  groundspeedMs,
  legGeometry,
  positionAlongTrack,
  windComponents,
  type Waypoint,
} from '../route';
import { applyWeatherPreset, fetchLiveWeather, isaDevFromSurface, type WaypointWeather } from '../weather';
import {
  MISSION_AIRSPEED,
  MIN_GROUNDSPEED_MS,
  MISSION_FUEL_KG,
  MISSION_RESERVE_KG,
  gustExcessToTurbulence,
} from '../constants';
import { CHT_LIMIT_C } from '../../sim/limits';
import { planMission, positionAtClock, requiredPowerKw, runMission } from '../mission';
import { drawRunSet, runMonteCarlo } from '../monteCarlo';
import { atmosphere } from '../../sim/atmosphere';
import { SIM_DT } from '../../sim/constants';
import { createDerived, nominalParams, stepEngine, stepEngineInto, type EngineInputs } from '../../sim/engineModel';
import { settledEngineState } from '../../sim/sim';

const CRUISE_TAS = MISSION_AIRSPEED.cruise;

describe('route geometry', () => {
  it('matches a known great-circle quarter arc', () => {
    // 90 deg of longitude on the equator is a quarter of the 6371 km circle.
    expect(distanceM(0, 0, 0, 90)).toBeCloseTo((Math.PI / 2) * 6371000, -2);
  });

  it('is symmetric and zero for identical points', () => {
    const a = distanceM(34.15, 77.57, 33.51, 78.85);
    const b = distanceM(33.51, 78.85, 34.15, 77.57);
    expect(a).toBeCloseTo(b, 3);
    expect(distanceM(34.15, 77.57, 34.15, 77.57)).toBeCloseTo(0, 6);
  });

  it('holds for the reference Leh-DBO leg', () => {
    // Independent haversine evaluation of 34.1526,77.5771 -> 33.5167,78.85.
    const d = distanceM(34.1526, 77.5771, 33.5167, 78.85);
    expect(d).toBeGreaterThan(135000);
    expect(d).toBeLessThan(145000);
  });

  it('gives the four cardinal initial bearings', () => {
    expect(bearingDeg(0, 0, 10, 0)).toBeCloseTo(0, 6);
    expect(bearingDeg(0, 0, 0, 10)).toBeCloseTo(90, 6);
    expect(bearingDeg(0, 0, -10, 0)).toBeCloseTo(180, 6);
    expect(bearingDeg(0, 0, 0, -10)).toBeCloseTo(270, 6);
  });

  it('builds a monotonic track that interpolates back to the waypoints', () => {
    const wps = clonePreset('rajasthan');
    const track = buildTrack(wps);
    expect(track[0].cumM).toBe(0);
    expect(track[track.length - 1].cumM).toBeCloseTo(legGeometry(wps).reduce((s, l) => s + l.distM, 0), 3);
    const mid = positionAlongTrack(track, track[track.length - 1].cumM * 0.5);
    expect(mid).not.toBeNull();
  });
});

describe('wind and groundspeed', () => {
  it('resolves head, tail and cross components', () => {
    expect(windComponents(90, 90, 12).headwindMs).toBeCloseTo(12, 6);
    expect(windComponents(90, 270, 12).headwindMs).toBeCloseTo(-12, 6);
    expect(windComponents(90, 180, 12).headwindMs).toBeCloseTo(0, 6);
    expect(Math.abs(windComponents(90, 180, 12).crosswindMs)).toBeCloseTo(12, 6);
  });

  it('subtracts headwind and adds tailwind from true airspeed', () => {
    expect(groundspeedMs(CRUISE_TAS, 90, 90, 15)).toBeCloseTo(CRUISE_TAS - 15, 6);
    expect(groundspeedMs(CRUISE_TAS, 90, 270, 15)).toBeCloseTo(CRUISE_TAS + 15, 6);
    expect(groundspeedMs(CRUISE_TAS, 90, 180, 15)).toBeCloseTo(CRUISE_TAS, 6);
  });

  it('sets leg time from groundspeed and floors it at the minimum', () => {
    const wps: Waypoint[] = [
      { id: 1, name: 'A', lat: 26.9, lon: 70.9, altM: 3000, loiterMin: 0 },
      { id: 2, name: 'B', lat: 26.9, lon: 71.9, altM: 3000, loiterMin: 0 },
    ];
    const geo = legGeometry(wps);
    const calm = planMission(wps, applyWeatherPreset('standard', 2).map((w) => ({ ...w, windSpdMs: 0 })));
    expect(calm.legs[0].gsMs).toBeCloseTo(CRUISE_TAS, 6);
    expect(calm.legs[0].timeS).toBeCloseTo(geo[0].distM / CRUISE_TAS, 3);

    // Wind blowing from the direction the leg heads: full headwind. Strong
    // enough to drive the groundspeed below the floor.
    const head = planMission(wps, [{ isaDevC: 0, windDirDeg: calm.legs[0].bearingDeg, windSpdMs: 70, gustMs: 70, turb: 'none' }]);
    expect(head.legs[0].headwindMs).toBeCloseTo(70, 3);
    expect(head.legs[0].gsMs).toBeCloseTo(MIN_GROUNDSPEED_MS, 6);
    expect(head.totalS).toBeGreaterThan(calm.totalS);

    const tail = planMission(wps, [
      { isaDevC: 0, windDirDeg: (calm.legs[0].bearingDeg + 180) % 360, windSpdMs: 10, gustMs: 12, turb: 'none' },
    ]);
    expect(tail.legs[0].gsMs).toBeCloseTo(CRUISE_TAS + 10, 3);
    expect(tail.totalS).toBeLessThan(calm.totalS);
  });
});

describe('weather mapping', () => {
  it('maps gust excess to turbulence bands', () => {
    expect(gustExcessToTurbulence(8, 7)).toBe('none');
    expect(gustExcessToTurbulence(10, 7)).toBe('light');
    expect(gustExcessToTurbulence(12.4, 7)).toBe('moderate');
    expect(gustExcessToTurbulence(20, 7)).toBe('severe');
    // Sustained wind floors the level even with no gust excess.
    expect(gustExcessToTurbulence(13, 13)).toBe('moderate');
    expect(gustExcessToTurbulence(18, 18)).toBe('severe');
  });

  it('derives ISA deviation from a station temperature and elevation', () => {
    // Sea level, 15 deg C standard atmosphere: zero deviation.
    expect(isaDevFromSurface(15, 0)).toBeCloseTo(0, 6);
    expect(isaDevFromSurface(30, 0)).toBeCloseTo(15, 6);
    // Leh-Karu is about 3.5 km AMSL; standard temperature there is -7.8 deg C.
    expect(isaDevFromSurface(2, 3500)).toBeCloseTo(9.75, 2);
  });

  it('spreads presets over the requested waypoint count', () => {
    const wx = applyWeatherPreset('hot-high', 9);
    expect(wx).toHaveLength(9);
    expect(wx[8].isaDevC).toBe(wx[5].isaDevC);
  });
});

describe('live weather fetch', () => {
  const PRESET: WaypointWeather[] = [
    { isaDevC: 7, windDirDeg: 250, windSpdMs: 12, gustMs: 20, turb: 'moderate' },
  ];

  it('maps a station report to ISA deviation and gust bands, then serves the cache', async () => {
    const wp: Waypoint = { id: 1, name: 'A', lat: 10.1234, lon: 70.5678, altM: 300, loiterMin: 0 };
    const calls: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls.push(1);
        return {
          ok: true,
          json: async () => ({
            elevation: 30,
            current: {
              temperature_2m: 31,
              wind_speed_10m: 6,
              wind_direction_10m: 245,
              wind_gusts_10m: 9,
            },
          }),
        };
      }),
    );
    const first = await fetchLiveWeather([wp], PRESET);
    const cell = first.cells[0];
    expect(cell?.source.kind).toBe('live');
    // 31 degC at 30 m elevation, standard 14.8 degC: rounded deviation +16.
    expect(cell?.isaDevC).toBe(16);
    expect(cell?.windSpdMs).toBe(6);
    expect(cell?.turb).toBe('light');
    expect(first.notice).toBeNull();

    // Same coordinates, network now dead: the cached cell is reused, no notice.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const second = await fetchLiveWeather([wp], PRESET);
    expect(calls).toHaveLength(1);
    expect(second.cells[0]?.source.kind).toBe('cache');
    expect(second.notice).toBeNull();
    vi.unstubAllGlobals();
  });

  it('falls back to preset values with a notice when the network is down', async () => {
    const wp: Waypoint = { id: 2, name: 'B', lat: 20.4321, lon: 71.8765, altM: 300, loiterMin: 0 };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const r = await fetchLiveWeather([wp], PRESET);
    vi.unstubAllGlobals();
    expect(r.cells[0]).not.toBeNull();
    expect(r.cells[0]?.source.kind).toBe('preset');
    expect(r.cells[0]?.isaDevC).toBe(7);
    expect(r.notice).toBe('LIVE WEATHER UNAVAILABLE - USING PRESET VALUES');
  });

  it('reports a bad response as a preset fallback per point', async () => {
    const wp: Waypoint = { id: 3, name: 'C', lat: 21.9876, lon: 69.1234, altM: 300, loiterMin: 0 };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    const r = await fetchLiveWeather([wp], PRESET);
    vi.unstubAllGlobals();
    expect(r.cells[0]?.source.kind).toBe('preset');
    expect(r.notice).toBe('LIVE WEATHER UNAVAILABLE - USING PRESET VALUES');
  });
});

describe('mission plan and profile', () => {
  it('builds takeoff, climb, cruise, loiter, descent and landing segments', () => {
    const wps = clonePreset('ladakh');
    const plan = planMission(wps, applyWeatherPreset('standard', wps.length));
    const kinds = plan.segs.map((s) => s.kind);
    expect(kinds[0]).toBe('takeoff');
    expect(kinds[kinds.length - 1]).toBe('landing');
    expect(kinds).toContain('climb');
    expect(kinds).toContain('loiter');
    expect(kinds).toContain('descent');
    expect(plan.segs.reduce((s, x) => s + x.durS, 0)).toBeCloseTo(plan.totalS, 6);
    expect(plan.totalS / 3600).toBeGreaterThan(6);
    expect(plan.totalS / 3600).toBeLessThan(10);
  });

  it('advances the marker only along cruise legs and keeps it on the route', () => {
    const wps = clonePreset('rajasthan');
    const plan = planMission(wps, applyWeatherPreset('headwind', wps.length));
    const track = buildTrack(wps);
    const total = track[track.length - 1].cumM;
    for (const f of [0, 0.25, 0.5, 0.75, 0.99]) {
      const p = positionAtClock(plan, wps, plan.totalS * f);
      expect(p).not.toBeNull();
      expect(p!.lat).toBeGreaterThanOrEqual(Math.min(...wps.map((w) => w.lat)) - 0.01);
      expect(p!.distM).toBeLessThanOrEqual(total + 1);
    }
    const mid = positionAtClock(plan, wps, plan.totalS * 0.5)!;
    expect(mid.bearingDeg).toBeGreaterThanOrEqual(0);
    expect(mid.bearingDeg).toBeLessThan(360);
  });
});

describe('required power', () => {
  it('scales the propeller load with the density ratio', () => {
    const sl = requiredPowerKw('cruise', 1);
    const high = requiredPowerKw('cruise', atmosphere(6000, 0).sigma);
    expect(sl).toBeGreaterThan(40);
    expect(sl).toBeLessThan(50);
    expect(high / sl).toBeCloseTo(atmosphere(6000, 0).sigma, 6);
    expect(requiredPowerKw('takeoff', 1)).toBe(0);
  });
});

describe('headless stepper equivalence', () => {
  it('matches the live step function and settles to the same state', () => {
    const a = atmosphere(3000, 8);
    const inputs: EngineInputs = {
      atmos: a,
      airspeedMs: MISSION_AIRSPEED.cruise,
      rpmTarget: 2100,
      throttleBase: 0.72,
      afrCmd: 16.5,
      propC: 4.2e-3 * a.sigma,
      gustLoad: 1,
      gustThrottle: 0,
      gustRpm: 0,
    };
    const p = nominalParams();
    let live = settledEngineState({ phase: 'cruise', altitude: 3000, isaDev: 8, turbulence: 'none' });
    live = { ...live, fuelKg: MISSION_FUEL_KG };
    const headless = { ...live, cht: live.cht.slice(), egt: live.egt.slice() };
    const out = createDerived();
    // 60 s of flight time through each integrator: live at 0.05 s, mission at
    // its own coarse step. Same physics, same answer within integrator error.
    for (let i = 0; i < 1200; i++) live = stepEngine(live, p, inputs, SIM_DT).state;
    for (let i = 0; i < 240; i++) stepEngineInto(headless, out, p, inputs, 0.25);
    expect(Math.abs(headless.rpm - live.rpm)).toBeLessThan(12);
    for (let c = 0; c < 4; c++) expect(Math.abs(headless.cht[c] - live.cht[c])).toBeLessThan(3);
    expect(Math.abs(headless.oilTemp - live.oilTemp)).toBeLessThan(3);
  });
});

const SHORT_ROUTE: Waypoint[] = [
  { id: 1, name: 'A', lat: 26.9, lon: 70.9, altM: 1500, loiterMin: 2 },
  { id: 2, name: 'B', lat: 27.3, lon: 71.6, altM: 2500, loiterMin: 0 },
  { id: 3, name: 'A', lat: 26.9, lon: 70.9, altM: 1500, loiterMin: 0 },
];

describe('monte carlo', () => {
  it('is reproducible for a given seed', () => {
    const req = {
      waypoints: SHORT_ROUTE,
      weather: applyWeatherPreset('standard', SHORT_ROUTE.length),
      items: [],
      initState: null,
      runs: 200,
      seed: 4242,
      growthPerH: null,
    };
    const a = runMonteCarlo(req);
    const b = runMonteCarlo(req);
    expect(a.completedFrac).toBe(b.completedFrac);
    expect(a.verdict).toBe(b.verdict);
    expect(a.legs.map((l) => l.breachFrac)).toEqual(b.legs.map((l) => l.breachFrac));
    expect(a.landing.medChtMaxC).toBe(b.landing.medChtMaxC);
    expect(a.runs).toBe(200);
    const drawnA = drawRunSet(req, 200);
    const drawnB = drawRunSet(req, 200);
    expect(drawnA.map((r) => r.seed)).toEqual(drawnB.map((r) => r.seed));
    expect(drawnA[0].weather[0].isaDevC).toBe(drawnB[0].weather[0].isaDevC);
    const other = drawRunSet({ ...req, seed: 99 }, 200);
    expect(other[0].weather[0].isaDevC).not.toBe(drawnA[0].weather[0].isaDevC);
  });

  it('jitters weather around the preset without replacing it', () => {
    const req = {
      waypoints: SHORT_ROUTE,
      weather: applyWeatherPreset('hot-high', SHORT_ROUTE.length),
      items: [],
      initState: null,
      seed: 11,
      growthPerH: null,
    };
    const drawn = drawRunSet(req, 60);
    const base = req.weather[0].isaDevC;
    const spread = drawn.map((r) => r.weather[0].isaDevC);
    const mean = spread.reduce((s, v) => s + v, 0) / spread.length;
    expect(Math.abs(mean - base)).toBeLessThan(2);
    expect(Math.max(...spread) - Math.min(...spread)).toBeGreaterThan(2);
    expect(drawn.every((r) => r.weather.every((w) => w.windSpdMs >= 0))).toBe(true);
  });
});

describe('acceptance separation', () => {
  // A warm engine on the ground at field elevation with the mission fuel load.
  const groundState = (wps: Waypoint[], isaDevC: number) => {
    const st = settledEngineState({
      phase: 'cruise',
      altitude: wps[0].altM,
      isaDev: Math.round(isaDevC),
      turbulence: 'none',
    });
    st.fuelKg = MISSION_FUEL_KG;
    return st;
  };

  it('runs the same engine hot and standard on each preset route', () => {
    for (const id of ['ladakh', 'rajasthan', 'coastal']) {
      const wps = clonePreset(id);
      const mk = (wxId: string) => {
        const wx = applyWeatherPreset(wxId, wps.length);
        return runMission({
          waypoints: wps,
          items: [],
          weather: wx,
          initState: groundState(wps, wx[0].isaDevC),
          seed: 7,
          growthPerH: 0,
          checkLimits: true,
        });
      };
      const std = mk('standard');
      const hot = mk('hot-high');
      expect(std.completed).toBe(true);
      expect(hot.maxChtC).toBeGreaterThan(std.maxChtC);
      expect(hot.maxOilTC).toBeGreaterThan(std.maxOilTC);
    }
  });

  it('makes a cooling-degraded engine worse than healthy', () => {
    const wps = clonePreset('rajasthan');
    const wx = applyWeatherPreset('standard', wps.length);
    const base = groundState(wps, wx[0].isaDevC);
    const healthy = runMission({
      waypoints: wps,
      items: [],
      weather: wx,
      initState: base,
      seed: 7,
      growthPerH: 0,
      checkLimits: true,
    });
    const degraded = runMission({
      waypoints: wps,
      items: [{ kind: 'cooling', cylinder: 1, severity: 0.6 }],
      weather: wx,
      initState: base,
      seed: 7,
      growthPerH: 0,
      checkLimits: true,
    });
    expect(healthy.completed).toBe(true);
    expect(degraded.maxChtC).toBeGreaterThan(healthy.maxChtC);
    expect(degraded.completed).toBe(false);
    expect(degraded.breach?.channel).toBe('CHT');
  });

  it('keeps the healthy reference healthy when the live twin is hot', () => {
    const wps: Waypoint[] = [
      { id: 1, name: 'A', lat: 34.1526, lon: 77.5771, altM: 3500, loiterMin: 0 },
      { id: 2, name: 'B', lat: 34.1726, lon: 77.5771, altM: 3500, loiterMin: 0 },
    ];
    const wx = applyWeatherPreset('hot-high', wps.length);
    // The live sim while a cooling fault is being ramped on screen: heads and
    // sump already above the limits. The comparison engine must not start there.
    const hot = groundState(wps, wx[0].isaDevC);
    hot.cht = hot.cht.map(() => 260);
    hot.oilTemp = 118;
    const res = runMonteCarlo({
      waypoints: wps,
      weather: wx,
      items: [{ kind: 'cooling', cylinder: 1, severity: 0.6 }],
      initState: hot,
      seed: 11,
      growthPerH: 0,
    });
    expect(res.healthy.maxChtC).toBeLessThan(CHT_LIMIT_C);
    expect(res.healthy.completed).toBe(true);
    // Both bars cover the same mission from the same start, so the degraded
    // engine must be worse on every thermal channel, not just on CHT: a
    // truncated or differently-seeded comparison run makes a lagging channel
    // such as the 80 s sump look better than the healthy engine's.
    expect(res.current.timeS).toBeCloseTo(res.healthy.timeS, 3);
    expect(res.current.maxChtC).toBeGreaterThan(res.healthy.maxChtC);
    expect(res.current.maxOilTC).toBeGreaterThanOrEqual(res.healthy.maxOilTC);
  });

  it('burns less than the loaded fuel on a standard day', () => {
    const wps = clonePreset('coastal');
    const wx = applyWeatherPreset('standard', wps.length);
    const r = runMission({
      waypoints: wps,
      items: [],
      weather: wx,
      initState: groundState(wps, wx[0].isaDevC),
      seed: 3,
      growthPerH: 0,
      checkLimits: true,
    });
    expect(r.completed).toBe(true);
    expect(r.fuelUsedKg).toBeGreaterThan(20);
    expect(r.marginKg).toBeGreaterThan(0);
    expect(r.fuelUsedKg + r.marginKg).toBeCloseTo(MISSION_FUEL_KG - MISSION_RESERVE_KG, 6);
  });
});
