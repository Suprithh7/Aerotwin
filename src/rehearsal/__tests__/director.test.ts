import { beforeEach, describe, expect, it } from 'vitest';
import {
  activeInjectionContext,
  detectionDue,
  dueScheduled,
  fmtScheduleS,
  parseScheduleS,
  payloadLabel,
  scenarioSchedule,
  surprisePick,
  useDirectorStore,
  type DirectorPayload,
  type InjectionRecord,
} from '../director';
import { scriptById } from '../scripts';
import { glideRangeM, glideRing, glideRingVisible, glideTimeS } from '../glide';
import { hudRank, hudStatus, voiceCallout, type HudFlags } from '../presentation';
import type { ChannelId, ChannelReading, Snapshot } from '../../sim/types';
import type { Diagnosis } from '../../diagnosis/diagnose';

function resetDirector() {
  useDirectorStore.setState({
    open: false,
    soundOn: true,
    seed: 20261026,
    windowMin: 5,
    windowMax: 20,
    schedule: [],
    injections: [],
    detections: [],
    linkMode: 'normal',
  });
}

beforeEach(resetDirector);

function injection(overrides: Partial<InjectionRecord> = {}): InjectionRecord {
  return {
    id: 1,
    scheduleId: null,
    missionS: 0,
    simS: 0,
    atMs: 0,
    label: 'Fault',
    scope: 'engine',
    source: 'manual',
    surprise: false,
    ...overrides,
  };
}

function reading(measured: number, twin: number, trueValue = measured): ChannelReading {
  return { true: trueValue, measured, twin, residual: 0, z: 0, zEwma: 0 };
}

function snapshot(
  measuredCht: [number, number, number, number],
  trueCht: [number, number, number, number] = measuredCht,
): Snapshot {
  const readings = {
    cht1: reading(measuredCht[0], trueCht[0]),
    cht2: reading(measuredCht[1], trueCht[1]),
    cht3: reading(measuredCht[2], trueCht[2]),
    cht4: reading(measuredCht[3], trueCht[3]),
    oilT: reading(95, 95),
    oilP: reading(3.5, 3.5),
    rpm: reading(5500, 5500),
  };
  return { t: 0, phase: 'cruise', readings } as unknown as Snapshot;
}

function diagnosis(state: 'WARNING' | 'CRITICAL', kind = 'cooling', cylinder = 3): Pick<
  Diagnosis,
  'state' | 'dominant'
> {
  return {
    state,
    dominant: {
      key: `${kind}|${cylinder}`,
      label: `Cooling degradation (cyl ${cylinder})`,
      kind,
      cylinder,
      severity: 0.6,
      confidence: 0.9,
    },
  };
}

describe('director labels and schedule parsing', () => {
  it('names every injection in plain language', () => {
    expect(
      payloadLabel({ type: 'engine', kind: 'cooling', severity: 0.6, rampTime: 30, cylinder: 3 }),
    ).toBe('Cooling degradation, cylinder 3');
    expect(
      payloadLabel({ type: 'sensor', kind: 'drift', severity: 0.5, rampTime: 10, channel: 'cht1' }),
    ).toBe('CHT Cyl 1 sensor drift');
    expect(payloadLabel({ type: 'link', action: 'degrade' })).toBe(
      'Datalink rate reduced to 0.25x',
    );
    expect(payloadLabel({ type: 'weather', turbulence: 'moderate' })).toBe(
      'Turbulence moderate',
    );
    expect(payloadLabel({ type: 'weather', isaDevC: 8 })).toBe('ISA deviation +8 C');
  });

  it('parses and formats T+mm:ss without accepting junk', () => {
    expect(fmtScheduleS(0)).toBe('00:00');
    expect(fmtScheduleS(65)).toBe('01:05');
    expect(parseScheduleS('01:05')).toBe(65);
    expect(parseScheduleS('2.5')).toBe(150);
    expect(parseScheduleS('')).toBeNull();
    expect(parseScheduleS('abc')).toBeNull();
    expect(parseScheduleS('-1')).toBeNull();
    expect(parseScheduleS('1:2:3')).toBeNull();
    for (const s of [0, 59, 60, 3599]) {
      expect(parseScheduleS(fmtScheduleS(s))).toBe(s);
    }
  });
});

