import { describe, expect, it } from 'vitest';
import {
  REHEARSAL_SIM_SPAN_S,
  clamp01,
  fmtClock,
  fmtHM,
  fmtMmSs,
  missionClockS,
  simSForMission,
} from '../clock';
import { SCENARIO_SCRIPTS, scriptById, triggerMissionS } from '../scripts';
import { hudStatus, measuredLimit } from '../presentation';
import {
  ENGINE_OVERHAUL_H,
  LIFE_TEMP_SCALE_C,
  buildDebrief,
  factorSentence,
  lifeDoseIncrement,
  lifePct,
  lifeWeight,
  outcomeHeadline,
  weatherSentence,
} from '../metrics';
import { MISSION_TEMPLATES } from '../../data/templates';
import { pointInRing } from '../../mission/geometry';import type { Diagnosis } from '../../diagnosis/diagnose';
import type { ScenarioId, RehearsalEvent } from '../types';
import type { ChannelReading, Snapshot } from '../../sim/types';

function reading(trueC: number, measured = trueC): ChannelReading {
  return { true: trueC, measured, twin: trueC, residual: 0, z: 0, zEwma: 0 };
}

function snapshot(
  cht: [number, number, number, number],
  oilT = 95,
  oilP = 3.5,
  trueCht = cht,
): Snapshot {
  return {
    t: 0,
    phase: 'cruise',
    readings: {
      cht1: reading(trueCht[0], cht[0]),
      cht2: reading(trueCht[1], cht[1]),
      cht3: reading(trueCht[2], cht[2]),
      cht4: reading(trueCht[3], cht[3]),
      oilT: reading(oilT),
      oilP: reading(oilP),
    },
  } as unknown as Snapshot;
}

function event(missionS: number, label: string, tick = true): RehearsalEvent {
  return { id: missionS, atMs: 0, missionS, label, text: '', tone: 'info', tick };
}

describe('rehearsal clock', () => {
  it('compresses the whole mission into the fixed sim span', () => {
    expect(REHEARSAL_SIM_SPAN_S).toBe(120);
    expect(missionClockS(0, 24000)).toBe(0);
    expect(missionClockS(60, 24000)).toBe(12000);
    expect(missionClockS(120, 24000)).toBe(24000);
  });

  it('clamps beyond the span and rejects bad inputs', () => {
    expect(missionClockS(500, 24000)).toBe(24000);
    expect(missionClockS(-5, 24000)).toBe(0);
    expect(missionClockS(NaN, 24000)).toBe(0);
    expect(missionClockS(10, 0)).toBe(0);
    expect(clamp01(2)).toBe(1);
  });

  it('round-trips mission seconds to sim seconds', () => {
    expect(simSForMission(0, 24000)).toBe(0);
    expect(simSForMission(12000, 24000)).toBe(60);
    expect(simSForMission(-4, 24000)).toBe(0);
    expect(simSForMission(10, 0)).toBe(0);
  });

  it('formats h:mm:ss, mm:ss and h/min distinctly', () => {
    expect(fmtClock(0)).toBe('0:00:00');
    expect(fmtClock(59.6)).toBe('0:01:00');
    expect(fmtClock(3725)).toBe('1:02:05');
    expect(fmtMmSs(59.6)).toBe('01:00');
    expect(fmtMmSs(3661)).toBe('61:01');
    expect(fmtHM(7 * 3600 + 4 * 60)).toBe('7 h 04 min');
    expect(fmtClock(-10)).toBe('0:00:00');
  });
});

describe('scenario scripts', () => {
  it('defines the five briefing cards', () => {
    expect(SCENARIO_SCRIPTS.map((s) => s.id)).toEqual([
      'normal',
      'cooling-denied',
      'cooling-jammed',
      'cooling-friendly',
      'sensor',
    ]);
    expect(new Set(SCENARIO_SCRIPTS.map((s) => s.title)).size).toBe(5);
  });

  it('keeps normal free of faults', () => {
    const s = scriptById('normal');
    expect(s.fault).toBeNull();
    expect(s.triggerFrac).toBeNull();
    expect(triggerMissionS(s, 24000)).toBeNull();
  });

  it('injects the cooling fault on cylinder 3 at the start', () => {
    const s = scriptById('cooling-denied');
    expect(s.sensorOnly).toBe(false);
    expect(s.triggerFrac).toBe(0);
    expect(s.fault?.kind).toBe('cooling');
    expect(s.fault?.cylinder).toBe(3);
    expect(triggerMissionS(s, 24000)).toBe(0);
  });

  it('starts the jammed card with a dead datalink', () => {
    const s = scriptById('cooling-jammed');
    expect(s.jam).toBe(true);
    expect(s.fault?.kind).toBe('cooling');
    expect(scriptById('cooling-denied').jam).toBeUndefined();
  });

  it('injects the friendly-area cooling failure late in the route', () => {
    const s = scriptById('cooling-friendly');
    expect(s.triggerFrac).toBe(0.57);
    expect(triggerMissionS(s, 24000)).toBeCloseTo(13680, 6);
    expect(s.jam).toBeUndefined();
  });

  it('marks the sensor script as a false alarm on CHT 1', () => {
    const s = scriptById('sensor');
    expect(s.sensorOnly).toBe(true);
    expect(s.fault?.scope).toBe('sensor');
    expect(s.fault?.channel).toBe('cht1');
  });

  it('falls back to normal for an unknown id', () => {
    expect(scriptById('unknown' as ScenarioId).id).toBe('normal');
  });
});

