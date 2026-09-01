import { NextRequest } from 'next/server';
import { slotStore } from '@/lib/booking/store';
import { generateSlots } from '@/lib/booking/seed';
import { clearTraces } from '@/lib/trace/logger';

export const runtime = 'nodejs';

/**
 * Nightly reset: regenerate the slot grid and clear demo conversations, so
 * whoever opens the link tomorrow finds a clean diary rather than one every
 * previous visitor has already booked out.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (secret && auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  await slotStore().reset(generateSlots(Date.now()));
  clearTraces();
  return Response.json({ ok: true, resetAt: new Date().toISOString() });
}
