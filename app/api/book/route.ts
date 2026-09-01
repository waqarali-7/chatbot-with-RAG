import { NextRequest } from 'next/server';
import { confirmBooking } from '@/lib/booking/confirm';
import { slotStore } from '@/lib/booking/store';
import { disclosureModeFromEnv } from '@/lib/agent/types';
import { clientKey, rateLimit } from '@/lib/util/ratelimit';

export const runtime = 'edge';

/**
 * Direct booking endpoint. The agent does not use this — it books through
 * lib/booking/confirm.ts inside the turn loop — but it exists so the booking
 * contract can be exercised without the chat, which is how the locking test in
 * lib/booking/booking.test.ts is written.
 */
export async function POST(req: NextRequest) {
  if (!rateLimit(clientKey(req)).allowed) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as {
    slotId?: string;
    sessionId?: string;
    name?: string;
    reason?: string;
  } | null;

  if (!body?.slotId || !body.name || !body.reason) {
    return Response.json({ error: 'slotId, name and reason are required' }, { status: 400 });
  }

  const result = await confirmBooking(slotStore(), {
    slotId: body.slotId,
    sessionId: (body.sessionId ?? crypto.randomUUID()).slice(0, 64),
    name: body.name.slice(0, 80),
    reason: body.reason.slice(0, 200),
    disclosureMode: disclosureModeFromEnv(),
  });

  return Response.json(result, { status: result.ok ? 200 : 409 });
}
