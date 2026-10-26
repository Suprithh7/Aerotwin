// Controller for SIH judge mode. Kept separate from the pure caption logic so
// the latter can be tested without the browser worker and stores.
import { create } from 'zustand';
import { useMissionStore } from '../mission/missionStore';
import { useSimStore } from '../state/store';
import { useRehearsalStore } from './store';
import { JUDGE_SCENARIO, JUDGE_SEED } from './judge';
import type { WeatherMode } from '../mission/types';
import type { ScenarioId } from './types';

export interface JudgeStore {
  introOpen: boolean;
  active: boolean;
  accelerated: boolean;
  previousScenarioId: ScenarioId | null;
  previousSeedInput: string | null;
  previousWeatherMode: WeatherMode | null;
  openIntro: () => void;
  cancelIntro: () => void;
  begin: () => void;
  restart: () => void;
  markAccelerated: () => void;
  stop: () => void;
}

function configureRun(): void {
  const sim = useSimStore.getState();
  sim.setSeedInput(String(JUDGE_SEED));

  // Judge runs use the deterministic manual-weather fallback cells so the same
  // seed and route reproduce the same flight. The previous mode is restored on
  // exit by stop().
  const missionStore = useMissionStore.getState();
  if (missionStore.mission.weatherMode !== 'manual') {
    missionStore.setWeatherMode('manual');
  }
  void useMissionStore.getState().refreshWeather();

  const rehearsal = useRehearsalStore.getState();
  rehearsal.setScenarioId(JUDGE_SCENARIO);
  rehearsal.start();
  useRehearsalStore.getState().pushEvent({
    missionS: 0,
    label: 'JUDGE MODE',
    text: `JUDGE MODE: fixed seed ${JUDGE_SEED}; cooling loss on cylinder 3.`,
    tone: 'info',
    tick: true,
  });
}

export const useJudgeStore = create<JudgeStore>((set, get) => ({
  introOpen: false,
  active: false,
  accelerated: false,
  previousScenarioId: null,
  previousSeedInput: null,
  previousWeatherMode: null,

  openIntro: () => set({ introOpen: true }),
  cancelIntro: () => set({ introOpen: false }),

  begin: () => {
    const current = get();
    if (!current.active) {
      set({
        previousScenarioId: useRehearsalStore.getState().scenarioId,
        previousSeedInput: useSimStore.getState().seedInput,
        previousWeatherMode: useMissionStore.getState().mission.weatherMode,
      });
    }
    set({ introOpen: false, active: true, accelerated: false });
    configureRun();
  },

  restart: () => {
    if (!get().active) {
      get().begin();
      return;
    }
    set({ accelerated: false });
    configureRun();
  },

  markAccelerated: () => {
    if (!get().accelerated) set({ accelerated: true });
  },

  stop: () => {
    const current = get();
    if (!current.active) {
      if (current.introOpen) set({ introOpen: false });
      return;
    }

    const rehearsal = useRehearsalStore.getState();
    const sim = useSimStore.getState();
    const missionStore = useMissionStore.getState();

    if (current.previousScenarioId) rehearsal.setScenarioId(current.previousScenarioId);
    if (current.previousSeedInput !== null) sim.setSeedInput(current.previousSeedInput);
    if (!sim.paused) sim.togglePause();

    if (
      current.previousWeatherMode &&
      missionStore.mission.weatherMode !== current.previousWeatherMode
    ) {
      missionStore.setWeatherMode(current.previousWeatherMode);
      void useMissionStore.getState().refreshWeather();
    }

    set({
      introOpen: false,
      active: false,
      accelerated: false,
      previousScenarioId: null,
      previousSeedInput: null,
      previousWeatherMode: null,
    });
  },
}));