describe('presentation of measured state', () => {
  it('reports nominal below every limit', () => {
    const h = hudStatus(snapshot([102, 103, 104, 103]), null, scriptById('normal'), false);
    expect(h.state).toBe('NOMINAL');
    expect(h.limit).toBeNull();
    expect(h.sentence).toContain('hottest CHT is 104 C');
  });

  it('holds a sensor-only fault at advisory with the true/measured split', () => {
    const snap = snapshot([124, 103, 103, 103], 95, 3.5, [103, 103, 103, 103]);
    const h = hudStatus(snap, null, scriptById('sensor'), true);
    expect(h.state).toBe('ADVISORY');
    expect(h.limit).toBeNull();
    expect(h.sentence).toContain('Engine healthy, instrument fault');
    expect(h.sentence).toContain('CHT Cyl 1 reads 21 C above the twin');
  });

  it('lets a measured hard limit override the sensor advisory', () => {
    const snap = snapshot([140, 103, 103, 103], 95, 3.5, [103, 103, 103, 103]);
    const h = hudStatus(snap, null, scriptById('sensor'), true);
    expect(h.state).toBe('CRITICAL');
    expect(h.sensorOnly).toBe(true);
    expect(h.sentence).toContain('beyond the 135 C limit');
  });

  it('names the cylinder and the delta for a cooling fault', () => {
    const diag = {
      state: 'WARNING',
      dominant: { label: 'Cooling degradation (cyl 3)', cylinder: 3 },
    } as unknown as Pick<Diagnosis, 'state' | 'dominant'>;
    const h = hudStatus(snapshot([103, 103, 126, 103]), diag, scriptById('cooling-denied'), true);
    expect(h.state).toBe('WARNING');
    expect(h.sentence).toBe('Cooling degradation: cylinder 3 is 23 C above the other cylinders.');
  });

  it('prioritises CHT over oil temperature and oil pressure', () => {
    const cht = measuredLimit(snapshot([103, 140, 103, 103], 131, 0.5));
    expect(cht?.channel).toBe('CHT');
    expect(cht?.cylinder).toBe(2);
    const oil = measuredLimit(snapshot([103, 103, 103, 103], 131, 0.5));
    expect(oil?.channel).toBe('OIL TEMP');
    const press = measuredLimit(snapshot([103, 103, 103, 103], 95, 0.7));
    expect(press?.channel).toBe('OIL PRESSURE');
    expect(measuredLimit(snapshot([103, 103, 103, 103]))).toBeNull();
  });
});

