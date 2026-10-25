import { useEffect, useMemo } from 'react';
import RehearsalMap from './RehearsalMap';
import StageHeader from './StageHeader';
import { DEFAULT_SCENARIO } from '../../sim/constants';
import { useSimStore } from '../../state/store';
import {
  currentPlan,
  missionInputKey,
  useMissionStore,
} from '../../mission/missionStore';
import { ROUTE_PRESETS, presetById } from '../../mission/route';
import { useRehearsalStore } from '../../rehearsal/store';
import { SCENARIO_SCRIPTS } from '../../rehearsal/scripts';
import { fmtHM } from '../../rehearsal/clock';
import { factorSentence, weatherSentence } from '../../rehearsal/metrics';
import type { ScenarioId } from '../../rehearsal/types';

const PRESET_LINE: Record<string, string> = {
  ladakh: 'Three station-keeping holds in the Indus valley at 5 km.',
  rajasthan: 'Desert transit and holds in high-density-altitude heat.',
  coastal: 'Southbound coastal transit into a strong headwind.',
};

const VERDICT_COLOR: Record<string, string> = {
  GO: 'text-steel',
  CAUTION: 'text-amber',
  'NO-GO': 'text-red',
};

function Verdict({ verdict }: { verdict: string | null }) {
  return (
    <span className={`font-mono text-[26px] leading-[30px] tracking-[0.06em] ${verdict ? VERDICT_COLOR[verdict] ?? 'text-txt' : 'text-dim'}`}>
      {verdict ?? '—'}
    </span>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-edge py-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-dim">{label}</span>
      <span className="num font-mono text-[13px] text-txt">{value}</span>
    </div>
  );
}

