import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import RehearsalMap from './RehearsalMap';
import StageHeader from './StageHeader';
import { useRehearsalStore } from '../../rehearsal/store';
import { SCENARIO_SCRIPTS } from '../../rehearsal/scripts';
import { fmtHM } from '../../rehearsal/clock';
import { factorSentence, weatherSentence } from '../../rehearsal/metrics';
import {
  TEMPLATE_LIST,
  missionInputKey,
  missionTrackDistanceM,
  useMissionStore,
  weatherValues,
} from '../../mission/missionStore';
import { buildPreflight, type PreflightReport } from '../../mission/preflight';
import { resolveWaypoints, fetchTerrain, terrainKey } from '../../mission/terrain';
import { fmtStartIST, isoToIstInput } from '../../mission/time';
import {
  ALT_REFS,
  ENGINE_PROFILES,
  MAX_NODES,
  NODE_TYPES,
  SITE_TYPES,
  ZONE_TYPES,
  type MissionNode,
  type NodeType,
} from '../../mission/types';
import { TURB_LEVELS, fallbackCell, weatherTag, type WeatherCell } from '../../mission/weather';
import type { ZoneCrossing } from '../../mission/geometry';
import type { Waypoint } from '../../mission/route';
import type { ScenarioId } from '../../rehearsal/types';
import type { TurbulenceLevel } from '../../sim/types';

type EditorTab = 'route' | 'zones' | 'sites' | 'missions';

function label(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

const VERDICT_BAR: Record<string, string> = {
  GO: 'bg-ok',
  CAUTION: 'bg-caution',
  'NO-GO': 'bg-critical',
};

const STATUS_BORDER: Record<string, string> = {
  PASS: 'border-l-ok',
  CAUTION: 'border-l-caution',
  FAIL: 'border-l-critical',
};

const TAG_DOT: Record<string, string> = {
  LIVE: 'bg-ok',
  MANUAL: 'bg-airport',
  FALLBACK: 'bg-rule-strong',
};

const SMALL_BUTTON =
  'shrink-0 font-mono text-[10px] disabled:text-ink-3';

function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-edge px-3 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="panel-title">{title}</span>
        {right}
      </div>
      {children}
    </section>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-rule py-1.5">
      <span className="text-[11px] text-ink-3">{label}</span>
      <span className="num truncate font-mono text-[12px] text-ink">{value}</span>
    </div>
  );
}

