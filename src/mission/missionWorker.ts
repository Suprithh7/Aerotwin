// Monte Carlo mission worker: integrates a chunk of pre-drawn runs faster than
// real time. All randomness (weather realization, growth draw, run seed) is
// decided on the main thread and shipped with the job, so the result set is
// identical whatever chunking the pool uses.
import { planMission, runMission } from './mission';
import type { DegradationItem, RunDrivers } from './mission';
import type { WaypointWeather } from './weather';
import type { Waypoint } from './route';
import type { EngineState } from '../sim/engineModel';

export interface PreDrawnRun {
  index: number;
  weather: WaypointWeather[];
  growthPerH: number;
  seed: number;
}

export interface MissionJob {
  kind: 'runs';
  waypoints: Waypoint[];
  items: DegradationItem[];
  initState: EngineState;
  dt: number;
  runs: PreDrawnRun[];
}

export interface LegSummary {
  timeS: number;
  fuelKg: number;
  maxChtC: number;
  meanPwrKw: number;
  breach: string | null;
}

export interface MissionRunSummary {
  index: number;
  completed: boolean;
  timeS: number;
  fuelUsedKg: number;
  marginKg: number;
  maxChtC: number;
  maxOilTC: number;
  minOilPBar: number;
  maxVib: number;
  endSeverity: number;
  breachChannel: string | null;
  breachLegIndex: number;
  breachT: number;
  legs: LegSummary[];
  drivers: RunDrivers;
}

export type MissionWorkerMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; summaries: MissionRunSummary[] }
  | { type: 'error'; message: string };

export function toSummary(
  r: ReturnType<typeof runMission>,
  index: number,
): MissionRunSummary {
  return {
    index,
    completed: r.completed,
    timeS: r.timeS,
    fuelUsedKg: r.fuelUsedKg,
    marginKg: r.marginKg,
    maxChtC: r.maxChtC,
    maxOilTC: r.maxOilTC,
    minOilPBar: r.minOilPBar,
    maxVib: r.maxVib,
    endSeverity: r.endSeverity,
    breachChannel: r.breach ? r.breach.channel : null,
    breachLegIndex: r.breach ? r.breach.legIndex : -1,
    breachT: r.breach ? r.breach.tS : r.timeS,
    legs: r.legs.map((l) => ({
      timeS: l.timeS,
      fuelKg: l.fuelKg,
      maxChtC: l.maxChtC,
      meanPwrKw: l.meanPwrKw,
      breach: l.breach,
    })),
    drivers: r.drivers,
  };
}

// The pool orchestrator imports the summary mapper from this module, so the
// message handler is only attached when the file really is running as a worker.
if (typeof self !== 'undefined' && typeof (self as unknown as Worker).postMessage === 'function') {
  self.onmessage = (e: MessageEvent<MissionJob>) => {
    const job = e.data;
    if (job.kind !== 'runs') return;
    const post = (m: MissionWorkerMessage) => (self as unknown as Worker).postMessage(m);
    const summaries: MissionRunSummary[] = [];
    try {
      for (let k = 0; k < job.runs.length; k++) {
        const run = job.runs[k];
        summaries.push(
          toSummary(
            runMission({
              plan: planMission(job.waypoints, run.weather),
              items: job.items,
              weather: run.weather,
              initState: job.initState,
              seed: run.seed,
              growthPerH: run.growthPerH,
              dt: job.dt,
              checkLimits: true,
            }),
            run.index,
          ),
        );
        post({ type: 'progress', done: k + 1, total: job.runs.length });
      }
      post({ type: 'done', summaries });
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };
}
