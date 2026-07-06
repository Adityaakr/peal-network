import { defineConfig } from 'vite';

// The explorer talks same-origin (/v0/...) and vite proxies to the
// coordinator, so the browser never cares which port the coordinator is on.
// Point BTE_URL somewhere else if 8080 is taken:
//   BTE_URL=http://localhost:18080 pnpm dev
const target = process.env.BTE_URL ?? 'http://localhost:8080';

export default defineConfig({
  server: {
    proxy: { '/v0': { target, changeOrigin: true } },
  },
  preview: {
    proxy: { '/v0': { target, changeOrigin: true } },
  },
});
