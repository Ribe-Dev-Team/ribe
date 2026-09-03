import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import type { UserProfileDraft } from '../pages/schema/user.schema';
import {
  isValidDob,
  isValidEmail,
  isValidName,
  isValidPassword,
  isValidPhoneNumber,
} from '../pages/schema/user.validation';

type UserProfileData = UserProfileDraft;

type AuthContextType = {
  user: User | null;
  profileData: UserProfileData | null;
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
  needsProfileSetup: boolean;
  completeProfileSetup: (data: {
    profilePhotoBase64?: string;
    profilePhotoMimeType?: string;
    degree?: string;
    bio?: string;
  }) => Promise<void>;
  updateProfileDetails: (data: {
    profilePhotoBase64?: string;
    profilePhotoMimeType?: string;
    degree?: string;
    bio?: string;
  }) => Promise<void>;
  handleLogin: () => Promise<void>;
  handleSignup: () => Promise<void>;
  handleLogout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const getAuthErrorMessage = (err: unknown) => {
  const message = err instanceof Error ? err.message : 'Unable to complete that request right now.';

  if (typeof err === 'object' && err && 'code' in err) {
    const code = String((err as { code?: string }).code || '').toLowerCase();

    if (code.includes('email-already-in-use')) {
      return 'This email is already in use. Try logging in instead or use a different email.';
    }

    if (code.includes('weak-password')) {
      return 'Your password is too weak. Use at least 8 characters with upper and lower case letters and a number.';
    }

    if (code.includes('invalid-email')) {
      return 'The email address is not valid. Please check it and try again.';
    }

    if (code.includes('network-request-failed')) {
      return 'Connection issue. Please check your internet and try again.';
    }

    if (code.includes('too-many-requests')) {
      return 'Too many attempts. Please wait a moment and try again.';
    }

    if (code.includes('wrong-password')) {
      return 'Incorrect password. Please try again.';
    }

    if (code.includes('user-not-found')) {
      return 'No account was found for this email. Create an account or check the email.';
    }
  }

  if (message.toLowerCase().includes('password')) {
    return 'Password must be at least 8 characters long and include uppercase, lowercase, and a number.';
  }

  return message;
};

const getFormValidationError = ({
  mode,
  name,
  dob,
  phoneNumber,
  email,
  password,
  confirmPassword,
}: {
  mode: 'login' | 'signup';
  name: string;
  dob: string;
  phoneNumber: string;
  email: string;
  password: string;
  confirmPassword: string;
}) => {
  // Trim everything internally for live validation checking (like isFormValid)
  const trimmedEmail = email.trim();
  const trimmedName = name.trim();
  const trimmedDob = dob.trim();
  const trimmedPhone = phoneNumber.trim();

  if (!trimmedEmail) {
    return 'Email is required.';
  }

  if (!isValidEmail(trimmedEmail)) {
    return 'Enter a valid email address.';
  }

  if (!password) {
    return 'Password is required.';
  }

  if (mode !== 'signup') {
    return null;
  }

  if (!isValidPassword(password)) {
    return 'Password must be at least 8 characters long and include uppercase, lowercase, and a number.';
  }

  if (!isValidName(trimmedName)) {
    return 'Please enter a valid full name.';
  }

  if (!isValidDob(trimmedDob)) {
    return 'Please enter a valid date of birth in DD/MM/YYYY format and you must be at least 18 years old.';
  }

  if (!isValidPhoneNumber(trimmedPhone)) {
    return 'Please enter a valid phone number.';
  }

  if (!confirmPassword) {
    return 'Please confirm your password.';
  }

  if (password !== confirmPassword) {
    return 'Passwords do not match.';
  }

  return null;
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profileData, setProfileData] = useState<UserProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [needsProfileSetup, setNeedsProfileSetup] = useState(false);

  // Form fields
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);

      if (!currentUser) {
        setProfileData(null);
        setLoading(false);
        return;
      }

      try {
        const profileDoc = await getDoc(doc(db, 'users', currentUser.uid));
        if (profileDoc.exists()) {
          const data = profileDoc.data() as UserProfileData;
          setProfileData({
            name: data.name ?? currentUser.displayName ?? '',
            dob: data.dob ?? '',
            phoneNumber: data.phoneNumber ?? '',
            email: data.email ?? currentUser.email ?? '',
            degree: data.degree ?? null,
            bio: data.bio ?? null,
            profilePhotoUrl: data.profilePhotoUrl ?? null,
            onboardingComplete: data.onboardingComplete ?? false,
          });
        } else {
          setProfileData({
            name: currentUser.displayName ?? '',
            dob: '',
            phoneNumber: '',
            email: currentUser.email ?? '',
            degree: null,
            bio: null,
            profilePhotoUrl: null,
            onboardingComplete: false,
          });
        }
      } catch {
        setProfileData({
          name: currentUser.displayName ?? '',
          dob: '',
          phoneNumber: '',
          email: currentUser.email ?? '',
          degree: null,
          bio: null,
          profilePhotoUrl: null,
          onboardingComplete: false,
        });
      } finally {
        setLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  const isFormValid = useMemo(() => {
    return (
      getFormValidationError({
        mode,
        name,
        dob,
        phoneNumber,
        email,
        password,
        confirmPassword,
      }) === null
    );
  }, [confirmPassword, dob, email, mode, name, password, phoneNumber]);

  const handleLogin = async () => {
    const trimmedEmail = email.trim();

    const validationError = getFormValidationError({
      mode: 'login',
      name,
      dob,
      phoneNumber,
      email: trimmedEmail,
      password,
      confirmPassword,
    });

    if (validationError || submitting) {
      setError(validationError ?? 'Please check your login details.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await signInWithEmailAndPassword(auth, trimmedEmail, password);
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignup = async () => {
    // Clean inputs exactly once for the signup process
    const trimmedName = name.trim();
    const trimmedDob = dob.trim();
    const trimmedPhone = phoneNumber.trim();
    const trimmedEmail = email.trim();

    const validationError = getFormValidationError({
      mode: 'signup',
      name: trimmedName,
      dob: trimmedDob,
      phoneNumber: trimmedPhone,
      email: trimmedEmail,
      password,
      confirmPassword,
    });

    if (validationError || submitting) {
      setError(validationError ?? 'Please complete the form correctly.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, trimmedEmail, password);
      const currentUser = userCredential.user;

      await updateProfile(currentUser, { displayName: trimmedName });
      
      const profilePayload = {
        name: trimmedName,
        dob: trimmedDob,
        phoneNumber: trimmedPhone,
        email: trimmedEmail,
        onboardingComplete: false,
        createdAt: new Date().toISOString(),
      };

      await setDoc(doc(db, 'users', currentUser.uid), profilePayload, { merge: true });
      setProfileData((currentProfile) => ({
        ...(currentProfile ?? {}),
        ...profilePayload,
      }));
      setNeedsProfileSetup(true);
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const saveProfileDetails = async (data: {
    profilePhotoBase64?: string;
    profilePhotoMimeType?: string;
    degree?: string;
    bio?: string;
  }) => {
    const currentUser = auth.currentUser ?? user;

    if (!currentUser) {
      setError('You need to sign in before saving profile details.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      let profilePhotoUrl = profileData?.profilePhotoUrl ?? null;

      if (data.profilePhotoBase64) {
        const mimeType = data.profilePhotoMimeType || 'image/jpeg';
        profilePhotoUrl = `data:${mimeType};base64,${data.profilePhotoBase64}`;
      }

      // Clean inputs exactly once for saving to Firestore
      const trimmedDegree = data.degree?.trim() || null;
      const trimmedBio = data.bio?.trim() || null;

      const profilePayload = {
        degree: trimmedDegree,
        bio: trimmedBio,
        profilePhotoUrl, 
        onboardingComplete: true,
        updatedAt: new Date().toISOString(),
      };

      await setDoc(doc(db, 'users', currentUser.uid), profilePayload, { merge: true });
      
      setProfileData((currentProfile) => ({
        ...(currentProfile ?? {}),
        name: currentProfile?.name ?? currentUser.displayName ?? '',
        dob: currentProfile?.dob ?? '',
        phoneNumber: currentProfile?.phoneNumber ?? '',
        email: currentProfile?.email ?? currentUser.email ?? '',
        ...profilePayload,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to save profile details right now.';
      setError(message);
      throw err;
    } finally {
      setSubmitting(false);
    }
  };

  const completeProfileSetup = async (data: {
    profilePhotoBase64?: string;
    profilePhotoMimeType?: string;
    degree?: string;
    bio?: string;
  }) => {
    const currentUser = auth.currentUser ?? user;

    if (!currentUser) {
      setError('You need to sign in before completing profile setup.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setNeedsProfileSetup(false);

    try {
      await saveProfileDetails(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to save profile details right now.';
      setError(message);
      setNeedsProfileSetup(true);
    } finally {
      setSubmitting(false);
    }
  };

  const updateProfileDetails = async (data: {
    profilePhotoBase64?: string;
    profilePhotoMimeType?: string;
    degree?: string;
    bio?: string;
  }) => {
    await saveProfileDetails(data);
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
      setNeedsProfileSetup(false);
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
    profileData,
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
    needsProfileSetup,
    clearError,
    completeProfileSetup,
    updateProfileDetails,
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