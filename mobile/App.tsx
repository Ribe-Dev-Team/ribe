import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  NativeScrollEvent,
  NativeSyntheticEvent,
  SafeAreaView,
  StatusBar,
  View,
} from 'react-native';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
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
import OnboardingPage from './pages/OnboardingPage';
import RideDetailPage from './pages/RideDetailPage';
import DriverProfilePage from './pages/DriverProfilePage';
import BookingPage from './pages/BookingPage';
import { deleteRideRequest, deleteRideOffer } from './pages/schema/firebaseBookingMethods';
import { db } from './firebaseConfig';

export interface NotificationItem {
  id: string;
  text: string;
  type: 'upcoming' | 'cancellation';
}

function toDetailRide(ride: RideCardProps): Ride {
  return {
    id: ride.id,
    kind: ride.kind,
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

function buildRideActions(status: 'confirmed' | 'awaiting' | 'pending' | 'cancelled', driverName: string) {
  if (status === 'awaiting') {
    return {
      onAccept: () => Alert.alert('Ride accepted', `Trip with ${driverName} confirmed.`),
      onDecline: () => Alert.alert('Ride declined', 'The driver has been notified.'),
    };
  }
  return {};
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
  const [activeTab, setActiveTab] = useState<NavigationTab>('home');
  const [navHidden, setNavHidden] = useState(false);
  const [notificationsList, setNotificationsList] = useState<NotificationItem[]>([]);
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
  const lastScrollY = useRef(0);

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
    needsProfileSetup,
    completeProfileSetup,
    handleLogin,
    handleSignup,
    handleLogout,
  } = useAuth();
  
  // Global persistent Firestore listeners for real-time notifications
  useEffect(() => {
    if (!user?.uid) {
      setNotificationsList([]);
      return;
    }

    const requestsQuery = query(collection(db, 'rideRequests'), where('userId', '==', user.uid));
    const offersQuery = query(collection(db, 'rideOffers'), where('userId', '==', user.uid));

    // Resolves destination address based on document fields
    const getDestination = (data: any) =>
      data.destinationAddress ||
      data.destination ||
      (data.toUni ? 'Monash University' : 'Home');

    // Formats date into a clean string (e.g., "18 Sep")
    const formatDate = (dateVal: any) => {
      if (!dateVal) return 'today';
      let d: Date;
      if (dateVal?.toDate && typeof dateVal.toDate === 'function') {
        d = dateVal.toDate();
      } else if (dateVal instanceof Date) {
        d = dateVal;
      } else {
        d = new Date(dateVal);
      }
      if (isNaN(d.getTime())) return 'today';
      return d.toLocaleDateString('en-AU', { month: 'short', day: 'numeric' });
    };

    // Checks if a given timestamp/date is today
    const isToday = (dateVal: any) => {
      if (!dateVal) return false;
      let d: Date;
      if (dateVal?.toDate && typeof dateVal.toDate === 'function') {
        d = dateVal.toDate();
      } else if (dateVal instanceof Date) {
        d = dateVal;
      } else {
        d = new Date(dateVal);
      }
      if (isNaN(d.getTime())) return false;

      const today = new Date();
      return (
        d.getFullYear() === today.getFullYear() &&
        d.getMonth() === today.getMonth() &&
        d.getDate() === today.getDate()
      );
    };

    // Sync helper to combine active day-of reminders with existing cancellations
    const syncNotifications = (
      reqDocs: any[],
      offerDocs: any[],
      cancellations: NotificationItem[]
    ) => {
      const upcomingNotifs: NotificationItem[] = [];

      // Check active requests scheduled for today
      reqDocs.forEach((doc) => {
        const data = doc.data();
        if (data.status !== 'cancelled' && isToday(data.date)) {
          upcomingNotifs.push({
            id: `upcoming-req-${doc.id}`,
            text: `Upcoming ride to ${getDestination(data)} today at ${data.departureTime || 'scheduled time'}.`,
            type: 'upcoming',
          });
        }
      });

      // Check active offers scheduled for today
      offerDocs.forEach((doc) => {
        const data = doc.data();
        if (data.status !== 'cancelled' && isToday(data.date)) {
          upcomingNotifs.push({
            id: `upcoming-offer-${doc.id}`,
            text: `Upcoming drive to ${getDestination(data)} today at ${data.departureTime || 'scheduled time'}.`,
            type: 'upcoming',
          });
        }
      });

      // Combine upcoming day-of reminders with accumulated cancellations (deduplicated)
      setNotificationsList((prev) => {
        const existingCancels = prev.filter((n) => n.type === 'cancellation');
        const allCancels = [...cancellations, ...existingCancels].filter(
          (item, index, self) => index === self.findIndex((t) => t.id === item.id)
        );
        return [...upcomingNotifs, ...allCancels];
      });
    };

    let currentReqDocs: any[] = [];
    let currentOfferDocs: any[] = [];
    let pendingCancellations: NotificationItem[] = [];

    // Listener for Ride Requests
    const unsubRequests = onSnapshot(requestsQuery, (snapshot) => {
      currentReqDocs = snapshot.docs;

      snapshot.docChanges().forEach((change) => {
        if (
          change.type === 'removed' ||
          (change.type === 'modified' && change.doc.data().status === 'cancelled')
        ) {
          const data = change.doc.data();
          pendingCancellations.push({
            id: `cancel-req-${change.doc.id}-${Date.now()}`,
            text: `Ride request to ${getDestination(data)} on ${formatDate(data.date)} at ${data.departureTime || 'scheduled time'} was cancelled.`,
            type: 'cancellation',
          });
        }
      });

      syncNotifications(currentReqDocs, currentOfferDocs, pendingCancellations);
    });

    // Listener for Ride Offers
    const unsubOffers = onSnapshot(offersQuery, (snapshot) => {
      currentOfferDocs = snapshot.docs;

      snapshot.docChanges().forEach((change) => {
        if (
          change.type === 'removed' ||
          (change.type === 'modified' && change.doc.data().status === 'cancelled')
        ) {
          const data = change.doc.data();
          pendingCancellations.push({
            id: `cancel-offer-${change.doc.id}-${Date.now()}`,
            text: `Drive offer to ${getDestination(data)} on ${formatDate(data.date)} at ${data.departureTime || 'scheduled time'} was cancelled.`,
            type: 'cancellation',
          });
        }
      });

      syncNotifications(currentReqDocs, currentOfferDocs, pendingCancellations);
    });

    return () => {
      unsubRequests();
      unsubOffers();
    };
  }, [user?.uid]);
  const changeTab = (tab: NavigationTab) => {
    setActiveTab(tab);
    setNavHidden(false);
    lastScrollY.current = 0;
  };

  const handleCancelRide = async (rideId?: string, kind?: 'request' | 'offer') => {
    if (!rideId) {
      Alert.alert('Error', 'Invalid ride identifier.');
      return;
    }

    try {
      console.log(`App: cancelling ${kind ?? 'request'} ID: ${rideId}`);
      if (kind === 'offer') {
        await deleteRideOffer(rideId);
      } else {
        await deleteRideRequest(rideId);
      }
      console.log(`App: successfully cancelled ${rideId}`);
      Alert.alert('Ride Canceled', 'This ride has been removed.');
      setSelectedRide(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('App: cancellation failed', rideId, err);
      Alert.alert('Error', `Failed to cancel ride: ${msg}`);
    }
  };

  const openRideDetails = (rideCard: RideCardProps, backLabel: string) => {
    const detailRide = toDetailRide(rideCard);
    setSelectedRide({
      ride: detailRide,
      date: rideCard.date,
      backLabel,
      ...buildRideActions(rideCard.status, rideCard.driver.name),
      onCancel: () => handleCancelRide(rideCard.id, rideCard.kind),
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
            onOpenRide={(ride, date) => {
              setSelectedRide({
                ride,
                date,
                backLabel: 'Calendar',
                ...buildRideActions(ride.status, ride.driver),
                onCancel: () => handleCancelRide(ride.id, ride.kind),
              });
            }}
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
        return <ProfilePage onLogout={handleLogout} />;
      default:
        return (
          <HomePage
            notificationsList={notificationsList}
            onScroll={handleScroll}
            onOpenProfile={() => changeTab('profile')}
            onNewRide={() => setShowBooking(true)}
            onSeeRideDetails={(ride) => openRideDetails(ride, 'Home')}
            onOpenDriverProfile={setViewingDriver}
          />
        );
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator color={colors.mediumBlue} size="large" />
      </View>
    );
  }

  if (!user) {
    return (
      <AuthPage
        clearError={clearError}
        confirmPassword={confirmPassword}
        dob={dob}
        email={email}
        error={error}
        handleLogin={handleLogin}
        handleSignup={handleSignup}
        mode={mode}
        name={name}
        password={password}
        phoneNumber={phoneNumber}
        setConfirmPassword={setConfirmPassword}
        setDob={setDob}
        setEmail={setEmail}
        setName={setName}
        setPassword={setPassword}
        setPhoneNumber={setPhoneNumber}
        submitting={submitting}
        toggleMode={toggleMode}
      />
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