// Signature library: offline-in-code, deterministic, seeded.
// For every engine-fault configuration x severity x phase we run the sim from a
// settled state, hold the fault at full severity, and store the time-average of
// the EWMA residual z-vector over a tail window. The live diagnoser compares its
// own EWMA z-vector against these templates, so both sides live in the same
// domain (mean z per channel, CHANNELS order).
import { CHANNELS, SIM_DT } from '../sim/constants';
import { CYLINDER_FAULTS, ENGINE_FAULT_LABELS } from '../sim/faults';
import { Sim } from '../sim/sim';
import type { ChannelId, EngineFaultKind, Phase } from '../sim/types';

export const ENGINE_FAULT_KINDS: EngineFaultKind[] = [
  'misfire',
  'injector',
  'cooling',
  'oil',
  'ignition',
  'turbo',
  'compression',
  'exhaust',
];

// Severities and phases required by the diagnosis spec.
export const SIG_SEVERITIES = [0.3, 0.6, 1.0];
export const SIG_PHASES: Phase[] = ['cruise', 'loiter'];

// Reference operating point the library is built at. The fit uses a free scale
// factor, which absorbs operating-point gain differences (see ASSUMPTIONS.md).
export const SIG_ALTITUDE_M = 3000;
export const SIG_ISA_DEV = 0;

export const SIG_RUN_S = 180; // run length per configuration, sim s
export const SIG_AVG_S = 60; // tail averaging window, sim s
export const SIG_SEED_BASE = 90000; // deterministic seed origin

export const N_CHANNELS = CHANNELS.length;

// The engine model has no inter-cylinder asymmetry, so the signature of a
// cylinder-specific fault on cylinder c is an exact permutation of the
// cylinder-1 signature (CHT/EGT slots swapped). We simulate cylinder 1 only
// and materialise the other three by permutation: 8 base runs per severity
// instead of 23.
const CHT_BASE = CHANNELS.findIndex((c) => c.id === 'cht1');
const EGT_BASE = CHANNELS.findIndex((c) => c.id === 'egt1');

export interface SevTemplate {
  severity: number;
  vec: number[]; // mean EWMA z, CHANNELS order
}

export interface EngineSignature {
  key: string; // `${kind}|${cylinder}` (cylinder 0 = whole engine)
  label: string;
  kind: EngineFaultKind;
  cylinder: number; // 1..4, 0 for oil/turbo/exhaust
  phase: Phase;
  templates: SevTemplate[]; // one per SIG_SEVERITIES, ascending
  sev1: number[]; // physical-mapping template (severity 1.0 mean z)
  peakChannel: ChannelId;
  peakZ: number;
}

export interface SignatureLibrary {
  engine: EngineSignature[];
  byPhase: Record<Phase, EngineSignature[]>;
  index: Record<string, EngineSignature>; // `${phase}|${kind}|${cylinder}`
  runs: number;
  buildMs: number;
}

export function sigIndexKey(phase: Phase, kind: string, cylinder: number): string {
  return `${phase}|${kind}|${cylinder}`;
}

export function sigKey(kind: string, cylinder: number): string {
  return `${kind}|${cylinder}`;
}

export function signatureLabel(kind: string, cylinder: number): string {
  const base = ENGINE_FAULT_LABELS[kind] ?? kind;
  return cylinder > 0 ? `${base} (cyl ${cylinder})` : base;
}

export interface SignatureFilter {
  severities?: number[];
  phases?: Phase[];
  seedBase?: number;
  runS?: number;
  avgS?: number;
}

function meanTailVector(
  kind: EngineFaultKind,
  cylinder: number,
  phase: Phase,
  severity: number,
  seed: number,
  runS: number,
  avgS: number,
): number[] {
  const sim = new Sim({
    seed,
    scenario: { phase, turbulence: 'none', isaDev: SIG_ISA_DEV, altitude: SIG_ALTITUDE_M },
  });
  sim.injectFault({
    scope: 'engine',
    kind,
    cylinder: CYLINDER_FAULTS.has(kind) ? cylinder : undefined,
    severity,
    rampTime: 0,
  });
  const totalSteps = Math.round(runS / SIM_DT);
  const avgSteps = Math.round(avgS / SIM_DT);
  const start = totalSteps - avgSteps;
  const acc = new Array<number>(N_CHANNELS).fill(0);
  for (let i = 0; i < totalSteps; i++) {
    sim.step();
    if (i >= start) {
      const v = sim.zEwmaVector();
      for (let k = 0; k < N_CHANNELS; k++) acc[k] += v[k];
    }
  }
  return acc.map((a) => a / avgSteps);
}

function permuteCylinder(vec: number[], from: number, to: number): number[] {
  if (from === to) return vec.slice();
  const out = vec.slice();
  out[CHT_BASE + to - 1] = vec[CHT_BASE + from - 1];
  out[CHT_BASE + from - 1] = vec[CHT_BASE + to - 1];
  out[EGT_BASE + to - 1] = vec[EGT_BASE + from - 1];
  out[EGT_BASE + from - 1] = vec[EGT_BASE + to - 1];
  return out;
}

