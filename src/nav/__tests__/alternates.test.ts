import { describe, expect, test } from 'vitest';
import {
  ALTERNATE_RESERVE_S,
  GLIDE_RATIO,
  REACHABLE_MARGIN_FRAC,
  airfieldsInGlideRange,
  evaluateAlternate,
  glideRangeM,
  gsOnBearing,
  levelPowerRequiredKw,
  midPointLeg,
  nearestReachable,
  poweredRangeM,
  type NavState,
} from '../alternates';
import { airfieldByIcao, type Airfield } from '../../data/airfields';
import { EARTH_RADIUS_M, bearingDeg, distanceM, windComponents } from '../../mission/route';
import { PWR_MARGIN_FRAC } from '../../mission/constants';

// A point in the Indus valley east of Leh, used so leg distances are exact.
const LEH = { lat: 34.135899, lon: 77.546501 };

/** Metres of meridian arc per degree of latitude, for the planner's R = 6371 km. */
const M_PER_DEG = (Math.PI / 180) * EARTH_RADIUS_M;

/**
 * A made-up field due north of `origin` at exactly `distM` of great-circle arc,
 * so a test can place a boundary and know the distance it implies.
 */
function fieldDueNorth(origin: { lat: number; lon: number }, distM: number, elevationM = 0): Airfield {
  return {
    icao: 'TEST',
    name: 'Test Field',
    city: 'Testville',
    state: 'Test',
    lat: origin.lat + distM / M_PER_DEG,
    lon: origin.lon,
    elevationM,
    type: 'small_airport',
  };
}

const fieldAt = (distM: number, elevationM = 0): Airfield => fieldDueNorth(LEH, distM, elevationM);

function stateAt(over: Partial<NavState> = {}): NavState {
  return {
    lat: LEH.lat,
    lon: LEH.lon,
    altM: 5400,
    sigmaRatio: 0.575,
    tasMs: 41,
    shaftPowerKw: 34,
    phase: 'cruise',
    fuelKg: 42,
    ffKgH: 12.3,
    windDirDeg: 0,
    windSpdMs: 0,
    rulP10S: null,
    ...over,
  };
}

describe('route geometry', () => {
  test('Leh to Srinagar is 256 km within two percent', () => {
    const visr = airfieldByIcao('VISR');
    expect(visr).toBeDefined();
    const km = distanceM(LEH.lat, LEH.lon, visr!.lat, visr!.lon) / 1000;
    expect(km).toBeGreaterThan(256 * 0.98);
    expect(km).toBeLessThan(256 * 1.02);
  });

  test('bearing is true north at zero and east at ninety', () => {
    expect(bearingDeg(0, 0, 10, 0)).toBeCloseTo(0, 6);
    expect(bearingDeg(0, 0, 0, 10)).toBeCloseTo(90, 6);
    expect(bearingDeg(0, 0, -10, 0)).toBeCloseTo(180, 6);
    expect(bearingDeg(0, 0, 0, -10)).toBeCloseTo(270, 6);
  });

  test('Leh to Srinagar points west by north', () => {
    const visr = airfieldByIcao('VISR')!;
    const brg = bearingDeg(LEH.lat, LEH.lon, visr.lat, visr.lon);
    expect(brg).toBeGreaterThan(260);
    expect(brg).toBeLessThan(300);
  });

  test('a wind along the track is a headwind, against it a tailwind', () => {
    expect(windComponents(90, 90, 10).headwindMs).toBeCloseTo(10, 6);
    expect(windComponents(270, 90, 10).headwindMs).toBeCloseTo(-10, 6);
    expect(windComponents(0, 90, 10).headwindMs).toBeCloseTo(0, 6);
    expect(windComponents(0, 90, 10).crosswindMs).toBeCloseTo(-10, 6);
  });

  test('groundspeed holds a floor in a wind stronger than the airspeed', () => {
    expect(gsOnBearing(41, 90, 90, 10)).toBeCloseTo(31, 6);
    expect(gsOnBearing(5, 90, 90, 30)).toBe(10);
  });

  test('leg midpoint is the average of its endpoints', () => {
    expect(midPointLeg({ lat: 10, lon: 20 }, { lat: 12, lon: 24 })).toEqual({ lat: 11, lon: 22 });
  });

  test('a synthetic field sits exactly the distance it claims', () => {
    expect(distanceM(LEH.lat, LEH.lon, fieldAt(100_000).lat, fieldAt(100_000).lon)).toBeCloseTo(100_000, 6);
  });
});

