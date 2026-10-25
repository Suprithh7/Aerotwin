import { useSimStore } from '../state/store';
import { ANOMALY_MAG, type DiagState } from '../diagnosis/diagnose';
import { RUL_CAP_S } from '../diagnosis/rul';

const STATE_CLASS: Record<DiagState, string> = {
  NOMINAL: 'border-steel text-steel',
  WARNING: 'border-amber text-amber',
  CRITICAL: 'border-red text-red',
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 border-t border-edge py-1 first:border-t-0">
      <span className="text-dim">{label}</span>
      <span className="num font-mono">{value}</span>
    </div>
  );
}

/** Minutes from seconds; the horizon the crew reads degradation in. */
function fmtMin(s: number | null): string {
  if (s === null || !Number.isFinite(s)) return '—';
  return `${(s / 60).toFixed(1)} min`;
}

export default function DiagnosisPanel() {
  const d = useSimStore((s) => s.diagnosis);
  const rul = d.rul;

  return (
    <div className="border-b border-edge p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-mono text-dim uppercase tracking-wide">Diagnosis</span>
        <span className={`border px-2 py-0.5 font-mono uppercase tracking-wide ${STATE_CLASS[d.state]}`}>
          {d.state}
        </span>
      </div>

      {!d.ready && <div className="font-mono text-amber">{d.libraryNote}</div>}

      {d.ready && (
        <div className="font-mono num text-[11px]">
          <Row label="FAULT" value={d.dominant?.label ?? '—'} />
          <Row label="SEVERITY" value={d.dominant ? d.severity.toFixed(2) : '—'} />
          <Row label="CONFIDENCE" value={d.dominant ? d.confidence.toFixed(2) : '—'} />
          <Row label="RESIDUAL RMS" value={`${d.anomaly.toFixed(2)} Z (THRESH ${ANOMALY_MAG})`} />
          {d.candidates.length > 1 && (
            <div className="mt-1 border-t border-edge pt-1">
              <div className="text-dim uppercase">Other candidates</div>
              {d.candidates.slice(1).map((c) => (
                <div key={c.key} className="flex justify-between gap-2">
                  <span className="truncate">{c.label}</span>
                  <span>
                    {c.severity.toFixed(2)} / {c.confidence.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 border-t border-edge pt-1">
            <div className="text-dim uppercase">Remaining useful life</div>
            {!rul || rul.status !== 'OK' ? (
              <div className="text-dim">
                {rul?.note ?? 'NO PROJECTION'}{' '}
                {rul ? `(${rul.samples} SAMPLES, ${(rul.spanS / 60).toFixed(0)} MIN)` : ''}
              </div>
            ) : (
              <>
                <Row label="MODEL" value={rul.model ?? '—'} />
                <Row label="GROWTH" value={`${rul.slopePerHour.toFixed(2)} SEV/H`} />
                <Row label="MEDIAN" value={rul.beyondCap ? `> ${RUL_CAP_S / 60} MIN` : fmtMin(rul.medianS)} />
                <Row label="P10" value={fmtMin(rul.p10S)} />
                <Row label="P90" value={fmtMin(rul.p90S)} />
                <Row
                  label="BINDS ON"
                  value={rul.binding ? `${rul.binding.label} ${rul.binding.limit.toFixed(1)} ${rul.binding.unit}` : '—'}
                />
              </>
            )}
          </div>
          <div className={`mt-2 border-t border-edge pt-1 ${d.state === 'NOMINAL' ? 'text-dim' : ''}`}>{d.note}</div>
        </div>
      )}
    </div>
  );
}
