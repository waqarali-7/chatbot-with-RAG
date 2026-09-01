import type { ConfirmResult, SlotStore } from './types';

/**
 * Name and reason for visit are the only required fields. Anything more is an
 * interrogation, and the spec is explicit that we do not ask for payment
 * details, ID, or clinical detail beyond the booking need.
 */
export async function confirmBooking(
  store: SlotStore,
  args: {
    slotId: string;
    sessionId: string;
    name: string;
    reason: string;
    disclosureMode: string;
  },
): Promise<ConfirmResult> {
  return store.confirm(
    args.slotId,
    args.sessionId,
    args.name,
    args.reason,
    args.disclosureMode,
  );
}
