import type {
  AvailabilityQuery,
  Booking,
  ConfirmResult,
  HoldResult,
  Slot,
  SlotStore,
} from './types';
import { HOLD_MINUTES } from './types';
import { generateSlots } from './seed';

/**
 * In-process slot store used when Supabase is not configured, and by the eval
 * harness where a network round trip per turn would dominate the latency
 * numbers. It implements the same contract as the Postgres store, including
 * mutual exclusion on hold and confirm — the eval that proves double-booking is
 * impossible has to be able to run here too.
 */
export class MemorySlotStore implements SlotStore {
  readonly kind = 'memory' as const;

  private slots = new Map<string, Slot>();
  private bookings: Booking[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private seq = 0;

  constructor(private now: () => number = () => Date.now()) {
    this.seedFrom(generateSlots(this.now()));
  }

  /** Serialises every mutation. This is the in-process stand-in for FOR UPDATE. */
  private lock<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private seedFrom(slots: Slot[]) {
    this.slots.clear();
    for (const s of slots) this.slots.set(s.id, { ...s });
  }

  private sweep(): number {
    const t = this.now();
    let n = 0;
    for (const s of this.slots.values()) {
      if (s.status === 'held' && s.heldUntil && Date.parse(s.heldUntil) < t) {
        s.status = 'open';
        s.heldUntil = null;
        s.heldBy = null;
        n++;
      }
    }
    return n;
  }

  async listOpen(q: AvailabilityQuery = {}): Promise<Slot[]> {
    return this.lock(() => {
      this.sweep();
      const from = q.fromISO ? Date.parse(q.fromISO) : this.now();
      const out = [...this.slots.values()]
        .filter((s) => s.status === 'open' || (s.status === 'held' && s.heldBy === q.sessionId))
        .filter((s) => Date.parse(s.startsAt) > from)
        .filter((s) => !q.location || s.location.toLowerCase() === q.location.toLowerCase())
        .filter((s) => !q.service || s.service.toLowerCase() === q.service.toLowerCase())
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      return out.slice(0, q.limit ?? 200).map((s) => ({ ...s }));
    });
  }

  async getSlot(id: string): Promise<Slot | null> {
    const s = this.slots.get(id);
    return s ? { ...s } : null;
  }

  async hold(slotId: string, sessionId: string, minutes = HOLD_MINUTES): Promise<HoldResult> {
    return this.lock(() => {
      this.sweep();
      const s = this.slots.get(slotId);
      if (!s) return { ok: false, reason: 'not_found' } as HoldResult;
      if (s.status === 'booked') return { ok: false, reason: 'already_booked' } as HoldResult;
      if (s.status === 'held' && s.heldBy !== sessionId) {
        return { ok: false, reason: 'held_by_other' } as HoldResult;
      }
      const until = new Date(this.now() + minutes * 60_000).toISOString();
      s.status = 'held';
      s.heldBy = sessionId;
      s.heldUntil = until;
      return { ok: true, heldUntil: until } as HoldResult;
    });
  }

  async releaseExpired(): Promise<number> {
    return this.lock(() => this.sweep());
  }

  async confirm(
    slotId: string,
    sessionId: string,
    name: string,
    reason: string,
    disclosureMode: string,
  ): Promise<ConfirmResult> {
    return this.lock(() => {
      if (!name.trim() || !reason.trim()) {
        return { ok: false, reason: 'missing_details' } as ConfirmResult;
      }
      this.sweep();
      const s = this.slots.get(slotId);
      if (!s) return { ok: false, reason: 'not_found' } as ConfirmResult;
      if (s.status === 'booked') return { ok: false, reason: 'already_booked' } as ConfirmResult;
      if (s.status === 'held' && s.heldBy !== sessionId) {
        return { ok: false, reason: 'held_by_other' } as ConfirmResult;
      }
      const booking: Booking = {
        id: `bk_${++this.seq}_${slotId.slice(-6)}`,
        slotId,
        sessionId,
        name: name.trim(),
        reason: reason.trim(),
        disclosureMode,
        createdAt: new Date(this.now()).toISOString(),
        slot: { ...s, status: 'booked' },
      };
      s.status = 'booked';
      s.heldBy = null;
      s.heldUntil = null;
      this.bookings.push(booking);
      return { ok: true, bookingId: booking.id, slot: { ...s } } as ConfirmResult;
    });
  }

  async listBookings(): Promise<Booking[]> {
    return this.bookings.map((b) => ({ ...b })).reverse();
  }

  async reset(seed?: Slot[]): Promise<void> {
    await this.lock(() => {
      this.bookings = [];
      this.seq = 0;
      this.seedFrom(seed ?? generateSlots(this.now()));
    });
  }
}
