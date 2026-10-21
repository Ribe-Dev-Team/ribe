import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../styles';
import RideCard, { RideCardProps, RideStatus } from '../components/RideCard';
import { useAuth } from '../auth/useAuth';
import { fetchUserRides, watchUserRides } from '../services/rideData';
import { ridesForLane } from '../services/dashboardLanes';

interface DashboardPageProps {
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onSeeRideDetails: (ride: RideCardProps) => void;
  onOpenDriverProfile: (ride: RideCardProps) => void;
  /** The real Accept/Decline/Remove handlers (App's buildRideActions) for a card's own buttons. */
  rideActions: (ride: RideCardProps) => Pick<RideCardProps, 'onAccept' | 'onDecline'>;
  /** Which of the user's trips this page is: My Rides (their ride requests)
   *  or My Drives (their driving offers) - each its own navigation tab. */
  mode: DashboardMode;
}

export type DashboardMode = 'rider' | 'driver';

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

const laneAccent: Record<RideStatus, string> = {
  confirmed: colors.confirmed,
  awaiting: colors.awaiting,
  pending: colors.pending,
  cancelled: colors.cancelled,
};

const laneEmptyIcon: Record<RideStatus, React.ComponentProps<typeof Ionicons>['name']> = {
  confirmed: 'calendar-outline',
  awaiting: 'hourglass-outline',
  pending: 'search-outline',
  cancelled: 'close-circle-outline',
};

export default function DashboardPage({
  onScroll, onSeeRideDetails, onOpenDriverProfile, rideActions, mode,
}: DashboardPageProps) {
  const { user } = useAuth();
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
    // Loads can overlap when the listeners fire close together; only the
    // latest one may set the cards, or a slow older read could undo a newer.
    let latestLoad = 0;

    const loadRides = async () => {
      const thisLoad = ++latestLoad;
      try {
        const { requests, offers } = await fetchUserRides(user.uid);
        if (!isMounted || thisLoad !== latestLoad) return;
        setRiderRides(requests);
        setDriverDrives(offers);
      } catch (error) {
        console.warn('Failed to load dashboard rides:', error);
        if (isMounted && thisLoad === latestLoad) {
          setRiderRides([]);
          setDriverDrives([]);
        }
      } finally {
        if (isMounted && thisLoad === latestLoad) setLoading(false);
      }
    };

    // Rebuilt whenever the user's rides change - after locking a drive or
    // changing its seats, say - not only when the page mounts.
    const stopWatching = watchUserRides(user.uid, loadRides);

    return () => {
      isMounted = false;
      stopWatching();
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
            {mode === 'rider' ? 'My Rides' : 'My Drives'}
          </Text>
          <Text style={localStyles.subtitle}>
            {mode === 'rider'
              ? 'Track your ride requests and passenger trips.'
              : 'Manage your driving offers and matched riders.'}
          </Text>
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
            {/* The lane's colour matches its cards' edge, so the eye can tell
                them apart; a rider's match to accept is flagged as theirs to do. */}
            <View style={localStyles.laneHeader}>
              <View style={[localStyles.laneDot, { backgroundColor: laneAccent[lane.status] }]} />
              <Text style={localStyles.laneTitle}>{lane.title}</Text>
              {rides.length > 0 && <Text style={localStyles.laneCount}>{rides.length}</Text>}
              {mode === 'rider' && lane.status === 'awaiting' && rides.length > 0 && (
                <Text style={localStyles.actionTag}>Action needed</Text>
              )}
            </View>
            <Text style={localStyles.laneDescription}>{lane.description}</Text>
            {rides.length === 0 ? (
              <View style={localStyles.emptyLane}>
                <Ionicons name={laneEmptyIcon[lane.status]} size={20} color={colors.skyBlue} />
                <Text style={localStyles.emptyText}>{lane.emptyText}</Text>
              </View>
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
  lane: {
    marginBottom: 28,
  },
  laneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  laneDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  laneTitle: {
    fontFamily: 'Marcellus_400Regular',
    fontSize: 20,
    color: colors.white,
  },
  laneCount: {
    color: colors.darkBlue,
    backgroundColor: colors.white,
    fontSize: 12,
    fontWeight: '700',
    borderRadius: 10,
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  actionTag: {
    color: colors.darkBlue,
    backgroundColor: colors.awaitingLight,
    fontSize: 11,
    fontWeight: '700',
    borderRadius: 10,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  // An empty lane keeps some room, so the page doesn't collapse into a list
  // of headings.
  emptyLane: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: 22,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.whiteA35,
    backgroundColor: colors.whiteA08,
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
    color: colors.skyBlue,
    fontSize: 13,
    fontStyle: 'italic',
    textAlign: 'center',
  },
});
