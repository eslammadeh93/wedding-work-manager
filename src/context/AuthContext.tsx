import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  User,
  signInWithEmailAndPassword,
  signInWithCustomToken,
  createUserWithEmailAndPassword,
  signOut,
  onIdTokenChanged,
  sendPasswordResetEmail,
  getAuth,
  setPersistence,
  browserLocalPersistence,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  onSnapshot,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { initializeApp, getApps, getApp } from 'firebase/app';
import firebaseConfigJson from '../../firebase-applet-config.json';
import { auth, db, functions } from '../firebase/config';
import { UserProfile, UserRole, Worker } from '../types';
import { sanitizeData, sanitizeText } from '../utils/security';
import { USE_MULTI_TENANT_DATA, getPostLoginPath, requestWorkerCustomToken, resolveMultiTenantSession, type AuthSession } from '../multiTenant';

interface CreateUserData {
  displayName: string;
  email: string;
  phone?: string;
  role: UserRole;
  password?: string;
  isActive: boolean;
}

interface CreateFirstSuperAdminData {
  displayName: string;
  email: string;
  phone?: string;
  password: string;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  authSession: AuthSession | null;
  allUsers: UserProfile[];
  loading: boolean;
  usersInitialized: boolean;
  authError: string | null;
  /** True only for the browser-local, fictional presentation workspace. */
  isDemo: boolean;
  clearError: () => void;
  loginEmail: (email: string, pass: string) => Promise<void>;
  loginWorker: (username: string, loginCode: string) => Promise<boolean>;
  loginMultiTenantEmail: (email: string, pass: string) => Promise<void>;
  loginMultiTenantWorker: (companyCode: string, username: string, loginCode: string) => Promise<boolean>;
  provisionWorkerAccount: (worker: Worker) => Promise<string>;
  createFirstSuperAdmin: (data: CreateFirstSuperAdminData) => Promise<void>;
  logout: (reason?: string) => Promise<void>;
  createUserAccount: (data: CreateUserData) => Promise<void>;
  updateUserProfile: (uid: string, updates: Partial<UserProfile>) => Promise<void>;
  toggleUserStatus: (uid: string, isActive: boolean) => Promise<void>;
  resetUserPassword: (email: string) => Promise<void>;
  deleteUserAccount: (uid: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
type LoginAttemptAction = 'check' | 'failure' | 'success';
type LocalLoginAttemptState = { failures: number; level: number; lockedUntil: number };
type LoginAttemptResult = { attemptNumber?: number; maxAttempts?: number; nextLockMinutes?: number };
const LOCAL_LOGIN_ATTEMPTS_KEY = 'wedding_manager_login_attempts';
const DEMO_SESSION_KEY = 'wwm_demo_session_v1';
const DEMO_UID = 'local-demo-user';
const hasDemoSession = () => {
  try { return localStorage.getItem(DEMO_SESSION_KEY) === 'active'; } catch { return false; }
};
const clearDemoSession = () => {
  try { localStorage.removeItem(DEMO_SESSION_KEY); } catch { /* storage is optional */ }
};
const demoProfile: UserProfile = { uid: DEMO_UID, email: 'test', displayName: 'مدير العرض التجريبي', role: 'super_admin', isActive: true };
const demoAuthSession: AuthSession = {
  uid: DEMO_UID, email: 'test', displayName: 'مدير العرض التجريبي', userType: 'company', role: 'company_super_admin', companyId: 'local-demo-company', memberStatus: 'active', companyStatus: 'active',
  permissions: ['company:dashboard:read', 'company:calculator:use', 'company:calculator:manage', 'company:order_responsibles:manage', 'company:calendar:read', 'company:orders:read', 'company:orders:write', 'company:customers:read', 'company:customers:write', 'company:suppliers:read', 'company:suppliers:write', 'company:workers:read', 'company:workers:write', 'company:inventory:read', 'company:inventory:write', 'company:expenses:read', 'company:expenses:write', 'company:categories:read', 'company:categories:write', 'company:activity_logs:read', 'company:worker_performance:read', 'company:reports:read', 'company:settings:read', 'company:settings:write', 'company:notifications:read'],
};
const demoUser = { uid: DEMO_UID, email: 'test', displayName: demoProfile.displayName } as User;

const formatFailedLoginMessage = (attempt: LoginAttemptResult) => {
  if (!attempt.attemptNumber || !attempt.maxAttempts) return 'بيانات الدخول غير صحيحة.';
  const lockHint = attempt.nextLockMinutes
    ? ` عند الوصول للحد سيتم إيقاف الدخول لمدة ${attempt.nextLockMinutes} دقيقة.`
    : '';
  return `بيانات الدخول غير صحيحة. المحاولة ${attempt.attemptNumber} من ${attempt.maxAttempts}.${lockHint}`;
};

// Used only if the app is served as a static site without server.ts. A real
// IP-based lock is always enforced by the /api route when that backend runs.
const applyLocalLoginAttemptLock = (action: LoginAttemptAction): LoginAttemptResult | undefined => {
  const now = Date.now();
  let state: LocalLoginAttemptState = { failures: 0, level: 0, lockedUntil: 0 };
  try {
    const saved = localStorage.getItem(LOCAL_LOGIN_ATTEMPTS_KEY);
    if (saved) state = { ...state, ...JSON.parse(saved) };
  } catch {
    // Privacy modes can block localStorage; login must still remain usable.
  }
  const persist = (nextState?: LocalLoginAttemptState) => {
    try {
      if (nextState) localStorage.setItem(LOCAL_LOGIN_ATTEMPTS_KEY, JSON.stringify(nextState));
      else localStorage.removeItem(LOCAL_LOGIN_ATTEMPTS_KEY);
    } catch {
      // The fallback cannot persist in this browser, but must not block login.
    }
  };

  if (action === 'success') {
    persist();
    return undefined;
  }
  if (state.lockedUntil > now) {
    const minutes = Math.ceil((state.lockedUntil - now) / 60_000);
    throw new Error(`تم إيقاف محاولات الدخول مؤقتًا. حاول مرة أخرى بعد ${minutes} دقيقة.`);
  }
  if (action !== 'failure') return undefined;

  const failuresNeeded = state.level >= 2 ? 1 : 3;
  const nextLockMinutes = state.level === 0 ? 1 : state.level === 1 ? 5 : 30;
  state.failures += 1;
  if (state.failures >= failuresNeeded) {
    const attemptNumber = state.failures;
    state = { failures: 0, level: state.level + 1, lockedUntil: now + nextLockMinutes * 60_000 };
    persist(state);
    throw new Error(`بيانات الدخول غير صحيحة. المحاولة ${attemptNumber} من ${failuresNeeded}. تم إيقاف الدخول لمدة ${nextLockMinutes} دقيقة.`);
  }
  persist(state);
  return { attemptNumber: state.failures, maxAttempts: failuresNeeded, nextLockMinutes };
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [usersInitialized, setUsersInitialized] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);

  const activateDemo = () => {
    setIsDemo(true);
    setUser(demoUser);
    setProfile(demoProfile);
    setAuthSession(demoAuthSession);
    setUsersInitialized(true);
    setLoading(false);
  };

  const reportLoginAttempt = async (action: LoginAttemptAction): Promise<LoginAttemptResult | undefined> => {
    // Keep this route in sync with server.ts. It is deliberately relative so
    // it uses the same server that delivered the app.
    const endpoint = '/api/auth/attempt';
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
    } catch {
      console.warn('Login lock API is unavailable; using this-device fallback.');
      return applyLocalLoginAttemptLock(action);
    }

    const contentType = response.headers.get('content-type') || '';
    let result: ({ allowed?: boolean; retryAfterSeconds?: number; message?: string } & LoginAttemptResult) | null = null;
    if (contentType.includes('application/json')) {
      try {
        result = await response.json();
      } catch {
        // A malformed JSON response is treated exactly like an unavailable API.
      }
    }

    if (!response.ok) {
      if (response.status === 429 && result?.retryAfterSeconds) {
        const minutes = Math.ceil(result.retryAfterSeconds / 60);
        const attempts = result.attemptNumber && result.maxAttempts
          ? `بيانات الدخول غير صحيحة. المحاولة ${result.attemptNumber} من ${result.maxAttempts}. `
          : '';
        throw new Error(`${attempts}تم إيقاف الدخول لمدة ${minutes} دقيقة.`);
      }
      if (response.status === 404 || !result) {
        console.warn('Login lock API route is unavailable; using this-device fallback.');
        return applyLocalLoginAttemptLock(action);
      }
      throw new Error(result?.message || `تعذر تنفيذ حماية تسجيل الدخول (رمز الخطأ ${response.status}).`);
    }

    if (!result || result.allowed !== true) {
      console.warn('Login lock API returned an invalid response; using this-device fallback.');
      return applyLocalLoginAttemptLock(action);
    }
    return result;
  };

