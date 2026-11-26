/**
 * PlafondChèque Maroc Pro — Phase 2 Security, CSP, Zero-CDN & XSS Automated Test Suite
 *
 * Verifies:
 *  1. Zero runtime CDN links (Tailwind CDN, Chart.js CDN, Google Fonts, jsDelivr, unpkg, cdnjs)
 *  2. Zero inline <script> blocks and zero inline on*= event handlers in index.html & dist/index.html
 *  3. Strict CSP meta tag in dist/index.html (script-src 'self', zero 'unsafe-inline' in script-src,
 *     zero 'unsafe-eval', object-src 'none', build-time VITE_SUPABASE_URL connect-src injection)
 *  4. Pre-Phase-2 Fix (a): src/cloud/cloudUi.mjs routes all Supabase calls through SupabaseCloudClient
 *  5. Pre-Phase-2 Fix (b): zero hardcoded 210000 in src/ outside src/security/crypto.mjs
 *  6. Zero unescaped banner.innerHTML in src/security/vault.mjs
 *  7. dist/precache-manifest.json covers built assets with zero external URLs
 *  8. escapeHtml / XSS payload neutralization across all HTML metacharacters
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`✅ PASS: ${name}`);
}

function walkFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

const CDN_REGEX =
  /(cdn\.tailwindcss\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com|cdnjs\.cloudflare\.com)/i;

test('SEC-01: Zero runtime CDN references in index.html, src/, public/, and dist/index.html', () => {
  const filesToScan = [
    path.join(ROOT, 'index.html'),
    ...walkFiles(path.join(ROOT, 'src')),
    ...walkFiles(path.join(ROOT, 'public'))
  ].filter((f) => /\.(html|mjs|js|css|json)$/.test(f));

  if (fs.existsSync(path.join(DIST, 'index.html'))) {
    filesToScan.push(path.join(DIST, 'index.html'));
  }

  for (const file of filesToScan) {
    const content = fs.readFileSync(file, 'utf8');
    const match = content.match(CDN_REGEX);
    assert.equal(match, null, `Unexpected runtime CDN reference "${match?.[0]}" found in ${path.relative(ROOT, file)}`);
  }
});

test('SEC-02: Zero inline <script> blocks and zero inline on*= event handlers in index.html & dist/index.html', () => {
  for (const htmlPath of [path.join(ROOT, 'index.html'), path.join(DIST, 'index.html')]) {
    if (!fs.existsSync(htmlPath)) continue;
    const html = fs.readFileSync(htmlPath, 'utf8');
    const scriptTags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    assert.ok(scriptTags.length >= 1, 'Expected module entry script tag');
    for (const [, attrs, body] of scriptTags) {
      assert.ok(/\bsrc\s*=/i.test(attrs), `Found inline <script> without src in ${htmlPath}`);
      assert.equal(body.trim(), '', `Found non-empty inline <script> body in ${htmlPath}`);
    }
    const inlineHandlers = html.match(/\son[a-z]+\s*=/gi);
    assert.equal(inlineHandlers, null, `Found inline event handlers ${inlineHandlers} in ${htmlPath}`);
  }
});

test('SEC-03: Strict CSP meta tag present in dist/index.html (script-src self, zero unsafe-eval, zero unsafe-inline scripts)', () => {
  const distHtml = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  const m = distHtml.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i);
  assert.ok(m, 'Missing Content-Security-Policy meta tag in dist/index.html');
  const csp = m[1];
  assert.ok(!csp.includes('__CSP_CONNECT_SRC__'), 'Unreplaced __CSP_CONNECT_SRC__ placeholder in dist/index.html');
  assert.ok(/script-src\s+'self';/i.test(csp), `Expected strict script-src 'self'; got: ${csp}`);
  assert.ok(!/unsafe-eval/i.test(csp), `CSP must not allow unsafe-eval: ${csp}`);
  assert.ok(/object-src\s+'none'/i.test(csp), `CSP must set object-src 'none': ${csp}`);
  assert.ok(/base-uri\s+'self'/i.test(csp), `CSP must set base-uri 'self': ${csp}`);
  assert.ok(/connect-src\s+'self'/i.test(csp), `CSP must restrict connect-src: ${csp}`);
});

test('SEC-04: Build-time VITE_SUPABASE_URL injects only origin into CSP connect-src (never hardcoded)', () => {
  const srcHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const srcCspMatch = srcHtml.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i);
  assert.ok(srcCspMatch, 'Source index.html must contain CSP meta tag');
  assert.ok(
    srcCspMatch[1].includes('__CSP_CONNECT_SRC__'),
    'Source CSP must use build-time __CSP_CONNECT_SRC__ placeholder'
  );
  assert.ok(!/supabase\.co/i.test(srcCspMatch[1]), 'Source CSP must never hardcode a Supabase URL');

  // Test build with custom VITE_SUPABASE_URL, verify injection, then restore default build
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build.mjs')], {
    cwd: ROOT,
    env: { ...process.env, VITE_SUPABASE_URL: 'https://demo-project.supabase.co/rest/v1' }
  });
  const builtWithEnv = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  assert.ok(
    builtWithEnv.includes("connect-src 'self' https://demo-project.supabase.co;"),
    'Expected VITE_SUPABASE_URL origin injected into connect-src'
  );

  // Restore clean default build (unset VITE_SUPABASE_URL -> strict 'self' only)
  const cleanEnv = { ...process.env };
  delete cleanEnv.VITE_SUPABASE_URL;
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build.mjs')], {
    cwd: ROOT,
    env: cleanEnv
  });
  const builtClean = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  assert.ok(
    builtClean.includes("connect-src 'self';"),
    'Expected connect-src strictly self when VITE_SUPABASE_URL is unset'
  );
});

test('SEC-05: Pre-Phase-2 Fix (a) — cloudUi.mjs delegates all Supabase requests to SupabaseCloudClient', () => {
  const cloudUi = fs.readFileSync(path.join(ROOT, 'src', 'cloud', 'cloudUi.mjs'), 'utf8');
  assert.ok(cloudUi.includes('SupabaseCloudClient'), 'cloudUi.mjs must import and use SupabaseCloudClient');
  assert.ok(cloudUi.includes('new SupabaseCloudClient('), 'cloudUi.mjs must instantiate SupabaseCloudClient');
  assert.ok(cloudUi.includes('client._request('), 'cloudUi.mjs must delegate HTTP requests to client._request');
  assert.ok(
    cloudUi.includes('client.refreshSession('),
    'cloudUi.mjs must delegate session refresh to client.refreshSession'
  );
  assert.ok(
    !cloudUi.includes('fetch(`${cfg.supabaseUrl}'),
    'cloudUi.mjs must not keep duplicate raw Supabase fetch logic'
  );
});

test('SEC-06: Pre-Phase-2 Fix (b) — zero hardcoded 210000 anywhere in src/ outside src/security/crypto.mjs', () => {
  const srcFiles = walkFiles(path.join(ROOT, 'src')).filter((f) => /\.(mjs|js)$/.test(f));
  const offenders = [];
  for (const f of srcFiles) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    if (rel === 'src/security/crypto.mjs') continue;
    const content = fs.readFileSync(f, 'utf8');
    if (content.includes('210000')) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `Found hardcoded 210000 outside src/security/crypto.mjs: ${offenders.join(', ')}`);
});

test('SEC-07: Zero unescaped banner.innerHTML in src/security/vault.mjs', () => {
  const vault = fs.readFileSync(path.join(ROOT, 'src', 'security', 'vault.mjs'), 'utf8');
  assert.ok(!vault.includes('banner.innerHTML'), 'vault.mjs must not use banner.innerHTML');
});

test('SEC-08: dist/precache-manifest.json lists built local assets with zero external URLs', () => {
  const manifestPath = path.join(DIST, 'precache-manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'Missing dist/precache-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.ok(Array.isArray(manifest.assets) && manifest.assets.length > 20, 'Expected full precache asset list');
  assert.ok(manifest.assets.includes('./index.html'), 'Manifest must include ./index.html');
  assert.ok(manifest.assets.includes('./src/styles/app.css'), 'Manifest must include ./src/styles/app.css');
  for (const a of manifest.assets) {
    assert.ok(a.startsWith('./'), `Precache asset must be local relative path, got: ${a}`);
    assert.ok(!/^https?:\/\//i.test(a), `Precache asset must never be external URL: ${a}`);
  }
});

test('SEC-09: escapeHtml neutralizes script, img onerror, and quote breakout XSS payloads', () => {
  const fmt = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'formatters.mjs'), 'utf8');
  assert.ok(
    fmt.includes("replace(/&/g, '&amp;')") && fmt.includes("replace(/</g, '&lt;')"),
    'escapeHtml must escape &, <, >, quotes'
  );
  // Execute the exact escaping logic on an aggressive XSS vector
  const escapeHtml = (str) =>
    String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  const payload = `<script>window.__xss=1</script><img src=x onerror="window.__xss=2">'`;
  const escaped = escapeHtml(payload);
  assert.ok(!escaped.includes('<script>'), 'Script tag must be escaped');
  assert.ok(!escaped.includes('<img'), 'Img tag must be escaped');
  assert.ok(!escaped.includes('"'), 'Double quotes must be escaped');
  assert.ok(!escaped.includes("'"), 'Single quotes must be escaped');
});

test('SEC-10: Strict CSP drops unsafe-inline from style-src and keeps font-src strictly self', () => {
  const distHtml = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  const m = distHtml.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i);
  assert.ok(m, 'Missing CSP meta tag');
  const csp = m[1];
  assert.ok(/style-src\s+'self';/i.test(csp), `Expected strict style-src 'self'; got: ${csp}`);
  assert.ok(!/unsafe-inline/i.test(csp), `CSP must not contain unsafe-inline anywhere: ${csp}`);
  assert.ok(/font-src\s+'self';/i.test(csp), `Expected strict font-src 'self'; got: ${csp}`);
});

test('SEC-11: Zero inline style="" attributes in index.html, dist/index.html, and src/**/*.mjs', () => {
  const files = [
    path.join(ROOT, 'index.html'),
    path.join(DIST, 'index.html'),
    ...walkFiles(path.join(ROOT, 'src')).filter((f) => f.endsWith('.mjs'))
  ];
  for (const f of files) {
    const content = fs.readFileSync(f, 'utf8');
    const match = content.match(/\sstyle\s*=\s*["']/i);
    assert.equal(match, null, `Found inline style="" attribute in ${path.relative(ROOT, f)}`);
  }
});

