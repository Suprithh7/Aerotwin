import { Fragment, type ReactNode } from 'react';
import {
  WX_PRESET_LIST,
  ROUTE_LIST,
  currentPlan,
  legRiskColor,
  useMissionStore,
} from '../mission/missionStore';
import { CHT_LIMIT_C, MC_MIN_RUNS, OILT_LIMIT_C } from '../mission/constants';
import { TURB_LEVELS } from '../mission/weather';
import type { TurbulenceLevel } from '../sim/types';

// --- formatting: every value here is passed in from the store or the sim -----
function fmtNum(n: number, digits = 1): string {
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}

function fmtSigned(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}`;
}

/** Hours + minutes from seconds; used for whole-mission durations. */
function fmtHM(s: number): string {
  if (!Number.isFinite(s)) return '—';
  const totalMin = Math.round(s / 60);
  return `${Math.floor(totalMin / 60)}h ${String(totalMin % 60).padStart(2, '0')}m`;
}

/** Minutes with one decimal; used for per-leg times (the table column mm). */
function fmtMin(s: number): string {
  return Number.isFinite(s) ? (s / 60).toFixed(1) : '—';
}

/** Bar axis max: the larger of the finite candidate values, never <= 0. */
function axisOf(vals: number[]): number {
  const finite = vals.filter(Number.isFinite);
  const m = finite.length ? Math.max(...finite) : 0;
  return m > 0 ? m : 1;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border border-edge bg-panel">
      <header className="border-b border-edge px-2 py-1 font-mono uppercase tracking-wide text-dim">
        {title}
      </header>
      <div className="p-2">{children}</div>
    </section>
  );
}

/**
 * Controlled number cell backed by the store. An empty field or a non-finite
 * parse never reaches the action: Number('') is 0, so the raw string is checked
 * first to avoid committing a cleared field as a zero.
 */
function NumberCell({
  value,
  min,
  max,
  step,
  onCommit,
  title,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onCommit: (n: number) => void;
  title?: string;
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      value={value}
      min={min}
      max={max}
      step={step}
      title={title}
      className="w-full font-mono num"
      onChange={(e) => {
        const raw = e.target.value;
        if (raw.trim() === '') return;
        const n = Number(raw);
        if (!Number.isFinite(n)) return;
        onCommit(n);
      }}
    />
  );
}

function MetricBar({
  tag,
  value,
  axisMax,
  fill,
  text,
}: {
  tag: string;
  value: number;
  axisMax: number;
  fill: string;
  text: string;
}) {
  const pct = Number.isFinite(value) ? Math.max(0, Math.min(100, (value / axisMax) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 font-mono text-dim">{tag}</span>
      <div className="h-2 flex-1 border border-edge bg-bg">
        <div className={`h-full ${fill}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="num w-24 shrink-0 text-right font-mono">{text}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 border-t border-edge py-1 first:border-t-0">
      <span className="text-dim">{label}</span>
      <span className="num font-mono">{value}</span>
    </div>
  );
}

function verdictClass(verdict: string): string {
  if (verdict === 'GO') return 'border-steel text-steel';
  if (verdict === 'CAUTION') return 'border-amber text-amber';
  return 'border-red text-red';
}

