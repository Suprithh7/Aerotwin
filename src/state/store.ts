import { create } from 'zustand';
import type { ChannelId, FaultSpec, HistPoint, Scenario, Snapshot } from '../sim/types';
import type { WorkerCommand, WorkerMessage } from '../sim/worker';
import { HIST_WINDOW_S } from '../sim/constants';

export type FaultInput = Omit<FaultSpec, 'id' | 'tInject'>;

export interface SimStore {
  snapshot: Snapshot | null;
  history: HistPoint[];
  speed: number;
  paused: boolean;
  seedInput: string;
  scenario: Scenario;
  selectedChannel: ChannelId;
  setSpeed: (v: number) => void;
  togglePause: () => void;
  stepFrame: () => void;
  applySeed: () => void;
  setScenario: (s: Scenario) => void;
  setSelectedChannel: (c: ChannelId) => void;
  injectFault: (spec: FaultInput) => void;
  clearFault: (id: number) => void;
}

export const DEFAULT_SCENARIO: Scenario = {
  phase: 'cruise',
  turbulence: 'none',
  isaDev: 0,
  altitude: 3000,
};

let worker: Worker | null = null;

function send(cmd: WorkerCommand): void {
  worker?.postMessage(cmd);
}

export const useSimStore = create<SimStore>((set, get) => {
  worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
    const msg = e.data;
    if (msg.type === 'reset') {
      set({ history: [] });
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
    set({ snapshot: msg.snapshot, history: hist });
  };

  return {
    snapshot: null,
    history: [],
    speed: 1,
    paused: false,
    seedInput: '1337',
    scenario: DEFAULT_SCENARIO,
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
        send({ cmd: 'config', seed: seed >>> 0, scenario: get().scenario });
      }
    },
    setScenario: (s) => {
      set({ scenario: s });
      const seed = parseInt(get().seedInput, 10);
      send({ cmd: 'config', seed: Number.isFinite(seed) ? seed >>> 0 : 1337, scenario: s });
    },
    setSelectedChannel: (c) => set({ selectedChannel: c }),
    injectFault: (spec) => send({ cmd: 'inject', spec }),
    clearFault: (id) => send({ cmd: 'clear', id }),
  };
});
