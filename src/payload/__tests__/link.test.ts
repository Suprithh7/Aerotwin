import { describe, expect, it } from 'vitest';
import {
  GROUND_ANTENNA_M,
  MAX_LINK_RANGE_KM,
  MAX_RATE_MBPS,
  MIN_RATE_MBPS,
  linkStatus,
  radioHorizonKm,
} from '../link';
import type { GroundStation } from '../../mission/types';

const GS: GroundStation = { lat: 34.08, lon: 77.35 };

function at(lat: number, lon: number, altM = 5200, jammed = false) {
  return linkStatus({ lat, lon, altM, gs: GS, jammed });
}

describe('radio horizon', () => {
  it('uses the smooth-earth approximation', () => {
    expect(radioHorizonKm(0, 0)).toBe(0);
    expect(radioHorizonKm(5000)).toBeCloseTo(4.12 * (Math.sqrt(5000) + Math.sqrt(GROUND_ANTENNA_M)), 6);
  });

  it('caps the effective range at the assumed maximum', () => {
    const st = at(GS.lat, GS.lon, 20_000);
    expect(st.horizonKm).toBeGreaterThan(MAX_LINK_RANGE_KM);
    expect(st.rangeKm).toBe(MAX_LINK_RANGE_KM);
  });
});

describe('link states', () => {
  it('is UP at full rate inside 20 percent of range', () => {
    const st = at(GS.lat, GS.lon);
    expect(st.state).toBe('UP');
    expect(st.rateMbps).toBe(MAX_RATE_MBPS);
    expect(st.distanceKm).toBeCloseTo(0, 6);
    expect(st.fraction).toBe(0);
  });

  it('falls linearly to the minimum rate at the range edge', () => {
    const st = at(GS.lat + 0.9, GS.lon); // ~100 km south, inside the 250 km range
    expect(st.state).toBe('DEGRADED');
    const t = (st.fraction - 0.2) / 0.8;
    expect(st.rateMbps).toBeCloseTo(MAX_RATE_MBPS - (MAX_RATE_MBPS - MIN_RATE_MBPS) * t, 6);
    expect(st.rateMbps).toBeLessThan(MAX_RATE_MBPS);
    expect(st.rateMbps).toBeGreaterThan(MIN_RATE_MBPS);
  });

  it('is LOST with zero rate beyond the range', () => {
    const st = at(GS.lat + 3, GS.lon); // ~333 km
    expect(st.state).toBe('LOST');
    expect(st.rateMbps).toBe(0);
    expect(st.fraction).toBeGreaterThan(1);
  });

  it('lets jamming win over a perfect geometry', () => {
    const st = at(GS.lat, GS.lon, 5200, true);
    expect(st.state).toBe('JAMMED');
    expect(st.rateMbps).toBe(0);
    expect(st.distanceKm).toBeCloseTo(0, 6);
  });
});
