/** PlafondChèque Maroc Pro — 5-Step Onboarding, Account Selection & First-Launch Auth */
export function registerOnboardingUi(env) {
  const {
    state,
    pcmT,
    showToast,
    saveState,
    safeStorageSet,
    goHomeScreen,
    applyLanguageUI,
    applyCentralizedPcmI18nDOM,
    renderBuiltInManualAndFaq,
    persistCloudSession,
    updateCloudSyncStatusUI,
    cloudFetchJSON,
    performFullCloudSync
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
  const ONBOARDING_STORAGE_KEY = 'pcm_onboarding_completed_v10';
  const SAVED_LANGUAGE_STORAGE_KEY = 'pcm_saved_language_v10';
  let currentOnboardingStep = 1;
  let onboardingScreenMode = 'steps'; // 'steps' | 'account_selection' | 'account_auth'
  let onbAuthMode = 'register'; // 'register' | 'login'
  const TOTAL_ONBOARDING_STEPS = 5;

  const ONBOARDING_I18N = {
    fr: {
      kicker: [
        'Bienvenue sur PlafondChèque Pro',
        'Gestion des Chèques',
        'Calendrier & Paiements',
        'Suivi Financier',
        'Protection des Données'
      ],
      acctKicker: 'Démarrage & Compte',
      skip: 'Passer',
      back: '← Retour',
      next: 'Continuer →',
      start: 'Commencer →',
      s1Badge: 'Gestion Professionnelle des Chèques au Maroc',
      s1Title: 'Bienvenue sur PlafondChèque Maroc Pro',
      s1Sub: 'Votre solution professionnelle pour gérer, organiser et suivre vos chèques au Maroc.',
      s2Badge: 'Gestion des Chèques',
      s2Title: 'Tous vos chèques, parfaitement organisés.',
      s2Sub:
        'Créez, modifiez, photographiez et suivez chaque chèque avec conversion automatique du montant en lettres (français et arabe).',
      s3Badge: 'Calendrier & Échéances',
      s3Title: 'Gardez une longueur d’avance sur vos paiements.',
      s3Sub:
        'Consultez le calendrier mensuel interactif adapté aux jours fériés marocains et cliquez sur une date pour voir ses chèques.',
      s4Badge: 'Suivi Financier & Plafonds',
      s4Title: 'Sachez toujours où vous en êtes.',
      s4Sub:
        'Suivez votre plafond journalier, les montants engagés, votre capacité restante et vos rapports financiers A4 en un coup d’œil.',
      s5Badge: 'Protection des Données',
      s5Title: 'Vos données méritent d’être protégées.',
      s5Sub:
        'Créez un compte gratuit (optionnel) pour sauvegarder et récupérer vos données si vous perdez votre téléphone ou changez d’appareil.',
      acctTitle: 'Choisissez comment démarrer',
      acctSub: 'Protégez vos chèques par sauvegarde cloud multi-appareils ou démarrez immédiatement en mode local.',
      optATitle: 'Créer un compte',
      optADesc:
        'Protégez vos données avec une sauvegarde cloud sécurisée et accédez à vos informations depuis n’importe quel appareil.',
      optABtn: 'Créer un compte',
      optBTitle: 'Vous avez déjà un compte ?',
      optBDesc: 'Connectez-vous pour restaurer vos chèques, clients et paramètres.',
      optBBtn: 'Se connecter',
      optCTitle: 'Peut-être plus tard',
      optCDesc:
        'Vous pouvez commencer à utiliser PlafondChèque sans inscription et créer un compte quand vous le souhaitez.',
      optCBtn: 'Continuer sans compte',
      langNameBadge: '🇫🇷 Français'
    },
    ar: {
      kicker: [
        'مرحباً بك في PlafondChèque Pro',
        'إدارة الشيكات',
        'تنظيم المدفوعات',
        'مراقبة النشاط المالي',
        'حماية بياناتك'
      ],
      acctKicker: 'اختيار الحساب والبدء',
      skip: 'تخطي',
      back: '→ السابق',
      next: 'متابعة ←',
      start: 'ابدأ الآن ←',
      s1Badge: 'الحل المهني لإدارة الشيكات بالمغرب',
      s1Title: 'مرحباً بك في PlafondChèque Maroc Pro',
      s1Sub: 'حلك المهني لإدارة وتنظيم ومراقبة شيكاتك في المغرب.',
      s2Badge: 'إدارة الشيكات',
      s2Title: 'جميع شيكاتك منظمة في مكان واحد.',
      s2Sub: 'أنشئ وعدّل وصوّر وتابع شيكاتك بسهولة مع التفقيط التلقائي للمبلغ بالعربية والفرنسية.',
      s3Badge: 'التقويم والمواعيد',
      s3Title: 'ابقَ متقدماً على مواعيد مدفوعاتك.',
      s3Sub: 'استخدم التقويم الشهري التفاعلي المتوافق مع العطل المغربية واضغط على أي تاريخ لعرض الشيكات المبرمجة.',
      s4Badge: 'المتابعة المالية',
      s4Title: 'اعرف وضعك المالي دائماً.',
      s4Sub: 'تابع السقف اليومي، المبالغ الملتزم بها، الرصيد المتبقي والملخصات المالية A4 بلمحة واحدة.',
      s5Badge: 'حماية البيانات',
      s5Title: 'بياناتك تستحق الحماية.',
      s5Sub: 'يمكنك إنشاء حساب اختياري لمزامنة واسترجاع شيكاتك وعملائك وإعداداتك إذا فقدت هاتفك أو غيرت جهازك.',
      acctTitle: 'اختر طريقة البدء',
      acctSub: 'احمِ بياناتك بالنسخ الاحتياطي السحابي أو ابدأ فوراً بالاستخدام المحلي بدون تسجيل.',
      optATitle: 'إنشاء حساب',
      optADesc: 'احمِ بياناتك بنسخ احتياطي سحابي آمن وادخل إلى معلوماتك من أي جهاز.',
      optABtn: 'إنشاء حساب',
      optBTitle: 'لديك حساب بالفعل؟',
      optBDesc: 'سجّل الدخول لاسترجاع شيكاتك وعملائك وإعداداتك.',
      optBBtn: 'تسجيل الدخول',
      optCTitle: 'ربما لاحقاً',
      optCDesc: 'يمكنك البدء في استخدام PlafondChèque بدون تسجيل وإنشاء حساب في أي وقت لاحقاً.',
      optCBtn: 'المتابعة بدون حساب',
      langNameBadge: '🇲🇦 العربية (RTL)'
    },
    en: {
      kicker: [
        'Welcome to PlafondChèque Pro',
        'Manage Your Cheques',
        'Organize Your Payments',
        'Monitor Financial Activity',
        'Protect Your Data'
      ],
      acctKicker: 'Account & Get Started',
      skip: 'Skip',
      back: '← Back',
      next: 'Continue →',
      start: 'Get Started →',
      s1Badge: 'Professional Cheque Management in Morocco',
      s1Title: 'Welcome to PlafondChèque Maroc Pro',
      s1Sub: 'Your professional solution for managing, organizing, and monitoring your cheques in Morocco.',
      s2Badge: 'Manage Your Cheques',
      s2Title: 'All your cheques, organized.',
      s2Sub:
        'Create, edit, photograph, and monitor your cheques easily with automatic amounts in words (French & Arabic).',
      s3Badge: 'Organize Your Payments',
      s3Title: 'Stay ahead of your payments.',
      s3Sub:
        'Use the interactive monthly calendar aligned with Moroccan holidays and tap any date to view its assigned cheques.',
      s4Badge: 'Monitor Financial Activity',
      s4Title: 'Always know where you stand.',
      s4Sub:
        'Track your daily cheque ceiling, total scheduled amounts, remaining ceiling, and financial summaries at a glance.',
      s5Badge: 'Protect Your Data',
      s5Title: 'Your data deserves protection.',
      s5Sub:
        'Optionally create an account to securely synchronize and recover your data if you lose your phone or switch devices.',
      acctTitle: 'Choose how you want to start',
      acctSub: 'Back up your cheques safely across devices, or jump straight into local-only mode.',
      optATitle: 'Create an account',
      optADesc: 'Protect your data with secure cloud backup and access your information from any device.',
      optABtn: 'Create account',
      optBTitle: 'Already have an account?',
      optBDesc: 'Log in to restore your cheques, clients, and settings.',
      optBBtn: 'Log in',
      optCTitle: 'Maybe later',
      optCDesc: 'You can start using PlafondChèque without registering. You can create an account whenever you want.',
      optCBtn: 'Continue without an account',
      langNameBadge: '🇬🇧 English'
    }
  };

  function syncLanguagePillsAndBadges() {
    const lang = state.language || 'fr';
    const tPack = ONBOARDING_I18N[lang] || ONBOARDING_I18N.fr;
    const badge = document.getElementById('lblSettingsCurrentLanguageBadge');
    if (badge) badge.textContent = tPack.langNameBadge;

    document.querySelectorAll('.settings-lang-pill').forEach((btn) => {
      const bLang = btn.getAttribute('data-switch-lang');
      if (bLang === lang) {
        btn.className =
          'settings-lang-pill py-2.5 px-3 rounded-xl font-extrabold text-xs border-2 border-indigo-600 bg-indigo-600 text-white transition cursor-pointer';
      } else {
        btn.className =
          'settings-lang-pill py-2.5 px-3 rounded-xl font-extrabold text-xs border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 transition cursor-pointer';
      }
    });

    document.querySelectorAll('.onb-lang-card').forEach((btn) => {
      const cLang = btn.getAttribute('data-onb-lang');
      if (cLang === lang) {
        btn.className = 'onb-lang-card active-lang px-2 py-1 rounded-md transition cursor-pointer';
        btn.style.background = '#4f46e5';
        btn.style.color = '#ffffff';
      } else {
        btn.className = 'onb-lang-card px-2 py-1 rounded-md transition cursor-pointer';
        btn.style.background = 'transparent';
        btn.style.color = '#cbd5e1';
      }
    });
  }

  function setApplicationLanguageImmediate(newLang) {
    if (!['fr', 'ar', 'en'].includes(newLang)) return;
    state.language = newLang;
    try {
      safeStorageSet(SAVED_LANGUAGE_STORAGE_KEY, newLang);
    } catch (e) {}
    applyLanguageUI();
    syncLanguagePillsAndBadges();
    renderOnboardingStepUI();
    renderBuiltInManualAndFaq();
    saveState();
  }

  function renderOnboardingStepUI() {
    const lang = state.language || 'fr';
    const pack = ONBOARDING_I18N[lang] || ONBOARDING_I18N.fr;

    const isStepsMode = onboardingScreenMode === 'steps';
    const isSelectionMode = onboardingScreenMode === 'account_selection';
    const isAuthMode = onboardingScreenMode === 'account_auth';

    const stepInd = document.getElementById('lblOnboardingStepIndicator');
    const kickerEl = document.getElementById('lblOnboardingTopKicker');
    const progBar = document.getElementById('onboardingProgressBar');
    const progTrack = document.getElementById('onbProgressTrack');
    const footerBar = document.getElementById('onbFooterNavBar');
    const btnSkip = document.getElementById('btnOnboardingSkip');

    if (isStepsMode) {
      if (stepInd) stepInd.textContent = `${currentOnboardingStep}/${TOTAL_ONBOARDING_STEPS}`;
      if (kickerEl) kickerEl.textContent = pack.kicker[currentOnboardingStep - 1] || pack.kicker[0];
      if (progBar) progBar.style.width = `${Math.round((currentOnboardingStep / TOTAL_ONBOARDING_STEPS) * 100)}%`;
      progTrack?.classList.remove('hidden');
      footerBar?.classList.remove('hidden');
      btnSkip?.classList.remove('hidden');
    } else {
      if (stepInd) stepInd.textContent = '☁️';
      if (kickerEl) kickerEl.textContent = pack.acctKicker;
      if (progBar) progBar.style.width = '100%';
      progTrack?.classList.add('hidden');
      footerBar?.classList.add('hidden');
      btnSkip?.classList.add('hidden');
    }

    for (let i = 1; i <= TOTAL_ONBOARDING_STEPS; i++) {
      const pane = document.getElementById(`onbStep_${i}`);
      if (pane) pane.classList.toggle('hidden', !isStepsMode || i !== currentOnboardingStep);
      const dot = document.querySelector(`[data-onb-dot="${i}"]`);
      if (dot) {
        dot.style.height = '8px';
        dot.style.borderRadius = '9999px';
        dot.style.display = 'inline-block';
        dot.style.transition = 'all 0.2s ease';
        if (i === currentOnboardingStep) {
          dot.style.width = '22px';
          dot.style.backgroundColor = '#4f46e5';
        } else if (i < currentOnboardingStep) {
          dot.style.width = '8px';
          dot.style.backgroundColor = '#a5b4fc';
        } else {
          dot.style.width = '8px';
          dot.style.backgroundColor = '#cbd5e1';
        }
      }
    }

    document.getElementById('onbAccountSelectionPane')?.classList.toggle('hidden', !isSelectionMode);
    document.getElementById('onbAccountAuthPane')?.classList.toggle('hidden', !isAuthMode);

    const btnBack = document.getElementById('btnOnboardingBack');
    const btnNext = document.getElementById('btnOnboardingNext');
    const btnStart = document.getElementById('btnOnboardingStartApp');

    if (btnSkip) btnSkip.textContent = pack.skip;
    if (btnBack) {
      btnBack.textContent = pack.back;
      btnBack.classList.toggle('hidden', currentOnboardingStep === 1);
    }
    if (btnNext) {
      btnNext.textContent = pack.next;
      btnNext.classList.toggle('hidden', currentOnboardingStep === TOTAL_ONBOARDING_STEPS);
    }
    if (btnStart) {
      btnStart.textContent = pack.start;
      btnStart.classList.toggle('hidden', currentOnboardingStep !== TOTAL_ONBOARDING_STEPS);
    }

    // Localized onboarding & account selection copy
    const mapText = [
      ['onbS1Badge', pack.s1Badge],
      ['onbS1Title', pack.s1Title],
      ['onbS1Subtitle', pack.s1Sub],
      ['onbS2Badge', pack.s2Badge],
      ['onbS2Title', pack.s2Title],
      ['onbS2Subtitle', pack.s2Sub],
      ['onbS3Badge', pack.s3Badge],
      ['onbS3Title', pack.s3Title],
      ['onbS3Subtitle', pack.s3Sub],
      ['onbS4Badge', pack.s4Badge],
      ['onbS4Title', pack.s4Title],
      ['onbS4Subtitle', pack.s4Sub],
      ['onbS5Badge', pack.s5Badge],
      ['onbS5Title', pack.s5Title],
      ['onbS5Subtitle', pack.s5Sub],
      ['onbAcctSelTitle', pack.acctTitle],
      ['onbAcctSelSub', pack.acctSub],
      ['onbOptATitle', pack.optATitle],
      ['onbOptADesc', pack.optADesc],
      ['btnOnbChoiceCreateAccount', pack.optABtn],
      ['onbOptBTitle', pack.optBTitle],
      ['onbOptBDesc', pack.optBDesc],
      ['btnOnbChoiceLogin', pack.optBBtn],
      ['onbOptCTitle', pack.optCTitle],
      ['onbOptCDesc', pack.optCDesc],
      ['btnOnbChoiceContinueLocal', pack.optCBtn]
    ];
    for (const [id, val] of mapText) {
      const el = document.getElementById(id);
      if (el && val) el.textContent = val;
    }
    syncLanguagePillsAndBadges();
  }

  function openOnboardingModal(startAtStep = 1) {
    onboardingScreenMode = 'steps';
    currentOnboardingStep = Math.max(1, Math.min(TOTAL_ONBOARDING_STEPS, startAtStep));
    renderOnboardingStepUI();
    const modal = document.getElementById('onboardingOverlayModal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }
  }

  function openAccountSelectionScreen() {
    onboardingScreenMode = 'account_selection';
    renderOnboardingStepUI();
    const modal = document.getElementById('onboardingOverlayModal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }
  }

  function openFirstLaunchAuthScreen(mode = 'register') {
    onbAuthMode = mode === 'login' ? 'login' : 'register';
    onboardingScreenMode = 'account_auth';
    const fbEl = document.getElementById('onbAuthFeedbackBox');
    if (fbEl) {
      fbEl.className = 'hidden';
      fbEl.textContent = '';
    }
    applyCentralizedPcmI18nDOM();
    renderOnboardingStepUI();
    const modal = document.getElementById('onboardingOverlayModal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }
  }

  async function completeOrSkipOnboarding() {
    state.onboardingCompleted = true;
    try {
      safeStorageSet(ONBOARDING_STORAGE_KEY, 'true');
      safeStorageSet(SAVED_LANGUAGE_STORAGE_KEY, state.language || 'fr');
    } catch (e) {}
    const modal = document.getElementById('onboardingOverlayModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
    await saveState();
    goHomeScreen();
  }

  function bindOnboardingListeners() {
    document.getElementById('btnOnboardingBack')?.addEventListener('click', () => {
      if (currentOnboardingStep > 1) {
        currentOnboardingStep--;
        renderOnboardingStepUI();
      }
    });
    document.getElementById('btnOnboardingNext')?.addEventListener('click', () => {
      if (currentOnboardingStep < TOTAL_ONBOARDING_STEPS) {
        currentOnboardingStep++;
        renderOnboardingStepUI();
      }
    });
    // Skip from any onboarding step OR clicking Get Started on Step 5 opens the dedicated Account Selection Screen
    document.getElementById('btnOnboardingSkip')?.addEventListener('click', () => {
      openAccountSelectionScreen();
    });
    document.getElementById('btnOnboardingStartApp')?.addEventListener('click', () => {
      openAccountSelectionScreen();
    });

    // Account Selection Screen Choices (Option A / Option B / Option C)
    document.getElementById('btnOnbChoiceCreateAccount')?.addEventListener('click', () => {
      openFirstLaunchAuthScreen('register');
    });
    document.getElementById('btnOnbChoiceLogin')?.addEventListener('click', () => {
      openFirstLaunchAuthScreen('login');
    });
    document.getElementById('btnOnbChoiceContinueLocal')?.addEventListener('click', async () => {
      await completeOrSkipOnboarding();
      showToast(pcmT('msg_local_mode_toast'));
    });

    // Unified First-Launch Auth Screen Controls
    document.getElementById('btnOnbAuthBackToChoices')?.addEventListener('click', () => {
      openAccountSelectionScreen();
    });
    document.getElementById('btnOnbAuthSwitchMode')?.addEventListener('click', () => {
      openFirstLaunchAuthScreen(onbAuthMode === 'register' ? 'login' : 'register');
    });
    document.getElementById('btnOnbAuthSkipToLocal')?.addEventListener('click', async () => {
      await completeOrSkipOnboarding();
    });
    document.getElementById('btnSettingsOpenAccountEntry')?.addEventListener('click', () => {
      openAccountSelectionScreen();
    });

    document.getElementById('btnOnbAuthForgotPassword')?.addEventListener('click', async () => {
      const email = (document.getElementById('inputOnbAuthEmail')?.value || '').trim().toLowerCase();
      const fbEl = document.getElementById('onbAuthFeedbackBox');
      const showOnbFb = (msg, type) => {
        if (!fbEl) return;
        const cls =
          type === 'error'
            ? 'bg-rose-50 text-rose-800 border-rose-200'
            : 'bg-emerald-50 text-emerald-800 border-emerald-200';
        fbEl.className = `rounded-xl px-3.5 py-2.5 text-xs font-semibold border ${cls}`;
        fbEl.textContent = msg;
      };
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        showOnbFb(pcmT('msg_err_enter_email_reset'), 'error');
        return;
      }
      try {
        await cloudFetchJSON('/auth/v1/recover', { method: 'POST', body: { email } });
        showOnbFb(pcmT('msg_ok_reset_sent', { email }), 'success');
      } catch (err) {
        showOnbFb(err.message || 'Impossible d’envoyer le lien de réinitialisation.', 'error');
      }
    });

    document.getElementById('formOnbCloudAuth')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const email = (document.getElementById('inputOnbAuthEmail')?.value || '').trim().toLowerCase();
      const password = document.getElementById('inputOnbAuthPassword')?.value || '';
      const fbEl = document.getElementById('onbAuthFeedbackBox');
      const submitBtn = document.getElementById('btnOnbAuthSubmit');
      const showOnbFb = (msg, type) => {
        if (!fbEl) return;
        const cls =
          type === 'error'
            ? 'bg-rose-50 text-rose-800 border-rose-200'
            : type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-amber-50 text-amber-900 border-amber-200';
        fbEl.className = `rounded-xl px-3.5 py-2.5 text-xs font-semibold border ${cls}`;
        fbEl.textContent = msg;
      };

      if (Date.now() < cloudLoginLockoutUntil) {
        const waitSec = Math.ceil((cloudLoginLockoutUntil - Date.now()) / 1000);
        showOnbFb(pcmT('msg_err_lockout', { s: waitSec }), 'error');
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || password.length < 8) {
        showOnbFb(pcmT('msg_err_invalid_email_pw'), 'error');
        return;
      }

      if (submitBtn) submitBtn.disabled = true;
      showOnbFb(pcmT(onbAuthMode === 'register' ? 'msg_info_creating_acct' : 'msg_info_logging_in'), 'info');
      try {
        if (onbAuthMode === 'register') {
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
            document.getElementById('inputOnbAuthPassword').value = '';
            await completeOrSkipOnboarding();
            updateCloudSyncStatusUI('SYNCING');
            await performFullCloudSync({ isManual: false, allowMigrationPrompt: true });
            showToast(pcmT('msg_ok_acct_created_synced'));
          } else {
            showOnbFb(pcmT('msg_ok_acct_created_verify'), 'success');
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
          document.getElementById('inputOnbAuthPassword').value = '';
          await completeOrSkipOnboarding();
          updateCloudSyncStatusUI('SYNCING');
          await performFullCloudSync({ isManual: false, allowMigrationPrompt: true });
          showToast(pcmT('msg_ok_login_restoring'));
        }
      } catch (err) {
        if (err.code === 'INVALID_CREDENTIALS') {
          cloudLoginFailedCount++;
          if (cloudLoginFailedCount >= 5) cloudLoginLockoutUntil = Date.now() + 30000;
          showOnbFb(pcmT('msg_err_invalid_creds'), 'error');
        } else if (err.code === 'EMAIL_NOT_VERIFIED') {
          showOnbFb(pcmT('msg_err_email_not_verified'), 'error');
        } else {
          showOnbFb(err.message || pcmT('msg_err_generic_auth'), 'error');
        }
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });

    // Settings "Language & Help" buttons: Replay Onboarding, Open User Manual, Open FAQ
  }
  Object.assign(env, {
    ONBOARDING_STORAGE_KEY,
    SAVED_LANGUAGE_STORAGE_KEY,
    syncLanguagePillsAndBadges,
    setApplicationLanguageImmediate,
    renderOnboardingStepUI,
    openOnboardingModal,
    openAccountSelectionScreen,
    openFirstLaunchAuthScreen,
    completeOrSkipOnboarding,
    bindOnboardingListeners
  });
  Object.defineProperty(env, 'onbAuthMode', {
    get: () => onbAuthMode,
    set: (v) => {
      onbAuthMode = v;
    }
  });
}
