import { DISCLOSURE } from '@/lib/agent/disclosure';
import { disclosureModeFromEnv } from '@/lib/agent/types';

/** Server-side disclosure config for the chat surface. */
export function chatDisclosure() {
  return DISCLOSURE[disclosureModeFromEnv()];
}
