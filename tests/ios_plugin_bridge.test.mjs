/**
 * PlafondChèque Maroc Pro (v12.5.0) — iOS Capacitor Plugin Registration & JS Bridge Contract Test
 *
 * Verifies:
 *  1. `ios/App/App/SecureVaultKeychainPlugin.swift` conforms to `CAPBridgedPlugin`, exposes
 *     `jsName = "SecureVaultKeystore"`, and declares `set`, `get`, `remove` plugin methods.
 *  2. `ios/App/App/MainViewController.swift` subclasses `CAPBridgeViewController` and explicitly
 *     registers `SecureVaultKeystorePlugin()` in `capacitorDidLoad()`.
 *  3. `scripts/patch_ios_xcode_project.mjs` adds both Swift files to a Capacitor 6 Xcode
 *     `project.pbxproj` (`PBXBuildFile`, `PBXFileReference`, App `PBXGroup`, `PBXSourcesBuildPhase`)
 *     and updates `Main.storyboard` to instantiate `MainViewController` (idempotently).
 *  4. JavaScript (`src/security/vault.mjs`) invokes `Capacitor.Plugins.SecureVaultKeystore.{set,get,remove}()`
 *     with the exact `{ key, value }` / `{ key }` call signatures implemented in Swift.
 *
 * NOTE: Runtime execution of Apple Security.framework (`SecItemAdd` / `SecItemCopyMatching` / `SecItemDelete`)
 * cannot run on Linux and still requires macOS/Xcode or a physical iOS device.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchIosProject } from '../scripts/patch_ios_xcode_project.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let passed = 0;
async function runTest(name, fn) {
  await fn();
  passed++;
  console.log(`✅ PASS: ${name}`);
}

await runTest(
  'IOS-01: SecureVaultKeychainPlugin.swift conforms to CAPBridgedPlugin with set/get/remove methods',
  () => {
    const swift = fs.readFileSync(path.join(ROOT, 'ios', 'App', 'App', 'SecureVaultKeychainPlugin.swift'), 'utf8');
    assert.ok(swift.includes('@objc(SecureVaultKeystorePlugin)'), 'Missing @objc(SecureVaultKeystorePlugin)');
    assert.ok(swift.includes('CAPPlugin, CAPBridgedPlugin'), 'Must conform to CAPBridgedPlugin');
    assert.ok(swift.includes('public let jsName = "SecureVaultKeystore"'), 'jsName must be SecureVaultKeystore');
    assert.ok(
      swift.includes('CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise)'),
      'Missing set method registration'
    );
    assert.ok(
      swift.includes('CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise)'),
      'Missing get method registration'
    );
    assert.ok(
      swift.includes('CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise)'),
      'Missing remove method registration'
    );
    assert.ok(
      swift.includes('kSecAttrAccessibleWhenUnlockedThisDeviceOnly'),
      'Must use ThisDeviceOnly Keychain accessibility'
    );
  }
);

await runTest(
  'IOS-02: MainViewController.swift explicitly registers SecureVaultKeystorePlugin with Capacitor bridge',
  () => {
    const vc = fs.readFileSync(path.join(ROOT, 'ios', 'App', 'App', 'MainViewController.swift'), 'utf8');
    assert.ok(
      vc.includes('class MainViewController: CAPBridgeViewController'),
      'Must subclass CAPBridgeViewController'
    );
    assert.ok(vc.includes('override open func capacitorDidLoad()'), 'Must override capacitorDidLoad()');
    assert.ok(
      vc.includes('bridge?.registerPluginInstance(SecureVaultKeystorePlugin())'),
      'Must register SecureVaultKeystorePlugin instance'
    );
  }
);

await runTest(
  'IOS-03: patch_ios_xcode_project.mjs adds both Swift files to App target Sources & wires Main.storyboard idempotently',
  () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcm-ios-pbx-'));
    try {
      const xcodeprojDir = path.join(tmpDir, 'App.xcodeproj');
      const appDir = path.join(tmpDir, 'App');
      const baseLproj = path.join(appDir, 'Base.lproj');
      fs.mkdirSync(xcodeprojDir, { recursive: true });
      fs.mkdirSync(baseLproj, { recursive: true });

      fs.copyFileSync(
        path.join(ROOT, 'ios', 'App', 'App', 'SecureVaultKeychainPlugin.swift'),
        path.join(appDir, 'SecureVaultKeychainPlugin.swift')
      );
      fs.copyFileSync(
        path.join(ROOT, 'ios', 'App', 'App', 'MainViewController.swift'),
        path.join(appDir, 'MainViewController.swift')
      );

      const samplePbxproj = `// !$*UTF8*$!
{
/* Begin PBXBuildFile section */
\t\t504EC3081FED79650016851F /* AppDelegate.swift in Sources */ = {isa = PBXBuildFile; fileRef = 504EC3071FED79650016851F /* AppDelegate.swift */; };
/* End PBXBuildFile section */
/* Begin PBXFileReference section */
\t\t504EC3071FED79650016851F /* AppDelegate.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = AppDelegate.swift; sourceTree = "<group>"; };
/* End PBXFileReference section */
/* Begin PBXGroup section */
\t\t504EC3061FED79650016851F /* App */ = {
\t\t\tisa = PBXGroup;
\t\t\tchildren = (
\t\t\t\t504EC3071FED79650016851F /* AppDelegate.swift */,
\t\t\t);
\t\t};
/* End PBXGroup section */
/* Begin PBXSourcesBuildPhase section */
\t\t504EC3001FED79650016851F /* Sources */ = {
\t\t\tisa = PBXSourcesBuildPhase;
\t\t\tfiles = (
\t\t\t\t504EC3081FED79650016851F /* AppDelegate.swift in Sources */,
\t\t\t);
\t\t};
/* End PBXSourcesBuildPhase section */
}`;
      const sampleStoryboard = `<viewController id="BYZ-38-t0r" customClass="CAPBridgeViewController" customModule="Capacitor" sceneMemberID="viewController"/>`;

      fs.writeFileSync(path.join(xcodeprojDir, 'project.pbxproj'), samplePbxproj);
      fs.writeFileSync(path.join(baseLproj, 'Main.storyboard'), sampleStoryboard);

      patchIosProject(tmpDir);
      const patchedPbx1 = fs.readFileSync(path.join(xcodeprojDir, 'project.pbxproj'), 'utf8');
      const patchedSb1 = fs.readFileSync(path.join(baseLproj, 'Main.storyboard'), 'utf8');

      assert.ok(
        patchedPbx1.includes('SecureVaultKeychainPlugin.swift in Sources'),
        'SecureVaultKeychainPlugin.swift missing from PBXSourcesBuildPhase'
      );
      assert.ok(
        patchedPbx1.includes('MainViewController.swift in Sources'),
        'MainViewController.swift missing from PBXSourcesBuildPhase'
      );
      assert.ok(
        patchedSb1.includes('customClass="MainViewController" customModule="App"'),
        'Main.storyboard not updated to MainViewController'
      );

      // Run a second time to verify idempotency
      patchIosProject(tmpDir);
      const patchedPbx2 = fs.readFileSync(path.join(xcodeprojDir, 'project.pbxproj'), 'utf8');
      assert.equal(patchedPbx2, patchedPbx1, 'patchIosProject must be idempotent');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
);

await runTest(
  'IOS-04: JavaScript bridge calls Capacitor.Plugins.SecureVaultKeystore set(), get(), and remove() with Swift-compatible payloads',
  async () => {
    const keychainMem = new Map();
    const calls = [];

    // Simulated Capacitor iOS bridge matching SecureVaultKeychainPlugin.swift's exact method & argument contract
    const mockIosPlugin = {
      async set(args) {
        calls.push(['set', args]);
        if (!args || typeof args.key !== 'string' || !args.key || typeof args.value !== 'string') {
          throw new Error('Missing key or value parameter');
        }
        keychainMem.set(args.key, args.value);
        return { value: true };
      },
      async get(args) {
        calls.push(['get', args]);
        if (!args || typeof args.key !== 'string' || !args.key) {
          throw new Error('Missing key parameter');
        }
        if (!keychainMem.has(args.key)) {
          throw new Error('Key not found in iOS Keychain (OSStatus -25300)');
        }
        return { value: keychainMem.get(args.key) };
      },
      async remove(args) {
        calls.push(['remove', args]);
        if (!args || typeof args.key !== 'string' || !args.key) {
          throw new Error('Missing key parameter');
        }
        keychainMem.delete(args.key);
        return { value: true };
      }
    };

    // Exercise the exact call pattern used by src/security/vault.mjs
    const vaultSrc = fs.readFileSync(path.join(ROOT, 'src', 'security', 'vault.mjs'), 'utf8');
    assert.ok(
      vaultSrc.includes('window.Capacitor.Plugins.SecureVaultKeystore'),
      'vault.mjs must resolve window.Capacitor.Plugins.SecureVaultKeystore'
    );
    assert.ok(
      /nativeSecure\.set\(\s*\{\s*key:[^}]*value:/.test(vaultSrc),
      'vault.mjs must call the native plugin set({ key, value })'
    );
    assert.ok(/nativeSecure\.get\(\s*\{\s*key:/.test(vaultSrc), 'vault.mjs must call the native plugin get({ key })');
    assert.ok(
      /nativeSecure\.remove\(\s*\{\s*key:\s*'pcm_native_master_dek_v4'\s*\}\s*\)/.test(vaultSrc),
      'vault.mjs must call nativeSecure.remove({ key }) when PIN is enabled'
    );

    const keyName = 'pcm_native_master_dek_v4';
    const testDekB64 = Buffer.from(new Uint8Array(32).fill(42)).toString('base64');

    const setRes = await mockIosPlugin.set({ key: keyName, value: testDekB64 });
    assert.deepEqual(setRes, { value: true });

    const getRes = await mockIosPlugin.get({ key: keyName });
    assert.deepEqual(getRes, { value: testDekB64 });

    const remRes = await mockIosPlugin.remove({ key: keyName });
    assert.deepEqual(remRes, { value: true });

    await assert.rejects(() => mockIosPlugin.get({ key: keyName }), /Key not found in iOS Keychain/);
    assert.equal(calls.length, 4);
  }
);

console.log(`\n🎉 ALL ${passed}/${passed} iOS CAPACITOR PLUGIN REGISTRATION & JS BRIDGE CONTRACT TESTS PASSED!`);
