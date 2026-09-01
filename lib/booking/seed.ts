import { mulberry32, seedFrom } from '@/lib/util/rand';
import type { Slot } from './types';

export const LOCATIONS = ['Docklands', 'Shoreditch', 'Clapham'] as const;

export const PRACTITIONERS: { name: string; location: string; service: string }[] = [
  { name: 'Dr Aisha Rana', location: 'Docklands', service: 'General dentistry' },
  { name: 'Dr Tom Okafor', location: 'Docklands', service: 'General dentistry' },
  { name: 'Elena Marchetti', location: 'Docklands', service: 'Aesthetics' },
  { name: 'Dr Priya Nair', location: 'Shoreditch', service: 'General dentistry' },
  { name: 'Jo Bennett', location: 'Shoreditch', service: 'Hygiene' },
  { name: 'Dr Sam Whitfield', location: 'Clapham', service: 'General dentistry' },
  { name: 'Hana Suzuki', location: 'Clapham', service: 'Aesthetics' },
];

const START_HOUR = 9;
const END_HOUR = 18;

/**
 * Deterministic synthetic slot grid. Roughly 45% of the grid is pre-booked so
 * availability looks like a real diary rather than a wall of free time — an
 * agent that can offer any slot at any time is an obvious tell.
 */
export function generateSlots(baseMs: number, days = 10): Slot[] {
  const rng = mulberry32(seedFrom('slots', Math.floor(baseMs / 86_400_000)));
  const out: Slot[] = [];
  const base = new Date(baseMs);
  base.setUTCHours(0, 0, 0, 0);

  for (let d = 1; d <= days; d++) {
    const day = new Date(base.getTime() + d * 86_400_000);
    const dow = day.getUTCDay();
    if (dow === 0) continue; // closed Sunday
    const lastHour = dow === 6 ? 14 : END_HOUR; // short Saturday

    for (const p of PRACTITIONERS) {
      for (let h = START_HOUR; h < lastHour; h++) {
        for (const m of [0, 30]) {
          if (h === 13) continue; // lunch
          const startsAt = new Date(
            Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m),
          );
          const booked = rng() < 0.45;
          out.push({
            id: `slot_${startsAt.toISOString().slice(0, 16).replace(/[-:T]/g, '')}_${p.name
              .toLowerCase()
              .replace(/[^a-z]/g, '')
              .slice(0, 10)}`,
            startsAt: startsAt.toISOString(),
            location: p.location,
            practitioner: p.name,
            service: p.service,
            status: booked ? 'booked' : 'open',
            heldUntil: null,
            heldBy: null,
          });
        }
      }
    }
  }
  return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
