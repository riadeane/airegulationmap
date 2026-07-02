// Thin PostgREST reader for the Supabase project — deliberately NOT
// @supabase/supabase-js: anonymous selects are ~40 lines of fetch, the
// bundle stays honest, and Playwright can mock `**/rest/v1/**` routes
// without a client library in the way.
//
// The app is static-first: everything here is progressive enhancement.
// Missing env vars or failed requests degrade to exactly the behavior
// the static files already provide, which is also what keeps CI
// deterministic without secrets.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export function isConfigured(): boolean {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}

let warned = false;
function warnOnce(reason: unknown): void {
  if (warned) return;
  warned = true;
  console.warn('supabase: unreachable — static data remains authoritative.', reason);
}

/**
 * GET a PostgREST path (e.g. `public_export?select=country,avg_score`).
 * Returns parsed JSON, or null on ANY failure (unconfigured, timeout,
 * network, non-2xx) — callers treat null as "feature stays static".
 */
export async function restGet(
  path: string,
  { timeoutMs = 4000 }: { timeoutMs?: number } = {}
): Promise<unknown | null> {
  if (!isConfigured()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: {
        apikey: SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      signal: controller.signal,
    });
    if (!resp.ok) {
      warnOnce(`HTTP ${resp.status}`);
      return null;
    }
    return await resp.json();
  } catch (err) {
    warnOnce(err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
