/**
 * Load .env.local then .env into process.env.
 *
 * Next.js does this automatically; a bare tsx script does not. Without it
 * `pnpm ingest` and `pnpm seed` read an empty environment and silently skip
 * Postgres, which looks identical to Supabase not being configured at all.
 *
 * Import this first, before anything that reads process.env at module scope.
 */
import fs from 'node:fs';
import path from 'node:path';

function load(file: string): number {
  const full = path.join(process.cwd(), file);
  if (!fs.existsSync(full)) return 0;
  let n = 0;
  for (const raw of fs.readFileSync(full, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue; // real env wins
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!value) continue; // an empty assignment is "not set", not ""
    process.env[key] = value;
    n++;
  }
  return n;
}

// .env.local first: it wins, matching Next.js precedence.
export const loadedVars = load('.env.local') + load('.env');