describe('range models', () => {
  test('powered range holds out the reserve', () => {
    expect(ALTERNATE_RESERVE_S).toBe(1800);
    // 3600 kg/h makes endurance numerically equal to the fuel mass in seconds:
    // 2900 kg is 2900 s, less the 1800 s hold-out, at 100 m/s.
    expect(poweredRangeM(2900, 3600, 100)).toBeCloseTo(110_000, 6);
    expect(poweredRangeM(1800, 3600, 100)).toBe(0);
    expect(poweredRangeM(50, 0, 100)).toBe(0);
  });

  test('glide range is altitude above the field times the assumed ratio', () => {
    expect(glideRangeM(5400, 3255)).toBe((5400 - 3255) * GLIDE_RATIO);
    expect(glideRangeM(3000, 3255)).toBe(0);
  });

  test('level power required follows the mission power law of the density ratio', () => {
    const sl = levelPowerRequiredKw('cruise', 1);
    expect(levelPowerRequiredKw('cruise', 0.5)).toBeCloseTo(sl * 0.5, 6);
    expect(levelPowerRequiredKw('takeoff', 1)).toBe(0);
  });
});

describe('alternate verdicts', () => {
  test('a powered aircraft with fuel to spare reads POWERED and REACHABLE', () => {
    const visr = airfieldByIcao('VISR')!;
    const row = evaluateAlternate(stateAt(), visr);
    expect(row.mode).toBe('POWERED');
    expect(row.verdict).toBe('REACHABLE');
    expect(row.marginFrac).toBeGreaterThanOrEqual(REACHABLE_MARGIN_FRAC);
    expect(row.eteS).toBeCloseTo(row.distM / 41, 0);
  });

  test('standing over a field is always reachable', () => {
    const leh = airfieldByIcao('VILH')!;
    const row = evaluateAlternate({ ...stateAt(), lat: leh.lat, lon: leh.lon }, leh);
    expect(row.verdict).toBe('REACHABLE');
    expect(row.distM).toBe(0);
  });

  test('running the tanks down takes the hold-out reserve first', () => {
    const visr = airfieldByIcao('VISR')!;
    // Endurance 2400 s: the 1800 s reserve leaves 600 s at 41 m/s = 24.6 km.
    const row = evaluateAlternate(stateAt({ fuelKg: 24.6, ffKgH: 36.9 }), visr);
    expect(row.mode).toBe('POWERED');
    expect(row.verdict).toBe('NOT REACHABLE');
    expect(row.limiting).toBe('FUEL');
  });

  test('a headwind stretches ETE by cutting groundspeed', () => {
    const visr = airfieldByIcao('VISR')!;
    const calm = evaluateAlternate(stateAt(), visr);
    // Wind from the west is a headwind on the westbound track to Srinagar.
    const blow = evaluateAlternate(stateAt({ windDirDeg: 275, windSpdMs: 20 }), visr);
    expect(blow.gsMs).toBeLessThan(calm.gsMs);
    expect(blow.eteS).toBeGreaterThan(calm.eteS);
  });

  test('the margin band flips at twenty percent and at zero', () => {
    // Powered range is (2900 - 1800) s at 100 m/s = 110 km exactly.
    const ns = stateAt({ tasMs: 100, ffKgH: 3600, fuelKg: 2900 });
    const near = evaluateAlternate(ns, fieldAt(90_000));
    expect(near.marginFrac).toBeCloseTo(20 / 90, 6);
    expect(near.verdict).toBe('REACHABLE');
    expect(evaluateAlternate(ns, fieldAt(100_000)).verdict).toBe('MARGINAL');
    // Made on the nose the margin is positive but tiny: inside the band, not outside it.
    const nose = evaluateAlternate(ns, fieldAt(109_990));
    expect(nose.marginFrac).toBeGreaterThanOrEqual(0);
    expect(nose.marginFrac).toBeLessThan(0.01);
    expect(nose.verdict).toBe('MARGINAL');
    expect(evaluateAlternate(ns, fieldAt(110_010)).verdict).toBe('NOT REACHABLE');
  });

  test('loss of available power moves the plan to a glide', () => {
    const required = levelPowerRequiredKw('cruise', 0.575);
    expect(PWR_MARGIN_FRAC * required).toBeGreaterThan(18);
    // A 3400 m field leaves only 2000 m of glide: 24 km against a 30 km track.
    const row = evaluateAlternate(stateAt({ shaftPowerKw: 18 }), fieldAt(30_000, 3400));
    expect(row.mode).toBe('GLIDE');
    expect(row.glideRangeM).toBe(2000 * GLIDE_RATIO);
    expect(row.verdict).toBe('NOT REACHABLE');
    expect(row.limiting).toBe('GLIDE');
    // Fuel alone would have reached it: the mode is what changed.
    expect(row.poweredRangeM).toBeGreaterThan(30_000);
  });

  test('glide mode ignores the fuel state', () => {
    const row = evaluateAlternate(stateAt({ shaftPowerKw: 18, fuelKg: 1 }), fieldAt(12_000, 2400));
    expect(row.mode).toBe('GLIDE');
    expect(row.rangeM).toBe(row.glideRangeM);
    expect(row.verdict).toBe('REACHABLE');
  });

  test('a short engine-life horizon limits the plan even when range allows', () => {
    const visr = airfieldByIcao('VISR')!;
    const row = evaluateAlternate(stateAt({ rulP10S: 600 }), visr);
    expect(row.limiting).toBe('ENGINE LIFE');
    expect(row.verdict).toBe('NOT REACHABLE');
    expect(row.rulMarginS).toBeLessThan(0);
    // The same flight with no life limit is comfortably reachable.
    expect(evaluateAlternate(stateAt(), visr).verdict).toBe('REACHABLE');
  });

  test('an engine-life margin over the fuel margin still binds the verdict', () => {
    // Fuel would carry 210 km against a 100 km track; the life horizon is tight.
    const ns = stateAt({ tasMs: 100, ffKgH: 3600, fuelKg: 3900, rulP10S: 1150 });
    const row = evaluateAlternate(ns, fieldAt(100_000));
    // ETE is 1000 s, so the horizon margin is the 150 s left on it.
    expect(row.eteS).toBeCloseTo(1000, 6);
    expect(row.marginFrac).toBeCloseTo(0.15, 6);
    expect(row.limiting).toBe('ENGINE LIFE');
    expect(row.verdict).toBe('MARGINAL');
  });

  test('nearest is by distance, nearest reachable skips what cannot be made', () => {
    const visr = evaluateAlternate(stateAt(), airfieldByIcao('VISR')!);
    const viju = evaluateAlternate(stateAt(), airfieldByIcao('VIJU')!);
    const rows = [visr, viju].sort((p, q) => p.distM - q.distM);
    // Srinagar lies closer to Leh than Jammu does.
    expect(rows[0].airfield.icao).toBe('VISR');
    expect(rows[1].airfield.icao).toBe('VIJU');
    const blocked = [{ ...rows[0], verdict: 'NOT REACHABLE' as const }, rows[1]];
    expect(nearestReachable(blocked)?.airfield.icao).toBe('VIJU');
    expect(nearestReachable([blocked[0]])).toBeNull();
  });
});

