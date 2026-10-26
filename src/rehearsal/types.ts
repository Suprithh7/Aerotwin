import type { ChannelId, EngineFaultKind, SensorFaultKind } from '../sim/types';
import type { DataGuardDebrief } from '../payload/types';

export type Stage = 'brief' | 'fly' | 'debrief';

export type ScenarioId =
  | 'normal'
  | 'cooling-denied'
  | 'cooling-jammed'
  | 'cooling-friendly'
  | 'sensor';

export type Outcome = 'complete' | 'aborted' | 'lost';

export interface ScenarioFault {
  scope: 'engine' | 'sensor';
  kind: EngineFaultKind | SensorFaultKind;
  severity: number;
  rampTime: number;
  cylinder?: number;
  channel?: ChannelId;
}

export interface ScenarioScript {
  id: ScenarioId;
  title: string;
  blurb: string;
  /** True when the script injects a sensor-only fault: the twin may misdiagnose it. */
  sensorOnly: boolean;
  /** Fraction of the planned mission at which the fault is injected; null = none. */
  triggerFrac: number | null;
  fault: ScenarioFault | null;
  /** The datalink is jammed from the start of the rehearsal. */
  jam?: boolean;
}

export type EventTone = 'info' | 'caution' | 'alert';

export interface RehearsalEvent {
  id: number;
  /** Wall time, ms, for ticker fading only. */
  atMs: number;
  /** Mission clock, s, for the debrief timeline. */
  missionS: number;
  label: string;
  text: string;
  tone: EventTone;
  tick: boolean;
}

export interface TimelineTick {
  missionS: number;
  label: string;
}

export interface DirectorInjectionSummary {
  missionS: number;
  label: string;
  scope: 'engine' | 'sensor' | 'link' | 'weather';
  surprise: boolean;
  /** Sim seconds from injection to the first system announcement. */
  detectedS: number | null;
}

export interface DebriefResult {
  outcome: Outcome;
  /** Planned mission clock at the destination, s. */
  plannedS: number;
  missionS: number;
  flightS: number;
  distanceKm: number;
  engineLifePct: number;
  lifeEqH: number;
  leadLine: string;
  sensorOnly: boolean;
  ticks: TimelineTick[];
  dataGuard?: DataGuardDebrief;
  director?: DirectorInjectionSummary[];
}
