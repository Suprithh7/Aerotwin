import { useState } from 'react';
import TopBar from './components/TopBar';
import FaultPanel from './components/FaultPanel';
import ScenarioPanel from './components/ScenarioPanel';
import StripCharts from './components/StripCharts';
import EngineSchematic from './components/EngineSchematic';
import MissionMap from './components/MissionMap';
import MissionPanel from './components/MissionPanel';
import { currentPlan, useMissionStore } from './mission/missionStore';
import { useSimStore } from './state/store';

// The live monitor replays the planned route on a compressed clock so the
// marker is observable at the sim's own speed multipliers (ASSUMPTIONS.md).
const REPLAY_CYCLE_S = 600;

type Tab = 'monitor' | 'mission';

function useMissionClock(): number {
  const t = useSimStore((s) => s.snapshot?.t ?? 0);
  const waypoints = useMissionStore((s) => s.waypoints);
  const weather = useMissionStore((s) => s.weather);
  const totalS = currentPlan(waypoints, weather).totalS;
  return ((t % REPLAY_CYCLE_S) / REPLAY_CYCLE_S) * totalS;
}

function MissionClock() {
  const waypoints = useMissionStore((s) => s.waypoints);
  const weather = useMissionStore((s) => s.weather);
  const clockS = useMissionClock();
  return <MissionMap waypoints={waypoints} weather={weather} clockS={clockS} height="15rem" showMarker />;
}

export default function App() {
  const [tab, setTab] = useState<Tab>('monitor');
  return (
    <div className="h-full flex flex-col font-sans text-txt">
      <TopBar />
      <nav className="flex shrink-0 border-b border-edge bg-panel">
        {(['monitor', 'mission'] as Tab[]).map((id) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 font-mono text-[11px] uppercase tracking-wider ${
              tab === id ? 'border-b border-steel text-txt' : 'text-dim hover:text-txt'
            }`}
          >
            {id === 'monitor' ? 'Live Monitor' : 'Mission Risk'}
          </button>
        ))}
      </nav>
      {tab === 'monitor' ? (
        <div className="flex-1 flex min-h-0">
          <div className="w-64 shrink-0 border-r border-edge flex flex-col min-h-0 overflow-y-auto">
            <FaultPanel />
            <ScenarioPanel />
          </div>
          <div className="flex-1 min-w-0 flex flex-col">
            <StripCharts />
          </div>
          <div className="w-80 shrink-0 border-l border-edge overflow-y-auto flex flex-col">
            <MissionClock />
            <EngineSchematic />
          </div>
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 min-w-0 flex flex-col border-r border-edge">
            <MissionRiskMap />
          </div>
          <div className="w-[26rem] shrink-0 overflow-y-auto">
            <MissionPanel />
          </div>
        </div>
      )}
    </div>
  );
}

function MissionRiskMap() {
  const waypoints = useMissionStore((s) => s.waypoints);
  const weather = useMissionStore((s) => s.weather);
  const result = useMissionStore((s) => s.mcResult);
  const mcDone = useMissionStore((s) => s.mcDone);
  const mcTotal = useMissionStore((s) => s.mcTotal);
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <MissionMap
        waypoints={waypoints}
        weather={weather}
        legRisk={result ? result.legs.map((l) => l.breachFrac) : []}
        clockS={result ? 1 : null}
        showMarker={!!result}
        height="100%"
      />
      <div className="shrink-0 border-t border-edge bg-panel px-3 py-2 font-mono text-[11px] text-dim tabular-nums">
        {result
          ? `ROUTE ${waypoints.length} POINTS - LEG COLOURS ARE MONTECARLO BREACH PROBABILITY`
          : `CLICK MAP TO ADD A WAYPOINT - DRAG A MARKER TO MOVE IT - SELECT AND PRESS DEL TO REMOVE${
              mcTotal ? ` (${mcDone}/${mcTotal})` : ''
            }`}
      </div>
    </div>
  );
}
