import { useEffect, useMemo, useRef, useState } from 'react';
import RehearsalMap from './RehearsalMap';
import DataGuardHud from './DataGuardHud';
import EngineGauges, { type GaugeReading } from './EngineGauges';
import { SyntheticChip } from './StageHeader';
import { useSimStore, type SimStore } from '../../state/store';
import { currentPlan, missionClockPosition, useMissionStore } from '../../mission/missionStore';
import { resolveWaypoints } from '../../mission/terrain';
import { engineProfileById, type GaugeId } from '../../mission/types';
import { useAlternates } from '../../nav/useAlternates';
import type { AlternateRow } from '../../nav/alternates';
import { useRehearsalStore } from '../../rehearsal/store';
import {
  REHEARSAL_SIM_SPAN_S,
  fmtClock,
  missionClockS,
} from '../../rehearsal/clock';
import { hudStatus, measuredLimit, type HudState } from '../../rehearsal/presentation';
import { buildDebrief, lifeDoseIncrement } from '../../rehearsal/metrics';
import { scriptById } from '../../rehearsal/scripts';
import { PayloadSession } from '../../payload/session';
import type { PayloadView } from '../../payload/types';
import type { Outcome } from '../../rehearsal/types';

const LIMIT_HOLD_MS = 2400;
const TICKER_MS = 8000;

const STATE_COLOR: Record<HudState, string> = {
  NOMINAL: 'var(--ok)',
  ADVISORY: 'var(--caution)',
  WARNING: 'var(--caution)',
  CRITICAL: 'var(--critical)',
};

const VERDICT_MARK: Record<string, string> = {
  REACHABLE: 'var(--ok)',
  MARGINAL: 'var(--caution)',
  'NOT REACHABLE': 'var(--critical)',
};

interface RunState {
  epoch: number;
  armed: boolean;
  injected: boolean;
  finishing: boolean;
  done: boolean;
  flagS: number | null;
  limitS: number | null;
  limitLabel: string | null;
  lifeDose: number;
  lastT: number | null;
  hold: number | null;
}

function newRun(epoch: number): RunState {
  return {
    epoch,
    armed: false,
    injected: false,
    finishing: false,
    done: false,
    flagS: null,
    limitS: null,
    limitLabel: null,
    lifeDose: 0,
    lastT: null,
    hold: null,
  };
}

function hottestTrueCht(snap: NonNullable<SimStore['snapshot']>): number {
  return Math.max(
    snap.readings.cht1.true,
    snap.readings.cht2.true,
    snap.readings.cht3.true,
    snap.readings.cht4.true,
  );
}

