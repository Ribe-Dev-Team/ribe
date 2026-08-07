import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
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

export default function App() {
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
        <Text style={styles.loadingText}>Connecting to Firebase…</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.screen}
    >
      <StatusBar barStyle="dark-content" />

      <View style={styles.card}>
        {user ? (
          <View style={styles.successContainer}>
            <Text style={styles.title}>Welcome back</Text>
            <Text style={styles.subtitle}>You’re signed in as {user.email || 'a member'}.</Text>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <Pressable style={styles.primaryButton} onPress={handleLogout}>
              <Text style={styles.primaryButtonText}>Sign out</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.title}>Ribe</Text>
            <Text style={styles.subtitle}>{mode === 'login' ? 'Sign in to continue' : 'Create your account'}</Text>

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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f8fafc',
    justifyContent: 'center',
    padding: 24,
  },
  loadingScreen: {
    flex: 1,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    color: '#475569',
    fontSize: 15,
    marginTop: 12,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 24,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 4,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#475569',
    marginBottom: 20,
  },
  input: {
    borderColor: '#cbd5e1',
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#2563eb',
    borderRadius: 12,
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  primaryButtonDisabled: {
    backgroundColor: '#93c5fd',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  helperText: {
    color: '#64748b',
    fontSize: 13,
    marginTop: 12,
    textAlign: 'center',
  },
  linkButton: {
    marginTop: 10,
  },
  linkText: {
    color: '#2563eb',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  errorText: {
    color: '#b91c1c',
    fontSize: 13,
    marginBottom: 8,
  },
  successContainer: {
    alignItems: 'center',
  },
});
