import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  User,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  getAuth,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
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
import { initializeApp, getApps, getApp } from 'firebase/app';
import firebaseConfigJson from '../../firebase-applet-config.json';
import { auth, db } from '../firebase/config';
import { UserProfile, UserRole, Worker } from '../types';
import { sanitizeData, sanitizeText } from '../utils/security';

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
  allUsers: UserProfile[];
  loading: boolean;
  usersInitialized: boolean;
  authError: string | null;
  clearError: () => void;
  loginEmail: (email: string, pass: string, rememberMe?: boolean) => Promise<void>;
  loginWorker: (username: string, loginCode: string) => Promise<boolean>;
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
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [usersInitialized, setUsersInitialized] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

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

  const LAST_ACTIVITY_KEY = 'wedding_manager_last_activity';
  const REMEMBER_UNTIL_KEY = 'wedding_manager_remember_until';
  const REMEMBER_DURATION = 7 * 24 * 60 * 60 * 1000;
  const INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutes in ms

  const logout = async (reason?: string) => {
    localStorage.removeItem(LAST_ACTIVITY_KEY);
    localStorage.removeItem(REMEMBER_UNTIL_KEY);
    if (reason) {
      setAuthError(reason);
    } else {
      setAuthError(null);
    }
    if (user) {
      try {
        await signOut(auth);
      } catch (err) {
        console.warn('Firebase signOut info:', err);
      }
    }
    setUser(null);
    setProfile(null);
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

      localStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString());
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

  // Sync authenticated Firebase user with their Firestore profile.
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);

      if (currentUser) {
        const rememberUntil = Number(localStorage.getItem(REMEMBER_UNTIL_KEY) || 0);
        if (rememberUntil && Date.now() >= rememberUntil) {
          localStorage.removeItem(REMEMBER_UNTIL_KEY);
          await signOut(auth);
          setUser(null);
          setProfile(null);
          setAuthError('انتهت مدة التذكر. يرجى تسجيل الدخول مرة أخرى.');
          setLoading(false);
          return;
        }
        // A newly created account may not have gone through loginEmail yet.
        // Start its inactivity clock without overwriting an existing session timestamp.
        if (!localStorage.getItem(LAST_ACTIVITY_KEY)) {
          localStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString());
        }
        try {
          const userDocRef = doc(db, 'users', currentUser.uid);
          const userSnap = await getDoc(userDocRef);

          if (userSnap.exists()) {
            const userProf = { uid: currentUser.uid, ...userSnap.data() } as UserProfile;
            if (!userProf.isActive) {
              setAuthError('Your account has been disabled by an administrator.');
              await signOut(auth);
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
          setUser(null);
          setProfile(null);
        }
      } else {
        setUser(null);
        setProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Automatic inactivity monitor (5 minutes timeout)
  useEffect(() => {
    if (!user) {
      return;
    }

    let lastUpdate = Date.now();

    const updateActivity = () => {
      const now = Date.now();
      if (now - lastUpdate >= 1000) {
        lastUpdate = now;
        localStorage.setItem(LAST_ACTIVITY_KEY, now.toString());
      }
    };

    const checkInactivity = () => {
      const lastActStr = localStorage.getItem(LAST_ACTIVITY_KEY);
      if (!lastActStr) return;
      const lastAct = parseInt(lastActStr, 10);
      const now = Date.now();

      if (now - lastAct >= INACTIVITY_TIMEOUT) {
        logout('انتهت جلسة العمل بسبب عدم النشاط، يرجى تسجيل الدخول مرة أخرى.');
      }
    };

    const activityEvents = [
      'mousemove',
      'mousedown',
      'keydown',
      'touchstart',
      'touchmove',
      'scroll',
      'click',
    ];

    activityEvents.forEach((evt) => {
      window.addEventListener(evt, updateActivity, { passive: true });
    });

    const interval = setInterval(checkInactivity, 1000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkInactivity();
      }
    };

    window.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', checkInactivity);

    return () => {
      activityEvents.forEach((evt) => {
        window.removeEventListener(evt, updateActivity);
      });
      clearInterval(interval);
      window.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', checkInactivity);
    };
  }, [user]);

  // Enforce the seven-day "remember me" expiry even if the app remains open.
  useEffect(() => {
    const rememberUntil = Number(localStorage.getItem(REMEMBER_UNTIL_KEY) || 0);
    if (!user || !rememberUntil) return;
    const remaining = rememberUntil - Date.now();
    if (remaining <= 0) {
      logout('انتهت مدة التذكر. يرجى تسجيل الدخول مرة أخرى.');
      return;
    }
    const timer = window.setTimeout(
      () => logout('انتهت مدة التذكر. يرجى تسجيل الدخول مرة أخرى.'),
      remaining
    );
    return () => window.clearTimeout(timer);
  }, [user]);

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

  const loginEmail = async (email: string, pass: string, rememberMe = false) => {
    setAuthError(null);
    const trimmedEmail = sanitizeText(email).trim().toLowerCase();

    try {
      await reportLoginAttempt('check');
      await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
      if (rememberMe) {
        localStorage.setItem(REMEMBER_UNTIL_KEY, (Date.now() + REMEMBER_DURATION).toString());
      } else {
        localStorage.removeItem(REMEMBER_UNTIL_KEY);
      }
      const cred = await signInWithEmailAndPassword(auth, trimmedEmail, pass);
      if (cred.user) {
        localStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString());
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

  const createFirstSuperAdmin = async (data: CreateFirstSuperAdminData) => {
    setAuthError(null);
    try {
      const cleanData = sanitizeData(data);
      const userCred = await createUserWithEmailAndPassword(auth, cleanData.email, data.password);
      if (userCred.user) {
        localStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString());
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
        allUsers,
        loading,
        usersInitialized,
        authError,
        clearError,
        loginEmail,
        loginWorker,
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
