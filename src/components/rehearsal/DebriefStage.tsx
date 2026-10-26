import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import StageHeader from './StageHeader';
import { useRehearsalStore } from '../../rehearsal/store';
import { outcomeHeadline } from '../../rehearsal/metrics';
import { fmtClock } from '../../rehearsal/clock';
import { scriptById } from '../../rehearsal/scripts';
import type { DataGuardDebrief } from '../../payload/types';
import type { DirectorInjectionSummary, Outcome } from '../../rehearsal/types';

const OUTCOME_COLOR: Record<Outcome, string> = {
  complete: 'text-steel',
  aborted: 'text-amber',
  lost: 'text-red',
};

function mb(value: number): string {
  return `${Math.round(value)} MB`;
}

function DataGuardSection({ data }: { data: DataGuardDebrief }) {
  const recovered = data.recovery;
  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
          Data Guard
        </span>
        <span className="num font-mono text-[12px] text-dim">
          {mb(data.collectedMB)} collected
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-6">
        <Meta label="SECURED AT GROUND" value={mb(data.securedMB)} note="SHA-256 verified on receipt" />
        <Meta
          label={data.onboardMB > 0 ? 'ONBOARD' : 'ERASED IF UNSENT'}
          value={mb(data.onboardMB)}
          note={data.onboardMB > 0 ? 'encrypted, key retained' : undefined}
        />
        <Meta
          label="ERASE"
          value={data.eraseMissionS === null ? 'NOT ERASED' : fmtClock(data.eraseMissionS)}
          note={data.eraseMissionS === null ? 'mission key retained' : 'mission clock'}
        />
      </div>

      <div className="mt-5 border-t border-edge pt-3">
        <div className="grid grid-cols-[70px_repeat(4,1fr)] font-mono text-[10px] uppercase tracking-[0.08em] text-dim">
          <span>Priority</span>
          <span className="text-right">Collected</span>
          <span className="text-right">Secured</span>
          <span className="text-right">Onboard</span>
          <span className="text-right">Lost</span>
        </div>
        {data.byPriority.map((p) => (
          <div
            key={p.priority}
            className="grid grid-cols-[70px_repeat(4,1fr)] border-t border-edge/60 font-mono text-[12px] leading-6"
          >
            <span className="text-dim">P{p.priority}</span>
            <span className="num text-right text-txt">{mb(p.collectedMB)}</span>
            <span className="num text-right text-steel">{mb(p.securedMB)}</span>
            <span className="num text-right text-txt">{mb(p.onboardMB)}</span>
            <span className={`num text-right ${p.lostMB > 0 ? 'text-red' : 'text-dim'}`}>
              {mb(p.lostMB)}
            </span>
          </div>
        ))}
        <div className="grid grid-cols-[70px_repeat(4,1fr)] border-t border-edge font-mono text-[12px] leading-6">
          <span className="text-dim">TOTAL</span>
          <span className="num text-right text-txt">{mb(data.collectedMB)}</span>
          <span className="num text-right text-steel">{mb(data.securedMB)}</span>
          <span className="num text-right text-txt">{mb(data.onboardMB)}</span>
          <span className={`num text-right ${data.lostMB > 0 ? 'text-red' : 'text-dim'}`}>
            {mb(data.lostMB)}
          </span>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-1 border-t border-edge pt-3 font-mono text-[11px] leading-[18px]">
        {data.eraseMissionS !== null ? (
          <>
            <span className="uppercase tracking-[0.06em] text-red">
              Adversary recovery: {recovered ? 'failed - key destroyed' : 'pending'}
            </span>
            <span className="text-dim">
              {recovered
                ? `${recovered.failed} of ${recovered.attempted} stored blocks failed authentication after the erase.`
                : 'The recovery attempt has not completed.'}
            </span>
            <span className="text-dim">Reason: {data.eraseReason}</span>
          </>
        ) : (
          <span className="uppercase tracking-[0.06em] text-steel">
            {data.onboardMB > 0
              ? 'No erase - key retained; onboard data is recoverable at a friendly landing.'
              : 'No erase - all collected data reached the ground station.'}
          </span>
        )}
      </div>
    </section>
  );
}

