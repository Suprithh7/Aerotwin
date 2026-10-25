// One Data Guard session: key exchange at mission start, encrypted capture as
// the aircraft passes each site, priority offload over the simulated link, the
// guard decision each tick, and the erase/ground-verification bookkeeping that
// the FLY panel and DEBRIEF read.
import type { AlternateRow } from '../nav/alternates';
import { positionAtClock, type MissionPlan } from '../mission/mission';
import type { Waypoint } from '../mission/route';
import type { GroundStation as GroundSite, Mission, MissionZone } from '../mission/types';
import { PHASES } from '../sim/constants';
import type { Snapshot } from '../sim/types';
import { ENGINE_FAULT_LABELS } from '../sim/faults';
import type { Diagnosis } from '../diagnosis/diagnose';
import {
  GroundStation as GroundLink,
  SecureElement,
  deriveSessionKey,
  generateEcdhKeyPair,
  snapshotRecord,
  type CipherRecord,
} from './crypto';
import { buildDummyPayload, previewDummyPayload } from './dummy';
import { advanceOffload, offloadFit, pendingMB } from './offload';
import { linkStatus } from './link';
import {
  decideGuard,
  glideTimeS,
  insideDeniedZone,
  rulP10MissionS,
  timeToLossMissionS,
} from './guard';
import { poisForMission, schedulePois } from './pois';
import type {
  AdversaryOutcome,
  DataGuardDebrief,
  GroundItemView,
  GuardState,
  GuardView,
  ItemStatus,
  LinkStatus,
  PayloadCounters,
  PayloadEventTone,
  PayloadItemView,
  PayloadPriority,
  PayloadType,
  PayloadView,
  PriorityDebrief,
  ScheduledPoi,
} from './types';

export interface PayloadEvent {
  missionS: number;
  label: string;
  text: string;
  tone: PayloadEventTone;
  tick: boolean;
}

export interface PayloadSessionOptions {
  /** The mission owns the RECON nodes, zones and ground station. */
  mission: Mission;
  waypoints: Waypoint[];
  plan: MissionPlan;
  emit?: (event: PayloadEvent) => void;
}

export interface SessionTick {
  missionS: number;
  diagnosis: Diagnosis;
  sensorOnly: boolean;
  snapshot: Snapshot | null;
  alternates: AlternateRow[];
  jammed: boolean;
  forcedLanding: boolean;
}

interface InternalItem {
  id: number;
  type: PayloadType;
  sizeMB: number;
  priority: PayloadPriority;
  lat: number;
  lon: number;
  capturedAtS: number;
  status: ItemStatus;
  sentMB: number;
  hashVerified: boolean;
  record: CipherRecord | null;
  preview: string | null;
  verifyDispatched: boolean;
}

const PRIORITIES: PayloadPriority[] = [1, 2, 3];

const INITIAL_GUARD: GuardView = {
  state: 'MONITOR',
  reason: 'Awaiting the first engine sample.',
  currentInsideDenied: false,
  predictedInsideDenied: false,
  timeToLossS: 0,
  recoverableIcao: null,
  eraseMissionS: null,
  eraseReason: null,
};

function sum(items: InternalItem[], predicate: (item: InternalItem) => boolean): number {
  return items.reduce((s, item) => s + (predicate(item) ? item.sizeMB : 0), 0);
}

function faultText(diagnosis: Diagnosis): string {
  const dominant = diagnosis.dominant;
  if (!dominant) return 'Engine fault.';
  const base =
    dominant.kind === 'cooling'
      ? 'Cooling failure'
      : (ENGINE_FAULT_LABELS[dominant.kind] ?? 'Engine fault');
  const cylinder = dominant.cylinder > 0 ? ` on CYL ${dominant.cylinder}` : '';
  return `${base}${cylinder}.`;
}

export class PayloadSession {
  private readonly waypoints: Waypoint[];
  private readonly plan: MissionPlan;
  private readonly zones: MissionZone[];
  private readonly groundSite: GroundSite;
  private readonly emit: ((event: PayloadEvent) => void) | undefined;
  private readonly schedule: ScheduledPoi[];

  private secure: SecureElement | null = null;
  private groundLink: GroundLink | null = null;
  private started = false;
  private disposed = false;
  private error: string | null = null;

  private readonly items: InternalItem[] = [];
  private readonly captured = new Set<number>();
  private link: LinkStatus | null = null;
  private guard: GuardView = INITIAL_GUARD;

