import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  User,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  getAuth,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  onSnapshot,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import { initializeApp, getApps, getApp } from 'firebase/app';
import firebaseConfigJson from '../../firebase-applet-config.json';
import { auth, db } from '../firebase/config';
import { UserProfile, UserRole } from '../types';

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
  loginEmail: (email: string, pass: string) => Promise<void>;
  loginWorker: (username: string, loginCode: string) => Promise<boolean>;
  createFirstSuperAdmin: (data: CreateFirstSuperAdminData) => Promise<void>;
  logout: (reason?: string) => Promise<void>;
  createUserAccount: (data: CreateUserData) => Promise<void>;
  updateUserProfile: (uid: string, updates: Partial<UserProfile>) => Promise<void>;
  toggleUserStatus: (uid: string, isActive: boolean) => Promise<void>;
  resetUserPassword: (email: string) => Promise<void>;
  deleteUserAccount: (uid: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [usersInitialized, setUsersInitialized] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

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
  const WORKER_SESSION_KEY = 'wedding_manager_worker_session';
  const INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutes in ms

  const logout = async (reason?: string) => {
    localStorage.removeItem(LAST_ACTIVITY_KEY);
    localStorage.removeItem(WORKER_SESSION_KEY);
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
    const username = usernameInput.trim().toLowerCase();
    const loginCode = loginCodeInput.trim();

    try {
      const workersRef = collection(db, 'workers');
      const result = await getDocs(query(workersRef, where('username', '==', username)));
      const workerDoc = result.docs[0];
      const worker = workerDoc?.data();

      if (!workerDoc || !worker || worker.loginCode !== loginCode) {
        setAuthError('اسم المستخدم أو كود الدخول غير صحيح.');
        return false;
      }
      if (worker.status !== 'active') {
        setAuthError('حساب العامل غير مُفعّل. يرجى التواصل مع الإدارة.');
        return false;
      }

      const session = { workerId: workerDoc.id, workerName: worker.fullName, username: worker.username };
      localStorage.setItem(WORKER_SESSION_KEY, JSON.stringify(session));
      localStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString());
      const workerProfile: UserProfile = {
        uid: `worker_${workerDoc.id}`,
        displayName: worker.fullName,
        email: `${worker.username}@worker.local`,
        role: 'worker',
        isActive: true,
        workerId: workerDoc.id,
        workerName: worker.fullName,
      };
      setUser({ uid: workerProfile.uid, email: workerProfile.email } as User);
      setProfile(workerProfile);
      return true;
    } catch (error: any) {
      setAuthError(error.message || 'تعذر تسجيل دخول العامل.');
      return false;
    }
  };

  // Sync authenticated Firebase user with their Firestore profile.
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);

      if (currentUser) {
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
            // Check if there are any existing users in Firestore. If none, first user is super_admin.
            const isFirstUser = allUsers.length === 0;
            const newProf: UserProfile = {
              uid: currentUser.uid,
              email: currentUser.email || 'user@weddingmanager.com',
              displayName:
                currentUser.displayName || currentUser.email?.split('@')[0] || 'User',
              role: isFirstUser ? 'super_admin' : 'employee',
              isActive: true,
              createdAt: new Date().toISOString(),
              lastLogin: new Date().toISOString(),
            };
            await setDoc(userDocRef, newProf);
            setProfile(newProf);
          }
        } catch (e) {
          console.warn('Error reading user profile from Firestore:', e);
          setProfile({
            uid: currentUser.uid,
            email: currentUser.email || 'admin@weddingmanager.com',
            displayName: currentUser.displayName || 'User',
            role: 'super_admin',
            isActive: true,
          });
        }
      } else {
        const workerSession = localStorage.getItem(WORKER_SESSION_KEY);
        if (workerSession) {
          try {
            const session = JSON.parse(workerSession);
            const lastActivity = Number(localStorage.getItem(LAST_ACTIVITY_KEY) || 0);
            if (lastActivity && Date.now() - lastActivity < INACTIVITY_TIMEOUT) {
              localStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString());
              const workerProfile: UserProfile = {
                uid: `worker_${session.workerId}`,
                displayName: session.workerName,
                email: `${session.username}@worker.local`,
                role: 'worker', isActive: true, workerId: session.workerId, workerName: session.workerName,
              };
              setUser({ uid: workerProfile.uid, email: workerProfile.email } as User);
              setProfile(workerProfile);
            } else {
              localStorage.removeItem(WORKER_SESSION_KEY);
              setUser(null); setProfile(null);
            }
          } catch {
            localStorage.removeItem(WORKER_SESSION_KEY);
            setUser(null); setProfile(null);
          }
        } else {
          setUser(null);
          setProfile(null);
        }
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [allUsers.length]);

  // Automatic inactivity monitor (5 minutes timeout)
  useEffect(() => {
    const hasWorkerSession = Boolean(localStorage.getItem(WORKER_SESSION_KEY));
    if (!user && !hasWorkerSession) {
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

  const clearError = () => setAuthError(null);

  const loginEmail = async (email: string, pass: string) => {
    setAuthError(null);
    const trimmedEmail = email.trim().toLowerCase();

    try {
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
    } catch (err: any) {
      setAuthError(err.message || 'Login failed. Please check your credentials.');
      throw err;
    }
  };

  const createFirstSuperAdmin = async (data: CreateFirstSuperAdminData) => {
    setAuthError(null);
    try {
      const userCred = await createUserWithEmailAndPassword(auth, data.email, data.password);
      if (userCred.user) {
        const newProf: UserProfile = {
          uid: userCred.user.uid,
          email: data.email,
          displayName: data.displayName,
          phone: data.phone || '',
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

    const newProfile: UserProfile = {
      uid: newUid,
      email: data.email,
      displayName: data.displayName,
      phone: data.phone || '',
      role: data.role,
      isActive: data.isActive,
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
    try {
      const docRef = doc(db, 'users', uid);
      await updateDoc(docRef, { ...updates, updatedAt: new Date().toISOString() });
    } catch (e) {
      console.warn('Firestore update warning:', e);
    }

    setAllUsers((prev) =>
      prev.map((u) => (u.uid === uid ? { ...u, ...updates, updatedAt: new Date().toISOString() } : u))
    );

    if (profile?.uid === uid) {
      setProfile((prev) => (prev ? { ...prev, ...updates } : null));
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