describe('scenario schedule', () => {
  it('maps a script fault to a scheduled item at its trigger', () => {
    const denied = scenarioSchedule(scriptById('cooling-denied'), 2400);
    expect(denied).toHaveLength(1);
    expect(denied[0].atS).toBe(0);
    expect(denied[0].source).toBe('scenario');
    expect(denied[0].hidden).toBe(false);
    expect(denied[0].payload).toEqual({
      type: 'engine',
      kind: 'cooling',
      severity: 0.6,
      rampTime: 30,
      cylinder: 3,
    });

    const friendly = scenarioSchedule(scriptById('cooling-friendly'), 2400);
    expect(friendly[0].atS).toBeCloseTo(1368, 6);
    expect(scenarioSchedule(scriptById('normal'), 2400)).toEqual([]);
  });

  it('seeds the store per rehearsal, including the jammed card', () => {
    const director = useDirectorStore.getState();
    director.resetForRehearsal(scriptById('cooling-jammed'), 2400);
    const jammed = useDirectorStore.getState();
    expect(jammed.linkMode).toBe('jammed');
    expect(jammed.schedule).toHaveLength(1);
    expect(jammed.schedule[0].payload.type).toBe('engine');

    director.resetForRehearsal(scriptById('sensor'), 2400);
    const sensor = useDirectorStore.getState();
    expect(sensor.linkMode).toBe('normal');
    expect(sensor.schedule[0].payload).toMatchObject({
      type: 'sensor',
      channel: 'cht1',
    });
  });
});

describe('mission-clock scheduler', () => {
  it('returns due items only, ordered by due time then insertion', () => {
    const director = useDirectorStore.getState();
    const engine: DirectorPayload = {
      type: 'engine',
      kind: 'cooling',
      severity: 0.6,
      rampTime: 30,
      cylinder: 3,
    };
    const sensor: DirectorPayload = {
      type: 'sensor',
      kind: 'stuck',
      severity: 0.5,
      rampTime: 10,
      channel: 'oilP',
    };
    const weather: DirectorPayload = { type: 'weather', turbulence: 'severe' };
    director.addSchedule(engine, 120);
    director.addSchedule(sensor, 60);
    director.addSchedule(weather, 60);

    const schedule = useDirectorStore.getState().schedule;
    expect(schedule.map((item) => item.atS)).toEqual([60, 60, 120]);
    expect(dueScheduled(schedule, 59.999)).toEqual([]);
    expect(dueScheduled(schedule, 60).map((item) => item.atS)).toEqual([60, 60]);
    expect(dueScheduled(schedule, 200).map((item) => item.atS)).toEqual([60, 60, 120]);
  });

  it('edits, removes and clears schedule entries', () => {
    const director = useDirectorStore.getState();
    const payload: DirectorPayload = { type: 'link', action: 'jam' };
    const a = director.addSchedule(payload, 90);
    const b = director.addSchedule(payload, 30);
    director.updateScheduleTime(a, 10);
    expect(useDirectorStore.getState().schedule.map((s) => s.id)).toEqual([a, b]);
    director.removeSchedule(a);
    expect(useDirectorStore.getState().schedule.map((s) => s.id)).toEqual([b]);
    director.clearSchedule();
    expect(useDirectorStore.getState().schedule).toEqual([]);
  });
});

