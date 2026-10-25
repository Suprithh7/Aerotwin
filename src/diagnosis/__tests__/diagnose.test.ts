import { describe, expect, it } from 'vitest';
import { Sim } from '../../sim/sim';
import { buildSignatureLibrary, signaturesForPhase } from '../signatures';
import { ANOMALY_MAG, CRIT_SEVERITY, Diagnoser, fitSignatures } from '../diagnose';
import type { Diagnosis } from '../diagnose';

const lib = buildSignatureLibrary();

interface Inject {
  kind: 'cooling' | 'turbo' | 'compression';
  cylinder?: number;
  severity: number;
  rampTime: number;
}

function run(
  scenario: { phase: 'cruise' | 'loiter'; altitude: number; isaDev: number },
  inject: Inject | null,
  nominalS: number,
  faultS: number,
): { d: Diagnosis; sim: Sim } {
  const sim = new Sim({ seed: 1337, scenario: { turbulence: 'none', ...scenario } });
  const diag = new Diagnoser(lib);
  const step = (s: number): Diagnosis | null => {
    let last: Diagnosis | null = null;
    for (let i = 0; i < Math.round(s / 0.05); i++) {
      sim.step();
      last = diag.update(sim.zEwmaVector(), sim.twinVector(), sim.snapshot(), true);
    }
    return last;
  };
  let d = step(nominalS);
  if (inject) {
    sim.injectFault({
      scope: 'engine',
      kind: inject.kind,
      cylinder: inject.cylinder,
      severity: inject.severity,
      rampTime: inject.rampTime,
    });
  }
  const end = step(faultS);
  return { d: (end ?? d) as Diagnosis, sim };
}

describe('diagnosis classification', () => {
  it('reads a healthy engine as NOMINAL', () => {
    const { d } = run({ phase: 'cruise', altitude: 3000, isaDev: 0 }, null, 90, 0);
    expect(d.state).toBe('NOMINAL');
    expect(d.anomaly).toBeLessThan(ANOMALY_MAG);
    expect(d.dominant).toBeNull();
  });

  it('names a cooling loss and scales the state with severity', () => {
    // 200 s of steady fault so the severity history window is settled.
    const severe = run({ phase: 'cruise', altitude: 3000, isaDev: 0 }, { kind: 'cooling', cylinder: 3, severity: 0.7, rampTime: 10 }, 60, 200);
    expect(severe.d.state).toBe('CRITICAL');
    expect(severe.d.dominant?.kind).toBe('cooling');
    expect(severe.d.dominant?.cylinder).toBe(3);
    expect(severe.d.severity).toBeGreaterThanOrEqual(CRIT_SEVERITY - 0.05);
    expect(Math.abs(severe.d.severity - 0.7)).toBeLessThan(0.15);

    const mild = run({ phase: 'cruise', altitude: 3000, isaDev: 0 }, { kind: 'cooling', cylinder: 3, severity: 0.35, rampTime: 10 }, 60, 200);
    expect(mild.d.state).toBe('WARNING');
    expect(mild.d.dominant?.kind).toBe('cooling');
    expect(Math.abs(mild.d.severity - 0.35)).toBeLessThan(0.15);
  });

  it('returns to NOMINAL when the fault is cleared', () => {
    const sim = new Sim({ seed: 1337, scenario: { phase: 'cruise', turbulence: 'none', isaDev: 0, altitude: 3000 } });
    const diag = new Diagnoser(lib);
    let d: Diagnosis | null = null;
    const step = (s: number): Diagnosis => {
      let last = d as Diagnosis;
      for (let i = 0; i < Math.round(s / 0.05); i++) {
        sim.step();
        last = diag.update(sim.zEwmaVector(), sim.twinVector(), sim.snapshot(), true);
      }
      d = last;
      return last;
    };
    step(60);
    const id = sim.injectFault({ scope: 'engine', kind: 'cooling', cylinder: 3, severity: 0.6, rampTime: 10 });
    expect(step(120).state).not.toBe('NOMINAL');
    sim.clearFault(id);
    const after = step(60);
    expect(after.state).toBe('NOMINAL');
    expect(after.dominant).toBeNull();
  });

  it('projects remaining useful life from a growing fault', () => {
    // Growth slow enough to stay below the CHT limit inside the projection window.
    const { d } = run(
      { phase: 'cruise', altitude: 3000, isaDev: 0 },
      { kind: 'cooling', cylinder: 3, severity: 0.3, rampTime: 300 },
      30,
      330,
    );
    expect(d.state).not.toBe('NOMINAL');
    expect(d.rul?.status).toBe('OK');
    expect(d.rul?.binding?.channel).toBe('cht3');
    expect(d.rul?.medianS).not.toBeNull();
    expect(d.rul!.medianS!).toBeGreaterThan(0);
    expect(d.rul!.p10S!).toBeGreaterThan(0);
    expect(d.rul!.p10S!).toBeLessThanOrEqual(d.rul!.medianS!);
  });

  it('falls back to the nearest library phase off-profile', () => {
    expect(signaturesForPhase(lib, 'climb').length).toBe(23);
    expect(signaturesForPhase(lib, 'cruise').length).toBe(23);
    expect(signaturesForPhase(lib, 'loiter').length).toBe(23);
  });

  it('is deterministic for the same seed', () => {
    const a = run({ phase: 'loiter', altitude: 4000, isaDev: 8 }, { kind: 'turbo', severity: 0.5, rampTime: 20 }, 40, 140);
    const b = run({ phase: 'loiter', altitude: 4000, isaDev: 8 }, { kind: 'turbo', severity: 0.5, rampTime: 20 }, 40, 140);
    expect(a.d.severity).toBeCloseTo(b.d.severity, 9);
    expect(a.d.state).toBe(b.d.state);
    expect(fitSignatures(zeros(), lib, 'cruise').anomaly).toBe(0);
  });
});

// Zero residual vector: the fit's guard returns no candidates and no anomaly.
function zeros(): number[] {
  return new Array<number>(18).fill(0);
}