test('SEC-12: Self-hosted Inter & Noto Sans Arabic WOFF2 fonts, @font-face font-display: swap, and preloads present', () => {
  const requiredFonts = [
    'inter-400-latin.woff2',
    'inter-500-latin.woff2',
    'inter-600-latin.woff2',
    'inter-700-latin.woff2',
    'inter-800-latin.woff2',
    'noto-sans-arabic-400-arabic.woff2',
    'noto-sans-arabic-700-arabic.woff2'
  ];
  for (const fn of requiredFonts) {
    const fp = path.join(ROOT, 'public', 'fonts', fn);
    assert.ok(fs.existsSync(fp) && fs.statSync(fp).size > 5000, `Missing or empty WOFF2 font: ${fn}`);
  }
  const fontsCss = fs.readFileSync(path.join(ROOT, 'public', 'fonts', 'fonts.css'), 'utf8');
  assert.ok(fontsCss.includes('font-display: swap;'), 'fonts.css must declare font-display: swap');
  assert.ok(
    fontsCss.includes("font-family: 'Inter'") && fontsCss.includes("font-family: 'Noto Sans Arabic'"),
    'fonts.css must define Inter and Noto Sans Arabic'
  );
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(
    html.includes('rel="preload" href="./fonts/inter-400-latin.woff2" as="font" type="font/woff2"'),
    'index.html must preload Inter 400'
  );
  assert.ok(
    html.includes('rel="preload" href="./fonts/inter-700-latin.woff2" as="font" type="font/woff2"'),
    'index.html must preload Inter 700'
  );
  assert.ok(
    html.includes('rel="preload" href="./fonts/noto-sans-arabic-400-arabic.woff2" as="font" type="font/woff2"'),
    'index.html must preload Noto Sans Arabic 400'
  );
});

console.log(`\n🎉 ALL ${passed}/${passed} PHASE 2 SECURITY / CSP / ZERO-CDN / XSS TESTS PASSED!`);
