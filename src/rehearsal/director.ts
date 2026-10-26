// Failure Director: the instructor's schedule of faults and disturbances.
// The scheduler is driven by the mission clock, so a five-minute schedule fires
// at the same mission time whether the rehearsal runs at 1x, 10x or 60x.
import { create } from 'zustand';
import { CHANNELS } from '../sim/constants';
import { CYLINDER_FAULTS, ENGINE_FAULT_LABELS } from '../sim/faults';
import { mulberry32 } from '../sim/rng';
import type {
  ChannelId,
  EngineFaultKind,
  SensorFaultKind,
  TurbulenceLevel,
} from '../sim/types';
import type { GaugeId } from '../mission/types';
import type { ScenarioFault, ScenarioScript } from './types';

export const ENGINE_FAULT_ORDER: EngineFaultKind[] = [
  'misfire',
  'injector',
  'cooling',
  'oil',
  'ignition',
  'turbo',
  'compression',
  'exhaust',
];

/** Sensor channels offered by the director, in panel order. */
export const INSTRUMENT_CHANNELS: ChannelId[] = [
  'cht1',
  'cht2',
  'cht3',
  'cht4',
  'egt1',
  'egt2',
  'egt3',
  'egt4',
  'oilT',
  'oilP',
  'rpm',
  'vib',
];

export const INSTRUMENT_KINDS: SensorFaultKind[] = ['drift', 'stuck', 'noise'];

/** The sim calls its spike model "noise"; the panel presents it as a spike. */
export const INSTRUMENT_KIND_LABELS: Record<SensorFaultKind, string> = {
  drift: 'Drift',
  stuck: 'Stuck',
  noise: 'Spike',
};

export const TURB_ORDER: TurbulenceLevel[] = ['none', 'light', 'moderate', 'severe'];

export type DirectorPayload =
  | {
      type: 'engine';
      kind: EngineFaultKind;
      severity: number;
      rampTime: number;
      cylinder?: number;
    }
  | {
      type: 'sensor';
      kind: SensorFaultKind;
      severity: number;
      rampTime: number;
      channel: ChannelId;
    }
  | { type: 'link'; action: 'jam' | 'restore' | 'degrade' }
  | { type: 'weather'; turbulence?: TurbulenceLevel; isaDevC?: number };

export type DirectorSource = 'manual' | 'scenario' | 'surprise';
export type DirectorLinkMode = 'normal' | 'degraded' | 'jammed';

export interface ScheduledInjection {
  id: number;
  /** Mission-clock seconds at which the injection is due. */
  atS: number;
  payload: DirectorPayload;
  source: DirectorSource;
  /** A surprise keeps its payload out of the panel until it fires. */
  hidden: boolean;
}

export interface InjectionRecord {
  id: number;
  scheduleId: number | null;
  /** Actual mission-clock time of the injection. */
  missionS: number;
  /** Actual compressed-sim time of the injection, for detection latency. */
  simS: number;
  atMs: number;
  label: string;
  scope: 'engine' | 'sensor' | 'link' | 'weather';
  source: DirectorSource;
  surprise: boolean;
  engineKind?: EngineFaultKind;
  sensorKind?: SensorFaultKind;
  cylinder?: number;
  channel?: ChannelId;
}

export interface DetectionRecord {
  injectionId: number;
  /** Mission-clock time at which the system announced the fault. */
  missionS: number;
  /** Compressed-sim time of the announcement. */
  simS: number;
  /** Sim seconds from injection to announcement. */
  latencyS: number;
}

export interface DirectorStore {
  open: boolean;
  soundOn: boolean;
  seed: number;
  windowMin: number;
  windowMax: number;
  schedule: ScheduledInjection[];
  injections: InjectionRecord[];
  detections: DetectionRecord[];
  linkMode: DirectorLinkMode;