describe('debrief metrics', () => {
  it('uses the 1200 h overhaul life and a 15 C thermal scale', () => {
    expect(ENGINE_OVERHAUL_H).toBe(1200);
    expect(LIFE_TEMP_SCALE_C).toBe(15);
    expect(lifeWeight(110)).toBe(1);
    expect(lifeWeight(80)).toBe(1);
    expect(lifeWeight(125)).toBeCloseTo(Math.exp(1), 6);
    expect(lifePct(ENGINE_OVERHAUL_H * 3600)).toBe(100);
    expect(lifeDoseIncrement(1, 2400, 110)).toBe(20);
    expect(lifeDoseIncrement(0, 2400, 130)).toBe(0);
  });

  it('completes a full mission with planned time in the timeline', () => {
    const debrief = buildDebrief({
      outcome: 'complete',
      plannedS: 24000,
      missionS: 24000,
      flightS: 24000,
      distanceM: 500000,
      lifeDoseS: 0,
      events: [event(4800, 'FAULT INJECTED'), event(24000, 'MISSION END')],
      flagS: null,
      limitS: null,
      limitLabel: null,
      sensorOnly: false,
    });
    expect(debrief.plannedS).toBe(24000);
    expect(debrief.distanceKm).toBe(500);
    expect(debrief.leadLine).toBe('Twin flagged no fault before landing.');
    expect(debrief.ticks.map((t) => t.label)).toEqual(['FAULT INJECTED', 'MISSION END']);
  });

  it('computes the lead between the twin flag and the CHT limit', () => {
    const debrief = buildDebrief({
      outcome: 'aborted',
      plannedS: 25447,
      missionS: 14413,
      flightS: 14413,
      distanceM: 165400,
      lifeDoseS: 3600 * 8,
      events: [event(21629, 'TWIN FLAG'), event(90000, 'CHT')],
      flagS: 12989,
      limitS: 14413,
      limitLabel: 'CHT',
      sensorOnly: false,
    });
    expect(debrief.leadLine).toBe('Twin flagged the fault 23:44 before the CHT limit.');
    expect(debrief.ticks[1].missionS).toBe(14413);
    expect(debrief.engineLifePct).toBeCloseTo(lifePct(3600 * 8), 10);
    expect(debrief.lifeEqH).toBeCloseTo(8, 10);
  });

  it('reports a twin flag when no hard limit was reached', () => {
    const debrief = buildDebrief({
      outcome: 'complete',
      plannedS: 25447,
      missionS: 25447,
      flightS: 25447,
      distanceM: 139300,
      lifeDoseS: 0,
      events: [event(6722, 'TWIN FLAG'), event(25447, 'MISSION END')],
      flagS: 6722,
      limitS: null,
      limitLabel: null,
      sensorOnly: false,
    });
    expect(debrief.leadLine).toBe(
      'Twin flagged the fault at T+1:52:02; no engine limit was reached before landing.',
    );
  });

  it('holds the advisory wording for a sensor-only run', () => {
    const debrief = buildDebrief({
      outcome: 'complete',
      plannedS: 24000,
      missionS: 24000,
      flightS: 24000,
      distanceM: 0,
      lifeDoseS: 0,
      events: [],
      flagS: null,
      limitS: null,
      limitLabel: null,
      sensorOnly: true,
    });
    expect(debrief.leadLine).toContain('held the instrument fault at advisory');
    expect(outcomeHeadline('complete')).toBe('MISSION COMPLETE');
    expect(outcomeHeadline('aborted')).toBe('MISSION ABORTED');
    expect(outcomeHeadline('lost')).toBe('AIRCRAFT LOST');
  });

  it('makes a plain weather sentence from the selected cells', () => {
    const cells = Array.from({ length: 5 }, (_, i) => ({
      isaDevC: 12 + i,
      windDirDeg: 225,
      windSpdMs: 6 + i,
      gustMs: 8 + i,
      turb: (i === 4 ? 'severe' : 'moderate') as 'severe' | 'moderate',
    }));
    expect(weatherSentence(cells, 'Hot and high')).toBe(
      'Hot and high: air temperature +12 to +16 C relative to ISA, wind 6 to 10 m/s from the south-west, severe turbulence at the worst point.',
    );
  });

  it('formats factors with units and names missing separation', () => {
    expect(
      factorSentence({ label: 'CRUISE DENSITY ALTITUDE', corr: 0.2, meanFail: 6000, meanPass: 5000, unit: 'm' }),
    ).toBe('Failed runs averaged 1000 m more cruise density altitude.');
    expect(
      factorSentence({ label: 'ISA DEVIATION', corr: 0, meanFail: NaN, meanPass: NaN, unit: 'degC' }),
    ).toBe('No clear separation in ISA temperature.');
  });
});

describe('template geography', () => {
  it('carries illustrative but valid closed zones and a ground station', () => {
    expect(MISSION_TEMPLATES.length).toBeGreaterThanOrEqual(5);
    for (const template of MISSION_TEMPLATES) {
      expect(template.illustrative, template.id).toBe(true);
      const gs = template.groundStation;
      expect(gs.lat).toBeGreaterThan(6);
      expect(gs.lat).toBeLessThan(36);
      expect(gs.lon).toBeGreaterThan(68);
      expect(gs.lon).toBeLessThan(98);
      for (const zone of template.zones) {
        const ring = zone.polygon;
        expect(ring.length, `${template.id}/${zone.id}`).toBeGreaterThanOrEqual(4);
        expect(ring[0]).toEqual(ring[ring.length - 1]);
        const lat = ring.slice(0, -1).reduce((s, p) => s + p[1], 0) / (ring.length - 1);
        const lon = ring.slice(0, -1).reduce((s, p) => s + p[0], 0) / (ring.length - 1);
        expect(pointInRing(lon, lat, ring), `${template.id}/${zone.id}`).toBe(true);
      }
      expect(template.nodes.length).toBeGreaterThanOrEqual(2);
      expect(template.nodes[0].type).toBe('LAUNCH');
      expect(template.nodes[template.nodes.length - 1].type).toBe('LAND');
    }
  });
});
