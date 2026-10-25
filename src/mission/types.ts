// Mission planning data model. One Mission object is the source of truth for
// the brief, flight, risk assessment, alternates, payload and Data Guard.
import { MISSION_FUEL_KG, MISSION_RESERVE_KG } from './constants';
import { CHT_CAUTION_C, CHT_LIMIT_C, OILP_MIN_BAR, OILT_CAUTION_C, OILT_LIMIT_C } from '../sim/limits';

export type NodeType = 'LAUNCH' | 'WAYPOINT' | 'LOITER' | 'RECON' | 'LAND';
export type AltRef = 'AGL' | 'AMSL';
export type ZoneType = 'DENIED' | 'RESTRICTED';
export type SiteType = 'STRIP' | 'FIELD' | 'HELIPAD';
export type WeatherMode = 'forecast' | 'manual';

export interface MissionNode {
  id: number;
  type: NodeType;
  name: string;
  lat: number;
  lon: number;
  /** Altitude in the reference given by altRef. */
  alt: number;
  altRef: AltRef;
  loiterMin: number;
  /** Optional leg speed override, m/s. The profile default applies when absent. */
  speed?: number;
}

export interface MissionZone {
  id: number;
  name: string;
  type: ZoneType;
  /** Closed ring, [lon, lat]. */
  polygon: [number, number][];
}

export interface LandingSite {
  id: number;
  name: string;
  type: SiteType;
  lat: number;
  lon: number;
  elevM: number;
}

export interface GroundStation {
  lat: number;
  lon: number;
}

export interface Mission {
  id: string;
  name: string;
  engineProfileId: string;
  /** ISO-8601 instant; the node weather is the forecast valid at this time. */
  startTimeUTC: string;
  nodes: MissionNode[];
  zones: MissionZone[];
  groundStation: GroundStation;
  customSites: LandingSite[];
  /** Fuel loaded at T+0, kg. Bounded by the engine profile capacity. */
  fuelLoadKg: number;
  weatherMode: WeatherMode;
  /** Template provenance, shown in the editor. */
  templateId?: string;
  region?: string;
  description?: string;
  illustrative?: boolean;
}

export interface MissionTemplate extends Mission {
  region: string;
  description: string;
  illustrative: true;
}

export type GaugeId = 'rpm' | 'cht' | 'oilP' | 'oilT' | 'fuel';
export type GaugeTone = 'normal' | 'caution' | 'limit';

export interface GaugeArc {
  from: number;
  to: number;
  tone: GaugeTone;
}

/** One round instrument. The ranges live with the engine profile so the FLY
 * gauges never hard-code a limit that the simulated engine does not share. */
export interface GaugeSpec {
  id: GaugeId;
  label: string;
  unit: string;
  min: number;
  max: number;
  decimals: number;
  arcs: GaugeArc[];
}

export interface EngineProfile {
  id: string;
  name: string;
  fuelCapacityKg: number;
  gauges: Record<GaugeId, GaugeSpec>;
}

export const MAX_NODES = 50;
export const NODE_TYPES: NodeType[] = ['LAUNCH', 'WAYPOINT', 'LOITER', 'RECON', 'LAND'];
export const ALT_REFS: AltRef[] = ['AGL', 'AMSL'];
export const ZONE_TYPES: ZoneType[] = ['DENIED', 'RESTRICTED'];
export const SITE_TYPES: SiteType[] = ['STRIP', 'FIELD', 'HELIPAD'];
export const ENGINE_PROFILES: EngineProfile[] = [
  {
    id: 'nominal',
    name: 'Nominal Rotax-class',
    fuelCapacityKg: MISSION_FUEL_KG,
    gauges: {
      rpm: {
        id: 'rpm',
        label: 'RPM',
        unit: 'rpm',
        min: 0,
        max: 3000,
        decimals: 0,
        arcs: [
          { from: 1500, to: 2450, tone: 'normal' },
          { from: 2450, to: 2650, tone: 'caution' },
          { from: 2650, to: 3000, tone: 'limit' },
        ],
      },
      cht: {
        id: 'cht',
        label: 'CHT',
        unit: 'C',
        min: 0,
        max: 160,
        decimals: 0,
        arcs: [
          { from: 60, to: CHT_CAUTION_C, tone: 'normal' },
          { from: CHT_CAUTION_C, to: CHT_LIMIT_C, tone: 'caution' },
          { from: CHT_LIMIT_C, to: 160, tone: 'limit' },
        ],
      },
      oilP: {
        id: 'oilP',
        label: 'Oil press',
        unit: 'bar',
        min: 0,
        max: 6,
        decimals: 1,
        arcs: [
          { from: 0, to: OILP_MIN_BAR, tone: 'limit' },
          { from: OILP_MIN_BAR, to: 1.5, tone: 'caution' },
          { from: 1.5, to: 5, tone: 'normal' },
          { from: 5, to: 5.5, tone: 'caution' },
          { from: 5.5, to: 6, tone: 'limit' },
        ],
      },
      oilT: {
        id: 'oilT',
        label: 'Oil temp',
        unit: 'C',
        min: 0,
        max: 150,
        decimals: 0,
        arcs: [
          { from: 40, to: OILT_CAUTION_C, tone: 'normal' },
          { from: OILT_CAUTION_C, to: OILT_LIMIT_C, tone: 'caution' },
          { from: OILT_LIMIT_C, to: 150, tone: 'limit' },
        ],
      },
      fuel: {
        id: 'fuel',
        label: 'Fuel',
        unit: 'kg',
        min: 0,
        max: MISSION_FUEL_KG,
        decimals: 0,
        arcs: [
          { from: 0, to: MISSION_RESERVE_KG, tone: 'limit' },
          { from: MISSION_RESERVE_KG, to: 20, tone: 'caution' },
          { from: 20, to: MISSION_FUEL_KG, tone: 'normal' },
        ],
      },
    },
  },
];

export function engineProfileById(id: string): EngineProfile {
  return ENGINE_PROFILES.find((p) => p.id === id) ?? ENGINE_PROFILES[0];
}

export function engineFuelCapacityKg(profileId: string): number {
  return engineProfileById(profileId).fuelCapacityKg;
}

/** New missions start full; the profile capacity is the default fuel load. */
export function clampFuelLoadKg(kg: unknown, profileId: string): number {
  const capacity = engineFuelCapacityKg(profileId);
  if (typeof kg !== 'number' || !Number.isFinite(kg)) return capacity;
  return Math.max(0, Math.min(capacity, Math.round(kg)));
}

export function nodeTypeLabel(type: NodeType): string {
  return type;
}