function DirectorSection({ rows }: { rows: DirectorInjectionSummary[] }) {
  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
          Instructor injections
        </span>
        <span className="num font-mono text-[12px] text-dim">
          {rows.length} {rows.length === 1 ? 'event' : 'events'}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-[72px_1fr_120px] font-mono text-[10px] uppercase tracking-[0.08em] text-dim">
        <span>Time</span>
        <span>Injection</span>
        <span className="text-right">Detection</span>
      </div>
      {rows.map((row, i) => (
        <div
          key={`${row.missionS}-${row.label}-${i}`}
          className="grid grid-cols-[72px_1fr_120px] items-baseline border-t border-edge/60 py-1.5 font-mono text-[12px] leading-5"
        >
          <span className="num text-dim">{fmtClock(row.missionS)}</span>
          <span className="flex min-w-0 items-baseline gap-2 text-txt">
            <span className="truncate" title={row.label}>
              {row.label}
            </span>
            {row.surprise ? (
              <span className="shrink-0 border border-amber px-1 font-mono text-[9px] uppercase tracking-[0.08em] text-amber">
                Surprise
              </span>
            ) : null}
          </span>
          <span className="num text-right text-dim">
            {row.scope === 'engine' || row.scope === 'sensor'
              ? row.detectedS === null
                ? 'NOT DETECTED'
                : `+${Math.max(0, Math.round(row.detectedS))} s`
              : '-'}
          </span>
        </div>
      ))}
      <p className="mt-2 font-mono text-[10px] leading-4 text-dim">
        Detection latency is time from injection to the twin announcement, in simulator seconds.
      </p>
    </section>
  );
}

function Meta({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex flex-col gap-1 border-t border-edge pt-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-dim">{label}</span>
      <span className="num font-mono text-[20px] leading-6 text-txt">{value}</span>
      {note ? <span className="num font-mono text-[12px] text-dim">{note}</span> : null}
    </div>
  );
}

const TICK_ROW_H = 16;
const TICK_ROWS = 3;

