// Self-hosted Swagger UI for the public read-only API (api-docs.html entry).
//
// The spec is a committed snapshot of PostgREST's OpenAPI output
// (public/openapi.json). Supabase serves the live spec endpoint only to
// secret API keys, so the browser cannot fetch it directly; the snapshot is
// refreshed whenever a schema migration lands (see CLAUDE.md). "Try it out"
// still runs against the live API with the publishable (read-only) token.
// swagger-ui-dist is bundled by Vite; nothing loads from a CDN.

import SwaggerUIBundle from 'swagger-ui-dist/swagger-ui-bundle';
import 'swagger-ui-dist/swagger-ui.css';

const API_HOST = 'wlakioilvvuuizxdhsdf.supabase.co';
const API_BASE_PATH = '/rest/v1';
// Public read-only access token (row-level security enforces SELECT).
const TOKEN = 'sb_publishable_mANlk3lYBOM8DWDKUjvhRg_yq0TyTEM';

interface SpecParameter {
  name: string;
  description?: string;
  type?: string;
  format?: string;
}

interface PostgrestSpec {
  info: { title: string; description: string; version: string };
  host: string;
  basePath: string;
  schemes?: string[];
  paths: Record<string, Record<string, unknown>>;
  parameters?: Record<string, SpecParameter>;
  definitions?: Record<string, { properties?: Record<string, { format?: string; type?: string }> }>;
}

async function boot(): Promise<void> {
  let spec: PostgrestSpec;
  try {
    const res = await fetch('openapi.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    spec = (await res.json()) as PostgrestSpec;
  } catch {
    const mount = document.getElementById('swagger-ui');
    if (mount) {
      mount.textContent =
        'Could not load the API definition (openapi.json). Reload the page, or use the Data & API overview instead.';
    }
    return;
  }

  // The snapshot is verbatim PostgREST output; adjust it for display here so
  // a plain curl refresh of the file never loses these fixes.
  spec.info.title = 'AI Regulation Map API';
  spec.info.description =
    'Read-only REST API (PostgREST) over the AI Regulation Map database: ' +
    'scores, summaries, score history, sources, and OECD/GAIIN policy ' +
    'initiatives. Filter with PostgREST operators, e.g. ' +
    '?select=name,avg_score&avg_score=gte.4&order=avg_score.desc';
  spec.host = API_HOST;
  spec.basePath = API_BASE_PATH;
  spec.schemes = ['https'];
  // The spec's self-description endpoint now requires a secret key: drop it.
  delete spec.paths['/'];
  // The anon role can only SELECT; documenting the write verbs PostgREST
  // advertises would just be a wall of guaranteed 401s.
  for (const operations of Object.values(spec.paths)) {
    for (const verb of Object.keys(operations)) {
      if (verb !== 'get' && verb !== 'parameters') delete operations[verb];
    }
  }
  // Column-filter query parameters are all type "string" in the spec because
  // their value is a PostgREST filter expression (eq.4, gte.2020, is.null),
  // not a bare value. Prefix each description with the column's actual
  // Postgres type, pulled from the table's schema definition.
  for (const [key, param] of Object.entries(spec.parameters ?? {})) {
    const m = /^rowFilter\.([^.]+)\.(.+)$/.exec(key);
    if (!m) continue;
    const column = spec.definitions?.[m[1]]?.properties?.[m[2]];
    const pgType = column?.format ?? column?.type;
    if (!pgType) continue;
    const doc = param.description ? ` ${param.description}` : '';
    param.description = `\`${pgType}\` column.${doc} Value is a filter expression: \`eq.\`, \`gte.\`, \`lte.\`, \`like.\`, \`is.null\`, ...`;
  }

  SwaggerUIBundle({
    spec,
    dom_id: '#swagger-ui',
    deepLinking: true,
    tryItOutEnabled: true,
    supportedSubmitMethods: ['get'],
    // The schemas section is the per-table column reference (real Postgres
    // types plus the column comments): show it, collapsed.
    defaultModelsExpandDepth: 0,
    requestInterceptor: (request: { headers: Record<string, string> }) => {
      request.headers['apikey'] = TOKEN;
      request.headers['Authorization'] = `Bearer ${TOKEN}`;
      return request;
    },
  });
}

void boot();
