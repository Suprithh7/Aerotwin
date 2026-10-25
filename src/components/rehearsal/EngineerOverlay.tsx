import { useState } from 'react';
import TopBar from '../TopBar';
import FaultPanel from '../FaultPanel';
import ScenarioPanel from '../ScenarioPanel';
import StripCharts from '../StripCharts';
import EngineSchematic from '../EngineSchematic';
import MissionMap from '../MissionMap';
import MissionPanel from '../MissionPanel';
import DiagnosisPanel from '../DiagnosisPanel';
import { SyntheticChip } from './StageHeader';
import { currentPlan, useMissionStore } from '../../mission/missionStore';
import { useSimStore } from '../../state/store';

const REPLAY_CYCLE_S = 600;

type OverlayTab = 'engineer' | 'validation';

function MissionClock() {
  const t = useSimStore((s) => s.snapshot?.t ?? 0);
  const waypoints = useMissionStore((s) => s.waypoints);
  const weather = useMissionStore((s) => s.weather);
  const totalS = currentPlan(waypoints, weather).totalS;
  const clockS = ((t % REPLAY_CYCLE_S) / REPLAY_CYCLE_S) * totalS;
  return <MissionMap waypoints={waypoints} weather={weather} clockS={clockS} height="15rem" showMarker />;
}

function ValidationView() {
  const waypoints = useMissionStore((s) => s.waypoints);
  const weather = useMissionStore((s) => s.weather);
  const result = useMissionStore((s) => s.mcResult);
  const mcDone = useMissionStore((s) => s.mcDone);
  const mcTotal = useMissionStore((s) => s.mcTotal);
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col border-r border-edge">
        <div className="flex min-h-0 flex-1 flex-col">
          <MissionMap
            waypoints={waypoints}
            weather={weather}
            legRisk={result ? result.legs.map((l) => l.breachFrac) : []}
            clockS={result ? 1 : null}
            showMarker={!!result}
            height="100%"
          />
        </div>
        <div className="shrink-0 border-t border-edge bg-panel px-3 py-2 font-mono text-[11px] text-dim tabular-nums">
          {result
            ? `ROUTE ${waypoints.length} POINTS - LEG COLOURS ARE MONTECARLO BREACH PROBABILITY`
            : `CLICK MAP TO ADD A WAYPOINT - DRAG A MARKER TO MOVE IT - SELECT AND PRESS DEL TO REMOVE${
                mcTotal ? ` (${mcDone}/${mcTotal})` : ''
              }`}
        </div>
      </div>
      <div className="w-[26rem] shrink-0 overflow-y-auto">
        <MissionPanel />
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
        <nav aria-label="Overlay view" className="flex items-center gap-4 font-mono text-[11px] uppercase tracking-[0.12em]">
          {(['engineer', 'validation'] as OverlayTab[]).map((id) => (
            <button
              key={id}
              aria-pressed={tab === id}
              onClick={() => setTab(id)}
              className={tab === id ? 'text-txt underline decoration-steel underline-offset-4' : 'text-dim hover:text-txt'}
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
          <div className="flex min-h-0 w-64 shrink-0 flex-col overflow-y-auto border-r border-edge">
            <FaultPanel />
            <DiagnosisPanel />
            <ScenarioPanel />
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <StripCharts />
          </div>
          <div className="flex min-h-0 w-80 shrink-0 flex-col overflow-y-auto border-l border-edge">
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
