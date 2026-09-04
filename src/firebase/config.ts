import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { connectAuthEmulator, getAuth, GoogleAuthProvider } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import firebaseConfigJson from '../../firebase-applet-config.json';

const environment = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
// An explicit development check makes the emulator opt-in impossible in a
// production bundle, even if a hosting environment accidentally supplies the
// flag as a build-time variable.
const isDevelopment = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;
const emulatorProjectId = isDevelopment && environment?.VITE_USE_FIREBASE_EMULATORS === 'true'
  ? environment.VITE_FIREBASE_EMULATOR_PROJECT_ID
  : undefined;
const firebaseConfig = emulatorProjectId ? { ...firebaseConfigJson, projectId: emulatorProjectId } : firebaseConfigJson;

// A support session runs inside an iframe so the platform account stays signed
// in behind it.  A separately named Firebase app gives that iframe its own
// Auth persistence and prevents the temporary company token from replacing the
// platform token in the parent page.
export const isSupportSessionFrame = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('support-session') === '1'
  && window.self !== window.top;
const supportFrameAppName = 'SupportImpersonationFrame';
const app = isSupportSessionFrame
  ? (getApps().find(item => item.name === supportFrameAppName) || initializeApp(firebaseConfig, supportFrameAppName))
  : (getApps().length === 0 ? initializeApp(firebaseConfig) : getApp());

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Use this Firebase project's default Firestore database.
export const db = getFirestore(app);
export const functions = getFunctions(app, 'us-central1');

const appCheckSiteKey = environment?.VITE_FIREBASE_APPCHECK_SITE_KEY;
if (appCheckSiteKey) {
  if (environment?.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN) {
    (window as Window & { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = environment.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN;
  }
  initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey), isTokenAutoRefreshEnabled: true });
}
if (isDevelopment && environment?.VITE_USE_FIREBASE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}

export default app;
