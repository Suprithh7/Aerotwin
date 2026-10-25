import { useState } from 'react';
import { fmtClock } from '../../rehearsal/clock';
import type {
  GuardState,
  LinkState,
  PayloadItemView,
  PayloadView,
} from '../../payload/types';

const LINK_COLOR: Record<LinkState, string> = {
  UP: 'text-steel',
  DEGRADED: 'text-amber',
  LOST: 'text-red',
  JAMMED: 'text-red',
};

const GUARD_COLOR: Record<GuardState, string> = {
  MONITOR: 'text-steel',
  OFFLOAD_PRIORITY: 'text-amber',
  STANDBY: 'text-steel',
  ARMED: 'text-amber',
  ZEROIZED: 'text-red',
};

const STATUS_COLOR: Record<PayloadItemView['status'], string> = {
  ONBOARD: 'text-txt',
  SENDING: 'text-amber',
  AT_GROUND: 'text-steel',
  ERASED: 'text-red',
};

export interface DataGuardHudProps {
  view: PayloadView | null;
  groundName: string;
  error?: string | null;
  jammed: boolean;
  onToggleJam: () => void;
  onRemoteZeroize: () => void;
  onRevealAdversary: () => void;
}

function Mb({ value }: { value: number | undefined }) {
  return <>{value === undefined ? '--' : String(Math.round(value))}</>;
}