  // Subscribe to all users from Firestore
  useEffect(() => {
    if (USE_MULTI_TENANT_DATA || isDemo) {
      setUsersInitialized(true);
      return;
    }
    const usersColRef = collection(db, 'users');
    const unsubscribe = onSnapshot(
      usersColRef,
      async (snapshot) => {
        const list: UserProfile[] = snapshot.docs.map((d) => ({
          uid: d.id,
          ...(d.data() as Omit<UserProfile, 'uid'>),
        }));
        setAllUsers(list);
        setUsersInitialized(true);

      },
      (err) => {
        console.warn('Firestore user listener error:', err);
        setUsersInitialized(true);
      }
    );

    return () => unsubscribe();
  }, []);

  const logout = async (reason?: string) => {
    if (reason) {
      setAuthError(reason);
    } else {
      setAuthError(null);
    }
    if (isDemo) {
      clearDemoSession();
      setIsDemo(false);
      // Clear a stale Firebase browser session without calling an application API.
      try { await signOut(auth); } catch { /* no Firebase session is normal for a demo */ }
    } else if (user) {
      try {
        sessionStorage.removeItem(`wedding_manager_active_tab:${user.uid}`);
      } catch {
        // Storage is optional and must never prevent logout.
      }
      try {
        const endServerSession = httpsCallable<undefined, { success: boolean; code: string }>(functions, 'logout');
        await endServerSession();
      } catch (err) {
        // A server-side revocation failure must not trap the user in the app.
        console.warn('Server logout info:', err);
      }
      try {
        await signOut(auth);
      } catch (err) {
        console.warn('Firebase signOut info:', err);
      }
    }
    setUser(null);
    setProfile(null);
    setAuthSession(null);
  };

