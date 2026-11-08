# How to Build & Install the Native iPhone App (.ipa) and Android App (.apk) Using ONLY a Windows PC

Because you only have a **Windows PC and an iPhone (no Mac)**, this project includes an automated **Cloud Mac & Android Builder** (`.github/workflows/build-ios-and-android.yml`). GitHub's cloud Mac (`macos-14`) compiles the Xcode project for you for free and gives you both:
1. **`PlafondCheque-Maroc-Pro-iOS.ipa`** (for the iPhone / iPad)
2. **`PlafondCheque-Maroc-Pro-Android.apk`** (for Android phones)

---

## Step 1: Compile the `.ipa` and `.apk` for Free in the Cloud (5 Minutes, No Mac or Android Studio Required)

1. Create a free account at **github.com** and create a new **Private Repository** (e.g., `plafond-cheque-maroc`).
2. Extract `plafond-cheque-maroc-pro-full.zip` on your Windows PC.
3. Upload all the extracted files (making sure the `.github/workflows/build-ios-and-android.yml` file is included) into your GitHub repository.
   *(Tip: If uploading via browser, or using Git on Windows:*
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/plafond-cheque-maroc.git
   git push -u origin main
   ```
   *)*
4. Click the **Actions** tab at the top of your GitHub repository.
5. You will see **Build Native iOS (.ipa) & Android (.apk) in the Cloud** running automatically on GitHub's cloud Mac and Linux servers.
6. After ~3 minutes, click the completed workflow run and scroll down to **Artifacts**:
   - Download **`PlafondCheque-Maroc-Pro-iOS-IPA`** (contains `PlafondCheque-Maroc-Pro-iOS.ipa`).
   - Download **`PlafondCheque-Maroc-Pro-Android-APK`** (contains `PlafondCheque-Maroc-Pro-Android.apk`).

---

## Step 2: Install `PlafondCheque-Maroc-Pro-iOS.ipa` onto the iPhone from Your Windows PC

To install the `.ipa` file from your Windows PC onto the iPhone via USB cable, use **Sideloadly** (the standard Windows tool for signing and installing `.ipa` files onto iPhones without a Mac):

### A. One-Time Setup on Your Windows PC
1. Install **iTunes for Windows (Win64)** and **iCloud for Windows** directly from Apple's website (not the Microsoft Store version) so Windows has the official Apple USB drivers.
2. Download and install **Sideloadly** (for Windows 64-bit).

### B. Prepare the iPhone
1. Connect the iPhone to your Windows PC with a USB cable, unlock the screen, and tap **Trust This Computer** (*Faire confiance à cet ordinateur*).
2. On the iPhone (iOS 16+), enable Developer Mode:
   - Go to **Réglages (Settings) → Confidentialité et sécurité (Privacy & Security)**.
   - Scroll to the bottom, tap **Mode développeur (Developer Mode)**, toggle it **ON**, and restart the iPhone when prompted.

### C. Install the App with 1 Click
1. Open **Sideloadly** on your Windows PC. Confirm that your iPhone appears in the **iDevice** field.
2. Drag and drop **`PlafondCheque-Maroc-Pro-iOS.ipa`** onto the **IPA** icon in Sideloadly.
3. Type your Apple ID (or the father's Apple ID) in the **Apple Account** box.
4. Click **Start** (enter the Apple ID password and 6-digit verification code if this is your first time).
5. Within 30 seconds, **PlafondChèque Pro** appears as a real native app on the iPhone!
6. Before opening it the first time, go on the iPhone to **Réglages (Settings) → Général → VPN et gestion de l'appareil (VPN & Device Management)**, tap your Apple ID under *App de développeur*, and tap **Faire confiance (Trust)**.

> **Important Note on Free Apple ID vs Paid Apple Developer Account ($99/yr):**
> - With a **free Apple ID**, Apple requires apps sideloaded via USB/Wi-Fi to be refreshed every 7 days (Sideloadly has an automatic Wi-Fi background refresh feature so it renews automatically whenever the iPhone is on the same Wi-Fi as the PC).
> - If you want the native iOS app to **never expire** and never need a PC again, either use a **paid Apple Developer Account** (lasts 365 days / TestFlight) OR use the **Offline PWA mode** (`Safari → Partager ⬆️ → Sur l'écran d'accueil`), whichApple allows to stay permanently on the iPhone forever with 100% offline IndexedDB storage and zero expiration!
