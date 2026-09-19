import React, { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { doc, getDoc } from 'firebase/firestore';
import { colors } from '../styles';
import { RideCardProps } from '../components/RideCard';
import { db } from '../firebaseConfig';

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

const fallbackProfile: DriverProfileDetails = {
  degree: 'Monash student',
  year: '',
  bio: 'This driver has not added a bio yet.',
  ridesShared: 0,
  memberSince: 'Recently',
};

export default function DriverProfilePage({ ride, onBack }: DriverProfilePageProps) {
  const [profile, setProfile] = useState<DriverProfileDetails>(fallbackProfile);
  const [loading, setLoading] = useState(Boolean(ride.driver.uid));

  useEffect(() => {
    if (!ride.driver.uid) {
      setProfile(fallbackProfile);
      setLoading(false);
      return;
    }

    let isMounted = true;

    const loadProfile = async () => {
      try {
        const docSnap = await getDoc(doc(db, 'drivers', ride.driver.uid!));
        if (docSnap.exists() && isMounted) {
          const data = docSnap.data();
          setProfile({
            degree: data['degree'] ?? 'Monash student',
            year: data['year'] ?? '',
            bio: data['bio'] ?? 'This driver has not added a bio yet.',
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
  }, [ride.driver.name, ride.driver.uid]);

  const [make, colorTrim] = ride.driver.vehicle.split(' - ');

  return (
    <ScrollView contentContainerStyle={localStyles.screen} showsVerticalScrollIndicator={false}>
      <Pressable accessibilityLabel="Back to trip" onPress={onBack} style={localStyles.backButton}>
        <Ionicons name="chevron-back" size={22} color={colors.white} />
        <Text style={localStyles.backButtonText}>Your driver</Text>
      </Pressable>

      <View style={localStyles.card}>
        {ride.driver.avatarUri ? (
          <Image source={{ uri: ride.driver.avatarUri }} style={localStyles.avatar} />
        ) : (
          <View style={localStyles.avatarFallback}>
            <Ionicons name="person" size={36} color={colors.white} />
          </View>
        )}

        <Text style={localStyles.name}>{ride.driver.name}</Text>
        <Text style={localStyles.subtitle}>
          {loading ? 'Loading driver profile...' : `${profile.degree}${profile.year ? ` · ${profile.year} · at Monash` : ''}`}
        </Text>

        <View style={localStyles.badgeRow}>
          <View style={localStyles.badge}>
            <Ionicons name="checkmark-circle" size={14} color={colors.confirmedLight} />
            <Text style={localStyles.badgeText}>Monash verified</Text>
          </View>
          <View style={localStyles.badge}>
            <Ionicons name="checkmark-circle" size={14} color={colors.confirmedLight} />
            <Text style={localStyles.badgeText}>Licence checked</Text>
          </View>
        </View>
      </View>

      <View style={localStyles.card}>
        <Text style={localStyles.sectionTitle}>About</Text>
        <Text style={localStyles.bioText}>{profile.bio}</Text>
      </View>

      <View style={localStyles.card}>
        <View style={localStyles.vehicleRow}>
          <Ionicons name="car-sport-outline" size={22} color={colors.white} />
          <View style={{ flex: 1 }}>
            <Text style={localStyles.vehicleName}>{make}</Text>
            <Text style={localStyles.vehicleMeta}>
              {colorTrim ?? ''}{colorTrim ? ' · ' : ''}{ride.plate}
            </Text>
          </View>
        </View>
      </View>

      <View style={localStyles.statsRow}>
        <View style={localStyles.statChip}>
          <Text style={localStyles.statValue}>{profile.ridesShared}</Text>
          <Text style={localStyles.statLabel}>rides shared</Text>
        </View>
        <View style={localStyles.statChip}>
          <Text style={localStyles.statValue}>{profile.memberSince}</Text>
          <Text style={localStyles.statLabel}>member since</Text>
        </View>
      </View>

      <View style={localStyles.privacyCard}>
        <View style={localStyles.privacyHeader}>
          <Ionicons name="lock-closed-outline" size={14} color={colors.white} />
          <Text style={localStyles.privacyTitle}>Not shown to you</Text>
        </View>
        <Text style={localStyles.privacyLine}>Phone number - unlocks 12 hours before pickup</Text>
        <Text style={localStyles.privacyLine}>Home address - only the pickup point you agreed</Text>
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
    backgroundColor: 'rgba(255,255,255,0.2)',
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
    backgroundColor: 'rgba(255,255,255,0.14)',
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
    backgroundColor: 'rgba(255,255,255,0.1)',
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
    backgroundColor: 'rgba(255,255,255,0.08)',
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
    borderColor: 'rgba(255,255,255,0.4)',
  },
  reportButtonText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
});
