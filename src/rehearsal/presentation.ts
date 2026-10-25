// Plain-language presentation of the existing diagnosis. No new inference:
// states come from the diagnoser, sensor-only scripts are held at ADVISORY,
// and a limit is read from the measured channels themselves.
import type { Diagnosis } from '../diagnosis/diagnose';
import type { ScenarioScript } from './types';
import { CHANNELS } from '../sim/constants';
import { CHT_LIMIT_C, OILP_MIN_BAR, OILT_LIMIT_C } from '../sim/limits';
import type { ChannelId, Snapshot } from '../sim/types';

export type HudState = 'NOMINAL' | 'ADVISORY' | 'WARNING' | 'CRITICAL';

export interface MeasuredLimit {
  channel: 'CHT' | 'OIL TEMP' | 'OIL PRESSURE';
  value: number;
  limit: number;
  unit: string;
  cylinder?: number;
}

export interface HudStatus {
  state: HudState;
  sentence: string;
  limit: MeasuredLimit | null;
  sensorOnly: boolean;
}

function hottestCht(snap: Snapshot): { cylinder: number; value: number } {
  let cylinder = 1;
  let value = -Infinity;
  for (let c = 1; c <= 4; c++) {
    const v = snap.readings[`cht${c}` as ChannelId].measured;
    if (v > value) {
      value = v;
      cylinder = c;
    }
  }
  return { cylinder, value };
}

/** First measured hard limit, in the same priority order as the diagnosis. */
export function measuredLimit(snap: Snapshot): MeasuredLimit | null {
  const cht = hottestCht(snap);
  if (cht.value > CHT_LIMIT_C) {
    return {
      channel: 'CHT',
      value: cht.value,
      limit: CHT_LIMIT_C,
      unit: 'C',
      cylinder: cht.cylinder,
    };
  }
  const oilT = snap.readings.oilT.measured;
  if (oilT > OILT_LIMIT_C) {
    return { channel: 'OIL TEMP', value: oilT, limit: OILT_LIMIT_C, unit: 'C' };
  }
  const oilP = snap.readings.oilP.measured;
  if (oilP < OILP_MIN_BAR) {
    return { channel: 'OIL PRESSURE', value: oilP, limit: OILP_MIN_BAR, unit: 'bar' };
  }
  return null;
}

function channelLabel(id: ChannelId): string {
  return CHANNELS.find((c) => c.id === id)?.label ?? id.toUpperCase();
}

function deltaC(snap: Snapshot, cylinder: number): number {
  const own = snap.readings[`cht${cylinder}` as ChannelId].measured;
  const others: number[] = [];
  for (let c = 1; c <= 4; c++) {
    if (c !== cylinder) others.push(snap.readings[`cht${c}` as ChannelId].measured);
  }
  const mean = others.reduce((s, v) => s + v, 0) / Math.max(1, others.length);
  return own - mean;
}

function cleanLabel(label: string): string {
  return label.replace(/\s*\(cyl\s*\d+\)/i, '');
}

function limitSentence(limit: MeasuredLimit): string {
  if (limit.channel === 'CHT' && limit.cylinder !== undefined) {
    return `Cylinder ${limit.cylinder} CHT is ${Math.round(limit.value)} ${limit.unit}, beyond the ${limit.limit} ${limit.unit} limit; rehearsal ending.`;
  }
  return `${limit.channel} is ${limit.value.toFixed(1)} ${limit.unit}, beyond the ${limit.limit} ${limit.unit} limit; rehearsal ending.`;
}

export function hudStatus(
  snap: Snapshot | null,
  diag: Pick<Diagnosis, 'state' | 'dominant'> | null,
  script: ScenarioScript,
  injected: boolean,
): HudStatus {
  if (!snap) {
    return {
      state: 'NOMINAL',
      sentence: 'Waiting for the first engine sample.',
      limit: null,
      sensorOnly: script.sensorOnly,
    };
  }

  const limit = measuredLimit(snap);
  if (limit) {
    return { state: 'CRITICAL', sentence: limitSentence(limit), limit, sensorOnly: script.sensorOnly };
  }

  if (script.sensorOnly && injected) {
    const channel = script.fault?.channel ?? 'cht1';
    const r = snap.readings[channel];
    const delta = Math.abs(r.measured - r.true);
    return {
      state: 'ADVISORY',
      sentence: `Engine healthy, instrument fault: ${channelLabel(channel)} reads ${Math.round(delta)} C above the twin.`,
      limit: null,
      sensorOnly: true,
    };
  }

  if (diag && diag.state !== 'NOMINAL') {
    const hottest = hottestCht(snap);
    const cylinder = diag.dominant?.cylinder && diag.dominant.cylinder > 0
      ? diag.dominant.cylinder
      : hottest.cylinder;
    const delta = Math.round(deltaC(snap, cylinder));
    const name = diag.dominant ? cleanLabel(diag.dominant.label) : 'Twin fault';
    return {
      state: diag.state,
      sentence: `${name}: cylinder ${cylinder} is ${delta} C above the other cylinders.`,
      limit: null,
      sensorOnly: false,
    };
  }

  return {
    state: 'NOMINAL',
    sentence: `All cylinders within limits; hottest CHT is ${Math.round(hottestCht(snap).value)} C.`,
    limit: null,
    sensorOnly: script.sensorOnly,
  };
}
