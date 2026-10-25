import type { ScenarioId, ScenarioScript } from './types';

/**
 * Scenario scripts. Fault severities and ramps are calibration values: the
 * cooling fault must reach a detectable twin disagreement without running into
 * a measured hard limit, and the sensor drift must stay below the hard limit so
 * the twin's disagreement is a false alarm (see ASSUMPTIONS.md).
 *
 * Data Guard cards use severity 0.6 on cylinder 3: the twin flags around 32 s
 * into the compressed rehearsal, while the measured CHT stays below 135 C
 * through all 120 s. The friendly-area card injects the same fault at 57 % of
 * the route; detection follows after the aircraft has left the denied area, so
 * a reachable alternate keeps the data encrypted onboard.
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
    id: 'cooling-denied',
    title: 'COOLING OVER DENIED AREA',
    blurb:
      'Cylinder 3 cooling fails at the start of the mission and the link is up. The guard offloads priority data, then erases the key over the denied area.',
    sensorOnly: false,
    triggerFrac: 0,
    fault: {
      scope: 'engine',
      kind: 'cooling',
      severity: 0.6,
      rampTime: 30,
      cylinder: 3,
    },
  },
  {
    id: 'cooling-jammed',
    title: 'FAILURE + LINK JAMMED',
    blurb:
      'The same cooling failure with the datalink jammed from the start. The guard erases immediately and the unsent items are lost.',
    sensorOnly: false,
    triggerFrac: 0,
    fault: {
      scope: 'engine',
      kind: 'cooling',
      severity: 0.6,
      rampTime: 30,
      cylinder: 3,
    },
    jam: true,
  },
  {
    id: 'cooling-friendly',
    title: 'FAILURE OVER FRIENDLY AREA',
    blurb:
      'The same cooling failure late in the route, after the aircraft has left the denied area. A friendly alternate is reachable: data stays encrypted onboard and the offload continues.',
    sensorOnly: false,
    triggerFrac: 0.57,
    fault: {
      scope: 'engine',
      kind: 'cooling',
      severity: 0.6,
      rampTime: 30,
      cylinder: 3,
    },
  },
  {
    id: 'sensor',
    title: 'SENSOR GLITCH',
    blurb: 'False alarm: CHT 1 drifts high, engine healthy. Data Guard never escalates.',
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