function Ticker() {
  const events = useRehearsalStore((s) => s.events);
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 500);
    return () => window.clearInterval(id);
  }, []);

  const now = Date.now();
  const recent = events.filter((e) => now - e.atMs < TICKER_MS).slice(-3);
  if (!recent.length) return null;

  return (
    <div className="hud-panel w-[min(34vw,480px)] px-3 py-2">
      {recent.map((e) => {
        const age = now - e.atMs;
        const opacity = age <= 6500 ? 1 : Math.max(0, 1 - (age - 6500) / 1500);
        return (
          <div
            key={e.id}
            className="flex items-baseline gap-2 py-0.5"
            style={{ opacity, transition: 'opacity 400ms linear' }}
          >
            <span className="num shrink-0 font-mono text-[11px] text-ink-3">
              T+{fmtClock(e.missionS)}
            </span>
            <span
              className="text-[12px] leading-4 text-ink"
              style={{
                borderLeft:
                  e.tone === 'alert'
                    ? '3px solid var(--critical)'
                    : e.tone === 'caution'
                      ? '3px solid var(--caution)'
                      : '3px solid transparent',
                paddingLeft: e.tone === 'info' ? 0 : 6,
              }}
            >
              {e.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function FlyStage() {
  const mission = useMissionStore((s) => s.mission);
  const weather = useMissionStore((s) => s.weather);
  const waypoints = useMemo(() => resolveWaypoints(mission), [mission]);
  const scenarioId = useRehearsalStore((s) => s.scenarioId);
  const epochTarget = useRehearsalStore((s) => s.epochTarget);

  const snap = useSimStore((s) => s.snapshot);
  const diagnosis = useSimStore((s) => s.diagnosis);
  const simEpoch = useSimStore((s) => s.simEpoch);
  const paused = useSimStore((s) => s.paused);
  const speed = useSimStore((s) => s.speed);
  const togglePause = useSimStore((s) => s.togglePause);
  const setSpeed = useSimStore((s) => s.setSpeed);

  const script = useMemo(() => scriptById(scenarioId), [scenarioId]);
  const plan = useMemo(() => currentPlan(waypoints, weather), [waypoints, weather]);

  const [armed, setArmed] = useState(false);
  const [injected, setInjected] = useState(false);
  const [payloadView, setPayloadView] = useState<PayloadView | null>(null);
  const [payloadError, setPayloadError] = useState<string | null>(null);
  const [jammed, setJammed] = useState(false);
  const [follow, setFollow] = useState(false);

  const ctxRef = useRef({ mission, plan, script, waypoints, weather });
  ctxRef.current = { mission, plan, script, waypoints, weather };
  const runRef = useRef<RunState | null>(null);
  const sessionRef = useRef<PayloadSession | null>(null);
  const jammedRef = useRef(false);
  const navRowsRef = useRef<AlternateRow[]>([]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'j') {
        jammedRef.current = !jammedRef.current;
        setJammed(jammedRef.current);
      } else if (key === 'c') {
        setFollow((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Ground truth can finish after a pause or while the player is idle; a slow
  // refresh keeps the adversary verdict and link readout current.
  useEffect(() => {
    const id = window.setInterval(() => {
      const session = sessionRef.current;
      if (session) setPayloadView(session.getView());
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!runRef.current || runRef.current.epoch !== epochTarget) {
      runRef.current = newRun(epochTarget);
    }
    const run = runRef.current;

    let cancelled = false;
    setPayloadView(null);
    setPayloadError(null);
    const scriptJam = Boolean(ctxRef.current.script.jam);
    jammedRef.current = scriptJam;
    setJammed(scriptJam);

    void PayloadSession.create({
      mission: ctxRef.current.mission,
      waypoints: ctxRef.current.waypoints,
      plan: ctxRef.current.plan,
      emit: (event) => {
        useRehearsalStore.getState().pushEvent({
          missionS: event.missionS,
          label: event.label,
          text: event.text,
          tone: event.tone,
          tick: event.tick,
        });
      },
    })
      .then((session) => {
        if (cancelled) {
          session.dispose();
          return;
        }
        sessionRef.current?.dispose();
        sessionRef.current = session;
        setPayloadView(session.getView());
      })
      .catch((err: unknown) => {
        if (!cancelled) setPayloadError(`KEY EXCHANGE FAILED: ${String(err)}`);
      });

    const finish = (outcome: Outcome, missionS: number) => {
      if (run.done) return;
      run.done = true;
      if (run.hold !== null) {
        window.clearTimeout(run.hold);
        run.hold = null;
      }
      const ctx = ctxRef.current;
      const distanceM =
        outcome === 'complete'
          ? ctx.plan.cruiseDistM
          : (missionClockPosition(ctx.waypoints, ctx.weather, missionS)?.distM ?? 0);
      const dataGuard = sessionRef.current?.getDebrief();
      const debrief = buildDebrief({
        outcome,
        plannedS: ctx.plan.totalS,
        missionS,
        flightS: missionS,
        distanceM,
        lifeDoseS: run.lifeDose,
        events: useRehearsalStore.getState().events,
        flagS: run.flagS,
        limitS: run.limitS,
        limitLabel: run.limitLabel,
        sensorOnly: ctx.script.sensorOnly,
        ...(dataGuard ? { dataGuard } : {}),
      });
      useRehearsalStore.getState().finish(debrief);
    };

    const drive = (state: SimStore) => {
      if (run.done || run.finishing) return;
      if (state.simEpoch < run.epoch) return;
      const sn = state.snapshot;
      if (!sn) return;
      if (!run.armed) {
        // A snapshot from before the config reset can still be in the store
        // when the epoch lands; only a fresh run arms the rehearsal.
        if (sn.t > 5) return;
        run.armed = true;
        setArmed(true);
      }

      const ctx = ctxRef.current;
      const total = ctx.plan.totalS;
      if (!(total > 0)) return;
      const t = Math.min(sn.t, REHEARSAL_SIM_SPAN_S);
      const mission = missionClockS(t, total);

      if (run.lastT !== null && t > run.lastT) {
        run.lifeDose += lifeDoseIncrement(t - run.lastT, total, hottestTrueCht(sn));
      }
      run.lastT = t;

      const sc = ctx.script;
      const trigger = sc.triggerFrac === null ? Infinity : sc.triggerFrac * total;
      if (!run.injected && sc.fault && mission >= trigger) {
        const f = sc.fault;
        state.injectFault({
          scope: f.scope,
          kind: f.kind,
          severity: f.severity,
          rampTime: f.rampTime,
          ...(f.cylinder !== undefined ? { cylinder: f.cylinder } : {}),
          ...(f.channel !== undefined ? { channel: f.channel } : {}),
        });
        run.injected = true;
        setInjected(true);
        useRehearsalStore.getState().pushEvent({
          missionS: mission,
          label: 'FAULT INJECTED',
          text:
            sc.id.startsWith('cooling')
              ? `Cylinder ${f.cylinder ?? 3} cooling degraded.`
              : sc.id === 'sensor'
                ? 'CHT 1 sensor drifting high; engine healthy.'
                : 'Fault injected.',
          tone: 'caution',
          tick: true,
        });
      }

      const session = sessionRef.current;
      if (session) {
        session.tick({
          missionS: mission,
          diagnosis: state.diagnosis,
          sensorOnly: sc.sensorOnly,
          snapshot: sn,
          alternates: navRowsRef.current,
          jammed: jammedRef.current,
          forcedLanding: false,
        });
        setPayloadView(session.getView());
      }

      const limit = measuredLimit(sn);
      if (limit) {
        run.finishing = true;
        run.limitS = mission;
        run.limitLabel = limit.channel;
        useRehearsalStore.getState().pushEvent({
          missionS: mission,
          label: limit.channel,
          text: hudStatus(sn, state.diagnosis, sc, run.injected).sentence,
          tone: 'alert',
          tick: true,
        });
        if (!state.paused) state.togglePause();
        run.hold = window.setTimeout(() => finish('aborted', mission), LIMIT_HOLD_MS);
        return;
      }

      if (run.injected && !sc.sensorOnly && run.flagS === null && state.diagnosis.state !== 'NOMINAL') {
        run.flagS = mission;
        useRehearsalStore.getState().pushEvent({
          missionS: mission,
          label: 'TWIN FLAG',
          text: hudStatus(sn, state.diagnosis, sc, run.injected).sentence,
          tone: 'caution',
          tick: true,
        });
      }

      if (t >= REHEARSAL_SIM_SPAN_S) {
        run.finishing = true;
        useRehearsalStore.getState().pushEvent({
          missionS: total,
          label: 'MISSION END',
          text: 'At the planned destination; rehearsal complete.',
          tone: 'info',
          tick: true,
        });
        finish('complete', total);
      }
    };

    const unsub = useSimStore.subscribe(drive);
    drive(useSimStore.getState());
    return () => {
      cancelled = true;
      unsub();
      if (run.hold !== null) {
        window.clearTimeout(run.hold);
        run.hold = null;
      }
      sessionRef.current?.dispose();
      sessionRef.current = null;
    };
  }, [epochTarget, mission.id]);

  const ready = armed && simEpoch >= epochTarget;
  const shownSnap = ready ? snap : null;
  const simT = ready && snap ? Math.min(snap.t, REHEARSAL_SIM_SPAN_S) : 0;
  const missionS = missionClockS(simT, plan.totalS);

  const pos = useMemo(() => {
    if (!ready || missionS <= 0 || waypoints.length < 2) return null;
    const p = missionClockPosition(waypoints, weather, missionS);
    return p ? { lat: p.lat, lon: p.lon, legIndex: p.legIndex } : null;
  }, [ready, missionS, waypoints, weather]);
  const nav = useAlternates(pos, mission);
  const nearest = nav.nearest;
  navRowsRef.current = nav.rows;

  const hud = hudStatus(shownSnap, diagnosis, script, injected);
  const markerTone =
    hud.state === 'CRITICAL' ? 'critical' : hud.state === 'NOMINAL' ? 'nominal' : 'caution';
  const r = shownSnap?.readings;
  const chts = [r?.cht1.measured, r?.cht2.measured, r?.cht3.measured, r?.cht4.measured];
  const twinChts = [r?.cht1.twin, r?.cht2.twin, r?.cht3.twin, r?.cht4.twin];
  const hottestCht = chts.every((v) => v === undefined)
    ? null
    : Math.max(...chts.map((v) => v ?? -Infinity));
  const hottestTwin = twinChts.every((v) => v === undefined)
    ? null
    : Math.max(...twinChts.map((v) => v ?? -Infinity));
  const profile = engineProfileById(mission.engineProfileId);
  const gaugeReadings: Record<GaugeId, GaugeReading> = {
    rpm: { value: r?.rpm.measured ?? null, expected: r?.rpm.twin ?? null },
    cht: { value: hottestCht, expected: hottestTwin },
    oilP: { value: r?.oilP.measured ?? null, expected: r?.oilP.twin ?? null },
    oilT: { value: r?.oilT.measured ?? null, expected: r?.oilT.twin ?? null },
    fuel: { value: r?.fuel.measured ?? null, expected: r?.fuel.twin ?? null },
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-paper font-sans text-ink">
      <div className="absolute inset-0">
        <RehearsalMap
          mission={mission}
          waypoints={waypoints}
          weather={weather}
          clockS={ready ? missionS : null}
          showMarker
          markerTone={markerTone}
          follow={follow}
          height="100%"
          fitPadding={{ top: 120, right: 380, bottom: 220, left: 120 }}
        />
      </div>

      <div className="pointer-events-none absolute inset-0 z-[4]">
        <div className="absolute left-4 top-4 max-w-[420px]">
          <div className="hud-panel px-3 py-2">
            <div
              className="font-mono text-[28px] uppercase leading-[32px] tracking-[0.04em]"
              style={{ color: STATE_COLOR[hud.state] }}
            >
              {hud.state}
            </div>
            <div className="mt-0.5 text-[16px] leading-[22px] text-txt">{hud.sentence}</div>
          </div>
        </div>

        <div className="absolute left-1/2 top-4 -translate-x-1/2">
          <SyntheticChip />
        </div>

        <div className="pointer-events-auto absolute right-4 top-4 flex items-center gap-2">
          <div className="hud-panel flex items-center gap-2 px-3 py-2">
            <div className="flex flex-col">
              <span className="font-mono text-[10px] leading-4 text-ink-3">Mission clock</span>
              <span className="num font-mono text-[13px] leading-5 text-ink">
                {fmtClock(missionS)}
              </span>
            </div>
            <button
              className={`h-7 px-2 font-mono text-[11px] ${paused ? 'active' : ''}`}
              onClick={togglePause}
            >
              {paused ? 'Resume' : 'Pause'}
            </button>
            <div className="flex gap-1">
              {[1, 10, 60].map((v) => (
                <button
                  key={v}
                  className={`h-7 px-2 font-mono text-[11px] ${speed === v ? 'active' : ''}`}
                  onClick={() => setSpeed(v)}
                >
                  {v}x
                </button>
              ))}
            </div>
            <button
              className={`h-7 px-2 font-mono text-[11px] ${follow ? 'active' : ''}`}
              onClick={() => setFollow((v) => !v)}
              aria-pressed={follow}
              title="Toggle camera follow (C)"
            >
              {follow ? 'CAM FOLLOW [C]' : 'CAM FREE [C]'}
            </button>
          </div>
        </div>

        <div className="absolute bottom-8 left-4">
          <EngineGauges
            gauges={profile.gauges}
            readings={gaugeReadings}
            cylinderCht={chts.map((v) => v ?? null)}
          />
        </div>

        <div className="absolute right-4 top-[78px]">
          <div className="hud-panel w-[248px] px-3 py-2">
            <div className="panel-title">Nearest landing</div>
            {nearest ? (
              <>
                <div className="mt-1 flex items-baseline justify-between gap-2">
                  <span className="font-mono text-[13px] tracking-[0.04em] text-ink">
                    {nearest.airfield.icao}
                  </span>
                  <span className="flex items-center gap-1.5 font-mono text-[11px] text-ink">
                    <span
                      className="h-2 w-2"
                      style={{
                        backgroundColor: VERDICT_MARK[nearest.verdict] ?? 'var(--ink-3)',
                      }}
                    />
                    {nearest.verdict}
                  </span>
                </div>
                <div className="mt-0.5 flex items-baseline justify-between gap-2 font-mono text-[11px] text-ink-3">
                  <span>
                    <span className="num text-ink">{(nearest.distM / 1000).toFixed(1)}</span> km
                  </span>
                  <span>
                    ETE <span className="num text-ink">{(nearest.eteS / 60).toFixed(1)}</span> min
                  </span>
                </div>
              </>
            ) : (
              <div className="mt-1 font-mono text-[11px] text-ink-3">Assessing</div>
            )}
          </div>
        </div>

        <div className="pointer-events-auto absolute bottom-8 right-4">
          <DataGuardHud
            view={payloadView}
            groundName="Mission ground station"
            error={payloadError}
            jammed={jammed}
            onToggleJam={() => {
              jammedRef.current = !jammedRef.current;
              setJammed(jammedRef.current);
            }}
            onRemoteZeroize={() => sessionRef.current?.requestRemoteZeroize()}
            onRevealAdversary={() => {
              sessionRef.current?.revealAdversary();
              if (sessionRef.current) setPayloadView(sessionRef.current.getView());
            }}
          />
        </div>

        <div className="absolute left-1/2 top-12 -translate-x-1/2">
          <Ticker />
        </div>
      </div>
    </div>
  );
}