  toggleOpen: () => void;
  setOpen: (open: boolean) => void;
  setSoundOn: (on: boolean) => void;
  toggleSound: () => void;
  setSeed: (seed: number) => void;
  setWindow: (min: number, max: number) => void;
  setLinkMode: (mode: DirectorLinkMode) => void;
  resetForRehearsal: (script: ScenarioScript, totalS: number) => void;
  addSchedule: (payload: DirectorPayload, atS: number, source?: DirectorSource) => number;
  updateScheduleTime: (id: number, atS: number) => void;
  removeSchedule: (id: number) => void;
  clearSchedule: () => void;
  markFired: (id: number) => void;
  addInjection: (record: Omit<InjectionRecord, 'id' | 'atMs'>) => InjectionRecord;
  addDetection: (record: Omit<DetectionRecord, 'latencyS'>) => DetectionRecord | null;
  surprise: (totalS: number) => boolean;
}

let scheduleSeq = 0;
let injectionSeq = 0;

export function channelName(channel: ChannelId): string {
  return CHANNELS.find((c) => c.id === channel)?.label ?? channel.toUpperCase();
}

export function engineFaultName(kind: EngineFaultKind): string {
  return ENGINE_FAULT_LABELS[kind] ?? 'Engine fault';
}

export function instrumentKindName(kind: SensorFaultKind): string {
  return INSTRUMENT_KIND_LABELS[kind] ?? 'Instrument fault';
}

export function payloadLabel(payload: DirectorPayload): string {
  if (payload.type === 'engine') {
    const cyl = CYLINDER_FAULTS.has(payload.kind)
      ? `, cylinder ${payload.cylinder ?? 1}`
      : '';
    return `${engineFaultName(payload.kind)}${cyl}`;
  }
  if (payload.type === 'sensor') {
    return `${channelName(payload.channel)} sensor ${instrumentKindName(payload.kind).toLowerCase()}`;
  }
  if (payload.type === 'link') {
    if (payload.action === 'jam') return 'Datalink jammed';
    if (payload.action === 'degrade') return 'Datalink rate reduced to 0.25x';
    return 'Datalink restored';
  }
  if (payload.turbulence !== undefined) return `Turbulence ${payload.turbulence}`;
  const dev = payload.isaDevC ?? 0;
  return `ISA deviation ${dev >= 0 ? '+' : ''}${Math.round(dev)} C`;
}

export function payloadFromScenario(fault: ScenarioFault): DirectorPayload {
  if (fault.scope === 'engine') {
    return {
      type: 'engine',
      kind: fault.kind as EngineFaultKind,
      severity: fault.severity,
      rampTime: fault.rampTime,
      ...(fault.cylinder !== undefined ? { cylinder: fault.cylinder } : {}),
    };
  }
  return {
    type: 'sensor',
    kind: fault.kind as SensorFaultKind,
    severity: fault.severity,
    rampTime: fault.rampTime,
    channel: fault.channel ?? 'cht1',
  };
}

/** A scenario card becomes one scheduled item at its mission-clock trigger. */
export function scenarioSchedule(script: ScenarioScript, totalS: number): ScheduledInjection[] {
  if (!script.fault || script.triggerFrac === null) return [];
  return [
    {
      id: 0,
      atS: Math.max(0, script.triggerFrac * totalS),
      payload: payloadFromScenario(script.fault),
      source: 'scenario',
      hidden: false,
    },
  ];
}

export function scheduleLabel(item: ScheduledInjection): string {
  return item.hidden ? 'SURPRISE' : payloadLabel(item.payload);
}

export function dueScheduled(
  schedule: ScheduledInjection[],
  missionS: number,
): ScheduledInjection[] {
  return schedule
    .filter((item) => item.atS <= missionS + 1e-6)
    .sort((a, b) => a.atS - b.atS || a.id - b.id);
}

export function parseScheduleS(text: string): number | null {
  const value = text.trim();
  if (!value) return null;
  const parts = value.split(':');
  if (parts.length > 2) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 1) return Math.round(nums[0] * 60);
  return Math.round(nums[0] * 60 + Math.min(59, nums[1]));
}

