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
  useWindowDimensions,
  View,
} from 'react-native';
import { colors } from '../styles';
import RideCard, { RideCardProps, RideStatus } from '../components/RideCard';
import { useAuth } from '../auth/useAuth';
import { fetchUserRides } from '../services/rideData';
import { ridesForLane } from '../services/dashboardLanes';

interface DashboardPageProps {
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onSeeRideDetails: (ride: RideCardProps) => void;
  onOpenDriverProfile: (ride: RideCardProps) => void;
  /** The real Accept/Decline/Remove handlers (App's buildRideActions) for a card's own buttons. */
  rideActions: (ride: RideCardProps) => Pick<RideCardProps, 'onAccept' | 'onDecline' | 'onCancel' | 'onSetLocked' | 'onChangeSeats'>;
  /** Rider or driver view, held by the parent so it survives the page being
   *  remounted - which App does after every write (Lock, Seats, Accept...) to
   *  reload, and on the way back from a ride's details. Uncontrolled (starts on
   *  Rider) when omitted. */
  mode?: DashboardMode;
  onModeChange?: (mode: DashboardMode) => void;
}

export type DashboardMode = 'rider' | 'driver';
type ViewMode = DashboardMode;

interface LaneConfig {
  status: RideStatus;
  title: string;
  description: string;
  emptyText: string;
}

const RIDER_LANES: LaneConfig[] = [
  {
    status: 'confirmed',
    title: 'Upcoming Rides',
    description: 'Your confirmed trips with matched drivers.',
    emptyText: 'No upcoming rides scheduled.',
  },
  {
    status: 'awaiting',
    title: 'Awaiting Approval',
    description: 'A driver has been matched — review and accept.',
    emptyText: 'No rides awaiting your approval.',
  },
  {
    status: 'pending',
    title: 'Pending Requests',
    description: 'Still searching for an available driver.',
    emptyText: 'No pending ride requests.',
  },
];

const DRIVER_LANES: LaneConfig[] = [
  {
    status: 'confirmed',
    title: 'Upcoming Drives',
    description: 'Your confirmed trips with student passengers.',
    emptyText: 'No upcoming drives scheduled.',
  },
  {
    status: 'awaiting',
    title: 'Rider Requests',
    description: 'Students matched to your route — review and confirm.',
    emptyText: 'No rider requests awaiting confirmation.',
  },
  {
    status: 'pending',
    title: 'Open Driving Offers',
    description: 'Your active offers searching for student riders.',
    emptyText: 'No open driving offers right now.',
  },
];

const CARD_GAP = 12;

