import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';

import { auth } from './firebaseConfig';
import HomePage from './pages/HomePage';
import CalendarPage from './pages/CalendarPage';
import RidesPage from './pages/RidesPage';
import DrivesPage from './pages/DrivesPage';
import ProfilePage from './pages/ProfilePage';

const tabs = [
  { key: 'home', label: 'Home' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'rides', label: 'Rides' },
  { key: 'drives', label: 'Drives' },
  { key: 'profile', label: 'Profile' },
] as const;

type TabKey = (typeof tabs)[number]['key'];

export default function App() {
  // Navigation State
  const [activeTab, setActiveTab] = useState<TabKey>('home');

  // Auth State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const isFormValid = useMemo(
    () => email.trim().length > 0 && password.trim().length > 0,
    [email, password]
  );

  const handleLogin = async () => {
    if (!isFormValid || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to sign in right now.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    setError(null);
    try {
      await firebaseSignOut(auth);
      setEmail('');
      setPassword('');
      setActiveTab('home'); // Reset to home on logout
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to sign out right now.';
      setError(message);
    }
  };

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

  // 1. Show loading screen while checking Firebase Auth
  if (loading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator color="#2563eb" size="large" />
        <Text style={styles.loadingText}>Connecting to Firebase…</Text>
      </View>
    );
  }

  // 2. Show Login Screen if user is NOT authenticated
  if (!user) {
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.screen}
      >
        <StatusBar barStyle="dark-content" />
        <View style={styles.card}>
          <Text style={styles.title}>Ribe</Text>
          <Text style={styles.subtitle}>Sign in to continue</Text>

          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            onChangeText={(value) => {
              setEmail(value);
              if (error) setError(null);
            }}
            placeholder="Email"
            style={styles.input}
            value={email}
          />

          <TextInput
            onChangeText={(value) => {
              setPassword(value);
              if (error) setError(null);
            }}
            placeholder="Password"
            secureTextEntry
            style={styles.input}
            value={password}
          />

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <Pressable
            disabled={!isFormValid || submitting}
            onPress={handleLogin}
            style={[
              styles.primaryButton,
              (!isFormValid || submitting) && styles.primaryButtonDisabled,
            ]}
          >
            {submitting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.primaryButtonText}>Log in</Text>
            )}
          </Pressable>

          <Text style={styles.helperText}>
            Use a valid Firebase-authenticated email and password.
          </Text>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // 3. Show Main App if user IS authenticated
  return (
    <SafeAreaView style={styles.appContainer}>
      <StatusBar barStyle="dark-content" />
      
      {/* Top Header (Optional: Can be moved to ProfilePage later) */}
      <View style={styles.header}>
        <Text style={styles.headerText}>Hi, {user.email}</Text>
        <TouchableOpacity onPress={handleLogout}>
          <Text style={styles.logoutText}>Sign out</Text>
        </TouchableOpacity>
      </View>

      {/* Main Content Area */}
      <View style={styles.contentContainer}>
        {renderPage()}
      </View>

      {/* Bottom Navigation */}
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // Auth Styles
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
  errorText: {
    color: '#b91c1c',
    fontSize: 13,
    marginBottom: 8,
  },

  // Main App Styles
  appContainer: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  headerText: {
    fontSize: 14,
    color: '#475569',
    fontWeight: '500',
  },
  logoutText: {
    color: '#2563eb',
    fontSize: 14,
    fontWeight: '600',
  },
  contentContainer: {
    flex: 1,
  },
  
  // Navigation Styles
  bottomNav: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderColor: '#e2e8f0',
    paddingBottom: Platform.OS === 'ios' ? 20 : 0, // safe area spacing for iPhones
  },
  navButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
  },
  navButtonActive: {
    borderTopWidth: 2,
    borderColor: '#2563eb',
    marginTop: -1, // Overlaps the border Top width cleanly
  },
  navButtonInactive: {
    borderTopWidth: 2,
    borderColor: 'transparent',
    marginTop: -1,
  },
  navButtonText: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '500',
  },
  navButtonTextActive: {
    color: '#2563eb',
    fontWeight: '700',
  },
});
