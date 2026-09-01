import { NextRequest } from 'next/server';
import { runTurn, SESSION_TURN_CAP } from '@/lib/agent/loop';
import {
  disclosureModeFromEnv,
  newConversationState,
  type ConversationState,
  type Turn,
} from '@/lib/agent/types';
import { slotStore } from '@/lib/booking/store';
import { recordTrace } from '@/lib/trace/logger';
import { clientKey, rateLimit } from '@/lib/util/ratelimit';

/**
 * Node runtime, deliberately, not edge.
 *
 * The spec asks for edge here and edge is the right choice once Supabase backs
 * the slot store — switching is this one line. But with no Supabase configured
 * the store is in-process, and an edge function does not share process memory
 * with the Node-rendered /admin page, so a booking made in the chat would never
 * appear there. "A cold visitor can open the link, book, and see it in /admin"
 * is a definition-of-done item, and it should hold with zero setup rather than
 * only after a database is provisioned.
 *
 * Nothing is lost by it: this route does not stream tokens to the client. The
 * style validator and the output guardrails need the whole generation before
 * anything reaches the visitor, so what streams is finished bubbles on a timer,
 * which Node serverless streams just as well.
 */
export const runtime = 'nodejs';

interface ChatRequest {
  sessionId: string;
  message: string;
  state?: ConversationState;
  history?: Turn[];
}

const encoder = new TextEncoder();
const sse = (event: unknown) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`);

/**
 * Streaming chat.
 *
 * Note what is streamed: bubbles, not tokens. The style validator and the output
 * guardrails need the whole generation before anything reaches the visitor, so
 * token streaming would mean streaming text that might then have to be
 * withdrawn. What the visitor sees instead is the typing indicator and then a
 * message arriving, which is the behaviour §5.3 is actually asking for. Time to
 * first token is still measured from the provider stream and lands in the trace.
 *
 * Conversation state round-trips through the client. It is never trusted for
 * booking authority: every slot is re-checked against the store under a row
 * lock before anything is held or confirmed, so a tampered state cannot create
 * a booking that the slot store would not allow anyway.
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(clientKey(req));
  if (!limit.allowed) {
    return new Response(
      JSON.stringify({ error: 'rate_limited', resetAt: limit.resetAt }),
      { status: 429, headers: { 'content-type': 'application/json' } },
    );
  }

  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return new Response(JSON.stringify({ error: 'bad_request' }), { status: 400 });
  }

  const message = (body.message ?? '').toString().slice(0, 2000).trim();
  if (!message) return new Response(JSON.stringify({ error: 'empty_message' }), { status: 400 });

  const mode = disclosureModeFromEnv();
  const sessionId = (body.sessionId || crypto.randomUUID()).slice(0, 64);
  const state = body.state ?? newConversationState(sessionId, mode);
  state.sessionId = sessionId;
  state.disclosureMode = mode;
  const history = (body.history ?? []).slice(-24);

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const result = await runTurn({ message, state, history, store: slotStore() });

        for (const bubble of result.bubbles) {
          controller.enqueue(sse({ type: 'typing', ms: bubble.delayMs }));
          await new Promise((r) => setTimeout(r, bubble.delayMs));
          controller.enqueue(sse({ type: 'bubble', text: bubble.text }));
        }

        controller.enqueue(
          sse({
            type: 'done',
            state: result.state,
            turnsRemaining: Math.max(0, SESSION_TURN_CAP - result.state.turnIndex),
            closed: result.state.closed || result.state.handedOff,
          }),
        );
        await recordTrace(result.trace);
      } catch (err) {
        controller.enqueue(sse({ type: 'error', message: String(err) }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-ratelimit-remaining': String(limit.remaining),
    },
  });
}