export default function DashboardPage({
  onScroll, onSeeRideDetails, onOpenDriverProfile, rideActions, mode: controlledMode, onModeChange,
}: DashboardPageProps) {
  const { user } = useAuth();
  const [ownMode, setOwnMode] = useState<ViewMode>('rider');
  const mode = controlledMode ?? ownMode;
  const setMode = (next: ViewMode) => {
    setOwnMode(next);
    onModeChange?.(next);
  };
  const [riderRides, setRiderRides] = useState<RideCardProps[]>([]);
  const [driverDrives, setDriverDrives] = useState<RideCardProps[]>([]);
  const [loading, setLoading] = useState(true);
  const { width } = useWindowDimensions();
  const cardWidth = (width - 48) * 0.85; // 48 = page's horizontal padding; 85% leaves a peek of the next card

  useEffect(() => {
    if (!user?.uid) {
      setRiderRides([]);
      setDriverDrives([]);
      setLoading(false);
      return;
    }

    let isMounted = true;

    const loadRides = async () => {
      try {
        const { requests, offers } = await fetchUserRides(user.uid);
        if (!isMounted) return;
        setRiderRides(requests);
        setDriverDrives(offers);
      } catch (error) {
        console.warn('Failed to load dashboard rides:', error);
        if (isMounted) {
          setRiderRides([]);
          setDriverDrives([]);
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

  const dataset = mode === 'rider' ? riderRides : driverDrives;
  const currentLanes = mode === 'rider' ? RIDER_LANES : DRIVER_LANES;

  return (
    <ScrollView
      style={localStyles.scrollView}
      contentContainerStyle={localStyles.scrollContent}
      onScroll={onScroll}
      scrollEventThrottle={16}
    >
      <View style={localStyles.header}>
        <View style={localStyles.titleContainer}>
          <Text style={localStyles.title}>
            {'Dashboard'}
          </Text>
          <Text style={localStyles.subtitle}>
            {mode === 'rider'
              ? 'Track your ride requests and passenger trips.'
              : 'Manage your driving offers and matched riders.'}
          </Text>
        </View>
        <View style={localStyles.toggle}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Switch to rider view"
            style={[localStyles.toggleOption, mode === 'rider' && localStyles.toggleOptionActive]}
            onPress={() => setMode('rider')}
          >
            <Text style={[localStyles.toggleText, mode === 'rider' && localStyles.toggleTextActive]}>
              Rider
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Switch to driver view"
            style={[localStyles.toggleOption, mode === 'driver' && localStyles.toggleOptionActive]}
            onPress={() => setMode('driver')}
          >
            <Text style={[localStyles.toggleText, mode === 'driver' && localStyles.toggleTextActive]}>
              Driver
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View style={localStyles.loadingState}><ActivityIndicator color={colors.white} size="small" /></View>
      ) : currentLanes.map((lane) => {
        // A driver's drive still open to passengers shows in Open Driving
        // Offers as well as Upcoming Drives - see ridesForLane.
        const rides = ridesForLane(dataset, lane.status, mode);
        return (
          <View key={lane.status} style={localStyles.lane}>
            <Text style={localStyles.laneTitle}>{lane.title}</Text>
            <Text style={localStyles.laneDescription}>{lane.description}</Text>
            {rides.length === 0 ? (
              <Text style={localStyles.emptyText}>{lane.emptyText}</Text>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                decelerationRate="fast"
                snapToInterval={cardWidth + CARD_GAP}
                snapToAlignment="start"
              >
                {rides.map((ride, index) => (
                  <View
                    key={`${ride.date.toISOString()}-${index}`}
                    style={{
                      width: cardWidth,
                      marginRight: index === rides.length - 1 ? 0 : CARD_GAP,
                    }}
                  >
                    <RideCard
                      {...ride}
                      onEdit={() =>
                        Alert.alert(
                          mode === 'rider' ? 'Edit ride request' : 'Edit driving offer',
                          mode === 'rider'
                            ? 'Editing this request is coming soon.'
                            : 'Editing this drive offer is coming soon.'
                        )
                      }
                      onCancel={() =>
                        Alert.alert(
                          mode === 'rider' ? 'Ride canceled' : 'Drive canceled',
                          mode === 'rider' ? 'This ride has been canceled.' : 'This drive offer has been canceled.'
                        )
                      }
                      // Writes to Firestore - these used to only show a success alert.
                      // After onCancel, so a driver's Remove offer really removes it.
                      {...rideActions(ride)}
                      onSeeDetails={() => onSeeRideDetails(ride)}
                      onOpenDriverProfile={() => onOpenDriverProfile(ride)}
                    />
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        );
      })}
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
    alignItems: 'flex-start',
    marginBottom: 20,
    gap: 12,
  },
  titleContainer: {
    flex: 1,
  },
  title: {
    fontFamily: 'Marcellus_400Regular',
    fontSize: 26,
    color: colors.white,
  },
  subtitle: {
    color: colors.white,
    opacity: 0.72,
    fontSize: 13,
    marginTop: 4,
    lineHeight: 18,
  },
  toggle: {
    flexDirection: 'row',
    backgroundColor: colors.whiteA16,
    borderRadius: 20,
    padding: 3,
    marginTop: 2,
  },
  toggleOption: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 17,
  },
  toggleOptionActive: {
    backgroundColor: colors.mediumBlue,
  },
  toggleText: {
    color: colors.white,
    opacity: 0.7,
    fontSize: 13,
    fontWeight: '600',
  },
  toggleTextActive: {
    opacity: 1,
  },
  lane: {
    marginBottom: 24,
  },
  laneTitle: {
    fontFamily: 'Marcellus_400Regular',
    fontSize: 20,
    color: colors.white,
    marginBottom: 2,
  },
  laneDescription: {
    color: colors.white,
    opacity: 0.75,
    fontSize: 13,
    marginBottom: 12,
  },
  loadingState: {
    paddingVertical: 18,
    alignItems: 'center',
  },
  emptyText: {
    color: colors.white,
    opacity: 0.6,
    fontSize: 13,
    fontStyle: 'italic',
  },
});
