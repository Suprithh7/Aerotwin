import { useSimStore } from '../state/store';
import { chtColor } from '../sim/uiMeta';
import type { ChannelId } from '../sim/types';

function Readout({
  label,
  value,
  unit,
}: {
  label: string;
  value: number | null;
  unit: string;
}) {
  return (
    <div className="flex justify-between border-t border-edge py-1">
      <span className="text-dim">{label}</span>
      <span className="num font-mono">
        {value === null ? '--' : value.toFixed(value >= 100 ? 0 : 1)} {unit}
      </span>
    </div>
  );
}

const CH: Record<string, ChannelId> = {
  rpm: 'rpm',
  map: 'map',
  boost: 'boost',
  oilT: 'oilT',
  oilP: 'oilP',
};

export default function EngineSchematic() {
  const snap = useSimStore((s) => s.snapshot);
  const r = snap?.readings;

  // boxer layout: cyls 1-2 above the crankcase, 3-4 below (flat)
  const cyls = [
    { id: 1, x: 54, up: true },
    { id: 2, x: 126, up: true },
    { id: 3, x: 54, up: false },
    { id: 4, x: 126, up: false },
  ];

  return (
    <div className="p-3">
      <div className="font-mono text-dim uppercase tracking-wide mb-2">Engine - measured CHT</div>
      <svg viewBox="0 0 220 180" className="w-full" role="img" aria-label="engine schematic">
        {/* crankcase */}
        <rect x="40" y="82" width="140" height="24" fill="#11151A" stroke="#232A33" />
        <text x="110" y="97" textAnchor="middle" fill="#93A0B0" fontSize="8" fontFamily="IBM Plex Mono">
          CRANK / TURBO
        </text>
        {/* intake/exhaust stubs */}
        <line x1="180" y1="94" x2="205" y2="94" stroke="#232A33" />
        <text x="206" y="90" fill="#93A0B0" fontSize="6" fontFamily="IBM Plex Mono" textAnchor="end">
          EXH
        </text>
        {cyls.map((c) => {
          const cht = r ? r[(`cht${c.id}`) as ChannelId].measured : null;
          const headY = c.up ? 40 : 130;
          const barrelY = c.up ? 58 : 106;
          const labelY = c.up ? 30 : 162;
          const valY = c.up ? 22 : 172;
          return (
            <g key={c.id}>
              {/* barrel */}
              <rect
                x={c.x}
                y={barrelY}
                width={30}
                height={24}
                fill={cht === null ? '#232A33' : chtColor(cht)}
                stroke="#232A33"
              />
              {/* head */}
              <rect
                x={c.x}
                y={headY}
                width={30}
                height={18}
                fill={cht === null ? '#232A33' : chtColor(cht)}
                stroke="#232A33"
              />
              <text
                x={c.x + 15}
                y={labelY}
                textAnchor="middle"
                fill="#D7DEE7"
                fontSize="8"
                fontFamily="IBM Plex Mono"
              >
                C{c.id}
              </text>
              <text
                x={c.x + 15}
                y={valY}
                textAnchor="middle"
                fill="#93A0B0"
                fontSize="7.5"
                fontFamily="IBM Plex Mono"
              >
                {cht === null ? '--' : `${Math.round(cht)}C`}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1">
        <Readout label="RPM" value={r ? r[CH.rpm].measured : null} unit="rpm" />
        <Readout label="MAP" value={r ? r[CH.map].measured : null} unit="kPa" />
        <Readout label="BOOST" value={r ? r[CH.boost].measured : null} unit="kPa" />
        <Readout label="OIL TEMP" value={r ? r[CH.oilT].measured : null} unit="C" />
        <Readout label="OIL PRESS" value={r ? r[CH.oilP].measured : null} unit="bar" />
        <Readout
          label="SHAFT POWER"
          value={r ? r.pwr.measured : null}
          unit="kW"
        />
        <Readout label="FUEL FLOW" value={r ? r.ff.measured : null} unit="kg/h" />
        <Readout label="FUEL REMAIN" value={r ? r.fuel.measured : null} unit="kg" />
        <Readout label="VIBRATION" value={r ? r.vib.measured : null} unit="mm/s" />
      </div>
    </div>
  );
}
