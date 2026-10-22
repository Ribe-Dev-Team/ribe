import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  NativeScrollEvent,
  NativeSyntheticEvent,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { collection, doc, query, where, onSnapshot } from 'firebase/firestore';
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
import { formatTime12h } from './utility/times';
import DriverProfilePage from './pages/DriverProfilePage';
import DriverRegistrationPage from './pages/DriverRegistrationPage';
import BookingPage from './pages/BookingPage';
import { ThemedAlertProvider, useThemedAlert } from './components/ThemedDialog';
import {
  acceptMatch, cancelConfirmedRequest, cancelOffer, declineMatch, deleteRideRequest, driverAcceptMatch,
  driverDeclineMatch, setOfferLocked, updateOfferSeats,
} from './pages/schema/firebaseBookingMethods';
import { db } from './firebaseConfig';
import {
  excludeOwnRequests,
  getOfferNotificationEvents,
  getOfferNotificationText,
  getRiderMatchNotificationText,
  OfferNotificationAudience,
  OfferNotificationState,
} from './services/rideNotifications';

export interface NotificationItem {
  id: string;
  text: string;
  type: 'upcoming' | 'passenger' | 'cancellation';
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
    seats: ride.seats,
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

/** Every action a ride can offer; which ones depends on who and what state.
 *  One type for all of them, so a card can take just Accept/Decline from it. */
interface RideActions {
  onAccept?: () => void;
  onDecline?: () => void;
  onCancel?: () => void;
  onEdit?: () => void;
  onSetLocked?: (locked: boolean) => void;
  onChangeSeats?: (seats: number) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Please try again.';
}

// Shared across Calendar, Home, and Dashboard so the ride details page always offers
// the same Accept/Decline (awaiting), Edit/Cancel, or a driver's Seats/Lock actions, regardless
// of which page you opened it from.
//
// Accept and Decline write to Firestore and then call `onChanged`, which sends the
// user back to the list AND remounts it. Without the remount the list keeps
// rendering the status it fetched on mount, so an accepted ride would appear to
// stay in Awaiting Approval until the app was restarted.
// Editing a booking isn't built yet; the details page's Edit button says so.
function editComingSoon(showAlert: ReturnType<typeof useThemedAlert>, kind?: 'request' | 'offer') {
  showAlert(
    kind === 'offer' ? 'Edit driving offer' : 'Edit ride request',
    kind === 'offer' ? 'Editing this drive offer is coming soon.' : 'Editing this request is coming soon.',
  );
}

function buildRideActions(
  ride: ActionableRide,
  driverName: string,
  onChanged: () => void,
  showAlert: ReturnType<typeof useThemedAlert>,
): RideActions {
  // A match needs both sides to accept. Accept is offered until you have;
  // Decline until the match is confirmed.
  const answering = ride.status === 'awaiting' && Boolean(ride.rideId);

  // A driver answers the rider found for them, and whatever state the offer is
  // in can remove it, lock it, or change its seats.
  if (ride.kind === 'offer') {
    return {
      onEdit: () => editComingSoon(showAlert, 'offer'),
      ...(answering && !ride.youAccepted ? {
        onAccept: async () => {
          try {
            const answer = await driverAcceptMatch(ride.rideId!);
            showAlert(
              answer === 'confirmed' ? 'Rider confirmed' : 'Rider accepted',
              answer === 'confirmed'
                ? 'They have accepted too, so they are now confirmed on this drive.'
                : 'Waiting for the rider to accept as well.',
            );
            onChanged();
          } catch (error) {
            showAlert('Could not accept rider', errorMessage(error));
          }
        },
      } : {}),
      ...(answering ? {
        onDecline: async () => {
          try {
            await driverDeclineMatch(ride.rideId!);
            showAlert('Rider declined', 'They will be matched with another driver, and your seat is open again.');
            onChanged();
          } catch (error) {
            showAlert('Could not decline rider', errorMessage(error));
          }
        },
      } : {}),
      onCancel: async () => {
        if (!ride.rideId) {
          showAlert('Not available yet', 'Removing an offer from this view is not wired up.');
          return;
        }
        try {
          await cancelOffer(ride.rideId);
          showAlert('Offer removed', 'Any rider matched to this drive will be found another driver.');
          onChanged();
        } catch (error) {
          showAlert('Could not remove offer', errorMessage(error));
        }
      },
      onSetLocked: async (locked: boolean) => {
        if (!ride.rideId) return;
        try {
          await setOfferLocked(ride.rideId, locked);
          showAlert(
            locked ? 'Drive locked' : 'Drive unlocked',
            locked
              ? 'No more passengers will be matched to this drive.'
              : 'Your free seats are back in matching.',
          );
          onChanged();
        } catch (error) {
          showAlert(locked ? 'Could not lock drive' : 'Could not unlock drive', errorMessage(error));
        }
      },
      onChangeSeats: async (seats: number) => {
        if (!ride.rideId) return;
        try {
          await updateOfferSeats(ride.rideId, seats);
          showAlert('Seats updated', `This drive now takes ${seats} passenger${seats === 1 ? '' : 's'}.`);
          onChanged();
        } catch (error) {
          showAlert('Could not change seats', errorMessage(error));
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
            showAlert('Not available yet', 'Approving a ride from this view is not wired up.');
            return;
          }
          try {
            const answer = await acceptMatch(ride.rideId!);
            showAlert(
              'Ride accepted',
              answer === 'confirmed'
                ? `Trip with ${driverName} confirmed.`
                : `Waiting for ${driverName} to accept as well.`,
            );
            onChanged();
          } catch (error) {
            showAlert('Could not accept ride', errorMessage(error));
          }
        },
      }),
      onDecline: async () => {
        if (!approvable) {
          showAlert('Not available yet', 'Declining a ride from this view is not wired up.');
          return;
        }
        try {
          await declineMatch(ride.rideId!);
          // Declining cancels the request; the rider books again to be rematched.
          showAlert('Ride declined', 'Your request has been cancelled. Book again to find another driver.');
          onChanged();
        } catch (error) {
          showAlert('Could not decline ride', errorMessage(error));
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
    onEdit: () => editComingSoon(showAlert, 'request'),
    onCancel: async () => {
      if (!ride.rideId) {
        showAlert('Not available yet', 'Cancelling a ride from this view is not wired up.');
        return;
      }
      try {
        await (confirmed ? cancelConfirmedRequest(ride.rideId) : deleteRideRequest(ride.rideId));
        showAlert(
          confirmed ? 'Ride canceled' : 'Ride request canceled',
          confirmed ? 'This ride has been canceled.' : 'This ride request has been canceled.',
        );
        onChanged();
      } catch (error) {
        showAlert('Could not cancel ride', errorMessage(error));
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
    <ThemedAlertProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ThemedAlertProvider>
  );
}

function AppContent() {
  const showAlert = useThemedAlert();
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
    onEdit?: () => void;
    onSetLocked?: (locked: boolean) => void;
    onChangeSeats?: (seats: number) => void;
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

    let currentReqDocs: any[] = [];
    let currentOfferDocs: any[] = [];
    const sessionNotifications: NotificationItem[] = [];
    const offerStates = new Map<string, OfferNotificationState>();
    const offerUnsubscribers = new Map<string, () => void>();

    const syncNotifications = () => {
      const upcomingNotifs: NotificationItem[] = [];

      // Check active requests scheduled for today
      currentReqDocs.forEach((doc) => {
        const data = doc.data();
        if (data.status !== 'cancelled' && isToday(data.date)) {
          upcomingNotifs.push({
            id: `upcoming-req-${doc.id}`,
            text: `Upcoming ride to ${getDestination(data)} today at ${data.departureTime ? formatTime12h(data.departureTime) : 'scheduled time'}.`,
            type: 'upcoming',
          });
        }
      });

      // Check active offers scheduled for today
      currentOfferDocs.forEach((doc) => {
        const data = doc.data();
        if (data.status !== 'cancelled' && isToday(data.date)) {
          upcomingNotifs.push({
            id: `upcoming-offer-${doc.id}`,
            text: `Upcoming drive to ${getDestination(data)} today at ${data.departureTime ? formatTime12h(data.departureTime) : 'scheduled time'}.`,
            type: 'upcoming',
          });
        }
      });

      // Keep event notifications while refreshing today's upcoming reminders.
      setNotificationsList((prev) => {
        const existingEvents = prev.filter((item) => item.type !== 'upcoming');
        const events = [...sessionNotifications, ...existingEvents].filter(
          (item, index, self) => index === self.findIndex((other) => other.id === item.id)
        );
        return [...upcomingNotifs, ...events];
      });
    };

    const appendNotification = (item: NotificationItem) => {
      if (!sessionNotifications.some((existing) => existing.id === item.id)) {
        sessionNotifications.push(item);
      }
      syncNotifications();
    };

    const processOfferState = (offerId: string, data: any, audience: OfferNotificationAudience) => {
      const stateKey = `${audience}:${offerId}`;
      const previous = offerStates.get(stateKey);
      const current: OfferNotificationState = {
        status: data.status,
        pendingRequestId: data.pendingRequestId,
        confirmedRequestIds: data.confirmedRequestIds ?? [],
      };
      offerStates.set(stateKey, current);

      const events = getOfferNotificationEvents(previous, current);
      const relevant = audience === 'rider'
        ? excludeOwnRequests(events, currentReqDocs.map((requestDoc) => requestDoc.id))
        : events;
      for (const event of relevant) {
        const eventId = 'requestId' in event ? event.requestId : Date.now();
        const text = getOfferNotificationText(event, audience, {
          destination: getDestination(data),
          date: formatDate(data.date),
          time: data.departureTime ? formatTime12h(data.departureTime) : 'scheduled time',
        });
        appendNotification({
          id: `offer-event-${audience}-${offerId}-${event.type}-${eventId}`,
          text,
          type: event.type === 'drive-cancelled' || event.type === 'passenger-cancelled'
            ? 'cancellation'
            : 'passenger',
        });
      }
    };

    const subscribeToOffer = (offerId: string, audience: OfferNotificationAudience) => {
      const listenerKey = `${audience}:${offerId}`;
      if (offerUnsubscribers.has(listenerKey)) return;
      const unsubscribe = onSnapshot(
        doc(db, 'rideOffers', offerId),
        (snapshot) => {
          if (snapshot.exists()) processOfferState(snapshot.id, snapshot.data(), audience);
        },
        (err) => console.warn('Offer notification listener failed:', err),
      );
      offerUnsubscribers.set(listenerKey, unsubscribe);
    };

    // Listener for Ride Requests
    const requestOfferIds = new Map<string, string | null>();
    const unsubRequests = onSnapshot(requestsQuery, (snapshot) => {
      currentReqDocs = snapshot.docs;

      snapshot.docs.forEach((requestDoc) => {
        const offerId = requestDoc.data()['matchedOfferId'];
        if (typeof offerId === 'string' && offerId) subscribeToOffer(offerId, 'rider');
      });

      snapshot.docChanges().forEach((change) => {
        const data = change.doc.data();
        const matchedOfferId = typeof data['matchedOfferId'] === 'string' ? data['matchedOfferId'] : null;
        const previousOfferId = requestOfferIds.get(change.doc.id);
        if (matchedOfferId && matchedOfferId !== previousOfferId && data['status'] === 'awaiting') {
          appendNotification({
            id: `request-match-${change.doc.id}-${matchedOfferId}`,
            text: getRiderMatchNotificationText(getDestination(data), formatDate(data['date'])),
            type: 'passenger',
          });
        }
        requestOfferIds.set(change.doc.id, matchedOfferId);

        if (
          change.type === 'removed' ||
          (change.type === 'modified' && data['status'] === 'cancelled')
        ) {
          appendNotification({
            id: `cancel-req-${change.doc.id}`,
            text: `Ride request to ${getDestination(data)} on ${formatDate(data['date'])} at ${data['departureTime'] ? formatTime12h(data['departureTime']) : 'scheduled time'} was cancelled.`,
            type: 'cancellation',
          });
        }
      });

      syncNotifications();
    });

    // Listener for Ride Offers
    const unsubOffers = onSnapshot(offersQuery, (snapshot) => {
      currentOfferDocs = snapshot.docs;
      setHasDrives(snapshot.docs.some((d) => d.data()['status'] !== 'cancelled'));

      snapshot.docChanges().forEach((change) => {
        if (change.type !== 'removed') processOfferState(change.doc.id, change.doc.data(), 'driver');
      });

      syncNotifications();
    });

    return () => {
      unsubRequests();
      unsubOffers();
      offerUnsubscribers.forEach((unsubscribe) => unsubscribe());
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
  const rideActionsFor = (ride: RideCardProps) => buildRideActions(ride, ride.driver.name, afterRideChange, showAlert);

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
          onEdit={selectedRide.onEdit}
          onSetLocked={selectedRide.onSetLocked}
          onChangeSeats={selectedRide.onChangeSeats}
        />
      );
    }
    switch (activeTab) {
      case 'calendar':
        return (
          <CalendarPage
            key={dataVersion}
            onOpenRide={(ride, date) =>
              setSelectedRide({ ride, date, backLabel: 'Calendar', ...buildRideActions(ride, ride.driver, afterRideChange, showAlert) })
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