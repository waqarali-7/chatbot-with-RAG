import { describeSlotFull } from '@/lib/booking/availability';
import { slotStore } from '@/lib/booking/store';
import { DISCLOSURE } from '@/lib/agent/disclosure';
import type { DisclosureMode } from '@/lib/agent/types';

export const dynamic = 'force-dynamic';

/**
 * Bookings the agent actually made. The point of this page is that a booking can
 * be verified against the slot store rather than taken on trust from what the
 * chat said.
 */
export default async function AdminPage() {
  const store = slotStore();
  const [bookings, open] = await Promise.all([store.listBookings(), store.listOpen({ limit: 500 })]);
  const now = Date.now();

  return (
    <main className="mx-auto max-w-[62rem] px-5 py-10">
      <header className="border-b border-[var(--color-rule)] pb-5">
        <h1 className="text-[22px] font-semibold tracking-[-0.01em]">Bookings</h1>
        <p className="mt-2 text-[14px] text-[var(--color-ink-soft)]">
          {bookings.length} booked, {open.length} slots still open. Store:{' '}
          <span className="tnum">{store.kind}</span>. Slots reset nightly.
        </p>
        {store.kind === 'memory' && (
          <p className="mt-2 max-w-[46rem] text-[13px] leading-[1.6] text-[var(--color-ink-faint)]">
            No Supabase configured, so the slot store lives in this server process. That is fine for a
            single instance and it is what makes the demo run with no setup, but on a multi-instance
            deployment each instance would keep its own diary. Set SUPABASE_URL and
            SUPABASE_SERVICE_ROLE_KEY to move it to Postgres, where the row-level locks in
            lib/db/schema.sql do the work.
          </p>
        )}
      </header>

      {bookings.length === 0 ? (
        <p className="mt-8 text-[15px] text-[var(--color-ink-soft)]">
          Nothing booked yet. Book something in the chat and it appears here.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[46rem] border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-[var(--color-rule-strong)] text-left text-[12px] text-[var(--color-ink-faint)]">
                <Th>When</Th>
                <Th>Name</Th>
                <Th>Reason</Th>
                <Th>Site</Th>
                <Th>Clinician</Th>
                <Th>Mode</Th>
                <Th>Booked at</Th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.id} className="border-b border-[var(--color-rule)] align-top">
                  <Td className="tnum whitespace-nowrap">
                    {b.slot ? describeSlotFull(b.slot, now).split(', ')[0] : '—'}
                  </Td>
                  <Td>{b.name}</Td>
                  <Td className="text-[var(--color-ink-soft)]">{b.reason}</Td>
                  <Td>{b.slot?.location ?? '—'}</Td>
                  <Td className="text-[var(--color-ink-soft)]">{b.slot?.practitioner ?? '—'}</Td>
                  <Td className="text-[var(--color-ink-soft)]">
                    {DISCLOSURE[b.disclosureMode as DisclosureMode]?.label ?? b.disclosureMode}
                  </Td>
                  <Td className="tnum whitespace-nowrap text-[var(--color-ink-faint)]">
                    {new Date(b.createdAt).toISOString().slice(0, 16).replace('T', ' ')}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

const Th = ({ children }: { children: React.ReactNode }) => (
  <th className="py-2 pr-6 font-medium">{children}</th>
);

const Td = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <td className={`py-2.5 pr-6 ${className}`}>{children}</td>
);
