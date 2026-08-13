import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';

import { auth, db } from '../firebaseConfig';

type AuthContextType = {
  user: User | null;
  loading: boolean;
  submitting: boolean;
  error: string | null;
  mode: 'login' | 'signup';
  toggleMode: () => void;

  // Form fields
  name: string;
  setName: (s: string) => void;
  dob: string;
  setDob: (s: string) => void;
  phoneNumber: string;
  setPhoneNumber: (s: string) => void;
  email: string;
  setEmail: (s: string) => void;
  password: string;
  setPassword: (s: string) => void;
  confirmPassword: string;
  setConfirmPassword: (s: string) => void;

  clearError: () => void;

  isFormValid: boolean;
  handleLogin: () => Promise<void>;
  handleSignup: () => Promise<void>;
  handleLogout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'login' | 'signup'>('login');

  // Form fields
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const isFormValid = useMemo(() => {
    if (!email.trim() || !password.trim()) return false;
    if (mode === 'signup') {
      return (
        name.trim().length > 0 &&
        dob.trim().length > 0 &&
        phoneNumber.trim().length > 0 &&
        confirmPassword.length > 0 &&
        password === confirmPassword
      );
    }

    return true;
  }, [confirmPassword, dob, email, mode, name, password, phoneNumber]);

  const handleLogin = async () => {
    if (!isFormValid || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to sign in right now.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignup = async () => {
    if (!isFormValid || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const currentUser = userCredential.user;

      await updateProfile(currentUser, { displayName: name.trim() });
      await setDoc(
        doc(db, 'users', currentUser.uid),
        {
          name: name.trim(),
          dob: dob.trim(),
          phoneNumber: phoneNumber.trim(),
          email: email.trim(),
          createdAt: new Date().toISOString(),
        },
        { merge: true },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to create an account right now.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    setError(null);
    try {
      await firebaseSignOut(auth);
      setName('');
      setDob('');
      setPhoneNumber('');
      setEmail('');
      setPassword('');
      setConfirmPassword('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to sign out right now.';
      setError(message);
    }
  };

  const clearError = () => setError(null);

  const toggleMode = () => {
    setMode((currentMode) => (currentMode === 'login' ? 'signup' : 'login'));
    setConfirmPassword('');
    setError(null);
  };

  const value = {
    user,
    loading,
    submitting,
    error,
    mode,
    toggleMode,

    name,
    setName,
    dob,
    setDob,
    phoneNumber,
    setPhoneNumber,
    email,
    setEmail,
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,

    isFormValid,
    clearError,
    handleLogin,
    handleSignup,
    handleLogout,
  } as const;

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

export default useAuth;