  const loginWorker = async (usernameInput: string, loginCodeInput: string): Promise<boolean> => {
    setAuthError(null);
    const username = sanitizeText(usernameInput).trim().toLowerCase();
    const loginCode = sanitizeText(loginCodeInput).trim();

    try {
      await reportLoginAttempt('check');
      const credential = await signInWithEmailAndPassword(auth, `${username}@worker.local`, loginCode);
      const workerProfileSnap = await getDoc(doc(db, 'users', credential.user.uid));
      const workerProfile = workerProfileSnap.exists()
        ? ({ uid: credential.user.uid, ...workerProfileSnap.data() } as UserProfile)
        : null;

      if (!workerProfile || workerProfile.role !== 'worker' || !workerProfile.workerId) {
        await signOut(auth);
        const attempt = await reportLoginAttempt('failure');
        setAuthError(formatFailedLoginMessage(attempt || {}));
        return false;
      }
      if (!workerProfile.isActive) {
        await signOut(auth);
        await reportLoginAttempt('failure');
        setAuthError('حساب العامل غير مُفعّل. يرجى التواصل مع الإدارة.');
        return false;
      }

      setProfile(workerProfile);
      await reportLoginAttempt('success');
      return true;
    } catch (error: any) {
      if (String(error.message || '').includes('إيقاف الدخول')) {
        setAuthError(error.message);
        return false;
      }
      try {
        const attempt = await reportLoginAttempt('failure');
        const baseMessage = formatFailedLoginMessage(attempt || {});
        const guidance = error?.code === 'auth/invalid-credential'
          ? ' إذا كان الحساب قديماً، اطلب من المدير تأمين حسابات العمال من لوحة العمال أولاً.'
          : '';
        setAuthError(`${baseMessage}${guidance}`);
      } catch (lockError: any) {
        setAuthError(lockError.message);
      }
      return false;
    }
  };

