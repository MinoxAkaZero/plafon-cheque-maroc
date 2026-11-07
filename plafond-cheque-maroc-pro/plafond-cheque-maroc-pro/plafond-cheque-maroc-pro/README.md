# PlafondChèque Maroc Pro v2.0 — Documentation & Architecture

Application commerciale de gestion des chèques, LCN et plafonds journaliers pour le Maroc (Desktop, Mobile Responsive, PWA Hors-Ligne & Projet Android APK Capacitor).

## 1. Architecture Technique Modulaire

- `src/engine/calendar.mjs` : Moteur de calendrier ouvrable marocain (exclusion automatique des samedis, dimanches, jours fériés nationaux fixes, fêtes religieuses estimées avec badge explicite et jours fériés personnalisés).
- `src/engine/distribution.mjs` : Moteur de calcul et répartition automatique des plafonds en **centimes entiers exacts** (zéro erreur d'arrondi IEEE-754), supportant les 3 stratégies (`backward`, `forward_window`, `overflow_after`) et générant une explication détaillée (`explicationDate`) pour chaque chèque.
- `src/engine/words.mjs` : Convertisseur automatique des montants en toutes lettres en **Français** (avec correction orthographique bancaire de *cent* et *quatre-vingt* devant *mille*) et en **Arabe** (`تفقيط الشيكات بالعربية`).
- `public/index.html` : Application complète auto-contenue fonctionnant hors-ligne avec **IndexedDB (`PlafondChequeMarocDB`)** + synchronisation `localStorage`, interface Mobile dédiée (barre de navigation inférieure à une main), support **Français / Arabe (RTL) / Anglais**, Mode Simplifié **Lwalid**, verrouillage **PIN**, graphiques **Chart.js**, et impression A4.
- `public/manifest.json` & `public/sw.js` : Progressive Web App (PWA) installable directement sur l'écran d'accueil Android, iOS et Desktop.
- `capacitor.config.ts` & `android/` : Configuration Capacitor prête pour la compilation d'un fichier **APK Android** natif.

## 2. Exécution des Tests Automatisés (18 Scénarios Financiers)

```bash
node tests/engine.test.mjs
```

## 3. Génération de l'APK Android (Debug, Release & Signé)

### Prérequis sur votre machine de compilation
1. Node.js 18+
2. Android Studio (SDK Android 34 / JDK 17)

### Étapes de compilation
```bash
# 1. Installer les dépendances Capacitor
npm install

# 2. Synchroniser l'application web dans le conteneur Android
npx cap sync android

# 3. Générer un APK de test (Debug APK)
cd android && ./gradlew assembleDebug
# Fichier généré : android/app/build/outputs/apk/debug/app-debug.apk

# 4. Générer un APK de production non signé (Release APK)
./gradlew assembleRelease
# Fichier généré : android/app/build/outputs/apk/release/app-release-unsigned.apk

# 5. Créer une clé de signature et signer l'APK pour distribution directe aux téléphones Android
keytool -genkey -v -keystore plafondcheque-release-key.jks -keyalg RSA -keysize 2048 -validity 10000 -alias plafondcheque
apksigner sign --ks plafondcheque-release-key.jks --out PlafondCheque-Maroc-Pro-v2.0.apk android/app/build/outputs/apk/release/app-release-unsigned.apk
```
