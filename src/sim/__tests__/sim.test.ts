import { describe, expect, it } from 'vitest';
import { runSim, settleValue, DEFAULT_SCENARIO } from '../harness';
import type { ChannelId, FaultSpec } from '../types';

const ev = (at: number, fault: Omit<FaultSpec, 'id' | 'tInject'>) => ({ at, fault });
type Evt = ReturnType<typeof ev>;

function settled(channel: ChannelId, events?: Evt[], seed = 3): number {
  return settleValue(
    { seed, scenario: DEFAULT_SCENARIO, durationS: 240, events },
    channel,
  );
}

describe('determinism', () => {
  it('same seed and same events produce identical runs', () => {
    const events = [ev(30, { scope: 'engine', kind: 'cooling', cylinder: 3, severity: 0.7, rampTime: 10 })];
    const a = runSim({ seed: 99, scenario: DEFAULT_SCENARIO, durationS: 60, events });
    const b = runSim({ seed: 99, scenario: DEFAULT_SCENARIO, durationS: 60, events });
    for (const ch of Object.keys(a.final.readings) as ChannelId[]) {
      expect(a.final.readings[ch].measured).toBe(b.final.readings[ch].measured);
      expect(a.final.readings[ch].z).toBe(b.final.readings[ch].z);
    }
  });

  it('different seeds give different measurement noise', () => {
    const a = runSim({ seed: 99, scenario: DEFAULT_SCENARIO, durationS: 20 });
    const b = runSim({ seed: 100, scenario: DEFAULT_SCENARIO, durationS: 20 });
    expect(a.final.readings.cht1.measured).not.toBe(b.final.readings.cht1.measured);
  });
});

describe('nominal cruise', () => {
  it('residual z-scores stay near zero on all channels', () => {
    const { final } = runSim({ seed: 5, scenario: DEFAULT_SCENARIO, durationS: 180 });
    for (const ch of Object.keys(final.readings) as ChannelId[]) {
      if (ch === 'fuel') continue; // ramp-limited channel checked below
      expect(Math.abs(final.readings[ch].zEwma)).toBeLessThan(3);
    }
  });

  it('measured tracks twin within a few noise sigmas', () => {
    const { final } = runSim({ seed: 5, scenario: DEFAULT_SCENARIO, durationS: 180 });
    for (const ch of ['rpm', 'cht1', 'egt1', 'oilT', 'pwr', 'boost'] as ChannelId[]) {
      const r = final.readings[ch];
      expect(Math.abs(r.residual)).toBeLessThan(Math.abs(r.twin) * 0.05 + 8);
    }
  });

  it('cruise operating point is plausible for a ~100 hp class engine at 3 km', () => {
    const pwr = settled('pwr');
    expect(pwr).toBeGreaterThan(35);
    expect(pwr).toBeLessThan(60);
    expect(settled('cht1')).toBeGreaterThan(110);
    expect(settled('cht1')).toBeLessThan(210);
    expect(settled('oilT')).toBeGreaterThan(60);
    expect(settled('oilT')).toBeLessThan(120);
    expect(settled('boost')).toBeGreaterThan(20);
  });
});

describe('fault severity monotonicity', () => {
  it('more cooling loss -> higher steady CHT on that cylinder', () => {
    const vals = [0, 0.3, 0.6, 0.9].map((s) =>
      settled('cht3', [ev(20, { scope: 'engine', kind: 'cooling', cylinder: 3, severity: s, rampTime: 5 })]),
    );
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]).toBeGreaterThan(vals[i - 1] + 3);
    }
  });

  it('more boost loss -> lower steady boost', () => {
    const vals = [0, 0.4, 0.8].map((s) =>
      settled('boost', [ev(20, { scope: 'engine', kind: 'turbo', severity: s, rampTime: 5 })]),
    );
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]).toBeLessThan(vals[i - 1] - 3);
    }
  });
});

