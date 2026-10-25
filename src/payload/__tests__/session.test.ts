import { describe, expect, it } from 'vitest';
import { PayloadSession } from '../session';
import { clonePreset, presetById } from '../../mission/route';
import { planMission } from '../../mission/mission';
import { applyWeatherPreset } from '../../mission/weather';
import { groundForPreset, zoneForPreset } from '../../data/zones';
import type { AlternateRow, AltVerdict } from '../../nav/alternates';
import type { Diagnosis } from '../../diagnosis/diagnose';
import type { Snapshot } from '../../sim/types';
import type { DataGuardDebrief } from '../types';

const preset = presetById('ladakh')!;
const waypoints = clonePreset('ladakh');
const weather = applyWeatherPreset(preset.suggestedWeather, waypoints.length);
const plan = planMission(waypoints, weather);
const SHAM_MISSION_S = 6000; // middle of the SHAM loiter, inside the denied zone

const snap = {
  t: 0,
  phase: 'cruise',
  sigmaRatio: 1,
  scenario: { altitude: 5200 },
  readings: {},
} as unknown as Snapshot;

const engineFault = {
  state: 'WARNING',
  dominant: { kind: 'cooling', cylinder: 3, label: 'Cooling degradation (cyl 3)', severity: 0.6 },
  rul: null,
} as unknown as Diagnosis;

function alternate(verdict: AltVerdict, rulMarginS: number | null): AlternateRow {
  return {
    airfield: { icao: 'VISR' } as AlternateRow['airfield'],
    distM: 40_000,
    bearingDeg: 90,
    gsMs: 80,
    eteS: 500,
    mode: 'POWERED',
    verdict,
    limiting: 'FUEL',
    marginFrac: 0.4,
    poweredRangeM: 100_000,
    glideRangeM: 60_000,
    rangeM: 100_000,
    rulMarginS,
  };
}

async function makeSession() {
  return PayloadSession.create({
    presetId: 'ladakh',
    waypoints,
    plan,
    deniedZone: zoneForPreset('ladakh'),
    groundStation: groundForPreset('ladakh'),
  });
}

interface TickOptions {
  diagnosis?: Diagnosis;
  sensorOnly?: boolean;
  alternates?: AlternateRow[];
  jammed?: boolean;
}

function tick(session: PayloadSession, missionS: number, opts: TickOptions = {}) {
  session.tick({
    missionS,
    diagnosis: opts.diagnosis ?? engineFault,
    sensorOnly: opts.sensorOnly ?? false,
    snapshot: snap,
    alternates: opts.alternates ?? [],
    jammed: opts.jammed ?? false,
    forcedLanding: false,
  });
}

function settle(ms = 100): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function expectConserved(d: DataGuardDebrief) {
  for (const p of d.byPriority) {
    expect(p.collectedMB).toBeCloseTo(p.securedMB + p.onboardMB + p.lostMB, 6);
  }
  expect(d.collectedMB).toBeCloseTo(d.securedMB + d.onboardMB + d.lostMB, 6);
}

