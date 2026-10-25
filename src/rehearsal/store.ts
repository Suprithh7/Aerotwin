import { create } from 'zustand';
import { DEFAULT_SCENARIO } from '../sim/constants';
import { useSimStore } from '../state/store';
import type {
  DebriefResult,
  EventTone,
  Outcome,
  RehearsalEvent,
  ScenarioId,
  Stage,
} from './types';

export interface RehearsalStore {
  stage: Stage;
  scenarioId: ScenarioId;
  overlayOpen: boolean;
  /** Simulation epoch that must have arrived before the fly clock is trusted. */
  epochTarget: number;
  events: RehearsalEvent[];
  debrief: DebriefResult | null;
  outcome: Outcome | null;
  start: () => void;
  finish: (debrief: DebriefResult) => void;
  toBrief: () => void;
  setScenarioId: (id: ScenarioId) => void;
  setOverlay: (open: boolean) => void;
  pushEvent: (event: {
    missionS: number;
    label: string;
    text: string;
    tone?: EventTone;
    tick?: boolean;
  }) => void;
}

let eventSeq = 0;

export const useRehearsalStore = create<RehearsalStore>((set, get) => ({
  stage: 'brief',
  scenarioId: 'normal',
  overlayOpen: false,
  epochTarget: 0,
  events: [],
  debrief: null,
  outcome: null,

  start: () => {
    eventSeq = 0;
    const sim = useSimStore.getState();
    if (sim.paused) sim.togglePause();
    sim.setSpeed(1);
    const epochTarget = sim.simEpoch + 1;
    // Config resets the run and clears all injected faults in the worker.
    sim.setScenario(DEFAULT_SCENARIO);
    set({
      stage: 'fly',
      overlayOpen: false,
      epochTarget,
      events: [],
      debrief: null,
      outcome: null,
    });
  },

  finish: (debrief) => {
    const sim = useSimStore.getState();
    if (!sim.paused) sim.togglePause();
    set({ stage: 'debrief', debrief, outcome: debrief.outcome });
  },

  toBrief: () =>
    set({
      stage: 'brief',
      overlayOpen: false,
      scenarioId: 'normal',
      events: [],
      debrief: null,
      outcome: null,
    }),

  setScenarioId: (id) => set({ scenarioId: id }),
  setOverlay: (open) => set({ overlayOpen: open }),

  pushEvent: (event) => {
    const now = Date.now();
    const entry: RehearsalEvent = {
      id: ++eventSeq,
      atMs: now,
      missionS: Math.max(0, event.missionS),
      label: event.label,
      text: event.text,
      tone: event.tone ?? 'info',
      tick: event.tick ?? false,
    };
    set({ events: [...get().events, entry].slice(-60) });
  },
}));