  private lastMissionS: number | null = null;
  private jammed = false;
  private forcedLanding = false;
  private remoteZeroizeRequested = false;
  /** The live diagnosis can flicker; once an engine fault is named, keep it. */
  private faultLatched = false;
  private latchedFaultText: string | null = null;

  private eraseMissionS: number | null = null;
  private eraseReason: string | null = null;
  private adversary: AdversaryOutcome | null = null;
  private adversaryRevealAtMs = 0;
  private adversaryForced = false;

  private constructor(options: PayloadSessionOptions) {
    this.waypoints = options.waypoints;
    this.plan = options.plan;
    this.zones = options.mission.zones;
    this.groundSite = options.mission.groundStation;
    this.emit = options.emit;
    this.schedule = schedulePois(
      poisForMission(options.mission),
      options.plan,
      options.waypoints,
    );
  }

  /** ECDH key exchange, then both ends derive the same AES-256-GCM key. */
  static async create(options: PayloadSessionOptions): Promise<PayloadSession> {
    const ground = await generateEcdhKeyPair();
    const aircraft = await generateEcdhKeyPair();
    const [groundKey, aircraftKey] = await Promise.all([
      deriveSessionKey(ground.privateKey, aircraft.publicKey),
      deriveSessionKey(aircraft.privateKey, ground.publicKey),
    ]);
    groundKey.raw.fill(0);
    const session = new PayloadSession(options);
    session.secure = new SecureElement(aircraftKey.key, aircraftKey.raw);
    session.groundLink = new GroundLink(groundKey.key);
    session.started = true;
    session.guard = { ...INITIAL_GUARD, reason: 'Link established; waiting for the first engine sample.' };
    return session;
  }

  dispose(): void {
    this.disposed = true;
  }

  requestRemoteZeroize(): void {
    this.remoteZeroizeRequested = true;
  }

  revealAdversary(): void {
    this.adversaryForced = true;
  }

  /** Advance the session by one live snapshot. Non-blocking; crypto resolves async. */
  tick(input: SessionTick): void {
    if (this.disposed || !this.started) return;
    const dt = this.lastMissionS === null ? 0 : Math.max(0, input.missionS - this.lastMissionS);
    this.lastMissionS = input.missionS;
    this.jammed = input.jammed;
    this.forcedLanding = input.forcedLanding;

    if (this.eraseMissionS === null) this.captureDue(input.missionS);

    const pos = positionAtClock(this.plan, this.waypoints, input.missionS);
    this.updateLink(pos, input.snapshot);

    if (this.eraseMissionS === null && this.link && this.link.rateMbps > 0) {
      this.offload(dt);
    }

    if (!pos) return;
    const altitude = input.snapshot?.scenario.altitude ?? 0;
    const tas = input.snapshot ? PHASES[input.snapshot.phase].airspeedMs : 0;
    const glideS = glideTimeS(altitude, tas);
    const rulP10 = input.diagnosis.rul?.status === 'OK' ? input.diagnosis.rul.p10S : null;
    const rulMission = rulP10MissionS(rulP10, this.plan.totalS);
    const timeToLossS = timeToLossMissionS(rulMission, glideS);
    const lossClock = Math.min(this.plan.totalS, input.missionS + timeToLossS);
    const lossPos = positionAtClock(this.plan, this.waypoints, lossClock);
    const currentInsideDenied = insideDeniedZone(this.zones, pos.lat, pos.lon);
    const predictedInsideDenied = lossPos
      ? insideDeniedZone(this.zones, lossPos.lat, lossPos.lon)
      : false;
    const pending = this.pendingMB();
    const collected = this.collectedMB();
    const remote = this.remoteZeroizeRequested;
    this.remoteZeroizeRequested = false;
    const liveEngineFault =
      !input.sensorOnly &&
      input.diagnosis.state !== 'NOMINAL' &&
      input.diagnosis.dominant !== null;
    if (liveEngineFault && !this.faultLatched) {
      this.faultLatched = true;
      this.latchedFaultText = faultText(input.diagnosis);
    }
    const engineFault = this.faultLatched && !input.sensorOnly;
    const fit = offloadFit(this.items, this.link?.rateMbps ?? 0, timeToLossS);

    const priorState = this.guard.state;
    const decision = decideGuard({
      sensorOnly: input.sensorOnly,
      engineFault,
      faultText: this.latchedFaultText ?? faultText(input.diagnosis),
      rulP10MissionS: rulMission,
      glideS,
      currentInsideDenied,
      predictedInsideDenied,
      linkState: this.link?.state ?? 'LOST',
      pendingMB: pending,
      collectedMB: collected,
      offloadFit: fit,
      alternates: input.alternates,
      remoteZeroize: remote,
      forcedLandingInDenied: this.forcedLanding && currentInsideDenied,
      priorState,
      priorEraseReason: this.eraseReason,
    });

    if (decision.action === 'ZEROIZE') {
      this.performZeroize(decision.eraseReason ?? decision.reason, input.missionS);
    }

    this.guard = {
      state: decision.state,
      reason: decision.reason,
      currentInsideDenied,
      predictedInsideDenied,
      timeToLossS: decision.timeToLossS,
      recoverableIcao: decision.recoverableIcao,
      eraseMissionS: this.eraseMissionS,
      eraseReason: this.eraseReason,
    };

    if (decision.state !== priorState) {
      if (decision.action === 'ZEROIZE') {
        this.emit?.({
          missionS: input.missionS,
          label: 'KEY DESTROYED',
          text: `${decision.eraseReason} Onboard ciphertext overwritten.`,
          tone: 'alert',
          tick: true,
        });
      } else if (decision.state !== 'MONITOR') {
        this.emit?.({
          missionS: input.missionS,
          label: 'DATA GUARD',
          text: `${decision.state.replace('_', ' ')}: ${decision.reason}`,
          tone: 'caution',
          tick: true,
        });
      }
    }
  }

