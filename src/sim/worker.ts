// Simulation Web Worker: runs the 20 Hz model, posts UI state at 10 Hz.
import { Sim } from './sim';
import { HIST_WINDOW_S, SIM_DT } from './constants';
import { Diagnoser, type Diagnosis } from '../diagnosis/diagnose';
import { createSignatureBuilder } from '../diagnosis/signatures';
import type { FaultSpec, HistPoint, Scenario, Snapshot } from './types';

export type WorkerCommand =
  | { cmd: 'config'; seed: number; scenario: Scenario }
  | { cmd: 'speed'; value: number }
  | { cmd: 'pause'; value: boolean }
  | { cmd: 'step' }
  | { cmd: 'inject'; spec: Omit<FaultSpec, 'id' | 'tInject'> }
  | { cmd: 'clear'; id: number }
  | { cmd: 'fuel'; kg: number };

export type WorkerMessage =
  | { type: 'reset' }
  | { type: 'tick'; snapshot: Snapshot; records: HistPoint[]; diagnosis: Diagnosis };

let sim = new Sim({
  seed: 1337,
  scenario: { phase: 'cruise', turbulence: 'none', isaDev: 0, altitude: 3000 },
});
let speed = 1;
let paused = false;
let pendingSteps = 0;
let acc = 0;
let needReset = false;

// The signature library is seeded and scenario-fixed, so it is built once and
// reused across resets. One base job per tick keeps the 10 Hz cadence.
const builder = createSignatureBuilder();
let diagnoser = new Diagnoser(builder.library);

self.onmessage = (e: MessageEvent<WorkerCommand>) => {
  const m = e.data;
  switch (m.cmd) {
    case 'config':
      sim = new Sim({ seed: m.seed >>> 0, scenario: m.scenario });
      // New residuals, so the severity history and projection start over.
      diagnoser = new Diagnoser(builder.library);
      needReset = true;
      break;
    case 'speed':
      speed = m.value;
      break;
    case 'pause':
      paused = m.value;
      break;
    case 'step':
      pendingSteps += 2; // one 10 Hz UI frame worth of sim steps
      break;
    case 'inject':
      sim.injectFault(m.spec);
      break;
    case 'clear':
      sim.clearFault(m.id);
      break;
    case 'fuel':
      sim.setFuelKg(m.kg);
      break;
  }
};

const TICK_MS = 100; // UI update at 10 Hz
setInterval(() => {
  let n: number;
  if (pendingSteps > 0) {
    n = pendingSteps;
    pendingSteps = 0;
  } else if (paused) {
    n = 0;
  } else {
    acc += (TICK_MS / 1000) * speed;
    n = Math.floor(acc / SIM_DT);
    acc -= n * SIM_DT;
    n = Math.min(n, 240); // cap catch-up work per frame
  }
  const records: HistPoint[] = [];
  for (let i = 0; i < n; i++) {
    sim.step();
    const h = sim.historyDue();
    if (h) records.push(h);
  }
  // thin out records at high speed so each post stays small
  const maxPerTick = 60;
  let out = records;
  if (records.length > maxPerTick) {
    const stride = Math.ceil(records.length / maxPerTick);
    out = records.filter((_, i) => i % stride === stride - 1);
    if (records.length && out[out.length - 1] !== records[records.length - 1]) {
      out.push(records[records.length - 1]);
    }
  }
  if (needReset) {
    needReset = false;
    (self as unknown as Worker).postMessage({ type: 'reset' } satisfies WorkerMessage);
  }
  const snapshot = sim.snapshot();
  // drop points older than the chart window
  const cutoff = snapshot.t - HIST_WINDOW_S;
  out = out.filter((r) => r.t >= cutoff);
  if (!builder.finished) builder.step(1);
  diagnoser.setLibrary(builder.library);
  const diagnosis = diagnoser.update(sim.zEwmaVector(), sim.twinVector(), snapshot, builder.finished);
  (self as unknown as Worker).postMessage({
    type: 'tick',
    snapshot,
    records: out,
    diagnosis,
  } satisfies WorkerMessage);
}, TICK_MS);
