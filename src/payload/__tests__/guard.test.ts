import { describe, expect, it } from 'vitest';
import {
  ERASE_TIME_MARGIN_S,
  decideGuard,
  fmtSpanS,
  glideTimeS,
  insideDeniedZone,
  pointInPolygon,
  recoverableAlternate,
  rulP10MissionS,
  timeToLossMissionS,
  type GuardInput,
} from '../guard';
import type { AlternateRow, AltVerdict } from '../../nav/alternates';
import type { MissionZone } from '../../mission/types';

function row(icao: string, verdict: AltVerdict, rulMarginS: number | null): AlternateRow {
  return {
    airfield: { icao } as AlternateRow['airfield'],
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

const BASE: GuardInput = {
  sensorOnly: false,
  engineFault: true,
  faultText: 'Cooling failure on CYL 3.',
  rulP10MissionS: 1000,
  glideS: 300,
  currentInsideDenied: true,
  predictedInsideDenied: true,
  linkState: 'UP',
  pendingMB: 100,
  collectedMB: 300,
  offloadFit: {
    requiredS: 400,
    capacityMB: 200,
    fittingMB: 100,
    fittingItems: 1,
    fittingIds: [2],
    fitsAll: true,
  },
  alternates: [],
  remoteZeroize: false,
  forcedLandingInDenied: false,
  priorState: 'MONITOR',
  priorEraseReason: null,
};

function decide(patch: Partial<GuardInput>) {
  return decideGuard({ ...BASE, ...patch });
}

describe('denied-area geometry', () => {
  const square: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
  ];

  it('uses ray casting for a closed lon/lat ring', () => {
    expect(pointInPolygon(5, 5, square)).toBe(true);
    expect(pointInPolygon(15, 5, square)).toBe(false);
    expect(pointInPolygon(5, -1, square)).toBe(false);
  });

  it('treats a missing zone as outside', () => {
    expect(insideDeniedZone(undefined, 34.1, 77.1)).toBe(false);
    const zone = { polygon: square } as MissionZone;
    expect(insideDeniedZone([zone], 5, 5)).toBe(true);
    expect(insideDeniedZone([zone], 50, 50)).toBe(false);
  });
});

describe('time to loss', () => {
  it('converts the compressed RUL P10 into mission seconds', () => {
    expect(rulP10MissionS(10, 24_000)).toBe(2_000);
    expect(rulP10MissionS(null, 24_000)).toBeNull();
    expect(rulP10MissionS(NaN, 24_000)).toBeNull();
    expect(rulP10MissionS(10, 0)).toBeNull();
  });

  it('takes the sooner of the RUL horizon and the glide', () => {
    expect(timeToLossMissionS(1000, 300)).toBe(300);
    expect(timeToLossMissionS(200, 300)).toBe(200);
    expect(timeToLossMissionS(null, 300)).toBe(300);
    expect(timeToLossMissionS(null, NaN)).toBe(0);
  });

  it('derives glide time from altitude and speed', () => {
    expect(glideTimeS(3000, 0)).toBe(0);
    expect(glideTimeS(3000, 75)).toBe(480);
  });
});

describe('friendly-landing rule', () => {
  it('accepts only a reachable field with a non-negative life margin', () => {
    expect(recoverableAlternate([row('VOML', 'MARGINAL', 1000)], true)).toBeNull();
    expect(recoverableAlternate([row('VOML', 'REACHABLE', -1)], true)).toBeNull();
    expect(recoverableAlternate([row('VOML', 'REACHABLE', 1000)], true)?.airfield.icao).toBe('VOML');
  });

  it('rejects a null margin over denied territory but accepts it outside', () => {
    expect(recoverableAlternate([row('VISR', 'REACHABLE', null)], true)).toBeNull();
    expect(recoverableAlternate([row('VISR', 'REACHABLE', null)], false)?.airfield.icao).toBe('VISR');
  });
});

describe('Data Guard decision table', () => {
  it('never escalates on a sensor fault', () => {
    const d = decide({ sensorOnly: true });
    expect(d.state).toBe('MONITOR');
    expect(d.action).toBe('NONE');
    expect(d.reason).toContain('Sensor fault only');
  });

  it('stays in monitor with no engine fault', () => {
    const d = decide({ engineFault: false });
    expect(d.state).toBe('MONITOR');
    expect(d.reason).toContain('No engine fault');
  });

  it('stands by when a friendly landing is reachable', () => {
    const d = decide({ alternates: [row('VISR', 'REACHABLE', 1000)] });
    expect(d.state).toBe('STANDBY');
    expect(d.action).toBe('NONE');
    expect(d.recoverableIcao).toBe('VISR');
    expect(d.reason).toContain('Data stays encrypted onboard');
  });

  it('names a reachable custom site by its own name, not its synthetic id', () => {
    const custom = row('SITE-7', 'REACHABLE', 1000);
    custom.airfield = {
      icao: 'SITE-7',
      name: 'Site 1',
      custom: true,
    } as AlternateRow['airfield'];
    const d = decide({ alternates: [custom] });
    expect(d.state).toBe('STANDBY');
    expect(d.reason).toContain('Site 1 is reachable');
    expect(d.reason).not.toContain('SITE-7');
  });

  it('never arms for a reachable alternate even over denied territory', () => {
    const d = decide({
      alternates: [row('VISR', 'MARGINAL', 1000), row('VIJU', 'REACHABLE', 500)],
    });
    expect(d.state).toBe('STANDBY');
    expect(d.eraseReason).toBeNull();
  });

  it('arms over denied territory with no friendly landing', () => {
    const d = decide({});
    expect(d.state).toBe('ARMED');
    expect(d.action).toBe('NONE');
    expect(d.reason).toContain('Predicted loss inside the denied area');
    expect(d.reason).toContain('Sending 100 MB of 300 MB');
  });

  it('offloads at priority when the predicted loss is outside', () => {
    const d = decide({ predictedInsideDenied: false, currentInsideDenied: false });
    expect(d.state).toBe('OFFLOAD_PRIORITY');
    expect(d.reason).toContain('outside the denied area');
  });

  it('erases at once when the link is jammed', () => {
    const d = decide({ linkState: 'JAMMED' });
    expect(d.state).toBe('ZEROIZED');
    expect(d.action).toBe('ZEROIZE');
    expect(d.eraseReason).toContain('jammed');
    expect(d.eraseReason).toContain('100 MB');
  });

  it('erases when the link is lost', () => {
    const d = decide({ linkState: 'LOST' });
    expect(d.state).toBe('ZEROIZED');
    expect(d.eraseReason).toContain('Datalink lost');
  });

  it('erases once the offload has finished', () => {
    const d = decide({
      pendingMB: 0,
      offloadFit: { ...BASE.offloadFit, requiredS: 0, fittingMB: 0, fittingItems: 0 },
    });
    expect(d.state).toBe('ZEROIZED');
    expect(d.eraseReason).toContain('Offload finished');
    expect(d.eraseReason).toContain('300 MB');
  });

  it('erases inside the time margin', () => {
    const d = decide({ rulP10MissionS: ERASE_TIME_MARGIN_S - 1, glideS: 300 });
    expect(d.state).toBe('ZEROIZED');
    expect(d.eraseReason).toContain('erase margin');
  });

  it('does not erase at exactly the margin', () => {
    const d = decide({ rulP10MissionS: ERASE_TIME_MARGIN_S, glideS: 300 });
    expect(d.state).toBe('ARMED');
  });

  it('honours the operator remote zeroize', () => {
    const d = decide({ remoteZeroize: true });
    expect(d.state).toBe('ZEROIZED');
    expect(d.eraseReason).toContain('remote zeroize');
  });

  it('erases when a forced landing begins inside the zone', () => {
    const d = decide({ forcedLandingInDenied: true });
    expect(d.state).toBe('ZEROIZED');
    expect(d.eraseReason).toContain('Forced landing');
  });

  it('is terminal after zeroize', () => {
    const d = decide({ priorState: 'ZEROIZED', priorEraseReason: 'Offload finished; all 300 MB was at the ground station.' });
    expect(d.state).toBe('ZEROIZED');
    expect(d.action).toBe('NONE');
    expect(d.reason).toBe('Offload finished; all 300 MB was at the ground station.');
  });

  it('formats spans for the plain-language reasons', () => {
    expect(fmtSpanS(252)).toBe('4m12s');
    expect(fmtSpanS(-5)).toBe('0m00s');
  });
});
