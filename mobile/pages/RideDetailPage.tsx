import React, { useEffect, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import styles, { colors } from '../styles';
import { Ride } from './CalendarPage';
import RideMap, { markerColor } from '../components/RideMap';
import CostSplitPanel from '../components/CostSplitPanel';
import { fetchRideDetails, JourneyStop, RideCar, RideDetails, RidePerson } from '../services/rideData';
import { formatPhone, maskPhone, PHONE_REVEAL_WINDOW_MS } from '../utility/phone';

interface RideDetailPageProps {
	ride: Ride;
	date: Date;
	backLabel?: string;
	onBack: () => void;
	onAccept?: () => Promise<void> | void;
	onDecline?: () => Promise<void> | void;
	onCancel?: () => Promise<void> | void;
}

function formatDate(date: Date) {
	return date.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function initialsOf(name: string) {
	return name.split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return <View style={styles.detailSection}><Text style={styles.detailSectionTitle}>{title}</Text>{children}</View>;
}

/** Their profile photo, or their initials until they've added one. */
function Avatar({ person }: { person: RidePerson }) {
	return person.photoUrl
		? <Image source={{ uri: person.photoUrl }} style={styles.avatar} accessibilityLabel={`${person.name}'s profile photo`} />
		: <View style={styles.avatar}><Text style={styles.avatarText}>{initialsOf(person.name)}</Text></View>;
}

function PersonRow({ person, subtitle }: { person: RidePerson; subtitle?: string }) {
	return (
		<View style={styles.personRow}>
			<Avatar person={person} />
			<View style={styles.personCopy}>
				<Text style={styles.personName}>{person.name}{person.awaiting ? '  ·  awaiting' : ''}</Text>
				{subtitle ? <Text style={styles.personBio}>{subtitle}</Text> : null}
			</View>
		</View>
	);
}

/** A passenger's line under their name: what they study, then their bio. */
function aboutOf(person: RidePerson) {
	return [person.degree, person.bio].filter(Boolean).join('  ·  ') || undefined;
}

/** Every stop in order, each with its map marker - the map's legend. Until
 *  the ride loads, or for a stop with no planned time yet, the ride's own
 *  ends and booking window stand in. */
function JourneySection({ stops }: { stops: JourneyStop[] }) {
	return (
		<Section title="Journey">
			{stops.map((stop, index) => (
				<View key={index}>
					{index > 0 && <View style={styles.locationLine} />}
					<View style={styles.locationRow}>
						{stop.marker
							? <View style={[styles.journeyMarker, { backgroundColor: markerColor(stop.kind) }]}><Text style={styles.journeyMarkerText}>{stop.marker}</Text></View>
							: <View style={styles.journeyMarkerHidden} accessibilityLabel="Not shown on the map" />}
						<View style={styles.personCopy}>
							<Text style={styles.locationLabel}>{stop.title}{stop.awaiting ? '  ·  awaiting' : ''}</Text>
							{stop.address ? <Text style={styles.locationText}>{stop.address}</Text> : null}
							{stop.time ? <Text style={styles.locationMeta}>{stop.time}</Text> : null}
						</View>
					</View>
				</View>
			))}
		</Section>
	);
}

function CarSection({ title, car }: { title: string; car?: RideCar }) {
	const name = [car?.colour, car?.make, car?.model].filter(Boolean).join(' ');
	return (
		<Section title={title}>
			<View style={styles.carRow}>
				<Text style={styles.carIcon}>▣</Text>
				<View>
					<Text style={styles.personName}>{name || 'Vehicle details not added yet'}</Text>
					<Text style={styles.infoLine}>Plate  ·  {car?.plate ?? 'Not shared'}</Text>
				</View>
			</View>
		</Section>
	);
}

export default function RideDetailPage({ ride, date, backLabel = 'Calendar', onBack, onAccept, onDecline, onCancel }: RideDetailPageProps) {
	const [details, setDetails] = useState<RideDetails | null>(null);
	const isConfirmed = ride.status === 'confirmed';
	// Drivers don't answer matches, so their awaiting offer reads as a rider found.
	const isDriver = ride.kind === 'offer';
	const isMatched = ride.status === 'confirmed' || ride.status === 'awaiting';
	const status = ride.status === 'confirmed' ? 'Confirmed ride'
		: ride.status === 'awaiting' ? (isDriver ? 'Rider found - awaiting their confirmation' : 'Awaiting confirmation')
		: 'Pending ride';
	// What the time at the top is: once the trip is planned, when the driver
	// leaves or the rider is collected; until then, the window they booked.
	const timeLabel = !ride.duration ? 'travel window' : isDriver ? 'leave time' : 'pick-up time';
	const statusColor = ride.status === 'confirmed' ? colors.confirmed : ride.status === 'awaiting' ? colors.awaiting : colors.pending;

	useEffect(() => {
		let active = true;
		setDetails(null);
		const load = ride.rideId && ride.kind
			? fetchRideDetails(ride.rideId, ride.kind)
			: Promise.resolve<RideDetails>({ passengers: [], journey: [], mapPoints: [] });
		load
			.catch((error) => {
				console.warn('Failed to load ride details:', error);
				return { passengers: [], journey: [], mapPoints: [] } as RideDetails;
			})
			.then((loaded) => { if (active) setDetails(loaded); });
		return () => { active = false; };
	}, [ride.rideId, ride.kind, ride.status]);

	const loading = details === null;
	const driver = details?.driver;
	// The ride's own ends while loading. Once loaded, the trip's start shows the
	// booking window if nothing has been planned yet.
	const journey: JourneyStop[] = details?.journey.length
		? details.journey.map((stop, index) => (index === 0 && !stop.time ? { ...stop, time: ride.time } : stop))
		: [
			{ kind: 'start', title: isDriver ? 'Departure' : 'Pickup', address: ride.start, time: ride.time },
			{ kind: 'end', title: 'Drop-off', address: ride.destination },
		];
	// As on the ride card: a confirmed rider sees their driver's number in full
	// from 12 hours before pickup, and only its first digits before that.
	const phoneRevealed = details?.startsAt !== undefined
		&& details.startsAt.getTime() - Date.now() <= PHONE_REVEAL_WINDOW_MS;

	return (
		<ScrollView contentContainerStyle={styles.detailScreen} showsVerticalScrollIndicator={false}>
			<Pressable accessibilityLabel={`Back to ${backLabel}`} onPress={onBack} style={styles.backButton}><Text style={styles.backButtonText}>‹</Text><Text style={styles.backButtonLabel}>{backLabel}</Text></Pressable>
			<View style={styles.detailTitleRow}>
				{isDriver && <Ionicons name="car-sport" size={28} color={colors.white} accessibilityLabel="Driving" />}
				<Text style={styles.detailTitle}>{isDriver ? 'Drive details' : 'Ride details'}</Text>
			</View>
			<Text style={styles.detailDate}>{formatDate(date)}</Text>

			<View style={styles.detailStatusRow}><View style={styles.detailTimeRow}><Text style={styles.detailTime}>{ride.time}</Text><Text style={styles.detailTimeLabel}>{timeLabel}</Text></View><View style={[styles.statusPill, { backgroundColor: statusColor }]}><Text style={styles.statusPillText}>{status}</Text></View></View>

			<RideMap points={details?.mapPoints ?? []} loading={loading} />

			<JourneySection stops={journey} />

			{isDriver ? (
				<>
					<Section title="Your passengers">
						{loading ? <Text style={styles.mutedDetail}>Loading passengers...</Text>
							: details.passengers.length === 0 ? <Text style={styles.mutedDetail}>Passengers will appear here once riders are matched to your drive.</Text>
							: details.passengers.map((person, index) => <PersonRow key={index} person={person} subtitle={aboutOf(person)} />)}
					</Section>
					{!loading && <CarSection title="Your car" car={details.car} />}
				</>
			) : !isMatched ? (
				<Section title="Your driver"><Text style={styles.mutedDetail}>A driver will appear here once you're matched.</Text></Section>
			) : (
				<>
					<Section title="Your driver">
						{loading ? <Text style={styles.mutedDetail}>Loading driver details...</Text>
							: !driver ? <Text style={styles.mutedDetail}>Driver details aren't available right now.</Text>
							: (
								<>
									<PersonRow person={driver} subtitle={driver.bio ?? 'This driver has not added a bio yet.'} />
									<Text style={styles.infoLine}>Degree  ·  {driver.degree ?? 'Not added'}</Text>
									{isConfirmed && (
										<Text style={styles.infoLine}>
											Contact  ·  {driver.phone ? (phoneRevealed ? formatPhone(driver.phone) : `${maskPhone(driver.phone)} (shown 12h before pickup)`) : 'Not shared'}
										</Text>
									)}
								</>
							)}
					</Section>
					{!loading && driver && <CarSection title="Driver's car" car={details.car} />}
					{!loading && (
						<Section title="Other riders">
							{details.passengers.length === 0
								? <Text style={styles.mutedDetail}>{isConfirmed ? "You're the only rider so far." : 'No other riders are confirmed in this car yet.'}</Text>
								: details.passengers.map((person, index) => <PersonRow key={index} person={person} subtitle={aboutOf(person)} />)}
						</Section>
					)}
				</>
			)}

			<View style={styles.savingsPanel}><Text style={styles.savingsKicker}>CO2 SAVINGS</Text><Text style={styles.savingsValue}>2.4 kg saved</Text><Text style={styles.savingsText}>Sharing this ride keeps another car off the road.</Text></View>
			<CostSplitPanel costSplit={ride.costSplit} />

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
