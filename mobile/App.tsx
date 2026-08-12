// react imports
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

// navigation imports
import HomePage from './pages/HomePage';
import CalendarPage from './pages/CalendarPage';
import RidesPage from './pages/RidesPage';
import DrivesPage from './pages/DrivesPage';
import ProfilePage from './pages/ProfilePage';
import styles from './styles';

// firebase imports
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from './firebaseConfig';

const API_URL = 'http://127.0.0.1:3000';

const tabs = [
  { key: 'home', label: 'Home' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'rides', label: 'Rides' },
  { key: 'drives', label: 'Drives' },
  { key: 'profile', label: 'Profile' },
] as const;

type TabKey = (typeof tabs)[number]['key'];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('home');

  const renderPage = () => {
    switch (activeTab) {
      case 'calendar':
        return <CalendarPage />;
      case 'rides':
        return <RidesPage />;
      case 'drives':
        return <DrivesPage />;
      case 'profile':
        return <ProfilePage />;
      default:
        return <HomePage />;
    }
  };

  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'login' | 'signup'>('login');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const isFormValid = useMemo(() => {
    if (!email.trim() || !password.trim()) {
      return false;
    }

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
    if (!isFormValid || submitting) {
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
    if (!isFormValid || submitting) {
      return;
    }

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

  const toggleMode = () => {
    setMode((currentMode) => (currentMode === 'login' ? 'signup' : 'login'));
    setConfirmPassword('');
    setError(null);
  };

  if (loading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator color="#2563eb" size="large" />
        <Text style={styles.loadingText}>Connecting to Firebase...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.pageScreen}
    >
      <StatusBar barStyle="dark-content" />

      <View style={styles.pageCard}>
        {user ? (
          <View style={styles.successContainer}>
            <Text style={styles.pageTitle}>Welcome back</Text>
            <Text style={styles.pageSubtitle}>You're signed in as {user.email || 'a member'}.</Text>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <Pressable style={styles.primaryButton} onPress={handleLogout}>
              <Text style={styles.primaryButtonText}>Sign out</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.pageTitle}>Ribe</Text>
            <Text style={styles.pageSubtitle}>{mode === 'login' ? 'Sign in to continue' : 'Create your account'}</Text>

            {mode === 'signup' ? (
              <>
                <TextInput
                  autoCapitalize="words"
                  onChangeText={(value) => {
                    setName(value);
                    if (error) {
                      setError(null);
                    }
                  }}
                  placeholder="Name"
                  style={styles.input}
                  value={name}
                />

                <TextInput
                  onChangeText={(value) => {
                    setDob(value);
                    if (error) {
                      setError(null);
                    }
                  }}
                  placeholder="Date of Birth"
                  style={styles.input}
                  value={dob}
                />

                <TextInput
                  autoCapitalize="none"
                  keyboardType="phone-pad"
                  onChangeText={(value) => {
                    setPhoneNumber(value);
                    if (error) {
                      setError(null);
                    }
                  }}
                  placeholder="Phone Number"
                  style={styles.input}
                  value={phoneNumber}
                />
              </>
            ) : null}

            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              onChangeText={(value) => {
                setEmail(value);
                if (error) {
                  setError(null);
                }
              }}
              placeholder="Email"
              style={styles.input}
              value={email}
            />

            <TextInput
              onChangeText={(value) => {
                setPassword(value);
                if (error) {
                  setError(null);
                }
              }}
              placeholder="Password"
              secureTextEntry
              style={styles.input}
              value={password}
            />

            {mode === 'signup' ? (
              <TextInput
                onChangeText={(value) => {
                  setConfirmPassword(value);
                  if (error) {
                    setError(null);
                  }
                }}
                placeholder="Confirm password"
                secureTextEntry
                style={styles.input}
                value={confirmPassword}
              />
            ) : null}

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <Pressable
              disabled={!isFormValid || submitting}
              onPress={mode === 'login' ? handleLogin : handleSignup}
              style={[styles.primaryButton, (!isFormValid || submitting) && styles.primaryButtonDisabled]}
            >
              {submitting ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.primaryButtonText}>{mode === 'login' ? 'Log in' : 'Create account'}</Text>
              )}
            </Pressable>

            <Pressable onPress={toggleMode} style={styles.linkButton}>
              <Text style={styles.linkText}>
                {mode === 'login' ? 'Need an account? Sign up' : 'Already have an account? Log in'}
              </Text>
            </Pressable>

            <Text style={styles.helperText}>
              {mode === 'login'
                ? 'Use a valid Firebase-authenticated email and password.'
                : 'Create an account to sign in with Firebase Authentication.'}
            </Text>
          </>
        )}
      </View>

      <View style={styles.bottomNav}>
        {tabs.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[
                styles.navButton,
                isActive ? styles.navButtonActive : styles.navButtonInactive,
              ]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Text
                style={[
                  styles.navButtonText,
                  isActive ? styles.navButtonTextActive : null,
                ]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </KeyboardAvoidingView>
  );
}