  private captureDue(missionS: number): void {
    for (const poi of this.schedule) {
      if (poi.captureAtS === null || poi.captureAtS > missionS || this.captured.has(poi.id)) continue;
      this.captured.add(poi.id);
      const item: InternalItem = {
        id: poi.id,
        type: poi.type,
        sizeMB: poi.sizeMB,
        priority: poi.priority,
        lat: poi.lat,
        lon: poi.lon,
        capturedAtS: poi.captureAtS,
        status: 'ONBOARD',
        sentMB: 0,
        hashVerified: false,
        record: null,
        preview: null,
        verifyDispatched: false,
      };
      this.items.push(item);
      this.emit?.({
        missionS: poi.captureAtS,
        label: 'RECON CAPTURED',
        text: `Item ${String(poi.id).padStart(2, '0')} ${poi.type} ${poi.sizeMB} MB P${poi.priority} at ${poi.anchor}.`,
        tone: 'info',
        tick: false,
      });
      const secure = this.secure;
      if (!secure) continue;
      const plaintext = buildDummyPayload(poi, poi.captureAtS);
      void secure
        .store(poi.id, plaintext)
        .then((record) => {
          plaintext.fill(0);
          if (!this.disposed) item.record = record;
        })
        .catch((err: unknown) => {
          plaintext.fill(0);
          // A store still in flight when zeroize lands is part of the erase, not
          // an encryption failure; the item is already marked ERASED.
          if (this.disposed || this.secure?.locked || this.eraseMissionS !== null) return;
          this.error = `ENCRYPT FAILED: ${String(err)}`;
        });
    }
  }

  private updateLink(pos: { lat: number; lon: number } | null, snapshot: Snapshot | null): void {
    if (!pos || !this.groundSite || !snapshot) {
      this.link = null;
      return;
    }
    this.link = linkStatus({
      lat: pos.lat,
      lon: pos.lon,
      altM: snapshot.scenario.altitude,
      gs: this.groundSite,
      jammed: this.jammed,
    });
  }

  private offload(dtS: number): void {
    if (!this.link || !(dtS > 0)) return;
    const sendable = this.items.filter((item) => item.record !== null);
    const { completed } = advanceOffload(sendable, this.link.rateMbps, dtS);
    for (const id of completed) {
      const item = this.items.find((it) => it.id === id);
      if (!item) continue;
      item.sentMB = item.sizeMB;
      this.dispatchVerification(item);
    }
  }

  /** The ground verifies the complete ciphertext against the stored hash. */
  private dispatchVerification(item: InternalItem): void {
    if (item.verifyDispatched || !item.record || !this.groundLink) return;
    item.verifyDispatched = true;
    const record = snapshotRecord(item.record);
    void this.groundLink
      .receive(record)
      .then((result) => {
        if (this.disposed) return;
        if (result.verified) {
          item.status = 'AT_GROUND';
          item.hashVerified = true;
          item.preview = result.plaintext ? previewDummyPayload(result.plaintext) : null;
        } else {
          this.error = `GROUND HASH CHECK FAILED FOR ITEM ${item.id}`;
        }
      })
      .catch((err: unknown) => {
        if (!this.disposed) this.error = `GROUND RECEIVE FAILED: ${String(err)}`;
      });
  }

