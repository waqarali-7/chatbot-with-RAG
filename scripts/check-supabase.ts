/**
 * Verify the Supabase connection and schema.
 *
 *   pnpm check:supabase
 *
 * Every failure here has a fallback that keeps the app running, which is
 * convenient and also means a broken setup looks exactly like no setup. This
 * script is the thing that tells them apart.
 */
import './load-env';
import { supabase } from '../lib/db/client';
import { providerForRole } from '../config/models';

const ok = (s: string) => console.log(`  ok    ${s}`);
const bad = (s: string) => console.log(`  FAIL  ${s}`);
const note = (s: string) => console.log(`        ${s}`);

async function main() {
  console.log('\nenvironment');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  url ? ok(`SUPABASE_URL ${url.replace(/^https:\/\/([^.]{6}).*/, 'https://$1….supabase.co')}`) : bad('SUPABASE_URL not set');
  key ? ok(`key set (${key.slice(0, 10)}…, ${key.length} chars)`) : bad('no SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY');

  const db = supabase();
  if (!db) {
    bad('not connecting; the app will use the in-process store');
    process.exit(1);
  }

  // Checked over raw REST rather than through supabase-js: a HEAD count against
  // a table that does not exist comes back as {count: null, error: null}, so the
  // client reports a missing schema as an empty one.
  console.log('\ntables');
  let missingTables = 0;
  for (const table of ['slots', 'bookings', 'doc_chunks', 'traces']) {
    const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=0`, {
      headers: { apikey: key!, authorization: `Bearer ${key}`, prefer: 'count=exact' },
    });
    if (res.status === 404) {
      missingTables++;
      bad(`${table}: does not exist`);
    } else if (!res.ok) {
      bad(`${table}: ${res.status} ${(await res.text()).slice(0, 120)}`);
    } else {
      const range = res.headers.get('content-range') ?? '';
      ok(`${table}: ${range.split('/')[1] ?? '?'} rows`);
    }
  }

  console.log('\nfunctions (these are what make double-booking impossible)');
  let missingFns = 0;
  for (const [fn, args] of [
    ['release_expired_holds', {}],
    ['hold_slot', { p_slot_id: '00000000-0000-0000-0000-000000000000', p_session: 'check', p_minutes: 1 }],
    ['confirm_slot', { p_slot_id: '00000000-0000-0000-0000-000000000000', p_session: 'check', p_name: 'check', p_reason: 'check', p_mode: 'minimal' }],
  ] as [string, Record<string, unknown>][]) {
    const { error } = await db.rpc(fn, args);
    // A "not found" row is a healthy answer here; a missing function is not.
    if (error && /does not exist|Could not find the function/i.test(error.message)) {
      missingFns++;
      bad(`${fn} missing`);
    }
    else if (error) bad(`${fn}: ${error.message}`);
    else ok(fn);
  }

  console.log('\nretrieval');
  const embedding = providerForRole('embedding');
  if (embedding !== 'openai') {
    note('OPENAI_API_KEY not set, so retrieval stays on the bundled BM25 index.');
    note('Supabase alone gives you the persistent slot store and traces, not dense retrieval.');
  } else {
    const { count } = await db.from('doc_chunks').select('*', { count: 'exact', head: true });
    if (!count) bad('doc_chunks is empty. Run `pnpm ingest` to populate pgvector.');
    else ok(`pgvector ready, ${count} chunks embedded`);
  }

  if (missingTables || missingFns) {
    console.log('\nnext step');
    note('The schema has not been applied. Open the Supabase SQL editor, paste the whole of');
    note('lib/db/schema.sql, and run it. Then re-run this check.');
    note('If the tables exist but the functions do not, the schema cache may be stale:');
    note('Settings > API > Reload schema cache, or just re-run schema.sql.');
    console.log('');
    process.exit(1);
  }

  console.log('\nready. Run `pnpm seed` to populate the diary.\n');
}

main().catch((e) => {
  console.error(`\nfailed: ${e}\n`);
  process.exit(1);
});
