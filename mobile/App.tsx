import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar,
  Text,
  TextInput,
  View,
  TouchableWithoutFeedback,
  Keyboard,
} from 'react-native';
import { useFonts, Marcellus_400Regular } from '@expo-google-fonts/marcellus';

import { AuthProvider, useAuth } from './auth/useAuth';
import styles, { colors } from './styles';
import AppNavigation, { NavigationTab } from './components/AppNavigation';
import HomePage from './pages/HomePage';
import CalendarPage, { Ride } from './pages/CalendarPage';
import DashboardPage from './pages/DashboardPage';
import ProfilePage from './pages/ProfilePage';
import OnboardingPage from './pages/OnboardingPage';
import RideDetailPage from './pages/RideDetailPage';

export default function App() {
  const [fontsLoaded] = useFonts({ Marcellus_400Regular });

  if (!fontsLoaded) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator color={colors.mediumBlue} size="large" />
      </View>
    );
  }

  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

function AppContent() {
  // Navigation State
  const [activeTab, setActiveTab] = useState<NavigationTab>('home');
  const [navHidden, setNavHidden] = useState(false);
  const [selectedRide, setSelectedRide] = useState<{ ride: Ride; date: Date } | null>(null);
  const lastScrollY = useRef(0);

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = event.nativeEvent.contentOffset.y;
    const diff = y - lastScrollY.current;
    if (Math.abs(diff) > 6) {
      setNavHidden(diff > 0 && y > 20);
      lastScrollY.current = y;
    }
  };

  const {
    user,
    loading,
    submitting,
    error,
    mode,
    clearError,
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
    completeProfileSetup,
    handleLogin,
    handleSignup,
    handleLogout,
  } = useAuth();

  const renderPage = () => {
    if (selectedRide) {
      return (
        <RideDetailPage
          ride={selectedRide.ride}
          date={selectedRide.date}
          onBack={() => setSelectedRide(null)}
        />
      );
    }
    switch (activeTab) {
      case 'calendar':
        return <CalendarPage onOpenRide={(ride, date) => setSelectedRide({ ride, date })} />;
      case 'rides':
        return <DashboardPage onScroll={handleScroll} />;
      case 'profile':
        return <ProfilePage onLogout={handleLogout} />;
      default:
        return <HomePage onScroll={handleScroll} />;
    }
  };

  // 1. Loading Screen
  if (loading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator color={colors.mediumBlue} size="large" />
      </View>
    );
  }

  // 2. Unauthenticated Screen (Login/Signup form)
  if (!user) {
    return (
      <TouchableWithoutFeedback onPress={() => Keyboard.dismiss()}>
        <KeyboardAvoidingView
          style={styles.screen}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <StatusBar barStyle="light-content" />
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
              disabled={!isFormValid || submitting}
              onPress={mode === 'login' ? handleLogin : handleSignup}
              style={[
                styles.primaryButton,
                (!isFormValid || submitting) && styles.primaryButtonDisabled,
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

  // 3. Authenticated Main App Screen
  return (
    <SafeAreaView style={styles.appContainer}>
      <StatusBar barStyle="light-content" />

      <View style={styles.contentContainer}>{renderPage()}</View>

      <AppNavigation activeTab={activeTab} onChange={setActiveTab} hidden={navHidden || !!selectedRide} />
    </SafeAreaView>
  );
}
