import type { SupabaseClient } from '@supabase/supabase-js';
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

type SlotRow = {
  id: string;
  starts_at: string;
  location: string;
  practitioner: string;
  service: string;
  status: Slot['status'];
  held_until: string | null;
  held_by: string | null;
};

const toSlot = (r: SlotRow): Slot => ({
  id: r.id,
  startsAt: new Date(r.starts_at).toISOString(),
  location: r.location,
  practitioner: r.practitioner,
  service: r.service,
  status: r.status,
  heldUntil: r.held_until ? new Date(r.held_until).toISOString() : null,
  heldBy: r.held_by,
});

/**
 * Postgres-backed store. Hold and confirm go through plpgsql functions that
 * take a row-level lock (see lib/db/schema.sql) rather than doing read-then-write
 * from the client, which would race under two concurrent testers.
 */
export class SupabaseSlotStore implements SlotStore {
  readonly kind = 'supabase' as const;

  constructor(private db: SupabaseClient) {}

  async listOpen(q: AvailabilityQuery = {}): Promise<Slot[]> {
    await this.releaseExpired();
    let query = this.db
      .from('slots')
      .select('*')
      .gt('starts_at', q.fromISO ?? new Date().toISOString())
      .order('starts_at', { ascending: true })
      .limit(q.limit ?? 200);
    // A session's own soft holds stay visible to that session.
    query = q.sessionId
      ? query.or(`status.eq.open,and(status.eq.held,held_by.eq.${q.sessionId})`)
      : query.eq('status', 'open');
    if (q.location) query = query.eq('location', q.location);
    if (q.service) query = query.eq('service', q.service);
    const { data, error } = await query;
    if (error) throw new Error(`listOpen: ${error.message}`);
    return (data as SlotRow[]).map(toSlot);
  }

  async getSlot(id: string): Promise<Slot | null> {
    const { data, error } = await this.db.from('slots').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`getSlot: ${error.message}`);
    return data ? toSlot(data as SlotRow) : null;
  }

  async hold(slotId: string, sessionId: string, minutes = HOLD_MINUTES): Promise<HoldResult> {
    const { data, error } = await this.db.rpc('hold_slot', {
      p_slot_id: slotId,
      p_session: sessionId,
      p_minutes: minutes,
    });
    if (error) throw new Error(`hold: ${error.message}`);
    const row = Array.isArray(data) ? data[0] : data;
    return row?.ok
      ? { ok: true, heldUntil: new Date(row.held_until).toISOString() }
      : { ok: false, reason: (row?.reason ?? 'not_found') as HoldResult extends { ok: false } ? never : never };
  }

  async releaseExpired(): Promise<number> {
    const { data, error } = await this.db.rpc('release_expired_holds');
    if (error) throw new Error(`releaseExpired: ${error.message}`);
    return Number(data ?? 0);
  }

  async confirm(
    slotId: string,
    sessionId: string,
    name: string,
    reason: string,
    disclosureMode: string,
  ): Promise<ConfirmResult> {
    if (!name.trim() || !reason.trim()) return { ok: false, reason: 'missing_details' };
    const { data, error } = await this.db.rpc('confirm_slot', {
      p_slot_id: slotId,
      p_session: sessionId,
      p_name: name.trim(),
      p_reason: reason.trim(),
      p_mode: disclosureMode,
    });
    if (error) throw new Error(`confirm: ${error.message}`);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.ok) return { ok: false, reason: row?.reason ?? 'not_found' };
    const slot = await this.getSlot(slotId);
    return { ok: true, bookingId: row.booking_id, slot: slot! };
  }

  async listBookings(): Promise<Booking[]> {
    const { data, error } = await this.db
      .from('bookings')
      .select('*, slots(*)')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw new Error(`listBookings: ${error.message}`);
    return (data as Record<string, unknown>[]).map((b) => ({
      id: b.id as string,
      slotId: b.slot_id as string,
      sessionId: b.session_id as string,
      name: b.name as string,
      reason: b.reason as string,
      disclosureMode: b.disclosure_mode as string,
      createdAt: new Date(b.created_at as string).toISOString(),
      slot: b.slots ? toSlot(b.slots as SlotRow) : undefined,
    }));
  }

  /** Used by the nightly cron to restore a clean demo state. */
  async reset(seed?: Slot[]): Promise<void> {
    await this.db.from('bookings').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await this.db.from('slots').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    const rows = (seed ?? generateSlots(Date.now())).map((s) => ({
      starts_at: s.startsAt,
      location: s.location,
      practitioner: s.practitioner,
      service: s.service,
      status: s.status,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await this.db.from('slots').insert(rows.slice(i, i + 500));
      if (error) throw new Error(`reset: ${error.message}`);
    }
  }
}
