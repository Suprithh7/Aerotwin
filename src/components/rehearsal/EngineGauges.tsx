import { thermalColor } from '../../sim/uiMeta';
import { CHT_CAUTION_C, CHT_LIMIT_C, CHT_NOMINAL_C } from '../../sim/limits';
import type { GaugeArc, GaugeId, GaugeSpec } from '../../mission/types';

export interface GaugeReading {
  value: number | null;
  expected: number | null;
}

const START_DEG = 135;
const SWEEP_DEG = 270;
const TONE_COLOR: Record<GaugeArc['tone'], string> = {
  normal: 'var(--ok)',
  caution: 'var(--caution)',
  limit: 'var(--critical)',
};

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function arcPath(fromPct: number, toPct: number, r: number): string {
  const start = polar(50, 50, r, START_DEG + (fromPct / 100) * SWEEP_DEG);
  const end = polar(50, 50, r, START_DEG + (toPct / 100) * SWEEP_DEG);
  const large = ((toPct - fromPct) / 100) * SWEEP_DEG > 180 ? 1 : 0;
  return `M ${start[0].toFixed(2)} ${start[1].toFixed(2)} A ${r} ${r} 0 ${large} 1 ${end[0].toFixed(2)} ${end[1].toFixed(2)}`;
}

function frac(spec: GaugeSpec, value: number): number {
  return Math.max(0, Math.min(1, (value - spec.min) / Math.max(1e-6, spec.max - spec.min)));
}

function Gauge({ spec, reading }: { spec: GaugeSpec; reading: GaugeReading }) {
  const angle = reading.value === null ? null : START_DEG + frac(spec, reading.value) * SWEEP_DEG;
  const notch =
    reading.expected === null ? null : START_DEG + frac(spec, reading.expected) * SWEEP_DEG;
  const valueText =
    reading.value === null ? '--' : reading.value.toFixed(spec.decimals);

  return (
    <div className="flex w-[88px] shrink-0 flex-col items-center">
      <span className="font-mono text-[10px] leading-[13px] text-ink-3">{spec.label}</span>
      <svg viewBox="0 0 100 100" width={88} height={88} role="img" aria-label={`${spec.label} gauge`}>
        <circle cx="50" cy="50" r="47" fill="var(--sheet)" stroke="var(--rule)" />
        {spec.arcs.map((arc, i) => (
          <path
            key={i}
            d={arcPath(frac(spec, arc.from) * 100, frac(spec, arc.to) * 100, 36)}
            fill="none"
            stroke={TONE_COLOR[arc.tone]}
            strokeWidth="4"
            strokeLinecap="butt"
          />
        ))}
        {Array.from({ length: 9 }, (_, i) => {
          const deg = START_DEG + (i / 8) * SWEEP_DEG;
          const a = polar(50, 50, 30, deg);
          const b = polar(50, 50, i % 2 === 0 ? 34 : 32.5, deg);
          return (
            <line
              key={i}
              x1={a[0]}
              y1={a[1]}
              x2={b[0]}
              y2={b[1]}
              stroke="var(--ink-3)"
              strokeWidth="0.8"
            />
          );
        })}
        {notch !== null && (
          <line
            x1={polar(50, 50, 40, notch)[0]}
            y1={polar(50, 50, 40, notch)[1]}
            x2={polar(50, 50, 44.5, notch)[0]}
            y2={polar(50, 50, 44.5, notch)[1]}
            stroke="var(--route)"
            strokeWidth="2"
          />
        )}
        {angle !== null && (
          <>
            <line
              x1="50"
              y1="50"
              x2={polar(50, 50, 25, angle)[0]}
              y2={polar(50, 50, 25, angle)[1]}
              stroke="var(--ink)"
              strokeWidth="1.2"
            />
            <circle cx="50" cy="50" r="2.6" fill="var(--ink)" />
          </>
        )}
      </svg>
      <span className="num mt-0.5 font-mono text-[13px] leading-4 text-ink">{valueText}</span>
      <span className="font-mono text-[9px] leading-[11px] text-ink-3">{spec.unit}</span>
    </div>
  );
}

export default function EngineGauges({
  gauges,
  readings,
  cylinderCht,
}: {
  gauges: Record<GaugeId, GaugeSpec>;
  readings: Record<GaugeId, GaugeReading>;
  cylinderCht: (number | null)[];
}) {
  const order: GaugeId[] = ['rpm', 'cht', 'oilP', 'oilT', 'fuel'];

  return (
    <div className="hud-panel px-3 py-2">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="panel-title">Engine</span>
        <span className="font-mono text-[9px] text-ink-3">needle measured, notch twin</span>
      </div>
      <div className="flex items-stretch gap-3">
        <div className="flex gap-2">
          {order.map((id) => (
            <Gauge key={id} spec={gauges[id]} reading={readings[id]} />
          ))}
        </div>
        <div className="flex flex-col justify-center border-l border-rule pl-3">
          <span className="mb-1 font-mono text-[9px] leading-[11px] text-ink-3">Cylinder CHT</span>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {cylinderCht.map((v, i) => (
              <div key={i} className="flex flex-col">
                <span className="font-mono text-[9px] leading-[11px] text-ink-3">C{i + 1}</span>
                <span
                  className="mt-0.5 h-3 w-8"
                  style={{
                    backgroundColor:
                      v === null
                        ? 'var(--rule)'
                        : thermalColor(v, CHT_NOMINAL_C, CHT_CAUTION_C, CHT_LIMIT_C),
                  }}
                />
                <span className="num font-mono text-[11px] leading-[14px] text-ink">
                  {v === null ? '--' : `${Math.round(v)} C`}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
