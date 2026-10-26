import { useEffect, useState, type ReactNode } from 'react';
import { CYLINDER_FAULTS, ENGINE_FAULT_LABELS } from '../../sim/faults';
import type { ChannelId, EngineFaultKind, SensorFaultKind, TurbulenceLevel } from '../../sim/types';
import { cancelSpeech } from '../../rehearsal/audio';
import {
  ENGINE_FAULT_ORDER,
  INSTRUMENT_CHANNELS,
  INSTRUMENT_KINDS,
  INSTRUMENT_KIND_LABELS,
  TURB_ORDER,
  channelName,
  fmtScheduleS,
  parseScheduleS,
  scheduleLabel,
  useDirectorStore,
  type DirectorLinkMode,
  type DirectorPayload,
  type ScheduledInjection,
} from '../../rehearsal/director';

export interface DirectorPanelProps {
  missionS: number;
  linkMode: DirectorLinkMode;
  turbulence: TurbulenceLevel;
  isaDevC: number;
  onClose: () => void;
  onInject: (payload: DirectorPayload) => void;
  onSchedule: (payload: DirectorPayload, atS: number) => void;
  onLink: (action: 'jam' | 'restore' | 'degrade') => void;
  onWeather: (patch: { turbulence?: TurbulenceLevel; isaDevC?: number }) => void;
  onSurprise: () => void;
}

const LABEL = 'font-mono text-[9px] uppercase tracking-[0.08em] text-ink-3';

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-3 border-t border-rule pt-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="panel-title">{title}</span>
        {aside}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function ScheduleRow({
  item,
  onTime,
  onRemove,
}: {
  item: ScheduledInjection;
  onTime: (id: number, atS: number) => void;
  onRemove: (id: number) => void;
}) {
  const [draft, setDraft] = useState(fmtScheduleS(item.atS));
  useEffect(() => setDraft(fmtScheduleS(item.atS)), [item.atS]);

  const commit = () => {
    const seconds = parseScheduleS(draft);
    if (seconds === null) {
      setDraft(fmtScheduleS(item.atS));
      return;
    }
    onTime(item.id, seconds);
  };

  const source =
    item.source === 'scenario' ? 'SCENARIO' : item.source === 'surprise' ? 'SURPRISE' : 'MANUAL';

  return (
    <div className="flex items-center gap-1.5 border-b border-rule/70 py-1 last:border-b-0">
      <span className="font-mono text-[10px] text-ink-3">T+</span>
      <input
        className="num h-6 w-[52px] text-[11px]"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setDraft(fmtScheduleS(item.atS));
            e.currentTarget.blur();
          }
        }}
        aria-label="Scheduled time, minutes and seconds"
      />
      <span
        className={`min-w-0 flex-1 truncate font-mono text-[11px] ${
          item.hidden ? 'text-caution' : 'text-ink'
        }`}
        title={scheduleLabel(item)}
      >
        {scheduleLabel(item)}
      </span>
      <span className="shrink-0 font-mono text-[8px] tracking-[0.06em] text-ink-3">{source}</span>
      <button
        className="h-6 shrink-0 px-1.5 font-mono text-[10px] text-ink-3 hover:text-critical"
        onClick={() => onRemove(item.id)}
        title={`Delete ${scheduleLabel(item)}`}
      >
        DEL
      </button>
    </div>
  );
}

