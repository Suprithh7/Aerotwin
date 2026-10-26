import { useEffect, useMemo, useRef, useState } from 'react';
import RehearsalMap from './RehearsalMap';
import DataGuardHud from './DataGuardHud';
import DirectorPanel from './DirectorPanel';
import EngineGauges, { type GaugeReading } from './EngineGauges';
import JudgeCaption from './JudgeCaption';
import TwinResiduals from './TwinResiduals';
import { SyntheticChip } from './StageHeader';
import { useSimStore, type SimStore } from '../../state/store';
import { currentPlan, missionClockPosition, useMissionStore } from '../../mission/missionStore';
import { resolveWaypoints, terrainElevation } from '../../mission/terrain';
import { engineProfileById, type GaugeId } from '../../mission/types';
import { useAlternates } from '../../nav/useAlternates';
import type { AlternateRow } from '../../nav/alternates';
import { airfieldLabel } from '../../data/airfields';
import { useRehearsalStore } from '../../rehearsal/store';
import {
  REHEARSAL_SIM_SPAN_S,
  fmtClock,
  missionClockS,
} from '../../rehearsal/clock';
import {
  hudRank,
  hudStatus,
  measuredLimit,
  voiceCallout,
  type HudFlags,
  type HudState,
} from '../../rehearsal/presentation';
import { buildDebrief, lifeDoseIncrement } from '../../rehearsal/metrics';
import { scriptById } from '../../rehearsal/scripts';
import {
  JUDGE_FALLBACK_S,
  JUDGE_GUARD_HOLD_S,
  JUDGE_HOLD_S,
  JUDGE_SEED,
  type JudgeDetection,
} from '../../rehearsal/judge';
import { useJudgeStore } from '../../rehearsal/judgeStore';
import { PayloadSession } from '../../payload/session';
import type { PayloadView } from '../../payload/types';
import type { DirectorInjectionSummary, Outcome } from '../../rehearsal/types';
import {
  activeInjectionContext,
  detectionDue,
  dueScheduled,
  payloadLabel,
  useDirectorStore,
  type DirectorPayload,
  type DirectorSource,
  type InjectionRecord,
} from '../../rehearsal/director';
import { cancelSpeech, playChime, speak, unlockAudio } from '../../rehearsal/audio';
import { glideRing as buildGlideRing, glideRingVisible } from '../../rehearsal/glide';
import { wxAt } from '../../mission/mission';
import { PHASES } from '../../sim/constants';
import type { ChannelId, TurbulenceLevel } from '../../sim/types';

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

