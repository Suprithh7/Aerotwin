import {
  JUDGE_STEPS,
  judgeProgress,
  judgeStatus,
  type JudgeDetection,
  type JudgeTone,
} from '../../rehearsal/judge';
import type { GuardState } from '../../payload/types';

const TONE_COLOR: Record<JudgeTone, string> = {
  info: 'var(--steel)',
  caution: 'var(--amber)',
  alert: 'var(--red)',
};

export interface JudgeCaptionProps {
  simT: number;
  detection: JudgeDetection | null;
  accelerated: boolean;
  guardState: GuardState | null;
  guardReason: string | null;
  securedMB: number;
  onboardMB: number;
  eraseMissionS: number | null;
  onExit: () => void;
}

export default function JudgeCaption({
  simT,
  detection,
  accelerated,
  guardState,
  guardReason,
  securedMB,
  onboardMB,
  eraseMissionS,
  onExit,
}: JudgeCaptionProps) {
  const status = judgeStatus({
    simT,
    detection,
    accelerated,
    guardState,
    guardReason,
    securedMB,
    onboardMB,
    eraseMissionS,
  });
  const color = TONE_COLOR[status.tone];
  const progress = Math.round(judgeProgress(simT) * 100);

  return (
    <div
      className="hud-panel pointer-events-auto w-[560px] max-w-[calc(100vw_-_32px)] border-l-2 px-3 py-2"
      style={{ borderLeftColor: color }}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 font-mono text-[8px] uppercase tracking-[0.08em]">
        {JUDGE_STEPS.map((label, i) => (
          <span
            key={label}
            className={
              i === status.step
                ? 'text-amber'
                : i < status.step
                  ? 'text-txt'
                  : 'text-ink-3'
            }
          >
            {i + 1} {label}
          </span>
        ))}
      </div>

      <div className="mt-1 flex items-baseline gap-2">
        <span
          className="font-mono text-[10px] uppercase tracking-[0.12em]"
          style={{ color }}
        >
          {status.title}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.06em] text-ink-3">
          {accelerated ? 'AUTO 10x' : '1x HOLD'}
        </span>
        <button
          className="ml-auto h-5 border border-edge px-1.5 font-mono text-[9px] uppercase tracking-[0.06em] text-ink-3 hover:border-red hover:text-red"
          onClick={onExit}
        >
          Exit demo
        </button>
      </div>

      <p className="mt-0.5 text-[12px] leading-[17px] text-ink">{status.body}</p>

      <div className="mt-1.5 h-px bg-edge">
        <div
          className="h-full"
          style={{ width: `${progress}%`, backgroundColor: color, transition: 'width 200ms linear' }}
        />
      </div>
    </div>
  );
}
