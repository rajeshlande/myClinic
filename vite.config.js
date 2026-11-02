import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

/** Short commit id for support ("which build are you on?"). */
function commitId() {
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return String(process.env.GITHUB_SHA ?? 'dev').slice(0, 7); }
}

/**
 * Base path resolution. Defaults to a relative base ("./") so the same build
 * works on localhost, https://USER.github.io/REPO/, a custom domain, or any
 * sub-path — no per-repo configuration. Hash routing means every page resolves
 * against index.html, so relative asset URLs are always correct.
 *
 * Set VITE_BASE (e.g. "/myclinic/") only if you deliberately want absolute URLs.
 */
const override = process.env.VITE_BASE;
const base = override ? (override.endsWith('/') ? override : `${override}/`) : './';

export default defineConfig({
  base,
  plugins: [react()],
  define: {
    __BUILD_BASE__: JSON.stringify(base),
    __MYCLINIC_BUILD__: JSON.stringify({ id: commitId(), at: new Date().toISOString() }),
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    // The Arena preview proxies the dev server from a different host name.
    allowedHosts: true,
    cors: true,
  },
  preview: { host: '0.0.0.0', allowedHosts: true, cors: true },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Vite 8 / rolldown requires a function here, not the object form.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@supabase')) return 'supabase';
          if (/node_modules[\\/](react|react-dom|react-router|scheduler)/.test(id)) return 'react';
          return undefined;
        },
      },
    },
  },
});
