import { useMemo, useState } from 'react';
import {
  buildEvidence,
  copyEvidenceSummary,
  detectionNote,
  detectionValue,
  downloadEvidenceCard,
  eraseNote,
  eraseValue,
  evidenceLines,
  evidenceNarrative,
  fmtMb,
  recoveryNote,
  recoveryValue,
} from '../../rehearsal/evidence';
import { fmtClock } from '../../rehearsal/clock';
import type { DebriefResult } from '../../rehearsal/types';

export interface EvidenceCardProps {
  debrief: DebriefResult;
  missionName: string;
  scenarioTitle: string;
}

type ExportStatus = 'idle' | 'copied' | 'error';

function Metric({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone: string;
}) {
  return (
    <div className="min-w-0 border-t border-edge pt-2">
      <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-dim">{label}</span>
      <div className={`num mt-0.5 font-mono text-[20px] leading-6 ${tone}`}>{value}</div>
      <div className="mt-0.5 font-mono text-[10px] leading-4 text-dim">{note}</div>
    </div>
  );
}

export default function EvidenceCard({ debrief, missionName, scenarioTitle }: EvidenceCardProps) {
  const data = useMemo(
    () => buildEvidence(debrief, { missionName, scenarioTitle }),
    [debrief, missionName, scenarioTitle],
  );
  const [status, setStatus] = useState<ExportStatus>('idle');
  const [manualCopy, setManualCopy] = useState(false);
  const summary = useMemo(() => evidenceLines(data).join('\n'), [data]);

  const detectionTone =
    data.detectionLatencyS !== null || data.detectionMissionS !== null
      ? 'text-amber'
      : 'text-dim';
  const securedTone = data.hasDataGuard ? 'text-steel' : 'text-dim';
  const eraseTone =
    data.eraseMissionS !== null ? 'text-red' : data.hasDataGuard ? 'text-steel' : 'text-dim';
  const recoveryTone =
    data.recoveryFailed !== null
      ? 'text-ok'
      : data.eraseMissionS !== null
        ? 'text-amber'
        : 'text-dim';

  const onDownload = () => {
    try {
      downloadEvidenceCard(data);
      setStatus('idle');
      setManualCopy(false);
    } catch {
      setStatus('error');
    }
  };

  const onCopy = async () => {
    try {
      await copyEvidenceSummary(data);
      setStatus('copied');
      setManualCopy(false);
    } catch {
      setStatus('error');
      setManualCopy(true);
    }
  };

  return (
    <section className="mt-8 border border-amber/60 bg-panel">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-amber/40 bg-amber/5 px-5 py-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-amber">
          SIH judge mode
        </span>
        <span className="font-mono text-[18px] uppercase tracking-[0.08em] text-txt">
          Mission evidence card
        </span>
        <span className="num ml-auto font-mono text-[11px] text-dim">SEED {data.seed}</span>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-4 px-5 py-4 sm:grid-cols-4">
        <Metric
          label="TWIN DETECTION"
          value={detectionValue(data)}
          note={detectionNote(data)}
          tone={detectionTone}
        />
        <Metric
          label="DATA SECURED"
          value={fmtMb(data.securedMB)}
          note={`${fmtMb(data.collectedMB)} collected, ${fmtMb(data.onboardMB)} onboard`}
          tone={securedTone}
        />
        <Metric
          label="KEY ERASE"
          value={eraseValue(data)}
          note={eraseNote(data)}
          tone={eraseTone}
        />
        <Metric
          label="ADVERSARY RECOVERY"
          value={recoveryValue(data)}
          note={recoveryNote(data)}
          tone={recoveryTone}
        />
      </div>

      <div className="border-t border-edge px-5 py-3">
        <p className="text-[14px] leading-5 text-txt">{data.leadLine}</p>
        <p className="mt-1 font-mono text-[10px] leading-4 text-dim">{evidenceNarrative(data)}</p>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-t border-edge px-5 py-2 font-mono text-[10px] text-dim">
        <span>{data.missionName}</span>
        <span>{data.scenarioTitle}</span>
        <span>Flight {fmtClock(data.flightS)}</span>
        <span>{data.distanceKm.toFixed(1)} km</span>
        <span>Engine life {data.engineLifePct.toFixed(4)} %</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-edge px-5 py-3">
        <button
          className="h-9 bg-steel px-4 font-mono text-[11px] uppercase tracking-[0.12em] text-bg"
          onClick={onDownload}
        >
          Download PNG
        </button>
        <button
          className="h-9 border border-edge px-4 font-mono text-[11px] uppercase tracking-[0.12em] text-txt hover:border-steel"
          onClick={() => void onCopy()}
        >
          Copy summary
        </button>
        {status === 'copied' ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ok">Copied</span>
        ) : null}
        {status === 'error' ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-red">
            {manualCopy ? 'Clipboard blocked' : 'Export failed'}
          </span>
        ) : null}
        <span className="ml-auto max-w-[320px] text-right font-mono text-[9px] leading-[13px] text-dim">
          Synthetic data - physics-simulated. Browser WebCrypto demonstrates the protocol only.
        </span>
      </div>

      {manualCopy ? (
        <div className="border-t border-edge px-5 py-3">
          <div className="font-mono text-[9px] uppercase tracking-[0.08em] text-dim">
            Clipboard blocked in this browser - select the summary to copy
          </div>
          <textarea
            readOnly
            value={summary}
            onFocus={(event) => event.currentTarget.select()}
            className="mt-1 h-28 w-full resize-y border border-edge bg-bg p-2 font-mono text-[10px] leading-4 text-txt"
          />
        </div>
      ) : null}
    </section>
  );
}
