import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/**
 * Resolves build-time connect-src origin from VITE_SUPABASE_URL (never hardcoded).
 * When unset, connect-src stays strictly `'self'`.
 */
function resolveCspConnectSrc() {
  const raw = String(process.env.VITE_SUPABASE_URL || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return ` ${parsed.origin}`;
    }
  } catch (e) {}
  return '';
}

function stripOfflineCssFallbackPlugin() {
  return {
    name: 'pcm-strip-offline-css-fallback',
    enforce: 'pre',
    transform(code, id) {
      if (id.endsWith('src/styles/app.css')) {
        return code.replace(/\/\* BEGIN_OFFLINE_FALLBACK_ONLY \*\/[\s\S]*?\/\* END_OFFLINE_FALLBACK_ONLY \*\//g, '');
      }
      return null;
    }
  };
}

function strictCspPlugin() {
  return {
    name: 'pcm-strict-csp',
    transformIndexHtml(html) {
      return html.replace(/__CSP_CONNECT_SRC__/g, resolveCspConnectSrc());
    }
  };
}

/**
 * Generates dist/precache-manifest.json listing all built assets and stamps
 * package.json version into dist/sw.js so offline caching never goes stale.
 */
function precacheManifestPlugin() {
  return {
    name: 'pcm-precache-manifest',
    closeBundle() {
      const distDir = path.resolve('dist');
      if (!fs.existsSync(distDir)) return;
      const assets = ['./'];
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir)) {
          const full = path.join(dir, entry);
          const stat = fs.statSync(full);
          if (stat.isDirectory()) walk(full);
          else {
            const rel = './' + path.relative(distDir, full).replace(/\\/g, '/');
            if (rel !== './sw.js' && rel !== './precache-manifest.json') assets.push(rel);
          }
        }
      };
      walk(distDir);
      fs.writeFileSync(
        path.join(distDir, 'precache-manifest.json'),
        JSON.stringify({ version: pkg.version, generatedAt: new Date().toISOString(), assets: assets.sort() }, null, 2)
      );
      const swPath = path.join(distDir, 'sw.js');
      if (fs.existsSync(swPath)) {
        const sw = fs.readFileSync(swPath, 'utf8').replace(/__APP_VERSION__/g, pkg.version);
        fs.writeFileSync(swPath, sw);
      }
    }
  };
}

/**
 * Official production build configuration for PlafondChèque Maroc Pro.
 * Used by GitHub Actions CI, PWA releases, and Capacitor (webDir: "dist").
 */
export default defineConfig({
  base: './',
  publicDir: 'public',
  plugins: [stripOfflineCssFallbackPlugin(), strictCspPlugin(), precacheManifestPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2020'
  }
});