export default function MissionPanel() {
  const waypoints = useMissionStore((s) => s.waypoints);
  const routePresetId = useMissionStore((s) => s.routePresetId);
  const weatherPresetId = useMissionStore((s) => s.weatherPresetId);
  const weather = useMissionStore((s) => s.weather);
  const wxNotice = useMissionStore((s) => s.wxNotice);
  const fetchingWx = useMissionStore((s) => s.fetchingWx);
  const runs = useMissionStore((s) => s.runs);
  const seed = useMissionStore((s) => s.seed);
  const mcRunning = useMissionStore((s) => s.mcRunning);
  const mcDone = useMissionStore((s) => s.mcDone);
  const mcTotal = useMissionStore((s) => s.mcTotal);
  const mcResult = useMissionStore((s) => s.mcResult);
  const mcError = useMissionStore((s) => s.mcError);

  const setRoute = useMissionStore((s) => s.setRoute);
  const setWaypointAlt = useMissionStore((s) => s.setWaypointAlt);
  const setWaypointLoiter = useMissionStore((s) => s.setWaypointLoiter);
  const deleteWaypoint = useMissionStore((s) => s.deleteWaypoint);
  const setWeatherPreset = useMissionStore((s) => s.setWeatherPreset);
  const setWeatherAt = useMissionStore((s) => s.setWeatherAt);
  const fetchLive = useMissionStore((s) => s.fetchLive);
  const setRuns = useMissionStore((s) => s.setRuns);
  const setSeed = useMissionStore((s) => s.setSeed);
  const runMission = useMissionStore((s) => s.runMission);

  // Plan figures come straight from the store's derived plan; nothing invented.
  const plan = currentPlan(waypoints, weather);
  const canRun = !mcRunning && waypoints.length >= 2;
  const progressPct = mcTotal > 0 ? Math.max(0, Math.min(100, (mcDone / mcTotal) * 100)) : 0;

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto bg-bg p-3 font-sans text-txt">
      {/* A. EDITORS */}

      <Section title="Route Preset">
        <div className="flex flex-col gap-1">
          {ROUTE_LIST.map((r) => (
            <button
              key={r.id}
              className={`flex items-baseline justify-between gap-2 text-left ${
                routePresetId === r.id ? 'active' : ''
              }`}
              onClick={() => setRoute(r.id)}
            >
              <span className="font-mono uppercase">{r.name}</span>
              <span className="text-dim">{r.region}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Waypoints">
        <div className="grid grid-cols-[1fr_54px_58px_58px_44px] items-center gap-x-2 gap-y-1 font-mono num">
          <span className="text-dim uppercase">Name / Pos</span>
          <span className="text-dim uppercase">Lat</span>
          <span className="text-dim uppercase">Lon</span>
          <span className="text-dim uppercase">Alt m</span>
          <span className="text-dim uppercase">Loit</span>
          {waypoints.map((w) => (
            <Fragment key={w.id}>
              <span className="truncate uppercase">{w.name}</span>
              <input
                className="w-full font-mono num"
                type="number"
                step={0.0001}
                value={w.lat}
                readOnly
                title="Drag on the map to edit position"
              />
              <input
                className="w-full font-mono num"
                type="number"
                step={0.0001}
                value={w.lon}
                readOnly
                title="Drag on the map to edit position"
              />
              <NumberCell
                value={w.altM}
                min={0}
                step={50}
                title="Leg cruise altitude, m AMSL"
                onCommit={(n) => setWaypointAlt(w.id, n)}
              />
              <NumberCell
                value={w.loiterMin}
                min={0}
                step={5}
                title="Station-keeping hold, minutes"
                onCommit={(n) => setWaypointLoiter(w.id, n)}
              />
            </Fragment>
          ))}
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-dim">Position edits: drag on the map; lat/lon here are read-only.</span>
          <div className="flex gap-1">
            {waypoints.map((w) => (
              <button
                key={`${w.id}-del`}
                disabled={waypoints.length <= 2}
                title={`Delete ${w.name}`}
                onClick={() => deleteWaypoint(w.id)}
              >
                {w.name}
              </button>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Weather">
        <div className="flex flex-wrap gap-1">
          {WX_PRESET_LIST.map((p) => (
            <button
              key={p.id}
              className={weatherPresetId === p.id ? 'active' : ''}
              onClick={() => setWeatherPreset(p.id)}
            >
              {p.name}
            </button>
          ))}
          <button className="border-steel text-steel" disabled={fetchingWx} onClick={() => fetchLive()}>
            {fetchingWx ? 'FETCHING...' : 'FETCH LIVE WEATHER'}
          </button>
        </div>
        {wxNotice && <div className="mt-2 font-mono text-amber">{wxNotice}</div>}

        <div className="mt-2 grid grid-cols-[1fr_48px_52px_52px_84px] items-center gap-x-2 gap-y-1 font-mono num">
          <span className="text-dim uppercase">Point</span>
          <span className="text-dim uppercase">ISA C</span>
          <span className="text-dim uppercase">Wind</span>
          <span className="text-dim uppercase">Dir</span>
          <span className="text-dim uppercase">Turb</span>
          {waypoints.map((w, i) => {
            const cell = weather[i];
            if (!cell) return null;
            return (
              <Fragment key={w.id}>
                <span className="truncate uppercase text-dim">{w.name}</span>
                <NumberCell
                  value={cell.isaDevC}
                  step={0.5}
                  title="ISA deviation, deg C"
                  onCommit={(n) => setWeatherAt(i, { isaDevC: n })}
                />
                <NumberCell
                  value={cell.windSpdMs}
                  min={0}
                  step={0.5}
                  title="Wind speed, m/s"
                  onCommit={(n) => setWeatherAt(i, { windSpdMs: n })}
                />
                <NumberCell
                  value={cell.windDirDeg}
                  min={0}
                  max={360}
                  step={1}
                  title="Wind direction (FROM), deg"
                  onCommit={(n) => setWeatherAt(i, { windDirDeg: n })}
                />
                <select
                  className="w-full font-mono"
                  value={cell.turb}
                  onChange={(e) => setWeatherAt(i, { turb: e.target.value as TurbulenceLevel })}
                >
                  {TURB_LEVELS.map((t) => (
                    <option key={t} value={t}>
                      {t.toUpperCase()}
                    </option>
                  ))}
                </select>
              </Fragment>
            );
          })}
        </div>
      </Section>

      <Section title="Monte Carlo">
        <div className="grid grid-cols-[52px_1fr_52px_1fr] items-center gap-x-2 gap-y-2">
          <span className="text-dim uppercase">runs</span>
          <NumberCell value={runs} min={MC_MIN_RUNS} max={1000} step={50} onCommit={setRuns} />
          <span className="text-dim uppercase">seed</span>
          <NumberCell value={seed} min={0} step={1} onCommit={setSeed} />
        </div>
        <button
          className="mt-2 w-full border-steel text-steel disabled:border-edge disabled:text-dim"
          disabled={!canRun}
          onClick={() => runMission()}
        >
          RUN MISSION RISK
        </button>

        {mcTotal > 0 && (
          <div className="mt-2">
            <div className="h-0.5 w-full bg-edge">
              <div className="h-full bg-steel" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="num mt-1 font-mono text-dim">
              {mcDone}/{mcTotal} RUNS
            </div>
          </div>
        )}

        {mcError && <div className="mt-2 font-mono text-red">{mcError}</div>}

        <div className="mt-3 border-t border-edge pt-2">
          <div className="mb-1 font-mono uppercase tracking-wide text-dim">Plan Summary</div>
          <Stat label="TOTAL MISSION TIME" value={fmtHM(plan.totalS)} />
          <Stat label="CRUISE DISTANCE" value={`${fmtNum(plan.cruiseDistM / 1000, 0)} km`} />
          <Stat label="LOITER TIME" value={fmtHM(plan.loiterS)} />
          <Stat label="MAX ALTITUDE" value={`${fmtNum(plan.maxAltM, 0)} m AMSL`} />
        </div>
      </Section>

      {/* B. RESULTS */}

      {!mcResult ? (
        <Section title="Mission Risk">
          <div className="font-mono text-dim">NO MISSION RUN - SET ROUTE, WEATHER AND SEED</div>
        </Section>
      ) : (
        <>
          <Section title="Verdict">
            <div className="flex items-center gap-3">
              <span
                className={`border px-3 py-1 font-mono uppercase tracking-wide ${verdictClass(
                  mcResult.verdict,
                )}`}
              >
                {mcResult.verdict}
              </span>
              <span className="text-dim uppercase">{mcResult.missionName}</span>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-dim uppercase">P(MISSION COMPLETE)</span>
              <span className="num font-mono text-lg">{(mcResult.completedFrac * 100).toFixed(1)}%</span>
            </div>
            <div className="num mt-1 font-mono text-dim">
              {mcResult.runs} RUNS / SEED {mcResult.seed} / {(mcResult.buildMs / 1000).toFixed(1)} s @ dt{' '}
              {mcResult.dtS} s / {mcResult.workers} WORKERS
            </div>
          </Section>

          <Section title="Per-Leg Risk">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left font-mono num">
                <thead className="uppercase text-dim">
                  <tr>
                    <th className="px-1 py-1 font-normal">Leg</th>
                    <th className="px-1 py-1 font-normal">km</th>
                    <th className="px-1 py-1 font-normal">min</th>
                    <th className="px-1 py-1 font-normal">Alt</th>
                    <th className="px-1 py-1 font-normal">HW</th>
                    <th className="px-1 py-1 font-normal">Risk%</th>
                    <th className="px-1 py-1 font-normal">Limiting</th>
                    <th className="px-1 py-1 font-normal">Swatch</th>
                  </tr>
                </thead>
                <tbody>
                  {mcResult.legs.map((l) => (
                    <tr key={l.index} className="border-t border-edge">
                      <td className="px-1 py-1 uppercase">
                        {l.fromName}&gt;{l.toName}
                      </td>
                      <td className="px-1 py-1">{fmtNum(l.distKm, 0)}</td>
                      <td className="px-1 py-1">{fmtMin(l.timeS)}</td>
                      <td className="px-1 py-1">{fmtNum(l.altM, 0)}</td>
                      <td className="px-1 py-1">{fmtNum(l.headwindMs, 1)}</td>
                      <td className="px-1 py-1">{fmtNum(l.breachFrac * 100, 1)}</td>
                      <td className="px-1 py-1">{l.limitingChannel ?? '—'}</td>
                      <td className="px-1 py-1">
                        <span
                          className="inline-block h-3 w-6 border border-edge align-middle"
                          style={{ backgroundColor: legRiskColor(l.breachFrac) }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Predicted State At Landing">
            <div className="font-mono num">
              <div className="flex justify-between gap-2 border-t border-edge py-1 first:border-t-0">
                <span className="text-dim">PEAK CHT (MEDIAN)</span>
                <span>
                  {fmtNum(mcResult.landing.medChtMaxC, 1)} C{' '}
                  <span className="text-dim">/ LIM {CHT_LIMIT_C} C</span>
                </span>
              </div>
              <Stat label="PEAK CHT (P90)" value={`${fmtNum(mcResult.landing.p90ChtMaxC, 1)} C`} />
              <div className="flex justify-between gap-2 border-t border-edge py-1">
                <span className="text-dim">OIL TEMP (MEDIAN)</span>
                <span>
                  {fmtNum(mcResult.landing.medOilTC, 1)} C{' '}
                  <span className="text-dim">/ LIM {OILT_LIMIT_C} C</span>
                </span>
              </div>
              <Stat label="MIN OIL PRESS (MEDIAN)" value={`${fmtNum(mcResult.landing.medOilPBar, 2)} bar`} />
              <Stat label="FUEL MARGIN (MEDIAN)" value={`${fmtNum(mcResult.landing.medMarginKg, 1)} kg`} />
              <Stat label="FUEL MARGIN (P10)" value={`${fmtNum(mcResult.landing.p10MarginKg, 1)} kg`} />
              <Stat label="END SEVERITY (MEDIAN)" value={fmtNum(mcResult.landing.medEndSeverity, 2)} />
              <Stat label="MISSION TIME (MEDIAN)" value={fmtHM(mcResult.landing.medTimeS)} />
            </div>
          </Section>

          <Section title="Top Contributing Factors">
            {mcResult.factors.length === 0 ? (
              <div className="font-mono text-dim">NO FACTORS - NO FAILURE SAMPLES</div>
            ) : (
              <ol className="font-mono">
                {mcResult.factors.map((f, i) => (
                  <li key={f.label} className="border-t border-edge py-1 first:border-t-0">
                    <div className="flex justify-between gap-2">
                      <span>
                        {i + 1}. {f.label}
                      </span>
                      <span className="num">CORR {fmtSigned(f.corr, 2)}</span>
                    </div>
                    <div className="num text-dim">
                      FAIL {fmtNum(f.meanFail, 1)} {f.unit} / PASS {fmtNum(f.meanPass, 1)} {f.unit}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          <Section title="Healthy vs Current Engine">
            <div className="flex flex-col gap-3">
              {/* Axis max = the relevant published limit, or the larger value for margin. */}
              <div>
                <div className="mb-1 text-dim uppercase">Fuel Margin (kg)</div>
                <div className="flex flex-col gap-1">
                  {mcResult.healthy.completed ? (
                    <MetricBar
                      tag="HLTHY"
                      value={mcResult.healthy.marginKg}
                      axisMax={axisOf([mcResult.healthy.marginKg, mcResult.current.marginKg])}
                      fill="bg-steel"
                      text={`${fmtNum(mcResult.healthy.marginKg, 1)} kg`}
                    />
                  ) : (
                    <div className="num pl-16 font-mono text-amber">
                      HEALTHY BREACH: {mcResult.healthy.breach ?? '—'}
                    </div>
                  )}
                  <MetricBar
                    tag="CURR"
                    value={mcResult.current.marginKg}
                    axisMax={axisOf([mcResult.healthy.marginKg, mcResult.current.marginKg])}
                    fill="bg-amber"
                    text={`${fmtNum(mcResult.current.marginKg, 1)} kg`}
                  />
                </div>
              </div>

              <div>
                <div className="mb-1 text-dim uppercase">Peak CHT (deg C)</div>
                <div className="flex flex-col gap-1">
                  <MetricBar
                    tag="HLTHY"
                    value={mcResult.healthy.maxChtC}
                    axisMax={CHT_LIMIT_C}
                    fill="bg-steel"
                    text={`${fmtNum(mcResult.healthy.maxChtC, 1)} C`}
                  />
                  <MetricBar
                    tag="CURR"
                    value={mcResult.current.maxChtC}
                    axisMax={CHT_LIMIT_C}
                    fill="bg-amber"
                    text={`${fmtNum(mcResult.current.maxChtC, 1)} C`}
                  />
                </div>
              </div>

              <div>
                <div className="mb-1 text-dim uppercase">Oil Temp (deg C)</div>
                <div className="flex flex-col gap-1">
                  <MetricBar
                    tag="HLTHY"
                    value={mcResult.healthy.maxOilTC}
                    axisMax={OILT_LIMIT_C}
                    fill="bg-steel"
                    text={`${fmtNum(mcResult.healthy.maxOilTC, 1)} C`}
                  />
                  <MetricBar
                    tag="CURR"
                    value={mcResult.current.maxOilTC}
                    axisMax={OILT_LIMIT_C}
                    fill="bg-amber"
                    text={`${fmtNum(mcResult.current.maxOilTC, 1)} C`}
                  />
                </div>
              </div>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
