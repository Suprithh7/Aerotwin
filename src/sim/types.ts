export type Phase = 'takeoff' | 'climb' | 'cruise' | 'loiter' | 'descent';
export type TurbulenceLevel = 'none' | 'light' | 'moderate' | 'severe';

export interface Scenario {
  phase: Phase;
  turbulence: TurbulenceLevel;
  isaDev: number; // deg C offset from ISA
  altitude: number; // m MSL
}

export type EngineFaultKind =
  | 'misfire'
  | 'injector'
  | 'cooling'
  | 'oil'
  | 'ignition'
  | 'turbo'
  | 'compression'
  | 'exhaust';

export type SensorFaultKind = 'drift' | 'stuck' | 'noise';

export interface FaultSpec {
  id: number;
  scope: 'engine' | 'sensor';
  kind: EngineFaultKind | SensorFaultKind;
  severity: number; // 0..1
  rampTime: number; // seconds
  cylinder?: number; // 1..4 for cylinder-specific engine faults
  channel?: ChannelId; // sensor faults only
  tInject: number; // sim time when injected
}

export type ChannelId =
  | 'rpm'
  | 'map'
  | 'boost'
  | 'ff'
  | 'afr'
  | 'cht1'
  | 'cht2'
  | 'cht3'
  | 'cht4'
  | 'egt1'
  | 'egt2'
  | 'egt3'
  | 'egt4'
  | 'oilT'
  | 'oilP'
  | 'vib'
  | 'pwr'
  | 'fuel';

export type Channels = Record<ChannelId, number>;

export interface ChannelMeta {
  id: ChannelId;
  label: string;
  unit: string;
  noiseSigma: number; // sensor noise 1-sigma, units of channel
  driftRange: number; // full severity drift magnitude for sensor drift faults
}

export interface ActiveFaultInfo {
  id: number;
  label: string;
  scope: 'engine' | 'sensor';
  kind: string;
  severity: number;
  rampTime: number;
  cylinder?: number;
  channel?: ChannelId;
  tInject: number;
  elapsed: number;
  ramped: boolean;
}

export interface ChannelReading {
  true: number;
  measured: number;
  twin: number;
  residual: number;
  z: number;
  zEwma: number;
}

export interface Snapshot {
  t: number; // sim time, s
  phase: Phase;
  readings: Record<ChannelId, ChannelReading>;
  faults: ActiveFaultInfo[];
  scenario: Scenario;
  seed: number;
  densityAltitude: number; // m
  sigmaRatio: number;
  oatC: number; // outside air temp, deg C
}

export interface HistPoint {
  t: number;
  m: Partial<Channels>;
  tw: Partial<Channels>;
  z: Partial<Channels>;
}
