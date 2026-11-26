/** PlafondChèque Maroc Pro — Settings Cloud Account Auth, Email Change, Logout & Account Deletion Listeners */
export function registerCloudAuthUi(env) {
  const {
    state,
    pcmT,
    showToast,
    saveState,
    safeStorageSet,
    renderKPIsAndAllViews,
    switchTab,
    openFirstLaunchAuthScreen,
    openSettingsSubpage,
    getCloudBackendConfig,
    isCloudBackendConfigured,
    getStoredCloudSession,
    persistCloudSession,
    setCloudAuthFeedback,
    updateCloudSyncStatusUI,
    cloudFetchJSON,
    performFullCloudSync,
    startGoogleOAuthFlow,
    handleIncomingGoogleOAuthCallback,
    updateLinkedIdentitiesUI
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
  let cloudLoginFailedCount = 0;
  let cloudLoginLockoutUntil = 0;
  function initCloudAccountUIAndListeners() {
    if (window._pcmCloudListenersBound) return;
    window._pcmCloudListenersBound = true;
    const cfg = getCloudBackendConfig();
    const urlIn = document.getElementById('inputCloudSupabaseUrl');
    const keyIn = document.getElementById('inputCloudSupabaseAnonKey');
    if (urlIn && cfg.supabaseUrl) urlIn.value = cfg.supabaseUrl;
    if (keyIn && cfg.supabaseAnonKey) keyIn.value = cfg.supabaseAnonKey;

    document.getElementById('btnHeaderCloudStatusPill')?.addEventListener('click', () => {
      switchTab('tab-parametres');
      openSettingsSubpage('account');
    });

    // Google OAuth Buttons (First-Launch Auth, Settings Signed-Out, Settings Account Linking)
    document.getElementById('btnOnbGoogleAuth')?.addEventListener('click', () => {
      startGoogleOAuthFlow({ isLinking: false, feedbackTarget: 'onboarding' });
    });
    document.getElementById('btnOnbChoiceGoogle')?.addEventListener('click', () => {
      openFirstLaunchAuthScreen('register');
      startGoogleOAuthFlow({ isLinking: false, feedbackTarget: 'onboarding' });
    });
    document.getElementById('btnSettingsGoogleAuth')?.addEventListener('click', () => {
      startGoogleOAuthFlow({ isLinking: false, feedbackTarget: 'settings' });
    });
    document.getElementById('btnCloudConnectGoogle')?.addEventListener('click', () => {
      startGoogleOAuthFlow({ isLinking: true, feedbackTarget: 'settings' });
    });

    // Password visibility toggle on unified registration/login screen
    document.getElementById('btnToggleOnbAuthPassword')?.addEventListener('click', () => {
      const inp = document.getElementById('inputOnbAuthPassword');
      const btn = document.getElementById('btnToggleOnbAuthPassword');
      if (!inp || !btn) return;
      const isHidden = inp.type === 'password';
      inp.type = isHidden ? 'text' : 'password';
      btn.setAttribute('aria-label', pcmT(isHidden ? 'auth_hide_pw' : 'auth_show_pw'));
    });

    // Check Web OAuth callback on boot + Capacitor native deep-link listener (ma.plafondcheque.pro://auth/callback)
    handleIncomingGoogleOAuthCallback(window.location.href);
    try {
      const capApp = window.Capacitor?.Plugins?.App;
      if (capApp && typeof capApp.addListener === 'function') {
        capApp.addListener('appUrlOpen', (event) => {
          if (event && event.url && event.url.startsWith('ma.plafondcheque.pro://auth/callback')) {
            handleIncomingGoogleOAuthCallback(event.url);
          }
        });
      }
    } catch (_) {}

    const existingSessionForIdentities = getStoredCloudSession();
    if (existingSessionForIdentities && existingSessionForIdentities.user) {
      updateLinkedIdentitiesUI(existingSessionForIdentities.user);
    }

    document.getElementById('btnAuthTabLogin')?.addEventListener('click', () => {
      env.cloudAuthMode = 'login';
      document.getElementById('btnAuthTabLogin').className =
        'px-3.5 py-1.5 rounded-lg text-xs font-extrabold bg-white text-indigo-700 shadow-sm transition cursor-pointer';
      document.getElementById('btnAuthTabRegister').className =
        'px-3.5 py-1.5 rounded-lg text-xs font-bold text-slate-600 hover:text-slate-900 transition cursor-pointer';
      document.getElementById('btnCloudAuthSubmit').textContent = pcmT('auth_btn_submit_login');
      setCloudAuthFeedback(null);
    });

    document.getElementById('btnAuthTabRegister')?.addEventListener('click', () => {
      env.cloudAuthMode = 'register';
      document.getElementById('btnAuthTabRegister').className =
        'px-3.5 py-1.5 rounded-lg text-xs font-extrabold bg-white text-indigo-700 shadow-sm transition cursor-pointer';
      document.getElementById('btnAuthTabLogin').className =
        'px-3.5 py-1.5 rounded-lg text-xs font-bold text-slate-600 hover:text-slate-900 transition cursor-pointer';
      document.getElementById('btnCloudAuthSubmit').textContent = pcmT('auth_btn_submit_register');
      setCloudAuthFeedback(null);
    });

    document.getElementById('btnSaveCloudBackendConfig')?.addEventListener('click', () => {
      const u = (document.getElementById('inputCloudSupabaseUrl')?.value || '').trim().replace(/\/+$/, '');
      const k = (document.getElementById('inputCloudSupabaseAnonKey')?.value || '').trim();
      if (!/^https?:\/\//i.test(u) || k.length < 10) {
        setCloudAuthFeedback('Veuillez saisir une URL Supabase valide (https://...) et la clé publique Anon.', 'error');
        return;
      }
      safeStorageSet(CLOUD_CONFIG_STORAGE_KEY, JSON.stringify({ supabaseUrl: u, supabaseAnonKey: k }));
      setCloudAuthFeedback('✓ Configuration du serveur Supabase enregistrée.', 'success');
      updateCloudSyncStatusUI();
    });

    document.getElementById('formCloudAuth')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (Date.now() < cloudLoginLockoutUntil) {
        const waitSec = Math.ceil((cloudLoginLockoutUntil - Date.now()) / 1000);
        setCloudAuthFeedback(`Trop de tentatives échouées. Patientez ${waitSec}s avant de réessayer.`, 'error');
        return;
      }
      const email = (document.getElementById('inputCloudAuthEmail')?.value || '').trim().toLowerCase();
      const password = document.getElementById('inputCloudAuthPassword')?.value || '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || password.length < 8) {
        setCloudAuthFeedback(
          'Veuillez saisir une adresse e-mail valide et un mot de passe d’au moins 8 caractères.',
          'error'
        );
        return;
      }
      const submitBtn = document.getElementById('btnCloudAuthSubmit');
      if (submitBtn) submitBtn.disabled = true;
      setCloudAuthFeedback(
        env.env.cloudAuthMode === 'register' ? 'Création du compte en cours...' : 'Connexion sécurisée en cours...',
        'info'
      );

      try {
        if (env.env.cloudAuthMode === 'register') {
          const resp = await cloudFetchJSON('/auth/v1/signup', { method: 'POST', body: { email, password } });
          if (resp && resp.access_token) {
            const expIn = Number(resp.expires_in) || 3600;
            persistCloudSession({
              access_token: resp.access_token,
              refresh_token: resp.refresh_token || '',
              expires_in: expIn,
              expires_at_ms: resp.expires_at ? Number(resp.expires_at) * 1000 : Date.now() + expIn * 1000,
              user: resp.user || { email }
            });
            cloudLoginFailedCount = 0;
            setCloudAuthFeedback('✓ Compte créé et connecté.', 'success');
            updateCloudSyncStatusUI('SYNCING');
            await performFullCloudSync({ isManual: false, allowMigrationPrompt: true });
          } else {
            setCloudAuthFeedback(
              '✉️ Compte créé ! Vérifiez votre boîte e-mail pour confirmer votre adresse avant de vous connecter.',
              'success'
            );
          }
        } else {
          const resp = await cloudFetchJSON('/auth/v1/token?grant_type=password', {
            method: 'POST',
            body: { email, password }
          });
          const expIn = Number(resp.expires_in) || 3600;
          persistCloudSession({
            access_token: resp.access_token,
            refresh_token: resp.refresh_token || '',
            expires_in: expIn,
            expires_at_ms: resp.expires_at ? Number(resp.expires_at) * 1000 : Date.now() + expIn * 1000,
            user: resp.user || { email }
          });
          cloudLoginFailedCount = 0;
          setCloudAuthFeedback('✓ Connexion réussie.', 'success');
          document.getElementById('inputCloudAuthPassword').value = '';
          updateCloudSyncStatusUI('SYNCING');
          await performFullCloudSync({ isManual: false, allowMigrationPrompt: true });
        }
      } catch (err) {
        if (err.code === 'INVALID_CREDENTIALS') {
          cloudLoginFailedCount++;
          if (cloudLoginFailedCount >= 5) {
            cloudLoginLockoutUntil = Date.now() + 30000;
          }
          setCloudAuthFeedback('E-mail ou mot de passe incorrect.', 'error');
        } else if (err.code === 'EMAIL_NOT_VERIFIED') {
          setCloudAuthFeedback(
            'Votre adresse e-mail n’est pas encore vérifiée. Ouvrez le lien reçu par e-mail puis réessayez.',
            'error'
          );
        } else if (err.code === 'CLOUD_NOT_CONFIGURED') {
          setCloudAuthFeedback(
            typeof env.pcmT === 'function'
              ? env.pcmT('msg_err_backend_unconfigured')
              : 'Cloud backup is not configured in this build yet.',
            'error'
          );
        } else if (err.code === 'RATE_LIMITED') {
          setCloudAuthFeedback(
            typeof env.pcmT === 'function'
              ? env.pcmT('msg_err_rate_limited')
              : 'Trop de requêtes. Veuillez patienter quelques instants.',
            'error'
          );
        } else {
          setCloudAuthFeedback(err.message || 'Erreur lors de l’authentification.', 'error');
        }
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });

    document.getElementById('btnCloudForgotPassword')?.addEventListener('click', async () => {
      const email = (document.getElementById('inputCloudAuthEmail')?.value || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        setCloudAuthFeedback(
          'Saisissez d’abord votre adresse e-mail dans le champ ci-dessus pour recevoir le lien de réinitialisation.',
          'error'
        );
        return;
      }
      try {
        await cloudFetchJSON('/auth/v1/recover', { method: 'POST', body: { email } });
        setCloudAuthFeedback(`✉️ Un lien de réinitialisation de mot de passe a été envoyé à ${email}.`, 'success');
      } catch (err) {
        setCloudAuthFeedback(err.message || 'Impossible d’envoyer le lien de réinitialisation.', 'error');
      }
    });

    document.getElementById('btnCloudSendResetFromSignedIn')?.addEventListener('click', async () => {
      const session = getStoredCloudSession();
      const email = session?.user?.email;
      if (!email) return;
      try {
        await cloudFetchJSON('/auth/v1/recover', { method: 'POST', body: { email } });
        setCloudAuthFeedback(`✉️ Lien de réinitialisation envoyé à ${email}.`, 'success');
      } catch (err) {
        setCloudAuthFeedback(err.message || 'Erreur lors de l’envoi.', 'error');
      }
    });

    document.getElementById('btnCloudChangeEmail')?.addEventListener('click', async () => {
      const newEmail = (document.getElementById('inputCloudNewEmail')?.value || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(newEmail)) {
        setCloudAuthFeedback('Veuillez saisir une nouvelle adresse e-mail valide.', 'error');
        return;
      }
      try {
        await cloudFetchJSON('/auth/v1/user', { method: 'PUT', useAuth: true, body: { email: newEmail } });
        setCloudAuthFeedback(
          `✉️ Demande de changement d’e-mail envoyée. Confirmez le lien envoyé à ${newEmail}.`,
          'success'
        );
        document.getElementById('inputCloudNewEmail').value = '';
      } catch (err) {
        setCloudAuthFeedback(err.message || 'Erreur lors du changement d’e-mail.', 'error');
      }
    });

    document.getElementById('btnCloudSyncNow')?.addEventListener('click', () => {
      performFullCloudSync({ isManual: true });
    });

    document.getElementById('btnCloudOpenConflicts')?.addEventListener('click', () => {
      renderCloudConflictsModal();
    });

    document.getElementById('btnCloseCloudConflictModal')?.addEventListener('click', () => {
      const m = document.getElementById('cloudConflictModal');
      if (m) {
        m.classList.add('hidden');
        m.classList.remove('flex');
      }
    });

    document.getElementById('cloudConflictListContainer')?.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('.btn-resolve-cloud-conflict');
      if (!btn) return;
      const idx = parseInt(btn.getAttribute('data-resolve-conflict'), 10);
      const choice = btn.getAttribute('data-resolution');
      const conflict = state.cloudSync.conflicts[idx];
      if (!conflict) return;

      if (choice === 'remote') {
        state.operations = state.operations.filter((o) => o.id !== conflict.id);
        if (conflict.remoteOp.deletedAt) {
          state.deletedOperationTombstones[conflict.id] = conflict.remoteOp.deletedAt;
        } else {
          delete state.deletedOperationTombstones[conflict.id];
          state.operations.push({
            ...conflict.remoteOp,
            version: (conflict.remoteOp.version || 1) + 1,
            updatedAt: new Date().toISOString()
          });
        }
      } else if (choice === 'local') {
        if (conflict.localOp) {
          const idxOp = state.operations.findIndex((o) => o.id === conflict.id);
          const bumped = {
            ...conflict.localOp,
            version: Math.max(Number(conflict.localOp.version) || 1, Number(conflict.remoteOp.version) || 1) + 1,
            updatedAt: new Date().toISOString()
          };
          if (idxOp !== -1) state.operations[idxOp] = bumped;
          else state.operations.push(bumped);
        }
      } else if (choice === 'both') {
        // Preserve local as-is and duplicate remote as a separate operation with a new unique ID
        if (conflict.remoteOp && !conflict.remoteOp.deletedAt) {
          const copyOp = {
            ...conflict.remoteOp,
            id: 'op_merged_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
            beneficiaire: `${conflict.remoteOp.beneficiaire} (Copie Cloud)`,
            updatedAt: new Date().toISOString(),
            version: 1
          };
          state.operations.push(copyOp);
        }
      }

      // Update baseline so next sync pushes the resolved state cleanly
      const currentOp = state.operations.find((o) => o.id === conflict.id);
      state.cloudSync.syncBaselineMap[conflict.id] = {
        updatedAt: conflict.remoteOp.updatedAt,
        deletedAt: conflict.remoteOp.deletedAt || null,
        fingerprint: stableOpFingerprintBrowser(conflict.remoteOp),
        version: conflict.remoteOp.version || 1
      };
      state.cloudSync.conflicts.splice(idx, 1);
      renderCloudConflictsModal();
      await saveState();
      renderKPIsAndAllViews();
      await performFullCloudSync({ isManual: true });
    });

    document.getElementById('btnConfirmCloudMigration')?.addEventListener('click', async () => {
      const migModal = document.getElementById('cloudMigrationModal');
      if (migModal) {
        migModal.classList.add('hidden');
        migModal.classList.remove('flex');
      }
      const session = getStoredCloudSession();
      if (session?.user?.id) {
        state.cloudSync.migratedUserId = session.user.id;
      }
      await performFullCloudSync({ isManual: true, allowMigrationPrompt: false });
    });

    document.getElementById('btnCancelCloudMigration')?.addEventListener('click', () => {
      const migModal = document.getElementById('cloudMigrationModal');
      if (migModal) {
        migModal.classList.add('hidden');
        migModal.classList.remove('flex');
      }
    });

    // Logout explicitly preserves all local records!
    document.getElementById('btnCloudLogout')?.addEventListener('click', async () => {
      try {
        await cloudFetchJSON('/auth/v1/logout', { method: 'POST', useAuth: true });
      } catch (e) {}
      persistCloudSession(null);
      state.cloudSync.status = 'SIGNED_OUT';
      state.cloudSync.conflicts = [];
      updateCloudSyncStatusUI('SIGNED_OUT');
      setCloudAuthFeedback('✓ Déconnecté. Vos données locales sur cet appareil ont été conservées.', 'info');
      showToast('Déconnecté (données locales préservées)');
    });

    document.getElementById('btnCloudDeleteAccount')?.addEventListener('click', () => {
      const m = document.getElementById('cloudDeleteAccountModal');
      if (m) {
        m.classList.remove('hidden');
        m.classList.add('flex');
      }
    });

    document.getElementById('btnCancelDeleteCloudAccount')?.addEventListener('click', () => {
      const m = document.getElementById('cloudDeleteAccountModal');
      if (m) {
        m.classList.add('hidden');
        m.classList.remove('flex');
      }
    });

    document.getElementById('btnConfirmDeleteCloudAccount')?.addEventListener('click', async () => {
      const m = document.getElementById('cloudDeleteAccountModal');
      if (m) {
        m.classList.add('hidden');
        m.classList.remove('flex');
      }
      try {
        await cloudFetchJSON('/functions/v1/delete-account', {
          method: 'POST',
          useAuth: true,
          body: { confirmDelete: true }
        });
        persistCloudSession(null);
        state.cloudSync.migratedUserId = null;
        state.cloudSync.lastSyncedAt = null;
        state.cloudSync.syncBaselineMap = {};
        updateCloudSyncStatusUI('SIGNED_OUT');
        setCloudAuthFeedback(
          '✓ Votre compte cloud et ses données distantes ont été supprimés. Vos données locales restent intactes.',
          'success'
        );
      } catch (err) {
        setCloudAuthFeedback(err.message || 'Erreur lors de la suppression du compte cloud.', 'error');
      }
    });

    window.addEventListener('online', () => {
      if (getStoredCloudSession() && isCloudBackendConfigured()) {
        performFullCloudSync({ isManual: false });
      }
    });
    window.addEventListener('offline', () => {
      if (getStoredCloudSession()) {
        updateCloudSyncStatusUI('OFFLINE_PENDING');
      }
    });

    updateCloudSyncStatusUI();
    if (getStoredCloudSession() && isCloudBackendConfigured() && navigator.onLine) {
      performFullCloudSync({ isManual: false });
    }
  }

  Object.assign(env, { initCloudAccountUIAndListeners });
}
