/**
 * PlafondChèque Maroc Pro — Vite + Tailwind CSS Build Coverage Test
 *
 * Verifies:
 *  1. src/styles/app.css starts with @tailwind base / components / utilities directives.
 *  2. tailwind.config.mjs & postcss.config.mjs are configured to scan index.html and src/**\/*.{js,mjs}.
 *  3. Runs `vite build` and verifies that every Tailwind utility class referenced in index.html
 *     and src/**\/*.mjs is present in the compiled Vite CSS bundle (dist/assets/*.css).
 *     Fails loudly if Vite/Tailwind is missing (never silently skips).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

function walkFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

// 1. Verify @tailwind directives in src/styles/app.css
const appCss = fs.readFileSync(path.join(ROOT, 'src', 'styles', 'app.css'), 'utf8');
assert.ok(appCss.includes('@tailwind base;'), 'src/styles/app.css must include @tailwind base;');
assert.ok(appCss.includes('@tailwind components;'), 'src/styles/app.css must include @tailwind components;');
assert.ok(appCss.includes('@tailwind utilities;'), 'src/styles/app.css must include @tailwind utilities;');
console.log('✅ PASS: TW-01: src/styles/app.css declares @tailwind base, components, and utilities');

// 2. Verify Tailwind & PostCSS config files
const twCfg = fs.readFileSync(path.join(ROOT, 'tailwind.config.mjs'), 'utf8');
assert.ok(
  twCfg.includes('./index.html') && twCfg.includes('./src/**/*.{js,mjs}'),
  'tailwind.config.mjs must scan index.html and src/**/*.{js,mjs}'
);
const pcCfg = fs.readFileSync(path.join(ROOT, 'postcss.config.mjs'), 'utf8');
assert.ok(
  pcCfg.includes('tailwindcss') && pcCfg.includes('autoprefixer'),
  'postcss.config.mjs must enable tailwindcss and autoprefixer'
);
console.log('✅ PASS: TW-02: tailwind.config.mjs and postcss.config.mjs configured cleanly');

// 3. Extract Tailwind-like utility classes used in index.html and src/**/*.mjs
const TW_TOKEN_RE =
  /^(?:(?:sm|md|lg|xl|2xl|hover|focus|focus-visible|active|disabled|dark|group-hover|peer-checked|first|last):)*(?:bg-|text-|border-|rounded|shadow|p[xytrbl]?-|m[xytrbl]?-|space-[xy]-|gap-|grid|col-span-|row-span-|flex|inline-flex|items-|justify-|content-|self-|w-|h-|min-[wh]-|max-[wh]-|inset-|top-|right-|bottom-|left-|z-|opacity-|backdrop-|animate-|transition|duration-|ease-|scale-|translate-|rotate-|divide-|ring-|outline-|overflow-|truncate|whitespace-|break-|font-|leading-|tracking-|uppercase|lowercase|capitalize|underline|line-through|sr-only|hidden|block|inline|fixed|absolute|relative|sticky|cursor-|select-|pointer-events-|shrink-|grow|aspect-|object-|fill-|stroke-)/;

const filesToScan = [
  path.join(ROOT, 'index.html'),
  ...walkFiles(path.join(ROOT, 'src')).filter((f) => /\.(mjs|js)$/.test(f))
];

const usedClasses = new Set();
for (const file of filesToScan) {
  const content = fs.readFileSync(file, 'utf8');
  for (const m of content.matchAll(/class(?:Name)?\s*=\s*["'`]([^"'`]+)["'`]/g)) {
    const raw = m[1].replace(/\$\{[^}]+\}/g, ' ');
    for (const token of raw.split(/\s+/)) {
      const clean = token.trim();
      if (
        !clean ||
        clean.includes('${') ||
        clean.startsWith('btn-') ||
        clean.startsWith('nav-') ||
        clean.startsWith('tab-') ||
        clean.startsWith('onb-') ||
        clean.startsWith('settings-') ||
        clean.startsWith('cat-icon-') ||
        clean.startsWith('w-pct-') ||
        clean.startsWith('icon-') ||
        clean.startsWith('pr-10-5')
      )
        continue;
      if (TW_TOKEN_RE.test(clean)) usedClasses.add(clean);
    }
  }
}
console.log(`ℹ️  Extracted ${usedClasses.size} unique Tailwind-like utility classes from index.html and src/**/*.mjs`);

// 3b. Static guard against Tailwind v4-only classes not present in Tailwind 3.4
const TW_V4_FORBIDDEN = [
  'shadow-xs',
  'shadow-2xs',
  'backdrop-blur-xs',
  'ring-3',
  'focus:ring-3',
  'rounded-xs',
  'outline-hidden'
];
const forbiddenFound = TW_V4_FORBIDDEN.filter((c) => usedClasses.has(c));
assert.deepEqual(
  forbiddenFound,
  [],
  `Tailwind v4-only classes not valid in Tailwind 3.4: ${forbiddenFound.join(', ')}`
);

// 4. Build with Vite and verify every class exists in compiled CSS (fail loudly if Vite is missing)
const viteBin = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite');
if (!fs.existsSync(viteBin)) {
  assert.fail('TW-03 FAILED: Vite binary not installed (node_modules/.bin/vite missing). Run `npm ci` first.');
}

execFileSync(viteBin, ['build'], { cwd: ROOT, stdio: 'inherit' });
const assetsDir = path.join(DIST, 'assets');
assert.ok(fs.existsSync(assetsDir), 'Vite build did not produce dist/assets/');
const cssFiles = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.css'));
assert.ok(cssFiles.length >= 1, 'Vite build did not emit any compiled CSS file in dist/assets/');
const builtCss = cssFiles.map((f) => fs.readFileSync(path.join(assetsDir, f), 'utf8')).join('\n');

// Escape special CSS selector characters the same way Tailwind does
function cssEscapeClass(cls) {
  return cls.replace(/([:/.\[\]#%()!@])/g, '\\$1');
}

const missing = [];
for (const cls of usedClasses) {
  const escaped = '.' + cssEscapeClass(cls);
  if (!builtCss.includes(escaped)) {
    missing.push(cls);
  }
}

assert.deepEqual(
  missing,
  [],
  `Found ${missing.length} Tailwind classes missing from Vite-built CSS: ${missing.slice(0, 30).join(', ')}`
);
console.log(
  `✅ PASS: TW-03: All ${usedClasses.size}/${usedClasses.size} Tailwind classes verified in Vite-built CSS (${cssFiles.join(', ')})`
);
