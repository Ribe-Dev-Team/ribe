import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../styles';

export type RideStatus = 'confirmed' | 'awaiting' | 'pending';

const statusAccent: Record<RideStatus, string> = {
  confirmed: colors.confirmed,
  awaiting: colors.awaiting,
  pending: colors.pending,
};

const ordinalSuffix = (day: number) => {
  if (day >= 11 && day <= 13) return 'th';
  switch (day % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
};

export function formatRideDate(date: Date) {
  const weekday = date.toLocaleDateString('en-US', { weekday: 'short' });
  const month = date.toLocaleDateString('en-US', { month: 'long' });
  return `${weekday}, ${month} ${date.getDate()}${ordinalSuffix(date.getDate())} ${date.getFullYear()}`;
}

export interface RideCardProps {
  status: RideStatus;
  date: Date;
  pickup: { address: string; time: string };
  destination: { address: string; eta: string };
  etaMinutes: number;
  cost: string;
  co2SavedKg: number;
  driver: { name: string; vehicle: string; avatarUri?: string };
  plate: string;
}

export default function RideCard({
  status,
  date,
  pickup,
  destination,
  etaMinutes,
  cost,
  co2SavedKg,
  driver,
  plate,
}: RideCardProps) {
  const accent = statusAccent[status];

  return (
    <View style={[styles.card, { borderLeftColor: accent }]}>
      <View style={styles.topRow}>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: accent }]} />
          <Text style={styles.statusLabel}>{formatRideDate(date)}</Text>
        </View>
        <Text style={styles.etaBadge}>{etaMinutes} min</Text>
      </View>

      <View style={styles.stopRow}>
        <Ionicons name="ellipse" size={10} color={colors.white} style={styles.stopIcon} />
        <Text style={styles.stopAddress} numberOfLines={1}>{pickup.address}</Text>
        <Text style={styles.stopTime}>{pickup.time}</Text>
      </View>
      <View style={styles.stopConnector} />
      <View style={styles.stopRow}>
        <Ionicons name="location" size={13} color={colors.white} style={styles.stopIcon} />
        <Text style={styles.stopAddress} numberOfLines={1}>{destination.address}</Text>
        <Text style={styles.stopTime}>ETA {destination.eta}</Text>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statChip}>
          <Ionicons name="cash-outline" size={14} color={colors.white} />
          <Text style={styles.statText}>{cost}</Text>
        </View>
        <View style={styles.statChip}>
          <Ionicons name="leaf-outline" size={14} color={colors.confirmedLight} />
          <Text style={styles.statText}>{co2SavedKg}kg CO2 saved</Text>
        </View>
      </View>

      <View style={styles.divider} />

      <View style={styles.footerRow}>
        <View style={styles.driverRow}>
          {driver.avatarUri ? (
            <Image source={{ uri: driver.avatarUri }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarFallback}>
              <Ionicons name="person" size={16} color={colors.white} />
            </View>
          )}
          <View>
            <Text style={styles.driverName}>{driver.name}</Text>
            <Text style={styles.vehicleText}>{driver.vehicle}</Text>
          </View>
        </View>
        <Text style={styles.plateBadge}>{plate}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderLeftWidth: 4,
    borderRadius: 20,
    padding: 14,
    marginBottom: 12,
    backgroundColor: colors.mediumBlue,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusLabel: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '600',
  },
  etaBadge: {
    color: colors.white,
    fontSize: 12,
    opacity: 0.85,
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stopIcon: {
    width: 14,
    textAlign: 'center',
  },
  stopAddress: {
    flex: 1,
    color: colors.white,
    fontSize: 14,
  },
  stopTime: {
    color: colors.white,
    fontSize: 12,
    opacity: 0.85,
    marginLeft: 8,
  },
  stopConnector: {
    width: 1,
    height: 12,
    backgroundColor: 'rgba(255,255,255,0.35)',
    marginLeft: 6,
    marginVertical: 2,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  statChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.28)',
    marginVertical: 10,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  driverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  avatarFallback: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  driverName: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
  vehicleText: {
    color: colors.white,
    fontSize: 12,
    opacity: 0.78,
  },
  plateBadge: {
    color: colors.darkBlue,
    backgroundColor: colors.white,
    fontSize: 12,
    fontWeight: '700',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
  },
});