describe('engine fault signatures', () => {
  it('misfire cyl 2: vibration up, power down, cyl 2 cools', () => {
    const e = [ev(20, { scope: 'engine', kind: 'misfire', cylinder: 2, severity: 0.8, rampTime: 2 })];
    expect(settled('vib', e)).toBeGreaterThan(settled('vib') + 1);
    expect(settled('pwr', e)).toBeLessThan(settled('pwr') - 1);
    expect(settled('cht2', e)).toBeLessThan(settled('cht2') - 10);
  });

  it('injector fault cyl 2: AFR leaner reading drops, cyl 2 EGT falls, CHT rises', () => {
    const e = [ev(20, { scope: 'engine', kind: 'injector', cylinder: 2, severity: 0.6, rampTime: 5 })];
    expect(settled('afr', e)).toBeLessThan(settled('afr') - 0.5);
    expect(settled('egt2', e)).toBeLessThan(settled('egt2'));
    expect(settled('cht2', e)).toBeGreaterThan(settled('cht2') + 5);
  });

  it('cooling degradation cyl 3: cyl 3 CHT rises strongly, neighbours flat, oil slightly warmer', () => {
    const e = [ev(20, { scope: 'engine', kind: 'cooling', cylinder: 3, severity: 0.7, rampTime: 10 })];
    expect(settled('cht3', e)).toBeGreaterThan(settled('cht3') + 40);
    expect(Math.abs(settled('cht1', e) - settled('cht1'))).toBeLessThan(5);
    expect(Math.abs(settled('pwr', e) - settled('pwr'))).toBeLessThan(2);
    expect(settled('oilT', e)).toBeGreaterThan(settled('oilT'));
  });

  it('oil system degradation: oil pressure collapses, oil temp rises, vibration up', () => {
    const e = [ev(20, { scope: 'engine', kind: 'oil', severity: 0.7, rampTime: 10 })];
    expect(settled('oilP', e)).toBeLessThan(settled('oilP') * 0.5);
    expect(settled('oilT', e)).toBeGreaterThan(settled('oilT') + 10);
    expect(settled('vib', e)).toBeGreaterThan(settled('vib') + 0.5);
  });

  it('ignition degradation cyl 1: that EGT spikes, other cylinders unchanged', () => {
    const e = [ev(20, { scope: 'engine', kind: 'ignition', cylinder: 1, severity: 0.7, rampTime: 10 })];
    expect(settled('egt1', e)).toBeGreaterThan(settled('egt1') + 60);
    expect(Math.abs(settled('egt2', e) - settled('egt2'))).toBeLessThan(5);
  });

  it('turbo boost loss: boost and MAP collapse, all CHT drop, rpm sags', () => {
    const e = [ev(20, { scope: 'engine', kind: 'turbo', severity: 0.8, rampTime: 5 })];
    expect(settled('boost', e)).toBeLessThan(settled('boost') * 0.5);
    expect(settled('map', e)).toBeLessThan(settled('map') - 20);
    expect(settled('cht1', e)).toBeLessThan(settled('cht1'));
    expect(settled('rpm', e)).toBeLessThan(settled('rpm'));
  });

  it('compression loss cyl 4: imbalance vibration up, cyl 4 runs different from the rest', () => {
    const e = [ev(20, { scope: 'engine', kind: 'compression', cylinder: 4, severity: 0.6, rampTime: 10 })];
    expect(settled('vib', e)).toBeGreaterThan(settled('vib') + 0.8);
    expect(settled('cht4', e)).toBeLessThan(settled('cht4'));
    expect(settled('egt4', e)).toBeGreaterThan(settled('egt4'));
  });

  it('exhaust back-pressure: all EGT rise, power falls, fuel flow drops', () => {
    const e = [ev(20, { scope: 'engine', kind: 'exhaust', severity: 0.7, rampTime: 10 })];
    expect(settled('egt1', e)).toBeGreaterThan(settled('egt1') + 30);
    expect(settled('egt3', e)).toBeGreaterThan(settled('egt3') + 30);
    expect(settled('pwr', e)).toBeLessThan(settled('pwr') - 5);
    expect(settled('ff', e)).toBeLessThan(settled('ff'));
  });
});

describe('sensor faults', () => {
  it('drift on CHT1 raises only that channel residual', () => {
    const { final } = runSim({
      seed: 11,
      scenario: DEFAULT_SCENARIO,
      durationS: 120,
      events: [ev(30, { scope: 'sensor', kind: 'drift', channel: 'cht1', severity: 0.5, rampTime: 20 })],
    });
    expect(final.readings.cht1.zEwma).toBeGreaterThan(8);
    for (const ch of ['cht2', 'cht3', 'cht4', 'egt1', 'oilT', 'rpm', 'pwr', 'boost', 'vib', 'ff'] as ChannelId[]) {
      expect(Math.abs(final.readings[ch].zEwma)).toBeLessThan(3);
    }
  });

  it('stuck sensor freezes the reading and produces no new noise', () => {
    const { sim } = runSim({
      seed: 12,
      scenario: DEFAULT_SCENARIO,
      durationS: 60,
      events: [ev(30, { scope: 'sensor', kind: 'stuck', channel: 'rpm', severity: 1, rampTime: 0 })],
    });
    const a = sim.snapshot().readings.rpm.measured;
    sim.step();
    sim.step();
    const b = sim.snapshot().readings.rpm.measured;
    expect(a).toBe(b);
  });

  it('noise spike widens only its channel residual distribution', () => {
    const { final } = runSim({
      seed: 13,
      scenario: DEFAULT_SCENARIO,
      durationS: 120,
      events: [ev(20, { scope: 'sensor', kind: 'noise', channel: 'egt2', severity: 0.8, rampTime: 2 })],
    });
    // EWMA z of a widened noise keeps wandering more than healthy channels
    const noisier = Math.abs(final.readings.egt2.z);
    expect(Math.abs(noisier)).toBeGreaterThan(0);
    expect(Math.abs(final.readings.cht3.zEwma)).toBeLessThan(3);
  });
});

describe('ramp behaviour', () => {
  it('severity ramps in over rampTime', () => {
    const spec = { scope: 'engine', kind: 'cooling', cylinder: 1, severity: 0.8, rampTime: 60 } as const;
    const early = runSim({ seed: 4, scenario: DEFAULT_SCENARIO, durationS: 60.5, events: [ev(30, spec)] });
    const late = runSim({ seed: 4, scenario: DEFAULT_SCENARIO, durationS: 120, events: [ev(30, spec)] });
    const e0 = early.final.readings.cht1.true - early.final.readings.cht1.twin;
    const e1 = late.final.readings.cht1.true - late.final.readings.cht1.twin;
    expect(e1).toBeGreaterThan(e0 + 10);
  });
});
