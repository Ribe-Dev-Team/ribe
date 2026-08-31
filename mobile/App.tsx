import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { RideCardProps } from './components/RideCard';
import HomePage from './pages/HomePage';
import CalendarPage, { Ride } from './pages/CalendarPage';
import DashboardPage from './pages/DashboardPage';
import ProfilePage from './pages/ProfilePage';
import OnboardingPage from './pages/OnboardingPage';
import RideDetailPage from './pages/RideDetailPage';
import DriverProfilePage from './pages/DriverProfilePage';
import BookingPage from './pages/BookingPage';

// Adapts a rich Home/Dashboard ride card into the simpler shape RideDetailPage
// (built for Calendar) expects, so both entry points share the same detail screen.
function toDetailRide(ride: RideCardProps): Ride {
  return {
    status: ride.status,
    time: ride.pickup.time,
    duration: `${ride.etaMinutes} min`,
    start: ride.pickup.address,
    destination: ride.destination.address,
    driver: ride.driver.name,
    vehicle: ride.driver.vehicle,
  };
}

// Shared across Calendar, Home, and Dashboard so the ride details page always offers
// the same Accept/Decline (awaiting) or Cancel (confirmed/pending) actions, regardless
// of which page you opened it from.
function buildRideActions(status: 'confirmed' | 'awaiting' | 'pending', driverName: string) {
  if (status === 'awaiting') {
    return {
      onAccept: () => Alert.alert('Ride accepted', `Trip with ${driverName} confirmed.`),
      onDecline: () => Alert.alert('Ride declined', 'The driver has been notified.'),
    };
  }
  if (status === 'confirmed') {
    return {
      onCancel: () => Alert.alert('Ride canceled', 'This ride has been canceled.'),
    };
  }
  return {
    onCancel: () => Alert.alert('Ride request canceled', 'This ride request has been canceled.'),
  };
}

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
  const [selectedRide, setSelectedRide] = useState<{
    ride: Ride;
    date: Date;
    backLabel: string;
    onAccept?: () => void;
    onDecline?: () => void;
    onCancel?: () => void;
  } | null>(null);
  const [viewingDriver, setViewingDriver] = useState<RideCardProps | null>(null);
  const [showBooking, setShowBooking] = useState(false);
  const lastScrollY = useRef(0);

  const changeTab = (tab: NavigationTab) => {
    setActiveTab(tab);
    setNavHidden(false);
    lastScrollY.current = 0;
  };

  const openRideDetails = (ride: RideCardProps, backLabel: string) => {
    setSelectedRide({
      ride: toDetailRide(ride),
      date: ride.date,
      backLabel,
      ...buildRideActions(ride.status, ride.driver.name),
    });
  };

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
    if (showBooking) {
      return <BookingPage onDone={() => setShowBooking(false)} />;
    }
    if (viewingDriver) {
      return <DriverProfilePage ride={viewingDriver} onBack={() => setViewingDriver(null)} />;
    }
    if (selectedRide) {
      return (
        <RideDetailPage
          ride={selectedRide.ride}
          date={selectedRide.date}
          backLabel={selectedRide.backLabel}
          onBack={() => setSelectedRide(null)}
          onAccept={selectedRide.onAccept}
          onDecline={selectedRide.onDecline}
          onCancel={selectedRide.onCancel}
        />
      );
    }
    switch (activeTab) {
      case 'calendar':
        return (
          <CalendarPage
            onOpenRide={(ride, date) =>
              setSelectedRide({ ride, date, backLabel: 'Calendar', ...buildRideActions(ride.status, ride.driver) })
            }
            onNewRide={() => setShowBooking(true)}
          />
        );
      case 'rides':
        return (
          <DashboardPage
            onScroll={handleScroll}
            onSeeRideDetails={(ride) => openRideDetails(ride, 'My Rides')}
            onOpenDriverProfile={setViewingDriver}
          />
        );
      case 'profile':
        return <ProfilePage onLogout={handleLogout} />;
      default:
        return (
          <HomePage
            onScroll={handleScroll}
            onOpenProfile={() => changeTab('profile')}
            onNewRide={() => setShowBooking(true)}
            onSeeRideDetails={(ride) => openRideDetails(ride, 'Home')}
            onOpenDriverProfile={setViewingDriver}
          />
        );
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
          changeTab('home');
        }}
      />
    );
  }

  // 3. Authenticated Main App Screen
  return (
    <SafeAreaView style={styles.appContainer}>
      <StatusBar barStyle="light-content" />

      <View style={styles.contentContainer}>{renderPage()}</View>

      <AppNavigation
        activeTab={activeTab}
        onChange={changeTab}
        hidden={navHidden || !!selectedRide || !!viewingDriver || showBooking}
      />
    </SafeAreaView>
  );
}
