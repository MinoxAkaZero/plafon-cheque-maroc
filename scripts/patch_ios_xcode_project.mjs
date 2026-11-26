#!/usr/bin/env node
/**
 * PlafondChèque Maroc Pro (v12.5.0) — iOS Xcode Project & Storyboard Patcher
 *
 * Ensures that after `npx cap add ios` / `npx cap sync ios`:
 *  1. `SecureVaultKeychainPlugin.swift` and `MainViewController.swift` are added to
 *     `ios/App/App.xcodeproj/project.pbxproj` (PBXFileReference, PBXBuildFile, App group,
 *     and App target PBXSourcesBuildPhase) so Xcode compiles them into the App binary.
 *  2. `ios/App/App/Base.lproj/Main.storyboard` instantiates `MainViewController`
 *     (customModule="App") so `capacitorDidLoad()` explicitly registers `SecureVaultKeystore`.
 *
 * Idempotent: safe to run repeatedly.
 */
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_IOS_DIR = path.resolve(process.cwd(), 'ios', 'App');

const SWIFT_ENTRIES = [
  {
    fileName: 'SecureVaultKeychainPlugin.swift',
    fileRefId: 'PCM12500F001000000000001',
    buildFileId: 'PCM12500B001000000000001'
  },
  {
    fileName: 'MainViewController.swift',
    fileRefId: 'PCM12500F002000000000002',
    buildFileId: 'PCM12500B002000000000002'
  }
];

export function patchPbxprojContent(content) {
  let out = content;
  for (const { fileName, fileRefId, buildFileId } of SWIFT_ENTRIES) {
    if (out.includes(fileName)) continue;

    // 1. Add PBXBuildFile entry
    const buildFileLine = `\t\t${buildFileId} /* ${fileName} in Sources */ = {isa = PBXBuildFile; fileRef = ${fileRefId} /* ${fileName} */; };\n`;
    if (!out.includes('/* Begin PBXBuildFile section */')) {
      throw new Error('Invalid project.pbxproj: missing PBXBuildFile section');
    }
    out = out.replace('/* Begin PBXBuildFile section */\n', `/* Begin PBXBuildFile section */\n${buildFileLine}`);

    // 2. Add PBXFileReference entry
    const fileRefLine = `\t\t${fileRefId} /* ${fileName} */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ${fileName}; sourceTree = "<group>"; };\n`;
    if (!out.includes('/* Begin PBXFileReference section */')) {
      throw new Error('Invalid project.pbxproj: missing PBXFileReference section');
    }
    out = out.replace('/* Begin PBXFileReference section */\n', `/* Begin PBXFileReference section */\n${fileRefLine}`);

    // 3. Add to App PBXGroup (alongside AppDelegate.swift)
    const appDelegateGroupRe = /(\s*[A-F0-9]+ \/\* AppDelegate\.swift \*\/,)/;
    if (!appDelegateGroupRe.test(out)) {
      throw new Error('Invalid project.pbxproj: could not locate AppDelegate.swift in App PBXGroup');
    }
    out = out.replace(appDelegateGroupRe, `$1\n\t\t\t\t${fileRefId} /* ${fileName} */,`);

    // 4. Add to App target PBXSourcesBuildPhase (alongside AppDelegate.swift in Sources)
    const appDelegateSourcesRe = /(\s*[A-F0-9]+ \/\* AppDelegate\.swift in Sources \*\/,)/;
    if (!appDelegateSourcesRe.test(out)) {
      throw new Error('Invalid project.pbxproj: could not locate AppDelegate.swift in PBXSourcesBuildPhase');
    }
    out = out.replace(appDelegateSourcesRe, `$1\n\t\t\t\t${buildFileId} /* ${fileName} in Sources */,`);
  }
  return out;
}

export function patchMainStoryboardContent(content) {
  if (content.includes('customClass="MainViewController"')) return content;
  const replaced = content.replace(
    /customClass="CAPBridgeViewController"\s+customModule="Capacitor"/g,
    'customClass="MainViewController" customModule="App"'
  );
  if (replaced === content) {
    throw new Error('Could not locate CAPBridgeViewController in Main.storyboard');
  }
  return replaced;
}

export function patchIosProject(iosAppDir = DEFAULT_IOS_DIR) {
  const pbxprojPath = path.join(iosAppDir, 'App.xcodeproj', 'project.pbxproj');
  const storyboardPath = path.join(iosAppDir, 'App', 'Base.lproj', 'Main.storyboard');

  if (!fs.existsSync(pbxprojPath)) {
    throw new Error(`Xcode project not found at ${pbxprojPath}. Run 'npx cap add ios' first.`);
  }

  for (const { fileName } of SWIFT_ENTRIES) {
    const swiftPath = path.join(iosAppDir, 'App', fileName);
    if (!fs.existsSync(swiftPath)) {
      throw new Error(`Required iOS Swift file missing: ${swiftPath}`);
    }
  }

  const origPbx = fs.readFileSync(pbxprojPath, 'utf8');
  const nextPbx = patchPbxprojContent(origPbx);
  if (nextPbx !== origPbx) {
    fs.writeFileSync(pbxprojPath, nextPbx, 'utf8');
  }

  if (fs.existsSync(storyboardPath)) {
    const origSb = fs.readFileSync(storyboardPath, 'utf8');
    const nextSb = patchMainStoryboardContent(origSb);
    if (nextSb !== origSb) {
      fs.writeFileSync(storyboardPath, nextSb, 'utf8');
    }
  }

  return {
    pbxprojPath,
    storyboardPath,
    registeredSwiftFiles: SWIFT_ENTRIES.map((e) => e.fileName)
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const targetDir = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_IOS_DIR;
  const res = patchIosProject(targetDir);
  console.log(`✅ Patched iOS Xcode project (${res.pbxprojPath}) with: ${res.registeredSwiftFiles.join(', ')}`);
}
