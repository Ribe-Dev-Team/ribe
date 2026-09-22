import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../styles';
import { useAuth } from '../auth/useAuth';
import RideCard, { RideCardProps } from '../components/RideCard';
import { fetchUserRides } from '../services/rideData';

interface HomePageProps {
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onOpenProfile: () => void;
  onNewRide: () => void;
  onSeeRideDetails: (ride: RideCardProps) => void;
  onOpenDriverProfile: (ride: RideCardProps) => void;
}

const notifications = [
  { id: '1', text: 'Your ride with Marcus Vance is confirmed for 10:30 AM.' },
  { id: '2', text: 'A driver has been matched for your 1:15 PM request.' },
];

function ridesDescription(count: number, noun: 'ride' | 'drive') {
  if (count === 0) return `No ${noun}s scheduled for today.`;
  if (count === 1) return `You have 1 upcoming ${noun} today.`;
  return `You have ${count} upcoming ${noun}s today.`;
}

export default function HomePage({
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

    let isMounted = true;

    const loadRides = async () => {
      try {
        const { requests, offers } = await fetchUserRides(user.uid);
        if (!isMounted) return;

        // Helper function to check if a date matches today's date
        const today = new Date();
        const isToday = (d: Date) =>
          d.getFullYear() === today.getFullYear() &&
          d.getMonth() === today.getMonth() &&
          d.getDate() === today.getDate();

        // Filter requests and offers for today only
        const todayRequests: RideCardProps[] = requests.filter((ride: RideCardProps) => isToday(ride.date));
        const todayDrives: RideCardProps[] = offers.filter((drive: RideCardProps) => isToday(drive.date));

        setTodaysRides(todayRequests);
        setTodaysDrives(todayDrives);
      } catch (error) {
        console.warn('Failed to load rides:', error);
        if (isMounted) {
          setTodaysRides([]);
          setTodaysDrives([]);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadRides();
    return () => {
      isMounted = false;
    };
  }, [user?.uid]);

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
            </TouchableOpacity>
            {notificationsOpen && (
              <View style={localStyles.notificationsDropdown}>
                {notifications.map((item) => (
                  <View key={item.id} style={localStyles.notificationRow}>
                    <Ionicons name="ellipse" size={6} color={colors.mediumBlue} style={{ marginTop: 5 }} />
                    <Text style={localStyles.notificationText}>{item.text}</Text>
                  </View>
                ))}
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
  avatarButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.whiteA20,
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
