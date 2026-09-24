import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // The map app plus the self-hosted Swagger UI page (bundles
        // swagger-ui-dist at build time - no CDN, no vendored blobs).
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        apiDocs: fileURLToPath(new URL('./api-docs.html', import.meta.url)),
        // The weekly changes page renders public/digest/ client-side.
        changes: fileURLToPath(new URL('./changes.html', import.meta.url)),
        // The drift dashboard renders history.json / drift.json client-side.
        drift: fileURLToPath(new URL('./drift.html', import.meta.url)),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
})
