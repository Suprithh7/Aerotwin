// All physical constants here are documented assumptions (see ASSUMPTIONS.md).
import type { ChannelMeta, Phase, Scenario, TurbulenceLevel } from './types';

export const SIM_DT = 0.05; // s, fixed 20 Hz sim step
export const HIST_INTERVAL = 0.1; // s, chart sample stride (10 Hz sim)
export const HIST_WINDOW_S = 120; // s of chart history
export const EWMA_TAU_S = 0.8; // s, residual z-score smoothing time constant

// The app opens here: a settled engine at a normal cruise altitude with no
// faults. Store, worker and headless harness share this one definition.
export const DEFAULT_SCENARIO: Scenario = {
  phase: 'cruise',
  turbulence: 'none',
  isaDev: 0,
  altitude: 3000,
};

export const N_CYL = 4;

// --- Engine geometry / thermodynamics ---
export const ENG = {
  dispM3: 0.003, // total displacement, 3.0 L turbo boxer-4
  veBase: 0.85, // volumetric efficiency, nominal
  lhvJkg: 43.4e6, // jet-fuel surrogate lower heating value, J/kg
  etaBase: 0.32, // peak brake thermal efficiency (nominal)
  mechEff: 0.94, // crank/accessory mechanical efficiency
  chtHeatFrac: 0.54, // fraction of combustion waste heat entering head structure
  exhHeatFrac: 0.3, // fraction of waste heat carried away by exhaust gas
  radFrac: 0.05, // fraction lost directly overboard (radiation/shine)
  cpExhaust: 1160, // J/(kg K)
  bpExhHeatFrac: 0.15, // exhaust-heating fraction at full back-pressure (of fuel power)
  bpCylHeatFrac: 0.22, // hot-residual-gas heat soak into head at full back-pressure
  mapTauS: 0.35, // manifold pressure filling time constant, s
  egtTauS: 0.6, // EGT measurement lag, s
  chtCapJk: 1400, // J/K per cylinder lumped head heat capacity
  oilCapJk: 5200, // J/K oil sump+cooler lumped heat capacity
  prRef: 2.55, // wastegate-limited pressure ratio near rated rpm
  prRpmRef: 2300, // rpm where turbo reaches gate pressure
  compHeatBase: 22, // compressor outlet temp rise over OAT at zero boost, K
  compHeatPerPR: 70, // additional K per unit of pressure ratio
  mapThrFloor: 0.25, // MAP fraction of boost pressure at idle throttle
  // thermal cooling
  hCylBase: 55, // W/K, static cylinder cooling coefficient
  hCylPerMs: 0.72, // W/K per m/s of airspeed
  cylRadiate: 8, // W/K lumped radiation loss per cylinder
  hOilBase: 25, // W/K, oil cooler coefficient at zero airspeed
  hOilPerMs: 0.35, // W/K per m/s
  cylToOilCond: 8, // W/K cylinder-block-to-oil conduction
  // thermostatic radiators: extra conductance that opens above a cracking
  // temperature. Without them a constant conductance cannot hold rated-power
  // takeoff at sea level and cruise at altitude inside the same 135 C limit.
  hCylThermoMax: 135, // W/K, extra head cooling at full thermostat opening
  tStatOpenC: 100, // C, head thermostat cracking temperature
  tStatSpanC: 10, // K, cracking to full opening
  hOilThermoMax: 70, // W/K, extra oil-cooler conductance at full opening
  oilStatOpenC: 90, // C, oil thermostat cracking temperature
  oilStatSpanC: 10, // K, cracking to full opening
  // friction & oil
  oilFrictPowerFrac: 0.08, // friction heat as fraction of shaft power
  oilFrictRpmK: 55, // W per (krpm)^3 speed-dependent friction
  oilPRef: 4.3, // bar, oil pressure at 2000 rpm, 80 degC, healthy seals
  oilVisicPerK: 0.013, // exponential viscosity drop per deg C above 80 degC
  // rotodynamics
  inertiaKgM2: 0.55, // effective crank+prop inertia reduced to crank, kg m2
  vibBase: 0.9, // mm/s RMS baseline vibration
  vibImbalanceK: 6, // mm/s per unit relative power imbalance
  vibOilK: 1.8, // mm/s added at full oil-seal degradation
  vibIgnK: 2.5, // mm/s added at full ignition degradation
  // governor (electronic throttle control holding target rpm)
  govKp: 3.0e-4, // throttle-units per (rpm error * s)
  govClamp: 0.3, // max governor authority around schedule base, frac
};

