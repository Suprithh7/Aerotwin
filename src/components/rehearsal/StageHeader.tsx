import { Fragment } from 'react';
import type { Stage } from '../../rehearsal/types';

const STEPS: { id: Stage; label: string }[] = [
  { id: 'brief', label: 'BRIEF' },
  { id: 'fly', label: 'FLY' },
  { id: 'debrief', label: 'DEBRIEF' },
];

export function SyntheticChip({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center border border-amber px-2 font-mono text-[10px] uppercase leading-none tracking-[0.08em] text-amber ${className}`}
    >
      SYNTHETIC DATA - PHYSICS-SIMULATED
    </span>
  );
}

export default function StageHeader({ stage }: { stage: 'brief' | 'debrief' }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-6 border-b border-edge bg-panel px-4">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[13px] font-medium tracking-[0.14em]">AEROTWIN</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
          MISSION REHEARSAL
        </span>
      </div>

      <nav
        aria-label="Rehearsal stage"
        className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em]"
      >
        {STEPS.map((s, i) => (
          <Fragment key={s.id}>
            {i > 0 && <span className="text-edge">/</span>}
            <span
              aria-current={s.id === stage ? 'step' : undefined}
              className={s.id === stage ? 'text-txt' : 'text-dim'}
            >
              {s.label}
            </span>
          </Fragment>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
          E ENGINEER
        </span>
        <SyntheticChip />
      </div>
    </header>
  );
}
