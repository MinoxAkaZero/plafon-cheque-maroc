/**
 * PlafondChèque Maroc Pro — Phase 3 Cloud E2EE Recovery Key & Unlock UI
 *
 * - Persists unlocked Cloud DEK inside the encrypted device vault (state.cloudSync.persistedCloudDekB64)
 *   so users are NOT prompted for their recovery key on every launch.
 * - Requires confirming the last 4 characters of the generated Recovery Key during initial setup.
 * - Respects "Later" deferral during background syncs (only explicit manual sync re-prompts).
 * - Exposes Settings actions: "Show recovery key" (PIN-gated) and "Reset cloud encryption".
 */
import { bytesToBase64, base64ToBytes } from '../security/crypto.mjs';
import { createCloudKeyBundle, unlockCloudKeyBundle, normalizeCloudSecret } from './cloudCrypto.mjs';

const E2EE_TEXT = {
  fr: {
    setupTitle: 'Clé de récupération du cloud chiffré',
    setupWarn:
      'Si vous perdez cette clé et tous vos appareils, vos données cloud ne pourront pas être récupérées. Vos détails de chèques et photos sont chiffrés sur votre appareil ; un serveur compromis peut encore voir les dates, tailles et rejouer ou masquer d’anciennes données.',
    copyBtn: 'Copier la clé',
    copiedToast: 'Clé de récupération copiée dans le presse-papiers.',
    shareBtn: 'Partager / Enregistrer',
    confirmLabel: 'Confirmez en saisissant les 4 derniers caractères de la clé :',
    confirmMismatch: 'Les 4 derniers caractères ne correspondent pas. Vérifiez votre clé.',
    advToggle: 'Avancé : utiliser ma propre phrase secrète',
    advPlaceholder: 'Phrase secrète personnalisée (min. 10 caractères)',
    confirmBtn: 'J’ai enregistré ma clé · Activer le chiffrement',
    unlockTitle: 'Déverrouiller votre sauvegarde cloud chiffrée',
    unlockDesc: 'Saisissez votre clé de récupération (ou phrase secrète) pour déchiffrer vos chèques sur cet appareil.',
    unlockPlaceholder: 'PCM-XXXX-XXXX-...',
    unlockBtn: 'Déverrouiller et synchroniser',
    cancelBtn: 'Plus tard'
  },
  en: {
    setupTitle: 'Encrypted Cloud Recovery Key',
    setupWarn:
      'If you lose this key and all your devices, your cloud data cannot be recovered. Your cheque details and photos are encrypted on your device. A compromised server could still see timing and size metadata and could withhold or replay old data.',
    copyBtn: 'Copy key',
    copiedToast: 'Recovery key copied to clipboard.',
    shareBtn: 'Share / Save',
    confirmLabel: 'Confirm by typing the last 4 characters of your key:',
    confirmMismatch: 'The last 4 characters do not match. Please double-check your key.',
    advToggle: 'Advanced: set my own passphrase',
    advPlaceholder: 'Custom passphrase (min. 10 characters)',
    confirmBtn: 'I saved my key · Enable encryption',
    unlockTitle: 'Unlock Encrypted Cloud Backup',
    unlockDesc: 'Enter your saved recovery key (or custom passphrase) to decrypt your cheques on this device.',
    unlockPlaceholder: 'PCM-XXXX-XXXX-...',
    unlockBtn: 'Unlock & Sync',
    cancelBtn: 'Later'
  },
  ar: {
    setupTitle: 'مفتاح استرداد النسخة السحابية المشفرة',
    setupWarn:
      'إذا فقدت هذا المفتاح وجميع أجهزتك، لا يمكن استعادة بياناتك السحابية. يتم تشفير تفاصيل الشيكات والصور على جهازك، بينما قد يرى خادم مخترق بيانات التوقيت والحجم أو يعيد تشغيل بيانات قديمة.',
    copyBtn: 'نسخ المفتاح',
    copiedToast: 'تم نسخ مفتاح الاسترداد.',
    shareBtn: 'مشاركة / حفظ',
    confirmLabel: 'أكّد بإدخال آخر 4 أحرف من المفتاح:',
    confirmMismatch: 'الأحرف الأربعة الأخيرة غير متطابقة. يرجى التحقق.',
    advToggle: 'متقدم: استخدام عبارة مرور مخصصة',
    advPlaceholder: 'عبارة مرور مخصصة (10 أحرف على الأقل)',
    confirmBtn: 'حفظت المفتاح · تفعيل التشفير',
    unlockTitle: 'فتح النسخة السحابية المشفرة',
    unlockDesc: 'أدخل مفتاح الاسترداد المحفوظ (أو عبارة المرور) لفك تشفير شيكاتك على هذا الجهاز.',
    unlockPlaceholder: 'PCM-XXXX-XXXX-...',
    unlockBtn: 'فتح ومزامنة',
    cancelBtn: 'لاحقاً'
  }
};

