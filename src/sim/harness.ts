// Headless simulation harness for tests and calibration.
import { Sim } from './sim';
import { DEFAULT_SCENARIO } from './constants';
import type { ChannelId, FaultSpec, Scenario } from './types';

export interface RunEvent {
  at: number; // sim seconds
  fault?: Omit<FaultSpec, 'id' | 'tInject'>;
}

export interface RunResult {
  sim: Sim;
  final: ReturnType<Sim['snapshot']>;
}

export function runSim(
  opts: {
    seed?: number;
    scenario?: Scenario;
    durationS: number;
    events?: RunEvent[];
  },
): RunResult {
  const sim = new Sim({ seed: opts.seed ?? 42, scenario: opts.scenario ?? DEFAULT_SCENARIO });
  const events = [...(opts.events ?? [])].sort((a, b) => a.at - b.at);
  const nSteps = Math.round(opts.durationS / 0.05);
  let ei = 0;
  for (let i = 0; i < nSteps; i++) {
    while (ei < events.length && events[ei].at <= sim.t + 1e-9 && events[ei].fault) {
      sim.injectFault(events[ei].fault!);
      ei++;
    }
    sim.step();
  }
  return { sim, final: sim.snapshot() };
}

// average of a channel over the last `windowS` seconds of a run
export function settleValue(
  opts: Parameters<typeof runSim>[0],
  channel: ChannelId,
  windowS = 10,
): number {
  const sim = new Sim({
    seed: opts.seed ?? 42,
    scenario: opts.scenario ?? DEFAULT_SCENARIO,
  });
  const events = [...(opts.events ?? [])].sort((a, b) => a.at - b.at);
  const nSteps = Math.round(opts.durationS / 0.05);
  const tailN = Math.max(1, Math.round(windowS / 0.05));
  const tail: number[] = [];
  let ei = 0;
  for (let i = 0; i < nSteps; i++) {
    while (ei < events.length && events[ei].at <= sim.t + 1e-9 && events[ei].fault) {
      sim.injectFault(events[ei].fault!);
      ei++;
    }
    sim.step();
    if (i >= nSteps - tailN) {
      tail.push(sim.snapshot().readings[channel].true);
    }
  }
  return tail.reduce((a, b) => a + b, 0) / tail.length;
}
