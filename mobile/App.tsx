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
import DashboardPage, { DashboardMode } from './pages/DashboardPage';
import ProfilePage from './pages/ProfilePage';
import RideDetailPage from './pages/RideDetailPage';
import { rideTimeSummary } from './services/rideData';
import DriverProfilePage from './pages/DriverProfilePage';
import DriverRegistrationPage from './pages/DriverRegistrationPage';
import BookingPage from './pages/BookingPage';
import {
  acceptMatch, cancelOffer, declineMatch, setOfferLocked, updateOfferSeats,
} from './pages/schema/firebaseBookingMethods';

// Adapts a rich Home/Dashboard ride card into the simpler shape RideDetailPage
// (built for Calendar) expects, so both entry points share the same detail screen.
function toDetailRide(ride: RideCardProps): Ride {
  return {
    rideId: ride.rideId,
    kind: ride.kind,
    status: ride.status,
    ...rideTimeSummary(ride),
    start: ride.pickup.address,
    destination: ride.destination.address,
    driver: ride.driver.name,
    driverUid: ride.driver.uid,
    vehicle: ride.driver.vehicle,
  };
}

/** A ride card or calendar ride, reduced to what the action handlers need. */
interface ActionableRide {
  rideId?: string;
  kind?: 'request' | 'offer';
  status: 'confirmed' | 'awaiting' | 'pending';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Please try again.';
}

// Shared across Calendar, Home, and Dashboard so the ride details page always offers
// the same Accept/Decline (awaiting) or Cancel (confirmed/pending) actions, regardless
// of which page you opened it from.
//
// Accept and Decline write to Firestore and then call `onChanged`, which sends the
// user back to the list AND remounts it. Without the remount the list keeps
// rendering the status it fetched on mount, so an accepted ride would appear to
// stay in Awaiting Approval until the app was restarted.
function buildRideActions(
  ride: ActionableRide,
  driverName: string,
  onChanged: () => void,
) {
  // A driver never answers a match - only the rider does. What a driver can do,
  // whatever state the offer is in, is remove it.
  if (ride.kind === 'offer') {
    return {
      onCancel: async () => {
        if (!ride.rideId) {
          Alert.alert('Not available yet', 'Removing an offer from this view is not wired up.');
          return;
        }
        try {
          await cancelOffer(ride.rideId);
          Alert.alert('Offer removed', 'Any rider matched to this drive will be found another driver.');
          onChanged();
        } catch (error) {
          Alert.alert('Could not remove offer', errorMessage(error));
        }
      },
      onSetLocked: async (locked: boolean) => {
        if (!ride.rideId) return;
        try {
          await setOfferLocked(ride.rideId, locked);
          Alert.alert(
            locked ? 'Drive locked' : 'Drive unlocked',
            locked
              ? 'No more passengers will be matched to this drive.'
              : 'Your free seats are back in matching.',
          );
          onChanged();
        } catch (error) {
          Alert.alert(locked ? 'Could not lock drive' : 'Could not unlock drive', errorMessage(error));
        }
      },
      onChangeSeats: async (seats: number) => {
        if (!ride.rideId) return;
        try {
          await updateOfferSeats(ride.rideId, seats);
          Alert.alert('Seats updated', `This drive now takes ${seats} passenger${seats === 1 ? '' : 's'}.`);
          onChanged();
        } catch (error) {
          Alert.alert('Could not change seats', errorMessage(error));
        }
      },
    };
  }
  if (ride.status === 'awaiting') {
    const approvable = Boolean(ride.rideId);

    return {
      onAccept: async () => {
        if (!approvable) {
          Alert.alert('Not available yet', 'Approving a ride from this view is not wired up.');
          return;
        }
        try {
          await acceptMatch(ride.rideId!);
          Alert.alert('Ride accepted', `Trip with ${driverName} confirmed.`);
          onChanged();
        } catch (error) {
          Alert.alert('Could not accept ride', errorMessage(error));
        }
      },
      onDecline: async () => {
        if (!approvable) {
          Alert.alert('Not available yet', 'Declining a ride from this view is not wired up.');
          return;
        }
        try {
          await declineMatch(ride.rideId!);
          // Declining cancels the request; the rider books again to be rematched.
          Alert.alert('Ride declined', 'Your request has been cancelled. Book again to find another driver.');
          onChanged();
        } catch (error) {
          Alert.alert('Could not decline ride', errorMessage(error));
        }
      },
    };
  }
  // NOTE: a rider cancelling is still a local alert only — it has no Firestore
  // write yet, so a cancelled ride reappears on the next fetch.
  if (ride.status === 'confirmed') {
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
  // Bumped after a write so the ride lists remount and refetch. See afterRideChange.
  const [dataVersion, setDataVersion] = useState(0);
  // The Dashboard's Rider/Driver toggle lives here, not in the page: the page is
  // remounted after every write (see afterRideChange) and on the way back from
  // a ride's details, which would otherwise flip it back to Rider each time.
  const [dashboardMode, setDashboardMode] = useState<DashboardMode>('rider');
  const lastScrollY = useRef(0);
  const wasLoggedIn = useRef(false);

  const changeTab = (tab: NavigationTab) => {
    setActiveTab(tab);
    setNavHidden(false);
    lastScrollY.current = 0;
  };

  // Return to the list the user came from and remount it, so it refetches the
  // statuses that were just written rather than reusing its mount-time snapshot.
  const afterRideChange = () => {
    setSelectedRide(null);
    setDataVersion((version) => version + 1);
  };

  // The same handlers for a card's own Accept button as for its details page, so
  // accepting from a Home or Dashboard card really writes, not just confirms on screen.
  const rideActionsFor = (ride: RideCardProps) => buildRideActions(ride, ride.driver.name, afterRideChange);

  const openRideDetails = (ride: RideCardProps, backLabel: string) => {
    setSelectedRide({
      ride: toDetailRide(ride),
      date: ride.date,
      backLabel,
      ...rideActionsFor(ride),
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
            key={dataVersion}
            onOpenRide={(ride, date) =>
              setSelectedRide({ ride, date, backLabel: 'Calendar', ...buildRideActions(ride, ride.driver, afterRideChange) })
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
            key={dataVersion}
            onScroll={handleScroll}
            onSeeRideDetails={(ride) => openRideDetails(ride, 'My Rides')}
            onOpenDriverProfile={setViewingDriver}
            rideActions={rideActionsFor}
            mode={dashboardMode}
            onModeChange={setDashboardMode}
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
            key={dataVersion}
            onScroll={handleScroll}
            onOpenProfile={() => changeTab('profile')}
            onNewRide={() => setShowBooking(true)}
            onSeeRideDetails={(ride) => openRideDetails(ride, 'Home')}
            onOpenDriverProfile={setViewingDriver}
            rideActions={rideActionsFor}
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