function makeSignature(
  kind: EngineFaultKind,
  cylinder: number,
  phase: Phase,
  templates: SevTemplate[],
): EngineSignature {
  const sev1 = templates[templates.length - 1].vec;
  let peak = 0;
  for (let k = 1; k < N_CHANNELS; k++) {
    if (Math.abs(sev1[k]) > Math.abs(sev1[peak])) peak = k;
  }
  return {
    key: sigKey(kind, cylinder),
    label: signatureLabel(kind, cylinder),
    kind,
    cylinder,
    phase,
    templates,
    sev1,
    peakChannel: CHANNELS[peak].id,
    peakZ: sev1[peak],
  };
}

export function emptyLibrary(): SignatureLibrary {
  const byPhase = {} as Record<Phase, EngineSignature[]>;
  for (const p of SIG_PHASES) byPhase[p] = [];
  return { engine: [], byPhase, index: {}, runs: 0, buildMs: 0 };
}

interface BaseJob {
  phase: Phase;
  kind: EngineFaultKind;
}

function baseJobs(phases: Phase[]): BaseJob[] {
  const out: BaseJob[] = [];
  for (const phase of phases) {
    for (const kind of ENGINE_FAULT_KINDS) out.push({ phase, kind });
  }
  return out;
}

export interface BuilderProgress {
  done: number;
  total: number;
  library: SignatureLibrary;
}

/**
 * Incremental builder: call step() repeatedly (e.g. from the worker tick loop)
 * so the UI can show one-time build progress without a long blocking pause.
 * The returned library object is mutated in place as jobs complete.
 */
export interface SignatureBuilder {
  total: number;
  done: number;
  library: SignatureLibrary;
  /** Run base jobs until the count advances by n (or jobs are exhausted). */
  step(n?: number): BuilderProgress;
  finished: boolean;
}

export function createSignatureBuilder(f: SignatureFilter = {}): SignatureBuilder {
  const severities = f.severities ?? SIG_SEVERITIES;
  const phases = f.phases ?? SIG_PHASES;
  const seedBase = f.seedBase ?? SIG_SEED_BASE;
  const runS = f.runS ?? SIG_RUN_S;
  const avgS = f.avgS ?? SIG_AVG_S;

  const lib = emptyLibrary();
  for (const p of phases) if (!lib.byPhase[p]) lib.byPhase[p] = [];
  const jobs = baseJobs(phases);
  const t0 = Date.now();
  let run = 0;
  let done = 0;

  const builder: SignatureBuilder = {
    total: jobs.length,
    done: 0,
    library: lib,
    finished: false,
    step(n = 1): BuilderProgress {
      let remaining = n;
      while (remaining-- > 0 && done < jobs.length) {
        const job = jobs[done++];
        const seeds = severities.map(() => seedBase + run++);
        const baseTemplates: SevTemplate[] = severities.map((sev, i) => ({
          severity: sev,
          vec: meanTailVector(job.kind, 1, job.phase, sev, seeds[i], runS, avgS),
        }));
        const cylinders = CYLINDER_FAULTS.has(job.kind)
          ? [1, 2, 3, 4]
          : [0];
        for (const cyl of cylinders) {
          const templates = baseTemplates.map((t) => ({
            severity: t.severity,
            vec: permuteCylinder(t.vec, 1, cyl),
          }));
          const sig = makeSignature(job.kind, cyl, job.phase, templates);
          lib.engine.push(sig);
          lib.index[sigIndexKey(job.phase, job.kind, cyl)] = sig;
          lib.byPhase[job.phase].push(sig);
        }
        lib.runs = run;
        lib.buildMs = Date.now() - t0;
        builder.done = done;
      }
      builder.finished = done >= jobs.length;
      return { done, total: jobs.length, library: lib };
    },
  };
  return builder;
}

export function buildSignatureLibrary(f: SignatureFilter = {}): SignatureLibrary {
  const b = createSignatureBuilder(f);
  b.step(b.total);
  return b.library;
}

/**
 * Library lookup for a live phase. Signatures exist for cruise and loiter;
 * other phases fall back to the nearer library phase by target rpm, so the
 * shape of the residual vector is the closest available match.
 */
export function signaturesForPhase(lib: SignatureLibrary, phase: Phase): EngineSignature[] {
  const direct = lib.byPhase[phase];
  if (direct && direct.length === 23) return direct;
  const nearest = nearestLibraryPhase(phase);
  return lib.byPhase[nearest] ?? lib.engine;
}

const LIB_PHASE_FALLBACK: Record<Phase, Phase> = {
  takeoff: 'cruise',
  climb: 'cruise',
  cruise: 'cruise',
  loiter: 'loiter',
  descent: 'loiter',
};

export function nearestLibraryPhase(phase: Phase): Phase {
  return LIB_PHASE_FALLBACK[phase] ?? 'cruise';
}

export function channelIndexOf(id: ChannelId): number {
  return CHANNELS.findIndex((c) => c.id === id);
}
