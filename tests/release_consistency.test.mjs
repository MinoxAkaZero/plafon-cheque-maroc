// Release plumbing guard: lockfile, single version everywhere, honest privacy docs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`✅ PASS: ${name}`);
  } catch (e) {
    console.error(`❌ FAIL: ${name}\n   ${e.message}`);
    process.exit(1);
  }
};

const pkg = JSON.parse(read('package.json'));
const V = pkg.version;

test('REL-01: package-lock.json exists and matches package.json name/version', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'package-lock.json')), 'package-lock.json is required for npm ci');
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.version, V);
  assert.ok(lock.packages && lock.packages[''], 'lockfile must contain the root package entry');
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
    assert.ok(lock.packages[`node_modules/${dep}`], `lockfile missing dependency ${dep}`);
  }
});

test('REL-02: one release version everywhere (package, manifest, APP_VERSION, iOS, workflows)', () => {
  assert.equal(JSON.parse(read('public/manifest.json')).version, V, 'public/manifest.json');
  const m = read('src/engine/calendar.mjs').match(/export const APP_VERSION = '([^']+)'/);
  assert.equal(m && m[1], V, 'APP_VERSION in calendar.mjs');
  const plist = read('ios/App/App/Info.plist');
  assert.match(plist, new RegExp(`CFBundleShortVersionString</key>\\s*<string>${V.replace(/\./g, '\\.')}</string>`));
  const [maj, min] = V.split('.');
  const build = `${maj}${min}`; // 12.5.0 -> 125
  assert.match(plist, new RegExp(`CFBundleVersion</key>\\s*<string>${build}</string>`));
  for (const wf of fs.readdirSync(path.join(ROOT, '.github/workflows'))) {
    const t = read(`.github/workflows/${wf}`);
    for (const stale of t.match(/\bv1[0-9]\.[0-9]+\.[0-9]+\b/g) || []) {
      assert.equal(stale, `v${V}`, `${wf} mentions stale version ${stale}`);
    }
  }
});

test('REL-03: every workflow installs with npm ci (never unpinned npm install)', () => {
  for (const wf of fs.readdirSync(path.join(ROOT, '.github/workflows'))) {
    const t = read(`.github/workflows/${wf}`);
    assert.ok(!/^\s*npm install\s*$/m.test(t), `${wf} must use npm ci`);
  }
});

test('REL-04: store privacy doc does not claim "no data collected" / "100% offline"', () => {
  const doc = read('docs/STORE_PRIVACY_AND_DEPLOYMENT_VERIFICATION.md');
  assert.ok(!/No data collected/i.test(doc), 'outdated "No data collected" claim');
  assert.ok(!/100% offline/i.test(doc), 'outdated "100% offline" claim');
  assert.match(doc, /Email address/i);
  const priv = read('ios/App/App/PrivacyInfo.xcprivacy');
  assert.match(priv, /EmailAddress/);
  assert.match(priv, /UserID/);
});

test('REL-05: dist/ and node_modules/ are git-ignored', () => {
  const gi = read('.gitignore');
  assert.match(gi, /^dist\/$/m);
  assert.match(gi, /^node_modules\/$/m);
});

console.log(`\n🎉 ALL ${passed}/${passed} RELEASE CONSISTENCY TESTS PASSED!`);
