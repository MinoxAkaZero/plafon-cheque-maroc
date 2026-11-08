# Guide d'Installation iOS (iPhone / iPad) & Android — PlafondChèque Maroc Pro v2.1

Cette application est conçue pour fonctionner de manière fluide à la fois sur **iPhone / iPad (iOS)**, **Smartphones / Tablettes Android**, et **Ordinateurs (Mac / Windows)**.

---

## 1. Installation Immédiate sur l'iPhone ou l'iPad du Père ("Lwalid") — Sans App Store ni câble

Sur iOS (iPhone / iPad), Safari permet d'installer directement **PlafondChèque Maroc Pro** comme une véritable application plein écran hors-ligne :

1. Ouvrez l'application dans **Safari** sur l'iPhone ou l'iPad.
2. Appuyez sur le bouton **Partager** (l'icône carré avec une flèche vers le haut `⬆️` en bas de l'écran sur iPhone, ou en haut à droite sur iPad).
3. Faites défiler le menu et appuyez sur **« Sur l'écran d'accueil »** (*Add to Home Screen* / `إضافة إلى الشاشة الرئيسية`).
4. Appuyez sur **« Ajouter »** en haut à droite.

### Optimisations spécifiques iOS intégrées dans la v2.1 :
- **Icône d'application Apple (`apple-touch-icon`) intégrée** : L'icône verte et bleu nuit s'affiche automatiquement sur l'écran d'accueil de l'iPhone.
- **Respect de l'encoche (Notch / Dynamic Island) et de la barre d'accueil iPhone (`env(safe-area-inset-*)`)** : La barre de navigation inférieure et l'en-tête s'adaptent automatiquement aux écrans iPhone X à iPhone 16/17 Pro Max.
- **Anti-Zoom automatique Safari iOS (`font-size: 16px`)** : Tous les champs de saisie mobile sont calibrés à 16px minimum pour empêcher Safari de zoomer brutalement lorsque le père touche un champ.
- **Feuille de partage native iOS (`navigator.share` / AirDrop / WhatsApp / Fichiers iCloud)** : Permet d'envoyer les sauvegardes JSON, les fichiers CSV et les bordereaux directement vers WhatsApp, AirDrop ou l'application **Fichiers** de l'iPhone.

---

## 2. Compilation d'une Application Native iOS (`.ipa` via Xcode & Capacitor)

Si vous disposez d'un Mac avec **Xcode 15+**, vous pouvez également installer l'application native iOS directement sur l'iPhone de votre père via câble USB (avec un compte Apple gratuit) ou la publier sur TestFlight / App Store :

```bash
# 1. Installer les dépendances Capacitor (iOS + Android)
npm install

# 2. Synchroniser le projet web vers les conteneurs natifs iOS et Android
npx cap sync

# 3. Ouvrir le projet iOS dans Xcode
npx cap open ios
```

Dans **Xcode** :
1. Sélectionnez la cible **App** et allez dans l'onglet **Signing & Capabilities**.
2. Choisissez votre **Team** (votre identifiant Apple personnel ou compte développeur).
3. Branchez l'iPhone du père par câble (ou en Wi-Fi), sélectionnez son iPhone comme destination, puis cliquez sur **Run (▶)** pour installer l'application native directement sur son téléphone.
4. Pour générer un fichier `.ipa` distribuable : menu **Product → Archive → Distribute App**.

---

## 3. Installation & Compilation sur Android (PWA & Fichier `.apk`)

### Option A — Installation directe PWA (Chrome Android)
1. Ouvrez l'application dans Chrome sur Android.
2. Appuyez sur **« Installer sur iPhone / Android »** dans l'onglet 6 (ou menu **⋮ → Installer l'application**).

### Option B — Compilation de l'APK Android
```bash
npm install && npx cap sync android
cd android && ./gradlew assembleDebug
# APK généré : android/app/build/outputs/apk/debug/app-debug.apk
```
