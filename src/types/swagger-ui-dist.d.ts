// Minimal typings for the bundled Swagger UI entry point; the upstream
// @types package pulls in more than this single-call usage needs.
declare module 'swagger-ui-dist/swagger-ui-bundle' {
  interface SwaggerUIOptions {
    url?: string;
    spec?: object;
    dom_id: string;
    deepLinking?: boolean;
    tryItOutEnabled?: boolean;
    supportedSubmitMethods?: string[];
    defaultModelsExpandDepth?: number;
    requestInterceptor?: (request: { headers: Record<string, string> }) => unknown;
  }
  const SwaggerUIBundle: (options: SwaggerUIOptions) => unknown;
  export default SwaggerUIBundle;
}

declare module 'swagger-ui-dist/swagger-ui.css';