  // Firebase stores its refresh token in the selected persistence layer and
  // rotates the short-lived ID token itself. Listening for ID-token changes
  // (rather than auth-state changes only) also revalidates tenant access when
  // claims are refreshed, revoked, or changed by an administrator.
  useEffect(() => {
    let disposed = false;
    let unsubscribe = () => undefined;
    let resolutionVersion = 0;

    const resolveAuthState = async (currentUser: User | null) => {
      const version = ++resolutionVersion;
      const isCurrent = () => !disposed && version === resolutionVersion;
      if (!isCurrent()) return;
      // The demo account is a client-only session. It intentionally has no
      // Firebase identity, so no Firestore rule can ever grant it access.
      if (hasDemoSession()) {
        activateDemo();
        return;
      }
      setIsDemo(false);
      setUser(currentUser);

      if (currentUser) {
        if (USE_MULTI_TENANT_DATA) {
          try {
            console.info('[auth-context] auth state authenticated; resolving multi-tenant session');
            const session = await resolveMultiTenantSession(currentUser);
            if (!isCurrent()) return;
            console.info('[auth-context] session resolved', { userType: session.userType, role: session.role, companyId: session.companyId || null });
            setAuthSession(session);
            // Compatibility shape for legacy UI only; authorization remains AuthSession.
            const compatibleRole: UserRole = session.role === 'company_super_admin' || session.userType === 'platform' ? 'super_admin' : session.role as UserRole;
            const tokenResult = session.role === 'worker' ? await currentUser.getIdTokenResult() : null;
            if (!isCurrent()) return;
            setProfile({ uid: session.uid, email: session.email, displayName: session.displayName, role: compatibleRole, isActive: true, workerId: tokenResult ? String(tokenResult.claims.workerId || '') : undefined });
            const currentPath = `${window.location.pathname}${window.location.search}`;
            // A platform route is represented in the URL, so retain it during
            // refresh instead of returning the owner to the overview page.
            const postLoginPath = session.userType === 'platform' && window.location.pathname.startsWith('/platform')
              ? currentPath
              : getPostLoginPath(session);
            if (currentPath !== postLoginPath) window.history.replaceState({}, '', postLoginPath);
            console.info('[auth-context] navigation completed', { destination: postLoginPath });
          } catch (error) {
            if (!isCurrent()) return;
            const message = error instanceof Error ? error.message : String(error);
            console.error('[auth-context] exception before session state commit', { source: 'src/context/AuthContext.tsx', name: error instanceof Error ? error.name : 'unknown', code: (error as { code?: unknown })?.code ?? null, message, stack: error instanceof Error ? error.stack : null });
            setAuthError(message);
            setAuthSession(null);
            setProfile(null);
            await signOut(auth);
            if (!isCurrent()) return;
            setUser(null);
          }
          if (isCurrent()) setLoading(false);
          return;
        }
        try {
          const userDocRef = doc(db, 'users', currentUser.uid);
          const userSnap = await getDoc(userDocRef);
          if (!isCurrent()) return;

          if (userSnap.exists()) {
            const userProf = { uid: currentUser.uid, ...userSnap.data() } as UserProfile;
            if (!userProf.isActive) {
              setAuthError('Your account has been disabled by an administrator.');
              await signOut(auth);
              if (!isCurrent()) return;
              setUser(null);
              setProfile(null);
            } else {
              setProfile(userProf);
            }
          } else {
            // Never invent a privileged profile on the client. Every account
            // must be explicitly provisioned by an existing manager.
            setAuthError('هذا الحساب غير مُجهز من الإدارة.');
            await signOut(auth);
            setUser(null);
            setProfile(null);
          }
        } catch (e) {
          console.warn('Error reading user profile from Firestore:', e);
          setAuthError('تعذر التحقق من صلاحيات الحساب.');
          await signOut(auth);
          if (!isCurrent()) return;
          setUser(null);
          setProfile(null);
        }
      } else {
        setUser(null);
        setProfile(null);
        setAuthSession(null);
      }
      if (isCurrent()) setLoading(false);
    };

    const initializeAuth = async () => {
      try {
        // Local persistence survives browser restarts. We deliberately never
        // read, expose, or store the refresh token ourselves; Firebase Auth
        // owns rotation and storage of both the refresh token and JWT.
        await setPersistence(auth, browserLocalPersistence);
      } catch (error) {
        // Some privacy-restricted browsers can deny persistent storage. Auth
        // remains usable there, but the browser cannot guarantee a restart-safe session.
        console.warn('[auth-context] persistent auth storage is unavailable', error);
      }
      if (disposed) return;
      unsubscribe = onIdTokenChanged(auth, (currentUser) => { void resolveAuthState(currentUser); });
    };

    void initializeAuth();

    return () => { disposed = true; resolutionVersion += 1; unsubscribe(); };
  }, [isDemo]);

  const clearError = () => setAuthError(null);

