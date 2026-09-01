export type SlotStatus = 'open' | 'held' | 'booked';

export interface Slot {
  id: string;
  startsAt: string; // ISO 8601 UTC
  location: string;
  practitioner: string;
  service: string;
  status: SlotStatus;
  heldUntil: string | null;
  heldBy: string | null;
}

export interface Booking {
  id: string;
  slotId: string;
  sessionId: string;
  name: string;
  reason: string;
  disclosureMode: string;
  createdAt: string;
  slot?: Slot;
}

export type HoldFailure = 'not_found' | 'already_booked' | 'held_by_other';

export type HoldResult =
  | { ok: true; heldUntil: string }
  | { ok: false; reason: HoldFailure };

export type ConfirmResult =
  | { ok: true; bookingId: string; slot: Slot }
  | { ok: false; reason: HoldFailure | 'missing_details' };

export interface AvailabilityQuery {
  location?: string;
  service?: string;
  fromISO?: string;
  limit?: number;
  /**
   * A session sees its own soft holds as available. Without this the agent
   * removes a slot from circulation the moment it offers it, and the visitor
   * can never accept the time they were just given.
   */
  sessionId?: string;
}

export interface SlotStore {
  readonly kind: 'supabase' | 'memory';
  listOpen(q?: AvailabilityQuery): Promise<Slot[]>;
  getSlot(id: string): Promise<Slot | null>;
  hold(slotId: string, sessionId: string, minutes?: number): Promise<HoldResult>;
  releaseExpired(): Promise<number>;
  confirm(
    slotId: string,
    sessionId: string,
    name: string,
    reason: string,
    disclosureMode: string,
  ): Promise<ConfirmResult>;
  listBookings(): Promise<Booking[]>;
  reset(seed?: Slot[]): Promise<void>;
}

export const HOLD_MINUTES = 10;
