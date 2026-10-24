import { describe, expect, it } from 'vitest';
import { atmosphere, isaAtmosphere, ISA } from '../atmosphere';

// Reference values from the standard ISA table (tolerance for rounding).
const ISA_TABLE = [
  { alt: 0, tC: 15, pPa: 101325, rho: 1.225 },
  { alt: 1000, tC: 8.5, pPa: 89876, rho: 1.1117 },
  { alt: 2000, tC: 2.0, pPa: 79462, rho: 1.0066 },
  { alt: 3000, tC: -4.5, pPa: 70121, rho: 0.90925 },
  { alt: 5000, tC: -17.5, pPa: 54016, rho: 0.73643 },
  { alt: 8000, tC: -37.0, pPa: 35645, rho: 0.52521 },
];

describe('ISA atmosphere', () => {
  it('matches the ISA table at standard deviations', () => {
    for (const row of ISA_TABLE) {
      const a = isaAtmosphere(row.alt);
      expect(a.tempC).toBeCloseTo(row.tC, 1);
      expect(a.pressPa / row.pPa).toBeGreaterThan(0.998);
      expect(a.pressPa / row.pPa).toBeLessThan(1.002);
      expect(a.densKgM3 / row.rho).toBeGreaterThan(0.995);
      expect(a.densKgM3 / row.rho).toBeLessThan(1.005);
    }
  });

  it('sea-level constants are consistent', () => {
    const a = isaAtmosphere(0);
    expect(a.pressPa).toBeCloseTo(ISA.P0, 0);
    expect(a.tempK).toBeCloseTo(ISA.T0, 3);
    expect(a.sigma).toBeCloseTo(1, 4); // RHO0 is the rounded 1.225
    expect(a.densityAltM).toBeCloseTo(0, 1);
  });

  it('ISA+ deviation raises density altitude and lowers density', () => {
    const base = atmosphere(3000, 0);
    const hot = atmosphere(3000, 15);
    expect(hot.tempC).toBeCloseTo(base.tempC + 15, 6);
    expect(hot.densKgM3).toBeLessThan(base.densKgM3);
    expect(hot.densityAltM).toBeGreaterThan(base.densityAltM);
    expect(hot.densityAltM).toBeGreaterThan(3000);
  });

  it('density decreases monotonically with altitude', () => {
    let prev = Infinity;
    for (let h = 0; h <= 9000; h += 500) {
      const a = isaAtmosphere(h);
      expect(a.densKgM3).toBeLessThan(prev);
      prev = a.densKgM3;
    }
  });
});
