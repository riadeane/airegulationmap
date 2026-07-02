// Source metadata from the sources database: page titles and refined
// source types, keyed by URL. The panel renders bare hostnames until this
// arrives, then upgrades to titles (see panel/sections.renderSources).
// Only rows that actually carry a title are fetched — most don't until
// the enrichment job runs, and hostnames need no help.

import { setState } from '../state/store';
import type { SourceMeta } from './sources';
import { restGet } from './supabase';

export async function loadSourceMeta(): Promise<void> {
  const rows = await restGet('sources?select=url,title,source_type&title=not.is.null&limit=10000');
  if (!Array.isArray(rows) || rows.length === 0) return;
  const meta: SourceMeta = {};
  for (const row of rows as { url?: string; title?: string; source_type?: string }[]) {
    if (!row.url) continue;
    meta[row.url] = { title: row.title ?? null, sourceType: row.source_type ?? null };
  }
  if (Object.keys(meta).length > 0) setState({ sourceMeta: meta });
}