describe('seeded surprise', () => {
  it('reproduces the same fault and time for the same seed and window', () => {
    const a = surprisePick(42, 300, 1200);
    const b = surprisePick(42, 300, 1200);
    expect(a).toEqual(b);
    expect(a.atS).toBeGreaterThanOrEqual(300);
    expect(a.atS).toBeLessThanOrEqual(1200);
    expect(a.payload.type === 'engine' || a.payload.type === 'sensor').toBe(true);
    expect(surprisePick(43, 300, 1200)).not.toEqual(a);
  });

  it('keeps the surprise hidden until it fires and respects the cap', () => {
    const director = useDirectorStore.getState();
    director.setSeed(7);
    director.setWindow(5, 20);
    expect(director.surprise(2400)).toBe(true);
    const first = useDirectorStore.getState().schedule[0];
    expect(first.source).toBe('surprise');
    expect(first.hidden).toBe(true);
    expect(first.atS).toBeGreaterThanOrEqual(300);
    expect(first.atS).toBeLessThanOrEqual(1200);

    director.resetForRehearsal(scriptById('normal'), 2400);
    director.setSeed(7);
    director.setWindow(5, 20);
    expect(director.surprise(2400)).toBe(true);
    const second = useDirectorStore.getState().schedule[0];
    expect(second.payload).toEqual(first.payload);
    expect(second.atS).toBe(first.atS);
  });

  it('caps a late window to the mission duration', () => {
    const director = useDirectorStore.getState();
    director.setSeed(11);
    director.setWindow(5, 20);
    expect(director.surprise(600)).toBe(true);
    const item = useDirectorStore.getState().schedule[0];
    expect(item.atS).toBeLessThanOrEqual(600 * 0.98);
    expect(item.atS).toBeGreaterThanOrEqual(0);
  });
});

describe('active injection context', () => {
  it('drives sensor-only presentation from instrument records', () => {
    const only = activeInjectionContext([
      injection({ id: 1, scope: 'sensor', sensorKind: 'drift', channel: 'cht1' }),
    ]);
    expect(only.injected).toBe(true);
    expect(only.engineActive).toBe(false);
    expect(only.sensorActive).toBe(true);
    expect(only.sensorOnly).toBe(true);
    expect(only.sensorChannel).toBe('cht1');
    expect(only.affectedGauges).toEqual(['cht']);
    expect(only.affectedCylinders).toEqual([1]);
  });

  it('marks the engine fault once and unions gauges and cylinders', () => {
    const both = activeInjectionContext([
      injection({ id: 1, scope: 'engine', engineKind: 'cooling', cylinder: 3 }),
      injection({ id: 2, scope: 'sensor', sensorKind: 'stuck', channel: 'cht3' }),
    ]);
    expect(both.sensorOnly).toBe(false);
    expect(both.affectedGauges).toEqual(['cht']);
    expect(both.affectedCylinders).toEqual([3]);
  });

  it('maps an oil-pressure instrument fault to the oil-pressure gauge', () => {
    const context = activeInjectionContext([
      injection({ id: 1, scope: 'sensor', sensorKind: 'noise', channel: 'oilP' }),
    ]);
    expect(context.affectedGauges).toEqual(['oilP']);
    expect(context.affectedCylinders).toEqual([]);
  });

  it('uses the latest injected engine fault', () => {
    const context = activeInjectionContext([
      injection({ id: 1, scope: 'engine', engineKind: 'oil' }),
      injection({ id: 2, scope: 'engine', engineKind: 'turbo' }),
    ]);
    expect(context.affectedGauges).toEqual(['rpm']);
  });
});

describe('detection latency', () => {
  it('waits for the twin diagnosis for an engine fault', () => {
    const record = injection({ scope: 'engine' });
    expect(detectionDue(record, 'NOMINAL', null)).toBe(false);
    expect(detectionDue(record, 'WARNING', null)).toBe(true);
    expect(detectionDue(record, 'CRITICAL', null)).toBe(true);
  });

  it('uses channel separation for an instrument fault at nominal', () => {
    const cht = injection({ scope: 'sensor', channel: 'cht1' });
    const separated = { cht1: { measured: 122, twin: 103 } };
    const close = { cht1: { measured: 107, twin: 103 } };
    const readings = (value: typeof separated) =>
      value as unknown as Record<ChannelId, { measured: number; twin: number }>;
    expect(detectionDue(cht, 'NOMINAL', readings(separated))).toBe(true);
    expect(detectionDue(cht, 'NOMINAL', readings(close))).toBe(false);
    expect(detectionDue(cht, 'NOMINAL', null)).toBe(false);
    expect(detectionDue(injection({ scope: 'sensor' }), 'NOMINAL', readings(separated))).toBe(
      false,
    );
  });

  it('scales the separation threshold per channel', () => {
    const oilP = injection({ scope: 'sensor', channel: 'oilP' });
    const readings = { oilP: { measured: 3.0, twin: 2.6 } } as unknown as Record<
      ChannelId,
      { measured: number; twin: number }
    >;
    expect(detectionDue(oilP, 'NOMINAL', readings)).toBe(true);
    expect(detectionDue(oilP, 'ADVISORY', null)).toBe(true);
  });

  it('stores one detection per injection with sim-second latency', () => {
    const director = useDirectorStore.getState();
    const injected = director.addInjection({
      scheduleId: null,
      missionS: 600,
      simS: 30,
      label: 'Cooling degradation, cylinder 3',
      scope: 'engine',
      source: 'manual',
      surprise: false,
      engineKind: 'cooling',
      cylinder: 3,
    });
    const detection = director.addDetection({
      injectionId: injected.id,
      missionS: 620,
      simS: 32,
    });
    expect(detection?.latencyS).toBe(2);
    expect(
      director.addDetection({ injectionId: injected.id, missionS: 640, simS: 34 }),
    ).toBeNull();
    expect(director.addDetection({ injectionId: 999, missionS: 0, simS: 0 })).toBeNull();
  });
});

