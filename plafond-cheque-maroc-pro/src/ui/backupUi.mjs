/** PlafondChèque Maroc Pro — Backup Download, JSON/Encrypted Restore & Demo Loader */
import { DEFAULT_MOROCCAN_HOLIDAYS, generateMoroccanHolidaysForYear, isValidYMD } from '../engine/calendar.mjs';

export function registerBackupUi(env) {
  const {
    state,
    getTodayYMD,
    showToast,
    saveState,
    compressAndResizeChequeImage,
    rotateDataURL90,
    cropDataURLToChequeRatio,
    setDraftPhotoPreview,
    saveDraftForm,
    simulateDistribution,
    renderKPIsAndAllViews,
    goHomeScreen,
    switchTab,
    openModal,
    syncAndScheduleSystemNotifications,
    encryptBackupPayloadAESGCM,
    decryptBackupPayloadAESGCM,
    computeSHA256ChecksumBrowser,
    validateEncryptionEnvelopeBrowser,
    constantTimeEqualStrings
  } = new Proxy(
    {},
    {
      get: (_, k) =>
        [
          'state',
          'PBKDF2_ITERATIONS',
          'STORAGE_KEY',
          'IDB_STORE',
          'IDB_KEY_STORE',
          'IDB_PHOTO_STORE',
          'ONBOARDING_STORAGE_KEY',
          'CLOUD_CONFIG_STORAGE_KEY',
          'CLOUD_SESSION_STORAGE_KEY'
        ].includes(k)
          ? env[k]
          : (...a) => env[k](...a)
    }
  );
  function bindBackupAndDemoEvents() {
    document.getElementById('btnLoadDemo')?.addEventListener('click', async () => {
      state.operations = [];
      const demoSpecs = [
        {
          beneficiaire: 'Sté Atlas Ciment & Acier SARL',
          banque: 'Attijariwafa Bank',
          num: 'AWB-88401',
          montant: 15000000,
          dateSaisie: getTodayYMD(),
          echeance: 7,
          notes: 'Facture Acier #FA-901'
        },
        {
          beneficiaire: 'Groupe Maghreb Distribution',
          banque: 'Banque Populaire',
          num: 'BCP-31090',
          montant: 12500000,
          dateSaisie: getTodayYMD(),
          echeance: 15,
          notes: 'Lot Matériaux Nord'
        },
        {
          beneficiaire: 'Comptoir National Bois & Fer',
          banque: 'Bank of Africa (BMCE)',
          num: 'BOA-55210',
          montant: 8000000,
          dateSaisie: getTodayYMD(),
          echeance: 35,
          notes: 'Approvisionnement Q4'
        }
      ];

      for (const item of demoSpecs) {
        const sim = simulateDistribution(item.montant, item.dateSaisie, item.echeance, 'backward', item.num);
        state.operations.push({
          id: 'op_demo_' + Math.random().toString(36).slice(2, 7),
          beneficiaire: item.beneficiaire,
          banque: item.banque,
          numChequeBase: item.num,
          montantTotal: item.montant,
          dateSaisie: item.dateSaisie,
          echeanceDays: item.echeance,
          dateLimiteBrute: sim.dateLimiteBrute,
          dateOuvrableCible: sim.dateOuvrableCible,
          mode: 'backward',
          notes: item.notes,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          tranches: sim.tranches
        });
      }
      await saveState();
      renderKPIsAndAllViews();
      syncAndScheduleSystemNotifications(false);
      showToast('Exemple Démo chargé (3 opérations = 35,5 Millions DH répartis sans dépasser 10M/jour)');
    });

    document.getElementById('btnAddHolidaySingle').addEventListener('click', async () => {
      const dStr = document.getElementById('inputNewHolidayDate').value;
      const type = document.getElementById('selectNewHolidayType')?.value || 'custom';
      const label = (document.getElementById('inputNewHolidayLabel').value || '').trim() || 'Jour férié personnalisé';
      if (!dStr || !isValidYMD(dStr)) {
        showToast('Veuillez choisir une date valide');
        return;
      }
      const existingIdx = state.holidays.findIndex((h) => h.date === dStr);
      const newEntry = {
        date: dStr,
        label,
        type,
        estimated: type === 'religious'
      };
      if (existingIdx !== -1) {
        state.holidays[existingIdx] = newEntry;
      } else {
        state.holidays.push(newEntry);
      }
      await saveState();
      renderKPIsAndAllViews();
      syncAndScheduleSystemNotifications(false);
      showToast(`Jour férié enregistré : ${dStr} (${label})`);
    });

    document.getElementById('btnSyncTextareaHolidays').addEventListener('click', async () => {
      const raw = document.getElementById('textareaHolidaysRaw').value || '';
      const dates = raw
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter((s) => isValidYMD(s));
      const existingMap = {};
      state.holidays.forEach((h) => {
        existingMap[h.date] = h;
      });
      DEFAULT_MOROCCAN_HOLIDAYS.forEach((h) => {
        if (!existingMap[h.date]) existingMap[h.date] = h;
      });

      state.holidays = Array.from(new Set(dates)).map((d) => ({
        date: d,
        label: existingMap[d]?.label || 'Jour férié configuré',
        type: existingMap[d]?.type || 'custom',
        estimated: Boolean(existingMap[d]?.estimated)
      }));
      await saveState();
      renderKPIsAndAllViews();
      syncAndScheduleSystemNotifications(false);
      showToast(`${state.holidays.length} jour(s) férié(s) synchronisé(s)`);
    });

    document.getElementById('btnGenerateAnnualHolidays')?.addEventListener('click', async () => {
      const y = parseInt(document.getElementById('selectGenerateHolidayYear')?.value || '2028', 10);
      const generated = generateMoroccanHolidaysForYear(y);
      const existingDates = new Set(state.holidays.map((h) => h.date));
      let added = 0;
      for (const item of generated) {
        if (!existingDates.has(item.date)) {
          state.holidays.push(item);
          added++;
        }
      }
      state.holidays.sort((a, b) => a.date.localeCompare(b.date));
      await saveState();
      renderKPIsAndAllViews();
      syncAndScheduleSystemNotifications(false);
      showToast(`Calendrier marocain ${y} mis à jour (${added} date(s) ajoutée(s))`);
    });

    document.getElementById('btnRestoreDefaultHolidays').addEventListener('click', async () => {
      state.holidays = [...DEFAULT_MOROCCAN_HOLIDAYS];
      await saveState();
      renderKPIsAndAllViews();
      syncAndScheduleSystemNotifications(false);
      showToast('Calendrier officiel marocain 2026–2027 restauré');
    });

    document.getElementById('btnRecalculateAllOpsWithHolidays')?.addEventListener('click', async () => {
      const oldOps = [...state.operations];
      state.operations = [];
      for (const op of oldOps) {
        const sim = simulateDistribution(
          op.montantTotal,
          op.dateSaisie,
          op.echeanceDays,
          op.mode || 'backward',
          op.numChequeBase
        );
        const opPhoto = op.photoDataUrl || op.tranches?.[0]?.photoDataUrl || null;
        state.operations.push({
          ...op,
          photoDataUrl: opPhoto,
          dateLimiteBrute: sim.dateLimiteBrute,
          dateOuvrableCible: sim.dateOuvrableCible,
          updatedAt: new Date().toISOString(),
          tranches: sim.tranches.map((tr, idx) => ({
            ...tr,
            status: op.tranches?.[idx]?.status || tr.status || 'scheduled',
            photoId: op.photoId || null,
            photoDataUrl: op.tranches?.[idx]?.photoDataUrl || opPhoto
          }))
        });
      }
      await saveState();
      renderKPIsAndAllViews();
      syncAndScheduleSystemNotifications(false);
      showToast('Toutes les opérations ont été recalculées selon le calendrier marocain à jour');
    });

    // Backup JSON Download (with SHA-256 Integrity Checksum, v11.0.0 metadata, and hydrated photos)
    document.getElementById('btnBackupDownloadJSON')?.addEventListener('click', async () => {
      try {
        const coreData = {
          plafondJournalier: state.plafondJournalier,
          companyName: state.companyName,
          holidays: state.holidays,
          operations: state.operations.map((op) => {
            const pUrl = op.photoDataUrl || (op.photoId ? env.photoMemoryCache.get(op.photoId) : null) || null;
            return {
              ...op,
              photoDataUrl: pUrl,
              tranches: (op.tranches || []).map((tr) => ({
                ...tr,
                photoDataUrl: tr.photoDataUrl || pUrl
              }))
            };
          })
        };
        const integrityHash = await computeSHA256ChecksumBrowser(JSON.stringify(coreData));
        const backupObj = {
          appName: 'PlafondChèque Maroc Pro',
          version: APP_VERSION,
          backupFormatVersion: BACKUP_FORMAT_VERSION,
          exportedAt: new Date().toISOString(),
          integrityHash,
          notificationSettings: state.notificationSettings,
          language: state.language,
          lwalidMode: state.lwalidMode,
          ...coreData
        };
        const blob = new Blob([JSON.stringify(backupObj, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sauvegarde_plafondcheque_maroc_${getTodayYMD()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('✓ Sauvegarde JSON (v11.0 avec empreinte SHA-256) téléchargée');
      } catch (err) {
        showToast(err.message || 'Erreur lors de la génération de la sauvegarde');
      }
    });

    document.getElementById('btnExportEncryptedBackup')?.addEventListener('click', async () => {
      const pass = (document.getElementById('inputBackupPassphrase')?.value || '').trim();
      if (pass.length < 4) {
        showToast('Veuillez saisir une phrase de passe (min. 4 caractères) pour chiffrer la sauvegarde AES-256-GCM');
        return;
      }
      try {
        const coreData = {
          plafondJournalier: state.plafondJournalier,
          companyName: state.companyName,
          holidays: state.holidays,
          notificationSettings: state.notificationSettings,
          language: state.language,
          lwalidMode: state.lwalidMode,
          operations: state.operations.map((op) => {
            const pUrl = op.photoDataUrl || (op.photoId ? env.photoMemoryCache.get(op.photoId) : null) || null;
            return {
              ...op,
              photoDataUrl: pUrl,
              tranches: (op.tranches || []).map((tr) => ({
                ...tr,
                photoDataUrl: tr.photoDataUrl || pUrl
              }))
            };
          })
        };
        const encryptedEnvelope = await encryptBackupPayloadAESGCM(coreData, pass);
        const blob = new Blob([JSON.stringify(encryptedEnvelope, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sauvegarde_chiffree_aes256_${getTodayYMD()}.enc.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('🔒 Sauvegarde chiffrée AES-256-GCM (PBKDF2 210 000 itérations) téléchargée');
      } catch (err) {
        showToast(err.message || 'Erreur lors du chiffrement de la sauvegarde');
      }
    });

    // 7-Step Safe Backup Validation & Restoration Handler
    document.getElementById('inputRestoreJSONFile')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (ev) => {
        try {
          let parsed;
          try {
            parsed = JSON.parse(String(ev.target?.result || ''));
          } catch (jsonErr) {
            showToast('⛔ Fichier JSON corrompu ou syntaxiquement invalide');
            return;
          }
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            showToast('⛔ Format de sauvegarde invalide');
            return;
          }

          if (parsed.encrypted) {
            try {
              validateEncryptionEnvelopeBrowser(parsed, { requireCiphertext: true });
            } catch (metaErr) {
              showToast(`⛔ Métadonnées de chiffrement invalides : ${metaErr.message}`);
              return;
            }
            const pass = (document.getElementById('inputBackupPassphrase')?.value || '').trim();
            if (!pass) {
              showToast(
                'Ce fichier est chiffré (AES-256-GCM). Saisissez d’abord la phrase de passe dans le champ ci-dessous puis réimportez.'
              );
              return;
            }
            try {
              parsed = await decryptBackupPayloadAESGCM(parsed, pass);
            } catch (decErr) {
              showToast('⛔ Échec du déchiffrement : phrase de passe incorrecte ou fichier altéré');
              return;
            }
          } else if (parsed.integrityHash) {
            const checkCore = {
              plafondJournalier: parsed.plafondJournalier,
              companyName: parsed.companyName,
              holidays: parsed.holidays,
              operations: parsed.operations
            };
            const computedHash = await computeSHA256ChecksumBrowser(JSON.stringify(checkCore));
            if (!constantTimeEqualStrings(computedHash, parsed.integrityHash)) {
              showToast(
                '⚠️ Attention : L’empreinte d’intégrité SHA-256 du fichier ne correspond pas (fichier modifié ou corrompu)'
              );
              return;
            }
          }

          if (!parsed || !Array.isArray(parsed.operations)) {
            showToast('⛔ Fichier de sauvegarde incomplet : aucune liste d’opérations trouvée');
            return;
          }

          // Validate every operation and cheque before allowing restoration
          const plafond = Number(parsed.plafondJournalier) || 10000000;
          if (!Number.isFinite(plafond) || plafond < 1000) {
            showToast('⛔ Plafond journalier invalide dans la sauvegarde (min. 1 000 DH)');
            return;
          }
          for (let i = 0; i < parsed.operations.length; i++) {
            const op = parsed.operations[i];
            if (!op || typeof op !== 'object' || !Array.isArray(op.tranches)) {
              showToast(`⛔ Opération #${i + 1} mal formée dans le fichier de sauvegarde`);
              return;
            }
            for (let j = 0; j < op.tranches.length; j++) {
              const tr = op.tranches[j];
              const m = Number(tr?.montant);
              if (!tr || !Number.isFinite(m) || m <= 0 || !isValidYMD(String(tr.date || ''))) {
                showToast(`⛔ Chèque #${j + 1} de l’opération #${i + 1} invalide (montant ou date incorrecte)`);
                return;
              }
            }
          }

          openModal('import_json', parsed);
        } catch (err) {
          showToast(err.message || 'Erreur de lecture : le fichier JSON est corrompu ou invalide');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    // Home Screen 5-Icon Launcher, Top-Right Settings Gear, Banner/CTA [data-tab] Buttons & Top-Left Back Button
    document.querySelectorAll('[data-home-launch]').forEach((tile) => {
      tile.addEventListener('click', () => {
        switchTab(tile.getAttribute('data-home-launch'));
      });
    });
    document.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');
        if (!targetTab) return;
        switchTab(targetTab);
        if (targetTab === 'tab-parametres' && typeof env.showSettingsLandingHub === 'function') {
          env.showSettingsLandingHub({ pushHistory: false });
        }
      });
    });
    document.getElementById('btnGrantAllPermissionsStartup')?.addEventListener('click', async () => {
      const statusEl = document.getElementById('lblStartupPermStatus');
      try {
        if (typeof env.requestAllAppPermissionsOnStartup === 'function') {
          await env.requestAllAppPermissionsOnStartup();
        }
        if (statusEl) {
          statusEl.textContent = '✓ Autorisations vérifiées.';
          statusEl.classList.remove('hidden');
        }
      } catch (e) {
        if (statusEl) {
          statusEl.textContent = 'ℹ️ Autorisations gérées depuis les paramètres du navigateur.';
          statusEl.classList.remove('hidden');
        }
      }
    });
    document.getElementById('btnHeaderGoHome')?.addEventListener('click', () => {
      goHomeScreen();
    });
    document.getElementById('btnHomeQuickEditPlafond')?.addEventListener('click', () => {
      openModal('plafond');
    });

    // Dark Mode Toggle (Header & Settings)
    function applyThemeUI(dark) {
      state.darkMode = Boolean(dark);
      document.documentElement.classList.toggle('dark', state.darkMode);
      const iconEl = document.getElementById('lblThemeIcon');
      if (iconEl) iconEl.textContent = state.darkMode ? '☀️' : '🌙';
    }
    applyThemeUI(state.darkMode);
    document.getElementById('btnQuickThemeToggle')?.addEventListener('click', () => {
      applyThemeUI(!state.darkMode);
      saveState();
    });
    document.getElementById('btnSettingsToggleDark')?.addEventListener('click', () => {
      applyThemeUI(!state.darkMode);
      saveState();
    });

    // Draft Photo Upload & Rotate 90°
    document.getElementById('btnOpenCameraStudio')?.addEventListener('click', () => {
      document.getElementById('inputDraftChequePhoto')?.click();
    });
    document.getElementById('inputDraftChequePhoto')?.addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const rawUrl = String(ev.target?.result || '');
        const compressedUrl = await compressAndResizeChequeImage(rawUrl, 1280, 600, 0.72);
        setDraftPhotoPreview(compressedUrl);
        const kb = Math.round(((compressedUrl || '').length * 3) / 4 / 1024);
        showToast(`📸 Photo optimisée (${kb} Ko) & chiffrée AES-256`);
      };
      reader.readAsDataURL(f);
    });
    document.getElementById('btnRotateDraftPhoto')?.addEventListener('click', async () => {
      if (!env.currentDraftPhotoDataUrl) return;
      const rotated = await rotateDataURL90(env.currentDraftPhotoDataUrl);
      setDraftPhotoPreview(rotated);
      saveDraftForm();
      showToast('↻ Photo pivotée de 90°');
    });

    document.getElementById('btnCropDraftPhoto')?.addEventListener('click', async () => {
      if (!env.currentDraftPhotoDataUrl) return;
      const cropped = await cropDataURLToChequeRatio(env.currentDraftPhotoDataUrl);
      setDraftPhotoPreview(cropped);
      saveDraftForm();
      showToast('✂️ Photo recadrée au format chèque');
    });
    document.getElementById('btnClearDraftPhoto')?.addEventListener('click', () => {
      env.draftPhotoExplicitlyCleared = true;
      setDraftPhotoPreview(null);
      const fileIn = document.getElementById('inputDraftChequePhoto');
      if (fileIn) fileIn.value = '';
    });

    // PIN Security Lock (Persistent Startup Lock, Salted Hash, Recovery Key, 5-Attempt Lockout, Auto-Lock)
    const pinOverlay = document.getElementById('pinLockOverlay');
    const pinInput = document.getElementById('inputUnlockPin');

    async function lockApplicationNow() {
      if (!state.pinHash) return;
      // Flush latest encrypted vault before wiping volatile RAM
      if (!state.isLocked && sessionVaultDekBytes) {
        try {
          await saveState();
        } catch (e) {}
      }
      state.isLocked = true;
      sessionVaultDekBytes = null;
      sessionVaultCryptoKey = null;
      keyIsPersistedAndRecoverable = false;
      env.photoMemoryCache.clear();
      state.operations = [];
      renderKPIsAndAllViews();
      document.body.classList.add('app-is-locked');
      if (pinInput) pinInput.value = '';
      document.getElementById('pinErrorMsg')?.classList.add('hidden');
      pinOverlay?.classList.remove('hidden');
      pinOverlay?.classList.add('flex');
    }

    let lastUserActivityTimestamp = Date.now();

    function resetInactivityTimer() {
      if (!state.isLocked) {
        lastUserActivityTimestamp = Date.now();
      }
    }

    function checkAndTriggerInactivityAutoLock() {
      const autoMins = Number(state.autoLockMinutes) || 0;
      if (state.pinHash && !state.isLocked && autoMins > 0) {
        const elapsedMs = Date.now() - lastUserActivityTimestamp;
        if (elapsedMs >= autoMins * 60 * 1000) {
          lockApplicationNow();
          showToast(`🔒 Application verrouillée après ${autoMins} min d'inactivité`);
        }
      }
    }

    ['pointerdown', 'keydown', 'mousemove', 'touchstart', 'scroll', 'click'].forEach((evtName) => {
      window.addEventListener(evtName, resetInactivityTimer, { passive: true });
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        checkAndTriggerInactivityAutoLock();
      }
    });

    window.checkAndTriggerInactivityAutoLock = checkAndTriggerInactivityAutoLock;
    window.resetInactivityTimer = resetInactivityTimer;
    window._setLastActivityForTest = (ts) => {
      lastUserActivityTimestamp = ts;
    };
    if (window._pcmInactivityInterval) clearInterval(window._pcmInactivityInterval);
    window._pcmInactivityInterval = setInterval(checkAndTriggerInactivityAutoLock, 3000);

    document.getElementById('selectAutoLockMinutes')?.addEventListener('change', async (e) => {
      state.autoLockMinutes = parseInt(e.target.value || '0', 10) || 0;
      resetInactivityTimer();
      await saveState();
      showToast(
        state.autoLockMinutes > 0
          ? `Verrouillage automatique réglé sur ${state.autoLockMinutes} min d'inactivité`
          : 'Verrouillage automatique réglé sur : Au lancement uniquement'
      );
    });

    function unlockApplicationNow() {
      state.isLocked = false;
      state.failedPinAttempts = 0;
      state.lockoutUntil = 0;
      lastUserActivityTimestamp = Date.now();
      document.body.classList.remove('app-is-locked');
      pinOverlay?.classList.add('hidden');
      pinOverlay?.classList.remove('flex');
    }

    if (state.pinHash) {
      document.getElementById('lblPinStatusInfo').textContent = 'Statut actuel : Protection par code PIN ACTIVE.';
      lockApplicationNow();
    }

    document.getElementById('btnToggleUnlockPinVis')?.addEventListener('click', () => {
      if (!pinInput) return;
      pinInput.type = pinInput.type === 'password' ? 'text' : 'password';
    });
  }
  Object.assign(env, { bindBackupAndDemoEvents });
}
