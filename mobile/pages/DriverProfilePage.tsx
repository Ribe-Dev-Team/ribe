import React, { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../styles';
import { RideCardProps } from '../components/RideCard';
import { fetchDriverProfile, fetchRiderProfile } from '../services/rideData';

interface DriverProfilePageProps {
  ride: RideCardProps;
  onBack: () => void;
}

interface DriverProfileDetails {
  degree: string;
  year: string;
  bio: string;
  ridesShared: number;
  memberSince: string;
}

const fallbackFor = (role: 'driver' | 'rider'): DriverProfileDetails => ({
  degree: 'Monash student',
  year: '',
  bio: `This ${role} has not added a bio yet.`,
  ridesShared: 0,
  memberSince: 'Recently',
});

/**
 * The other person on a ride. Opened from a rider's card it's their driver;
 * opened from a driver's awaiting card it's the rider they're being asked to
 * accept - no car, and only what a rider's account profile holds.
 */
export default function DriverProfilePage({ ride, onBack }: DriverProfilePageProps) {
  const role = ride.kind === 'offer' ? 'rider' : 'driver';
  const person = role === 'rider'
    ? ride.rider ?? { name: 'Your matched rider' }
    : ride.driver;
  const fallbackProfile = fallbackFor(role);
  const [profile, setProfile] = useState<DriverProfileDetails>(fallbackProfile);
  const [loading, setLoading] = useState(Boolean(person.uid));

  useEffect(() => {
    if (!person.uid) {
      setProfile(fallbackProfile);
      setLoading(false);
      return;
    }

    let isMounted = true;

    const loadProfile = async () => {
      try {
        // A driver's: registration and account profile merged - a driver may
        // not have finished registration, and only the account has bio/degree.
        const data = role === 'rider'
          ? await fetchRiderProfile(person.uid!)
          : await fetchDriverProfile(person.uid!);
        if (Object.keys(data).length > 0 && isMounted) {
          setProfile({
            degree: data['degree'] ?? 'Monash student',
            year: data['year'] ?? '',
            bio: data['bio'] ?? fallbackProfile.bio,
            ridesShared: Number(data['ridesShared'] ?? 0),
            memberSince: data['memberSince'] ?? 'Recently',
          });
        } else if (isMounted) {
          setProfile(fallbackProfile);
        }
      } catch {
        if (isMounted) {
          setProfile(fallbackProfile);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadProfile();

    return () => {
      isMounted = false;
    };
  }, [role, person.name, person.uid]);

  // Colour comes separately; older cards packed it into `vehicle` as "Make - Colour".
  const [packedMake, packedColour] = ride.driver.vehicle.split(' - ');
  const make = ride.driver.colour ? ride.driver.vehicle : packedMake;
  const colorTrim = ride.driver.colour ?? packedColour;

  return (
    <ScrollView contentContainerStyle={localStyles.screen} showsVerticalScrollIndicator={false}>
      <Pressable accessibilityLabel="Back to trip" onPress={onBack} style={localStyles.backButton}>
        <Ionicons name="chevron-back" size={22} color={colors.white} />
        <Text style={localStyles.backButtonText}>Your {role === 'rider' ? 'Rider' : 'Driver'}</Text>
      </Pressable>

      <View style={localStyles.card}>
        {person.avatarUri ? (
          <Image source={{ uri: person.avatarUri }} style={localStyles.avatar} />
        ) : (
          <View style={localStyles.avatarFallback}>
            <Ionicons name="person" size={36} color={colors.white} />
          </View>
        )}

        <Text style={localStyles.name}>{person.name}</Text>
        <Text style={localStyles.subtitle}>
          {loading ? `Loading ${role} profile...` : `${profile.degree}${profile.year ? ` · ${profile.year} · at Monash` : ''}`}
        </Text>

        <View style={localStyles.badgeRow}>
          <View style={localStyles.badge}>
            <Ionicons name="checkmark-circle" size={14} color={colors.confirmedLight} />
            <Text style={localStyles.badgeText}>Monash Verified</Text>
          </View>
          {role === 'driver' && (
            <View style={localStyles.badge}>
              <Ionicons name="checkmark-circle" size={14} color={colors.confirmedLight} />
              <Text style={localStyles.badgeText}>Licence Checked</Text>
            </View>
          )}
        </View>
      </View>

      <View style={localStyles.card}>
        <Text style={localStyles.sectionTitle}>About</Text>
        <Text style={localStyles.bioText}>{profile.bio}</Text>
      </View>

      {role === 'driver' && <View style={localStyles.card}>
        <View style={localStyles.vehicleRow}>
          <Ionicons name="car-sport-outline" size={22} color={colors.white} />
          <View style={{ flex: 1 }}>
            <Text style={localStyles.vehicleName}>{make}</Text>
            <Text style={localStyles.vehicleMeta}>
              {colorTrim ?? ''}{colorTrim ? ' · ' : ''}{ride.plate}
            </Text>
          </View>
        </View>
      </View>}

      <View style={localStyles.statsRow}>
        <View style={localStyles.statChip}>
          <Text style={localStyles.statValue}>{profile.ridesShared}</Text>
          <Text style={localStyles.statLabel}>Rides Shared</Text>
        </View>
        <View style={localStyles.statChip}>
          <Text style={localStyles.statValue}>{profile.memberSince}</Text>
          <Text style={localStyles.statLabel}>Member Since</Text>
        </View>
      </View>

      <View style={localStyles.privacyCard}>
        <View style={localStyles.privacyHeader}>
          <Ionicons name="lock-closed-outline" size={14} color={colors.white} />
          <Text style={localStyles.privacyTitle}>Not Shown to You</Text>
        </View>
        {role === 'driver' && (
          <Text style={localStyles.privacyLine}>Phone number - unlocks 12 hours before pickup</Text>
        )}
        <Text style={localStyles.privacyLine}>
          {role === 'driver' ? 'Home address - only the pickup point you agreed' : 'Home address - only their pickup point'}
        </Text>
        <Text style={localStyles.privacyLine}>Email, date of birth - never shared</Text>
      </View>

      <Pressable
        style={localStyles.reportButton}
        onPress={() => {}}
      >
        <Text style={localStyles.reportButtonText}>Report</Text>
      </Pressable>
    </ScrollView>
  );
}

const localStyles = StyleSheet.create({
  screen: {
    padding: 20,
    paddingTop: 40,
    paddingBottom: 40,
    backgroundColor: colors.darkBlue,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
  },
  backButtonText: {
    fontFamily: 'Marcellus_400Regular',
    fontSize: 20,
    color: colors.white,
    marginLeft: 2,
  },
  card: {
    borderRadius: 20,
    padding: 18,
    marginBottom: 14,
    backgroundColor: colors.mediumBlue,
    alignItems: 'center',
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    marginBottom: 10,
  },
  avatarFallback: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.whiteA20,
    marginBottom: 10,
  },
  name: {
    fontFamily: 'Marcellus_400Regular',
    fontSize: 20,
    color: colors.white,
  },
  subtitle: {
    color: colors.white,
    opacity: 0.8,
    fontSize: 13,
    marginTop: 2,
    textAlign: 'center',
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.whiteA14,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeText: {
    color: colors.white,
    fontSize: 11,
    fontWeight: '600',
  },
  sectionTitle: {
    alignSelf: 'flex-start',
    fontFamily: 'Marcellus_400Regular',
    fontSize: 16,
    color: colors.white,
    marginBottom: 8,
  },
  bioText: {
    alignSelf: 'flex-start',
    color: colors.white,
    opacity: 0.85,
    fontSize: 13,
    lineHeight: 19,
  },
  vehicleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    alignSelf: 'stretch',
  },
  vehicleName: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '600',
  },
  vehicleMeta: {
    color: colors.white,
    opacity: 0.75,
    fontSize: 12,
    marginTop: 2,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 14,
  },
  statChip: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 16,
    paddingVertical: 12,
    backgroundColor: colors.whiteA10,
  },
  statValue: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
  },
  statLabel: {
    color: colors.white,
    opacity: 0.75,
    fontSize: 11,
    marginTop: 2,
  },
  privacyCard: {
    borderRadius: 16,
    padding: 14,
    marginBottom: 18,
    backgroundColor: colors.whiteA08,
  },
  privacyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  privacyTitle: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '700',
  },
  privacyLine: {
    color: colors.white,
    opacity: 0.75,
    fontSize: 11,
    lineHeight: 17,
  },
  reportButton: {
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.whiteA40,
  },
  reportButtonText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
});