export default function DebriefStage() {
  const debrief = useRehearsalStore((s) => s.debrief);
  const scenarioId = useRehearsalStore((s) => s.scenarioId);
  const start = useRehearsalStore((s) => s.start);
  const toBrief = useRehearsalStore((s) => s.toBrief);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [trackW, setTrackW] = useState(816);

  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const update = () => setTrackW(Math.max(1, el.clientWidth));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [debrief]);

  if (!debrief) {
    return (
      <div className="flex h-full flex-col bg-bg font-sans text-txt">
        <StageHeader stage="debrief" />
        <div className="flex flex-1 items-center justify-center">
          <div className="hud-panel flex flex-col items-start gap-3 px-5 py-4">
            <span className="font-mono text-[12px] uppercase tracking-[0.1em] text-dim">
              No rehearsal recorded
            </span>
            <button
              className="h-10 border border-edge px-5 font-mono text-[12px] uppercase tracking-[0.14em] text-txt"
              onClick={toBrief}
            >
              NEW MISSION
            </button>
          </div>
        </div>
      </div>
    );
  }

  const totalS = Math.max(1, debrief.plannedS, debrief.flightS);
  const flownPct = Math.max(0, Math.min(100, (debrief.flightS / totalS) * 100));
  const scriptTitle = scriptById(scenarioId).title;
  // The tick labels live above the single event row; close events are stacked
  // into up to three rows so a cluster of faults stays readable.
  const placed: { x0: number; x1: number }[][] = [[], [], []];
  const ticks = debrief.ticks.map((tick) => {
    const pct = Math.max(0, Math.min(100, (tick.missionS / totalS) * 100));
    const label = `${tick.label} ${fmtClock(tick.missionS)}`;
    const w = Math.max(48, label.length * 6.1 + 8);
    const center = (pct / 100) * trackW;
    const preferred = pct > 86 ? center - w : pct < 14 ? center : center - w / 2;
    const x0 = Math.max(0, Math.min(trackW - w, preferred));
    let row = 0;
    for (; row < TICK_ROWS; row++) {
      const clear = placed[row].every((b) => x0 + w + 6 <= b.x0 || x0 >= b.x1 + 6);
      if (clear) break;
    }
    if (row === TICK_ROWS) row = TICK_ROWS - 1;
    placed[row].push({ x0, x1: x0 + w });
    return { tick, pct, row, x0 };
  });

  return (
    <div className="flex h-full flex-col bg-bg font-sans text-txt">
      <StageHeader stage="debrief" />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[880px] flex-col px-8 py-12">
          <div className="flex items-baseline justify-between gap-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
              Rehearsal result
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
              Scenario - {scriptTitle}
            </span>
          </div>

          <h1
            className={`mt-2 font-mono text-[28px] uppercase leading-[34px] tracking-[0.04em] ${
              OUTCOME_COLOR[debrief.outcome]
            }`}
          >
            {outcomeHeadline(debrief.outcome)}
          </h1>
          <p className="mt-2 max-w-[640px] text-[16px] leading-[24px] text-txt">{debrief.leadLine}</p>

          <div className="mt-8 grid grid-cols-3 gap-6">
            <Meta label="FLIGHT TIME" value={fmtClock(debrief.flightS)} />
            <Meta label="DISTANCE FLOWN" value={`${debrief.distanceKm.toFixed(1)} km`} />
            <Meta
              label="ENGINE LIFE USED"
              value={`${debrief.engineLifePct.toFixed(4)} %`}
              note={`${debrief.lifeEqH.toFixed(3)} h equivalent`}
            />
          </div>

          <section className="mt-10">
            <div className="flex items-baseline justify-between gap-4">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
                Mission timeline
              </span>
              <span className="num font-mono text-[12px] text-dim">
                {fmtClock(debrief.flightS)} of {fmtClock(totalS)}
              </span>
            </div>

            <div ref={trackRef} className="relative mt-3 h-[100px]">
              <div className="absolute inset-x-0 top-[68px] h-px bg-edge" />
              <div
                className="absolute left-0 top-[68px] h-px bg-steel"
                style={{ width: `${flownPct}%` }}
              />
              {ticks.map(({ tick, pct, row, x0 }, i) => {
                const end = tick.label === 'MISSION END';
                return (
                  <Fragment key={`${tick.label}-${i}`}>
                    <div
                      className={`absolute top-[52px] h-5 w-px ${end ? 'bg-steel' : 'bg-amber'}`}
                      style={{ left: `${pct}%` }}
                    />
                    <div
                      className="absolute whitespace-nowrap font-mono text-[10px] uppercase leading-4 tracking-[0.08em] text-dim"
                      style={{ left: `${x0}px`, top: `${row * TICK_ROW_H}px` }}
                    >
                      {tick.label}{' '}
                      <span className="num text-txt">{fmtClock(tick.missionS)}</span>
                    </div>
                  </Fragment>
                );
              })}
              <span className="num absolute bottom-0 left-0 font-mono text-[10px] text-dim">
                {fmtClock(0)}
              </span>
              <span className="num absolute bottom-0 right-0 font-mono text-[10px] text-dim">
                {fmtClock(totalS)}
              </span>
            </div>
          </section>

          {debrief.director?.length ? <DirectorSection rows={debrief.director} /> : null}

          {debrief.dataGuard ? <DataGuardSection data={debrief.dataGuard} /> : null}

          <div className="mt-8 flex items-center gap-3 border-t border-edge pt-6">
            <button
              className="h-10 bg-steel px-6 font-mono text-[12px] uppercase tracking-[0.14em] text-bg"
              onClick={start}
            >
              REPLAY
            </button>
            <button
              className="h-10 border border-edge px-6 font-mono text-[12px] uppercase tracking-[0.14em] text-txt hover:border-steel"
              onClick={toBrief}
            >
              NEW MISSION
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
