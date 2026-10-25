import { useSimStore } from '../state/store';
import type { Phase, TurbulenceLevel } from '../sim/types';

const PHASE_OPTS: Phase[] = ['takeoff', 'climb', 'cruise', 'loiter', 'descent'];
const TURB_OPTS: TurbulenceLevel[] = ['none', 'light', 'moderate', 'severe'];

export default function ScenarioPanel() {
  const scenario = useSimStore((s) => s.scenario);
  const setScenario = useSimStore((s) => s.setScenario);
  const fuelLoadKg = useSimStore((s) => s.fuelLoadKg);
  const setFuelLoad = useSimStore((s) => s.setFuelLoad);
  const snap = useSimStore((s) => s.snapshot);

  return (
    <div className="p-3">
      <div className="font-mono text-dim uppercase tracking-wide mb-2">Scenario</div>
      <div className="grid grid-cols-[70px_1fr] gap-x-2 gap-y-2 items-center">
        <span className="text-dim">phase</span>
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

        <span className="text-dim">turbulence</span>
        <select
          value={scenario.turbulence}
          onChange={(e) =>
            setScenario({ ...scenario, turbulence: e.target.value as TurbulenceLevel })
          }
        >
          {TURB_OPTS.map((t) => (
            <option key={t} value={t}>
              {t.toUpperCase()}
            </option>
          ))}
        </select>

        <span className="text-dim">ISA dev</span>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={-15}
            max={15}
            step={1}
            value={scenario.isaDev}
            className="flex-1"
            onChange={(e) => setScenario({ ...scenario, isaDev: Number(e.target.value) })}
          />
          <span className="num font-mono w-12 text-right">
            {scenario.isaDev >= 0 ? `+${scenario.isaDev}` : scenario.isaDev} C
          </span>
        </div>

        <span className="text-dim">altitude</span>
        <select
          value={String(scenario.altitude)}
          onChange={(e) => setScenario({ ...scenario, altitude: Number(e.target.value) })}
        >
          {[0, 1500, 3000, 4500, 5400, 6000].map((h) => (
            <option key={h} value={h}>
              {h} m
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3 border-t border-edge pt-2 font-mono num text-dim">
        <div className="flex justify-between">
          <span>OAT</span>
          <span>{snap ? `${snap.oatC.toFixed(1)} C` : '--'}</span>
        </div>
        <div className="flex justify-between">
          <span>DENSITY ALT</span>
          <span>{snap ? `${Math.round(snap.densityAltitude)} m` : '--'}</span>
        </div>
        <div className="flex justify-between">
          <span>SIGMA</span>
          <span>{snap ? snap.sigmaRatio.toFixed(3) : '--'}</span>
        </div>
      </div>

      <div className="mt-3 border-t border-edge pt-2 grid grid-cols-[70px_1fr] gap-x-2 gap-y-2 items-center">
        <span className="text-dim">fuel load</span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step={1}
            value={fuelLoadKg}
            className="w-full font-mono num"
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) setFuelLoad(n);
            }}
          />
          <span className="num font-mono w-20 text-right">
            {snap ? `${snap.readings.fuel.measured.toFixed(1)} kg` : '--'}
          </span>
        </div>
      </div>
      <div className="mt-1 text-dim">
        Fuel load writes the sim state directly and does not restart the run; the
        figure on the right is what the engine reports.
      </div>

      <div className="mt-2 text-dim">
        Scenario changes restart the run (state, time and faults reset; seed kept).
      </div>
    </div>
  );
}