export default function DataGuardHud({
  view,
  groundName,
  error,
  jammed,
  onToggleJam,
  onRemoteZeroize,
  onRevealAdversary,
}: DataGuardHudProps) {
  const [groundOpen, setGroundOpen] = useState(false);
  const [confirmZeroize, setConfirmZeroize] = useState(false);
  const [previewId, setPreviewId] = useState<number | null>(null);

  const link = view?.link ?? null;
  const guard = view?.guard ?? null;
  const counters = view?.counters;
  const items = view?.items.slice(0, 6) ?? [];
  const groundItems = view?.groundItems ?? [];
  const preview = groundItems.find((g) => g.id === previewId) ?? null;
  const erased = view?.eraseMissionS != null;
  const armed = guard?.state === 'ARMED';

  return (
    <div className="flex w-[320px] flex-col items-stretch gap-2">
      {groundOpen ? (
        <div className="hud-panel px-3 py-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-[12px] uppercase tracking-[0.06em] text-dim">
              GROUND STATION
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-dim">
              {groundName}
            </span>
            <button
              className="h-5 px-1 font-mono text-[10px] text-dim"
              onClick={() => setGroundOpen(false)}
            >
              CLOSE
            </button>
          </div>

          <div className="mt-1 max-h-[210px] overflow-y-auto">
            {groundItems.length === 0 ? (
              <div className="py-1 font-mono text-[11px] text-dim">NO ITEMS RECEIVED</div>
            ) : (
              groundItems.map((g) => {
                const pct = Math.round(g.progress * 100);
                const verifying = !g.verified && pct >= 100;
                return (
                  <div key={g.id} className="border-t border-edge py-1.5">
                    <div className="flex items-baseline justify-between gap-2 font-mono text-[11px]">
                      <span className="text-txt">
                        ITEM {String(g.id).padStart(2, '0')}{' '}
                        <span className="text-dim">
                          {g.type} P{g.priority}
                        </span>
                      </span>
                      <span
                        className={
                          g.verified ? 'text-steel' : verifying ? 'text-amber' : 'text-dim'
                        }
                      >
                        {g.verified ? 'SHA-256 OK' : verifying ? 'VERIFYING' : `${pct}%`}
                      </span>
                    </div>
                    <div className="mt-1 h-1 border border-edge bg-bg">
                      <div
                        className={`h-full ${g.verified ? 'bg-steel' : 'bg-data'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="num font-mono text-[10px] text-dim">
                        {g.sentMB.toFixed(1)} / {g.sizeMB} MB
                      </span>
                      {g.verified ? (
                        <button
                          className="h-5 border border-edge px-1.5 font-mono text-[10px] text-txt"
                          onClick={() => setPreviewId(g.id)}
                        >
                          DECRYPT
                        </button>
                      ) : (
                        <span className="font-mono text-[10px] uppercase text-amber">
                          {g.incomplete ? 'INCOMPLETE' : 'RECEIVING'}
                        </span>
                      )}
                    </div>
                    {preview && preview.id === g.id && preview.preview ? (
                      <div className="mt-1 border border-edge bg-bg p-2">
                        <div className="flex items-baseline justify-between">
                          <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-dim">
                            DECRYPTED ITEM {String(g.id).padStart(2, '0')}
                          </span>
                          <button
                            className="h-5 px-1 font-mono text-[10px] text-dim"
                            onClick={() => setPreviewId(null)}
                          >
                            CLOSE
                          </button>
                        </div>
                        <pre className="mt-1 max-h-[120px] overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-[14px] text-txt">
                          {preview.preview}
                        </pre>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>

          {erased ? (
            <div className="mt-2 border-t border-edge pt-1.5">
              {view?.adversary ? (
                <div className="font-mono text-[10px] uppercase leading-4 text-red">
                  ADVERSARY RECOVERY: FAILED - key destroyed
                  <span className="num block normal-case text-dim">
                    {view.adversary.failed} of {view.adversary.attempted} stored blocks failed
                    authentication.
                  </span>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] uppercase text-amber">
                    ADVERSARY RECOVERY: PENDING
                  </span>
                  <button
                    className="h-5 border border-edge px-1.5 font-mono text-[10px] text-txt"
                    onClick={onRevealAdversary}
                  >
                    REVEAL
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="hud-panel px-3 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-[12px] uppercase tracking-[0.06em] text-txt">RECON DATA</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-dim">
            {view?.started ? 'ENCRYPTED ONBOARD' : 'KEY EXCHANGE'}
          </span>
        </div>

        <div className="mt-1 flex items-baseline justify-between gap-2 font-mono text-[12px]">
          <span className="text-dim">LINK</span>
          {link ? (
            <span className="flex items-baseline gap-2">
              <span className={LINK_COLOR[link.state]}>{link.state}</span>
              <span className="num text-txt">{link.rateMbps.toFixed(2)} Mbps</span>
              <span className="num text-dim">RGE {Math.round(link.rangeKm)} km</span>
            </span>
          ) : (
            <span className="text-dim">ACQUIRING</span>
          )}
        </div>

        <div className="mt-1.5 border-t border-edge pt-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-[12px] uppercase tracking-[0.06em] text-dim">
              DATA GUARD
            </span>
            <span
              className={`font-mono text-[12px] uppercase tracking-[0.06em] ${
                guard ? GUARD_COLOR[guard.state] : 'text-dim'
              }`}
            >
              {guard?.state.replace('_', ' ') ?? 'INIT'}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] leading-[15px] text-txt">
            {guard?.reason ?? 'Session key exchange in progress.'}
          </p>
          {view?.eraseMissionS != null ? (
            <p className="num mt-0.5 font-mono text-[10px] text-red">
              KEY DESTROYED T+{fmtClock(view.eraseMissionS)}
            </p>
          ) : null}
        </div>

        <div className="mt-1.5 grid grid-cols-3 gap-2 border-t border-edge pt-1.5">
          {(
            [
              ['COLLECTED', counters?.collectedMB],
              ['AT GROUND', counters?.atGroundMB],
              ['ONBOARD', counters?.onboardMB],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="flex flex-col">
              <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-dim">
                {label}
              </span>
              <span className="num font-mono text-[13px] leading-4 text-txt">
                <Mb value={value} /> MB
              </span>
            </div>
          ))}
        </div>

        <div className="mt-1.5 border-t border-edge pt-1">
          <div className="grid grid-cols-[34px_1fr_30px_78px] font-mono text-[9px] uppercase tracking-[0.08em] text-dim">
            <span>ITEM</span>
            <span>TYPE</span>
            <span>PRI</span>
            <span className="text-right">STATUS</span>
          </div>
          {items.length === 0 ? (
            <div className="py-0.5 font-mono text-[11px] text-dim">NO ITEMS CAPTURED</div>
          ) : (
            items.map((it) => (
              <div
                key={it.id}
                className="grid grid-cols-[34px_1fr_30px_78px] font-mono text-[11px] leading-[17px]"
              >
                <span className="num text-txt">{String(it.id).padStart(2, '0')}</span>
                <span className="text-dim">{it.type}</span>
                <span className="text-dim">P{it.priority}</span>
                <span className={`text-right ${STATUS_COLOR[it.status]}`}>
                  {it.status.replace('_', ' ')}
                </span>
              </div>
            ))
          )}
        </div>

        <div className="mt-1.5 flex gap-1">
          <button
            className={`h-6 flex-1 border px-1 font-mono text-[10px] uppercase tracking-[0.06em] ${
              groundOpen ? 'border-steel text-steel' : 'border-edge text-dim'
            }`}
            onClick={() => setGroundOpen((v) => !v)}
          >
            GROUND STATION
          </button>
          <button
            className={`h-6 flex-1 border px-1 font-mono text-[10px] uppercase tracking-[0.06em] ${
              jammed ? 'border-red text-red' : 'border-edge text-dim'
            }`}
            onClick={onToggleJam}
          >
            {jammed ? 'JAMMED [J]' : 'JAM LINK [J]'}
          </button>
        </div>

        <button
          disabled={!armed}
          className={`mt-1 h-6 w-full border font-mono text-[10px] uppercase tracking-[0.06em] ${
            armed ? 'border-red text-red' : 'border-edge text-dim'
          }`}
          onClick={() => setConfirmZeroize(true)}
        >
          REMOTE ZEROIZE
        </button>

        {confirmZeroize ? (
          <div className="mt-1 flex items-center gap-1 border border-red px-2 py-1">
            <span className="flex-1 font-mono text-[10px] uppercase text-red">
              DESTROY SESSION KEY?
            </span>
            <button
              className="h-5 px-1.5 font-mono text-[10px] text-red"
              onClick={() => {
                setConfirmZeroize(false);
                onRemoteZeroize();
              }}
            >
              CONFIRM
            </button>
            <button
              className="h-5 px-1.5 font-mono text-[10px] text-dim"
              onClick={() => setConfirmZeroize(false)}
            >
              CANCEL
            </button>
          </div>
        ) : null}

        {view?.error ?? error ? (
          <p className="mt-1 font-mono text-[10px] text-red">{view?.error ?? error}</p>
        ) : null}

        <p className="mt-1.5 border-t border-edge pt-1.5 font-mono text-[9px] leading-[13px] text-dim">
          SIMULATED CRYPTO - browser WebCrypto demonstrates the protocol only. JS cannot guarantee
          memory zeroization; production uses a hardware secure element and certified link
          encryption.
        </p>
      </div>
    </div>
  );
}
