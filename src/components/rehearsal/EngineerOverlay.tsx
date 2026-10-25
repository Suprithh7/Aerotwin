import { useMemo, useState } from 'react';
import TopBar from '../TopBar';
import FaultPanel from '../FaultPanel';
import ScenarioPanel from '../ScenarioPanel';
import StripCharts from '../StripCharts';
import EngineSchematic from '../EngineSchematic';
import DiagnosisPanel from '../DiagnosisPanel';
import RehearsalMap from './RehearsalMap';
import { SyntheticChip } from './StageHeader';
import {
  currentPlan,
  missionInputKey,
  useMissionStore,
} from '../../mission/missionStore';
import { resolveWaypoints } from '../../mission/terrain';
import { useSimStore } from '../../state/store';

const REPLAY_CYCLE_S = 600;

type OverlayTab = 'engineer' | 'validation';

function MissionClock() {
  const t = useSimStore((s) => s.snapshot?.t ?? 0);
  const mission = useMissionStore((s) => s.mission);
  const weather = useMissionStore((s) => s.weather);
  const waypoints = useMemo(() => resolveWaypoints(mission), [mission]);
  const totalS = currentPlan(waypoints, weather).totalS;
  const clockS = ((t % REPLAY_CYCLE_S) / REPLAY_CYCLE_S) * totalS;
  return (
    <RehearsalMap
      mission={mission}
      waypoints={waypoints}
      weather={weather}
      clockS={clockS}
      height="15rem"
      showMarker
    />
  );
}

function ValidationView() {
  const mission = useMissionStore((s) => s.mission);
  const weather = useMissionStore((s) => s.weather);
  const runs = useMissionStore((s) => s.runs);
  const seed = useMissionStore((s) => s.seed);
  const result = useMissionStore((s) => s.mcResult);
  const resultKey = useMissionStore((s) => s.mcResultKey);
  const waypoints = useMemo(() => resolveWaypoints(mission), [mission]);
  const current = result !== null && resultKey === missionInputKey(mission, weather, runs, seed);

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col border-r border-edge">
        <div className="flex min-h-0 flex-1 flex-col">
          <RehearsalMap mission={mission} waypoints={waypoints} weather={weather} height="100%" />
        </div>
        <div className="num shrink-0 border-t border-edge bg-panel px-3 py-2 font-mono text-[11px] text-dim">
          {current
            ? `ROUTE ${waypoints.length} NODES - ${result.runs} RUNS, SEED ${result.seed}`
            : 'RUN ASSESS MISSION IN BRIEF TO POPULATE THE VALIDATION VIEW'}
        </div>
      </div>
      <div className="w-[26rem] shrink-0 overflow-y-auto p-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim">Mission</div>
        <div className="mt-1 font-mono text-[14px] uppercase tracking-[0.06em] text-txt">
          {mission.name}
        </div>
        <div className="mt-0.5 text-[12px] leading-4 text-dim">
          {waypoints.length} nodes - {mission.zones.length} zones -{' '}
          {mission.customSites.length} custom sites
        </div>

        <div className="mt-4 border-t border-edge pt-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
            Monte Carlo by leg
          </div>
          {current ? (
            <div className="mt-2 flex flex-col">
              {result.legs.map((leg, i) => (
                <div
                  key={`${leg.fromName}-${leg.toName}-${i}`}
                  className="flex items-baseline justify-between gap-2 border-b border-edge py-1"
                >
                  <span className="font-mono text-[11px] text-txt">
                    {leg.fromName} - {leg.toName}
                  </span>
                  <span className="num font-mono text-[11px] text-dim">
                    {(leg.breachFrac * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-[12px] leading-4 text-dim">
              No current result. The BRIEF editor owns the mission and its assessment.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function EngineerOverlay({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<OverlayTab>('engineer');

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg font-sans text-txt">
      <div className="flex h-10 shrink-0 items-center gap-5 border-b border-edge bg-panel px-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-txt">
          ENGINEERING OVERLAY
        </span>
        <nav
          aria-label="Overlay view"
          className="flex items-center gap-4 font-mono text-[11px] uppercase tracking-[0.12em]"
        >
          {(['engineer', 'validation'] as OverlayTab[]).map((id) => (
            <button
              key={id}
              aria-pressed={tab === id}
              onClick={() => setTab(id)}
              className={
                tab === id
                  ? 'text-txt underline decoration-steel underline-offset-4'
                  : 'text-dim hover:text-txt'
              }
            >
              {id.toUpperCase()}
            </button>
          ))}
        </nav>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
          ESC CLOSE
        </span>
        <SyntheticChip />
        <button
          className="h-7 border border-edge px-3 font-mono text-[11px] uppercase tracking-[0.1em] text-txt hover:border-steel"
          onClick={onClose}
        >
          CLOSE
        </button>
      </div>

      <TopBar />

      {tab === 'engineer' ? (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 w-64 shrink-0 flex-col overflow-y-auto border-r border-rule">
            <FaultPanel />
            <DiagnosisPanel />
            <ScenarioPanel />
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <StripCharts />
          </div>
          <div className="flex min-h-0 w-80 shrink-0 flex-col overflow-y-auto border-l border-rule">
            <div className="shrink-0">
              <MissionClock />
            </div>
            <EngineSchematic />
          </div>
        </div>
      ) : (
        <ValidationView />
      )}
    </div>
  );
}
