/**
 * Dev-only offline sandbox fallback builder (`npm run build:offline`).
 *
 * IMPORTANT: Vite (`npm run build`) is the ONLY official build used by CI,
 * releases, and Capacitor. This script exists solely so offline environments
 * without `node_modules` can assemble `dist/` and run the identical test suite.
 * If behavior ever differs, Vite wins.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

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

function copyRecursive(src, dst) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dst, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

// 1. Copy single entry HTML shell and inject build-time CSP connect-src (matching Vite plugin)
const rawHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const builtHtml = rawHtml.replace(/__CSP_CONNECT_SRC__/g, resolveCspConnectSrc());
fs.writeFileSync(path.join(DIST, 'index.html'), builtHtml);

// 2. Copy single static public assets (manifest.json, sw.js, cloud-config.js, icons)
const publicDir = path.join(ROOT, 'public');
if (fs.existsSync(publicDir)) {
  for (const entry of fs.readdirSync(publicDir)) {
    copyRecursive(path.join(publicDir, entry), path.join(DIST, entry));
  }
}

// 3. Copy modular ES source tree so native browser ESM imports resolve cleanly in dist/
copyRecursive(path.join(ROOT, 'src'), path.join(DIST, 'src'));

// 4. Generate dist/precache-manifest.json and stamp package.json version into dist/sw.js (matching Vite plugin)
const assets = ['./'];
function collectAssets(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) collectAssets(full);
    else {
      const rel = './' + path.relative(DIST, full).replace(/\\/g, '/');
      if (rel !== './sw.js' && rel !== './precache-manifest.json') assets.push(rel);
    }
  }
}
collectAssets(DIST);
fs.writeFileSync(
  path.join(DIST, 'precache-manifest.json'),
  JSON.stringify({ version: pkg.version, generatedAt: new Date().toISOString(), assets: assets.sort() }, null, 2)
);
const swPath = path.join(DIST, 'sw.js');
if (fs.existsSync(swPath)) {
  fs.writeFileSync(swPath, fs.readFileSync(swPath, 'utf8').replace(/__APP_VERSION__/g, pkg.version));
}

console.warn(
  '[WARN] scripts/build.mjs is a dev-only offline sandbox fallback: it does NOT run PostCSS/Tailwind CSS compilation. Use `npm run build` (Vite) for production CSS.'
);
console.log(`Built dist/ v${pkg.version} (${assets.length} precached assets, dev-only offline fallback) -> ${DIST}`);
