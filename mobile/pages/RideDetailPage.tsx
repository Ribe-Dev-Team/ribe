import React from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import styles, { colors } from '../styles';
import { Ride } from './CalendarPage';
import MapPreview from '../components/MapPreview';

interface RideDetailPageProps {
	ride: Ride;
	date: Date;
	backLabel?: string;
	onBack: () => void;
	onAccept?: () => void;
	onDecline?: () => void;
	onCancel?: () => void;
}

const profiles: Record<string, { initials: string; bio: string; degree: string; phone: string }> = {
	'Marcus Vance': { initials: 'MV', bio: 'Calm, reliable driver who enjoys helping students get to campus.', degree: 'Bachelor of Engineering', phone: '(03) 9905 2418' },
	'Priya Nair': { initials: 'PN', bio: 'Early riser, always on time. Happy to chat or drive in quiet.', degree: 'Bachelor of Commerce', phone: '(03) 9905 7731' },
};

function formatDate(date: Date) {
	return date.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return <View style={styles.detailSection}><Text style={styles.detailSectionTitle}>{title}</Text>{children}</View>;
}

export default function RideDetailPage({ ride, date, backLabel = 'Calendar', onBack, onAccept, onDecline, onCancel }: RideDetailPageProps) {
	const profile = profiles[ride.driver];
	const isConfirmed = ride.status === 'confirmed';
	const status = ride.status === 'confirmed' ? 'Confirmed ride' : ride.status === 'awaiting' ? 'Awaiting confirmation' : 'Pending ride';
	const statusColor = ride.status === 'confirmed' ? colors.confirmed : ride.status === 'awaiting' ? colors.awaiting : colors.pending;

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

			{isConfirmed && profile ? <Section title="Your driver"><View style={styles.personRow}><View style={styles.avatar}><Text style={styles.avatarText}>{profile.initials}</Text></View><View style={styles.personCopy}><Text style={styles.personName}>{ride.driver}</Text><Text style={styles.personBio}>{profile.bio}</Text></View></View><Text style={styles.infoLine}>Degree  ·  {profile.degree}</Text><Text style={styles.infoLine}>Contact  ·  {profile.phone}</Text></Section> : <Section title="Your driver"><Text style={styles.mutedDetail}>A driver will appear here once your ride is confirmed.</Text></Section>}

			{isConfirmed && <Section title="Driver's car"><View style={styles.carRow}><Text style={styles.carIcon}>▣</Text><View><Text style={styles.personName}>Honda Civic</Text><Text style={styles.infoLine}>Silver  ·  1ABC 234</Text></View></View></Section>}
			{isConfirmed && <Section title="Other riders"><View style={styles.personRow}><View style={styles.avatar}><Text style={styles.avatarText}>EP</Text></View><View><Text style={styles.personName}>Elena Park</Text><Text style={styles.personBio}>Monash student, studying design.</Text></View></View></Section>}

			<View style={styles.savingsPanel}><Text style={styles.savingsKicker}>CO2 SAVINGS</Text><Text style={styles.savingsValue}>2.4 kg saved</Text><Text style={styles.savingsText}>Sharing this ride keeps another car off the road.</Text></View>
			<View style={styles.costPanel}><Text style={styles.costTitle}>Estimated cost split</Text><View style={styles.costRow}><Text style={styles.costLabel}>Estimated trip cost</Text><Text style={styles.costValue}>$8.50</Text></View><View style={styles.costRow}><Text style={styles.costLabel}>Your share</Text><Text style={styles.costValue}>$4.25</Text></View><Text style={styles.costNote}>Final amount may change with route detours.</Text></View>

			{ride.status === 'awaiting' && (onAccept || onDecline) && (
				<View style={[styles.editActionsRow, { marginTop: 14 }]}>
					<Pressable
						onPress={() =>
							Alert.alert(
								'Decline this ride?',
								'Are you sure you want to decline this ride?',
								[
									{ text: 'Keep Ride', style: 'cancel' },
									{ text: 'Decline', style: 'destructive', onPress: onDecline },
								],
							)
						}
						style={styles.dangerButton}
					>
						<Text style={styles.dangerButtonText}>Decline</Text>
					</Pressable>
					<Pressable onPress={onAccept} style={[styles.successButton, { marginTop: 0 }]}>
						<Text style={styles.successButtonText}>Accept</Text>
					</Pressable>
				</View>
			)}

			{(isConfirmed || ride.status === 'pending') && onCancel && (
				<Pressable
					onPress={() =>
						ride.status === 'pending'
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
					<Text style={styles.dangerButtonText}>{ride.status === 'pending' ? 'Cancel pending ride' : 'Cancel ride'}</Text>
				</Pressable>
			)}
		</ScrollView>
	);
}
