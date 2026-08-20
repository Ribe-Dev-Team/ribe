import React from 'react';
import {
  ActivityIndicator,
  View,
} from 'react-native';

// Make sure all these imports exist in your project path
import { AuthProvider, useAuth } from './auth/useAuth';
import styles from './styles';
import { MenuPage } from './pages/MenuPage';
import { AuthPage } from './pages/AuthPage';

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

function AppContent(): React.JSX.Element {

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
    handleLogin,
    handleSignup,
    handleLogout,
  } = useAuth();

  // 1. Loading Screen
  if (loading) {
    return (
      <View style={ styles.loadingScreen }>
        <ActivityIndicator color="#2563eb" size="large" />
      </View>
    );
  }

  // 2. Unauthenticated Screen (Login/Signup form)
  if (!user) { return AuthPage(); }

  // 3. Authenticated Main App Screen
  return MenuPage();
}

// styles are centralized in mobile/styles.ts