  private performZeroize(reason: string, missionS: number): void {
    if (!this.secure || this.eraseMissionS !== null) return;
    const wallMs = Date.now();
    this.secure.zeroize(wallMs);
    this.eraseMissionS = missionS;
    this.eraseReason = reason;
    for (const item of this.items) {
      if (item.status !== 'AT_GROUND') item.status = 'ERASED';
    }
    this.adversaryRevealAtMs = wallMs + 3000;
    void this.secure
      .adversaryRecoveryAttempt(wallMs)
      .then((outcome) => {
        if (!this.disposed) this.adversary = outcome;
      })
      .catch((err: unknown) => {
        if (!this.disposed) this.error = `RECOVERY ATTEMPT FAILED: ${String(err)}`;
      });
  }

  private collectedMB(): number {
    return sum(this.items, () => true);
  }

  private pendingMB(): number {
    return pendingMB(this.items);
  }

  private itemViews(): PayloadItemView[] {
    return [...this.items]
      .sort((a, b) => a.id - b.id)
      .map((item) => ({
        id: item.id,
        type: item.type,
        sizeMB: item.sizeMB,
        priority: item.priority,
        status: item.status,
        sentMB: Math.min(item.sizeMB, Math.max(0, item.sentMB)),
        capturedAtS: item.capturedAtS,
        hashVerified: item.hashVerified,
        lat: item.lat,
        lon: item.lon,
      }));
  }

  private groundItems(): GroundItemView[] {
    return [...this.items]
      .filter((item) => item.sentMB > 1e-9 || item.status === 'AT_GROUND')
      .sort((a, b) => a.id - b.id)
      .map((item) => ({
        id: item.id,
        type: item.type,
        sizeMB: item.sizeMB,
        priority: item.priority,
        sentMB: Math.min(item.sizeMB, Math.max(0, item.sentMB)),
        progress: item.sizeMB > 0 ? Math.min(1, item.sentMB / item.sizeMB) : 1,
        verified: item.hashVerified,
        incomplete: !item.hashVerified,
        preview: item.preview,
      }));
  }

  private visibleAdversary(): AdversaryOutcome | null {
    if (!this.adversary) return null;
    if (this.adversaryForced || Date.now() >= this.adversaryRevealAtMs) return this.adversary;
    return null;
  }

  private counters(): PayloadCounters {
    return {
      collectedMB: this.collectedMB(),
      atGroundMB: sum(this.items, (item) => item.status === 'AT_GROUND'),
      onboardMB: sum(
        this.items,
        (item) => item.status === 'ONBOARD' || item.status === 'SENDING',
      ),
    };
  }

  getView(): PayloadView {
    return {
      started: this.started,
      items: this.itemViews(),
      groundItems: this.groundItems(),
      link: this.link,
      guard: this.guard,
      counters: this.counters(),
      adversary: this.visibleAdversary(),
      eraseMissionS: this.eraseMissionS,
      error: this.error,
    };
  }

  getGuardState(): GuardState {
    return this.guard.state;
  }

  getDebrief(): DataGuardDebrief {
    const items = this.itemViews();
    const byPriority: PriorityDebrief[] = PRIORITIES.map((priority) => {
      const own = items.filter((item) => item.priority === priority);
      const total = own.reduce((s, item) => s + item.sizeMB, 0);
      const securedMB = own
        .filter((item) => item.status === 'AT_GROUND')
        .reduce((s, item) => s + item.sizeMB, 0);
      const onboardMB = own
        .filter((item) => item.status === 'ONBOARD' || item.status === 'SENDING')
        .reduce((s, item) => s + item.sizeMB, 0);
      const lostMB = own
        .filter((item) => item.status === 'ERASED')
        .reduce((s, item) => s + item.sizeMB, 0);
      return { priority, collectedMB: total, securedMB, onboardMB, lostMB };
    });
    return {
      collectedMB: this.collectedMB(),
      securedMB: sum(this.items, (item) => item.status === 'AT_GROUND'),
      onboardMB: sum(
        this.items,
        (item) => item.status === 'ONBOARD' || item.status === 'SENDING',
      ),
      lostMB: sum(this.items, (item) => item.status === 'ERASED'),
      byPriority,
      eraseMissionS: this.eraseMissionS,
      eraseReason: this.eraseReason,
      recovery: this.adversary,
      items,
      link: this.link,
    };
  }
}
