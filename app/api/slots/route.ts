import { NextRequest } from 'next/server';
import { getAvailability, shortlist } from '@/lib/booking/availability';
import { slotStore } from '@/lib/booking/store';

export const runtime = 'edge';

/** Open availability. Read-only, used by the demo to show the diary is real. */
export async function GET(req: NextRequest) {
  const location = req.nextUrl.searchParams.get('location') ?? undefined;
  const slots = await getAvailability(slotStore(), { location });
  return Response.json({
    open: slots.length,
    next: shortlist(slots, 8).map((s) => ({
      id: s.id,
      startsAt: s.startsAt,
      location: s.location,
      practitioner: s.practitioner,
      service: s.service,
    })),
  });
}