export default function BriefStage() {
  const waypoints = useMissionStore((s) => s.waypoints);
  const weather = useMissionStore((s) => s.weather);
  const presetId = useMissionStore((s) => s.routePresetId);
  const weatherPresetId = useMissionStore((s) => s.weatherPresetId);
  const runs = useMissionStore((s) => s.runs);
  const seed = useMissionStore((s) => s.seed);
  const mcRunning = useMissionStore((s) => s.mcRunning);
  const mcDone = useMissionStore((s) => s.mcDone);
  const mcTotal = useMissionStore((s) => s.mcTotal);
  const mcResult = useMissionStore((s) => s.mcResult);
  const mcResultKey = useMissionStore((s) => s.mcResultKey);
  const mcError = useMissionStore((s) => s.mcError);
  const setRoute = useMissionStore((s) => s.setRoute);
  const setWeatherPreset = useMissionStore((s) => s.setWeatherPreset);

  const scenarioId = useRehearsalStore((s) => s.scenarioId);
  const setScenarioId = useRehearsalStore((s) => s.setScenarioId);
  const start = useRehearsalStore((s) => s.start);

  const inputKey = useMemo(
    () => missionInputKey(waypoints, weather, runs, seed),
    [waypoints, weather, runs, seed],
  );
  const plan = useMemo(() => currentPlan(waypoints, weather), [waypoints, weather]);
  const resultCurrent = mcResult !== null && mcResultKey === inputKey;

  // A clean engine is the premise of the brief: reset the run before the
  // automatic risk assessment reads its initial health from the sim.
  useEffect(() => {
    let cancelled = false;
    const sim = useSimStore.getState();
    if (!sim.paused) sim.togglePause();
    const targetEpoch = sim.simEpoch + 1;
    sim.setScenario(DEFAULT_SCENARIO);

    let unsub: (() => void) | null = null;
    const maybeRun = (state: ReturnType<typeof useSimStore.getState>) => {
      if (cancelled || state.simEpoch < targetEpoch) return;
      if (!state.snapshot || state.snapshot.t > 5) return;
      const m = useMissionStore.getState();
      if (missionInputKey(m.waypoints, m.weather, m.runs, m.seed) !== inputKey) return;
      unsub?.();
      unsub = null;
      if (!(m.mcResult && m.mcResultKey === inputKey)) void m.runMission();
    };
    unsub = useSimStore.subscribe(maybeRun);
    maybeRun(useSimStore.getState());
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [presetId, inputKey]);

  const recon = useMemo(() => {
    const home = waypoints[0]?.name;
    const seen = new Set<string>();
    const names: string[] = [];
    for (const w of waypoints.slice(1)) {
      if (w.name === home || seen.has(w.name)) continue;
      seen.add(w.name);
      names.push(w.name);
    }
    return names;
  }, [waypoints]);

  const choosePreset = (id: string) => {
    if (id === presetId) return;
    setRoute(id);
    const p = presetById(id);
    if (p) setWeatherPreset(p.suggestedWeather);
  };

  const risk = resultCurrent ? mcResult : null;
  const progressPct = mcTotal > 0 ? Math.max(0, Math.min(100, (mcDone / mcTotal) * 100)) : 0;

  return (
    <div className="flex h-full flex-col bg-bg font-sans text-txt">
      <StageHeader stage="brief" />

      <div className="grid min-h-0 flex-1 grid-cols-[248px_minmax(0,1fr)_380px]">
        <aside className="flex min-h-0 flex-col overflow-y-auto border-r border-edge bg-panel">
          <div className="px-4 pb-2 pt-4 font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
            Mission presets
          </div>
          <div className="flex flex-col gap-2 px-3 pb-4">
            {ROUTE_PRESETS.map((p) => {
              const active = p.id === presetId;
              return (
                <button
                  key={p.id}
                  aria-pressed={active}
                  onClick={() => choosePreset(p.id)}
                  className={`flex flex-col gap-1 border p-3 text-left ${
                    active ? 'border-steel bg-bg' : 'border-edge bg-bg hover:border-steel'
                  }`}
                >
                  <span className={`font-mono text-[13px] uppercase tracking-[0.08em] ${active ? 'text-steel' : 'text-txt'}`}>
                    {p.name}
                  </span>
                  <span className="text-[12px] leading-4 text-dim">{p.region}</span>
                  <span className="text-[12px] leading-4 text-txt">
                    {PRESET_LINE[p.id] ?? 'Illustrative reconnaissance route.'}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-auto border-t border-edge px-4 py-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
              Weather input
            </div>
            <div className="mt-1 text-[12px] leading-4 text-txt">
              {weatherPresetId.replace('-', ' ').toUpperCase()}
            </div>
          </div>
        </aside>

        <div className="relative min-h-0 min-w-0">
          <RehearsalMap
            waypoints={waypoints}
            weather={weather}
            presetId={presetId}
            height="100%"
            fitPadding={{ top: 48, right: 48, bottom: 48, left: 48 }}
          />
        </div>

        <aside className="flex min-h-0 flex-col border-l border-edge bg-panel">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
              Mission brief
            </div>
            <div className="mt-1 font-mono text-[15px] uppercase tracking-[0.06em]">
              {presetById(presetId)?.name ?? 'CUSTOM ROUTE'}
            </div>
            <div className="mt-0.5 text-[12px] leading-4 text-dim">
              {presetById(presetId)?.region ?? 'Hand-edited waypoint route'}
            </div>

            <div className="mt-3">
              <Meta label="DURATION" value={fmtHM(plan.totalS)} />
              <Meta
                label="RECON ITEMS"
                value={`${recon.length} - ${recon.length ? recon.join(', ') : 'none'}`}
              />
            </div>

            <p className="mt-2 text-[13px] leading-5 text-txt">
              {weatherSentence(weather, weatherPresetId)}
            </p>

            <div className="mt-4 border-t border-edge pt-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
                Mission risk
              </div>
              {mcError ? (
                <div className="mt-2 font-mono text-[12px] leading-4 text-red">{mcError}</div>
              ) : risk ? (
                <>
                  <div className="mt-1 flex items-baseline justify-between gap-3">
                    <Verdict verdict={risk.verdict} />
                    <span className="num font-mono text-[13px] text-data">
                      {(risk.completedFrac * 100).toFixed(1)}% COMPLETE
                    </span>
                  </div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-dim">
                    {risk.runs} RUNS · SEED {risk.seed}
                  </div>
                  <div className="mt-2 flex flex-col gap-1.5">
                    {risk.factors.length === 0 ? (
                      <p className="text-[13px] leading-5 text-dim">
                        {risk.completedFrac >= 1
                          ? 'No failed runs; no factor separated the sample.'
                          : 'No dominant factor in the failed runs.'}
                      </p>
                    ) : (
                      risk.factors.slice(0, 3).map((f) => (
                        <p key={f.label} className="text-[13px] leading-5 text-txt">
                          {factorSentence(f)}
                        </p>
                      ))
                    )}
                  </div>
                </>
              ) : (
                <div className="mt-2">
                  <div className="font-mono text-[13px] uppercase tracking-[0.06em] text-dim">
                    {mcRunning ? 'ASSESSING' : 'NOT ASSESSED'}
                  </div>
                  <div className="mt-1 h-0.5 w-full bg-edge">
                    <div className="h-full bg-steel" style={{ width: `${progressPct}%` }} />
                  </div>
                  <div className="num mt-1 font-mono text-[12px] text-dim">
                    {mcTotal > 0 ? `${mcDone}/${mcTotal} RUNS` : `${runs} RUNS`}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 border-t border-edge pt-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
                Scenario
              </div>
              <div className="mt-2 flex flex-col gap-2">
                {SCENARIO_SCRIPTS.map((script) => {
                  const active = script.id === scenarioId;
                  return (
                    <button
                      key={script.id}
                      aria-pressed={active}
                      onClick={() => setScenarioId(script.id as ScenarioId)}
                      className={`border p-2.5 text-left ${
                        active ? 'border-steel bg-bg' : 'border-edge bg-bg hover:border-steel'
                      }`}
                    >
                      <div className={`font-mono text-[12px] uppercase tracking-[0.08em] ${active ? 'text-steel' : 'text-txt'}`}>
                        {script.title}
                      </div>
                      <div className="mt-1 text-[12px] leading-4 text-dim">{script.blurb}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="shrink-0 border-t border-edge p-4">
            <button
              className="h-10 w-full bg-steel font-mono text-[12px] uppercase tracking-[0.14em] text-bg disabled:border-edge disabled:bg-panel disabled:text-dim"
              disabled={waypoints.length < 2}
              onClick={start}
            >
              RUN REHEARSAL
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