export function getCloudE2eeStrings(lang = 'fr') {
  return E2EE_TEXT[lang] || E2EE_TEXT.fr;
}

export function registerCloudE2eeUi(env) {
  let activeCloudDek = null;
  let deferredThisSession = false;

  function isCloudE2eeDeferredThisSession() {
    return deferredThisSession;
  }

  function clearCloudE2eeDeferral() {
    deferredThisSession = false;
  }

  function getActiveCloudDek() {
    if (activeCloudDek) return activeCloudDek;
    const b64 = env.state?.cloudSync?.persistedCloudDekB64;
    if (typeof b64 === 'string' && b64.length > 0) {
      try {
        const bytes = base64ToBytes(b64);
        if (bytes.length === 32) {
          activeCloudDek = bytes;
          return activeCloudDek;
        }
      } catch (e) {}
    }
    return null;
  }

  function persistCloudDekToVaultState(dekBytes, recoveryKey = null) {
    activeCloudDek = dekBytes || null;
    if (env.state?.cloudSync) {
      env.state.cloudSync.persistedCloudDekB64 = dekBytes ? bytesToBase64(dekBytes) : null;
      if (recoveryKey !== null) env.state.cloudSync.persistedRecoveryKey = recoveryKey;
    }
  }

  function clearActiveCloudDek({ clearPersisted = false } = {}) {
    activeCloudDek = null;
    if (clearPersisted && env.state?.cloudSync) {
      env.state.cloudSync.persistedCloudDekB64 = null;
      env.state.cloudSync.persistedRecoveryKey = null;
    }
  }

  async function promptSetupCloudRecoveryKey({ isManual = true } = {}) {
    if (!isManual && deferredThisSession) return null;
    const lang = env.state?.language || 'fr';
    const txt = getCloudE2eeStrings(lang);
    const initialBundle = await createCloudKeyBundle();

    const modal = typeof document !== 'undefined' ? document.getElementById('cloudE2eeModal') : null;
    if (!modal) {
      persistCloudDekToVaultState(initialBundle.cloudDek, initialBundle.recoveryKey);
      return initialBundle;
    }

    const titleEl = document.getElementById('cloudE2eeTitle');
    const warnEl = document.getElementById('cloudE2eeWarning');
    const setupBox = document.getElementById('cloudE2eeSetupBox');
    const unlockBox = document.getElementById('cloudE2eeUnlockBox');
    const keyDisplay = document.getElementById('cloudE2eeRecoveryKeyDisplay');
    const confirmLbl = document.getElementById('cloudE2eeConfirmLabel');
    const confirmInput = document.getElementById('inputCloudE2eeConfirmLast4');
    const advDetails = document.getElementById('cloudE2eeAdvancedBox');
    const advInput = document.getElementById('inputCloudE2eeCustomPassphrase');
    const errEl = document.getElementById('cloudE2eeErrorMsg');
    const btnCopy = document.getElementById('btnCloudE2eeCopy');
    const btnShare = document.getElementById('btnCloudE2eeShare');
    const btnConfirm = document.getElementById('btnCloudE2eeConfirmSetup');
    const btnCancel = document.getElementById('btnCloudE2eeCancel');

    if (titleEl) titleEl.textContent = txt.setupTitle;
    if (warnEl) warnEl.textContent = txt.setupWarn;
    if (keyDisplay) keyDisplay.textContent = initialBundle.recoveryKey;
    if (confirmLbl) confirmLbl.textContent = txt.confirmLabel;
    if (confirmInput) confirmInput.value = '';
    if (advInput) {
      advInput.value = '';
      advInput.placeholder = txt.advPlaceholder;
    }
    if (errEl) {
      errEl.textContent = '';
      errEl.classList.add('hidden');
    }
    if (btnCopy) btnCopy.textContent = txt.copyBtn;
    if (btnShare) btnShare.textContent = txt.shareBtn;
    if (btnConfirm) btnConfirm.textContent = txt.confirmBtn;
    if (btnCancel) btnCancel.textContent = txt.cancelBtn;
    if (advDetails) advDetails.open = false;

    setupBox?.classList.remove('hidden');
    unlockBox?.classList.add('hidden');
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    return new Promise((resolve) => {
      const cleanup = () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        btnCopy?.removeEventListener('click', onCopy);
        btnShare?.removeEventListener('click', onShare);
        btnConfirm?.removeEventListener('click', onConfirm);
        btnCancel?.removeEventListener('click', onCancel);
      };

      const onCopy = async () => {
        const val = (advInput?.value || '').trim() || initialBundle.recoveryKey;
        try {
          if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(val);
          env.showToast?.(txt.copiedToast);
        } catch (e) {}
      };

      const onShare = async () => {
        const val = (advInput?.value || '').trim() || initialBundle.recoveryKey;
        if (navigator.share) {
          try {
            await navigator.share({ title: txt.setupTitle, text: `${txt.setupWarn}\n${val}` });
          } catch (e) {}
        } else {
          await onCopy();
        }
      };

      const onConfirm = async () => {
        try {
          const customPw = (advInput?.value || '').trim();
          if (!customPw && confirmInput) {
            const expectedLast4 = normalizeCloudSecret(initialBundle.recoveryKey).slice(-4);
            const entered = String(confirmInput.value || '')
              .toUpperCase()
              .replace(/[^A-Z0-9]/g, '');
            if (entered !== expectedLast4) {
              if (errEl) {
                errEl.textContent = txt.confirmMismatch;
                errEl.classList.remove('hidden');
              }
              return;
            }
          }
          const finalBundle = customPw ? await createCloudKeyBundle({ customPassphrase: customPw }) : initialBundle;
          deferredThisSession = false;
          persistCloudDekToVaultState(finalBundle.cloudDek, finalBundle.recoveryKey);
          cleanup();
          resolve(finalBundle);
        } catch (e) {
          if (errEl) {
            errEl.textContent = e.message;
            errEl.classList.remove('hidden');
          }
        }
      };

      const onCancel = () => {
        deferredThisSession = true;
        cleanup();
        resolve(null);
      };

      btnCopy?.addEventListener('click', onCopy);
      btnShare?.addEventListener('click', onShare);
      btnConfirm?.addEventListener('click', onConfirm);
      btnCancel?.addEventListener('click', onCancel);
    });
  }

  async function promptUnlockCloudRecoveryKey(e2eeMeta, { isManual = true } = {}) {
    if (!isManual && deferredThisSession) return null;
    const lang = env.state?.language || 'fr';
    const txt = getCloudE2eeStrings(lang);
    const modal = typeof document !== 'undefined' ? document.getElementById('cloudE2eeModal') : null;
    if (!modal) return null;

    const titleEl = document.getElementById('cloudE2eeTitle');
    const warnEl = document.getElementById('cloudE2eeWarning');
    const setupBox = document.getElementById('cloudE2eeSetupBox');
    const unlockBox = document.getElementById('cloudE2eeUnlockBox');
    const unlockInput = document.getElementById('inputCloudE2eeUnlockKey');
    const errEl = document.getElementById('cloudE2eeErrorMsg');
    const btnUnlock = document.getElementById('btnCloudE2eeUnlockSubmit');
    const btnCancel = document.getElementById('btnCloudE2eeCancel');

    if (titleEl) titleEl.textContent = txt.unlockTitle;
    if (warnEl) warnEl.textContent = txt.unlockDesc;
    if (unlockInput) {
      unlockInput.value = '';
      unlockInput.placeholder = txt.unlockPlaceholder;
    }
    if (errEl) {
      errEl.textContent = '';
      errEl.classList.add('hidden');
    }
    if (btnUnlock) btnUnlock.textContent = txt.unlockBtn;
    if (btnCancel) btnCancel.textContent = txt.cancelBtn;

    setupBox?.classList.add('hidden');
    unlockBox?.classList.remove('hidden');
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    return new Promise((resolve) => {
      const cleanup = () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        btnUnlock?.removeEventListener('click', onUnlock);
        btnCancel?.removeEventListener('click', onCancel);
      };
      const onUnlock = async () => {
        try {
          const rawSecret = unlockInput?.value || '';
          const dek = await unlockCloudKeyBundle(e2eeMeta, rawSecret);
          deferredThisSession = false;
          persistCloudDekToVaultState(dek, rawSecret.trim());
          cleanup();
          resolve(dek);
        } catch (e) {
          if (errEl) {
            errEl.textContent = e.message;
            errEl.classList.remove('hidden');
          }
        }
      };
      const onCancel = () => {
        deferredThisSession = true;
        cleanup();
        resolve(null);
      };
      btnUnlock?.addEventListener('click', onUnlock);
      btnCancel?.addEventListener('click', onCancel);
    });
  }

  async function showCloudRecoveryKeyFromSettings() {
    const savedKey = env.state?.cloudSync?.persistedRecoveryKey;
    if (!savedKey) {
      env.showToast?.('Aucune clé de récupération cloud enregistrée sur cet appareil.');
      return null;
    }
    if (env.state?.pinHash && typeof window !== 'undefined' && typeof window.prompt === 'function') {
      const pin = window.prompt('Entrez votre code PIN local pour afficher la clé de récupération cloud :');
      if (!pin) return null;
      const ok = env.verifySecretAgainstStoredHash
        ? await env.verifySecretAgainstStoredHash(pin, env.state.pinHash, env.state.pinSalt)
        : false;
      if (!ok) {
        env.showToast?.('Code PIN incorrect.');
        return null;
      }
    }
    env.openModal?.('🔑 Clé de récupération cloud', `Conservez cette clé en lieu sûr :\n\n${savedKey}`, null);
    return savedKey;
  }

  if (typeof document !== 'undefined') {
    document.getElementById('btnSettingsShowCloudRecoveryKey')?.addEventListener('click', () => {
      showCloudRecoveryKeyFromSettings();
    });
    document.getElementById('btnSettingsResetCloudE2ee')?.addEventListener('click', async () => {
      if (env.resetCloudEncryptionFromLocal) {
        await env.resetCloudEncryptionFromLocal();
      }
    });
  }

  Object.assign(env, {
    getActiveCloudDek,
    persistCloudDekToVaultState,
    clearActiveCloudDek,
    isCloudE2eeDeferredThisSession,
    clearCloudE2eeDeferral,
    promptSetupCloudRecoveryKey,
    promptUnlockCloudRecoveryKey,
    showCloudRecoveryKeyFromSettings
  });
}