export function fmtScheduleS(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  return `${String(m).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export interface SurprisePick {
  atS: number;
  payload: DirectorPayload;
}

/**
 * Seeded surprise: the same seed and window always produce the same fault at
 * the same mission time. The fault scope is roughly half engine, half
 * instrument, and every draw happens in a fixed order.
 */
export function surprisePick(seed: number, windowStartS: number, windowEndS: number): SurprisePick {
  const rand = mulberry32(seed >>> 0);
  const start = Math.max(0, Math.min(windowStartS, windowEndS));
  const end = Math.max(start + 1, Math.max(windowStartS, windowEndS));
  const atS = start + rand() * (end - start);
  const pickEngine = rand() < 0.55;

  if (pickEngine) {
    const kind = ENGINE_FAULT_ORDER[Math.floor(rand() * ENGINE_FAULT_ORDER.length)];
    const cylinder = 1 + Math.floor(rand() * 4);
    const severity = Math.round((0.45 + rand() * 0.3) * 100) / 100;
    const rampTime = [10, 15, 20, 30][Math.floor(rand() * 4)];
    return {
      atS,
      payload: {
        type: 'engine',
        kind,
        severity,
        rampTime,
        ...(CYLINDER_FAULTS.has(kind) ? { cylinder } : {}),
      },
    };
  }

  const channel = INSTRUMENT_CHANNELS[Math.floor(rand() * INSTRUMENT_CHANNELS.length)];
  const kind = INSTRUMENT_KINDS[Math.floor(rand() * INSTRUMENT_KINDS.length)];
  const severity = Math.round((0.4 + rand() * 0.3) * 100) / 100;
  const rampTime = [5, 10, 15][Math.floor(rand() * 3)];
  return { atS, payload: { type: 'sensor', kind, severity, rampTime, channel } };
}

export interface ActiveInjectionContext {
  injected: boolean;
  engineActive: boolean;
  sensorActive: boolean;
  /** The engine is healthy and only instrumentation is suspect. */
  sensorOnly: boolean;
  sensorChannel?: ChannelId;
  affectedGauges: GaugeId[];
  affectedCylinders: number[];
}

const GAUGES_BY_ENGINE: Record<EngineFaultKind, GaugeId[]> = {
  misfire: ['cht'],
  injector: ['cht'],
  cooling: ['cht'],
  oil: ['oilT', 'oilP'],
  ignition: ['cht'],
  turbo: ['rpm'],
  compression: ['cht'],
  exhaust: ['cht'],
};

export function gaugeForChannel(channel: ChannelId): GaugeId {
  if (channel === 'rpm') return 'rpm';
  if (channel === 'oilT') return 'oilT';
  if (channel === 'oilP') return 'oilP';
  if (channel === 'fuel') return 'fuel';
  return 'cht';
}

export function cylinderForChannel(channel: ChannelId): number | null {
  const match = /^cht([1-4])$/.exec(channel);
  return match ? Number(match[1]) : null;
}

/** Active faults across this run, plus the HUD/gauge presentation they drive. */
export function activeInjectionContext(injections: InjectionRecord[]): ActiveInjectionContext {
  const engine = [...injections].reverse().find((r) => r.scope === 'engine');
  const sensor = [...injections].reverse().find((r) => r.scope === 'sensor');
  const engineActive = engine !== undefined;
  const sensorActive = sensor !== undefined;
  const gauges: GaugeId[] = [];
  const cylinders: number[] = [];
  if (engine?.engineKind) {
    gauges.push(...GAUGES_BY_ENGINE[engine.engineKind]);
    if (engine.cylinder) cylinders.push(engine.cylinder);
  }
  if (sensor?.channel) {
    const g = gaugeForChannel(sensor.channel);
    if (!gauges.includes(g)) gauges.push(g);
    const cyl = cylinderForChannel(sensor.channel);
    if (cyl !== null && !cylinders.includes(cyl)) cylinders.push(cyl);
  }
  return {
    injected: engineActive || sensorActive,
    engineActive,
    sensorActive,
    sensorOnly: sensorActive && !engineActive,
    ...(sensor?.channel ? { sensorChannel: sensor.channel } : {}),
    affectedGauges: gauges,
    affectedCylinders: cylinders,
  };
}

export function detectionLatencyS(injectionSimS: number, announcementSimS: number): number {
  return Math.max(0, announcementSimS - injectionSimS);
}

/**
 * The first announcement after injection counts as detection. Engine faults
 * wait for the twin's diagnosis; instrument faults also count when the affected
 * channel's measured value has clearly separated from the twin.
 */
export function detectionDue(
  record: Pick<InjectionRecord, 'scope' | 'channel'>,
  diagnosisState: string,
  readings: Record<ChannelId, { measured: number; twin: number }> | null | undefined,
): boolean {
  if (diagnosisState !== 'NOMINAL') return true;
  if (record.scope !== 'sensor' || !record.channel || !readings) return false;
  const r = readings[record.channel];
  if (!r) return false;
  const meta = CHANNELS.find((c) => c.id === record.channel);
  // Scale the separation test to the channel: three sigma is far too large for
  // oil pressure and far too small for CHT. A fraction of the drift range keeps
  // detection comparable across units.
  const threshold = meta
    ? Math.max(meta.noiseSigma * 4, meta.driftRange * 0.2)
    : 3;
  return Math.abs(r.measured - r.twin) >= threshold;
}

export const useDirectorStore = create<DirectorStore>((set, get) => ({
  open: false,
  soundOn: true,
  seed: 20261026,
  windowMin: 5,
  windowMax: 20,
  schedule: [],
  injections: [],
  detections: [],
  linkMode: 'normal',

  toggleOpen: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => set({ open }),
  setSoundOn: (on) => set({ soundOn: on }),
  toggleSound: () => set((s) => ({ soundOn: !s.soundOn })),
  setSeed: (seed) => {
    if (Number.isFinite(seed)) set({ seed: Math.max(0, Math.round(seed)) });
  },
  setWindow: (min, max) => {
    if (!Number.isFinite(min) || !Number.isFinite(max)) return;
    const a = Math.max(0, min);
    const b = Math.max(0, max);
    set({ windowMin: Math.min(a, b), windowMax: Math.max(a, b) });
  },
  setLinkMode: (mode) => set({ linkMode: mode }),

  resetForRehearsal: (script, totalS) => {
    scheduleSeq = 0;
    injectionSeq = 0;
    const schedule = scenarioSchedule(script, totalS).map((item) => ({
      ...item,
      id: ++scheduleSeq,
    }));
    set({
      schedule,
      injections: [],
      detections: [],
      linkMode: script.jam ? 'jammed' : 'normal',
    });
  },

  addSchedule: (payload, atS, source = 'manual') => {
    const id = ++scheduleSeq;
    const item: ScheduledInjection = {
      id,
      atS: Math.max(0, atS),
      payload,
      source,
      hidden: source === 'surprise',
    };
    set((s) => ({ schedule: [...s.schedule, item].sort((a, b) => a.atS - b.atS) }));
    return id;
  },

  updateScheduleTime: (id, atS) => {
    if (!Number.isFinite(atS)) return;
    set((s) => ({
      schedule: s.schedule
        .map((item) => (item.id === id ? { ...item, atS: Math.max(0, atS) } : item))
        .sort((a, b) => a.atS - b.atS),
    }));
  },

  removeSchedule: (id) =>
    set((s) => ({ schedule: s.schedule.filter((item) => item.id !== id) })),

  clearSchedule: () => set({ schedule: [] }),

  markFired: (id) => set((s) => ({ schedule: s.schedule.filter((item) => item.id !== id) })),

  addInjection: (record) => {
    const full: InjectionRecord = { ...record, id: ++injectionSeq, atMs: Date.now() };
    set((s) => ({ injections: [...s.injections, full] }));
    return full;
  },

  addDetection: (record) => {
    const injection = get().injections.find((r) => r.id === record.injectionId);
    if (!injection) return null;
    if (get().detections.some((d) => d.injectionId === record.injectionId)) return null;
    const full: DetectionRecord = {
      ...record,
      latencyS: detectionLatencyS(injection.simS, record.simS),
    };
    set((s) => ({ detections: [...s.detections, full] }));
    return full;
  },

  surprise: (totalS) => {
    const s = get();
    const start = Math.min(s.windowMin, s.windowMax) * 60;
    const endRaw = Math.max(s.windowMin, s.windowMax) * 60;
    const cap = totalS > 0 ? totalS * 0.98 : endRaw;
    const end = Math.min(endRaw, cap);
    const begin = Math.min(start, Math.max(0, end - 1));
    if (!(end > begin)) return false;
    const pick = surprisePick(s.seed, begin, end);
    get().addSchedule(pick.payload, pick.atS, 'surprise');
    return true;
  },
}));
