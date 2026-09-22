import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  NativeScrollEvent,
  NativeSyntheticEvent,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { useFonts, Marcellus_400Regular } from '@expo-google-fonts/marcellus';

import { AuthProvider, useAuth } from './auth/useAuth';
import styles, { colors } from './styles';
import AppNavigation, { NavigationTab } from './components/AppNavigation';
import { RideCardProps } from './components/RideCard';
import AuthPage from './pages/AuthPage';
import HomePage from './pages/HomePage';
import CalendarPage, { Ride } from './pages/CalendarPage';
import DashboardPage from './pages/DashboardPage';
import ProfilePage from './pages/ProfilePage';
import RideDetailPage from './pages/RideDetailPage';
import DriverProfilePage from './pages/DriverProfilePage';
import DriverRegistrationPage from './pages/DriverRegistrationPage';
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
    driverUid: ride.driver.uid,
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
  const [bookingDate, setBookingDate] = useState<Date | null>(null);
  const [showDriverRegistration, setShowDriverRegistration] = useState(false);
  const lastScrollY = useRef(0);
  const wasLoggedIn = useRef(false);

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
    clearError,
    handleLogin,
    handleSignup,
    handleLogout,
  } = useAuth();

  // Always land on the home tab right after a fresh login/signup, rather than
  // wherever the tab happened to be left (e.g. Profile, if that's where the user signed out).
  useEffect(() => {
    if (user && !wasLoggedIn.current) {
      setActiveTab('home');
    }
    wasLoggedIn.current = !!user;
  }, [user]);

  const renderPage = () => {
    if (showBooking) {
      return (
        <BookingPage
          initialDate={bookingDate ?? undefined}
          onDone={() => {
            setShowBooking(false);
            setBookingDate(null);
          }}
        />
      );
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
            onNewRide={(date) => {
              setBookingDate(date);
              setShowBooking(true);
            }}
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
        return (
          <ProfilePage
            onLogout={handleLogout}
            onOpenDriverRegistration={() => setShowDriverRegistration(true)}
          />
        );
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
      <AuthPage
        clearError={clearError}
        error={error}
        handleLogin={handleLogin}
        handleSignup={handleSignup}
        submitting={submitting}
      />
    );
  }

  // 3. Authenticated Main App Screen
  return (
    <SafeAreaView style={styles.appContainer}>
      <StatusBar barStyle="light-content" />

      <View style={styles.contentContainer}>{renderPage()}</View>

      {showDriverRegistration && (
        <View style={StyleSheet.absoluteFill}>
          <DriverRegistrationPage onDone={() => setShowDriverRegistration(false)} />
        </View>
      )}

      <AppNavigation
        activeTab={activeTab}
        onChange={changeTab}
        hidden={navHidden || !!selectedRide || !!viewingDriver || showBooking || showDriverRegistration}
      />
    </SafeAreaView>
  );
}
