/**
 * PlafondChèque Maroc Pro — Notifications UI & OS/Capacitor Bridge
 * Directly imports and executes src/notifications/notifier.mjs (zero inline duplication).
 */
import {
  computeNotificationIdInt,
  adjustReminderDateToWorkingDay,
  combineDateAndTime,
  buildLocalizedNotificationCopy,
  buildNotificationPlan,
  detectNotificationPlatform,
  getHonestPlatformNotificationNote,
  getPermissionDeniedFallbackMessage,
  computeDueAndOverdueSummary,
  pruneStaleSentNotificationsRegistry
} from './notifier.mjs';

export function registerNotificationsUi(env) {
  const { state } = env;
  const showToast = (...a) => env.showToast(...a);
  const saveState = (...a) => env.saveState(...a);
  const escapeHtml = (...a) => env.escapeHtml(...a);
  const switchTab = (...a) => env.switchTab(...a);
  const selectCalendarDateAndShowDetails = (...a) => env.selectCalendarDateAndShowDetails(...a);
  const quickAddChequeForSelectedDate = (...a) => env.quickAddChequeForSelectedDate(...a);
  const openChequeEditModal = (...a) => env.openChequeEditModal(...a);
  const syncLanguagePillsAndBadges = (...a) => env.syncLanguagePillsAndBadges(...a);
  const setApplicationLanguageImmediate = (...a) => env.setApplicationLanguageImmediate(...a);
  const renderBuiltInManualAndFaq = (...a) => env.renderBuiltInManualAndFaq(...a);
  const renderOnboardingStepUI = (...a) => env.renderOnboardingStepUI(...a);
  const safeStorageGet = (...a) => env.safeStorageGet(...a);
  const safeStorageSet = (...a) => env.safeStorageSet(...a);
  const applyCentralizedPcmI18nDOM = (...a) => env.applyCentralizedPcmI18nDOM(...a);

  function computeActiveNotificationPlan() {
    const plan = buildNotificationPlan({
      operations: state.operations,
      plafondJournalier: state.plafondJournalier,
      holidays: state.holidays,
      notificationSettings: state.notificationSettings,
      language: state.language || 'fr',
      todayYMD: env.getTodayYMD()
    });
    state.notificationSettings.sentRegistry = pruneStaleSentNotificationsRegistry(
      plan.updatedSentRegistry || state.notificationSettings.sentRegistry || {},
      state.operations,
      state.plafondJournalier
    );
    return plan;
  }

  function getCapacitorLocalNotificationsPlugin() {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications
      ? window.Capacitor.Plugins.LocalNotifications
      : null;
  }

  async function requestRealOSNotificationPermission() {
    const capPlugin = getCapacitorLocalNotificationsPlugin();
    if (capPlugin) {
      try {
        const perm = await capPlugin.requestPermissions();
        const granted = perm && perm.display === 'granted';
        state.notificationSettings.permissionStatus = granted ? 'granted' : 'denied';
        return granted;
      } catch (e) {}
    }
    if ('Notification' in window) {
      try {
        const res = await window.Notification.requestPermission();
        state.notificationSettings.permissionStatus = res;
        return res === 'granted';
      } catch (e) {}
    }
    return false;
  }

  async function dispatchImmediateOSNotification(notifItem) {
    if (!notifItem) return false;
    const capPlugin = getCapacitorLocalNotificationsPlugin();
    if (capPlugin) {
      try {
        await capPlugin.schedule({
          notifications: [
            {
              id: notifItem.id || computeNotificationIdInt(notifItem.eventKey || String(Date.now())),
              title: notifItem.title,
              body: notifItem.body,
              schedule: { at: new Date(Date.now() + 800), allowWhileIdle: true },
              extra: notifItem.extra || {}
            }
          ]
        });
        return true;
      } catch (e) {}
    }

    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg && typeof reg.showNotification === 'function') {
          await reg.showNotification(notifItem.title, {
            body: notifItem.body,
            tag: notifItem.eventKey || 'os_notif_' + Date.now(),
            renotify: false,
            data: notifItem.extra || {}
          });
          return true;
        }
      } catch (e) {}
    }

    if ('Notification' in window && window.Notification.permission === 'granted') {
      try {
        const n = new window.Notification(notifItem.title, {
          body: notifItem.body,
          tag: notifItem.eventKey || 'os_notif_' + Date.now(),
          data: notifItem.extra || {}
        });
        n.onclick = () => {
          window.focus();
          handleNotificationDeepLink(notifItem.extra || {});
          n.close();
        };
        return true;
      } catch (e) {}
    }
    return false;
  }

  async function syncAndScheduleSystemNotifications(fireImmediateAlerts = true) {
    const cfg = state.notificationSettings || {};
    applyCentralizedPcmI18nDOM();
    renderNotificationSettingsUI();
    if (!cfg.enabled || cfg.permissionStatus !== 'granted') return;

    const plan = computeActiveNotificationPlan();

    // 1. Native Android/iOS Capacitor LocalNotifications Scheduling
    const capPlugin = getCapacitorLocalNotificationsPlugin();
    if (capPlugin) {
      try {
        const pending = await capPlugin.getPending();
        if (pending && Array.isArray(pending.notifications) && pending.notifications.length > 0) {
          await capPlugin.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
        }
        const futureNative = plan.notificationsToSchedule.map((item) => {
          const schedMs = Math.max(Date.now() + 1500, new Date(item.scheduledAtISO).getTime());
          return {
            id: item.id,
            title: item.title,
            body: item.body,
            schedule: { at: new Date(schedMs), allowWhileIdle: true },
            extra: item.extra || {}
          };
        });
        if (futureNative.length > 0) {
          await capPlugin.schedule({ notifications: futureNative });
        }
      } catch (e) {}
    }

    // 2. PWA Service Worker Queue Sync
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      try {
        navigator.serviceWorker.controller.postMessage({
          type: 'SYNC_SCHEDULED_NOTIFICATIONS',
          notifications: plan.notificationsToSchedule
        });
      } catch (e) {}
    }

    // 3. Fire immediate alerts (e.g., 80% / 100% ceiling reached, overdue cheque, or today's due cheque) and mark deduplicated
    if (fireImmediateAlerts && plan.immediateAlerts.length > 0) {
      for (const alertItem of plan.immediateAlerts) {
        if (state.sentNotificationsRegistry[alertItem.eventKey]) continue;
        const delivered = await dispatchImmediateOSNotification(alertItem);
        if (delivered) {
          state.sentNotificationsRegistry[alertItem.eventKey] = new Date().toISOString();
        }
      }
      await saveState();
    }

    renderNotificationSettingsUI();
  }

  function handleNotificationDeepLink(extra) {
    if (!extra || typeof extra !== 'object') return;
    if (extra.targetType === 'cheque') {
      switchTab('tab-cheques');
      const filterInput = document.getElementById('filterChequeQuery');
      if (filterInput && extra.numCheque) {
        filterInput.value = extra.numCheque;
        renderFilteredChequesTab();
      }
      setTimeout(() => {
        const cards = document.querySelectorAll('#allChequesCardsContainer > div');
        if (cards.length > 0) {
          cards[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
          cards[0].classList.add('ring-4', 'ring-indigo-500');
          setTimeout(() => cards[0].classList.remove('ring-4', 'ring-indigo-500'), 4000);
        }
      }, 120);
    } else if (extra.targetType === 'calendar' && extra.date) {
      const parts = String(extra.date).split('-').map(Number);
      if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        state.calendarViewYear = parts[0];
        state.calendarViewMonth = parts[1] - 1;
      }
      switchTab('tab-planning');
      renderKPIsAndAllViews();
      setTimeout(() => {
        const dayEl =
          document.querySelector(`[data-planning-date="${extra.date}"]`) ||
          document.querySelector(`[data-cal-date="${extra.date}"]`);
        if (dayEl) {
          dayEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          dayEl.classList.add('ring-4', 'ring-indigo-600');
          setTimeout(() => dayEl.classList.remove('ring-4', 'ring-indigo-600'), 4000);
        }
      }, 120);
    }
  }

  function updateInAppDueOverdueBanner() {
    if (typeof document === 'undefined') return;
    const bannerEl = document.getElementById('inAppDueOverdueBanner');
    const textEl = document.getElementById('lblInAppDueOverdueText');
    if (!bannerEl || !textEl) return;
    const summary = computeDueAndOverdueSummary(state.operations || [], getTodayYMD(), {
      includeSensitiveDetails: Boolean(state.notificationSettings?.includeSensitiveDetails),
      lang: state.language || 'fr'
    });
    if (!summary.hasAlerts) {
      bannerEl.classList.add('hidden');
      textEl.textContent = '';
      return;
    }
    textEl.textContent = summary.bannerText;
    bannerEl.classList.remove('hidden');
  }

  function renderNotificationSettingsUI() {
    const cfg = state.notificationSettings || {};
    const masterChk = document.getElementById('chkEnableSystemNotifications');
    if (masterChk) masterChk.checked = Boolean(cfg.enabled);

    const mapChk = [
      ['chkNotif3Days', 'notify3DaysBefore'],
      ['chkNotif1Day', 'notify1DayBefore'],
      ['chkNotifDueDate', 'notifyOnDueDate'],
      ['chkNotifCeiling80', 'notifyCeiling80'],
      ['chkNotifCeiling100', 'notifyCeiling100'],
      ['chkNotifOverdue', 'notifyOverdue'],
      ['chkNotifRespectWorkingDays', 'respectWorkingDaysForReminders'],
      ['chkNotifIncludeSensitive', 'includeSensitiveDetails']
    ];
    for (const [id, key] of mapChk) {
      const el = document.getElementById(id);
      if (el) el.checked = Boolean(cfg[key]);
    }

    const timeEl = document.getElementById('inputNotifReminderTime');
    if (timeEl && cfg.reminderTime) timeEl.value = cfg.reminderTime;

    const badgeEl = document.getElementById('badgeNotifPermissionStatus');
    if (badgeEl) {
      if (cfg.enabled && cfg.permissionStatus === 'granted') {
        badgeEl.className =
          'px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-300';
        badgeEl.textContent = '✓ Notifications Système Actives (OS Autorisé)';
      } else if (cfg.permissionStatus === 'denied') {
        badgeEl.className =
          'px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-rose-100 text-rose-800 border border-rose-300';
        badgeEl.textContent = '✕ Permission Refusée dans le navigateur/OS';
        const platNoteEl = document.getElementById('lblNotifPlatformHonesty');
        if (platNoteEl) platNoteEl.textContent = getPermissionDeniedFallbackMessage(state.language || 'fr');
      } else {
        badgeEl.className =
          'px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-300';
        badgeEl.textContent = 'Permission : En attente d’activation (Opt-in)';
      }
    }

    const plan = computeActiveNotificationPlan();
    const countEl = document.getElementById('lblScheduledNotificationsCount');
    if (countEl) countEl.textContent = String(plan.notificationsToSchedule.length);

    const platNoteEl = document.getElementById('lblNotifPlatformHonesty');
    if (platNoteEl && cfg.permissionStatus !== 'denied') {
      const isCap = Boolean(
        typeof window !== 'undefined' &&
        window.Capacitor &&
        typeof window.Capacitor.isNativePlatform === 'function' &&
        window.Capacitor.isNativePlatform()
      );
      const capPlat = isCap && typeof window.Capacitor.getPlatform === 'function' ? window.Capacitor.getPlatform() : '';
      const plat = detectNotificationPlatform({
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        isCapacitorNative: isCap,
        capacitorPlatform: capPlat
      });
      platNoteEl.textContent = getHonestPlatformNotificationNote(plat, state.language || 'fr');
    }
    updateInAppDueOverdueBanner();
    const previewEl = document.getElementById('scheduledNotificationsListPreview');
    if (previewEl) {
      if (!cfg.enabled) {
        previewEl.innerHTML = `<div class="p-3 rounded-xl bg-slate-50 border border-dashed border-slate-200 text-slate-500 text-center">Activez le commutateur ci-dessus pour autoriser et programmer les notifications système.</div>`;
      } else if (plan.notificationsToSchedule.length === 0) {
        previewEl.innerHTML = `<div class="p-3 rounded-xl bg-slate-50 border border-dashed border-slate-200 text-slate-500 text-center">Aucun nouveau rappel en attente (tous les rappels actuels ont déjà été envoyés ou aucun chèque actif).</div>`;
      } else {
        previewEl.innerHTML = plan.notificationsToSchedule
          .slice(0, 12)
          .map(
            (item) => `
            <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2">
              <div class="min-w-0">
                <div class="font-bold text-slate-900 truncate">${escapeHtml(item.title)}</div>
                <div class="text-[11px] text-slate-500 truncate">${escapeHtml(item.body)}</div>
                <div class="text-[10px] font-mono text-indigo-700 mt-0.5">Prévu : ${escapeHtml(item.triggerDateYMD)} (${escapeHtml(cfg.reminderTime || '09:00')})</div>
              </div>
              <button type="button" data-notif-goto='${escapeHtml(JSON.stringify(item.extra || {}))}' class="notif-goto-btn px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-800 font-bold text-[11px] shrink-0 cursor-pointer">
                Ouvrir →
              </button>
            </div>
          `
          )
          .join('');
      }
    }
  }

  // =========================================================================
  // V10.0 6-STEP INTERACTIVE ONBOARDING & LANGUAGE/HELP ENGINE
  // =========================================================================

  function bindNotificationListeners() {
    if ('Notification' in window && state.notificationSettings.enabled) {
      state.notificationSettings.permissionStatus = window.Notification.permission;
    }
    renderNotificationSettingsUI();

    // 1. Master Enable Toggle: Requests OS permission ONLY when user enables it (Requirement 1)
    document.getElementById('chkEnableSystemNotifications')?.addEventListener('change', async (e) => {
      const wantsEnable = Boolean(e.target.checked);
      if (wantsEnable) {
        const granted = await requestRealOSNotificationPermission();
        state.notificationSettings.enabled = granted;
        if (!granted) {
          e.target.checked = false;
          showToast('Permission de notification non accordée par le système');
        } else {
          await syncAndScheduleSystemNotifications(true);
          showToast('✓ Notifications système activées et programmées');
        }
      } else {
        state.notificationSettings.enabled = false;
        const capPlugin = getCapacitorLocalNotificationsPlugin();
        if (capPlugin) {
          try {
            const pending = await capPlugin.getPending();
            if (pending?.notifications?.length) {
              await capPlugin.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
            }
          } catch (err) {}
        }
        showToast('Notifications système désactivées');
      }
      await saveState();
      renderNotificationSettingsUI();
    });

    // 2. Category & Preference Checkboxes
    const notifToggleMap = [
      ['chkNotif3Days', 'notify3DaysBefore'],
      ['chkNotif1Day', 'notify1DayBefore'],
      ['chkNotifDueDate', 'notifyOnDueDate'],
      ['chkNotifCeiling80', 'notifyCeiling80'],
      ['chkNotifCeiling100', 'notifyCeiling100'],
      ['chkNotifOverdue', 'notifyOverdue'],
      ['chkNotifRespectWorkingDays', 'respectWorkingDaysForReminders'],
      ['chkNotifIncludeSensitive', 'includeSensitiveDetails']
    ];
    notifToggleMap.forEach(([domId, settingKey]) => {
      document.getElementById(domId)?.addEventListener('change', async (e) => {
        state.notificationSettings[settingKey] = Boolean(e.target.checked);
        await saveState();
        await syncAndScheduleSystemNotifications(false);
      });
    });

    document.getElementById('inputNotifReminderTime')?.addEventListener('change', async (e) => {
      state.notificationSettings.reminderTime = e.target.value || '09:00';
      await saveState();
      await syncAndScheduleSystemNotifications(false);
    });

    document.getElementById('btnSyncNotificationsNow')?.addEventListener('click', async () => {
      await syncAndScheduleSystemNotifications(true);
      showToast('✓ File des rappels système synchronisée');
    });

    // 3. Real OS Notification Test Button (Fires actual OS/ServiceWorker/Capacitor notification)
    document.getElementById('btnTestRealSystemNotification')?.addEventListener('click', async () => {
      if (!state.notificationSettings.enabled || state.notificationSettings.permissionStatus !== 'granted') {
        const granted = await requestRealOSNotificationPermission();
        if (!granted) {
          showToast('Veuillez autoriser les notifications système dans votre navigateur ou appareil');
          return;
        }
        state.notificationSettings.enabled = true;
        await saveState();
        renderNotificationSettingsUI();
      }
      const firstOp = state.operations[0];
      const firstTr = firstOp?.tranches?.[0];
      const sampleCopy = buildLocalizedNotificationMessage({
        category: 'CHEQUE_J3',
        lang: state.language,
        includeSensitiveDetails: state.notificationSettings.includeSensitiveDetails,
        dueDateStr: firstTr?.date || '2026-11-16',
        beneficiaire: firstOp?.beneficiaire || 'Partenaire Commercial',
        banque: firstOp?.banque || 'Attijariwafa Bank',
        numCheque: firstTr?.numCheque || 'CHQ-101',
        montant: firstTr?.montant || 500000
      });
      await dispatchImmediateOSNotification({
        id: Math.floor(100000 + Math.random() * 800000),
        eventKey: 'manual_os_test_' + Date.now(),
        title: sampleCopy.title,
        body: sampleCopy.body,
        extra: firstTr
          ? { targetType: 'cheque', opId: firstOp.id, numCheque: firstTr.numCheque, date: firstTr.date }
          : { targetType: 'calendar', date: '2026-11-16' }
      });
    });

    // 4. Deep-link click handler inside preview list & calendar cells
    document.body.addEventListener('click', (e) => {
      const gotoBtn = e.target.closest('.notif-goto-btn');
      if (gotoBtn) {
        try {
          const extra = JSON.parse(gotoBtn.getAttribute('data-notif-goto') || '{}');
          handleNotificationDeepLink(extra);
        } catch (err) {}
      }
      const calCell = e.target.closest('[data-cal-date]');
      if (calCell) {
        const dStr = calCell.getAttribute('data-cal-date');
        selectCalendarDateAndShowDetails(dStr, true);
        return;
      }
      const quickAddDateBtn = e.target.closest('.btn-quick-add-for-date');
      if (quickAddDateBtn) {
        const dStr = quickAddDateBtn.getAttribute('data-quick-add-date') || state.selectedCalendarDate || getTodayYMD();
        quickAddChequeForSelectedDate(dStr);
        return;
      }
    });

    // 5. Register Service Worker & Listen for Notification Tap Events (PWA & Capacitor)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'NOTIFICATION_ACTION_CLICK') {
          handleNotificationDeepLink(event.data.extra || {});
        }
      });
    }

    const capNotifPlugin = getCapacitorLocalNotificationsPlugin();
    if (capNotifPlugin && typeof capNotifPlugin.addListener === 'function') {
      capNotifPlugin.addListener('localNotificationActionPerformed', (actionEvent) => {
        const extra = actionEvent?.notification?.extra || {};
        handleNotificationDeepLink(extra);
      });
    }

    // 6. Check URL Query Parameters if app was launched from a closed-state notification tap
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const notifTarget = urlParams.get('notifTarget');
      if (notifTarget) {
        handleNotificationDeepLink({
          targetType: notifTarget,
          opId: urlParams.get('opId') || '',
          trancheId: urlParams.get('trancheId') || '',
          numCheque: urlParams.get('numCheque') || '',
          date: urlParams.get('date') || ''
        });
      }
    } catch (e) {}

    // ===================================================================
    // V10.0 FIRST-LAUNCH ONBOARDING & LANGUAGE/HELP EVENT LISTENERS
    // ===================================================================
    try {
      const persistedLang = safeStorageGet(SAVED_LANGUAGE_STORAGE_KEY);
      if (persistedLang && ['fr', 'ar', 'en'].includes(persistedLang) && state.language !== persistedLang) {
        state.language = persistedLang;
        const lp = I18N[state.language] || I18N.fr;
        document.documentElement.setAttribute('lang', state.language);
        document.documentElement.setAttribute('dir', lp.dir);
        document.querySelectorAll('[data-i18n]').forEach((el) => {
          const key = el.getAttribute('data-i18n');
          if (lp[key]) el.textContent = lp[key];
        });
      }
    } catch (e) {}

    syncLanguagePillsAndBadges();
    renderBuiltInManualAndFaq();

    // Language selection inside Onboarding Step 2
    document.querySelectorAll('.onb-lang-card').forEach((card) => {
      card.addEventListener('click', () => {
        const chosenLang = card.getAttribute('data-onb-lang');
        if (chosenLang) {
          setApplicationLanguageImmediate(chosenLang);
        }
      });
    });

    // Language pills inside Settings ("Language & Help")
    document.querySelectorAll('.settings-lang-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        const chosenLang = btn.getAttribute('data-switch-lang');
        if (chosenLang) {
          setApplicationLanguageImmediate(chosenLang);
          showToast(
            chosenLang === 'ar'
              ? 'تم تفعيل الواجهة العربية (RTL)'
              : chosenLang === 'en'
                ? 'English interface enabled'
                : 'Interface française activée'
          );
        }
      });
    });

    // Onboarding Back / Next / Skip / Start buttons
  }

  Object.assign(env, {
    computeNotificationIdInt,
    adjustReminderDateToWorkingDay,
    combineDateAndTime,
    buildLocalizedNotificationCopy,
    computeActiveNotificationPlan,
    getCapacitorLocalNotificationsPlugin,
    requestRealOSNotificationPermission,
    dispatchImmediateOSNotification,
    syncAndScheduleSystemNotifications,
    handleNotificationDeepLink,
    renderNotificationSettingsUI,
    bindNotificationListeners
  });
}