function TextCell({
  value,
  onCommit,
  ariaLabel,
  className = '',
  placeholder,
}: {
  value: string;
  onCommit: (text: string) => boolean;
  ariaLabel: string;
  className?: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  return (
    <input
      aria-label={ariaLabel}
      value={draft}
      placeholder={placeholder}
      spellCheck={false}
      title={bad ? 'Invalid input, not applied' : undefined}
      className={`num min-w-0 border bg-sheet px-1.5 py-0.5 font-mono text-[11px] text-ink ${
        bad ? 'border-critical' : 'border-edge'
      } ${className}`}
      onChange={(e) => {
        setDraft(e.target.value);
        setBad(false);
      }}
      onBlur={() => {
        if (draft === value) {
          setBad(false);
          return;
        }
        if (!onCommit(draft)) setBad(true);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') {
          setDraft(value);
          setBad(false);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function numberText(text: string): number | null {
  if (!text.trim()) return null;
  const v = Number(text);
  return Number.isFinite(v) ? v : null;
}

function MissionNameField({ name }: { name: string }) {
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  return (
    <input
      aria-label="Mission name"
      value={draft}
      spellCheck={false}
      className="min-w-0 w-full border border-edge bg-paper px-2 py-1 font-condensed text-[18px] font-semibold text-ink"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const clean = draft.trim();
        if (!clean) {
          setDraft(name);
          return;
        }
        useMissionStore.getState().setMissionName(clean);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') {
          setDraft(name);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function StartTimeField({ iso }: { iso: string }) {
  const [draft, setDraft] = useState(isoToIstInput(iso));
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setDraft(isoToIstInput(iso));
    setBad(false);
  }, [iso]);
  return (
    <div>
      <input
        aria-label="Mission start in IST"
        type="datetime-local"
        value={draft}
        style={{ colorScheme: 'light' }}
        className={`w-full min-w-0 border bg-sheet px-1.5 py-1 font-mono text-[11px] ${
          bad ? 'border-critical text-ink' : 'border-edge text-ink'
        }`}
        onChange={(e) => {
          setDraft(e.target.value);
          setBad(false);
        }}
        onBlur={() => {
          if (!useMissionStore.getState().setStartTime(draft)) setBad(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      <div className={`mt-1 font-mono text-[10px] ${bad ? 'text-ink' : 'text-ink-3'}`}>
        {bad ? 'Invalid date or time, not applied' : fmtStartIST(iso)}
      </div>
    </div>
  );
}

function WxTag({ cell }: { cell: WeatherCell }) {
  const tag = weatherTag(cell);
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 font-mono text-[9px] text-ink-3"
      title={
        tag === 'LIVE'
          ? 'Open-Meteo hourly forecast at the mission start'
          : tag === 'MANUAL'
            ? 'Manual override applied to this node'
            : 'Fallback weather; no live forecast for this node'
      }
    >
      <span aria-hidden="true" className={`h-[5px] w-[5px] ${TAG_DOT[tag] ?? 'bg-rule-strong'}`} />
      {tag.charAt(0) + tag.slice(1).toLowerCase()}
    </span>
  );
}

function OverridePanel({ node, cell }: { node: MissionNode; cell: WeatherCell }) {
  const setOverride = useMissionStore((s) => s.setWeatherOverride);
  const clearOverride = useMissionStore((s) => s.clearWeatherOverride);
  const [isa, setIsa] = useState(String(Math.round(cell.isaDevC)));
  const [dir, setDir] = useState(String(Math.round(cell.windDirDeg)));
  const [spd, setSpd] = useState(String(Math.round(cell.windSpdMs * 10) / 10));
  const [gust, setGust] = useState(String(Math.round(cell.gustMs * 10) / 10));
  const [turb, setTurb] = useState<TurbulenceLevel>(cell.turb);
  const [bad, setBad] = useState(false);

  const apply = () => {
    const isaV = numberText(isa);
    const dirV = numberText(dir);
    const spdV = numberText(spd);
    const gustV = numberText(gust);
    if (
      isaV === null ||
      dirV === null ||
      spdV === null ||
      gustV === null ||
      dirV < 0 ||
      dirV > 360 ||
      spdV < 0 ||
      gustV < 0 ||
      gustV < spdV
    ) {
      setBad(true);
      return;
    }
    setBad(false);
    setOverride(node.id, {
      isaDevC: isaV,
      windDirDeg: dirV % 360,
      windSpdMs: spdV,
      gustMs: gustV,
      turb,
    });
  };

  return (
    <div className="mt-2 border-t border-rule pt-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[9px] tracking-[0.1em] text-ink-3">
          WX {label(weatherTag(cell))}, {node.name}
        </span>
        <button
          className={SMALL_BUTTON}
          disabled={weatherTag(cell) !== 'MANUAL'}
          onClick={() => clearOverride(node.id)}
        >
          Clear
        </button>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-1">
        <label className="text-[9px] text-ink-3">
          ISA dev, °C
          <TextCell
            ariaLabel={`ISA deviation at ${node.name}`}
            value={isa}
            className="mt-0.5 w-full"
            onCommit={(t) => {
              if (numberText(t) === null) return false;
              setIsa(t);
              return true;
            }}
          />
        </label>
        <label className="text-[9px] text-ink-3">
          Wind dir
          <TextCell
            ariaLabel={`Wind direction at ${node.name}`}
            value={dir}
            className="mt-0.5 w-full"
            onCommit={(t) => {
              const v = numberText(t);
              if (v === null || v < 0 || v > 360) return false;
              setDir(t);
              return true;
            }}
          />
        </label>
        <label className="text-[9px] text-ink-3">
          Wind m/s
          <TextCell
            ariaLabel={`Wind speed at ${node.name}`}
            value={spd}
            className="mt-0.5 w-full"
            onCommit={(t) => {
              const v = numberText(t);
              if (v === null || v < 0) return false;
              setSpd(t);
              return true;
            }}
          />
        </label>
        <label className="text-[9px] text-ink-3">
          Gust m/s
          <TextCell
            ariaLabel={`Gust speed at ${node.name}`}
            value={gust}
            className="mt-0.5 w-full"
            onCommit={(t) => {
              const v = numberText(t);
              if (v === null || v < 0) return false;
              setGust(t);
              return true;
            }}
          />
        </label>
        <label className="col-span-2 text-[9px] text-ink-3">
          Turbulence
          <select
            aria-label={`Turbulence at ${node.name}`}
            value={turb}
            onChange={(e) => setTurb(e.target.value as TurbulenceLevel)}
            className="mt-0.5 w-full font-mono text-[11px]"
          >
            {TURB_LEVELS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button
        className={`mt-1.5 h-7 w-full primary font-mono text-[10px] ${
          bad ? 'opacity-70' : ''
        }`}
        onClick={apply}
      >
        {bad ? 'Not applied, check values' : 'Apply override'}
      </button>
    </div>
  );
}

function NodeRow({
  node,
  index,
  count,
  amslM,
  cell,
  selected,
  onDragStart,
  onDropRow,
}: {
  node: MissionNode;
  index: number;
  count: number;
  amslM: number;
  cell: WeatherCell;
  selected: boolean;
  onDragStart: (index: number) => void;
  onDropRow: (index: number) => void;
}) {
  const update = useMissionStore((s) => s.updateNode);
  const remove = useMissionStore((s) => s.deleteNode);
  const select = useMissionStore((s) => s.selectNode);

  return (
    <div
      className={`border-l-2 ${selected ? 'border-steel bg-paper' : 'border-transparent bg-sheet'}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDropRow(index);
      }}
    >
      <div className="flex items-center gap-1 px-1 py-1">
        <span
          draggable
          role="button"
          tabIndex={0}
          title="Drag to reorder nodes"
          aria-label={`Reorder ${node.name}`}
          className="cursor-grab select-none px-0.5 font-mono text-[12px] text-ink-3"
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(index));
            onDragStart(index);
          }}
        >
          ⠿
        </span>
        <button
          className="flex min-w-0 flex-1 items-baseline gap-1.5 border-0 bg-transparent px-1 py-0.5 text-left hover:border-0"
          onClick={() => select(selected ? null : node.id)}
          aria-expanded={selected}
        >
          <span className="num w-4 shrink-0 font-mono text-[10px] text-ink-3">{index + 1}</span>
          <span className="truncate font-mono text-[11px] tracking-[0.04em] text-ink">
            {node.name}
          </span>
          <span className="shrink-0 font-mono text-[9px] tracking-[0.04em] text-ink-3">
            {label(node.type)}
          </span>
          <WxTag cell={cell} />
        </button>
        <button
          className="border-0 bg-transparent px-1 font-mono text-[12px] text-ink-3 hover:text-ink"
          title={count <= 2 ? 'A mission needs at least two nodes' : `Delete ${node.name}`}
          aria-label={`Delete ${node.name}`}
          onClick={() => remove(node.id)}
        >
          ×
        </button>
      </div>

      {selected && (
        <div className="flex flex-col gap-1.5 px-2 pb-2">
          <label className="text-[9px] text-ink-3">
            Name
            <TextCell
              ariaLabel={`Name of node ${index + 1}`}
              value={node.name}
              className="mt-0.5 w-full"
              onCommit={(t) => update(node.id, { name: t })}
            />
          </label>
          <div className="grid grid-cols-2 gap-1">
            <label className="text-[9px] text-ink-3">
              Latitude
              <TextCell
                ariaLabel={`Latitude of ${node.name}`}
                value={node.lat.toFixed(5)}
                className="mt-0.5 w-full"
                onCommit={(t) => {
                  const v = numberText(t);
                  return v !== null && v >= -90 && v <= 90 && update(node.id, { lat: v });
                }}
              />
            </label>
            <label className="text-[9px] text-ink-3">
              Longitude
              <TextCell
                ariaLabel={`Longitude of ${node.name}`}
                value={node.lon.toFixed(5)}
                className="mt-0.5 w-full"
                onCommit={(t) => {
                  const v = numberText(t);
                  return v !== null && v >= -180 && v <= 180 && update(node.id, { lon: v });
                }}
              />
            </label>
          </div>
          <div className="grid grid-cols-[1fr_92px] gap-1">
            <label className="text-[9px] text-ink-3">
              Altitude
              <TextCell
                ariaLabel={`Altitude of ${node.name}`}
                value={String(node.alt)}
                className="mt-0.5 w-full"
                onCommit={(t) => {
                  const v = numberText(t);
                  return v !== null && v >= 0 && v <= 20000 && update(node.id, { alt: v });
                }}
              />
            </label>
            <div className="text-[9px] text-ink-3">
              Ref
              <div className="mt-0.5 grid grid-cols-2 gap-0">
                {ALT_REFS.map((ref) => (
                  <button
                    key={ref}
                    aria-pressed={node.altRef === ref}
                    className={`h-[22px] border font-mono text-[10px] ${
                      node.altRef === ref ? 'border-steel text-ink' : 'border-rule text-ink-3'
                    }`}
                    onClick={() => update(node.id, { altRef: ref })}
                  >
                    {ref}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1">
            <label className="text-[9px] text-ink-3">
              Loiter min
              <TextCell
                ariaLabel={`Loiter minutes at ${node.name}`}
                value={String(node.loiterMin)}
                className="mt-0.5 w-full"
                onCommit={(t) => {
                  const v = numberText(t);
                  return v !== null && v >= 0 && update(node.id, { loiterMin: v });
                }}
              />
            </label>
            <label className="text-[9px] text-ink-3">
              Speed m/s
              <TextCell
                ariaLabel={`Speed override at ${node.name}`}
                value={node.speed === undefined ? '' : String(node.speed)}
                placeholder="Auto"
                className="mt-0.5 w-full"
                onCommit={(t) => {
                  if (!t.trim()) return update(node.id, { speed: null });
                  const v = numberText(t);
                  return v !== null && update(node.id, { speed: v });
                }}
              />
            </label>
            <label className="text-[9px] text-ink-3">
              Type
              <select
                aria-label={`Type of ${node.name}`}
                value={node.type}
                onChange={(e) => update(node.id, { type: e.target.value as NodeType })}
                className="mt-0.5 h-[22px] w-full font-mono text-[9px]"
              >
                {NODE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex items-center justify-between font-mono text-[9px] tracking-[0.06em] text-ink-3">
            <span>Resolved {Math.round(amslM)} m AMSL</span>
            <span>{node.altRef === 'AGL' ? 'AGL follows terrain' : 'Fixed AMSL'}</span>
          </div>
          <div className="text-[9px] text-ink-3">
            Weather override
            <OverridePanel node={node} cell={cell} />
          </div>
        </div>
      )}
    </div>
  );
}

function RouteTab({ waypoints, weather }: { waypoints: Waypoint[]; weather: WeatherCell[] }) {
  const mission = useMissionStore((s) => s.mission);
  const selectedNodeId = useMissionStore((s) => s.selectedNodeId);
  const autoPlace = useMissionStore((s) => s.autoPlaceRecon);
  const reorder = useMissionStore((s) => s.reorderNode);
  const [reconCount, setReconCount] = useState(3);
  const dragFrom = useRef<number | null>(null);

  return (
    <>
      <Section
        title={`Route nodes ${mission.nodes.length}/${MAX_NODES}`}
        right={
          <span className="font-mono text-[9px] tracking-[0.04em] text-ink-3">
            Click map to add
          </span>
        }
      >
        <div className="flex items-center gap-1">
          <span className="font-mono text-[10px] text-ink-3">Recon</span>
          <input
            aria-label="Number of recon nodes"
            type="number"
            min={1}
            max={10}
            value={reconCount}
            onChange={(e) => setReconCount(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
            className="w-12 border border-edge bg-paper px-1 py-0.5 font-mono text-[11px] text-ink"
          />
          <button
            className={`${SMALL_BUTTON} h-6 flex-1 border border-rule bg-sheet px-2`}
            disabled={mission.nodes.length < 2}
            onClick={() => autoPlace(reconCount)}
          >
            Auto-place recon
          </button>
        </div>
        <p className="mt-1 text-[10px] leading-4 text-ink-3">
          Places k recon nodes along the route with a seeded lateral offset. Each is editable.
        </p>
      </Section>

      <div className="flex flex-col gap-0.5 px-1 py-1">
        {mission.nodes.map((node, i) => (
          <NodeRow
            key={node.id}
            node={node}
            index={i}
            count={mission.nodes.length}
            amslM={waypoints[i]?.altM ?? node.alt}
            cell={weather[i] ?? fallbackCell()}
            selected={node.id === selectedNodeId}
            onDragStart={(index) => {
              dragFrom.current = index;
            }}
            onDropRow={(index) => {
              const from = dragFrom.current;
              dragFrom.current = null;
              if (from !== null) reorder(from, index);
            }}
          />
        ))}
      </div>
    </>
  );
}

function ZonesTab({ hits }: { hits: ZoneCrossing[] }) {
  const mission = useMissionStore((s) => s.mission);
  const selectedZoneId = useMissionStore((s) => s.selectedZoneId);
  const mode = useMissionStore((s) => s.mode);
  const draftZone = useMissionStore((s) => s.draftZone);
  const startDraw = useMissionStore((s) => s.startZoneDraw);
  const finish = useMissionStore((s) => s.finishZone);
  const cancel = useMissionStore((s) => s.cancelMode);
  const update = useMissionStore((s) => s.updateZone);
  const remove = useMissionStore((s) => s.deleteZone);
  const select = useMissionStore((s) => s.selectZone);

  return (
    <>
      <Section
        title={`Zones ${mission.zones.length}`}
        right={
          <button
            className={`${SMALL_BUTTON} border border-rule bg-sheet px-2 py-0.5`}
            disabled={mode === 'draw-zone'}
            onClick={startDraw}
          >
            Draw zone
          </button>
        }
      >
        {mode === 'draw-zone' ? (
          <div className="border border-rule border-l-2 border-l-caution p-2">
            <div className="text-[11px] text-ink">
              {draftZone.length} vertices. Click map, double-click to close.
            </div>
            <div className="mt-1 flex gap-1">
              <button
                className={`${SMALL_BUTTON} h-6 flex-1 primary`}
                disabled={draftZone.length < 3}
                onClick={finish}
              >
                Finish zone
              </button>
              <button className={`${SMALL_BUTTON} h-6 border border-rule bg-sheet px-2`} onClick={cancel}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className="text-[10px] leading-4 text-ink-3">
            Denied and restricted polygons. The route is checked against every ring.
          </p>
        )}
        {hits.length > 0 && (
          <div className="mt-2 border border-rule border-l-2 border-l-caution px-2 py-1.5 text-[11px] leading-4 text-ink">
            Route crosses:{' '}
            {hits.map((h) => `${h.zone.name} (${label(h.zone.type)}) on ${h.fromName} - ${h.toName}`).join('; ')}
          </div>
        )}
      </Section>

      <div className="flex flex-col gap-0.5 px-1 py-1">
        {mission.zones.length === 0 && (
          <div className="px-2 py-3 text-[11px] text-ink-3">No zones drawn.</div>
        )}
        {mission.zones.map((zone) => {
          const selected = zone.id === selectedZoneId;
          const hit = hits.find((h) => h.zone.id === zone.id);
          return (
            <div
              key={zone.id}
              className={`border-l-2 ${selected ? 'border-steel bg-paper' : 'border-transparent bg-sheet'}`}
            >
              <div className="flex items-center gap-1 px-1 py-1">
                <button
                  className="flex min-w-0 flex-1 items-baseline gap-1.5 border-0 bg-transparent px-1 py-0.5 text-left hover:border-0"
                  onClick={() => select(selected ? null : zone.id)}
                  aria-expanded={selected}
                >
                  <span className="truncate font-mono text-[11px] tracking-[0.04em] text-ink">
                    {zone.name}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[9px] text-ink-3">
                    <span
                      aria-hidden="true"
                      className={`h-[5px] w-[5px] ${
                        zone.type === 'DENIED' ? 'bg-critical' : 'bg-caution'
                      }`}
                    />
                    {label(zone.type)}
                  </span>
                  <span className="shrink-0 font-mono text-[9px] text-ink-3">
                    {zone.polygon.length - 1} vertices
                  </span>
                  {hit && <span className="shrink-0 font-mono text-[9px] text-ink">Crossed</span>}
                </button>
                <button
                  className="border-0 bg-transparent px-1 font-mono text-[12px] text-ink-3 hover:text-ink"
                  title={`Delete zone ${zone.name}`}
                  aria-label={`Delete zone ${zone.name}`}
                  onClick={() => remove(zone.id)}
                >
                  ×
                </button>
              </div>
              {selected && (
                <div className="flex flex-col gap-1.5 px-2 pb-2">
                  <label className="text-[9px] text-ink-3">
                    Name
                    <TextCell
                      ariaLabel={`Name of zone ${zone.name}`}
                      value={zone.name}
                      className="mt-0.5 w-full"
                      onCommit={(t) => {
                        if (!t.trim()) return false;
                        update(zone.id, { name: t });
                        return true;
                      }}
                    />
                  </label>
                  <label className="text-[9px] text-ink-3">
                    Type
                    <select
                      aria-label={`Type of zone ${zone.name}`}
                      value={zone.type}
                      onChange={(e) => update(zone.id, { type: e.target.value as 'DENIED' | 'RESTRICTED' })}
                      className="mt-0.5 h-[22px] w-full font-mono text-[10px]"
                    >
                      {ZONE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="text-[10px] leading-4 text-ink-3">
                    Drag the selected zone's vertices on the map. The ring closes automatically.
                  </p>
                  {hit && (
                    <p className="text-[10px] leading-4 text-ink">
                      Route enters on {hit.fromName} - {hit.toName}.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function SitesTab() {
  const mission = useMissionStore((s) => s.mission);
  const selectedSiteId = useMissionStore((s) => s.selectedSiteId);
  const mode = useMissionStore((s) => s.mode);
  const setGround = useMissionStore((s) => s.setGround);
  const startSite = useMissionStore((s) => s.startSitePlacement);
  const cancel = useMissionStore((s) => s.cancelMode);
  const updateSite = useMissionStore((s) => s.updateSite);
  const removeSite = useMissionStore((s) => s.deleteSite);
  const selectSite = useMissionStore((s) => s.selectSite);

  return (
    <>
      <Section title="Ground station">
        <div className="grid grid-cols-2 gap-1">
          <label className="text-[9px] text-ink-3">
            Lat
            <TextCell
              ariaLabel="Ground station latitude"
              value={mission.groundStation.lat.toFixed(5)}
              className="mt-0.5 w-full"
              onCommit={(t) => {
                const v = numberText(t);
                if (v === null || v < -90 || v > 90) return false;
                setGround(v, mission.groundStation.lon);
                return true;
              }}
            />
          </label>
          <label className="text-[9px] text-ink-3">
            Lon
            <TextCell
              ariaLabel="Ground station longitude"
              value={mission.groundStation.lon.toFixed(5)}
              className="mt-0.5 w-full"
              onCommit={(t) => {
                const v = numberText(t);
                if (v === null || v < -180 || v > 180) return false;
                setGround(mission.groundStation.lat, v);
                return true;
              }}
            />
          </label>
        </div>
        <p className="mt-1 text-[10px] leading-4 text-ink-3">
          Drag the ground station on the map. The dashed ring is the datalink range.
        </p>
      </Section>

      <Section
        title={`Landing sites ${mission.customSites.length}`}
        right={
          <button
            className={`${SMALL_BUTTON} border border-rule bg-sheet px-2 py-0.5`}
            disabled={mode === 'add-site'}
            onClick={startSite}
          >
            Add landing site
          </button>
        }
      >
        {mode === 'add-site' ? (
          <div className="border border-rule border-l-2 border-l-caution p-2">
            <div className="text-[11px] text-ink">
              Click the map to place the site.
            </div>
            <button className={`${SMALL_BUTTON} mt-1 h-6 border border-rule bg-sheet px-2`} onClick={cancel}>
              Cancel
            </button>
          </div>
        ) : (
          <p className="text-[10px] leading-4 text-ink-3">
            Custom strips, fields and helipads join the bundled airports as alternates within 400 km.
          </p>
        )}
      </Section>

      <div className="flex flex-col gap-0.5 px-1 py-1">
        {mission.customSites.length === 0 && (
          <div className="px-2 py-3 text-[11px] text-ink-3">No custom landing sites.</div>
        )}
        {mission.customSites.map((site) => {
          const selected = site.id === selectedSiteId;
          return (
            <div
              key={site.id}
              className={`border-l-2 ${selected ? 'border-steel bg-paper' : 'border-transparent bg-sheet'}`}
            >
              <div className="flex items-center gap-1 px-1 py-1">
                <button
                  className="flex min-w-0 flex-1 items-baseline gap-1.5 border-0 bg-transparent px-1 py-0.5 text-left hover:border-0"
                  onClick={() => selectSite(selected ? null : site.id)}
                  aria-expanded={selected}
                >
                  <span className="truncate font-mono text-[11px] tracking-[0.04em] text-ink">
                    {site.name}
                  </span>
                  <span className="shrink-0 font-mono text-[9px] text-ink-3">{site.type}</span>
                  <span className="num shrink-0 font-mono text-[9px] text-ink-3">{site.elevM} M</span>
                </button>
                <button
                  className="border-0 bg-transparent px-1 font-mono text-[12px] text-ink-3 hover:text-ink"
                  title={`Delete site ${site.name}`}
                  aria-label={`Delete site ${site.name}`}
                  onClick={() => removeSite(site.id)}
                >
                  ×
                </button>
              </div>
              {selected && (
                <div className="flex flex-col gap-1.5 px-2 pb-2">
                  <label className="text-[9px] text-ink-3">
                    Name
                    <TextCell
                      ariaLabel={`Name of site ${site.name}`}
                      value={site.name}
                      className="mt-0.5 w-full"
                      onCommit={(t) => {
                        if (!t.trim()) return false;
                        updateSite(site.id, { name: t });
                        return true;
                      }}
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-1">
                    <label className="text-[9px] text-ink-3">
                      Latitude
                      <TextCell
                        ariaLabel={`Latitude of ${site.name}`}
                        value={site.lat.toFixed(5)}
                        className="mt-0.5 w-full"
                        onCommit={(t) => {
                          const v = numberText(t);
                          if (v === null || v < -90 || v > 90) return false;
                          updateSite(site.id, { lat: v });
                          return true;
                        }}
                      />
                    </label>
                    <label className="text-[9px] text-ink-3">
                      Longitude
                      <TextCell
                        ariaLabel={`Longitude of ${site.name}`}
                        value={site.lon.toFixed(5)}
                        className="mt-0.5 w-full"
                        onCommit={(t) => {
                          const v = numberText(t);
                          if (v === null || v < -180 || v > 180) return false;
                          updateSite(site.id, { lon: v });
                          return true;
                        }}
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <label className="text-[9px] text-ink-3">
                      Type
                      <select
                        aria-label={`Type of site ${site.name}`}
                        value={site.type}
                        onChange={(e) =>
                          updateSite(site.id, { type: e.target.value as 'STRIP' | 'FIELD' | 'HELIPAD' })
                        }
                        className="mt-0.5 h-[22px] w-full font-mono text-[10px]"
                      >
                        {SITE_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[9px] text-ink-3">
                      ELEV M
                      <TextCell
                        ariaLabel={`Elevation of ${site.name}`}
                        value={String(site.elevM)}
                        className="mt-0.5 w-full"
                        onCommit={(t) => {
                          const v = numberText(t);
                          if (v === null || v < -500 || v > 9000) return false;
                          updateSite(site.id, { elevM: v });
                          return true;
                        }}
                      />
                    </label>
                  </div>
                  <button
                    className={`${SMALL_BUTTON} h-6 border border-rule bg-sheet px-2`}
                    onClick={() => {
                      void fetchTerrain([{ lat: site.lat, lon: site.lon }]).then((patch) => {
                        const elev = patch[terrainKey(site.lat, site.lon)];
                        if (elev !== undefined) updateSite(site.id, { elevM: elev });
                      });
                    }}
                  >
                      Fetch terrain elevation
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function LibraryTab() {
  const mission = useMissionStore((s) => s.mission);
  const saved = useMissionStore((s) => s.saved);
  const loadTemplate = useMissionStore((s) => s.loadTemplate);
  const resetToTemplate = useMissionStore((s) => s.resetToTemplate);
  const saveMission = useMissionStore((s) => s.saveMission);
  const loadSaved = useMissionStore((s) => s.loadSavedMission);
  const duplicateSaved = useMissionStore((s) => s.duplicateSavedMission);
  const deleteSaved = useMissionStore((s) => s.deleteSavedMission);
  const exportMission = useMissionStore((s) => s.exportMission);
  const importMission = useMissionStore((s) => s.importMission);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const activeTemplate = TEMPLATE_LIST.find((t) => t.id === mission.templateId);

  const download = () => {
    const blob = new Blob([exportMission()], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${mission.name.replace(/[^A-Za-z0-9._-]+/g, '_') || 'mission'}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Section
        title="Templates"
        right={<span className="font-mono text-[9px] text-ink-3">Illustrative</span>}
      >
        <div className="flex flex-col gap-1">
          {TEMPLATE_LIST.map((t) => {
            const active = t.id === mission.templateId;
            return (
              <div key={t.id} className={`border p-1.5 ${active ? 'border-steel' : 'border-rule'}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`font-condensed text-[15px] font-semibold ${active ? 'text-ink' : 'text-ink'}`}>
                    {t.name}
                  </span>
                  <button
                    className={`${SMALL_BUTTON} border border-rule px-1.5 py-0.5`}
                    disabled={active}
                    onClick={() => loadTemplate(t.id)}
                  >
                    {active ? 'Active' : 'Load'}
                  </button>
                </div>
                <div className="mt-0.5 text-[10px] leading-4 text-ink-3">
                  {t.region} - {t.description}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex gap-1">
          <button
            className={`${SMALL_BUTTON} h-7 flex-1 border border-rule bg-sheet px-2`}
            disabled={!mission.templateId}
            onClick={resetToTemplate}
            title="Restore the nodes, zones, sites and ground station from the source template"
          >
            Reset to template
          </button>
        </div>
        <div className="mt-1 font-mono text-[9px] text-ink-3">
          Source: {activeTemplate?.name ?? 'Custom / imported'}
        </div>
      </Section>

      <Section title="Saved missions" right={<span className="font-mono text-[9px] text-ink-3">{saved.length}</span>}>
        <button
          className={`${SMALL_BUTTON} h-7 w-full primary`}
          onClick={() => saveMission()}
          title="Save under the mission name shown in the panel on the right"
        >
          Save "{mission.name}"
        </button>
        <div className="mt-1 flex flex-col gap-1">
          {saved.length === 0 && (
            <div className="px-1 py-2 text-[10px] text-ink-3">No saved missions in this browser.</div>
          )}
          {saved.map((s) => (
            <div key={s.id} className="border border-rule p-1.5">
              <div className="truncate font-mono text-[11px] tracking-[0.04em] text-ink">
                {s.name}
              </div>
              <div className="font-mono text-[9px] text-ink-3">{s.savedAt.slice(0, 16).replace('T', ' ')}</div>
              <div className="mt-1 flex gap-1">
                <button className={`${SMALL_BUTTON} h-6 flex-1 border border-rule px-1`} onClick={() => loadSaved(s.id)}>
                  Load
                </button>
                <button className={`${SMALL_BUTTON} h-6 flex-1 border border-rule px-1`} onClick={() => duplicateSaved(s.id)}>
                  Duplicate
                </button>
                <button
                  className={`${SMALL_BUTTON} h-6 border border-rule px-1.5 text-ink`}
                  onClick={() => deleteSaved(s.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="GeoJSON">
        <div className="flex gap-1">
          <button className={`${SMALL_BUTTON} h-7 flex-1 border border-rule bg-sheet px-2`} onClick={download}>
            Export
          </button>
          <button
            className={`${SMALL_BUTTON} h-7 flex-1 border border-rule bg-sheet px-2`}
            onClick={() => fileRef.current?.click()}
          >
            Import
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".geojson,.json,application/geo+json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              void file.text().then((text) => {
                const res = importMission(text);
                setImportError(res.ok ? null : res.error);
              });
            }}
          />
        </div>
        {importError && <div className="mt-1 font-mono text-[10px] leading-4 text-ink">Import: {importError}</div>}
        <p className="mt-1 text-[10px] leading-4 text-ink-3">
          Route as LineString, nodes and sites as Points with properties, zones as Polygons.
        </p>
      </Section>
    </>
  );
}

function SearchBox() {
  const query = useMissionStore((s) => s.searchQuery);
  const status = useMissionStore((s) => s.searchStatus);
  const results = useMissionStore((s) => s.searchResults);
  const setQuery = useMissionStore((s) => s.setSearchQuery);
  const search = useMissionStore((s) => s.search);
  const flyTo = useMissionStore((s) => s.flyTo);
  const addNode = useMissionStore((s) => s.addNodeAt);
  const clear = useMissionStore((s) => s.clearSearch);
  const [activeId, setActiveId] = useState<number | null>(null);

  useEffect(() => setActiveId(null), [results]);
  const active = results.find((r) => r.id === activeId) ?? null;

  return (
    <div className="absolute left-3 top-3 z-10 w-[304px] border border-rule bg-sheet">
      <form
        className="flex items-center gap-1 p-1"
        onSubmit={(e) => {
          e.preventDefault();
          void search(query);
        }}
      >
        <input
          aria-label="Search place or paste coordinates"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search place or lat, lon"
          spellCheck={false}
          className="min-w-0 flex-1 border border-edge bg-paper px-1.5 py-1 font-mono text-[11px] text-ink"
        />
        <button type="submit" className={`${SMALL_BUTTON} h-6 border border-edge bg-panel px-2`}>
          Go
        </button>
        <button
          type="button"
          className="h-6 border-0 bg-transparent px-1 font-mono text-[12px] text-ink-3"
          title="Clear search"
          aria-label="Clear search"
          onClick={clear}
        >
          ×
        </button>
      </form>

      {status === 'loading' && (
        <div className="px-2 pb-1.5 font-mono text-[10px] text-ink-3">Searching…</div>
      )}
      {status === 'error' && (
        <div className="px-2 pb-1.5 font-mono text-[10px] text-ink">
          No matches. Check the name or network.
        </div>
      )}
      {results.length > 0 && (
        <div className="max-h-[190px] overflow-y-auto border-t border-rule">
          {results.map((r) => (
            <button
              key={`${r.id}-${r.lat}-${r.lon}`}
              className={`flex w-full flex-col items-start gap-0 border-b border-l-2 border-rule bg-transparent px-2 py-1 text-left ${
                r.id === activeId ? 'border-l-active-track bg-paper' : 'border-l-transparent'
              }`}
              onClick={() => {
                setActiveId(r.id);
                flyTo(r.lat, r.lon);
              }}
            >
              <span className="font-mono text-[11px] tracking-[0.04em] text-ink">{r.name}</span>
              <span className="font-mono text-[9px] text-ink-3">
                {r.detail || `${r.lat.toFixed(5)}, ${r.lon.toFixed(5)}`}
              </span>
            </button>
          ))}
        </div>
      )}
      {active && (
        <div className="border-t border-rule p-1">
          <button
            className={`${SMALL_BUTTON} h-7 w-full primary`}
            onClick={() => addNode(active.lat, active.lon)}
          >
            Add node here
          </button>
        </div>
      )}
      <div className="border-t border-rule px-2 py-1 font-mono text-[9px] tracking-[0.04em] text-ink-3">
        Pasted "lat, lon" coordinates are accepted
      </div>
    </div>
  );
}

function PreflightPanel({ report, terrainFetching }: { report: PreflightReport; terrainFetching: boolean }) {
  return (
    <Section
      title="Pre-flight checks"
      right={
        terrainFetching ? (
          <span className="font-mono text-[9px] text-ink">Terrain…</span>
        ) : (
          <span className="font-mono text-[9px] text-ink-3">Six checks</span>
        )
      }
    >
      <div className="flex flex-col gap-1.5">
        {report.checks.map((check) => (
          <div key={check.id} className="border-t border-rule pt-1.5">
            <div className="flex items-start gap-2">
              <span
                className={`mt-0.5 w-[58px] shrink-0 border border-rule border-l-2 px-1 py-0.5 text-center font-mono text-[9px] text-ink ${
                  STATUS_BORDER[check.status]
                }`}
              >
                {label(check.status)}
              </span>
              <div className="min-w-0">
                <div className="font-mono text-[9px] tracking-[0.08em] text-ink-3">{check.label}</div>
                <p className="text-[11px] leading-[15px] text-ink">{check.sentence}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function AssessmentPanel() {
  const runs = useMissionStore((s) => s.runs);
  const seed = useMissionStore((s) => s.seed);
  const setRuns = useMissionStore((s) => s.setRuns);
  const setSeed = useMissionStore((s) => s.setSeed);
  const running = useMissionStore((s) => s.mcRunning);
  const done = useMissionStore((s) => s.mcDone);
  const total = useMissionStore((s) => s.mcTotal);
  const result = useMissionStore((s) => s.mcResult);
  const resultKey = useMissionStore((s) => s.mcResultKey);
  const error = useMissionStore((s) => s.mcError);
  const run = useMissionStore((s) => s.runAssessment);
  const mission = useMissionStore((s) => s.mission);
  const weather = useMissionStore((s) => s.weather);
  const nodes = mission.nodes.length;

  const inputKey = useMemo(
    () => missionInputKey(mission, weather, runs, seed),
    [mission, weather, runs, seed],
  );
  const current = result !== null && resultKey === inputKey;
  const stale = result !== null && !current;
  const progress = total > 0 ? Math.max(0, Math.min(100, (done / total) * 100)) : 0;

  return (
    <Section
      title="Mission risk"
      right={
        stale ? (
          <span className="border border-rule border-l-2 border-l-caution px-1.5 py-0.5 font-mono text-[9px] text-ink">
            Outdated
          </span>
        ) : undefined
      }
    >
      <div className="grid grid-cols-2 gap-1">
        <label className="text-[9px] text-ink-3">
          Runs
          <TextCell
            ariaLabel="Monte Carlo run count"
            value={String(runs)}
            className="mt-0.5 w-full"
            onCommit={(t) => {
              const v = numberText(t);
              if (v === null) return false;
              setRuns(v);
              return true;
            }}
          />
        </label>
        <label className="text-[9px] text-ink-3">
          Seed
          <TextCell
            ariaLabel="Monte Carlo seed"
            value={String(seed)}
            className="mt-0.5 w-full"
            onCommit={(t) => {
              const v = numberText(t);
              if (v === null || v < 0) return false;
              setSeed(v);
              return true;
            }}
          />
        </label>
      </div>

      {error && (
        <div className="mt-2 border-l-2 border-critical pl-2 font-mono text-[11px] leading-4 text-ink">
          {error}
        </div>
      )}

      {running ? (
        <div className="mt-2">
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink">
            <span aria-hidden="true" className="h-3 w-[2px] bg-caution" />
            Assessing
          </div>
          <div className="mt-1 h-1 w-full bg-rule">
            <div className="h-full bg-steel transition-[width]" style={{ width: `${progress}%` }} />
          </div>
          <div className="num mt-1 font-mono text-[10px] text-ink-3">
            {done}/{total} runs
          </div>
        </div>
      ) : result ? (
        <div className={stale ? 'opacity-55' : ''}>
          <div className="mt-1 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`h-7 w-1 ${VERDICT_BAR[result.verdict] ?? 'bg-rule-strong'}`}
              />
              <span className="font-condensed text-[30px] font-semibold leading-[34px] text-ink">
                {label(result.verdict)}
              </span>
            </div>
            <span className="num font-mono text-[12px] text-ink">
              {(result.completedFrac * 100).toFixed(1)}% complete
            </span>
          </div>
          <div className="font-mono text-[10px] text-ink-3">
            {result.runs} runs, seed {result.seed}, dt {result.dtS} s
          </div>
          {stale && (
            <p className="mt-1 text-[11px] leading-4 text-ink">
              The mission changed after this assessment. Re-assess before flying.
            </p>
          )}
          <div className="mt-2 flex flex-col gap-1">
            {result.factors.length === 0 ? (
              <p className="text-[11px] leading-4 text-ink-3">
                {result.completedFrac >= 1
                  ? 'No failed runs; no factor separated the sample.'
                  : 'No dominant factor in the failed runs.'}
              </p>
            ) : (
              result.factors
                .slice(0, 3)
                .map((f) => (
                  <p key={f.label} className="text-[11px] leading-4 text-ink">
                    {factorSentence(f)}
                  </p>
                ))
            )}
          </div>
        </div>
      ) : (
        <div className="mt-2 flex items-baseline justify-between">
          <span className="font-mono text-[12px] text-ink-3">Not assessed</span>
          <span className="font-mono text-[9px] text-ink-3">{runs} runs</span>
        </div>
      )}

      <button
        className="mt-2 h-9 w-full primary font-mono text-[11px] disabled:border-edge disabled:bg-panel disabled:text-dim"
        disabled={running || nodes < 2}
        onClick={() => void run()}
      >
        {running ? `Assessing ${done}/${total}` : stale ? 'Re-assess mission' : 'Assess mission'}
      </button>
    </Section>
  );
}

export default function BriefStage() {
  const mission = useMissionStore((s) => s.mission);
  const weather = useMissionStore((s) => s.weather);
  const terrain = useMissionStore((s) => s.terrain);
  const terrainFetching = useMissionStore((s) => s.terrainFetching);
  const fetchingWx = useMissionStore((s) => s.fetchingWx);
  const wxNotice = useMissionStore((s) => s.wxNotice);
  const notice = useMissionStore((s) => s.notice);
  const dismissNotice = useMissionStore((s) => s.dismissNotice);
  const mode = useMissionStore((s) => s.mode);
  const draftZone = useMissionStore((s) => s.draftZone);
  const pastLen = useMissionStore((s) => s.past.length);
  const futureLen = useMissionStore((s) => s.future.length);
  const undo = useMissionStore((s) => s.undo);
  const redo = useMissionStore((s) => s.redo);
  const cancelMode = useMissionStore((s) => s.cancelMode);
  const setWeatherMode = useMissionStore((s) => s.setWeatherMode);
  const refreshWeather = useMissionStore((s) => s.refreshWeather);
  const setEngineProfile = useMissionStore((s) => s.setEngineProfile);

  const scenarioId = useRehearsalStore((s) => s.scenarioId);
  const setScenarioId = useRehearsalStore((s) => s.setScenarioId);
  const start = useRehearsalStore((s) => s.start);

  const [tab, setTab] = useState<EditorTab>('route');

  const waypoints = useMemo(() => resolveWaypoints(mission), [mission, terrain]);
  const wx = useMemo(() => weatherValues(weather), [weather]);
  const preflight = useMemo(
    () => buildPreflight(mission, waypoints, wx),
    [mission, waypoints, wx, terrain],
  );
  const distanceM = useMemo(() => missionTrackDistanceM(mission), [mission]);

  const tagCounts = useMemo(() => {
    const counts = { LIVE: 0, MANUAL: 0, FALLBACK: 0 };
    for (const cell of weather) counts[weatherTag(cell)] += 1;
    return counts;
  }, [weather]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'SELECT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (e.key === 'Escape') {
        const s = useMissionStore.getState();
        if (s.mode !== 'select') {
          e.preventDefault();
          s.cancelMode();
          return;
        }
        if (typing) return;
        s.selectNode(null);
        return;
      }
      if (typing) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) useMissionStore.getState().redo();
        else useMissionStore.getState().undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        useMissionStore.getState().redo();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const s = useMissionStore.getState();
        if (s.selectedNodeId !== null) {
          e.preventDefault();
          s.deleteNode(s.selectedNodeId);
        } else if (s.selectedZoneId !== null) {
          e.preventDefault();
          s.deleteZone(s.selectedZoneId);
        } else if (s.selectedSiteId !== null) {
          e.preventDefault();
          s.deleteSite(s.selectedSiteId);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const tabs: { id: EditorTab; label: string; count: number }[] = [
    { id: 'route', label: 'Route', count: mission.nodes.length },
    { id: 'zones', label: 'Zones', count: mission.zones.length },
    { id: 'sites', label: 'Sites', count: mission.customSites.length },
    { id: 'missions', label: 'Missions', count: 0 },
  ];

  return (
    <div className="flex h-full flex-col bg-paper font-sans text-ink">
      <StageHeader stage="brief" />

      <div className="grid min-h-0 flex-1 grid-cols-[344px_minmax(0,1fr)_400px]">
        <aside className="flex min-h-0 flex-col border-r border-rule bg-sheet">
          <div className="grid shrink-0 grid-cols-4 border-b border-rule">
            {tabs.map((t) => (
              <button
                key={t.id}
                aria-pressed={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`h-8 border-b-2 border-r border-rule bg-transparent px-1 font-mono text-[10px] last:border-r-0 ${
                  tab === t.id
                    ? 'border-b-active-track text-ink'
                    : 'border-b-transparent text-ink-3'
                }`}
              >
                {t.label}
                {t.id !== 'missions' && <span className="num ml-1 text-[9px]">{t.count}</span>}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === 'route' && <RouteTab waypoints={waypoints} weather={weather} />}
            {tab === 'zones' && <ZonesTab hits={preflight.zoneHits} />}
            {tab === 'sites' && <SitesTab />}
            {tab === 'missions' && <LibraryTab />}
          </div>
        </aside>

        <div className="relative min-h-0 min-w-0">
          <RehearsalMap
            mission={mission}
            waypoints={waypoints}
            weather={weather}
            editor
            height="100%"
            fitPadding={{ top: 88, right: 48, bottom: 56, left: 48 }}
          />
          <SearchBox />

          <div className="absolute right-3 top-3 z-10 flex items-center gap-1 border border-rule bg-sheet p-1">
            <button
              className={`${SMALL_BUTTON} h-6 border border-rule bg-sheet px-2`}
              disabled={pastLen === 0}
              onClick={undo}
              title="Undo (Ctrl+Z)"
            >
              Undo {pastLen > 0 ? `(${pastLen})` : ''}
            </button>
            <button
              className={`${SMALL_BUTTON} h-6 border border-rule bg-sheet px-2`}
              disabled={futureLen === 0}
              onClick={redo}
              title="Redo (Ctrl+Y)"
            >
              Redo {futureLen > 0 ? `(${futureLen})` : ''}
            </button>
            <span className="num px-1 font-mono text-[9px] text-ink-3">
              {mission.nodes.length}/{MAX_NODES}
            </span>
          </div>

          <div className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-[70%] border border-rule bg-sheet px-2 py-1 font-mono text-[9px] text-ink-3">
            {mode === 'draw-zone'
              ? `Draw zone, ${draftZone.length} vertices. Double-click or finish; Esc cancels.`
              : mode === 'add-site'
                ? 'Place landing site. Click the map; Esc cancels.'
                : 'Click map to add a node. Drag nodes, + inserts, Delete removes.'}
          </div>

          {mode !== 'select' && (
            <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 border border-rule border-l-2 border-l-caution bg-sheet px-2 py-1">
              <span className="font-mono text-[10px] text-ink">
                {mode === 'draw-zone' ? 'Zone draw active' : 'Site placement active'}
              </span>
              <button
                className={`${SMALL_BUTTON} h-6 border border-rule bg-sheet px-2`}
                onClick={cancelMode}
              >
                Cancel (Esc)
              </button>
              {mode === 'draw-zone' && (
                <button
                  className={`${SMALL_BUTTON} h-6 primary px-2`}
                  disabled={draftZone.length < 3}
                  onClick={() => useMissionStore.getState().finishZone()}
                >
                  Finish
                </button>
              )}
            </div>
          )}

          {notice && (
            <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 border border-rule border-l-2 border-l-ok bg-sheet px-3 py-1.5">
              <span className="font-mono text-[10px] text-ink">{notice}</span>
              <button
                className="border-0 bg-transparent px-1 font-mono text-[11px] text-ink-3"
                onClick={dismissNotice}
                aria-label="Dismiss notice"
              >
                ×
              </button>
            </div>
          )}
        </div>

        <aside className="flex min-h-0 flex-col border-l border-rule bg-sheet">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Section title="Mission">
              <MissionNameField name={mission.name} />
              <div className="mt-1 font-mono text-[9px] text-ink-3">
                {mission.region ?? 'Custom route'} · {mission.templateId ? 'Template' : 'Imported'}
              </div>
              <div className="mt-2 text-[9px] text-ink-3">
                Start (IST)
                <StartTimeField iso={mission.startTimeUTC} />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1">
                <label className="text-[9px] text-ink-3">
                  Weather
                  <select
                    aria-label="Weather mode"
                    value={mission.weatherMode}
                    onChange={(e) => setWeatherMode(e.target.value as 'forecast' | 'manual')}
                    className="mt-0.5 h-[24px] w-full font-mono text-[10px]"
                  >
                    <option value="forecast">Forecast</option>
                    <option value="manual">Manual</option>
                  </select>
                </label>
                <label className="text-[9px] text-ink-3">
                  Engine
                  <select
                    aria-label="Engine profile"
                    value={mission.engineProfileId}
                    onChange={(e) => setEngineProfile(e.target.value)}
                    className="mt-0.5 h-[24px] w-full font-mono text-[9px]"
                  >
                    {ENGINE_PROFILES.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-2">
                <Meta label="Nodes" value={`${mission.nodes.length} / ${MAX_NODES}`} />
                <Meta label="Route" value={`${(distanceM / 1000).toFixed(1)} km`} />
                <Meta label="Duration" value={fmtHM(preflight.plan.totalS)} />
                <Meta
                  label="Weather sources"
                  value={`${tagCounts.LIVE} live · ${tagCounts.MANUAL} manual · ${tagCounts.FALLBACK} fallback`}
                />
              </div>
            </Section>

            <Section
              title="Weather input"
              right={
                <button
                  className={`${SMALL_BUTTON} h-6 border border-rule bg-sheet px-2`}
                  disabled={fetchingWx}
                  onClick={() => void refreshWeather()}
                >
                  {fetchingWx ? 'Fetching…' : 'Refresh'}
                </button>
              }
            >
              <p className="text-[11px] leading-[16px] text-ink">
                {weatherSentence(
                  wx,
                  mission.weatherMode === 'manual' ? 'Manual weather' : 'Forecast at mission start',
                )}
              </p>
              {wxNotice && (
                <div className="mt-1 font-mono text-[9px] text-ink">
                  {wxNotice}
                </div>
              )}
              {mission.weatherMode === 'manual' && (
                <div className="mt-1 text-[10px] text-ink-3">
                  Live forecast off. Use per-node overrides.
                </div>
              )}
            </Section>

            <PreflightPanel report={preflight} terrainFetching={terrainFetching} />
            <AssessmentPanel />

            <Section title="Scenario">
              <div className="flex flex-col gap-1">
                {SCENARIO_SCRIPTS.map((script) => {
                  const active = script.id === scenarioId;
                  return (
                    <button
                      key={script.id}
                      aria-pressed={active}
                      onClick={() => setScenarioId(script.id as ScenarioId)}
                      className={`border border-rule border-l-2 p-2 text-left ${
                        active
                          ? 'border-edge border-l-active-track bg-paper'
                          : 'border-l-transparent bg-sheet hover:border-steel'
                      }`}
                    >
                      <div className="font-condensed text-[15px] font-semibold text-ink">
                        {script.title}
                      </div>
                      <div className="mt-1 text-[10px] leading-4 text-ink-3">{script.blurb}</div>
                    </button>
                  );
                })}
              </div>
            </Section>
          </div>

          <div className="shrink-0 border-t border-rule p-3">
            <button
              className="h-10 w-full primary font-condensed text-[15px] font-semibold disabled:border-rule disabled:bg-sheet disabled:text-ink-3"
              disabled={waypoints.length < 2}
              onClick={start}
            >
              Run rehearsal
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
