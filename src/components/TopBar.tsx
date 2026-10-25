import { useEffect, useState } from 'react';
import { useSimStore } from '../state/store';
import type { Phase, TurbulenceLevel } from '../sim/types';

const PHASE_OPTS: Phase[] = ['takeoff', 'climb', 'cruise', 'loiter', 'descent'];
const TURB_OPTS: TurbulenceLevel[] = ['none', 'light', 'moderate', 'severe'];

function fmtClock(t: number): string {
  const s = Math.floor(t);
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// Wall-clock references beside the mission timer: UTC and IST (UTC+05:30).
// These read the host clock, not the simulation (ASSUMPTIONS.md).
function zulu(d: Date, zone: string): string {
  return d.toLocaleTimeString('en-GB', { timeZone: zone, hour12: false });
}

function WorldClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span className="num font-mono text-dim shrink-0">
      {zulu(now, 'UTC')}Z {zulu(now, 'Asia/Kolkata')} IST
    </span>
  );
}

export default function TopBar() {
  const snapshot = useSimStore((s) => s.snapshot);
  const speed = useSimStore((s) => s.speed);
  const paused = useSimStore((s) => s.paused);
  const seedInput = useSimStore((s) => s.seedInput);
  const scenario = useSimStore((s) => s.scenario);
  const setSpeed = useSimStore((s) => s.setSpeed);
  const togglePause = useSimStore((s) => s.togglePause);
  const stepFrame = useSimStore((s) => s.stepFrame);
  const applySeed = useSimStore((s) => s.applySeed);
  const setScenario = useSimStore((s) => s.setScenario);

  return (
    <div className="h-10 shrink-0 border-b border-edge bg-panel flex items-center gap-3 px-3 overflow-x-auto whitespace-nowrap">
      <span className="font-mono font-medium tracking-wide shrink-0">AEROTWIN</span>
      <span className="num font-mono text-dim shrink-0">T+ {fmtClock(snapshot?.t ?? 0)}</span>
      <WorldClock />

      <div className="flex items-center gap-1 ml-2 shrink-0">
        {[1, 10, 60].map((v) => (
          <button
            key={v}
            className={speed === v ? 'active font-mono' : 'font-mono'}
            onClick={() => setSpeed(v)}
          >
            {v}x
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <button className={paused ? 'active' : ''} onClick={togglePause}>
          {paused ? 'RESUME' : 'PAUSE'}
        </button>
        <button onClick={stepFrame} disabled={!paused}>
          STEP
        </button>
      </div>

      <div className="flex items-center gap-1 ml-2 shrink-0">
        <span className="text-dim">SEED</span>
        <input
          className="font-mono w-20 num"
          value={seedInput}
          onChange={(e) => useSimStore.setState({ seedInput: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && applySeed()}
        />
        <button onClick={applySeed}>SET</button>
      </div>

      <div className="flex items-center gap-1 ml-2 shrink-0">
        <span className="text-dim">SCENARIO</span>
        <select
          value={scenario.phase}
          onChange={(e) => setScenario({ ...scenario, phase: e.target.value as Phase })}
        >
          {PHASE_OPTS.map((p) => (
            <option key={p} value={p}>
              {p.toUpperCase()}
            </option>
          ))}
        </select>
        <select
          value={scenario.turbulence}
          onChange={(e) =>
            setScenario({ ...scenario, turbulence: e.target.value as TurbulenceLevel })
          }
        >
          {TURB_OPTS.map((t) => (
            <option key={t} value={t}>
              TURB {t.toUpperCase()}
            </option>
          ))}
        </select>
        <select
          value={String(scenario.isaDev)}
          onChange={(e) => setScenario({ ...scenario, isaDev: Number(e.target.value) })}
        >
          {[-15, -10, -5, 0, 5, 10, 15].map((d) => (
            <option key={d} value={d}>
              ISA {d >= 0 ? `+${d}` : d}
            </option>
          ))}
        </select>
      </div>

      <span className="ml-auto shrink-0 border border-amber text-amber px-2 py-0.5 font-mono uppercase tracking-wide">
        SYNTHETIC DATA - PHYSICS-SIMULATED
      </span>
    </div>
  );
}
