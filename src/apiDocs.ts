// Self-hosted Swagger UI for the public read-only API (api-docs.html entry).
//
// The spec is PostgREST's own OpenAPI output, fetched live from the API root —
// zero drift from the actual schema. The publishable (read-only) token is
// injected into every request, including the spec fetch and "Try it out".
// swagger-ui-dist is bundled by Vite; nothing loads from a CDN.

import SwaggerUIBundle from 'swagger-ui-dist/swagger-ui-bundle';
import 'swagger-ui-dist/swagger-ui.css';

const API_ROOT = 'https://wlakioilvvuuizxdhsdf.supabase.co/rest/v1/';
// Public read-only access token (row-level security enforces SELECT).
const TOKEN = 'sb_publishable_mANlk3lYBOM8DWDKUjvhRg_yq0TyTEM';

SwaggerUIBundle({
  url: API_ROOT,
  dom_id: '#swagger-ui',
  deepLinking: true,
  tryItOutEnabled: true,
  // PostgREST's spec advertises every verb the role COULD have; the anon
  // role can only SELECT, so only document GET.
  supportedSubmitMethods: ['get'],
  defaultModelsExpandDepth: -1,
  requestInterceptor: (request: { headers: Record<string, string> }) => {
    request.headers['apikey'] = TOKEN;
    request.headers['Authorization'] = `Bearer ${TOKEN}`;
    return request;
  },
});
