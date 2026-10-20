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
import RideDetailPage from './pages/RideDetailPage';
import { rideTimeSummary } from './services/rideData';
import DriverProfilePage from './pages/DriverProfilePage';
import DriverRegistrationPage from './pages/DriverRegistrationPage';
import BookingPage from './pages/BookingPage';
import {
  acceptMatch, cancelConfirmedRequest, cancelOffer, declineMatch, deleteRideRequest, driverAcceptMatch,
  driverDeclineMatch, setOfferLocked, updateOfferSeats,
} from './pages/schema/firebaseBookingMethods';
import { db } from './firebaseConfig';

export interface NotificationItem {
  id: string;
  text: string;
  type: 'upcoming' | 'cancellation';
}

function toDetailRide(ride: RideCardProps): Ride {
  return {
    rideId: ride.rideId,
    id: ride.id,
    kind: ride.kind,
    status: ride.status,
    ...rideTimeSummary(ride),
    start: ride.pickup.address,
    destination: ride.destination.address,
    driver: ride.driver.name,
    driverUid: ride.driver.uid,
    vehicle: ride.driver.vehicle,
    youAccepted: ride.youAccepted,
    otherAccepted: ride.otherAccepted,
    rider: ride.rider,
    co2SavedKg: ride.co2SavedKg,
    costSplit: ride.costSplit,
  };
}

/** A ride card or calendar ride, reduced to what the action handlers need. */
interface ActionableRide {
  rideId?: string;
  kind?: 'request' | 'offer';
  status: 'confirmed' | 'awaiting' | 'pending' | 'cancelled';
  /** Awaiting only: this person has already accepted the match. */
  youAccepted?: boolean;
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
  // A match needs both sides to accept. Accept is offered until you have;
  // Decline until the match is confirmed.
  const answering = ride.status === 'awaiting' && Boolean(ride.rideId);

