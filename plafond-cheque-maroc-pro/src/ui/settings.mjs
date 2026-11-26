/** PlafondChèque Maroc Pro — 4-Category Settings Hub, Subpages, i18n Runtime & Manual/FAQ */
import { PCM_I18N } from '../i18n/translations.mjs';
import { I18N } from '../i18n/legacyUiDict.mjs';

export function registerSettingsUi(env) {
  const {
    state,
    showToast,
    saveState,
    safeStorageGet,
    safeStorageSet,
    renderKPIsAndAllViews,
    openOnboardingModal,
    renderNotificationSettingsUI,
    getStoredCloudSession,
    updateCloudSyncStatusUI
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
  function t(key) {
    return (I18N[state.language] && I18N[state.language][key]) || (I18N.fr && I18N.fr[key]) || key;
  }
  function renderBuiltInManualAndFaq() {
    const lang = state.language || 'fr';
    const manualBody = document.getElementById('userManualModalBody');
    const faqBody = document.getElementById('faqModalBody');
    const manualTitle = document.getElementById('manualModalTitle');
    const faqTitle = document.getElementById('faqModalTitle');

    if (manualBody) {
      if (lang === 'ar') {
        if (manualTitle) manualTitle.textContent = 'دليل المستخدم الكامل — PlafondChèque Maroc Pro (الإصدار 10.0)';
        manualBody.innerHTML = `
            <div class="space-y-4" dir="rtl">
              <div class="p-4 rounded-2xl bg-indigo-50 border border-indigo-200">
                <h4 class="font-extrabold text-indigo-950 text-base">1. مقدمة وهدف التطبيق</h4>
                <p class="mt-1">يساعدك <strong>PlafondChèque Maroc Pro</strong> على تتبع الشيكات والكمبيالات (LCN) ومراقبة السقف المالي اليومي بالدرهم المغربي (DH) مع احترام أيام العمل البنكية والعطل الرسمية في المغرب.</p>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <h5 class="font-bold text-slate-900">2. الشاشة الرئيسية (5 أيقونات)</h5>
                  <p class="text-xs mt-1">تضم الشاشة الرئيسية 5 أقسام واضحة: <strong>إضافة شيك (Saisir)</strong>، <strong>التقويم (Calendrier)</strong>، <strong>الشيكات (Chèques)</strong>، <strong>لوحة القيادة (Tableau)</strong>، و<strong>التقارير (Rapports)</strong>، مع زر الإعدادات (⚙️) في الأعلى.</p>
                </div>
                <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <h5 class="font-bold text-slate-900">3. إضافة شيك وتقسيم المبلغ</h5>
                  <p class="text-xs mt-1">أدخل المبلغ بالدرهم واختر الأجل (7 إلى 60 يوماً). إذا تجاوز المبلغ السقف اليومي، يقوم التطبيق بتوزيعه تلقائياً على أيام العمل المتاحة مع كتابة المبلغ بالحروف بالفرنسية والعربية.</p>
                </div>
                <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <h5 class="font-bold text-slate-900">4. ألوان التقويم البنكي</h5>
                  <p class="text-xs mt-1">🟢 أخضر: يوم متاح · 🟡 أصفر: مستعمل جزئياً · 🔴 أحمر: السقف مكتمل (100%) · ⚪ رمادي: عطلة نهاية الأسبوع أو يوم عطلة رسمية في المغرب.</p>
                </div>
                <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <h5 class="font-bold text-slate-900">5. الأمان، النسخ الاحتياطي والإشعارات</h5>
                  <p class="text-xs mt-1">فعّل رمز PIN من 4 أرقام (PBKDF2-SHA256)، واستخدم النسخ الاحتياطي المشفر (AES-256-GCM)، وفعّل إشعارات النظام للتذكير قبل 3 أيام ويوم واحد ويوم الاستحقاق.</p>
                </div>
              </div>
            </div>
          `;
      } else if (lang === 'en') {
        if (manualTitle) manualTitle.textContent = 'Complete User Manual — PlafondChèque Maroc Pro (v10.0)';
        manualBody.innerHTML = `
            <div class="space-y-4">
              <div class="p-4 rounded-2xl bg-indigo-50 border border-indigo-200">
                <h4 class="font-extrabold text-indigo-950 text-base">1. Introduction & Purpose</h4>
                <p class="mt-1"><strong>PlafondChèque Maroc Pro</strong> helps Moroccan businesses, accountants, and managers track issued/received cheques and enforce daily financial ceilings in Moroccan Dirhams (DH) while respecting Moroccan working days and holidays.</p>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <h5 class="font-bold text-slate-900">2. 5-Icon Home Screen & Dashboard</h5>
                  <p class="text-xs mt-1">Navigate effortlessly across <strong>New Cheque (Saisir)</strong>, <strong>Calendar</strong>, <strong>Cheques</strong>, <strong>Dashboard</strong>, and <strong>Reports</strong>, with the top-left Back arrow (←) and top-right Settings button (⚙️).</p>
                </div>
                <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <h5 class="font-bold text-slate-900">3. Adding & Photographing Cheques</h5>
                  <p class="text-xs mt-1">Enter the amount in DH, select the payment term (7d–60d), and optionally attach, rotate (↻), or crop (✂️) a cheque photograph. Amounts exceeding your daily ceiling are split across working days.</p>
                </div>
                <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <h5 class="font-bold text-slate-900">4. Smart Calendar Indicators</h5>
                  <p class="text-xs mt-1">🟢 Green: Available capacity · 🟡 Yellow: Partially used · 🔴 Red: Daily ceiling reached (100%) · ⚪ Grey: Closed weekend or Moroccan holiday.</p>
                </div>
                <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <h5 class="font-bold text-slate-900">5. PIN Security, Backups & Notifications</h5>
                  <p class="text-xs mt-1">Protect access with a 4-digit PIN (PBKDF2-SHA256), export SHA-256 verified or AES-256-GCM encrypted backups, and enable opt-in OS reminders (J-3, J-1, Due Date, 80%/100% ceiling).</p>
                </div>
              </div>
            </div>
          `;
      } else {
        if (manualTitle) manualTitle.textContent = 'Guide Utilisateur Complet — PlafondChèque Maroc Pro (v10.0)';
        manualBody.innerHTML = `
            <div class="space-y-4">
              <div class="p-4 rounded-2xl bg-indigo-50 border border-indigo-200">
                <h4 class="font-extrabold text-indigo-950 text-base">1. Introduction & Présentation Générale</h4>
                <p class="mt-1"><strong>PlafondChèque Maroc Pro</strong> permet aux entreprises, commerçants, comptables et gestionnaires au Maroc de suivre leurs chèques et plafonds journaliers en dirhams (DH) tout en respectant automatiquement les jours ouvrables et jours fériés marocains.</p>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <h5 class="font-bold text-slate-900">2. Premiers Pas & Écran d’Accueil (5 Icônes)</h5>
                  <p class="text-xs mt-1">L’écran d’accueil regroupe 5 boutons directs : <strong>Saisir</strong>, <strong>Calendrier</strong>, <strong>Chèques</strong>, <strong>Tableau</strong> et <strong>Rapports</strong>. Utilisez la flèche <strong>← Retour</strong> en haut à gauche pour revenir à l’accueil et l’icône <strong>⚙️</strong> en haut à droite pour ouvrir les Paramètres.</p>
                </div>
                <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <h5 class="font-bold text-slate-900">3. Saisie d’un Chèque & Photo</h5>
                  <p class="text-xs mt-1">Renseignez le bénéficiaire, la banque, le montant en DH et l’échéance (7j à 60j). Joignez une photo depuis la caméra ou la galerie avec rotation 90° (↻) et recadrage au format chèque (✂️).</p>
                </div>
                <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <h5 class="font-bold text-slate-900">4. Calendrier Mensuel Interactif & Détails du Jour</h5>
                  <p class="text-xs mt-1">Cliquez sur n’importe quelle date pour voir ses chèques programmés, ouvrir un chèque, ajouter un chèque pour cette date (+), copier le résumé journalier (📋) ou revenir à <strong>Aujourd’hui</strong>.</p>
                </div>
                <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <h5 class="font-bold text-slate-900">5. Sécurité PIN, Sauvegardes & Notifications</h5>
                  <p class="text-xs mt-1">Configurez un code PIN à 4 chiffres (PBKDF2-SHA256), exportez vos sauvegardes JSON ou chiffrées AES-256-GCM, et activez les rappels système (J-3, J-1, Jour J, 80%, 100%, retards).</p>
                </div>
              </div>
            </div>
          `;
      }
    }

    if (faqBody) {
      if (lang === 'ar') {
        if (faqTitle) faqTitle.textContent = 'الأسئلة الشائعة (FAQ) وإصلاح المشاكل';
        faqBody.innerHTML = `
            <div class="space-y-3" dir="rtl">
              <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <div class="font-bold text-slate-900">س: ماذا يحدث إذا وقع تاريخ الاستحقاق يوم سبت أو أحد أو عيد وطني؟</div>
                <div class="text-xs text-slate-600 mt-1">ج: يقوم التطبيق تلقائياً بتقديم تاريخ الاستحقاق إلى أقرب يوم عمل بنكي سابق (J-1 ouvré) لضمان عدم وقوع الشيك في يوم مغلق.</div>
              </div>
              <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <div class="font-bold text-slate-900">س: هل تظهر مبالغ الشيكات وأسماء المستفيدين في الإشعارات؟</div>
                <div class="text-xs text-slate-600 mt-1">ج: لا، حفاظاً على الخصوصية يتم إخفاء المبالغ والأسماء افتراضياً في الإشعارات، ولا تظهر إلا إذا قمت بتفعيل خيار إظهار التفاصيل المالية من الإعدادات.</div>
              </div>
              <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <div class="font-bold text-slate-900">س: ماذا أفعل إذا لم تظهر بياناتي أو أردت نقلها لهاتف آخر؟</div>
                <div class="text-xs text-slate-600 mt-1">ج: افتح الإعدادات (⚙️) واستخدم زر <strong>تصدير نسخة احتياطية (JSON أو AES-256)</strong> ثم استرجعها على جهازك الجديد.</div>
              </div>
            </div>
          `;
      } else if (lang === 'en') {
        if (faqTitle) faqTitle.textContent = 'Frequently Asked Questions (FAQ) & Troubleshooting';
        faqBody.innerHTML = `
            <div class="space-y-3">
              <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <div class="font-bold text-slate-900">Q: What happens if a cheque due date lands on a weekend or Moroccan holiday?</div>
                <div class="text-xs text-slate-600 mt-1">A: The application automatically shifts the target date to the preceding Moroccan banking business day so your schedule remains compliant.</div>
              </div>
              <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <div class="font-bold text-slate-900">Q: Are sensitive cheque amounts shown on lock-screen notifications?</div>
                <div class="text-xs text-slate-600 mt-1">A: No. By default, notifications mask all DH amounts, beneficiary names, and cheque numbers unless you explicitly enable sensitive details in Settings.</div>
              </div>
              <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <div class="font-bold text-slate-900">Q: How do I back up or restore my records on a new phone or computer?</div>
                <div class="text-xs text-slate-600 mt-1">A: Open Settings (⚙️), export a standard JSON backup (verified by SHA-256 checksum) or an AES-256-GCM encrypted backup, and import it on your new device.</div>
              </div>
            </div>
          `;
      } else {
        if (faqTitle) faqTitle.textContent = 'Foire Aux Questions (FAQ) & Dépannage';
        faqBody.innerHTML = `
            <div class="space-y-3">
              <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <div class="font-bold text-slate-900">Q : Que se passe-t-il si l’échéance d’un chèque tombe un samedi, dimanche ou jour férié marocain ?</div>
                <div class="text-xs text-slate-600 mt-1">R : L’application anticipe automatiquement la date au jour ouvrable bancaire précédent (J-1 ouvré) et explique le décalage dans l’aperçu.</div>
              </div>
              <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <div class="font-bold text-slate-900">Q : Les montants en DH et les noms des bénéficiaires apparaissent-ils dans les notifications ?</div>
                <div class="text-xs text-slate-600 mt-1">R : Non. Par défaut, les informations financières sensibles sont masquées dans les notifications système, sauf si vous activez explicitement l’option dans Paramètres.</div>
              </div>
              <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <div class="font-bold text-slate-900">Q : Que faire si une photo ne se joint pas ou si je souhaite restaurer une sauvegarde ?</div>
                <div class="text-xs text-slate-600 mt-1">R : Utilisez le bouton Galerie Photo si l’accès caméra est refusé par le navigateur, et utilisez le bouton « Restaurer une Sauvegarde JSON » dans Paramètres (⚙️) pour récupérer vos données.</div>
              </div>
            </div>
          `;
      }
    }
  }

  window.PCM_I18N = PCM_I18N;
  window._pcmMissingTranslationKeys = [];

  function pcmT(key, params = {}) {
    const lang = ['en', 'ar', 'fr'].includes(state.language) ? state.language : 'fr';
    const dict = PCM_I18N[lang];
    if (!dict || typeof dict[key] !== 'string' || dict[key].length === 0) {
      const missId = `${lang}.${key}`;
      if (!window._pcmMissingTranslationKeys.includes(missId)) {
        window._pcmMissingTranslationKeys.push(missId);
      }
      return `[MISSING:${missId}]`;
    }
    return dict[key].replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? String(params[k]) : `{${k}}`));
  }

  window.PCM_I18N_AUDIT = function auditPcmTranslations() {
    const langs = ['en', 'ar', 'fr'];
    const allKeys = new Set();
    langs.forEach((l) => Object.keys(PCM_I18N[l] || {}).forEach((k) => allKeys.add(k)));
    const missing = [];
    langs.forEach((l) => {
      const d = PCM_I18N[l] || {};
      allKeys.forEach((k) => {
        if (typeof d[k] !== 'string' || d[k].trim().length === 0) missing.push(`${l}.${k}`);
      });
    });
    return {
      ok: missing.length === 0 && window._pcmMissingTranslationKeys.length === 0,
      totalKeysPerLanguage: allKeys.size,
      languagesChecked: langs,
      missing,
      runtimeMissing: [...window._pcmMissingTranslationKeys]
    };
  };

  function applyCentralizedPcmI18nDOM() {
    document.querySelectorAll('[data-pcm-i18n]').forEach((el) => {
      const key = el.getAttribute('data-pcm-i18n');
      if (key) el.textContent = pcmT(key);
    });
    document.querySelectorAll('[data-pcm-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-pcm-placeholder');
      if (key) el.setAttribute('placeholder', pcmT(key));
    });
    // Keep Settings auth submit button synchronized with active language & tab mode
    const settingsSubmit = document.getElementById('btnCloudAuthSubmit');
    if (settingsSubmit) {
      settingsSubmit.textContent = pcmT(
        env.cloudAuthMode === 'register' ? 'auth_btn_submit_register' : 'auth_btn_submit_login'
      );
    }
    // Keep First-Launch Auth screen texts synchronized when open
    const onbTitle = document.getElementById('onbAuthFormTitle');
    const onbSub = document.getElementById('onbAuthFormSubtitle');
    const onbSubmit = document.getElementById('btnOnbAuthSubmit');
    const onbSwitch = document.getElementById('btnOnbAuthSwitchMode');
    if (onbTitle)
      onbTitle.textContent = pcmT(env.onbAuthMode === 'register' ? 'auth_title_register' : 'auth_title_login');
    if (onbSub) onbSub.textContent = pcmT(env.onbAuthMode === 'register' ? 'auth_sub_register' : 'auth_sub_login');
    if (onbSubmit)
      onbSubmit.textContent = pcmT(
        env.onbAuthMode === 'register' ? 'auth_btn_submit_register' : 'auth_btn_submit_login'
      );
    if (onbSwitch)
      onbSwitch.textContent = pcmT(env.onbAuthMode === 'register' ? 'auth_switch_to_login' : 'auth_switch_to_register');
    // Keep password toggle aria-label localized
    const pwInput = document.getElementById('inputOnbAuthPassword');
    const pwToggle = document.getElementById('btnToggleOnbAuthPassword');
    if (pwInput && pwToggle) {
      pwToggle.setAttribute('aria-label', pcmT(pwInput.type === 'password' ? 'auth_show_pw' : 'auth_hide_pw'));
    }
    if (typeof bindSettingsHubNavigation === 'function') bindSettingsHubNavigation();
    if (typeof updateCloudSyncStatusUI === 'function') updateCloudSyncStatusUI();
    if (typeof updateHonestStorageStatusUI === 'function') updateHonestStorageStatusUI();
    if (typeof syncThemeCardsUI === 'function') syncThemeCardsUI();
  }

  // =========================================================================
  // V12.2.0 REAL GOOGLE OAUTH (SUPABASE AUTH PKCE S256 + ACCOUNT LINKING)
  // =========================================================================
  let activeSettingsSubpage = null; // null (hub) | 'account' | 'appearance' | 'security' | 'help'

  function syncThemeCardsUI() {
    const isDark = document.documentElement.classList.contains('dark');
    const lightBtn = document.getElementById('btnSettingsThemeLight');
    const darkBtn = document.getElementById('btnSettingsThemeDark');
    if (lightBtn) lightBtn.classList.toggle('active-theme', !isDark);
    if (darkBtn) darkBtn.classList.toggle('active-theme', isDark);
  }

  function updateHonestStorageStatusUI() {
    const statusEl = document.getElementById('lblHonestStorageStatus');
    const hubChip = document.getElementById('lblHubAccountStatusChip');
    const session = typeof getStoredCloudSession === 'function' ? getStoredCloudSession() : null;
    const st = state.cloudSync?.status || 'SIGNED_OUT';
    let key = 'set_backup_status_local';
    let chipKey = 'cloud_status_local_only';
    if (session) {
      if (st === 'OFFLINE_PENDING') {
        key = 'set_backup_status_offline';
        chipKey = 'cloud_status_offline_pending';
      } else {
        key = 'set_backup_status_synced';
        chipKey = 'cloud_status_synced';
      }
    }
    if (statusEl) {
      statusEl.setAttribute('data-pcm-i18n', key);
      statusEl.textContent = pcmT(key);
    }
    if (hubChip) {
      hubChip.setAttribute('data-pcm-i18n', chipKey);
      hubChip.textContent = pcmT(chipKey);
    }
  }

  function showSettingsLandingHub({ pushHistory = false } = {}) {
    activeSettingsSubpage = null;
    document.getElementById('settingsLandingHub')?.classList.remove('hidden');
    document.getElementById('settingsSubpageTopBar')?.classList.add('hidden');
    ['settingsSubpageAccount', 'settingsSubpageAppearance', 'settingsSubpageSecurity', 'settingsSubpageHelp'].forEach(
      (id) => {
        document.getElementById(id)?.classList.add('hidden');
      }
    );
    updateHonestStorageStatusUI();
    if (pushHistory && window.history && window.history.pushState) {
      try {
        window.history.pushState({ settingsSubpage: null }, '');
      } catch (_) {}
    }
  }

  function openSettingsSubpage(cat, { pushHistory = true } = {}) {
    const map = {
      account: { id: 'settingsSubpageAccount', titleKey: 'set_cat_account_title' },
      appearance: { id: 'settingsSubpageAppearance', titleKey: 'set_cat_appearance_title' },
      security: { id: 'settingsSubpageSecurity', titleKey: 'set_cat_security_title' },
      help: { id: 'settingsSubpageHelp', titleKey: 'set_cat_help_title' }
    };
    const target = map[cat];
    if (!target) {
      showSettingsLandingHub();
      return;
    }
    activeSettingsSubpage = cat;
    document.getElementById('settingsLandingHub')?.classList.add('hidden');
    document.getElementById('settingsSubpageTopBar')?.classList.remove('hidden');
    const titleEl = document.getElementById('lblSettingsActiveSubpageTitle');
    if (titleEl) {
      titleEl.setAttribute('data-pcm-i18n', target.titleKey);
      titleEl.textContent = pcmT(target.titleKey);
    }
    ['settingsSubpageAccount', 'settingsSubpageAppearance', 'settingsSubpageSecurity', 'settingsSubpageHelp'].forEach(
      (id) => {
        document.getElementById(id)?.classList.toggle('hidden', id !== target.id);
      }
    );
    syncThemeCardsUI();
    updateHonestStorageStatusUI();
    if (pushHistory && window.history && window.history.pushState) {
      try {
        window.history.pushState({ settingsSubpage: cat }, '');
      } catch (_) {}
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  window.openSettingsSubpage = openSettingsSubpage;
  window.showSettingsLandingHub = showSettingsLandingHub;

  function bindSettingsHubNavigation() {
    if (window._pcmSettingsHubBound) return;
    window._pcmSettingsHubBound = true;

    document.querySelectorAll('[data-settings-cat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        openSettingsSubpage(btn.getAttribute('data-settings-cat'));
      });
    });

    document.getElementById('btnSettingsBackToHub')?.addEventListener('click', () => {
      showSettingsLandingHub({ pushHistory: false });
    });

    // Browser / Android hardware back button returns cleanly from a Settings subpage to the Settings Hub
    window.addEventListener('popstate', (ev) => {
      if (!document.getElementById('tab-parametres')?.classList.contains('hidden')) {
        const stCat = ev.state && ev.state.settingsSubpage ? ev.state.settingsSubpage : null;
        if (stCat) openSettingsSubpage(stCat, { pushHistory: false });
        else showSettingsLandingHub({ pushHistory: false });
      }
    });

    // Unified Light / Dark Theme Cards synced with header dark mode shortcut
    const applyThemeMode = (wantDark) => {
      state.darkMode = Boolean(wantDark);
      document.documentElement.classList.toggle('dark', state.darkMode);
      document.documentElement.classList.toggle('dark', state.darkMode);
      document.body.classList.toggle('dark-mode', state.darkMode);
      if (typeof syncThemeCardsUI === 'function') syncThemeCardsUI();
      syncThemeCardsUI();
      saveState();
    };
    document.getElementById('btnSettingsThemeLight')?.addEventListener('click', () => applyThemeMode(false));
    document.getElementById('btnSettingsThemeDark')?.addEventListener('click', () => applyThemeMode(true));
    document.getElementById('btnTogglePinForm')?.addEventListener('click', () => {
      document.getElementById('pinEditFormContainer')?.classList.toggle('hidden');
    });

    // Developer-only backend config unlock: either ?dev=1 query param or 5 rapid taps on version badge
    if (new URLSearchParams(window.location.search).get('dev') === '1') {
      document.getElementById('cloudBackendConfigDetails')?.classList.remove('hidden');
    }
    let devTapCount = 0;
    document.getElementById('lblAppVersionBadge')?.addEventListener('click', () => {
      devTapCount++;
      if (devTapCount >= 5) {
        document.getElementById('cloudBackendConfigDetails')?.classList.remove('hidden');
        showToast('Developer backend configuration unlocked in Account & Cloud Backup');
        devTapCount = 0;
      }
    });
  }

  function applyLanguageUI() {
    const langPack = I18N[state.language] || I18N.fr;
    document.documentElement.setAttribute('lang', state.language);
    document.documentElement.setAttribute('dir', langPack.dir);
    const sel = document.getElementById('selectAppLanguage');
    if (sel) sel.value = state.language;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (langPack[key]) el.textContent = langPack[key];
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (langPack[key]) el.setAttribute('placeholder', langPack[key]);
    });

    // Translate key static headings & buttons across all 5 main sections
    const domTranslations = [
      ['btnHomeQuickEditPlafond', 'btn_modify'],
      ['btnEditPlafond', 'btn_modify'],
      ['formOperationHeading', 'form_add_title'],
      ['lblBtnSubmitOperation', 'btn_save_cheque_main'],
      ['btnCancelEditOperation', 'btn_cancel_edit'],
      ['btnCreateSingleCheque', 'btn_new_single_cheque'],
      ['btnPrintChequesTab', 'btn_print_all_cheques'],
      ['btnResetChequeFilters', 'btn_reset_filters'],
      ['btnCalPrevMonth', 'cal_prev'],
      ['btnCalNextMonth', 'cal_next']
    ];
    for (const [id, k] of domTranslations) {
      const el = document.getElementById(id);
      if (el && langPack[k]) el.textContent = langPack[k];
    }
    renderNotificationSettingsUI();
    if (!window._pcmV10ListenersBound) {
      window._pcmV10ListenersBound = true;
      env.bindNotificationListeners();
      env.bindOnboardingListeners();
      document.getElementById('btnReplayOnboarding')?.addEventListener('click', () => {
        openOnboardingModal(1);
      });
      document.getElementById('btnOpenUserManualModal')?.addEventListener('click', () => {
        renderBuiltInManualAndFaq();
        const m = document.getElementById('userManualModal');
        m?.classList.remove('hidden');
        m?.classList.add('flex');
      });
      document.getElementById('btnCloseUserManualModal')?.addEventListener('click', () => {
        const m = document.getElementById('userManualModal');
        m?.classList.add('hidden');
        m?.classList.remove('flex');
      });
      document.getElementById('btnOpenFaqModal')?.addEventListener('click', () => {
        renderBuiltInManualAndFaq();
        const m = document.getElementById('faqModal');
        m?.classList.remove('hidden');
        m?.classList.add('flex');
      });
      document.getElementById('btnCloseFaqModal')?.addEventListener('click', () => {
        const m = document.getElementById('faqModal');
        m?.classList.add('hidden');
        m?.classList.remove('flex');
      });

      // Smart First-Launch Detection:
      // - If existing user already has financial records (state.operations.length > 0), preserve their data & do NOT treat update as new install.
      // - Otherwise, if onboarding has never been completed, launch the 6-step interactive onboarding!
      const hasCompletedFlag =
        Boolean(state.onboardingCompleted) || safeStorageGet(env.ONBOARDING_STORAGE_KEY) === 'true';
      const hasExistingSession = Boolean(getStoredCloudSession());
      if (state.operations.length > 0 || hasExistingSession) {
        state.onboardingCompleted = true;
        try {
          safeStorageSet(env.ONBOARDING_STORAGE_KEY, 'true');
        } catch (e) {}
      } else if (hasCompletedFlag) {
        state.onboardingCompleted = true;
      } else {
        openOnboardingModal(1);
      }
    } // end _pcmV10ListenersBound

    renderKPIsAndAllViews();
    env.initCloudAccountUIAndListeners();
  }

  Object.assign(env, {
    t,
    pcmT,
    applyCentralizedPcmI18nDOM,
    syncThemeCardsUI,
    updateHonestStorageStatusUI,
    showSettingsLandingHub,
    openSettingsSubpage,
    bindSettingsHubNavigation,
    renderBuiltInManualAndFaq,
    applyLanguageUI
  });
}
