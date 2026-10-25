// Priority offload scheduler. Each tick spends a byte budget of rate x dt on
// the highest-priority, oldest pending item, then the next, and so on. Items
// stay SENDING until the ground station has verified the complete ciphertext.
import type { ItemStatus, PayloadPriority } from './types';

export interface OffloadItem {
  id: number;
  priority: PayloadPriority;
  capturedAtS: number;
  sizeMB: number;
  sentMB: number;
  status: ItemStatus;
}

export interface OffloadResult {
  sentMB: number;
  completed: number[];
}

export function offloadRateMBps(rateMbps: number): number {
  return Math.max(0, rateMbps) / 8;
}

export function pendingMB(items: OffloadItem[]): number {
  let sum = 0;
  for (const it of items) {
    if (it.status === 'ONBOARD' || it.status === 'SENDING') {
      sum += Math.max(0, it.sizeMB - it.sentMB);
    }
  }
  return sum;
}

export function pendingInPriorityOrder(items: OffloadItem[]): OffloadItem[] {
  return items
    .filter((it) => (it.status === 'ONBOARD' || it.status === 'SENDING') && it.sizeMB - it.sentMB > 1e-9)
    .sort((a, b) => a.priority - b.priority || a.capturedAtS - b.capturedAtS || a.id - b.id);
}

/** Seconds of transfer remaining at the current rate; Infinity with no link. */
export function offloadRequiredS(pending: number, rateMbps: number): number {
  const mbps = offloadRateMBps(rateMbps);
  return mbps > 0 ? Math.max(0, pending) / mbps : Infinity;
}

export interface OffloadFit {
  /** Seconds of transfer needed for everything still pending. */
  requiredS: number;
  /** Megabytes the link can carry inside the time budget. */
  capacityMB: number;
  /** Whole items, priority order, that fit inside the budget. */
  fittingMB: number;
  fittingItems: number;
  fittingIds: number[];
  fitsAll: boolean;
}

/**
 * What can leave before the aircraft is lost. Capacity is rate x budget; items
 * are counted whole, in priority order, so the sentence can name a MB figure
 * that is actually deliverable.
 */
export function offloadFit(
  items: OffloadItem[],
  rateMbps: number,
  budgetS: number,
): OffloadFit {
  const pending = pendingMB(items);
  const rate = offloadRateMBps(rateMbps);
  const capacityMB = Math.max(0, budgetS) * rate;
  let fittingMB = 0;
  let fittingItems = 0;
  const fittingIds: number[] = [];
  for (const item of pendingInPriorityOrder(items)) {
    const remaining = Math.max(0, item.sizeMB - item.sentMB);
    if (fittingMB + remaining > capacityMB + 1e-9) break;
    fittingMB += remaining;
    fittingItems++;
    fittingIds.push(item.id);
  }
  return {
    requiredS: offloadRequiredS(pending, rateMbps),
    capacityMB,
    fittingMB,
    fittingItems,
    fittingIds,
    fitsAll: pending <= 1e-9 || fittingMB >= pending - 1e-6,
  };
}

/**
 * Spend at most rate x dt megabytes. Completion means the ciphertext is fully
 * delivered; the caller still has to verify the hash before AT_GROUND.
 */
export function advanceOffload(items: OffloadItem[], rateMbps: number, dtS: number): OffloadResult {
  let budget = offloadRateMBps(rateMbps) * Math.max(0, dtS);
  let sentMB = 0;
  const completed: number[] = [];
  if (!(budget > 0)) return { sentMB, completed };
  for (const it of pendingInPriorityOrder(items)) {
    if (!(budget > 0)) break;
    const remaining = Math.max(0, it.sizeMB - it.sentMB);
    const send = Math.min(budget, remaining);
    if (!(send > 0)) continue;
    it.sentMB = Math.min(it.sizeMB, it.sentMB + send);
    it.status = 'SENDING';
    budget -= send;
    sentMB += send;
    if (it.sizeMB - it.sentMB <= 1e-9) completed.push(it.id);
  }
  return { sentMB, completed };
}
