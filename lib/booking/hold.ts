import { HOLD_MINUTES, type HoldResult, type SlotStore } from './types';

/**
 * A 10-minute soft hold is taken the moment a specific time is offered, so the
 * slot the visitor is looking at cannot be taken out from under them mid
 * conversation. Expired holds are swept back to open on the next read.
 */
export async function holdSlot(
  store: SlotStore,
  slotId: string,
  sessionId: string,
): Promise<HoldResult> {
  return store.hold(slotId, sessionId, HOLD_MINUTES);
}

export async function releaseExpiredHolds(store: SlotStore): Promise<number> {
  return store.releaseExpired();
}
