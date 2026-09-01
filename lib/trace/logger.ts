import { supabase } from '@/lib/db/client';
import type { TurnTrace } from '@/lib/agent/types';

type Sink = (trace: TurnTrace) => void | Promise<void>;

const memory: TurnTrace[] = [];
const sinks: Sink[] = [];

/**
 * One trace per turn: input, retrieved chunk ids, prompt tokens, latency,
 * output, guardrail verdicts and disclosure mode. The eval harness reads the
 * same records the live route writes, so a number on the scorecard can always be
 * traced back to the turn that produced it.
 */
export async function recordTrace(trace: TurnTrace): Promise<void> {
  memory.push(trace);
  if (memory.length > 2000) memory.splice(0, memory.length - 2000);
  for (const s of sinks) await s(trace);

  const db = supabase();
  if (!db) return;
  try {
    await db.from('traces').insert({
      session_id: trace.sessionId,
      turn_index: trace.turnIndex,
      disclosure_mode: trace.disclosureMode,
      payload: trace,
    });
  } catch {
    // Tracing must never take the chat down.
  }
}

export function addSink(sink: Sink): () => void {
  sinks.push(sink);
  return () => {
    const i = sinks.indexOf(sink);
    if (i >= 0) sinks.splice(i, 1);
  };
}

export function recentTraces(sessionId?: string): TurnTrace[] {
  return sessionId ? memory.filter((t) => t.sessionId === sessionId) : [...memory];
}

export function clearTraces(): void {
  memory.length = 0;
}