  const provisionWorkerAccount = async (worker: Worker): Promise<string> => {
    if (worker.authUid) return worker.authUid;
    const secondaryApp = getApps().find((app) => app.name === 'SecondaryWorkerApp')
      ? getApp('SecondaryWorkerApp')
      : initializeApp(firebaseConfigJson, 'SecondaryWorkerApp');
    const secondaryAuth = getAuth(secondaryApp);
    const email = `${sanitizeText(worker.username).trim().toLowerCase()}@worker.local`;
    const credential = await createUserWithEmailAndPassword(secondaryAuth, email, worker.loginCode);
    await signOut(secondaryAuth);
    const workerProfile: UserProfile = {
      uid: credential.user.uid,
      email,
      displayName: worker.fullName,
      phone: worker.phone || '',
      role: 'worker',
      isActive: worker.status === 'active',
      workerId: worker.id,
      workerName: worker.fullName,
      createdAt: new Date().toISOString(),
      lastLogin: 'Never',
    };
    await setDoc(doc(db, 'users', credential.user.uid), workerProfile);
    return credential.user.uid;
  };

  const loginEmail = async (email: string, pass: string) => {
    setAuthError(null);
    const trimmedEmail = sanitizeText(email).trim().toLowerCase();

    if (trimmedEmail === 'test' && pass === 'test') {
      try { localStorage.setItem(DEMO_SESSION_KEY, 'active'); } catch { /* the session remains active until refresh */ }
      activateDemo();
      return;
    }
    clearDemoSession();
    setIsDemo(false);

    try {
      await reportLoginAttempt('check');
      const cred = await signInWithEmailAndPassword(auth, trimmedEmail, pass);
      if (cred.user) {
        const now = new Date().toISOString();
        try {
          await updateDoc(doc(db, 'users', cred.user.uid), { lastLogin: now });
        } catch (e) {
          console.warn('Could not update lastLogin:', e);
        }
      }
      await reportLoginAttempt('success');
    } catch (err: any) {
      // Do not count a server lock response twice; it was already created by
      // the failed-attempt endpoint.
      if (!String(err.message || '').includes('إيقاف محاولات الدخول')) {
        try {
          const attempt = await reportLoginAttempt('failure');
          const message = formatFailedLoginMessage(attempt || {});
          setAuthError(message);
          throw new Error(message);
        } catch (lockError: any) {
          setAuthError(lockError.message);
          throw lockError;
        }
      }
      setAuthError(err.message || 'Login failed. Please check your credentials.');
      throw err;
    }
  };

  const loginMultiTenantEmail = async (email: string, pass: string) => {
    setAuthError(null);
    if (sanitizeText(email).trim().toLowerCase() === 'test' && pass === 'test') {
      try { localStorage.setItem(DEMO_SESSION_KEY, 'active'); } catch { /* the session remains active until refresh */ }
      activateDemo();
      return;
    }
    clearDemoSession();
    setIsDemo(false);
    try {
      console.info('[auth-login] start', { method: 'email' });
      await reportLoginAttempt('check');
      console.info('[auth-login] rate-limit check passed');
      console.info('[auth-login] persistent session is ready');
      await signInWithEmailAndPassword(auth, sanitizeText(email).trim().toLowerCase(), pass);
      console.info('[auth-login] Firebase Auth sign-in succeeded');
      await reportLoginAttempt('success');
      console.info('[auth-login] success recorded; waiting for auth state resolution');
    } catch (error: any) {
      console.error('[auth-login] exception', { source: 'loginMultiTenantEmail', name: error?.name || 'unknown', code: error?.code || null, message: error?.message || String(error), stack: error?.stack || null });
      const attempt = await reportLoginAttempt('failure');
      setAuthError(error?.message || formatFailedLoginMessage(attempt || {}));
      throw error;
    }
  };

  const loginMultiTenantWorker = async (companyCode: string, username: string, loginCode: string): Promise<boolean> => {
    setAuthError(null);
    try {
      await reportLoginAttempt('check');
      const result = await requestWorkerCustomToken(
        sanitizeText(companyCode).trim(),
        sanitizeText(username).trim(),
        loginCode,
      );
      if (!result.success || !result.customToken) {
        setAuthError(result.retryAfterSeconds ? `تم إيقاف المحاولة مؤقتًا. حاول بعد ${Math.ceil(result.retryAfterSeconds / 60)} دقيقة.` : result.message);
        return false;
      }
      await signInWithCustomToken(auth, result.customToken);
      await reportLoginAttempt('success');
      return true;
    } catch {
      const attempt = await reportLoginAttempt('failure');
      setAuthError(formatFailedLoginMessage(attempt || {}));
      return false;
    }
  };

