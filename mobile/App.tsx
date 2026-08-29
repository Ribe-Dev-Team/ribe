import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar,
  Text,
  TextInput,
  View,
  TouchableWithoutFeedback,
  Keyboard, // <-- Added Keyboard here
} from 'react-native';

import { AuthProvider, useAuth } from './auth/useAuth';
import AppNavigation, { NavigationTab } from './components/AppNavigation';
import styles from './styles';
import CalendarPage from './pages/CalendarPage';
import DrivesPage from './pages/DrivesPage';
import HomePage from './pages/HomePage';
import ProfilePage from './pages/ProfilePage';
import RidesPage from './pages/RidesPage';
import OnboardingPage from './pages/OnboardingPage';

// Define your tabs for the bottom navigation
type TabKey = 'home' | 'calendar' | 'rides' | 'drives' | 'profile';
const tabs: { key: TabKey; label: string }[] = [
  { key: 'home', label: 'Home' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'rides', label: 'Rides' },
  { key: 'drives', label: 'Drives' },
  { key: 'profile', label: 'Profile' },
];

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

function AppContent() {
  const [activeTab, setActiveTab] = useState<NavigationTab>('home');
  const {
    user, loading, submitting, error, mode, clearError, toggleMode,
    name, setName, dob, setDob, phoneNumber, setPhoneNumber,
    email, setEmail, password, setPassword, confirmPassword, setConfirmPassword,
    handleLogin, handleSignup, needsProfileSetup, completeProfileSetup,
  } = useAuth();

  const renderPage = () => {
    switch (activeTab) {
      case 'calendar': return <CalendarPage />;
      case 'rides': return <RidesPage />;
      case 'drives': return <DrivesPage />;
      case 'profile': return <ProfilePage />;
      default: return <HomePage />;
    }
  };

  if (loading) {
    return <View style={styles.loadingScreen}><ActivityIndicator color="#1376BE" size="large" /></View>;
  }

  if (!user) {
    return (
      <TouchableWithoutFeedback onPress={() => Keyboard.dismiss()}>
        <KeyboardAvoidingView
          style={styles.screen}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <StatusBar barStyle="dark-content" />
          <View style={styles.card}>
            <Text style={styles.title}>Ribe</Text>
            <Text style={styles.subtitle}>
              {mode === 'login' ? 'Sign in to continue' : 'Create your account'}
            </Text>

            {mode === 'signup' && (
              <>
                <TextInput
                  autoCapitalize="words"
                  onChangeText={(value) => {
                    setName(value);
                    if (error) clearError();
                  }}
                  placeholder="Name"
                  style={styles.input}
                  value={name}
                />

                <TextInput
                  onChangeText={(value) => {
                    setDob(value);
                    if (error) clearError();
                  }}
                  placeholder="Date of Birth (DD/MM/YYYY)"
                  style={styles.input}
                  value={dob}
                />

                <TextInput
                  autoCapitalize="none"
                  keyboardType="phone-pad"
                  onChangeText={(value) => {
                    setPhoneNumber(value);
                    if (error) clearError();
                  }}
                  placeholder="Phone Number"
                  style={styles.input}
                  value={phoneNumber}
                />
              </>
            )}

            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              onChangeText={(value) => {
                setEmail(value);
                if (error) clearError();
              }}
              placeholder="Email"
              style={styles.input}
              value={email}
            />

            <TextInput
              onChangeText={(value) => {
                setPassword(value);
                if (error) clearError();
              }}
              placeholder="Password"
              secureTextEntry
              style={styles.input}
              value={password}
            />

            {mode === 'signup' && (
              <TextInput
                onChangeText={(value) => {
                  setConfirmPassword(value);
                  if (error) clearError();
                }}
                placeholder="Confirm password"
                secureTextEntry
                style={styles.input}
                value={confirmPassword}
              />
            )}

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <Pressable
              disabled={submitting}
              onPress={mode === 'login' ? handleLogin : handleSignup}
              style={[
                styles.primaryButton,
                submitting && styles.primaryButtonDisabled,
              ]}
            >
              {submitting ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {mode === 'login' ? 'Log in' : 'Create account'}
                </Text>
              )}
            </Pressable>

            <Pressable onPress={toggleMode} style={styles.linkButton}>
              <Text style={styles.linkText}>
                {mode === 'login'
                  ? 'Need an account? Sign up'
                  : 'Already have an account? Log in'}
              </Text>
            </Pressable>

            <Text style={styles.helperText}>
              {mode === 'login'
                ? 'Use a valid Firebase-authenticated email and password.'
                : 'Create an account to sign in with Firebase Authentication.'}
            </Text>
          </View>
        </KeyboardAvoidingView>
      </TouchableWithoutFeedback>
    );
  }

  if (needsProfileSetup) {
    return (
      <OnboardingPage
        onComplete={async (data) => {
          await completeProfileSetup(data);
          setActiveTab('home');
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.appContainer}>
      <StatusBar barStyle="light-content" />
      <View style={styles.contentContainer}>{renderPage()}</View>
      <AppNavigation activeTab={activeTab} onChange={setActiveTab} />
    </SafeAreaView>
  );
}
