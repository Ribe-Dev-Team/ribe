import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import styles, { colors } from '../styles';
import { Ride } from './CalendarPage';

interface RideDetailPageProps {
	ride: Ride;
	date: Date;
	onBack: () => void;
}

const profiles: Record<string, { initials: string; bio: string; degree: string; phone: string }> = {
	'Marcus Vance': { initials: 'MV', bio: 'Calm, reliable driver who enjoys helping students get to campus.', degree: 'Bachelor of Engineering', phone: '(03) 9905 2418' },
};

function formatDate(date: Date) {
	return date.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function MapPreview({ ride }: { ride: Ride }) {
	const isConfirmed = ride.status === 'confirmed';
	return (
		<View style={styles.mapPreview} accessibilityLabel={isConfirmed ? 'Preview of the confirmed ride route' : 'Map showing pickup and drop-off locations'}>
			<View style={styles.mapRoadOne} />
			<View style={styles.mapRoadTwo} />
			<View style={styles.mapRoadThree} />
			<View style={[styles.mapMarker, styles.mapPickupMarker]}><Text style={styles.mapMarkerText}>A</Text></View>
			<View style={[styles.mapMarker, styles.mapDropoffMarker]}><Text style={styles.mapMarkerText}>B</Text></View>
			{isConfirmed && <View style={styles.mapRoute} />}
			<View style={styles.mapCaption}><Text style={styles.mapCaptionText}>{isConfirmed ? 'Confirmed route preview' : 'Pickup and drop-off preview'}</Text></View>
		</View>
	);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return <View style={styles.detailSection}><Text style={styles.detailSectionTitle}>{title}</Text>{children}</View>;
}

export default function RideDetailPage({ ride, date, onBack }: RideDetailPageProps) {
	const profile = profiles[ride.driver];
	const isConfirmed = ride.status === 'confirmed';
	const status = ride.status === 'confirmed' ? 'Confirmed ride' : ride.status === 'awaiting' ? 'Awaiting confirmation' : 'Pending ride';
	const statusColor = ride.status === 'confirmed' ? colors.confirmed : ride.status === 'awaiting' ? colors.awaiting : colors.pending;

	return (
		<ScrollView contentContainerStyle={styles.detailScreen} showsVerticalScrollIndicator={false}>
			<Pressable accessibilityLabel="Back to calendar" onPress={onBack} style={styles.backButton}><Text style={styles.backButtonText}>‹</Text><Text style={styles.backButtonLabel}>Calendar</Text></Pressable>
			<Text style={styles.detailTitle}>Ride details</Text>
			<Text style={styles.detailDate}>{formatDate(date)}</Text>

			<View style={styles.detailStatusRow}><Text style={styles.detailTime}>{ride.time}</Text><View style={[styles.statusPill, { backgroundColor: statusColor }]}><Text style={styles.statusPillText}>{status}</Text></View></View>
			<MapPreview ride={ride} />

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
		</ScrollView>
	);
}