  const createFirstSuperAdmin = async (data: CreateFirstSuperAdminData) => {
    setAuthError(null);
    try {
      const cleanData = sanitizeData(data);
      const userCred = await createUserWithEmailAndPassword(auth, cleanData.email, data.password);
      if (userCred.user) {
        const newProf: UserProfile = {
          uid: userCred.user.uid,
          email: cleanData.email,
          displayName: cleanData.displayName,
          phone: cleanData.phone || '',
          role: 'super_admin',
          isActive: true,
          createdAt: new Date().toISOString(),
          lastLogin: new Date().toISOString(),
        };
        await setDoc(doc(db, 'users', userCred.user.uid), newProf);
        setProfile(newProf);
        setUser(userCred.user);
      }
    } catch (err: any) {
      setAuthError(err.message || 'Failed to create Super Admin account.');
      throw err;
    }
  };

  // Create user account as Admin without interrupting current Admin session
  const createUserAccount = async (data: CreateUserData) => {
    setAuthError(null);
    let newUid = `user_${Date.now()}`;

    if (data.password) {
      try {
        const secondaryApp = getApps().find((a) => a.name === 'SecondaryAdminApp')
          ? getApp('SecondaryAdminApp')
          : initializeApp(firebaseConfigJson, 'SecondaryAdminApp');
        
        const secondaryAuth = getAuth(secondaryApp);
        const userCred = await createUserWithEmailAndPassword(secondaryAuth, data.email, data.password);
        newUid = userCred.user.uid;
        await signOut(secondaryAuth);
      } catch (e: any) {
        setAuthError(e.message || 'تعذر إنشاء حساب المستخدم.');
        throw e;
      }
    }

    const cleanData = sanitizeData(data);
    const newProfile: UserProfile = {
      uid: newUid,
      email: cleanData.email,
      displayName: cleanData.displayName,
      phone: cleanData.phone || '',
      role: cleanData.role,
      isActive: cleanData.isActive,
      createdAt: new Date().toISOString(),
      lastLogin: 'Never',
    };

    try {
      await setDoc(doc(db, 'users', newUid), newProfile);
    } catch (e) {
      console.warn('Could not save user profile to Firestore:', e);
    }

    setAllUsers((prev) => {
      const exists = prev.some((u) => u.uid === newUid);
      return exists ? prev.map((u) => (u.uid === newUid ? newProfile : u)) : [...prev, newProfile];
    });
  };

  const updateUserProfile = async (uid: string, updates: Partial<UserProfile>) => {
    const cleanUpdates = sanitizeData(updates);
    try {
      const docRef = doc(db, 'users', uid);
      await updateDoc(docRef, { ...cleanUpdates, updatedAt: new Date().toISOString() });
    } catch (e) {
      console.warn('Firestore update warning:', e);
    }

    setAllUsers((prev) =>
      prev.map((u) => (u.uid === uid ? { ...u, ...cleanUpdates, updatedAt: new Date().toISOString() } : u))
    );

    if (profile?.uid === uid) {
      setProfile((prev) => (prev ? { ...prev, ...cleanUpdates } : null));
    }
  };

  const toggleUserStatus = async (uid: string, isActive: boolean) => {
    await updateUserProfile(uid, { isActive });
  };

  const resetUserPassword = async (email: string) => {
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (e: any) {
      console.warn('Password reset error:', e);
    }
  };

  const deleteUserAccount = async (uid: string) => {
    try {
      await deleteDoc(doc(db, 'users', uid));
    } catch (e) {
      console.warn('Delete user Firestore error:', e);
    }
    setAllUsers((prev) => prev.filter((u) => u.uid !== uid));
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        authSession,
        allUsers,
        loading,
        usersInitialized,
        authError,
        isDemo,
        clearError,
        loginEmail,
        loginWorker,
        loginMultiTenantEmail,
        loginMultiTenantWorker,
        provisionWorkerAccount,
        createFirstSuperAdmin,
        logout,
        createUserAccount,
        updateUserProfile,
        toggleUserStatus,
        resetUserPassword,
        deleteUserAccount,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
