import { useEffect } from 'react';
import { JUDGE_SEED } from '../../rehearsal/judge';
import { useJudgeStore } from '../../rehearsal/judgeStore';

const POINTS: { step: string; title: string; body: string }[] = [
  {
    step: '01',
    title: 'Fixed seed',
    body: `Seed ${JUDGE_SEED} drives the same route, weather cells and fault ramp on every run.`,
  },
  {
    step: '02',
    title: 'Fault to twin flag',
    body: 'Cylinder 3 cooling loss; the twin flags the fault while measured CHT stays inside limits.',
  },
  {
    step: '03',
    title: 'Data Guard action',
    body: 'Priority reconnaissance data is offloaded and the mission key is erased over denied territory.',
  },
  {
    step: '04',
    title: 'Evidence card',
    body: 'The debrief exports detection latency, guard outcome and engine-life cost as a PNG or summary.',
  },
];

export default function JudgeIntro() {
  const open = useJudgeStore((s) => s.introOpen);
  const cancelIntro = useJudgeStore((s) => s.cancelIntro);
  const begin = useJudgeStore((s) => s.begin);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelIntro();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, cancelIntro]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="SIH judge mode"
      onClick={cancelIntro}
    >
      <div
        className="w-full max-w-[600px] border border-rule-strong bg-panel shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-baseline gap-3 border-b border-amber/40 bg-amber/5 px-5 py-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-amber">
            SIH judge mode
          </span>
          <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.08em] text-dim">
            Seed {JUDGE_SEED}
          </span>
        </div>

        <div className="px-5 py-4">
          <h2 className="font-mono text-[20px] uppercase leading-6 tracking-[0.04em] text-txt">
            Deterministic evidence run
          </h2>
          <p className="mt-2 text-[13px] leading-5 text-txt">
            A short, repeatable rehearsal that shows the twin detecting a fault before the measured
            limit, Data Guard protecting the reconnaissance payload, and the debrief exporting the
            result as a mission evidence card.
          </p>

          <div className="mt-4 flex flex-col gap-2">
            {POINTS.map((point) => (
              <div key={point.step} className="flex gap-3 border-t border-edge pt-2">
                <span className="font-mono text-[11px] text-amber">{point.step}</span>
                <div className="min-w-0">
                  <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-txt">
                    {point.title}
                  </div>
                  <p className="mt-0.5 text-[11px] leading-4 text-dim">{point.body}</p>
                </div>
              </div>
            ))}
          </div>

          <p className="mt-4 border-t border-edge pt-2 font-mono text-[9px] leading-4 text-dim">
            Runs the mission as currently briefed. Weather is switched to the manual fallback cells
            for determinism and restored when you exit. No existing scenario cards, director tools
            or debrief sections are changed.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-edge px-5 py-3">
          <button
            className="h-9 border border-edge px-4 font-mono text-[11px] uppercase tracking-[0.12em] text-txt hover:border-steel"
            onClick={cancelIntro}
          >
            Cancel
          </button>
          <button
            className="h-9 bg-amber px-5 font-mono text-[11px] uppercase tracking-[0.12em] text-bg"
            onClick={begin}
          >
            Start demo
          </button>
        </div>
      </div>
    </div>
  );
}
