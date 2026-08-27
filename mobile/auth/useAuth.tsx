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
// Replace uploadBytes with uploadString


type UserProfileData = {
  name?: string | null;
  dob?: string | null;
  phoneNumber?: string | null;
  email?: string | null;
  degree?: string | null;
  bio?: string | null;
  profilePhotoUrl?: string | null;
  onboardingComplete?: boolean;
};

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

/* email mask: 5 parts,
    1: '[^\s@]+', one or more characters that are not whitespace (\s) or the '@' symbol
    2: '@', the '@' symbol
    3: '[^\s@]+', same as (1)
    4: '\.', the '.' character
    5: '[^\s@]{2,}', same as (1) but minimum of 2 characters
  note: leading '^' and trailing '$' require that to be beginning and end of the string
*/
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/* name mask:
    1: '[A-Za-zÀ-ÖØ-öø-ÿ]+', one or more characters from an extended alphabet set - a name
    2: '?:[ '-]', permit name spacer (space, apstrophe or hypen)
    3: '(...)*', zero or more additional names after the first one
  note: leading '^' and trailing '$' require that to be beginning and end of the string
*/
const namePattern = /^[A-Za-zÀ-ÖØ-öø-ÿ]+(?:[ '-][A-Za-zÀ-ÖØ-öø-ÿ]+)*$/;
/* phone number mask:
    1: '\+?', optionally may begin with a '+'
    2: '[0-9()\- ]', defines the character set of digits, round brackets, hypens and spaces
    3: '{10,20}', the phone number should be 10 to 20 digits long
  note: leading '^' and trailing '$' require that to be beginning and end of the string
*/
const phonePattern = /^\+?[0-9()\- ]{10,15}$/;
/* password mask:
    1: '(?=.*[a-z])', checks a lowercase character exists somewhere in the string
    2: '(?=.*[A-Z])', checks an uppercase character exists somewhere in the string
    3: '(?=.*\d)', checks a digit exists somewhere in the string
    4: '.{8,}', checks the string has at least 8 characters
  note: leading '^' and trailing '$' require that to be beginning and end of the string
*/
const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
/* date mask:
    1: '\d{2}', 2 digits (DD - leading 0s required)
    2: '\/', the literal '/' character
    3: '\d{2}', another 2 digits (MM - leading 0s required)
    4: '\/', the literal '/' character
    5: '\d{4}', another 4 digits (YYYY - full year required)
  note: leading '^' and trailing '$' require that to be beginning and end of the string
*/
const datePattern = /^\d{2}\/\d{2}\/\d{4}$/;

const isValidEmail = (value: string) => emailPattern.test(value.trim());
const isValidName = (value: string) => value.trim().length >= 2 && namePattern.test(value.trim());
const isValidPhoneNumber = (value: string) => {
  const digitsOnly = value.replace(/[^0-9]/g, '');
  return phonePattern.test(value.trim()) && digitsOnly.length >= 10 && digitsOnly.length <= 11;
};
const isValidDob = (value: string) => {
  const trimmed = value.trim();

  // 1. Check for DD/MM/YYYY format
  if (!datePattern.test(trimmed)) return false;

  // 2. Extract parts and safely create the Date object
  const [day, month, year] = trimmed.split('/').map(Number);
  const date = new Date(year, month - 1, day); // Month is 0-indexed

  // 3. Prevent invalid dates rolling over (e.g., 31/02/2023 becoming March 3rd)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return false;
  }

  // 4. Calculate age (logic remains unchanged)
  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();
  const hasBirthdayPassed =
    today.getMonth() > date.getMonth() ||
    (today.getMonth() === date.getMonth() && today.getDate() >= date.getDate());

  if (!hasBirthdayPassed) {
    age -= 1;
  }

  return age >= 18;
};
const isValidPassword = (value: string) => passwordPattern.test(value) && !/\s/.test(value);

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
  const trimmedEmail = email.trim();
  const trimmedPassword = password.trim();

  if (!trimmedEmail) {
    return 'Email is required.';
  }

  if (!isValidEmail(trimmedEmail)) {
    return 'Enter a valid email address.';
  }

  if (!trimmedPassword) {
    return 'Password is required.';
  }

  if (!isValidPassword(password)) {
    return 'Password must be at least 8 characters long and include uppercase, lowercase, and a number.';
  }

  if (mode !== 'signup') {
    return null;
  }

  if (!isValidName(name)) {
    return 'Please enter a valid full name.';
  }

  if (!isValidDob(dob)) {
    return 'Please enter a valid date of birth in YYYY-MM-DD format and you must be at least 18 years old.';
  }

  if (!isValidPhoneNumber(phoneNumber)) {
    return 'Please enter a valid phone number.';
  }

  if (!confirmPassword.trim()) {
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
    const validationError = getFormValidationError({
      mode: 'login',
      name,
      dob,
      phoneNumber,
      email,
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
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to sign in right now.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignup = async () => {
    const validationError = getFormValidationError({
      mode: 'signup',
      name,
      dob,
      phoneNumber,
      email,
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
      const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const currentUser = userCredential.user;

      await updateProfile(currentUser, { displayName: name.trim() });
      const profilePayload = {
        name: name.trim(),
        dob: dob.trim(),
        phoneNumber: phoneNumber.trim(),
        email: email.trim(),
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
      const message = err instanceof Error ? err.message : 'Unable to create an account right now.';
      setError(message);
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
      // 1. Start with the existing photo URL (if any)
      let profilePhotoUrl = profileData?.profilePhotoUrl ?? null;

      // 2. If a new photo was selected, format the base64 string to be saved directly in Firestore
      if (data.profilePhotoBase64) {
        const mimeType = data.profilePhotoMimeType || 'image/jpeg';
        profilePhotoUrl = `data:${mimeType};base64,${data.profilePhotoBase64}`;
      }

      // 3. Prepare the Firestore payload
      const profilePayload = {
        degree: data.degree?.trim() || null,
        bio: data.bio?.trim() || null,
        profilePhotoUrl: profilePhotoUrl, // Saving the base64 string directly!
        onboardingComplete: true,
        updatedAt: new Date().toISOString(),
      };

      // 4. Save to Firestore
      await setDoc(doc(db, 'users', currentUser.uid), profilePayload, { merge: true });

      // 5. Update local state
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
