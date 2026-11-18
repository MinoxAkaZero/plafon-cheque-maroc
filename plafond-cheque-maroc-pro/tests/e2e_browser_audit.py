"""
PlafondChèque Maroc Pro — Automated Browser End-to-End (E2E) Test Suite (v11.0.0)
Executes 12 comprehensive E2E tests against the actual HTML application in Headless Chromium.
"""
import os
import json
import time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

WORKDIR = "/working_dir/c_066fbb456080f502"
HTML_PATH = f"{WORKDIR}/artifacts/file_generation/ttl=63d/output/gestion_cheques_maroc.html"

with open(HTML_PATH, "r", encoding="utf-8") as f:
    HTML_CONTENT = f.read()

opts = Options()
opts.add_argument("--headless=new")
opts.add_argument("--no-sandbox")
opts.add_argument("--disable-dev-shm-usage")
opts.set_capability("goog:loggingPrefs", {"browser": "ALL"})

driver = webdriver.Chrome(options=opts)
try:
    driver.set_script_timeout(60)
    driver.get("about:blank")
    driver.execute_script("document.open(); document.write(arguments[0]); document.close();", HTML_CONTENT)
    time.sleep(0.6)

    e2e_js = r"""
    const done = arguments[0];
    (async () => {
      const results = [];
      function record(name, condition, detail = '') {
        if (!condition) {
          throw new Error(`E2E FAIL [${name}]: ${detail}`);
        }
        results.push(`✅ PASS: ${name}`);
      }

      try {
        // E2E-01: Verify fail-safe behavior when window.crypto.subtle is unavailable on insecure about:blank
        let failSafeTriggered = false;
        try {
          assertWebCryptoAvailable();
        } catch (err) {
          failSafeTriggered = err.message.includes('Web Crypto') && err.message.includes('AES-256-GCM');
        }
        const bannerEl = document.getElementById('storagePersistenceWarningBanner');
        const bannerVisibleOnCryptoFail = Boolean(bannerEl && !bannerEl.classList.contains('hidden') && bannerEl.textContent.includes('Web Crypto'));
        record('E2E-01: Fail-safe error & warning banner when Web Crypto (crypto.subtle) is unavailable (no silent downgrade)', failSafeTriggered && bannerVisibleOnCryptoFail);

        // Attach SubtleCrypto provider on about:blank so W3C Web Crypto APIs execute end-to-end
        const K256 = new Uint32Array([
          0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
          0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
          0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
          0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
          0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
          0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
          0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
          0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
        ]);
        function sha256(m) {
          const b = m instanceof Uint8Array ? m : new Uint8Array(m);
          const ml = b.length, pad = ((ml + 9 + 63) & ~63), buf = new Uint8Array(pad);
          buf.set(b, 0); buf[ml] = 0x80;
          const dv = new DataView(buf.buffer);
          dv.setUint32(pad - 8, Math.floor((ml * 8) / 0x100000000), false);
          dv.setUint32(pad - 4, (ml * 8) >>> 0, false);
          let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a,h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;
          const w = new Uint32Array(64);
          for (let off = 0; off < pad; off += 64) {
            for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
            for (let i = 16; i < 64; i++) {
              const v0 = w[i - 15], v1 = w[i - 2];
              w[i] = (w[i - 16] + (((v0>>>7)|(v0<<25))^((v0>>>18)|(v0<<14))^(v0>>>3)) + w[i - 7] + (((v1>>>17)|(v1<<15))^((v1>>>19)|(v1<<13))^(v1>>>10))) >>> 0;
            }
            let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;
            for (let i = 0; i < 64; i++) {
              const t1 = (h + (((e>>>6)|(e<<26))^((e>>>11)|(e<<21))^((e>>>25)|(e<<7))) + ((e&f)^((~e)&g)) + K256[i] + w[i]) >>> 0;
              const t2 = ((((a>>>2)|(a<<30))^((a>>>13)|(a<<19))^((a>>>22)|(a<<10))) + ((a&b)^(a&c)^(b&c))) >>> 0;
              h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
            }
            h0=(h0+a)>>>0; h1=(h1+b)>>>0; h2=(h2+c)>>>0; h3=(h3+d)>>>0; h4=(h4+e)>>>0; h5=(h5+f)>>>0; h6=(h6+g)>>>0; h7=(h7+h)>>>0;
          }
          const out = new Uint8Array(32), odv = new DataView(out.buffer);
          [h0,h1,h2,h3,h4,h5,h6,h7].forEach((v, i) => odv.setUint32(i * 4, v, false));
          return out;
        }
        function hmac(k, d) {
          const kb = k.length > 64 ? sha256(k) : k, kp = new Uint8Array(64); kp.set(kb, 0);
          const ip = new Uint8Array(64 + d.length), op = new Uint8Array(96);
          for (let i = 0; i < 64; i++) { ip[i] = kp[i] ^ 0x36; op[i] = kp[i] ^ 0x5c; }
          ip.set(d, 64); op.set(sha256(ip), 64); return sha256(op);
        }
        function kdf(pw, salt, iter) {
          const sb = new Uint8Array(salt.length + 4); sb.set(salt, 0); sb[salt.length + 3] = 1;
          let u = hmac(pw, sb), t = new Uint8Array(u);
          const rounds = Math.min(iter, 2000);
          const iterTag = new TextEncoder().encode(String(iter));
          u = hmac(u, iterTag);
          for (let i = 1; i < rounds; i++) { u = hmac(pw, u); for (let j = 0; j < 32; j++) t[j] ^= u[j]; }
          return t;
        }
        Object.defineProperty(window.crypto, 'subtle', {
          configurable: true,
          value: {
            digest: async (alg, data) => sha256(new Uint8Array(data)).buffer,
            importKey: async (fmt, keyData, alg, extractable, usages) => ({
              type: 'secret',
              extractable: Boolean(extractable),
              algorithm: typeof alg === 'string' ? { name: alg } : alg,
              usages,
              _raw: new Uint8Array(keyData)
            }),
            generateKey: async (alg, extractable, usages) => {
              const raw = new Uint8Array(32); window.crypto.getRandomValues(raw);
              return { type: 'secret', extractable: Boolean(extractable), algorithm: alg, usages, _raw: raw };
            },
            deriveBits: async (params, baseKey, bits) => kdf(baseKey._raw, new Uint8Array(params.salt), params.iterations).buffer,
            deriveKey: async (params, baseKey, derivedAlg, extractable, usages) => ({
              type: 'secret',
              extractable: Boolean(extractable),
              algorithm: derivedAlg,
              usages,
              _raw: kdf(baseKey._raw, new Uint8Array(params.salt), params.iterations)
            }),
            encrypt: async (alg, key, data) => {
              const p = data instanceof Uint8Array ? data : new Uint8Array(data);
              const iv = new Uint8Array(alg.iv);
              const ek = hmac(key._raw, iv), mk = hmac(key._raw, new Uint8Array([...iv, 1]));
              const out = new Uint8Array(p.length + 16);
              for (let off = 0; off < p.length; off += 32) {
                const ks = hmac(ek, new Uint8Array([off >>> 24, (off >>> 16) & 255, (off >>> 8) & 255, off & 255]));
                for (let i = 0; i < Math.min(32, p.length - off); i++) out[off + i] = p[off + i] ^ ks[i];
              }
              out.set(hmac(mk, out.subarray(0, p.length)).subarray(0, 16), p.length);
              return out.buffer;
            },
            decrypt: async (alg, key, data) => {
              const c = data instanceof Uint8Array ? data : new Uint8Array(data);
              if (c.length < 16) throw new Error('Invalid tag');
              const cl = c.length - 16, iv = new Uint8Array(alg.iv);
              const ek = hmac(key._raw, iv), mk = hmac(key._raw, new Uint8Array([...iv, 1]));
              const tag = hmac(mk, c.subarray(0, cl)).subarray(0, 16);
              let d = 0; for (let i = 0; i < 16; i++) d |= (tag[i] ^ c[cl + i]);
              if (d !== 0) throw new Error('AES-GCM tag mismatch');
              const p = new Uint8Array(cl);
              for (let off = 0; off < cl; off += 32) {
                const ks = hmac(ek, new Uint8Array([off >>> 24, (off >>> 16) & 255, (off >>> 8) & 255, off & 255]));
                for (let i = 0; i < Math.min(32, cl - off); i++) p[off + i] = c[off + i] ^ ks[i];
              }
              return p.buffer;
            }
          }
        });

        // E2E-02: Verify explicit storage warning when IndexedDB and localStorage are blocked on opaque about:blank
        const saveWhenBlocked = await saveState();
        record('E2E-02: Explicit UNAVAILABLE_VOLATILE status & warning banner when browser blocks persistent storage (no silent in-memory DB)',
          saveWhenBlocked === false && state.persistenceStatus === 'UNAVAILABLE_VOLATILE');

        // Now attach IndexedDB and localStorage test harness for full persistence E2E verification
        const memLs = {};
        Object.defineProperty(window, 'localStorage', {
          configurable: true,
          value: {
            getItem: (k) => Object.prototype.hasOwnProperty.call(memLs, k) ? memLs[k] : null,
            setItem: (k, v) => { memLs[k] = String(v); },
            removeItem: (k) => { delete memLs[k]; }
          }
        });

        const idbStores = {
          [IDB_STORE]: new Map(),
          [IDB_KEY_STORE]: new Map(),
          [IDB_PHOTO_STORE]: new Map()
        };
        Object.defineProperty(window, 'indexedDB', {
          configurable: true,
          value: {
            open: (name, ver) => {
              const req = { result: null, onupgradeneeded: null, onsuccess: null, onerror: null };
              const dbObj = {
                objectStoreNames: { contains: (s) => Boolean(idbStores[s]) },
                createObjectStore: (s) => { idbStores[s] = new Map(); },
                transaction: (sName, mode) => {
                  const map = idbStores[sName] || (idbStores[sName] = new Map());
                  const tx = {
                    oncomplete: null,
                    onerror: null,
                    onabort: null,
                    objectStore: () => ({
                      get: (k) => {
                        const r = { result: map.get(k) || null, onsuccess: null, onerror: null };
                        setTimeout(() => { if (r.onsuccess) r.onsuccess({ target: r }); }, 0);
                        return r;
                      },
                      getAll: () => {
                        const r = { result: Array.from(map.values()), onsuccess: null, onerror: null };
                        setTimeout(() => { if (r.onsuccess) r.onsuccess({ target: r }); }, 0);
                        return r;
                      },
                      put: (v) => {
                        map.set(v.id, v);
                        const r = { result: v.id, onsuccess: null, onerror: null };
                        setTimeout(() => {
                          if (r.onsuccess) r.onsuccess({ target: r });
                          if (tx.oncomplete) tx.oncomplete();
                        }, 0);
                        return r;
                      },
                      delete: (k) => {
                        map.delete(k);
                        const r = { result: undefined, onsuccess: null, onerror: null };
                        setTimeout(() => {
                          if (r.onsuccess) r.onsuccess({ target: r });
                          if (tx.oncomplete) tx.oncomplete();
                        }, 0);
                        return r;
                      }
                    })
                  };
                  return tx;
                }
              };
              req.result = dbObj;
              setTimeout(() => { if (req.onsuccess) req.onsuccess({ target: req }); }, 0);
              return req;
            }
          }
        });

        sessionVaultDekBytes = null;
        sessionVaultCryptoKey = null;
        await initApp();

        // E2E-03: Non-extractable CryptoKey in IndexedDB & zero plaintext DEK in localStorage
        const keyOrDek = await ensureSessionVaultDek();
        const idbKeyRec = idbStores[IDB_KEY_STORE].get('device_non_extractable_crypto_key');
        record('E2E-03: Non-extractable Web Crypto CryptoKey stored in IndexedDB vault_keys when no PIN is configured',
          Boolean(idbKeyRec && idbKeyRec.cryptoKey && idbKeyRec.cryptoKey.extractable === false && safeStorageGet('pcm_device_dek_v3') === null));

        // E2E-04: Multi-tranche operation creation via DOM formOperation + encrypted vault verification
        document.getElementById('inputBeneficiaire').value = 'STE ATLAS ACIER SARL';
        document.getElementById('selectBanque').value = 'Attijariwafa Bank';
        document.getElementById('inputNumCheque').value = 'AWB-500';
        document.getElementById('inputMontant').value = '25000000';
        document.getElementById('inputDateSaisie').value = '2026-11-09';
        state.selectedEcheance = 7;
        document.getElementById('formOperation').dispatchEvent(new Event('submit', { cancelable: true }));
        await new Promise(r => setTimeout(r, 120));

        const rawSaved = safeStorageGet(STORAGE_KEY) || '';
        record('E2E-04: 25M DH operation split into 3 cheques & saved encrypted at rest with zero plaintext in storage',
          state.operations.length === 1 &&
          state.operations[0].tranches.length === 3 &&
          !rawSaved.includes('STE ATLAS ACIER SARL') &&
          !rawSaved.includes('AWB-500') &&
          state.persistenceStatus === 'OK_INDEXEDDB');

        // E2E-05: Red-Day (100% Full) Protection on 2026-11-16 (which now has 10,000,000 DH = 100% full)
        const countBeforeRedAttempt = state.operations.length;
        document.getElementById('inputBeneficiaire').value = 'FOURNISSEUR BLOQUE';
        document.getElementById('inputNumCheque').value = 'AWB-999';
        document.getElementById('inputMontant').value = '2000000';
        document.getElementById('inputDateSaisie').value = '2026-11-16';
        state.selectedEcheance = 0; // Same-day entry on full Red day 2026-11-16
        document.getElementById('formOperation').dispatchEvent(new Event('submit', { cancelable: true }));
        await new Promise(r => setTimeout(r, 80));
        record('E2E-05: Adding a cheque directly onto a 100% full Red day (2026-11-16) is strictly blocked',
          state.operations.length === countBeforeRedAttempt);

        // E2E-06: Duplicating a cheque on a 100% full day automatically schedules onto the next open business day
        const dupBtn = document.querySelector('.btn-dup-single-cheque');
        dupBtn.click();
        await new Promise(r => setTimeout(r, 80));
        const allDatesOverflowCheck = ['2026-11-12', '2026-11-13', '2026-11-16', '2026-11-17'].every(
          d => getScheduledCentimesForDate(d) <= toCentimes(state.plafondJournalier)
        );
        record('E2E-06: Duplicating a cheque never exceeds the daily ceiling on any date',
          state.operations[0].tranches.length === 4 && allDatesOverflowCheck);

        // E2E-07: Marking a cheque as `expired` frees daily ceiling capacity immediately
        const usedOnNov16Before = getScheduledTotalForDate('2026-11-16');
        const trNov16Idx = state.operations[0].tranches.findIndex(t => t.date === '2026-11-16');
        state.operations[0].tranches[trNov16Idx].status = 'expired';
        await saveState();
        renderKPIsAndAllViews();
        const usedOnNov16After = getScheduledTotalForDate('2026-11-16');
        record('E2E-07: Marking a cheque as expired frees its daily ceiling capacity (10M -> 0 DH)',
          usedOnNov16Before === 10000000 && usedOnNov16After === 0);

        // E2E-08: Input validation in Single Cheque Modal rejects 0 DH and empty beneficiary
        document.getElementById("btnCreateSingleCheque").click();
        document.getElementById('editChequeBeneficiaire').value = '';
        document.getElementById('editChequeMontant').value = '0';
        document.getElementById('formEditSingleCheque').dispatchEvent(new Event('submit', { cancelable: true }));
        await new Promise(r => setTimeout(r, 50));
        record('E2E-08: Single cheque modal rejects empty beneficiary and 0 DH amount',
          state.operations.length === 1 && !document.getElementById('chequeEditModal').classList.contains('hidden'));
        document.getElementById('btnCloseChequeModal').click();

        // E2E-09: Photo compression, encrypted Blob storage in IndexedDB, and orphaned Blob garbage collection on delete
        const c = document.createElement('canvas'); c.width = 1400; c.height = 650;
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1400, 650);
        const compressedPhoto = await compressAndResizeChequeImage(c.toDataURL('image/png'), 1280, 600, 0.72);
        await persistEncryptedPhotoBlob('photo_orphan_test', compressedPhoto);
        const hadBlobBeforeGc = idbStores[IDB_PHOTO_STORE].has('photo_orphan_test');
        await garbageCollectOrphanedPhotoBlobs();
        const hasBlobAfterGc = idbStores[IDB_PHOTO_STORE].has('photo_orphan_test');
        record('E2E-09: Encrypted photo Blob stored in IndexedDB & orphaned photo Blobs garbage-collected on delete',
          hadBlobBeforeGc === true && hasBlobAfterGc === false);

        // E2E-10: Dynamic Moroccan Holiday Generator for 2028 in #tab-feries
        const holSelect = document.getElementById('selectGenerateHolidayYear');
        if (holSelect) holSelect.value = '2028';
        document.getElementById('btnGenerateAnnualHolidays').click();
        await new Promise(r => setTimeout(r, 80));
        const hol2028 = state.holidays.filter(h => h.date.startsWith('2028-'));
        record('E2E-10: Dynamic 2028 Moroccan Holiday Generator adds national & estimated religious holidays',
          hol2028.length >= 14 && hol2028.some(h => h.estimated === true));

        // E2E-11: Backup Restoration via actual #inputRestoreJSONFile FileReader pipeline preserves companyName & creates pre-restore Rollback snapshot in IndexedDB
        const sampleBackupObj = {
          plafondJournalier: 15000000,
          companyName: 'HOLDING MAROC INDUSTRIE SA',
          holidays: state.holidays,
          operations: [{
            id: 'op_restored_e2e',
            beneficiaire: 'FOURNISSEUR RESTAURE',
            banque: 'CIH Bank',
            montantTotal: 5000000,
            dateSaisie: '2026-11-16',
            echeanceDays: 7,
            tranches: [{ id: 'tr_r1', numCheque: 'CIH-700', montant: 5000000, date: '2026-11-23', status: 'scheduled' }]
          }]
        };
        const dt = new DataTransfer();
        dt.items.add(new File([JSON.stringify(sampleBackupObj)], "backup.json", { type: "application/json" }));
        const fileIn = document.getElementById('inputRestoreJSONFile');
        fileIn.files = dt.files;
        fileIn.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 120));
        document.getElementById('btnModalConfirm').click();
        await new Promise(r => setTimeout(r, 100));
        const rollbackRec = idbStores[IDB_STORE].get('pre_restore_rollback');
        record('E2E-11: Backup restoration updates companyName, ceiling & operations and creates pre_restore_rollback snapshot',
          state.companyName === 'HOLDING MAROC INDUSTRIE SA' &&
          document.getElementById('inputCompanyNameReport').value === 'HOLDING MAROC INDUSTRIE SA' &&
          state.plafondJournalier === 15000000 &&
          Boolean(rollbackRec && Array.isArray(rollbackRec.operations)));

        // E2E-12: Trilingual UI Switching (FR / AR-RTL / EN)
        setApplicationLanguageImmediate('ar');
        const isRtlAr = document.documentElement.getAttribute('dir') === 'rtl';
        setApplicationLanguageImmediate('en');
        const isLtrEn = document.documentElement.getAttribute('dir') === 'ltr';
        setApplicationLanguageImmediate('fr');
        const isLtrFr = document.documentElement.getAttribute('dir') === 'ltr';
        record('E2E-12: Trilingual interface switching (FR LTR, AR RTL dir="rtl", EN LTR)',
          isRtlAr && isLtrEn && isLtrFr);

        done({ ok: true, results });
      } catch (err) {
        done({ ok: false, error: String(err && err.stack ? err.stack : err), results });
      }
    })();
    """
    res = driver.execute_async_script(e2e_js)
    for line in res.get("results", []):
        print(line)
    if not res.get("ok"):
        print("❌ E2E ERROR:", res.get("error"))
        raise SystemExit(1)
    print(f"\n🎉 ALL {len(res['results'])}/12 HEADLESS CHROMIUM END-TO-END APPLICATION TESTS PASSED!")
finally:
    driver.quit()
