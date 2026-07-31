import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfigJson from '../../firebase-applet-config.json';

// Initialize Firebase using applet config
const app = getApps().length === 0 ? initializeApp(firebaseConfigJson) : getApp();

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Use this Firebase project's default Firestore database.
export const db = getFirestore(app);

export default app;
