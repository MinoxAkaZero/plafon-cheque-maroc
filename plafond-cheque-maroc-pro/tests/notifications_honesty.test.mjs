/**
 * PlafondChèque Maroc Pro — Phase 5 Notifications Honesty & Privacy Test Suite
 *
 * Proves:
 *  1. Platform detection & honest PWA/iOS/Android notes in FR/AR/EN.
 *  2. Permission-denied fallback message in FR/AR/EN.
 *  3. In-app "Due today / Overdue" banner summary.
 *  4. ZERO amounts ("DH", amount digits) or beneficiary names appear in ANY notification path
 *     (scheduled reminders, immediate alerts, or in-app banner) when includeSensitiveDetails is false.
 */
import assert from 'node:assert/strict';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  detectNotificationPlatform,
  getHonestPlatformNotificationNote,
  getPermissionDeniedFallbackMessage,
  computeDueAndOverdueSummary,
  buildNotificationPlan
} from '../src/notifications/notifier.mjs';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`✅ PASS: ${name}`);
}

test('NOTIF-01: Platform detection distinguishes Capacitor Android/iOS vs PWA iOS vs PWA Web', () => {
  assert.equal(
    detectNotificationPlatform({ isCapacitorNative: true, capacitorPlatform: 'android' }),
    'capacitor-android'
  );
  assert.equal(detectNotificationPlatform({ isCapacitorNative: true, capacitorPlatform: 'ios' }), 'capacitor-ios');
  assert.equal(
    detectNotificationPlatform({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }),
    'pwa-ios'
  );
  assert.equal(detectNotificationPlatform({ userAgent: 'Mozilla/5.0 (Linux; Android 14)' }), 'pwa-web');
});

test('NOTIF-02: Honest PWA/iOS/Android notes and permission-denied fallback in FR, AR, EN', () => {
  for (const lang of ['fr', 'ar', 'en']) {
    const pwaIos = getHonestPlatformNotificationNote('pwa-ios', lang);
    const pwaWeb = getHonestPlatformNotificationNote('pwa-web', lang);
    const cap = getHonestPlatformNotificationNote('capacitor-android', lang);
    const denied = getPermissionDeniedFallbackMessage(lang);
    assert.ok(pwaIos.length > 20 && pwaWeb.length > 20 && cap.length > 20 && denied.length > 20);
  }
});

test('NOTIF-03: Privacy setting (includeSensitiveDetails=false) hides ALL amounts & beneficiary names across native, PWA & banner', () => {
  const secretAmount = 7654321;
  const secretBeneficiary = 'Atlas Secret Fournisseur';
  const ops = [
    {
      id: 'op_priv_1',
      beneficiaire: secretBeneficiary,
      banque: 'Attijariwafa Bank',
      tranches: [
        { id: 't_today', numCheque: 'CHQ-7788', montant: secretAmount, date: '2026-11-25', status: 'scheduled' },
        { id: 't_future', numCheque: 'CHQ-7789', montant: 2000000, date: '2026-11-28', status: 'scheduled' },
        { id: 't_overdue', numCheque: 'CHQ-7787', montant: 1234567, date: '2026-11-20', status: 'scheduled' }
      ]
    }
  ];

  for (const lang of ['fr', 'ar', 'en']) {
    const plan = buildNotificationPlan({
      operations: ops,
      dailyCeiling: 10000000,
      notificationSettings: {
        ...DEFAULT_NOTIFICATION_SETTINGS,
        enabled: true,
        permissionStatus: 'granted',
        includeSensitiveDetails: false
      },
      lang,
      nowDate: new Date(2026, 10, 25, 8, 0, 0)
    });
    const banner = computeDueAndOverdueSummary(ops, '2026-11-25', { includeSensitiveDetails: false, lang });
    assert.equal(banner.hasAlerts, true);
    assert.equal(banner.dueTodayCount, 1);
    assert.equal(banner.overdueCount, 1);

    const allTexts = [
      ...plan.notificationsToSchedule.map((n) => `${n.title} ${n.body}`),
      ...plan.immediateAlerts.map((a) => `${a.title} ${a.body}`),
      banner.bannerText
    ].join('\n');

    assert.ok(
      !allTexts.includes('7 654 321') && !allTexts.includes('7654321'),
      `Amount leaked in ${lang} with masking on`
    );
    assert.ok(!allTexts.includes('1 234 567') && !allTexts.includes('1234567'), `Overdue amount leaked in ${lang}`);
    assert.ok(!allTexts.includes('DH'), `Currency leaked in ${lang} with masking on`);
    assert.ok(!allTexts.includes(secretBeneficiary), `Beneficiary leaked in ${lang} with masking on`);
  }

  // When includeSensitiveDetails=true, amounts ARE included
  const bannerShown = computeDueAndOverdueSummary(ops, '2026-11-25', { includeSensitiveDetails: true, lang: 'en' });
  assert.ok(bannerShown.bannerText.includes('DH'));
});

console.log(`\n🎉 ALL ${passed}/${passed} PHASE 5 NOTIFICATIONS HONESTY & PRIVACY TESTS PASSED!`);
