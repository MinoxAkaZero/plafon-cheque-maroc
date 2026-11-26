"""
PlafondChèque Maroc Pro — Automated Headless Chromium Visual Screenshot Capture

Captures visual verification screenshots across:
  - Onboarding (onboarding-light.png)
  - Light FR, Dark FR, Arabic RTL across Home, New cheque, Calendar, Settings
  - Account management subpage (account-light.png)
  - English (EN) across Home and Settings (home-en.png, settings-en.png)

Saves PNGs into docs/screenshots/ with external network blocked via CDP.
Run against the built dist/ (`npm run build && npm run screenshots`).
"""
import os
import sys
import time
import threading
import http.server
import socketserver
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
DIST_DIR = os.path.join(REPO_ROOT, "dist")
OUT_DIR = os.path.join(REPO_ROOT, "docs", "screenshots")

if not os.path.isfile(os.path.join(DIST_DIR, "index.html")):
    print("ERROR: dist/index.html not found. Run `npm run build` first.", file=sys.stderr)
    sys.exit(1)

os.makedirs(OUT_DIR, exist_ok=True)

class QuietHTTPHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST_DIR, **kwargs)
    def log_message(self, format, *args):
        pass

httpd = socketserver.TCPServer(("127.0.0.1", 0), QuietHTTPHandler)
port = httpd.server_address[1]
threading.Thread(target=httpd.serve_forever, daemon=True).start()
origin = f"http://plafondcheque.test:{port}"

opts = Options()
opts.add_argument("--headless=new")
opts.add_argument("--no-sandbox")
opts.add_argument("--disable-dev-shm-usage")
opts.add_argument("--window-size=1280,900")
opts.add_argument("--host-resolver-rules=MAP plafondcheque.test 127.0.0.1")
opts.add_argument(f"--unsafely-treat-insecure-origin-as-secure={origin}")

driver = webdriver.Chrome(options=opts)
try:
    driver.execute_cdp_cmd("Network.enable", {})
    driver.execute_cdp_cmd("Network.setBlockedURLs", {
        "urls": ["https://*", "*googleapis.com*", "*gstatic.com*", "*jsdelivr.net*", "*tailwindcss.com*"]
    })
    driver.get(f"{origin}/index.html")
    time.sleep(0.8)

    captured = []

    # 1. Capture Onboarding screen before dismissing it
    driver.execute_script("""
      const onb = document.getElementById('onboardingOverlayModal');
      if (onb) onb.classList.remove('hidden');
      const acct = document.getElementById('accountSelectionOverlay');
      if (acct) acct.classList.add('hidden');
      window.scrollTo(0, 0);
    """)
    time.sleep(0.25)
    onb_path = os.path.join(OUT_DIR, "onboarding-light.png")
    driver.save_screenshot(onb_path)
    captured.append(os.path.basename(onb_path))
    print(f"📸 Saved docs/screenshots/{os.path.basename(onb_path)}")

    # 2. Dismiss onboarding and seed one clean sample operation for realistic visual inspection
    driver.execute_script("""
      const onb = document.getElementById('onboardingOverlayModal');
      if (onb) onb.classList.add('hidden');
      const acct = document.getElementById('accountSelectionOverlay');
      if (acct) acct.classList.add('hidden');
      state.onboardingCompleted = true;
      state.operations = [{
        id: 'op_demo_vis_1',
        beneficiaire: 'Atlas Distribution SARL',
        banque: 'Attijariwafa Bank',
        numChequeBase: 'CHQ-2026-001',
        montantTotal: 4500000,
        dateSaisie: '2026-11-23',
        echeanceDays: 30,
        dateLimiteBrute: '2026-12-23',
        dateOuvrableCible: '2026-12-23',
        mode: 'backward',
        notes: 'Facture F-2026-410',
        tranches: [{
          id: 'tr_demo_vis_1',
          numCheque: 'CHQ-2026-001',
          montant: 4500000,
          date: '2026-12-23',
          status: 'scheduled'
        }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1
      }];
      renderKPIsAndAllViews();
    """)
    time.sleep(0.3)

    modes = [
        ("light", "fr", False),
        ("dark", "fr", True),
        ("ar-rtl", "ar", False),
    ]
    screens = [
        ("home", "tab-accueil"),
        ("new-cheque", "tab-saisie"),
        ("calendar", "tab-planning"),
        ("settings", "tab-parametres"),
    ]

    for mode_slug, lang, is_dark in modes:
        driver.execute_script("""
          setApplicationLanguageImmediate(arguments[0]);
          if (arguments[1]) document.documentElement.classList.add('dark');
          else document.documentElement.classList.remove('dark');
          state.darkMode = Boolean(arguments[1]);
        """, lang, is_dark)
        time.sleep(0.25)

        for screen_slug, tab_id in screens:
            driver.execute_script("""
              if (arguments[0] === 'tab-accueil' && typeof goHomeScreen === 'function') {
                goHomeScreen({ pushHistory: false });
              } else {
                switchTab(arguments[0]);
                if (arguments[0] === 'tab-parametres' && typeof showSettingsLandingHub === 'function') {
                  showSettingsLandingHub({ pushHistory: false });
                }
              }
              window.scrollTo(0, 0);
            """, tab_id)
            time.sleep(0.25)
            out_path = os.path.join(OUT_DIR, f"{screen_slug}-{mode_slug}.png")
            driver.save_screenshot(out_path)
            captured.append(os.path.basename(out_path))
            print(f"📸 Saved docs/screenshots/{os.path.basename(out_path)}")

    # 3. Capture Account Management subpage (Light FR)
    driver.execute_script("""
      setApplicationLanguageImmediate('fr');
      document.documentElement.classList.remove('dark');
      state.darkMode = false;
      switchTab('tab-parametres');
      if (typeof openSettingsSubpage === 'function') {
        openSettingsSubpage('account', { pushHistory: false });
      }
      window.scrollTo(0, 0);
    """)
    time.sleep(0.25)
    acct_path = os.path.join(OUT_DIR, "account-light.png")
    driver.save_screenshot(acct_path)
    captured.append(os.path.basename(acct_path))
    print(f"📸 Saved docs/screenshots/{os.path.basename(acct_path)}")

    # 4. Capture English (EN) Home & Settings
    driver.execute_script("""
      setApplicationLanguageImmediate('en');
      document.documentElement.classList.remove('dark');
      state.darkMode = false;
      if (typeof goHomeScreen === 'function') goHomeScreen({ pushHistory: false });
      window.scrollTo(0, 0);
    """)
    time.sleep(0.25)
    en_home = os.path.join(OUT_DIR, "home-en.png")
    driver.save_screenshot(en_home)
    captured.append(os.path.basename(en_home))
    print(f"📸 Saved docs/screenshots/{os.path.basename(en_home)}")

    driver.execute_script("""
      switchTab('tab-parametres');
      if (typeof showSettingsLandingHub === 'function') showSettingsLandingHub({ pushHistory: false });
      window.scrollTo(0, 0);
    """)
    time.sleep(0.25)
    en_set = os.path.join(OUT_DIR, "settings-en.png")
    driver.save_screenshot(en_set)
    captured.append(os.path.basename(en_set))
    print(f"📸 Saved docs/screenshots/{os.path.basename(en_set)}")

    print(f"\n✅ Captured {len(captured)} visual verification screenshots in docs/screenshots/")
finally:
    driver.quit()
    httpd.shutdown()
