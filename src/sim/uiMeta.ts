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

export function chtColor(cht: number, min = 40, max = 240): string {
  // flat blue -> amber -> red ramp (steel #5B8DB8, amber #C9922E, red #C4443F)
  const t = Math.max(0, Math.min(1, (cht - min) / (max - min)));
  const stops: [number, [number, number, number]][] = [
    [0, [91, 141, 184]],
    [0.5, [201, 146, 46]],
    [1, [196, 68, 63]],
  ];
  let a = stops[0];
  let b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i][0] && t <= stops[i + 1][0]) {
      a = stops[i];
      b = stops[i + 1];
      break;
    }
  }
  const f = (t - a[0]) / (b[0] - a[0] || 1);
  const c = a[1].map((v, i) => Math.round(v + (b[1][i] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
