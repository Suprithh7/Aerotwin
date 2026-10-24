// Fault injection: engine faults modify MODEL PARAMETERS of the true engine
// only; sensor faults modify the measured value only.
import type { EngineParams } from './engineModel';
import type { FaultSpec } from './types';

export function rampProgress(spec: FaultSpec, t: number): number {
  if (spec.rampTime <= 0) return 1;
  const u = (t - spec.tInject) / spec.rampTime;
  return u < 0 ? 0 : u > 1 ? 1 : u;
}

export function engineParamsWithFaults(
  base: EngineParams,
  faults: FaultSpec[],
  t: number,
): EngineParams {
  const p: EngineParams = {
    ...base,
    firing: base.firing.slice(),
    injector: base.injector.slice(),
    ignition: base.ignition.slice(),
    compression: base.compression.slice(),
    cooling: base.cooling.slice(),
  };
  for (const f of faults) {
    if (f.scope !== 'engine') continue;
    const s = f.severity * rampProgress(f, t);
    const i = (f.cylinder ?? 1) - 1;
    switch (f.kind) {
      case 'misfire':
        p.firing[i] *= 1 - 0.97 * s;
        break;
      case 'injector':
        p.injector[i] *= 1 + 1.3 * s;
        break;
      case 'cooling':
        p.cooling[i] *= 1 - 0.85 * s;
        break;
      case 'oil':
        p.oilSeal *= 1 - 0.8 * s;
        break;
      case 'ignition':
        p.ignition[i] *= 1 - 0.55 * s;
        break;
      case 'turbo':
        p.turbo *= 1 - 0.9 * s;
        break;
      case 'compression':
        p.compression[i] *= 1 - 0.55 * s;
        break;
      case 'exhaust':
        p.exhaust = Math.min(1, p.exhaust + s);
        break;
    }
  }
  return p;
}

export const ENGINE_FAULT_LABELS: Record<string, string> = {
  misfire: 'Cylinder misfire',
  injector: 'Injector fault',
  cooling: 'Cooling degradation',
  oil: 'Oil system degradation',
  ignition: 'Ignition degradation',
  turbo: 'Turbo boost loss',
  compression: 'Compression loss',
  exhaust: 'Exhaust back-pressure',
};

export const SENSOR_FAULT_LABELS: Record<string, string> = {
  drift: 'Sensor drift / bias',
  stuck: 'Sensor stuck / dropout',
  noise: 'Sensor noise spike',
};

export const CYLINDER_FAULTS = new Set(['misfire', 'injector', 'cooling', 'ignition', 'compression']);

export function faultLabel(f: FaultSpec): string {
  const base =
    f.scope === 'engine'
      ? ENGINE_FAULT_LABELS[f.kind] ?? f.kind
      : SENSOR_FAULT_LABELS[f.kind] ?? f.kind;
  if (f.scope === 'engine' && CYLINDER_FAULTS.has(f.kind)) {
    return `${base} (cyl ${f.cylinder ?? 1})`;
  }
  if (f.scope === 'sensor') return `${base} [${f.channel ?? '?'}]`;
  return base;
}