describe('engine-out alternates along a leg', () => {
  test('a mid-leg glide reaches the airfield it is sitting over', () => {
    const over = airfieldsInGlideRange(LEH.lat, LEH.lon, 5400, [airfieldByIcao('VILH')!]);
    expect(over.map((a) => a.icao)).toEqual(['VILH']);
  });

  test('the same glide reaches nothing at Srinagar distance', () => {
    expect(airfieldsInGlideRange(LEH.lat, LEH.lon, 5400, [airfieldByIcao('VISR')!])).toEqual([]);
  });

  test('height buys glide distance across the coastal gap', () => {
    const at = { lat: 17.5, lon: 73.4 };
    // The same 24 km track: below it at 1000 m, inside it at 3000 m.
    const field = fieldDueNorth(at, 24_000);
    expect(airfieldsInGlideRange(at.lat, at.lon, 1000, [field])).toEqual([]);
    expect(airfieldsInGlideRange(at.lat, at.lon, 3000, [field]).map((a) => a.icao)).toEqual(['TEST']);
  });

  test('a high field shortens the glide to it', () => {
    const at = { lat: 17.5, lon: 73.4 };
    const low = fieldDueNorth(at, 24_000, 0);
    const high = fieldDueNorth(at, 24_000, 2000);
    expect(airfieldsInGlideRange(at.lat, at.lon, 3000, [low]).length).toBe(1);
    expect(airfieldsInGlideRange(at.lat, at.lon, 3000, [high]).length).toBe(0);
  });
});
