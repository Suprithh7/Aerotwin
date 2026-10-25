import type { ScenarioId, ScenarioScript } from './types';

/**
 * Scenario scripts. Fault severities and ramps are calibration values: the
 * cooling fault must reach a CHT limit after a detectable warning, and the
 * sensor drift must stay below the hard limit so the twin's disagreement is a
 * false alarm (see ASSUMPTIONS.md).
 */
export const SCENARIO_SCRIPTS: ScenarioScript[] = [
  {
    id: 'normal',
    title: 'NORMAL FLIGHT',
    blurb: 'No faults. Fly the planned route as briefed.',
    sensorOnly: false,
    triggerFrac: null,
    fault: null,
  },
  {
    id: 'cooling',
    title: 'COOLING FAILURE',
    blurb: 'Cylinder 3 cooling degrades in cruise.',
    sensorOnly: false,
    triggerFrac: 0.2,
    fault: {
      scope: 'engine',
      kind: 'cooling',
      severity: 0.8,
      rampTime: 30,
      cylinder: 3,
    },
  },
  {
    id: 'sensor',
    title: 'SENSOR GLITCH',
    blurb: 'False alarm: CHT 1 drifts high, engine healthy.',
    sensorOnly: true,
    triggerFrac: 0.2,
    fault: {
      scope: 'sensor',
      kind: 'drift',
      severity: 0.5,
      rampTime: 10,
      channel: 'cht1',
    },
  },
];

export function scriptById(id: ScenarioId): ScenarioScript {
  return SCENARIO_SCRIPTS.find((s) => s.id === id) ?? SCENARIO_SCRIPTS[0];
}

export function triggerMissionS(script: ScenarioScript, missionS: number): number | null {
  if (script.triggerFrac === null) return null;
  return script.triggerFrac * missionS;
}
