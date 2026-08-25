import React, { useState } from 'react';
import {
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

interface DashboardPageProps {
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
}

type ViewMode = 'rider' | 'driver';

// Mock data - wiring to real ride data is follow-up work once the backend endpoint exists
const riderRides: RideCardProps[] = [
  {
    status: 'confirmed',
    date: new Date(2026, 6, 12),
    pickup: { address: '12 Gambler Crescent', time: '10:30 AM' },
    destination: { address: 'Monash University Clayton', eta: '11:15 AM' },
    etaMinutes: 45,
    cost: '$8.50',
    co2SavedKg: 2.1,
    driver: { name: 'Marcus Vance', vehicle: 'Honda Civic - Silver' },
    plate: '1ABC234',
    driverPhone: '0412345678',
    pickupDateTime: new Date(Date.now() + 6 * 60 * 60 * 1000), // 6h away - within reveal window
  },
  {
    status: 'confirmed',
    date: new Date(2026, 6, 15),
    pickup: { address: '12 Gambler Crescent', time: '9:00 AM' },
    destination: { address: 'Monash University Clayton', eta: '9:35 AM' },
    etaMinutes: 35,
    cost: '$8.00',
    co2SavedKg: 2.0,
    driver: { name: 'Priya Nair', vehicle: 'Toyota Corolla - White' },
    plate: '2XYZ987',
    driverPhone: '0423456789',
    pickupDateTime: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days away - still masked
  },
  {
    status: 'awaiting',
    date: new Date(2026, 6, 12),
    pickup: { address: 'Clayton Station Bus Interchange', time: '1:15 PM' },
    destination: { address: '45 Wellington Road', eta: '1:45 PM' },
    etaMinutes: 30,
    cost: '$6.00',
    co2SavedKg: 1.4,
    driver: { name: 'Sarah Kim', vehicle: 'Mazda 3 - Blue' },
    plate: '3DEF567',
    matchedAt: new Date(Date.now() - 3 * 60 * 60 * 1000), // matched 3h ago
  },
  {
    status: 'awaiting',
    date: new Date(2026, 6, 14),
    pickup: { address: '12 Gambler Crescent', time: '11:00 AM' },
    destination: { address: 'Chadstone Shopping Centre', eta: '11:25 AM' },
    etaMinutes: 25,
    cost: '$5.00',
    co2SavedKg: 1.0,
    driver: { name: 'Jordan Lee', vehicle: 'Hyundai i30 - Grey' },
    plate: '9GHK102',
    matchedAt: new Date(Date.now() - 30 * 60 * 1000), // matched 30 min ago
  },
  {
    status: 'pending',
    date: new Date(2026, 6, 12),
    pickup: { address: 'Monash University Clayton', time: '3:00 PM' },
    destination: { address: '12 Gambler Crescent', eta: '3:30 PM' },
    etaMinutes: 30,
    cost: 'Est. $7.00',
    co2SavedKg: 0,
    driver: { name: 'Searching for driver', vehicle: 'Matching system in progress' },
    plate: '—',
  },
  {
    status: 'pending',
    date: new Date(2026, 6, 16),
    pickup: { address: '12 Gambler Crescent', time: '8:15 AM' },
    destination: { address: 'Monash University Clayton', eta: '8:50 AM' },
    etaMinutes: 35,
    cost: 'Est. $8.00',
    co2SavedKg: 0,
    driver: { name: 'Searching for driver', vehicle: 'Matching system in progress' },
    plate: '—',
  },
];

// TEST DATA ONLY: driver side of the rider/driver toggle. RideCard's "driver" field
// is repurposed to show passenger info here - a real driver-mode card is follow-up work.
const driverDrives: RideCardProps[] = [
  {
    status: 'confirmed',
    date: new Date(2026, 6, 12),
    pickup: { address: '8 Rosewood Street', time: '8:00 AM' },
    destination: { address: 'Monash University Clayton', eta: '8:35 AM' },
    etaMinutes: 35,
    cost: '$7.00',
    co2SavedKg: 1.8,
    driver: { name: 'Emily Chen (passenger)', vehicle: '1 passenger confirmed' },
    plate: '1ABC234',
  },
  {
    status: 'awaiting',
    date: new Date(2026, 6, 12),
    pickup: { address: 'Huntingdale Station', time: '2:30 PM' },
    destination: { address: 'Chadstone Shopping Centre', eta: '2:50 PM' },
    etaMinutes: 20,
    cost: '$5.50',
    co2SavedKg: 1.1,
    driver: { name: 'A rider has been matched', vehicle: '1 passenger waiting' },
    plate: '—',
  },
];

const lanes: { status: RideStatus; title: string; description: string }[] = [
  {
    status: 'confirmed',
    title: 'Upcoming Ride',
    description: 'Your next confirmed trip.',
  },
  {
    status: 'awaiting',
    title: 'Awaiting Approval',
    description: 'A driver has been matched - review and accept.',
  },
  {
    status: 'pending',
    title: 'Pending Ride',
    description: 'Still searching for a driver.',
  },
];

const CARD_GAP = 12;

export default function DashboardPage({ onScroll }: DashboardPageProps) {
  const [mode, setMode] = useState<ViewMode>('rider');
  const dataset = mode === 'rider' ? riderRides : driverDrives;
  const { width } = useWindowDimensions();
  const cardWidth = (width - 48) * 0.85; // 48 = page's horizontal padding; 85% leaves a peek of the next card

  return (
    <ScrollView
      style={localStyles.scrollView}
      contentContainerStyle={localStyles.scrollContent}
      onScroll={onScroll}
      scrollEventThrottle={16}
    >
      <View style={localStyles.header}>
        <Text style={localStyles.title}>Dashboard</Text>
        <View style={localStyles.toggle}>
          <TouchableOpacity
            style={[localStyles.toggleOption, mode === 'rider' && localStyles.toggleOptionActive]}
            onPress={() => setMode('rider')}
          >
            <Text style={[localStyles.toggleText, mode === 'rider' && localStyles.toggleTextActive]}>
              Rider
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[localStyles.toggleOption, mode === 'driver' && localStyles.toggleOptionActive]}
            onPress={() => setMode('driver')}
          >
            <Text style={[localStyles.toggleText, mode === 'driver' && localStyles.toggleTextActive]}>
              Driver
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {lanes.map((lane) => {
        const rides = dataset
          .filter((r) => r.status === lane.status)
          .sort((a, b) => a.date.getTime() - b.date.getTime());
        return (
          <View key={lane.status} style={localStyles.lane}>
            <Text style={localStyles.laneTitle}>{lane.title}</Text>
            <Text style={localStyles.laneDescription}>{lane.description}</Text>
            {rides.length === 0 ? (
              <Text style={localStyles.emptyText}>Nothing here right now.</Text>
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
                    key={index}
                    style={{
                      width: cardWidth,
                      marginRight: index === rides.length - 1 ? 0 : CARD_GAP,
                    }}
                  >
                    <RideCard
                      {...ride}
                      onAccept={() => Alert.alert('Ride accepted', `Trip with ${ride.driver.name} confirmed.`)}
                      onDecline={() => Alert.alert('Ride declined', 'The driver has been notified.')}
                      onEdit={() => Alert.alert('Edit ride request', 'Editing this request is coming soon.')}
                      onCancel={() => Alert.alert('Cancel ride request', 'This request has been canceled.')}
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
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontFamily: 'Marcellus_400Regular',
    fontSize: 28,
    color: colors.white,
  },
  toggle: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 20,
    padding: 3,
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
  emptyText: {
    color: colors.white,
    opacity: 0.6,
    fontSize: 13,
    fontStyle: 'italic',
  },
});
