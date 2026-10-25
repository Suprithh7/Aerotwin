import { describe, expect, it } from 'vitest';
import {
  advanceOffload,
  offloadFit,
  offloadRateMBps,
  offloadRequiredS,
  pendingInPriorityOrder,
  pendingMB,
  type OffloadItem,
} from '../offload';

function item(
  id: number,
  priority: 1 | 2 | 3,
  capturedAtS: number,
  sizeMB: number,
  sentMB = 0,
  status: OffloadItem['status'] = 'ONBOARD',
): OffloadItem {
  return { id, priority, capturedAtS, sizeMB, sentMB, status };
}

describe('offload scheduling', () => {
  it('converts Mbps to MB/s', () => {
    expect(offloadRateMBps(2)).toBe(0.25);
    expect(offloadRateMBps(0)).toBe(0);
    expect(offloadRateMBps(-4)).toBe(0);
  });

  it('orders pending items by priority, then capture time, then id', () => {
    const items = [
      item(1, 3, 10, 50),
      item(2, 1, 50, 50),
      item(3, 2, 20, 50),
      item(4, 1, 10, 50),
      item(5, 1, 50, 50),
      item(6, 1, 50, 50, 50, 'AT_GROUND'),
    ];
    expect(pendingInPriorityOrder(items).map((it) => it.id)).toEqual([4, 2, 5, 3, 1]);
  });

  it('never sends more than rate x time and spends it in priority order', () => {
    const items = [item(1, 1, 0, 100), item(2, 2, 1, 100)];
    const result = advanceOffload(items, 2, 400); // 0.25 MB/s x 400 s = 100 MB
    expect(result.sentMB).toBeCloseTo(100, 9);
    expect(result.sentMB).toBeLessThanOrEqual(0.25 * 400 + 1e-9);
    expect(result.completed).toEqual([1]);
    expect(items[0].sentMB).toBe(100);
    expect(items[0].status).toBe('SENDING');
    expect(items[1].sentMB).toBe(0);
  });

  it('carries the remaining budget into the next item', () => {
    const items = [item(1, 1, 0, 10), item(2, 1, 1, 10)];
    const result = advanceOffload(items, 2, 120); // 30 MB budget
    expect(result.completed).toEqual([1, 2]);
    expect(result.sentMB).toBeCloseTo(20, 9);
    expect(pendingMB(items)).toBe(0);
  });

  it('does nothing without a link', () => {
    const items = [item(1, 1, 0, 10)];
    expect(advanceOffload(items, 0, 10)).toEqual({ sentMB: 0, completed: [] });
    expect(advanceOffload(items, 2, 0)).toEqual({ sentMB: 0, completed: [] });
    expect(items[0].sentMB).toBe(0);
  });

  it('counts only remaining bytes for onboard and sending items', () => {
    expect(
      pendingMB([item(1, 1, 0, 10, 4), item(2, 2, 0, 10, 10, 'AT_GROUND'), item(3, 3, 0, 10)]),
    ).toBe(16);
  });
});

describe('offload fit before predicted loss', () => {
  const items = [item(1, 1, 0, 40), item(2, 2, 1, 60), item(3, 3, 2, 100)];

  it('reports the transfer time needed at the current rate', () => {
    expect(offloadRequiredS(200, 2)).toBe(800);
    expect(offloadRequiredS(200, 0)).toBe(Infinity);
  });

  it('counts whole items in priority order that fit the budget', () => {
    const fit = offloadFit(items, 2, 500); // 125 MB capacity
    expect(fit.capacityMB).toBeCloseTo(125, 9);
    expect(fit.fittingIds).toEqual([1, 2]);
    expect(fit.fittingMB).toBe(100);
    expect(fit.fittingItems).toBe(2);
    expect(fit.fitsAll).toBe(false);
    expect(fit.requiredS).toBe(800);
  });

  it('fits everything when the budget covers all pending bytes', () => {
    const fit = offloadFit(items, 2, 1000);
    expect(fit.fittingIds).toEqual([1, 2, 3]);
    expect(fit.fittingMB).toBe(200);
    expect(fit.fitsAll).toBe(true);
  });

  it('fits nothing without a usable link', () => {
    const fit = offloadFit(items, 0, 1000);
    expect(fit.fittingItems).toBe(0);
    expect(fit.capacityMB).toBe(0);
    expect(fit.requiredS).toBe(Infinity);
    expect(fit.fitsAll).toBe(false);
  });
});