type FireFn = (
  payload: DirectorPayload,
  source: DirectorSource,
  scheduleId: number | null,
  times?: { missionS?: number; simS?: number },
) => void;

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
  const envScenario = useSimStore((s) => s.scenario);
  const togglePause = useSimStore((s) => s.togglePause);
  const setSpeed = useSimStore((s) => s.setSpeed);

  const script = useMemo(() => scriptById(scenarioId), [scenarioId]);
  const plan = useMemo(() => currentPlan(waypoints, weather), [waypoints, weather]);

  const directorOpen = useDirectorStore((s) => s.open);
  const directorInjections = useDirectorStore((s) => s.injections);
  const directorDetections = useDirectorStore((s) => s.detections);
  const linkMode = useDirectorStore((s) => s.linkMode);
  const judgeActive = useJudgeStore((s) => s.active);
  const judgeAccelerated = useJudgeStore((s) => s.accelerated);

  const [armed, setArmed] = useState(false);
  const [payloadView, setPayloadView] = useState<PayloadView | null>(null);
  const [payloadError, setPayloadError] = useState<string | null>(null);
  const [follow, setFollow] = useState(false);
  const [bannerSeq, setBannerSeq] = useState(0);
  const [attentionSeq, setAttentionSeq] = useState(0);

  const ctxRef = useRef({ mission, plan, script, waypoints, weather });
  ctxRef.current = { mission, plan, script, waypoints, weather };
  const runRef = useRef<RunState | null>(null);
  const sessionRef = useRef<PayloadSession | null>(null);
  const navRowsRef = useRef<AlternateRow[]>([]);
  const prevRankRef = useRef(0);
  const judgeAutoRef = useRef<{ detectedAt: number | null; done: boolean }>({
    detectedAt: null,
    done: false,
  });

  const fireRef = useRef<FireFn>(() => {});

  fireRef.current = (payload, source, scheduleId, times) => {
    const sim = useSimStore.getState();
    const total = ctxRef.current.plan.totalS;
    const simS = times?.simS ?? sim.snapshot?.t ?? 0;
    const liveMission = missionClockS(Math.min(simS, REHEARSAL_SIM_SPAN_S), total);
    const missionS = times?.missionS ?? liveMission;
    const director = useDirectorStore.getState();
    let scope: InjectionRecord['scope'];

    switch (payload.type) {
      case 'engine':
        sim.injectFault({
          scope: 'engine',
          kind: payload.kind,
          severity: payload.severity,
          rampTime: payload.rampTime,
          ...(payload.cylinder !== undefined ? { cylinder: payload.cylinder } : {}),
        });
        scope = 'engine';
        break;
      case 'sensor':
        sim.injectFault({
          scope: 'sensor',
          kind: payload.kind,
          severity: payload.severity,
          rampTime: payload.rampTime,
          channel: payload.channel,
        });
        scope = 'sensor';
        break;
      case 'link': {
        const next =
          payload.action === 'jam'
            ? 'jammed'
            : payload.action === 'degrade'
              ? 'degraded'
              : 'normal';
        director.setLinkMode(next);
        scope = 'link';
        break;
      }
      case 'weather':
        sim.setEnvironment({
          ...(payload.turbulence !== undefined ? { turbulence: payload.turbulence } : {}),
          ...(payload.isaDevC !== undefined ? { isaDev: payload.isaDevC } : {}),
        });
        scope = 'weather';
        break;
    }

    const surprise = source === 'surprise';
    const record = director.addInjection({
      scheduleId,
      missionS: Math.max(0, missionS),
      simS,
      label: payloadLabel(payload),
      scope,
      source,
      surprise,
      ...(payload.type === 'engine'
        ? {
            engineKind: payload.kind,
            ...(payload.cylinder !== undefined ? { cylinder: payload.cylinder } : {}),
          }
        : {}),
      ...(payload.type === 'sensor'
        ? { sensorKind: payload.kind, channel: payload.channel }
        : {}),
    });

    useRehearsalStore.getState().pushEvent({
      missionS: record.missionS,
      label: surprise ? 'SURPRISE' : 'INSTRUCTOR',
      text: `INSTRUCTOR: ${surprise ? 'SURPRISE - ' : ''}${record.label}.`,
      tone: payload.type === 'engine' || payload.type === 'sensor' ? 'caution' : 'info',
      tick: true,
    });
  };

  const active = useMemo(
    () => activeInjectionContext(directorInjections),
    [directorInjections],
  );
  const hudFlags: HudFlags = useMemo(
    () => ({
      sensorOnly: active.sensorOnly,
      ...(active.sensorChannel ? { sensorChannel: active.sensorChannel } : {}),
      injected: active.injected,
    }),
    [active],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'j') {
        const current = useDirectorStore.getState().linkMode;
        fireRef.current(
          { type: 'link', action: current === 'jammed' ? 'restore' : 'jam' },
          'manual',
          null,
        );
      } else if (key === 'c') {
        setFollow((v) => !v);
      } else if (key === 'f') {
        useDirectorStore.getState().toggleOpen();
      } else if (key === 'm') {
        const director = useDirectorStore.getState();
        if (director.soundOn) cancelSpeech();
        director.toggleSound();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Browsers only allow audio after a gesture; arm both chimes and voice on the
  // first pointer or key event, wherever it lands.
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true, capture: true });
    window.addEventListener('keydown', unlock, { once: true, capture: true });
    return () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      cancelSpeech();
    };
  }, []);

  // A new run starts from a clean banner and rank history.
  useEffect(() => {
    prevRankRef.current = 0;
    judgeAutoRef.current = { detectedAt: null, done: false };
    setBannerSeq(0);
    setAttentionSeq(0);
    cancelSpeech();
  }, [epochTarget]);

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
    setArmed(false);
    setPayloadView(null);
    setPayloadError(null);

    const director = useDirectorStore.getState();
    director.resetForRehearsal(ctxRef.current.script, ctxRef.current.plan.totalS);
    director.setOpen(false);
    if (ctxRef.current.script.jam) {
      fireRef.current({ type: 'link', action: 'jam' }, 'scenario', null, {
        missionS: 0,
        simS: 0,
      });
    }

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
      const directorState = useDirectorStore.getState();
      const activeAtFinish = activeInjectionContext(directorState.injections);
      const judgeRun = useJudgeStore.getState().active;
      const directorSummary: DirectorInjectionSummary[] = directorState.injections.map((r) => {
        const detection = directorState.detections.find((d) => d.injectionId === r.id);
        return {
          missionS: r.missionS,
          label: r.label,
          scope: r.scope,
          surprise: r.surprise,
          detectedS: detection?.latencyS ?? null,
          detectedMissionS: detection?.missionS ?? null,
        };
      });
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
        sensorOnly: activeAtFinish.sensorOnly,
        ...(dataGuard ? { dataGuard } : {}),
        ...(directorSummary.length ? { director: directorSummary } : {}),
        ...(judgeRun ? { seed: JUDGE_SEED, judge: true } : {}),
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

      // Mission-clock scheduler: the same due time applies at 1x, 10x and 60x.
      const scheduled = useDirectorStore.getState();
      for (const item of dueScheduled(scheduled.schedule, mission)) {
        scheduled.markFired(item.id);
        fireRef.current(item.payload, item.source, item.id, {
          missionS: item.atS,
          simS: t,
        });
      }

      const after = useDirectorStore.getState();
      const activeNow = activeInjectionContext(after.injections);
      const hudNow = hudStatus(sn, state.diagnosis, {
        sensorOnly: activeNow.sensorOnly,
        ...(activeNow.sensorChannel ? { sensorChannel: activeNow.sensorChannel } : {}),
        injected: activeNow.injected,
      });

      // Detection latency: first twin announcement, or for an instrument fault
      // the first clear separation of the affected channel from the twin.
      for (const injection of after.injections) {
        if (injection.scope !== 'engine' && injection.scope !== 'sensor') continue;
        if (after.detections.some((d) => d.injectionId === injection.id)) continue;
        if (t < injection.simS + 0.2) continue;
        if (!detectionDue(injection, state.diagnosis.state, sn.readings)) continue;
        const detection = after.addDetection({
          injectionId: injection.id,
          missionS: mission,
          simS: t,
        });
        if (!detection) continue;
        if (injection.scope === 'engine' && run.flagS === null) run.flagS = mission;
        const seconds = Math.max(0, Math.round(detection.latencyS));
        useRehearsalStore.getState().pushEvent({
          missionS: mission,
          label: 'DETECTED',
          text: `Detected ${seconds} s after injection. ${hudNow.sentence}`,
          tone: hudNow.state === 'CRITICAL' ? 'alert' : 'caution',
          tick: true,
        });
      }

      // Judge mode holds the flag on screen at 1x, then accelerates so the
      // evidence card does not make the audience wait through the whole route.
      if (useJudgeStore.getState().active) {
        const auto = judgeAutoRef.current;
        if (!auto.done) {
          const firstDetection = useDirectorStore.getState().detections[0];
          if (firstDetection && auto.detectedAt === null) auto.detectedAt = t;
          const held =
            auto.detectedAt !== null &&
            t >= auto.detectedAt + JUDGE_HOLD_S + JUDGE_GUARD_HOLD_S;
          if (held || (!firstDetection && t >= JUDGE_FALLBACK_S)) {
            auto.done = true;
            if (state.speed < 10) state.setSpeed(10);
            useJudgeStore.getState().markAccelerated();
          }
        }
      }

      const session = sessionRef.current;
      if (session) {
        session.tick({
          missionS: mission,
          diagnosis: state.diagnosis,
          sensorOnly: activeNow.sensorOnly,
          snapshot: sn,
          alternates: navRowsRef.current,
          jammed: after.linkMode === 'jammed',
          linkDegraded: after.linkMode === 'degraded',
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
          text: hudNow.sentence,
          tone: 'alert',
          tick: true,
        });
        if (!state.paused) state.togglePause();
        run.hold = window.setTimeout(() => finish('aborted', mission), LIMIT_HOLD_MS);
        return;
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
  const nearestLabel = nearest ? airfieldLabel(nearest.airfield) : null;
  navRowsRef.current = nav.rows;

  const hud = hudStatus(shownSnap, diagnosis, hudFlags);

  const latestHudRef = useRef({ hud, diagnosis, flags: hudFlags });
  latestHudRef.current = { hud, diagnosis, flags: hudFlags };

  useEffect(() => {
    const rank = hudRank(hud.state);
    const previous = prevRankRef.current;
    prevRankRef.current = rank;
    if (rank <= previous) return;
    setBannerSeq((n) => n + 1);
    setAttentionSeq((n) => n + 1);
    if (!useDirectorStore.getState().soundOn) return;
    const latest = latestHudRef.current;
    playChime(rank >= 3 ? 'warning' : 'caution');
    speak(voiceCallout(latest.hud, latest.diagnosis, latest.flags));
  }, [hud.state]);

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

  const affectedCylinders = useMemo(() => {
    const set = new Set(active.affectedCylinders);
    if (hud.state !== 'NOMINAL' && diagnosis.dominant?.cylinder) {
      set.add(diagnosis.dominant.cylinder);
    }
    return [...set];
  }, [active, hud.state, diagnosis]);

  const residualAffected = useMemo(() => {
    const ids = new Set<ChannelId>();
    if (active.sensorChannel) ids.add(active.sensorChannel);
    for (const cylinder of affectedCylinders) {
      ids.add(`cht${cylinder}` as ChannelId);
    }
    return [...ids];
  }, [active, affectedCylinders]);

  const judgeDetection: JudgeDetection | null = directorDetections.length
    ? {
        simS: directorDetections[0].simS,
        missionS: directorDetections[0].missionS,
        latencyS: directorDetections[0].latencyS,
      }
    : null;

  const glide = useMemo(() => {
    if (!ready || !shownSnap || !pos) return null;
    const glideMode = nav.rows.length > 0 && nav.rows[0].mode === 'GLIDE';
    if (!glideRingVisible(hud.state, nav.reachable !== null, glideMode)) return null;
    const w = wxAt(weather, pos.legIndex + 1);
    return buildGlideRing(
      pos.lat,
      pos.lon,
      shownSnap.scenario.altitude,
      terrainElevation(pos.lat, pos.lon),
      w.windDirDeg,
      w.windSpdMs,
      PHASES[shownSnap.phase].airspeedMs,
    );
  }, [ready, shownSnap, pos, hud.state, nav.reachable, nav.rows, weather]);

  const handleInject = (payload: DirectorPayload) => {
    fireRef.current(payload, 'manual', null);
  };
  const handleSchedule = (payload: DirectorPayload, atS: number) => {
    useDirectorStore.getState().addSchedule(payload, atS, 'manual');
  };
  const handleLink = (action: 'jam' | 'restore' | 'degrade') => {
    fireRef.current({ type: 'link', action }, 'manual', null);
  };
  const handleWeather = (patch: { turbulence?: TurbulenceLevel; isaDevC?: number }) => {
    fireRef.current({ type: 'weather', ...patch }, 'manual', null);
  };
  const handleSurprise = () => {
    useDirectorStore.getState().surprise(plan.totalS);
  };

  const exitJudge = () => {
    useJudgeStore.getState().stop();
    useRehearsalStore.getState().toBrief();
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
          glide={glide}
          attentionSeq={attentionSeq}
          follow={follow}
          height="100%"
          fitPadding={{ top: 120, right: 380, bottom: 220, left: 120 }}
        />
      </div>

      <div className="pointer-events-none absolute inset-0 z-[4]">
        <div
          className="absolute left-0 right-0 top-0 h-1"
          style={{ backgroundColor: STATE_COLOR[hud.state] }}
          aria-hidden="true"
        />

        <div className="absolute left-4 top-4 max-w-[420px]">
          <div
            key={`banner-${epochTarget}-${bannerSeq}`}
            className={`hud-panel px-3 py-2 ${
              bannerSeq > 0
                ? `state-banner-flash${hud.state === 'CRITICAL' ? ' state-banner-critical' : ''}`
                : ''
            }`}
            style={{ borderLeft: `3px solid ${STATE_COLOR[hud.state]}` }}
            role="status"
            aria-live="polite"
          >
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
                  disabled={judgeActive && !judgeAccelerated && v !== 1}
                  title={
                    judgeActive && !judgeAccelerated && v !== 1
                      ? 'Judge demo holds 1x until the twin flags the fault'
                      : undefined
                  }
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
            <button
              className={`h-7 px-2 font-mono text-[11px] ${directorOpen ? 'active' : ''}`}
              onClick={() => useDirectorStore.getState().toggleOpen()}
              aria-pressed={directorOpen}
              title="Failure director (F)"
            >
              DIRECTOR [F]
            </button>
          </div>
        </div>

        <div className="absolute bottom-8 left-4">
          <EngineGauges
            gauges={profile.gauges}
            readings={gaugeReadings}
            cylinderCht={chts.map((v) => v ?? null)}
            affectedGauges={active.affectedGauges}
            affectedCylinders={affectedCylinders}
          />
        </div>

        <div className="absolute right-4 top-[78px]">
          <div className="hud-panel w-[248px] px-3 py-2">
            <div className="panel-title">Nearest landing</div>
            {nearest ? (
              <>
                <div className="mt-1 flex items-baseline justify-between gap-2">
                  <span
                    className="min-w-0 truncate font-mono text-[13px] tracking-[0.04em] text-ink"
                    title={nearestLabel ?? undefined}
                  >
                    {nearestLabel}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] text-ink">
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
            {glide ? (
              <div className="mt-1 flex items-baseline justify-between gap-2 border-t border-rule pt-1 font-mono text-[10px] text-ink-3">
                <span>ENGINE-OUT GLIDE</span>
                <span className="num text-critical">
                  {(glide.radiusM / 1000).toFixed(1)} km
                </span>
              </div>
            ) : null}
          </div>
        </div>

        {judgeActive ? (
          <div className="absolute right-4 top-[190px]">
            <TwinResiduals
              readings={shownSnap?.readings ?? null}
              affected={residualAffected}
            />
          </div>
        ) : null}

        <div className="pointer-events-auto absolute bottom-8 right-4">
          <DataGuardHud
            view={payloadView}
            groundName="Mission ground station"
            error={payloadError}
            jammed={linkMode === 'jammed'}
            onToggleJam={() => {
              const current = useDirectorStore.getState().linkMode;
              handleLink(current === 'jammed' ? 'restore' : 'jam');
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

        {judgeActive ? (
          <div className="pointer-events-none absolute left-1/2 top-[130px] -translate-x-1/2">
            <JudgeCaption
              simT={simT}
              detection={judgeDetection}
              accelerated={judgeAccelerated}
              guardState={payloadView?.guard.state ?? null}
              guardReason={payloadView?.guard.reason ?? null}
              securedMB={payloadView?.counters.atGroundMB ?? 0}
              onboardMB={payloadView?.counters.onboardMB ?? 0}
              eraseMissionS={payloadView?.eraseMissionS ?? null}
              onExit={exitJudge}
            />
          </div>
        ) : null}
      </div>

      {directorOpen ? (
        <DirectorPanel
          missionS={missionS}
          linkMode={linkMode}
          turbulence={envScenario.turbulence}
          isaDevC={envScenario.isaDev}
          onClose={() => useDirectorStore.getState().setOpen(false)}
          onInject={handleInject}
          onSchedule={handleSchedule}
          onLink={handleLink}
          onWeather={handleWeather}
          onSurprise={handleSurprise}
        />
      ) : null}
    </div>
  );
}
