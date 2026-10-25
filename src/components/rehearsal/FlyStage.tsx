import { useEffect, useMemo, useRef, useState } from 'react';
import RehearsalMap from './RehearsalMap';
import DataGuardHud from './DataGuardHud';
import { SyntheticChip } from './StageHeader';
import { useSimStore, type SimStore } from '../../state/store';
import { currentPlan, missionClockPosition, useMissionStore } from '../../mission/missionStore';
import { activeAirfields, useAlternates } from '../../nav/useAlternates';
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
import { groundForPreset, zoneForPreset } from '../../data/zones';
import { thermalColor } from '../../sim/uiMeta';
import {
  CHT_CAUTION_C,
  CHT_LIMIT_C,
  CHT_NOMINAL_C,
} from '../../sim/limits';
import type { Outcome } from '../../rehearsal/types';

const LIMIT_HOLD_MS = 2400;
const TICKER_MS = 8000;

const STATE_COLOR: Record<HudState, string> = {
  NOMINAL: 'text-steel',
  ADVISORY: 'text-amber',
  WARNING: 'text-amber',
  CRITICAL: 'text-red',
};

const VERDICT_COLOR: Record<string, string> = {
  REACHABLE: 'text-steel',
  MARGINAL: 'text-amber',
  'NOT REACHABLE': 'text-red',
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
            <span className="num shrink-0 font-mono text-[12px] text-dim">
              T+{fmtClock(e.missionS)}
            </span>
            <span
              className={`text-[13px] leading-4 ${
                e.tone === 'alert' ? 'text-red' : e.tone === 'caution' ? 'text-amber' : 'text-txt'
              }`}
            >
              {e.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Bar({
  label,
  value,
  max,
  unit,
  digits,
}: {
  label: string;
  value: number | null;
  max: number;
  unit: string;
  digits: number;
}) {
  const pct = value === null ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="grid grid-cols-[62px_minmax(0,1fr)_70px] items-center gap-2">
      <span className="font-mono text-[12px] uppercase tracking-[0.06em] text-dim">{label}</span>
      <div className="h-1.5 border border-edge bg-bg">
        <div className="h-full bg-data" style={{ width: `${pct}%` }} />
      </div>
      <span className="num text-right font-mono text-[13px] text-txt">
        {value === null ? '--' : value.toFixed(digits)} {unit}
      </span>
    </div>
  );
}

export default function FlyStage() {
  const waypoints = useMissionStore((s) => s.waypoints);
  const weather = useMissionStore((s) => s.weather);
  const presetId = useMissionStore((s) => s.routePresetId);
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
  const fields = useMemo(() => activeAirfields(presetId, waypoints), [presetId, waypoints]);

  const [armed, setArmed] = useState(false);
  const [injected, setInjected] = useState(false);
  const [payloadView, setPayloadView] = useState<PayloadView | null>(null);
  const [payloadError, setPayloadError] = useState<string | null>(null);
  const [jammed, setJammed] = useState(false);

  const ctxRef = useRef({ plan, script, waypoints, weather });
  ctxRef.current = { plan, script, waypoints, weather };
  const runRef = useRef<RunState | null>(null);
  const sessionRef = useRef<PayloadSession | null>(null);
  const jammedRef = useRef(false);
  const navRowsRef = useRef<AlternateRow[]>([]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'j' || event.repeat) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      jammedRef.current = !jammedRef.current;
      setJammed(jammedRef.current);
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
      presetId,
      waypoints: ctxRef.current.waypoints,
      plan: ctxRef.current.plan,
      deniedZone: zoneForPreset(presetId),
      groundStation: groundForPreset(presetId),
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
  }, [epochTarget, presetId]);

  const ready = armed && simEpoch >= epochTarget;
  const shownSnap = ready ? snap : null;
  const simT = ready && snap ? Math.min(snap.t, REHEARSAL_SIM_SPAN_S) : 0;
  const missionS = missionClockS(simT, plan.totalS);

  const pos = useMemo(() => {
    if (!ready || missionS <= 0 || waypoints.length < 2) return null;
    const p = missionClockPosition(waypoints, weather, missionS);
    return p ? { lat: p.lat, lon: p.lon, legIndex: p.legIndex } : null;
  }, [ready, missionS, waypoints, weather]);
  const nav = useAlternates(pos, fields);
  const nearest = nav.nearest;
  navRowsRef.current = nav.rows;

  const hud = hudStatus(shownSnap, diagnosis, script, injected);
  const r = shownSnap?.readings;
  const chts = [r?.cht1.measured, r?.cht2.measured, r?.cht3.measured, r?.cht4.measured];
  const hottestCht = chts.every((v) => v === undefined)
    ? null
    : Math.max(...chts.map((v) => v ?? -Infinity));

  return (
    <div className="relative h-full w-full overflow-hidden bg-bg font-sans text-txt">
      <div className="absolute inset-0">
        <RehearsalMap
          waypoints={waypoints}
          weather={weather}
          presetId={presetId}
          clockS={ready ? missionS : null}
          showMarker
          height="100%"
          fitPadding={{ top: 96, right: 380, bottom: 96, left: 120 }}
        />
      </div>

      <div className="pointer-events-none absolute inset-0 z-[4]">
        <div className="absolute left-4 top-4 max-w-[420px]">
          <div className="hud-panel px-3 py-2">
            <div
              className={`font-mono text-[28px] uppercase leading-[32px] tracking-[0.04em] ${STATE_COLOR[hud.state]}`}
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
              <span className="font-mono text-[12px] uppercase leading-4 tracking-[0.06em] text-dim">
                MISSION CLOCK
              </span>
              <span className="num font-mono text-[13px] leading-5 text-txt">
                {fmtClock(missionS)}
              </span>
            </div>
            <button
              className={`h-7 px-2 font-mono text-[12px] uppercase ${
                paused ? 'border-amber text-amber' : 'text-txt'
              }`}
              onClick={togglePause}
            >
              {paused ? 'RESUME' : 'PAUSE'}
            </button>
            <div className="flex gap-1">
              {[1, 10, 60].map((v) => (
                <button
                  key={v}
                  className={`h-7 px-2 font-mono text-[12px] ${
                    speed === v ? 'border-steel text-steel' : 'text-dim'
                  }`}
                  onClick={() => setSpeed(v)}
                >
                  {v}x
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="absolute bottom-8 left-4">
          <div className="hud-panel flex w-[312px] flex-col gap-2 px-3 py-2">
            <div className="grid grid-cols-4 gap-1">
              {chts.map((v, i) => {
                const color =
                  v === undefined
                    ? '#232A33'
                    : thermalColor(v, CHT_NOMINAL_C, CHT_CAUTION_C, CHT_LIMIT_C);
                return (
                  <div
                    key={i}
                    className="flex h-10 flex-col items-center justify-center"
                    style={{ backgroundColor: color }}
                  >
                    <span className="font-mono text-[12px] leading-4 text-bg">C{i + 1}</span>
                    <span className="num font-mono text-[13px] leading-4 text-bg">
                      {v === undefined ? '--' : Math.round(v)} C
                    </span>
                  </div>
                );
              })}
            </div>
            <Bar label="OIL PRESS" value={r ? r.oilP.measured : null} max={6} unit="bar" digits={1} />
            <Bar label="CHT HOT" value={hottestCht} max={CHT_LIMIT_C} unit="C" digits={0} />
            <Bar label="BOOST" value={r ? r.boost.measured : null} max={100} unit="kPa" digits={0} />
          </div>
        </div>

        <div className="absolute right-4 top-[78px]">
          <div className="hud-panel w-[248px] px-3 py-2">
            <div className="font-mono text-[12px] uppercase tracking-[0.06em] text-dim">
              NEAREST LANDING
            </div>
            {nearest ? (
              <>
                <div className="mt-1 flex items-baseline justify-between gap-2">
                  <span className="font-mono text-[13px] tracking-[0.06em] text-txt">
                    {nearest.airfield.icao}
                  </span>
                  <span className={`font-mono text-[12px] ${VERDICT_COLOR[nearest.verdict] ?? 'text-dim'}`}>
                    {nearest.verdict}
                  </span>
                </div>
                <div className="mt-0.5 flex items-baseline justify-between gap-2 font-mono text-[12px] text-dim">
                  <span>
                    <span className="num text-txt">{(nearest.distM / 1000).toFixed(1)}</span> km
                  </span>
                  <span>
                    ETE <span className="num text-txt">{(nearest.eteS / 60).toFixed(1)}</span> min
                  </span>
                </div>
              </>
            ) : (
              <div className="mt-1 font-mono text-[12px] text-dim">ASSESSING</div>
            )}
          </div>
        </div>

        <div className="pointer-events-auto absolute bottom-8 right-4">
          <DataGuardHud
            view={payloadView}
            groundName={groundForPreset(presetId)?.name ?? 'GROUND STATION'}
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

        <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
          <Ticker />
        </div>
      </div>
    </div>
  );
}
