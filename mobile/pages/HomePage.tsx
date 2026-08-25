import React from 'react';
import {
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

interface HomePageProps {
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
}

// Mock data - wiring to real ride data is follow-up work once the backend endpoint exists
const todaysRides: RideCardProps[] = [
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
  },
  {
    status: 'confirmed',
    date: new Date(2026, 6, 12),
    pickup: { address: 'Monash University Clayton', time: '4:45 PM' },
    destination: { address: '12 Gambler Crescent', eta: '5:30 PM' },
    etaMinutes: 45,
    cost: '$8.50',
    co2SavedKg: 2.1,
    driver: { name: 'Marcus Vance', vehicle: 'Honda Civic - Silver' },
    plate: '1ABC234',
  },
];

// TEST DATA ONLY: "Today's Drives" for the driver side of the rider/driver toggle plan.
// RideCard's "driver" field is repurposed as passenger info here - a real driver-mode
// card variant is follow-up work once that flow is designed.
const todaysDrives: RideCardProps[] = [
  {
    status: 'confirmed',
    date: new Date(2026, 6, 12),
    pickup: { address: '12 Gambler Crescent', time: '10:30 AM' },
    destination: { address: 'Monash University Clayton', eta: '11:15 AM' },
    etaMinutes: 45,
    cost: '$8.50',
    co2SavedKg: 2.1,
    driver: { name: 'Emily Chen (passenger)', vehicle: '1 passenger' },
    plate: '1ABC234',
  },
];

function ridesDescription(count: number, noun: 'ride' | 'drive') {
  if (count === 0) return `No ${noun}s scheduled for today.`;
  if (count === 1) return `You have 1 upcoming ${noun} today.`;
  return `You have ${count} upcoming ${noun}s today.`;
}

export default function HomePage({ onScroll }: HomePageProps) {
  const { user } = useAuth();
  const firstName = user?.displayName?.split(' ')[0] || 'there';

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
          <TouchableOpacity accessibilityLabel="Notifications" style={localStyles.iconButton}>
            <Ionicons name="notifications-outline" size={22} color={colors.white} />
          </TouchableOpacity>
          <TouchableOpacity accessibilityLabel="Profile" style={localStyles.avatarButton}>
            <Ionicons name="person" size={18} color={colors.white} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={localStyles.ctaRow}>
        <Text style={localStyles.ctaText}>Ready to find a ride?</Text>
        <TouchableOpacity style={localStyles.newRideButton}>
          <Ionicons name="add" size={18} color={colors.white} />
          <Text style={localStyles.newRideButtonText}>New Ride</Text>
        </TouchableOpacity>
      </View>

      <Text style={localStyles.sectionHeading}>Today's Rides</Text>
      <Text style={localStyles.sectionDescription}>
        {ridesDescription(todaysRides.length, 'ride')}
      </Text>

      {todaysRides.map((ride, index) => (
        <RideCard key={index} {...ride} />
      ))}

      <Text style={localStyles.sectionHeading}>Today's Drives</Text>
      <Text style={localStyles.sectionDescription}>
        {ridesDescription(todaysDrives.length, 'drive')}
      </Text>

      {todaysDrives.map((drive, index) => (
        <RideCard key={index} {...drive} />
      ))}
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
    backgroundColor: 'rgba(255,255,255,0.2)',
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
});
