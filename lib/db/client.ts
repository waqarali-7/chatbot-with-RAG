import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null | undefined;

/**
 * Returns null when Supabase is not configured. Every caller has an in-process
 * fallback, so the demo and the whole eval harness run with zero setup.
 *
 * Both key names are accepted. Supabase renamed the server-side key from
 * `service_role` to `secret` (sb_secret_...), and the dashboard now shows the
 * new one, so a project set up today and a project set up last year hand you
 * different variable names for the same thing.
 */
export function supabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

  // Half-configured is the dangerous state: without this the app silently falls
  // back to the in-process store and you spend an hour wondering why bookings
  // never reach Postgres.
  if (Boolean(url) !== Boolean(key)) {
    console.warn(
      `[supabase] ${url ? 'SUPABASE_URL is set but no key' : 'a key is set but no SUPABASE_URL'}. ` +
        'Falling back to the in-process store. Set both SUPABASE_URL and SUPABASE_SECRET_KEY ' +
        '(or SUPABASE_SERVICE_ROLE_KEY).',
    );
  }
  if (key && /^sb_publishable_|^eyJ.*anon/.test(key)) {
    console.warn(
      '[supabase] that looks like the publishable (anon) key. This app writes with row-level ' +
        'locks and needs the secret key.',
    );
  }

  cached =
    url && key
      ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
      : null;
  return cached;
}

export function hasSupabase(): boolean {
  return supabase() !== null;
}

/** Test seam. */
export function resetClientCache(): void {
  cached = undefined;
}
