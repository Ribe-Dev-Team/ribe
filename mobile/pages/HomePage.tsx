import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../styles';
import { useAuth } from '../auth/useAuth';
import RideCard, { RideCardProps } from '../components/RideCard';
import { buildRideCard, FirestoreRideRecord } from '../services/rideData';
import { deleteRideRequest, deleteRideOffer } from './schema/firebaseBookingMethods';
import { NotificationItem } from '../App';
import { db } from '../firebaseConfig';

interface HomePageProps {
  notificationsList: NotificationItem[];
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onOpenProfile: () => void;
  onNewRide: () => void;
  onSeeRideDetails: (ride: RideCardProps) => void;
  onOpenDriverProfile: (ride: RideCardProps) => void;
}

function ridesDescription(count: number, noun: 'ride' | 'drive') {
  if (count === 0) return `No ${noun}s scheduled for today.`;
  if (count === 1) return `You have 1 upcoming ${noun} today.`;
  return `You have ${count} upcoming ${noun}s today.`;
}

export default function HomePage({
  notificationsList,
  onScroll,
  onOpenProfile,
  onNewRide,
  onSeeRideDetails,
  onOpenDriverProfile,
}: HomePageProps) {
  const { user } = useAuth();
  const firstName = user?.displayName?.split(' ')[0] || 'there';
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [todaysRides, setTodaysRides] = useState<RideCardProps[]>([]);
  const [todaysDrives, setTodaysDrives] = useState<RideCardProps[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid) {
      setTodaysRides([]);
      setTodaysDrives([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const today = new Date();
    const isToday = (d: Date) =>
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate();

    const requestsQuery = query(
      collection(db, 'rideRequests'),
      where('userId', '==', user.uid)
    );

    const offersQuery = query(
      collection(db, 'rideOffers'),
      where('userId', '==', user.uid)
    );

    // Real-time listener for Requests
    const unsubscribeRequests = onSnapshot(requestsQuery, (snapshot) => {
      const fetchedRequests: RideCardProps[] = [];
      snapshot.docs.forEach((docSnap) => {
        const data = docSnap.data() as FirestoreRideRecord;
        if (data.status === 'cancelled') return;

        const rideCard = buildRideCard(data, 'request', docSnap.id);
        if (isToday(rideCard.date)) {
          fetchedRequests.push(rideCard);
        }
      });
      setTodaysRides(fetchedRequests);
      setLoading(false);
    });

    // Real-time listener for Offers
    const unsubscribeOffers = onSnapshot(offersQuery, (snapshot) => {
      const fetchedOffers: RideCardProps[] = [];
      snapshot.docs.forEach((docSnap) => {
        const data = docSnap.data() as FirestoreRideRecord;
        if (data.status === 'cancelled') return;

        const driveCard = buildRideCard(data, 'offer', docSnap.id);
        if (isToday(driveCard.date)) {
          fetchedOffers.push(driveCard);
        }
      });
      setTodaysDrives(fetchedOffers);
      setLoading(false);
    });

    return () => {
      unsubscribeRequests();
      unsubscribeOffers();
    };
  }, [user?.uid]);

  const handleCancelRequest = async (ride: RideCardProps) => {
    try {
      console.log('HomePage: cancel ride request - attempting', ride.id);
      await deleteRideRequest(ride.id ?? '');
      console.log('HomePage: cancel ride request - success', ride.id);
      Alert.alert('Canceled', 'Ride request canceled.');
    } catch (err) {
      console.warn('Failed to cancel ride request:', err);
    }
  };

  const handleCancelOffer = async (drive: RideCardProps) => {
    try {
      console.log('HomePage: cancel ride offer - attempting', drive.id);
      await deleteRideOffer(drive.id ?? '');
      console.log('HomePage: cancel ride offer - success', drive.id);
      Alert.alert('Canceled', 'Ride offer canceled.');
    } catch (err) {
      console.warn('Failed to cancel ride offer:', err);
    }
  };

  return (
    <ScrollView
      style={localStyles.scrollView}
      contentContainerStyle={localStyles.scrollContent}
      onScroll={onScroll}
      scrollEventThrottle={16}
    >
      <View style={localStyles.header}>
        <Text style={localStyles.welcomeText}>Welcome, {firstName}</Text>
        <View style={localStyles.headerIcons}>
          <View>
            <TouchableOpacity
              accessibilityLabel="Notifications"
              style={localStyles.iconButton}
              onPress={() => setNotificationsOpen((v) => !v)}
            >
              <Ionicons name="notifications-outline" size={22} color={colors.white} />
              {notificationsList.length > 0 && <View style={localStyles.badgeDot} />}
            </TouchableOpacity>
            {notificationsOpen && (
              <View style={localStyles.notificationsDropdown}>
                {notificationsList.length === 0 ? (
                  <Text style={localStyles.emptyNotificationText}>No new notifications.</Text>
                ) : (
                  notificationsList.map((item) => (
                    <View key={item.id} style={localStyles.notificationRow}>
                      <Ionicons
                        name={item.type === 'cancellation' ? 'alert-circle' : 'ellipse'}
                        size={item.type === 'cancellation' ? 12 : 6}
                        color={item.type === 'cancellation' ? '#E53E3E' : colors.mediumBlue}
                        style={{ marginTop: item.type === 'cancellation' ? 2 : 5 }}
                      />
                      <Text style={localStyles.notificationText}>{item.text}</Text>
                    </View>
                  ))
                )}
              </View>
            )}
          </View>
          <TouchableOpacity accessibilityLabel="Profile" style={localStyles.avatarButton} onPress={onOpenProfile}>
            <Ionicons name="person" size={18} color={colors.white} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={localStyles.ctaRow}>
        <Text style={localStyles.ctaText}>Ready to find a ride?</Text>
        <TouchableOpacity style={localStyles.newRideButton} onPress={onNewRide}>
          <Ionicons name="add" size={18} color={colors.white} />
          <Text style={localStyles.newRideButtonText}>New Ride</Text>
        </TouchableOpacity>
      </View>

      <Text style={localStyles.sectionHeading}>Today's Rides</Text>
      <Text style={localStyles.sectionDescription}>
        {loading ? 'Loading rides...' : ridesDescription(todaysRides.length, 'ride')}
      </Text>

      {loading ? (
        <View style={localStyles.loadingState}>
          <ActivityIndicator color={colors.white} size="small" />
        </View>
      ) : todaysRides.length === 0 ? (
        <Text style={localStyles.emptyState}>No rides scheduled yet.</Text>
      ) : (
        todaysRides.map((ride, index) => (
          <RideCard
            key={`${ride.date.toISOString()}-${index}`}
            {...ride}
            onSeeDetails={() => onSeeRideDetails(ride)}
            onOpenDriverProfile={() => onOpenDriverProfile(ride)}
            onCancel={() => handleCancelRequest(ride)}
          />
        ))
      )}

      <Text style={localStyles.sectionHeading}>Today's Drives</Text>
      <Text style={localStyles.sectionDescription}>
        {loading ? 'Loading drives...' : ridesDescription(todaysDrives.length, 'drive')}
      </Text>

      {loading ? (
        <View style={localStyles.loadingState}>
          <ActivityIndicator color={colors.white} size="small" />
        </View>
      ) : todaysDrives.length === 0 ? (
        <Text style={localStyles.emptyState}>No drives scheduled yet.</Text>
      ) : (
        todaysDrives.map((drive, index) => (
          <RideCard
            key={`${drive.date.toISOString()}-${index}`}
            {...drive}
            onSeeDetails={() => onSeeRideDetails(drive)}
            onOpenDriverProfile={() => onOpenDriverProfile(drive)}
            onCancel={() => handleCancelOffer(drive)}
          />
        ))
      )}
    </ScrollView>
  );
}

const localStyles = StyleSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: colors.darkBlue,
  },
  scrollContent: {
    flexGrow: 1,
    paddingTop: 40,
    paddingHorizontal: 24,
    paddingBottom: 120,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
    zIndex: 10,
  },
  welcomeText: {
    fontFamily: 'Marcellus_400Regular',
    fontSize: 28,
    color: colors.white,
  },
  headerIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E53E3E',
  },
  avatarButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  notificationsDropdown: {
    position: 'absolute',
    top: 42,
    right: 0,
    width: 260,
    borderRadius: 16,
    padding: 14,
    backgroundColor: colors.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 10,
    zIndex: 20,
  },
  notificationRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  notificationText: {
    flex: 1,
    color: colors.darkBlue,
    fontSize: 12,
    lineHeight: 17,
  },
  emptyNotificationText: {
    color: colors.darkBlue,
    fontSize: 12,
    textAlign: 'center',
    opacity: 0.6,
  },
  ctaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 28,
  },
  ctaText: {
    color: colors.white,
    fontSize: 16,
    flex: 1,
    marginRight: 12,
  },
  newRideButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.mediumBlue,
    borderRadius: 24,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  newRideButtonText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
  sectionHeading: {
    fontFamily: 'Marcellus_400Regular',
    fontSize: 24,
    color: colors.white,
    marginBottom: 4,
  },
  sectionDescription: {
    color: colors.white,
    opacity: 0.75,
    fontSize: 13,
    marginBottom: 16,
  },
  loadingState: {
    paddingVertical: 18,
    alignItems: 'center',
  },
  emptyState: {
    color: colors.white,
    opacity: 0.7,
    fontSize: 13,
    marginBottom: 18,
  },
}); 