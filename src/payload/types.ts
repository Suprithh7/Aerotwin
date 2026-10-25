import type { AltVerdict } from '../nav/alternates';

export type PayloadType = 'IMAGE' | 'VIDEO';
export type PayloadPriority = 1 | 2 | 3;
export type ItemStatus = 'ONBOARD' | 'SENDING' | 'AT_GROUND' | 'ERASED';

export type LinkState = 'UP' | 'DEGRADED' | 'LOST' | 'JAMMED';
export type PayloadEventTone = 'info' | 'caution' | 'alert';

export interface LinkStatus {
  state: LinkState;
  rateMbps: number;
  /** Effective range: the lower of the assumed maximum and the radio horizon. */
  rangeKm: number;
  horizonKm: number;
  distanceKm: number;
  /** Distance as a fraction of range; 1 is the range edge. */
  fraction: number;
}

export type GuardState = 'MONITOR' | 'OFFLOAD_PRIORITY' | 'ARMED' | 'ZEROIZED' | 'STANDBY';

export interface PoiSpec {
  id: number;
  type: PayloadType;
  sizeMB: number;
  priority: PayloadPriority;
  lat: number;
  lon: number;
  /** 0-based index of the RECON node this item belongs to in the route. */
  routeIndex: number;
  /** Route feature the point sits beside, for the briefing and tests. */
  anchor: string;
}

export interface ScheduledPoi extends PoiSpec {
  /** Mission clock of the ordered capture, or null if it was never due. */
  captureAtS: number | null;
}

export interface PayloadItemView {
  id: number;
  type: PayloadType;
  sizeMB: number;
  priority: PayloadPriority;
  status: ItemStatus;
  sentMB: number;
  capturedAtS: number;
  hashVerified: boolean;
  lat: number;
  lon: number;
}

export interface GroundItemView {
  id: number;
  type: PayloadType;
  sizeMB: number;
  priority: PayloadPriority;
  sentMB: number;
  progress: number;
  verified: boolean;
  /** True when the session ended before the whole item arrived. */
  incomplete: boolean;
  preview: string | null;
}

export interface GuardAlternate {
  icao: string;
  verdict: AltVerdict;
  rulMarginS: number | null;
  eteS: number;
}

export interface GuardView {
  state: GuardState;
  reason: string;
  currentInsideDenied: boolean;
  predictedInsideDenied: boolean;
  timeToLossS: number;
  recoverableIcao: string | null;
  eraseMissionS: number | null;
  eraseReason: string | null;
}

export interface AdversaryOutcome {
  status: 'FAILED';
  attempted: number;
  failed: number;
  atMs: number;
  detail: string;
}

export interface PayloadCounters {
  collectedMB: number;
  atGroundMB: number;
  onboardMB: number;
}

export interface PayloadView {
  started: boolean;
  items: PayloadItemView[];
  groundItems: GroundItemView[];
  link: LinkStatus | null;
  guard: GuardView;
  counters: PayloadCounters;
  adversary: AdversaryOutcome | null;
  eraseMissionS: number | null;
  error: string | null;
}

export interface PriorityDebrief {
  priority: PayloadPriority;
  collectedMB: number;
  securedMB: number;
  onboardMB: number;
  lostMB: number;
}

export interface DataGuardDebrief {
  collectedMB: number;
  securedMB: number;
  onboardMB: number;
  lostMB: number;
  byPriority: PriorityDebrief[];
  eraseMissionS: number | null;
  eraseReason: string | null;
  recovery: AdversaryOutcome | null;
  items: PayloadItemView[];
  link: LinkStatus | null;
}
