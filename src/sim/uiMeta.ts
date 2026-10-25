// UI-only helpers over the sim constants.
import { CHANNELS } from './constants';
import type { ChannelId, ChannelMeta } from './types';

export { CHANNELS };
export type { ChannelId, ChannelMeta };

export const CYLINDER_FAULTS_SET = new Set([
  'misfire',
  'injector',
  'cooling',
  'ignition',
  'compression',
]);

import { C } from '../ui/theme';

const NOMINAL: [number, number, number] = [91, 141, 184];
const AMBER: [number, number, number] = [201, 146, 46];
const RED: [number, number, number] = [196, 68, 63];

function rgb(c: [number, number, number]): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function mix(a: [number, number, number], b: [number, number, number], f: number): string {
  return rgb(a.map((v, i) => Math.round(v + (b[i] - v) * f)) as [number, number, number]);
}

/**
 * Thermal ramp anchored to the channel's own bands: steel through the
 * nominal range, blending toward amber as the caution band approaches, amber
 * across caution, and red only at the limit (or above it).
 */
export function thermalColor(
  value: number,
  nominalC: number,
  cautionC: number,
  limitC: number,
): string {
  if (value <= nominalC) return rgb(NOMINAL);
  if (value >= limitC) return rgb(RED);
  if (value <= cautionC) {
    return mix(NOMINAL, AMBER, (value - nominalC) / (cautionC - nominalC));
  }
  return mix(AMBER, RED, (value - cautionC) / (limitC - cautionC));
}

export const THERMAL_EMPTY = C.rule;
