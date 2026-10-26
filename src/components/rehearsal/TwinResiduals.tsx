import type { ChannelId, ChannelReading } from '../../sim/types';

interface ResidualRow {
  id: ChannelId;
  label: string;
  range: number;
  digits: number;
}

const ROWS: ResidualRow[] = [
  { id: 'cht1', label: 'CHT 1', range: 8, digits: 1 },
  { id: 'cht2', label: 'CHT 2', range: 8, digits: 1 },
  { id: 'cht3', label: 'CHT 3', range: 24, digits: 1 },
  { id: 'cht4', label: 'CHT 4', range: 8, digits: 1 },
  { id: 'oilT', label: 'OIL T', range: 6, digits: 1 },
  { id: 'oilP', label: 'OIL P', range: 0.6, digits: 2 },
  { id: 'boost', label: 'BOOST', range: 8, digits: 1 },
];

export interface TwinResidualsProps {
  readings: Record<ChannelId, ChannelReading> | null;
  affected: ChannelId[];
}

function formatResidual(residual: number | null, digits: number): string {
  if (residual === null) return '--';
  const sign = residual > 0 ? '+' : '';
  return `${sign}${residual.toFixed(digits)}`;
}

export default function TwinResiduals({ readings, affected }: TwinResidualsProps) {
  return (
    <div className="hud-panel w-[248px] px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="panel-title">Twin residual</span>
        <span className="font-mono text-[8px] uppercase tracking-[0.08em] text-ink-3">
          measured - twin
        </span>
      </div>

      <div className="mt-1.5">
        {readings ? (
          ROWS.map((row) => {
            const reading = readings[row.id];
            const residual = reading ? reading.measured - reading.twin : null;
            const frac =
              residual === null
                ? 0
                : Math.max(-1, Math.min(1, residual / row.range));
            const hot = affected.includes(row.id);
            const positive = (residual ?? 0) >= 0;
            return (
              <div
                key={row.id}
                className={`border-t border-rule/60 py-1 ${hot ? 'bg-amber/5' : ''}`}
              >
                <div className="flex items-baseline justify-between gap-2 font-mono text-[10px]">
                  <span className={hot ? 'text-amber' : 'text-ink-3'}>{row.label}</span>
                  <span className={`num ${hot ? 'text-amber' : 'text-ink'}`}>
                    {formatResidual(residual, row.digits)}
                  </span>
                </div>
                <div className="relative mt-0.5 h-1.5 overflow-hidden border border-rule bg-paper">
                  <div className="absolute bottom-0 left-1/2 top-0 w-px bg-rule-strong" />
                  {residual !== null ? (
                    <div
                      className={`absolute top-0 h-full ${positive ? 'bg-amber' : 'bg-steel'}`}
                      style={{
                        left: `${positive ? 50 : 50 + frac * 50}%`,
                        width: `${Math.abs(frac) * 50}%`,
                        transition: 'left 200ms linear, width 200ms linear',
                      }}
                    />
                  ) : null}
                </div>
              </div>
            );
          })
        ) : (
          <div className="border-t border-rule/60 py-2 font-mono text-[10px] text-ink-3">
            Waiting for the first engine sample.
          </div>
        )}
      </div>

      <p className="mt-1 border-t border-rule pt-1 font-mono text-[9px] leading-[12px] text-ink-3">
        Live model error. A growing bar is evidence of a fault the twin did not predict.
      </p>
    </div>
  );
}
