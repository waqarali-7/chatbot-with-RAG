import { supabase } from '@/lib/db/client';
import { MemorySlotStore } from './memory-store';
import { SupabaseSlotStore } from './supabase-store';
import type { SlotStore } from './types';

let singleton: SlotStore | null = null;

/** Process-wide store. Supabase when configured, in-process otherwise. */
export function slotStore(): SlotStore {
  if (singleton) return singleton;
  const db = supabase();
  singleton = db ? new SupabaseSlotStore(db) : new MemorySlotStore();
  return singleton;
}

/** Test seam — lets evals drive an isolated store with a frozen clock. */
export function setSlotStore(store: SlotStore | null): void {
  singleton = store;
}
