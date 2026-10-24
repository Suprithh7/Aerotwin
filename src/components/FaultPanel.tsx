import { useState } from 'react';
import { useSimStore, type FaultInput } from '../state/store';
import { CHANNELS, CYLINDER_FAULTS_SET } from '../sim/uiMeta';
import {
  ENGINE_FAULT_LABELS,
  SENSOR_FAULT_LABELS,
} from '../sim/faults';
import type { ChannelId, EngineFaultKind, SensorFaultKind } from '../sim/types';

const ENGINE_KINDS = Object.keys(ENGINE_FAULT_LABELS) as EngineFaultKind[];
const SENSOR_KINDS = Object.keys(SENSOR_FAULT_LABELS) as SensorFaultKind[];

export default function FaultPanel() {
  const injectFault = useSimStore((s) => s.injectFault);
  const clearFault = useSimStore((s) => s.clearFault);
  const faults = useSimStore((s) => s.snapshot?.faults ?? []);

  const [scope, setScope] = useState<'engine' | 'sensor'>('engine');
  const [kind, setKind] = useState<EngineFaultKind>('cooling');
  const [sKind, setSKind] = useState<SensorFaultKind>('drift');
  const [cyl, setCyl] = useState(3);
  const [channel, setChannel] = useState<ChannelId>('cht1');
  const [severity, setSeverity] = useState(0.7);
  const [ramp, setRamp] = useState(10);

  const isCylFault = scope === 'engine' && CYLINDER_FAULTS_SET.has(kind);
  const activeKind = scope === 'engine' ? kind : sKind;

  function onInject() {
    const spec: FaultInput = {
      scope,
      kind: activeKind,
      severity,
      rampTime: ramp,
      ...(scope === 'engine' ? (isCylFault ? { cylinder: cyl } : {}) : { channel }),
    };
    injectFault(spec);
  }

  return (
    <div className="border-b border-edge p-3">
      <div className="font-mono text-dim uppercase tracking-wide mb-2">Fault Injection</div>

      <div className="grid grid-cols-[70px_1fr] gap-x-2 gap-y-2 items-center">
        <span className="text-dim">scope</span>
        <div className="flex gap-1">
          {(['engine', 'sensor'] as const).map((sc) => (
            <button
              key={sc}
              className={scope === sc ? 'active' : ''}
              onClick={() => setScope(sc)}
            >
              {sc.toUpperCase()}
            </button>
          ))}
        </div>

        <span className="text-dim">fault</span>
        <select
          value={activeKind}
          onChange={(e) =>
            scope === 'engine'
              ? setKind(e.target.value as EngineFaultKind)
              : setSKind(e.target.value as SensorFaultKind)
          }
        >
          {(scope === 'engine' ? ENGINE_KINDS : SENSOR_KINDS).map((k) => (
            <option key={k} value={k}>
              {(scope === 'engine'
                ? ENGINE_FAULT_LABELS[k]
                : SENSOR_FAULT_LABELS[k]) ?? k}
            </option>
          ))}
        </select>

        {isCylFault && (
          <>
            <span className="text-dim">cylinder</span>
            <div className="flex gap-1">
              {[1, 2, 3, 4].map((c) => (
                <button key={c} className={cyl === c ? 'active' : ''} onClick={() => setCyl(c)}>
                  {c}
                </button>
              ))}
            </div>
          </>
        )}

        {scope === 'sensor' && (
          <>
            <span className="text-dim">channel</span>
            <select value={channel} onChange={(e) => setChannel(e.target.value as ChannelId)}>
              {CHANNELS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                  {c.unit ? ` [${c.unit}]` : ''}
                </option>
              ))}
            </select>
          </>
        )}

        <span className="text-dim">severity</span>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={severity}
            className="flex-1"
            onChange={(e) => setSeverity(Number(e.target.value))}
          />
          <span className="num font-mono w-10 text-right">{severity.toFixed(2)}</span>
        </div>

        <span className="text-dim">ramp, s</span>
        <input
          type="number"
          min={0}
          max={300}
          value={ramp}
          className="w-full font-mono num"
          onChange={(e) => setRamp(Math.max(0, Number(e.target.value)))}
        />
      </div>

      <div className="flex gap-2 mt-3">
        <button className="flex-1 border-steel text-steel" onClick={onInject}>
          INJECT
        </button>
      </div>

      <div className="mt-3">
        <div className="text-dim uppercase tracking-wide mb-1">Active faults</div>
        {faults.length === 0 && <div className="text-dim font-mono">none</div>}
        {faults.map((f) => (
          <div
            key={f.id}
            className="flex items-center gap-2 border-t border-edge py-1"
          >
            <div className="flex-1 min-w-0">
              <div className="truncate">{f.label}</div>
              <div className="num font-mono text-dim">
                sev {f.severity.toFixed(2)} &middot; +{f.elapsed.toFixed(1)}s{' '}
                {!f.ramped && <span className="text-amber">ramping</span>}
              </div>
            </div>
            <button onClick={() => clearFault(f.id)}>CLEAR</button>
          </div>
        ))}
      </div>
    </div>
  );
}