describe('instrument presentation and voice', () => {
  it('holds a sensor-only fault at advisory', () => {
    const flags: HudFlags = { sensorOnly: true, sensorChannel: 'cht1', injected: true };
    const hud = hudStatus(snapshot([124, 103, 103, 103], [103, 103, 103, 103]), null, flags);
    expect(hud.state).toBe('ADVISORY');
    expect(hud.sentence).toContain('Engine healthy, instrument fault');
    expect(voiceCallout(hud, null, flags)).toBe('Caution. Instrument fault. CHT cylinder 1.');
  });

  it('speaks the diagnosis in three words', () => {
    const diag = diagnosis('WARNING');
    const flags: HudFlags = { sensorOnly: false, injected: true };
    const hud = hudStatus(snapshot([103, 103, 126, 103]), diag, flags);
    expect(hud.state).toBe('WARNING');
    expect(voiceCallout(hud, diag, flags)).toBe('Caution. Cooling. Cylinder three.');
    expect(hudRank('NOMINAL')).toBe(0);
    expect(hudRank('ADVISORY')).toBe(1);
    expect(hudRank('WARNING')).toBe(2);
    expect(hudRank('CRITICAL')).toBe(3);
  });
});

describe('engine-out glide range', () => {
  it('uses a 12:1 ratio and zero range on the ground', () => {
    expect(glideRangeM(1000)).toBe(12000);
    expect(glideRangeM(0)).toBe(0);
    expect(glideRangeM(-50)).toBe(0);
    expect(glideTimeS(12000, 40)).toBe(300);
    expect(glideTimeS(12000, 0)).toBe(0);
  });

  it('appears only for warning/critical with no reachable field or a forced glide', () => {
    expect(glideRingVisible('NOMINAL', false)).toBe(false);
    expect(glideRingVisible('ADVISORY', false)).toBe(false);
    expect(glideRingVisible('WARNING', false)).toBe(true);
    expect(glideRingVisible('CRITICAL', false)).toBe(true);
    expect(glideRingVisible('CRITICAL', true)).toBe(false);
    expect(glideRingVisible('CRITICAL', true, true)).toBe(true);
    expect(glideRingVisible('ADVISORY', true, true)).toBe(false);
  });

  it('shrinks as height above terrain falls and vanishes at the surface', () => {
    const high = glideRing(25.5, 91.5, 3000, 1000, 270, 0, 40);
    const low = glideRing(25.5, 91.5, 1800, 1000, 270, 0, 40);
    expect(high?.radiusM).toBe(24000);
    expect(low?.radiusM).toBe(9600);
    expect(low!.radiusM).toBeLessThan(high!.radiusM);
    expect(glideRing(25.5, 91.5, 1000, 1000, 270, 0, 40)).toBeNull();
  });

  it('shifts the ring downwind by the drift accumulated over the glide', () => {
    const still = glideRing(25.5, 91.5, 3000, 1000, 270, 0, 40);
    const windy = glideRing(25.5, 91.5, 3000, 1000, 270, 10, 40);
    expect(still!.lat).toBeCloseTo(25.5, 9);
    expect(still!.lon).toBeCloseTo(91.5, 9);
    expect(windy!.lat).toBeCloseTo(25.5, 3);
    expect(windy!.lon).toBeGreaterThan(still!.lon);
  });
});
