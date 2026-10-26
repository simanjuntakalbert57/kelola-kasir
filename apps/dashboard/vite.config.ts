import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // `pnpm dev:mock` talks to the Prism mock (`pnpm mock`, :4010, paths without /v1);
  // `pnpm dev` talks to the real API (VITE_API_PROXY, default http://localhost:3000).
  const mock = mode === 'mock';
  const target = mock
    ? 'http://localhost:4010'
    : (env['VITE_API_PROXY'] ?? 'http://localhost:3000');
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: {
        '/v1': {
          target,
          changeOrigin: true,
          ...(mock ? { rewrite: (path: string) => path.replace(/^\/v1/, '') } : {}),
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: false,
    },
  };
});
