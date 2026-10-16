import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import styles, { colors } from '../styles';
import { Ride } from './CalendarPage';
import MapPreview from '../components/MapPreview';
import { fetchDriverProfile, fetchRiderProfile } from '../services/rideData';

interface RideDetailPageProps {
	ride: Ride;
	date: Date;
	backLabel?: string;
	onBack: () => void;
	onAccept?: () => Promise<void> | void;
	onDecline?: () => Promise<void> | void;
	onCancel?: () => Promise<void> | void;
}

type DriverProfileInfo = {
	initials: string;
	bio: string;
	degree: string;
	phone: string;
	vehicle: string;
};

const fallbackDriverProfile: DriverProfileInfo = {
	initials: 'DR',
	bio: 'This driver profile is still being populated.',
	degree: 'Monash student',
	phone: 'Phone not shared yet',
	vehicle: 'Vehicle details coming soon',
};

function formatDate(date: Date) {
	return date.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return <View style={styles.detailSection}><Text style={styles.detailSectionTitle}>{title}</Text>{children}</View>;
}

export default function RideDetailPage({ ride, date, backLabel = 'Calendar', onBack, onAccept, onDecline, onCancel }: RideDetailPageProps) {
	const isConfirmed = ride.status === 'confirmed';
	// A match needs both sides to accept; once you have, you're waiting on the other.
	const isDriver = ride.kind === 'offer';
	// The other person on the ride: a rider's driver, or the rider a driver is
	// being asked to accept (only while awaiting - a driver has no one else to show).
	const pendingRider = isDriver && ride.status === 'awaiting' ? ride.rider : undefined;
	const personUid = isDriver ? pendingRider?.uid : ride.driverUid;
	const personName = isDriver ? pendingRider?.name ?? '' : ride.driver;
	const [profile, setProfile] = useState<DriverProfileInfo>(fallbackDriverProfile);
	const [loadingProfile, setLoadingProfile] = useState(Boolean(personUid));
	const status = ride.status === 'confirmed' ? 'Confirmed ride'
		: ride.status === 'awaiting' ? (
			ride.youAccepted ? `You accepted - waiting for the ${isDriver ? 'rider' : 'driver'}`
			: isDriver ? `Rider found - ${ride.otherAccepted ? 'they accepted, ' : ''}waiting for your answer`
			: `Awaiting your confirmation${ride.otherAccepted ? ' - your driver accepted' : ''}`
		)
		: 'Pending ride';
	const statusColor = ride.status === 'confirmed' ? colors.confirmed : ride.status === 'awaiting' ? colors.awaiting : colors.pending;

	useEffect(() => {
		let active = true;

		const role = isDriver ? 'rider' : 'driver';
		const initialsOf = (name: string) =>
			name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase() || (isDriver ? 'R' : 'DR');

		const loadDriverProfile = async () => {
			if (!personUid) {
				if (active) {
					setProfile({
						initials: initialsOf(personName),
						bio: `${isDriver ? 'Rider' : 'Driver'} details are not available yet.`,
						degree: 'Monash student',
						phone: 'Phone not shared yet',
						vehicle: ride.vehicle || 'Vehicle details coming soon',
					});
					setLoadingProfile(false);
				}
				return;
			}

			try {
				// A driver's: registration and account profile merged - a driver may
				// not have finished registration, and only the account has bio/degree/phone.
				const data = isDriver ? await fetchRiderProfile(personUid) : await fetchDriverProfile(personUid);
				if (!active) return;

				if (Object.keys(data).length > 0) {
					setProfile({
						// A rider is shown by first name only, so their initial is too.
						initials: initialsOf(isDriver ? personName : data['name'] ?? personName),
						bio: data['bio'] ?? `This ${role} has not added a bio yet.`,
						degree: data['degree'] ?? 'Monash student',
						phone: data['phoneNumber'] ?? 'Phone not shared yet',
						vehicle: [data['vehicleMake'], data['vehicleModel']].filter(Boolean).join(' ') || ride.vehicle || 'Vehicle details coming soon',
					});
					setLoadingProfile(false);
					return;
				}
			} catch (error) {
				console.warn(`Failed to load ${role} profile:`, error);
			}

			if (active) {
				setProfile({
					initials: initialsOf(personName),
					bio: `${isDriver ? 'Rider' : 'Driver'} details are not available yet.`,
					degree: 'Monash student',
					phone: 'Phone not shared yet',
					vehicle: ride.vehicle || 'Vehicle details coming soon',
				});
			}
			if (active) setLoadingProfile(false);
		};

		loadDriverProfile();

		return () => {
			active = false;
		};
	}, [isDriver, personName, personUid, ride.vehicle]);

	return (
		<ScrollView contentContainerStyle={styles.detailScreen} showsVerticalScrollIndicator={false}>
			<Pressable accessibilityLabel={`Back to ${backLabel}`} onPress={onBack} style={styles.backButton}><Text style={styles.backButtonText}>‹</Text><Text style={styles.backButtonLabel}>{backLabel}</Text></Pressable>
			<Text style={styles.detailTitle}>Ride details</Text>
			<Text style={styles.detailDate}>{formatDate(date)}</Text>

			<View style={styles.detailStatusRow}><Text style={styles.detailTime}>{ride.time}</Text><View style={[styles.statusPill, { backgroundColor: statusColor }]}><Text style={styles.statusPillText}>{status}</Text></View></View>

			<MapPreview routeShown={isConfirmed} locations={[ride.start, ride.destination]} />

			<Section title="Journey">
				<View style={styles.locationRow}><Text style={[styles.locationDot, { color: colors.confirmed }]}>●</Text><View><Text style={styles.locationLabel}>Pickup {ride.status === 'pending' ? 'window' : 'spot'}</Text><Text style={styles.locationText}>{ride.start}</Text><Text style={styles.locationMeta}>{ride.status === 'pending' ? ride.time : '10 minutes before departure'}</Text></View></View>
				<View style={styles.locationLine} />
				<View style={styles.locationRow}><Text style={[styles.locationDot, { color: colors.pending }]}>●</Text><View><Text style={styles.locationLabel}>Drop-off spot</Text><Text style={styles.locationText}>{ride.destination}</Text></View></View>
			</Section>

			{isDriver ? (
				// Who the driver is being asked to take. Their phone isn't shared.
				pendingRider && (
					<Section title="Your rider">
						<View style={styles.personRow}><View style={styles.avatar}><Text style={styles.avatarText}>{loadingProfile ? '...' : profile.initials}</Text></View><View style={styles.personCopy}><Text style={styles.personName}>{pendingRider.name}</Text><Text style={styles.personBio}>{loadingProfile ? 'Loading rider details...' : profile.bio}</Text></View></View>
						<Text style={styles.infoLine}>Degree  ·  {loadingProfile ? 'Loading...' : profile.degree}</Text>
					</Section>
				)
			) : isConfirmed ? (
				<Section title="Your driver">
					<View style={styles.personRow}><View style={styles.avatar}><Text style={styles.avatarText}>{loadingProfile ? '...' : profile.initials}</Text></View><View style={styles.personCopy}><Text style={styles.personName}>{ride.driver}</Text><Text style={styles.personBio}>{loadingProfile ? 'Loading driver details...' : profile.bio}</Text></View></View>
					<Text style={styles.infoLine}>Degree  ·  {loadingProfile ? 'Loading...' : profile.degree}</Text>
					<Text style={styles.infoLine}>Contact  ·  {loadingProfile ? 'Loading...' : profile.phone}</Text>
				</Section>
			) : <Section title="Your driver"><Text style={styles.mutedDetail}>A driver will appear here once your ride is confirmed.</Text></Section>}

			{isConfirmed && <Section title="Driver's car"><View style={styles.carRow}><Text style={styles.carIcon}>▣</Text><View><Text style={styles.personName}>{loadingProfile ? 'Loading vehicle...' : profile.vehicle}</Text><Text style={styles.infoLine}>{ride.vehicle || 'Vehicle details coming soon'}</Text></View></View></Section>}
			{isConfirmed && <Section title="Other riders"><View style={styles.personRow}><View style={styles.avatar}><Text style={styles.avatarText}>EP</Text></View><View><Text style={styles.personName}>Elena Park</Text><Text style={styles.personBio}>Monash student, studying design.</Text></View></View></Section>}

			<View style={styles.savingsPanel}><Text style={styles.savingsKicker}>CO2 SAVINGS</Text><Text style={styles.savingsValue}>2.4 kg saved</Text><Text style={styles.savingsText}>Sharing this ride keeps another car off the road.</Text></View>
			<View style={styles.costPanel}><Text style={styles.costTitle}>Estimated cost split</Text><View style={styles.costRow}><Text style={styles.costLabel}>Estimated trip cost</Text><Text style={styles.costValue}>$8.50</Text></View><View style={styles.costRow}><Text style={styles.costLabel}>Your share</Text><Text style={styles.costValue}>$4.25</Text></View><Text style={styles.costNote}>Final amount may change with route detours.</Text></View>

			{ride.status === 'awaiting' && (onAccept || onDecline) && (
				<View style={[styles.editActionsRow, { marginTop: 14 }]}>
					<Pressable
						onPress={() =>
							Alert.alert(
								isDriver ? 'Decline this rider?' : 'Decline this ride?',
								isDriver
									? 'They will go back to being matched with another driver, and your seat opens up again.'
									: 'Are you sure you want to decline this ride?',
								[
									{ text: isDriver ? 'Keep Rider' : 'Keep Ride', style: 'cancel' },
									{ text: 'Decline', style: 'destructive', onPress: onDecline },
								],
							)
						}
						style={styles.dangerButton}
					>
						<Text style={styles.dangerButtonText}>Decline</Text>
					</Pressable>
					{onAccept && (
						<Pressable onPress={onAccept} style={[styles.successButton, { marginTop: 0 }]}>
							<Text style={styles.successButtonText}>Accept</Text>
						</Pressable>
					)}
				</View>
			)}

			{(isConfirmed || ride.status === 'pending' || isDriver) && onCancel && (
				<Pressable
					onPress={() =>
						isDriver
							? Alert.alert(
								'Remove this drive offer?',
								'Any rider matched to it will go back to searching for another driver.',
								[
									{ text: 'Keep Offer', style: 'cancel' },
									{ text: 'Remove Offer', style: 'destructive', onPress: onCancel },
								],
							)
							: ride.status === 'pending'
							? Alert.alert(
								'Cancel this ride request?',
								'Are you sure you want to cancel this ride request?',
								[
									{ text: 'Keep Request', style: 'cancel' },
									{ text: 'Cancel Request', style: 'destructive', onPress: onCancel },
								],
							)
							: Alert.alert(
								'Cancel this ride?',
								'Are you sure you want to cancel this confirmed ride?',
								[
									{ text: 'Keep Ride', style: 'cancel' },
									{ text: 'Cancel Ride', style: 'destructive', onPress: onCancel },
								],
							)
					}
					style={[styles.dangerButton, { flex: 0, marginTop: 14 }]}
				>
					<Text style={styles.dangerButtonText}>{isDriver ? 'Remove offer' : ride.status === 'pending' ? 'Cancel pending ride' : 'Cancel ride'}</Text>
				</Pressable>
			)}
		</ScrollView>
	);
}
