import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import StageHeader from './StageHeader';
import { useRehearsalStore } from '../../rehearsal/store';
import { outcomeHeadline } from '../../rehearsal/metrics';
import { fmtClock, fmtMmSs } from '../../rehearsal/clock';
import { scriptById } from '../../rehearsal/scripts';
import type { Outcome } from '../../rehearsal/types';

const OUTCOME_COLOR: Record<Outcome, string> = {
  complete: 'text-steel',
  aborted: 'text-amber',
  lost: 'text-red',
};

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
    const label = `${tick.label} ${fmtMmSs(tick.missionS)}`;
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
                      <span className="num text-txt">{fmtMmSs(tick.missionS)}</span>
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