describe('Data Guard session', () => {
  it('offloads in priority order, finishes, then erases with every item secured', async () => {
    const session = await makeSession();
    tick(session, SHAM_MISSION_S); // captures PHEY and both SHAM items
    await settle();

    tick(session, SHAM_MISSION_S + 10); // 10 s at 2 Mbps = 2.5 MB
    let view = session.getView();
    expect(view.guard.state).toBe('ARMED');
    expect(view.items).toHaveLength(3);
    const p1 = view.items.find((it) => it.id === 1)!;
    expect(p1.priority).toBe(1);
    expect(p1.status).toBe('SENDING');
    expect(p1.sentMB).toBeCloseTo(2.5, 6);
    for (const other of view.items.filter((it) => it.id !== 1)) {
      expect(other.sentMB).toBe(0);
    }

    for (let k = 2; k <= 280; k++) tick(session, SHAM_MISSION_S + k * 10);
    await settle(250);

    view = session.getView();
    expect(view.guard.state).toBe('ZEROIZED');
    expect(view.guard.eraseReason).toContain('Offload finished');
    expect(view.items.every((it) => it.status === 'AT_GROUND')).toBe(true);
    expect(view.groundItems.every((g) => g.verified)).toBe(true);
    expect(view.counters.atGroundMB).toBeCloseTo(view.counters.collectedMB, 6);
    expect(view.counters.onboardMB).toBe(0);

    const debrief = session.getDebrief();
    expect(debrief.eraseMissionS).not.toBeNull();
    expect(debrief.lostMB).toBe(0);
    expect(debrief.securedMB).toBeCloseTo(debrief.collectedMB, 6);
    expect(debrief.recovery).not.toBeNull();
    expect(debrief.recovery!.attempted).toBeGreaterThan(0);
    expect(debrief.recovery!.failed).toBe(debrief.recovery!.attempted);
    expectConserved(debrief);
    session.dispose();
  });

  it('erases on remote zeroize and the adversary fails on the stored blocks', async () => {
    const session = await makeSession();
    tick(session, SHAM_MISSION_S);
    await settle();
    expect(session.getGuardState()).toBe('ARMED');

    session.requestRemoteZeroize();
    tick(session, SHAM_MISSION_S + 10);
    await settle(150);

    const view = session.getView();
    expect(view.guard.state).toBe('ZEROIZED');
    expect(view.eraseMissionS).toBe(SHAM_MISSION_S + 10);
    expect(view.guard.eraseReason).toContain('remote zeroize');
    expect(view.items.every((it) => it.status === 'ERASED')).toBe(true);
    expect(view.adversary).toBeNull();
    session.revealAdversary();
    const revealed = session.getView().adversary;
    expect(revealed?.status).toBe('FAILED');
    expect(revealed!.failed).toBe(revealed!.attempted);
    expect(revealed!.attempted).toBe(3);

    const debrief = session.getDebrief();
    expect(debrief.lostMB).toBeCloseTo(debrief.collectedMB, 6);
    expect(debrief.securedMB).toBe(0);
    expect(debrief.recovery?.failed).toBe(3);
    expectConserved(debrief);
    session.dispose();
  });

  it('erases at once when the link is jammed, losing everything unsent', async () => {
    const session = await makeSession();
    tick(session, SHAM_MISSION_S);
    await settle();
    const collected = session.getView().counters.collectedMB;
    expect(collected).toBeGreaterThan(0);

    tick(session, SHAM_MISSION_S + 10, { jammed: true });
    await settle(150);

    const view = session.getView();
    expect(view.guard.state).toBe('ZEROIZED');
    expect(view.guard.eraseReason).toContain('Datalink jammed');
    expect(view.counters.atGroundMB).toBe(0);
    expect(view.items.every((it) => it.status === 'ERASED')).toBe(true);
    const debrief = session.getDebrief();
    expect(debrief.lostMB).toBeCloseTo(debrief.collectedMB, 6);
    expect(debrief.recovery?.attempted).toBe(3);
    expectConserved(debrief);
    session.dispose();
  });

  it('stands by and keeps offloading when a friendly field is reachable', async () => {
    const session = await makeSession();
    tick(session, SHAM_MISSION_S, { alternates: [alternate('REACHABLE', 3000)] });
    await settle();
    let view = session.getView();
    expect(view.guard.state).toBe('STANDBY');
    expect(view.guard.recoverableIcao).toBe('VISR');

    for (let k = 1; k <= 40; k++) {
      tick(session, SHAM_MISSION_S + k * 10, { alternates: [alternate('REACHABLE', 3000)] });
    }
    await settle(150);
    view = session.getView();
    expect(view.guard.state).toBe('STANDBY');
    expect(view.eraseMissionS).toBeNull();
    expect(view.counters.onboardMB).toBeGreaterThan(0);
    const debrief = session.getDebrief();
    expect(debrief.eraseMissionS).toBeNull();
    expect(debrief.lostMB).toBe(0);
    expectConserved(debrief);
    session.dispose();
  });

  it('never escalates or erases for a sensor-only fault', async () => {
    const session = await makeSession();
    tick(session, SHAM_MISSION_S, { sensorOnly: true });
    await settle();
    for (let k = 1; k <= 30; k++) tick(session, SHAM_MISSION_S + k * 10, { sensorOnly: true });
    await settle(100);

    const view = session.getView();
    expect(view.guard.state).toBe('MONITOR');
    expect(view.eraseMissionS).toBeNull();
    expect(view.guard.reason).toContain('Sensor fault only');
    expect(session.getDebrief().eraseMissionS).toBeNull();
    session.dispose();
  });
});
