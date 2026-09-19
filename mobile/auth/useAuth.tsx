import React, { createContext, useContext, useEffect, useState } from 'react';
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
import { getFormValidationError } from '../pages/schema/user.validation';

type UserProfileData = UserProfileDraft;

type ProfileExtras = {
  profilePhotoBase64?: string;
  profilePhotoMimeType?: string;
  degree?: string;
  bio?: string;
  isDriver?: boolean;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleColor?: string;
  licensePlate?: string;
  seatsAvailable?: number;
};

type SignupFields = {
  name: string;
  dob: string;
  phoneNumber: string;
  email: string;
  password: string;
  confirmPassword: string;
};

type AuthContextType = {
  user: User | null;
  profileData: UserProfileData | null;
  loading: boolean;
  submitting: boolean;
  error: string | null;

  clearError: () => void;

  updateProfileDetails: (data: ProfileExtras) => Promise<void>;
  handleLogin: (credentials: { email: string; password: string }) => Promise<void>;
  handleSignup: (fields: SignupFields, extra?: ProfileExtras) => Promise<void>;
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profileData, setProfileData] = useState<UserProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          const isComplete = data.onboardingComplete ?? false;
          setProfileData({
            name: data.name ?? currentUser.displayName ?? '',
            dob: data.dob ?? '',
            phoneNumber: data.phoneNumber ?? '',
            email: data.email ?? currentUser.email ?? '',
            degree: data.degree ?? null,
            bio: data.bio ?? null,
            profilePhotoUrl: data.profilePhotoUrl ?? null,
            onboardingComplete: isComplete,
            isDriver: data.isDriver ?? false,
            vehicleMake: data.vehicleMake ?? null,
            vehicleModel: data.vehicleModel ?? null,
            vehicleColor: data.vehicleColor ?? null,
            licensePlate: data.licensePlate ?? null,
            seatsAvailable: data.seatsAvailable ?? null,
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
            isDriver: false,
            vehicleMake: null,
            vehicleModel: null,
            vehicleColor: null,
            licensePlate: null,
            seatsAvailable: null,
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
          isDriver: false,
          vehicleMake: null,
          vehicleModel: null,
          vehicleColor: null,
          licensePlate: null,
          seatsAvailable: null,
        });
      } finally {
        setLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  const handleLogin = async ({ email, password }: { email: string; password: string }) => {
    const trimmedEmail = email.trim();

    const validationError = getFormValidationError({
      mode: 'login',
      name: '',
      dob: '',
      phoneNumber: '',
      email: trimmedEmail,
      password,
      confirmPassword: '',
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

  const handleSignup = async (fields: SignupFields, extra?: ProfileExtras) => {
    // Clean inputs exactly once for the signup process
    const trimmedName = fields.name.trim();
    const trimmedDob = fields.dob.trim();
    const trimmedPhone = fields.phoneNumber.trim();
    const trimmedEmail = fields.email.trim();

    const validationError = getFormValidationError({
      mode: 'signup',
      name: trimmedName,
      dob: trimmedDob,
      phoneNumber: trimmedPhone,
      email: trimmedEmail,
      password: fields.password,
      confirmPassword: fields.confirmPassword,
    });

    if (validationError || submitting) {
      setError(validationError ?? 'Please complete the form correctly.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, trimmedEmail, fields.password);
      const currentUser = userCredential.user;

      await updateProfile(currentUser, { displayName: trimmedName });

      const trimmedDegree = extra?.degree?.trim() || null;
      const trimmedBio = extra?.bio?.trim() || null;
      const profilePhotoUrl = extra?.profilePhotoBase64
        ? `data:${extra.profilePhotoMimeType || 'image/jpeg'};base64,${extra.profilePhotoBase64}`
        : null;
      const isDriverValue = extra?.isDriver ?? false;
      const vehicleMake = extra?.vehicleMake?.trim() || null;
      const vehicleModel = extra?.vehicleModel?.trim() || null;
      const vehicleColor = extra?.vehicleColor?.trim() || null;
      const licensePlate = extra?.licensePlate?.trim() || null;
      const seatsAvailable = typeof extra?.seatsAvailable === 'number' ? extra.seatsAvailable : null;

      // Profile details (photo/degree/bio/driver info) are gathered in the signup wizard
      // itself now, so the account is created fully onboarded in one write instead of
      // needing a separate post-signup setup screen.
      const profilePayload = {
        name: trimmedName,
        dob: trimmedDob,
        phoneNumber: trimmedPhone,
        email: trimmedEmail,
        degree: trimmedDegree,
        bio: trimmedBio,
        profilePhotoUrl,
        isDriver: isDriverValue,
        vehicleMake,
        vehicleModel,
        vehicleColor,
        licensePlate,
        seatsAvailable,
        onboardingComplete: true,
        createdAt: new Date().toISOString(),
      };

      await setDoc(doc(db, 'users', currentUser.uid), profilePayload, { merge: true });

      if (isDriverValue) {
        await setDoc(
          doc(db, 'drivers', currentUser.uid),
          {
            uid: currentUser.uid,
            name: trimmedName,
            dob: trimmedDob,
            profilePhotoUrl,
            vehicleMake,
            vehicleModel,
            vehicleColor,
            licensePlate,
            seatsAvailable,
            createdAt: profilePayload.createdAt,
            updatedAt: profilePayload.createdAt,
          },
          { merge: true },
        );
      }

      setProfileData((currentProfile) => ({
        ...(currentProfile ?? {}),
        ...profilePayload,
      }));
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const saveProfileDetails = async (data: ProfileExtras) => {
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
      const isDriverValue = data.isDriver ?? false;
      const vehicleMake = data.vehicleMake?.trim() || null;
      const vehicleModel = data.vehicleModel?.trim() || null;
      const vehicleColor = data.vehicleColor?.trim() || null;
      const licensePlate = data.licensePlate?.trim() || null;
      const seatsAvailable = typeof data.seatsAvailable === 'number' ? data.seatsAvailable : null;

      const timestamp = new Date().toISOString();
      const profilePayload = {
        degree: trimmedDegree,
        bio: trimmedBio,
        profilePhotoUrl,
        isDriver: isDriverValue,
        vehicleMake,
        vehicleModel,
        vehicleColor,
        licensePlate,
        seatsAvailable,
        onboardingComplete: true,
        updatedAt: timestamp,
      };

      await setDoc(doc(db, 'users', currentUser.uid), profilePayload, { merge: true });

      if (isDriverValue) {
        const driverPayload = {
          uid: currentUser.uid,
          name: profileData?.name ?? currentUser.displayName ?? '',
          dob: profileData?.dob ?? '',
          profilePhotoUrl,
          vehicleMake,
          vehicleModel,
          vehicleColor,
          licensePlate,
          seatsAvailable,
          createdAt: profileData?.updatedAt ?? timestamp,
          updatedAt: timestamp,
        };

        await setDoc(doc(db, 'drivers', currentUser.uid), driverPayload, { merge: true });
      }

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

  const updateProfileDetails = async (data: ProfileExtras) => {
    await saveProfileDetails(data);
  };

  const handleLogout = async () => {
    setError(null);
    try {
      await firebaseSignOut(auth);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to sign out right now.';
      setError(message);
    }
  };

  const clearError = () => setError(null);

  const value = {
    user,
    profileData,
    loading,
    submitting,
    error,

    clearError,
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