// --- Flight-phase schedules ---
export const PHASES: Record<
  Phase,
  {
    rpmTarget: number;
    throttle: number;
    airspeedMs: number;
    propC: number; // N m / (rad/s)^2
    afr: number;
  }
> = {
  takeoff: { rpmTarget: 2400, throttle: 0.65, airspeedMs: 25, propC: 4.7e-3, afr: 12.8 },
  climb: { rpmTarget: 2300, throttle: 0.88, airspeedMs: 27, propC: 4.3e-3, afr: 13.6 },
  cruise: { rpmTarget: 2100, throttle: 0.72, airspeedMs: 41, propC: 4.2e-3, afr: 16.5 },
  loiter: { rpmTarget: 1800, throttle: 0.5, airspeedMs: 26, propC: 3.7e-3, afr: 17.0 },
  descent: { rpmTarget: 1650, throttle: 0.32, airspeedMs: 32, propC: 2.9e-3, afr: 17.5 },
};

export const TURB: Record<TurbulenceLevel, { factor: number; tauS: number }> = {
  none: { factor: 0, tauS: 1 },
  light: { factor: 0.35, tauS: 4 },
  moderate: { factor: 0.75, tauS: 3 },
  severe: { factor: 1.35, tauS: 2 },
};

// Gust impact amplitudes: load x, throttle x, rpm-target jitter (rpm)
export const GUST = { load: 0.14, throttle: 0.035, rpm: 18 };

export const INITIAL_FUEL_KG = 42; // demo mission fuel load

export const CHANNELS: ChannelMeta[] = [
  { id: 'rpm', label: 'RPM', unit: 'rpm', noiseSigma: 11, driftRange: 260 },
  { id: 'map', label: 'Manifold Press', unit: 'kPa', noiseSigma: 0.9, driftRange: 26 },
  { id: 'boost', label: 'Boost', unit: 'kPa', noiseSigma: 0.7, driftRange: 22 },
  { id: 'ff', label: 'Fuel Flow', unit: 'kg/h', noiseSigma: 0.22, driftRange: 9 },
  { id: 'afr', label: 'AFR', unit: '', noiseSigma: 0.09, driftRange: 1.6 },
  { id: 'cht1', label: 'CHT Cyl 1', unit: 'degC', noiseSigma: 1.1, driftRange: 45 },
  { id: 'cht2', label: 'CHT Cyl 2', unit: 'degC', noiseSigma: 1.1, driftRange: 45 },
  { id: 'cht3', label: 'CHT Cyl 3', unit: 'degC', noiseSigma: 1.1, driftRange: 45 },
  { id: 'cht4', label: 'CHT Cyl 4', unit: 'degC', noiseSigma: 1.1, driftRange: 45 },
  { id: 'egt1', label: 'EGT Cyl 1', unit: 'degC', noiseSigma: 3.4, driftRange: 90 },
  { id: 'egt2', label: 'EGT Cyl 2', unit: 'degC', noiseSigma: 3.4, driftRange: 90 },
  { id: 'egt3', label: 'EGT Cyl 3', unit: 'degC', noiseSigma: 3.4, driftRange: 90 },
  { id: 'egt4', label: 'EGT Cyl 4', unit: 'degC', noiseSigma: 3.4, driftRange: 90 },
  { id: 'oilT', label: 'Oil Temp', unit: 'degC', noiseSigma: 0.55, driftRange: 22 },
  { id: 'oilP', label: 'Oil Press', unit: 'bar', noiseSigma: 0.03, driftRange: 1.8 },
  { id: 'vib', label: 'Vibration', unit: 'mm/s', noiseSigma: 0.07, driftRange: 2.6 },
  { id: 'pwr', label: 'Shaft Power', unit: 'kW', noiseSigma: 0.65, driftRange: 18 },
  { id: 'fuel', label: 'Fuel Remaining', unit: 'kg', noiseSigma: 0.05, driftRange: 6 },
];

export const CHANNEL_META: Record<string, ChannelMeta> = Object.fromEntries(
  CHANNELS.map((c) => [c.id, c]),
);
