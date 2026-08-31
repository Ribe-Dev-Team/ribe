import React from 'react';
import { Pressable, Text, View } from 'react-native';
import styles from '../styles';
import type { Ride } from '../pages/CalendarPage';

interface CalendarRideRowProps {
  ride: Ride;
  statusLabel: string;
  statusColor: string;
  onPress: () => void;
}

export default function CalendarRideRow({ ride, statusLabel, statusColor, onPress }: CalendarRideRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open details for ${ride.driver} ride`}
      onPress={onPress}
      style={[styles.rideCard, { borderLeftColor: statusColor }]}
    >
      <View style={styles.rideTopRow}>
        <Text style={styles.rideStatus}><Text style={{ color: statusColor }}>●</Text> {statusLabel}</Text>
        <Text style={styles.rideTime}>{ride.time}{ride.duration ? ` (${ride.duration})` : ''}</Text>
      </View>
      <Text style={styles.rideDetail}>•  {ride.start}</Text>
      <Text style={styles.rideDetail}>▰  {ride.destination}</Text>
      <View style={styles.rideDivider} />
      <Text style={styles.driverName}>●  {ride.driver}</Text>
      <Text style={styles.vehicleText}>     {ride.vehicle}</Text>
    </Pressable>
  );
}