export default function DirectorPanel({
  missionS,
  linkMode,
  turbulence,
  isaDevC,
  onClose,
  onInject,
  onSchedule,
  onLink,
  onWeather,
  onSurprise,
}: DirectorPanelProps) {
  const soundOn = useDirectorStore((s) => s.soundOn);
  const toggleSound = useDirectorStore((s) => s.toggleSound);
  const seed = useDirectorStore((s) => s.seed);
  const setSeed = useDirectorStore((s) => s.setSeed);
  const windowMin = useDirectorStore((s) => s.windowMin);
  const windowMax = useDirectorStore((s) => s.windowMax);
  const setWindow = useDirectorStore((s) => s.setWindow);
  const schedule = useDirectorStore((s) => s.schedule);
  const updateScheduleTime = useDirectorStore((s) => s.updateScheduleTime);
  const removeSchedule = useDirectorStore((s) => s.removeSchedule);
  const clearSchedule = useDirectorStore((s) => s.clearSchedule);

  const [engineKind, setEngineKind] = useState<EngineFaultKind>('cooling');
  const [cylinder, setCylinder] = useState(3);
  const [severity, setSeverity] = useState(0.6);
  const [rampTime, setRampTime] = useState(30);
  const [engineAt, setEngineAt] = useState('02:00');

  const [channel, setChannel] = useState<ChannelId>('cht1');
  const [sensorKind, setSensorKind] = useState<SensorFaultKind>('drift');
  const [sensorAt, setSensorAt] = useState('03:00');

  const [seedDraft, setSeedDraft] = useState(String(seed));
  const [minDraft, setMinDraft] = useState(String(windowMin));
  const [maxDraft, setMaxDraft] = useState(String(windowMax));

  const needsCylinder = CYLINDER_FAULTS.has(engineKind);
  const engineSeconds = parseScheduleS(engineAt);
  const sensorSeconds = parseScheduleS(sensorAt);

  const enginePayload = (): DirectorPayload => ({
    type: 'engine',
    kind: engineKind,
    severity,
    rampTime,
    ...(needsCylinder ? { cylinder } : {}),
  });

  const sensorPayload = (): DirectorPayload => ({
    type: 'sensor',
    kind: sensorKind,
    severity: 0.5,
    rampTime: 10,
    channel,
  });

  const applySurprise = () => {
    const nextSeed = Number(seedDraft);
    const min = Number(minDraft);
    const max = Number(maxDraft);
    if (!Number.isFinite(nextSeed) || !Number.isFinite(min) || !Number.isFinite(max)) return;
    setSeed(nextSeed);
    setWindow(min, max);
    onSurprise();
  };

  const turbIndex = TURB_ORDER.indexOf(turbulence);
  const stepTurb = (dir: -1 | 1) => {
    const next = TURB_ORDER[Math.max(0, Math.min(TURB_ORDER.length - 1, turbIndex + dir))];
    if (next !== turbulence) onWeather({ turbulence: next });
  };

  return (
    <aside
      className="pointer-events-auto fixed inset-y-0 right-0 z-30 flex w-[344px] flex-col border-l border-rule-strong bg-panel font-sans text-ink"
      aria-label="Failure director"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-rule px-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink">
          Failure director
        </span>
        <span className="num font-mono text-[10px] text-ink-3">T+{fmtScheduleS(missionS)}</span>
        <button
          className={`ml-auto h-6 px-2 font-mono text-[9px] uppercase tracking-[0.06em] ${
            soundOn ? 'border-steel text-steel' : 'text-ink-3'
          }`}
          onClick={() => {
            toggleSound();
            if (soundOn) cancelSpeech();
          }}
          title="Toggle sound and voice (M)"
        >
          {soundOn ? 'SND ON [M]' : 'MUTED [M]'}
        </button>
        <button
          className="h-6 px-2 font-mono text-[9px] uppercase tracking-[0.06em] text-ink-3"
          onClick={onClose}
          title="Close director panel (F)"
        >
          CLOSE [F]
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
        <Section title="Engine fault">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className={`${LABEL} w-14 shrink-0`}>Fault</span>
              <select
                className="h-6 min-w-0 flex-1 text-[11px]"
                value={engineKind}
                onChange={(e) => setEngineKind(e.target.value as EngineFaultKind)}
              >
                {ENGINE_FAULT_ORDER.map((kind) => (
                  <option key={kind} value={kind}>
                    {ENGINE_FAULT_LABELS[kind] ?? kind}
                  </option>
                ))}
              </select>
            </div>

            {needsCylinder ? (
              <div className="flex items-center gap-2">
                <span className={`${LABEL} w-14 shrink-0`}>Cylinder</span>
                <select
                  className="h-6 w-20 text-[11px]"
                  value={String(cylinder)}
                  onChange={(e) => setCylinder(Number(e.target.value))}
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      CYL {n}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="flex items-center gap-2">
              <span className={`${LABEL} w-14 shrink-0`}>Severity</span>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                className="min-w-0 flex-1"
                value={severity}
                onChange={(e) => setSeverity(Number(e.target.value))}
                aria-label="Fault severity"
              />
              <span className="num w-8 text-right font-mono text-[10px] text-ink">
                {Math.round(severity * 100)}%
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className={`${LABEL} w-14 shrink-0`}>Ramp</span>
              <select
                className="h-6 w-20 text-[11px]"
                value={String(rampTime)}
                onChange={(e) => setRampTime(Number(e.target.value))}
                aria-label="Ramp time"
              >
                {[5, 10, 15, 20, 30, 45, 60].map((s) => (
                  <option key={s} value={s}>
                    {s} s
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-1 flex gap-1.5">
              <button
                className="primary h-7 flex-1 font-mono text-[10px] uppercase tracking-[0.06em]"
                onClick={() => onInject(enginePayload())}
              >
                Inject now
              </button>
              <div className="flex flex-1 items-center gap-1">
                <span className="font-mono text-[10px] text-ink-3">T+</span>
                <input
                  className="num h-7 w-[50px] text-[11px]"
                  value={engineAt}
                  onChange={(e) => setEngineAt(e.target.value)}
                  aria-label="Engine fault schedule time"
                />
                <button
                  className="h-7 min-w-0 flex-1 px-1 font-mono text-[9px] uppercase tracking-[0.04em]"
                  disabled={engineSeconds === null}
                  onClick={() => {
                    if (engineSeconds !== null) onSchedule(enginePayload(), engineSeconds);
                  }}
                >
                  Schedule
                </button>
              </div>
            </div>
          </div>
        </Section>

        <Section title="Instrument fault">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className={`${LABEL} w-14 shrink-0`}>Channel</span>
              <select
                className="h-6 min-w-0 flex-1 text-[11px]"
                value={channel}
                onChange={(e) => setChannel(e.target.value as ChannelId)}
              >
                {INSTRUMENT_CHANNELS.map((id) => (
                  <option key={id} value={id}>
                    {channelName(id)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className={`${LABEL} w-14 shrink-0`}>Type</span>
              <select
                className="h-6 w-24 text-[11px]"
                value={sensorKind}
                onChange={(e) => setSensorKind(e.target.value as SensorFaultKind)}
              >
                {INSTRUMENT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {INSTRUMENT_KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-1 flex gap-1.5">
              <button
                className="primary h-7 flex-1 font-mono text-[10px] uppercase tracking-[0.06em]"
                onClick={() => onInject(sensorPayload())}
              >
                Inject now
              </button>
              <div className="flex flex-1 items-center gap-1">
                <span className="font-mono text-[10px] text-ink-3">T+</span>
                <input
                  className="num h-7 w-[50px] text-[11px]"
                  value={sensorAt}
                  onChange={(e) => setSensorAt(e.target.value)}
                  aria-label="Instrument fault schedule time"
                />
                <button
                  className="h-7 min-w-0 flex-1 px-1 font-mono text-[9px] uppercase tracking-[0.04em]"
                  disabled={sensorSeconds === null}
                  onClick={() => {
                    if (sensorSeconds !== null) onSchedule(sensorPayload(), sensorSeconds);
                  }}
                >
                  Schedule
                </button>
              </div>
            </div>
          </div>
        </Section>

        <Section title="Datalink">
          <div className="flex gap-1.5">
            <button
              className={`h-7 flex-1 font-mono text-[9px] uppercase tracking-[0.04em] ${
                linkMode === 'jammed' ? 'border-critical text-critical' : ''
              }`}
              onClick={() => onLink(linkMode === 'jammed' ? 'restore' : 'jam')}
            >
              {linkMode === 'jammed' ? 'Restore' : 'Jam'}
            </button>
            <button
              className={`h-7 flex-1 font-mono text-[9px] uppercase tracking-[0.04em] ${
                linkMode === 'degraded' ? 'border-caution text-caution' : ''
              }`}
              onClick={() => onLink(linkMode === 'degraded' ? 'restore' : 'degrade')}
            >
              Degrade x0.25
            </button>
            <button
              className="h-7 flex-1 font-mono text-[9px] uppercase tracking-[0.04em]"
              onClick={() => onLink('restore')}
            >
              Restore
            </button>
          </div>
          <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.04em] text-ink-3">
            Link {linkMode}
          </div>
        </Section>

        <Section title="Weather now">
          <div className="flex items-center gap-2">
            <span className={`${LABEL} w-14 shrink-0`}>Turbulence</span>
            <button className="h-6 w-7" onClick={() => stepTurb(-1)} disabled={turbIndex <= 0}>
              -
            </button>
            <span className="w-20 text-center font-mono text-[10px] uppercase text-ink">
              {turbulence}
            </span>
            <button
              className="h-6 w-7"
              onClick={() => stepTurb(1)}
              disabled={turbIndex >= TURB_ORDER.length - 1}
            >
              +
            </button>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <span className={`${LABEL} w-14 shrink-0`}>ISA dev</span>
            <button
              className="h-6 px-2 font-mono text-[10px]"
              onClick={() => onWeather({ isaDevC: Math.max(-20, isaDevC - 5) })}
            >
              -5
            </button>
            <span className="num w-16 text-center font-mono text-[10px] text-ink">
              {isaDevC >= 0 ? '+' : ''}
              {Math.round(isaDevC)} C
            </span>
            <button
              className="h-6 px-2 font-mono text-[10px]"
              onClick={() => onWeather({ isaDevC: Math.min(20, isaDevC + 5) })}
            >
              +5
            </button>
          </div>
        </Section>

        <Section title="Surprise me">
          <div className="flex items-center gap-2">
            <span className={`${LABEL} w-14 shrink-0`}>Seed</span>
            <input
              className="num h-6 w-24 text-[11px]"
              value={seedDraft}
              onChange={(e) => setSeedDraft(e.target.value)}
              aria-label="Surprise seed"
            />
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <span className={`${LABEL} w-14 shrink-0`}>Window</span>
            <input
              className="num h-6 w-14 text-[11px]"
              value={minDraft}
              onChange={(e) => setMinDraft(e.target.value)}
              aria-label="Surprise window start, minutes"
            />
            <span className="font-mono text-[10px] text-ink-3">to</span>
            <input
              className="num h-6 w-14 text-[11px]"
              value={maxDraft}
              onChange={(e) => setMaxDraft(e.target.value)}
              aria-label="Surprise window end, minutes"
            />
            <span className="font-mono text-[9px] uppercase text-ink-3">min</span>
          </div>
          <button
            className="mt-2 h-7 w-full font-mono text-[10px] uppercase tracking-[0.06em]"
            onClick={applySurprise}
          >
            Surprise me
          </button>
          <p className="mt-1 font-mono text-[9px] leading-[13px] text-ink-3">
            One seeded engine or instrument fault at a random time. Its payload stays hidden until
            it fires.
          </p>
        </Section>

        <Section
          title={`Scheduled (${schedule.length})`}
          aside={
            <button
              className="h-5 px-1 font-mono text-[9px] uppercase tracking-[0.04em] text-ink-3 hover:text-critical"
              disabled={!schedule.length}
              onClick={clearSchedule}
            >
              Clear all
            </button>
          }
        >
          {schedule.length === 0 ? (
            <div className="py-1 font-mono text-[10px] text-ink-3">
              No scheduled injections.
            </div>
          ) : (
            schedule.map((item) => (
              <ScheduleRow
                key={item.id}
                item={item}
                onTime={updateScheduleTime}
                onRemove={removeSchedule}
              />
            ))
          )}
        </Section>

        <p className="mt-4 border-t border-rule pt-2 font-mono text-[9px] leading-[13px] text-ink-3">
          Detection latency is measured in simulation seconds from injection to the first twin
          announcement. LINK and WEATHER changes have no detection latency.
        </p>
      </div>
    </aside>
  );
}
