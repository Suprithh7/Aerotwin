import { create } from 'zustand';
import type { ChannelId, FaultSpec, HistPoint, Scenario, Snapshot } from '../sim/types';
import type { WorkerCommand, WorkerMessage } from '../sim/worker';
import { DEFAULT_SCENARIO, HIST_WINDOW_S, INITIAL_FUEL_KG } from '../sim/constants';
import { NO_DIAGNOSIS, type Diagnosis } from '../diagnosis/diagnose';
import { FF_SMOOTH_WINDOW_S } from '../nav/alternates';

export type FaultInput = Omit<FaultSpec, 'id' | 'tInject'>;

export interface SimStore {
  snapshot: Snapshot | null;
  history: HistPoint[];
  diagnosis: Diagnosis;
  ffSmoothKgH: number;
  speed: number;
  paused: boolean;
  seedInput: string;
  scenario: Scenario;
  fuelLoadKg: number;
  selectedChannel: ChannelId;
  setSpeed: (v: number) => void;
  togglePause: () => void;
  stepFrame: () => void;
  applySeed: () => void;
  setScenario: (s: Scenario) => void;
  setFuelLoad: (kg: number) => void;
  setSelectedChannel: (c: ChannelId) => void;
  injectFault: (spec: FaultInput) => void;
  clearFault: (id: number) => void;
}

let worker: Worker | null = null;

function send(cmd: WorkerCommand): void {
  worker?.postMessage(cmd);
}

// Rolling mean fuel flow, sim-time windowed: the endurance figure the alternate
// logic divides by has to be steady enough to read.
const ffWindow: { t: number; ff: number }[] = [];

function smoothFuelFlow(t: number, ff: number): number {
  ffWindow.push({ t, ff });
  while (ffWindow.length && t - ffWindow[0].t > FF_SMOOTH_WINDOW_S) ffWindow.shift();
  let s = 0;
  for (const p of ffWindow) s += p.ff;
  return s / ffWindow.length;
}

export const useSimStore = create<SimStore>((set, get) => {
  worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
    const msg = e.data;
    if (msg.type === 'reset') {
      ffWindow.length = 0;
      set({ history: [], diagnosis: NO_DIAGNOSIS, ffSmoothKgH: 0 });
      return;
    }
    const cutoff = msg.snapshot.t - HIST_WINDOW_S;
    let hist = get().history;
    if (msg.records.length) {
      hist = hist.concat(msg.records);
      if (hist.length > 1500 || hist[0].t < cutoff) {
        hist = hist.filter((r) => r.t >= cutoff);
      }
    }
    set({
      snapshot: msg.snapshot,
      history: hist,
      diagnosis: msg.diagnosis,
      ffSmoothKgH: smoothFuelFlow(msg.snapshot.t, msg.snapshot.readings.ff.measured),
    });
  };

  return {
    snapshot: null,
    history: [],
    diagnosis: NO_DIAGNOSIS,
    ffSmoothKgH: 0,
    speed: 1,
    paused: false,
    seedInput: '1337',
    scenario: DEFAULT_SCENARIO,
    fuelLoadKg: INITIAL_FUEL_KG,
    selectedChannel: 'cht3',
    setSpeed: (v) => {
      set({ speed: v });
      send({ cmd: 'speed', value: v });
    },
    togglePause: () => {
      const p = !get().paused;
      set({ paused: p });
      send({ cmd: 'pause', value: p });
    },
    stepFrame: () => send({ cmd: 'step' }),
    applySeed: () => {
      const seed = parseInt(get().seedInput, 10);
      if (Number.isFinite(seed)) {
        set({ fuelLoadKg: INITIAL_FUEL_KG });
        send({ cmd: 'config', seed: seed >>> 0, scenario: get().scenario });
      }
    },
    setScenario: (s) => {
      set({ scenario: s, fuelLoadKg: INITIAL_FUEL_KG });
      const seed = parseInt(get().seedInput, 10);
      send({ cmd: 'config', seed: Number.isFinite(seed) ? seed >>> 0 : 1337, scenario: s });
    },
    setFuelLoad: (kg) => {
      const v = Math.max(0, kg);
      set({ fuelLoadKg: v });
      send({ cmd: 'fuel', kg: v });
    },
    setSelectedChannel: (c) => set({ selectedChannel: c }),
    injectFault: (spec) => send({ cmd: 'inject', spec }),
    clearFault: (id) => send({ cmd: 'clear', id }),
  };
});