  // A driver answers the rider found for them, and whatever state the offer is
  // in can remove it, lock it, or change its seats.
  if (ride.kind === 'offer') {
    return {
      ...(answering && !ride.youAccepted ? {
        onAccept: async () => {
          try {
            const answer = await driverAcceptMatch(ride.rideId!);
            Alert.alert(
              answer === 'confirmed' ? 'Rider confirmed' : 'Rider accepted',
              answer === 'confirmed'
                ? 'They have accepted too, so they are now confirmed on this drive.'
                : 'Waiting for the rider to accept as well.',
            );
            onChanged();
          } catch (error) {
            Alert.alert('Could not accept rider', errorMessage(error));
          }
        },
      } : {}),
      ...(answering ? {
        onDecline: async () => {
          try {
            await driverDeclineMatch(ride.rideId!);
            Alert.alert('Rider declined', 'They will be matched with another driver, and your seat is open again.');
            onChanged();
          } catch (error) {
            Alert.alert('Could not decline rider', errorMessage(error));
          }
        },
      } : {}),
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
      ...(ride.youAccepted ? {} : {
        onAccept: async () => {
          if (!approvable) {
            Alert.alert('Not available yet', 'Approving a ride from this view is not wired up.');
            return;
          }
          try {
            const answer = await acceptMatch(ride.rideId!);
            Alert.alert(
              'Ride accepted',
              answer === 'confirmed'
                ? `Trip with ${driverName} confirmed.`
                : `Waiting for ${driverName} to accept as well.`,
            );
            onChanged();
          } catch (error) {
            Alert.alert('Could not accept ride', errorMessage(error));
          }
        },
      }),
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
  // A rider cancelling an unmatched request deletes it. A confirmed one is
  // marked cancelled instead, so the runner can free their seat on the driver's
  // offer. Drivers never reach this - an offer is removed through cancelOffer
  // above, which the matcher relies on.
  const confirmed = ride.status === 'confirmed';
  return {
    onCancel: async () => {
      if (!ride.rideId) {
        Alert.alert('Not available yet', 'Cancelling a ride from this view is not wired up.');
        return;
      }
      try {
        await (confirmed ? cancelConfirmedRequest(ride.rideId) : deleteRideRequest(ride.rideId));
        Alert.alert(
          confirmed ? 'Ride canceled' : 'Ride request canceled',
          confirmed ? 'This ride has been canceled.' : 'This ride request has been canceled.',
        );
        onChanged();
      } catch (error) {
        Alert.alert('Could not cancel ride', errorMessage(error));
      }
    },
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
  const [showDriverRegistration, setShowDriverRegistration] = useState(false);
  // Bumped after a write so the ride lists remount and refetch. See afterRideChange.
  const [dataVersion, setDataVersion] = useState(0);
  // Whether the user has a drive offer that isn't cancelled - from the offers
  // listener below. Anyone can post a drive from the booking page, registered
  // driver or not, so this keeps My Drives for them too.
  const [hasDrives, setHasDrives] = useState(false);
  const lastScrollY = useRef(0);
  const wasLoggedIn = useRef(false);

  const {
    user,
    profileData,
    loading,
    submitting,
    error,
    clearError,
    handleLogin,
    handleSignup,
    handleLogout,
  } = useAuth();

  // My Drives is its own tab for drivers - registered ones, and anyone with a
  // drive posted. Everyone else gets no tab for it, and is moved off it if it
  // goes (their last drive was removed, say).
  const showDrives = Boolean(profileData?.isDriver) || hasDrives;
  useEffect(() => {
    if (!showDrives && activeTab === 'drives') setActiveTab('home');
  }, [showDrives, activeTab]);
  
  // Global persistent Firestore listeners for real-time notifications
  useEffect(() => {
    if (!user?.uid) {
      setNotificationsList([]);
      setHasDrives(false);
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
          (change.type === 'modified' && change.doc.data()['status'] === 'cancelled')
        ) {
          const data = change.doc.data();
          pendingCancellations.push({
            id: `cancel-req-${change.doc.id}-${Date.now()}`,
            text: `Ride request to ${getDestination(data)} on ${formatDate(data['date'])} at ${data['departureTime'] || 'scheduled time'} was cancelled.`,
            type: 'cancellation',
          });
        }
      });

      syncNotifications(currentReqDocs, currentOfferDocs, pendingCancellations);
    });

    // Listener for Ride Offers
    const unsubOffers = onSnapshot(offersQuery, (snapshot) => {
      currentOfferDocs = snapshot.docs;
      setHasDrives(snapshot.docs.some((d) => d.data()['status'] !== 'cancelled'));

      snapshot.docChanges().forEach((change) => {
        if (
          change.type === 'removed' ||
          (change.type === 'modified' && change.doc.data()['status'] === 'cancelled')
        ) {
          const data = change.doc.data();
          pendingCancellations.push({
            id: `cancel-offer-${change.doc.id}-${Date.now()}`,
            text: `Drive offer to ${getDestination(data)} on ${formatDate(data['date'])} at ${data['departureTime'] || 'scheduled time'} was cancelled.`,
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

  // Return to the list the user came from and remount it, so it refetches the
  // statuses that were just written rather than reusing its mount-time snapshot.
  const afterRideChange = () => {
    setSelectedRide(null);
    setDataVersion((version) => version + 1);
  };

  // The same handlers for a card's own Accept button as for its details page, so
  // accepting from a Home or Dashboard card really writes, not just confirms on screen.
  const rideActionsFor = (ride: RideCardProps) => buildRideActions(ride, ride.driver.name, afterRideChange);

  const openRideDetails = (rideCard: RideCardProps, backLabel: string) => {
    const detailRide = toDetailRide(rideCard);
    setSelectedRide({
      ride: detailRide,
      date: rideCard.date,
      backLabel,
      ...rideActionsFor(rideCard),
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
      case 'drives':
        return (
          <DashboardPage
            key={`${activeTab}-${dataVersion}`}
            onScroll={handleScroll}
            onSeeRideDetails={(ride) => openRideDetails(ride, activeTab === 'drives' ? 'My Drives' : 'My Rides')}
            onOpenDriverProfile={setViewingDriver}
            rideActions={rideActionsFor}
            mode={activeTab === 'drives' ? 'driver' : 'rider'}
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
            notificationsList={notificationsList}
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
        showDrives={showDrives}
        hidden={navHidden || !!selectedRide || !!viewingDriver || showBooking || showDriverRegistration}
      />
    </SafeAreaView>
  );
}