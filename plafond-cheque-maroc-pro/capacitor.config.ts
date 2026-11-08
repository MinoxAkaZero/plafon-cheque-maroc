import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ma.plafondcheque.pro',
  appName: 'PlafondChèque Maroc Pro',
  webDir: 'public',
  bundledWebRuntime: false,
  server: {
    androidScheme: 'https',
    iosScheme: 'capacitor'
  },
  ios: {
    contentInset: 'always',
    backgroundColor: '#0f172a',
    preferredContentMode: 'mobile',
    scheme: 'PlafondChequePro'
  },
  android: {
    backgroundColor: '#0f172a',
    allowMixedContent: false
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1600,
      launchAutoHide: true,
      backgroundColor: '#0f172a',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0f172a'
    }
  }
};

export default config;
