import React, { useEffect, useState } from 'react';
import { Alert, Image, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import styles, { colors } from '../styles';
import { Ride } from './CalendarPage';
import RideMap, { markerColor } from '../components/RideMap';
import CostSplitPanel from '../components/CostSplitPanel';
import DriveControls, { canToggleLock, LockToggleButton } from '../components/DriveControls';
import { fetchRideDetails, JourneyStop, RideCar, RideDetails, RidePerson } from '../services/rideData';
import { formatPhone, maskPhone, PHONE_REVEAL_WINDOW_MS } from '../utility/phone';
import GreenhouseEmissionCard from '../components/GreenhouseEmissionCard';

interface RideDetailPageProps {
	ride: Ride;
	date: Date;
	backLabel?: string;
	onBack: () => void;
	onAccept?: () => Promise<void> | void;
	onDecline?: () => Promise<void> | void;
	onCancel?: () => Promise<void> | void;
	/** A driver's own drive: stop (true) or resume (false) taking passengers. */
	onSetLocked?: (locked: boolean) => void;
	/** A driver's own drive: change how many passengers it takes. */
	onChangeSeats?: (seats: number) => void;
}

function formatDate(date: Date) {
	return date.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
}

type Tab = 'Trip' | 'People' | 'Cost';
const TABS: Tab[] = ['Trip', 'People', 'Cost'];

function initialsOf(name: string) {
	return name.split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
}

type IconName = React.ComponentProps<typeof Ionicons>['name'];

function Section({ title, icon, children }: { title: string; icon: IconName; children: React.ReactNode }) {
	return (
		<View style={styles.detailSection}>
			<View style={styles.detailSectionHeader}>
				<View style={styles.detailSectionIcon}><Ionicons name={icon} size={15} color={colors.white} /></View>
				<Text style={styles.detailSectionTitle}>{title}</Text>
			</View>
			{children}
		</View>
	);
}


/** Their profile photo, or their initials until they've added one. */
function Avatar({ person }: { person: RidePerson }) {
	return person.photoUrl
		? <Image source={{ uri: person.photoUrl }} style={styles.avatar} accessibilityLabel={`${person.name}'s profile photo`} />
		: <View style={styles.avatar}><Text style={styles.avatarText}>{initialsOf(person.name)}</Text></View>;
}

function PersonRow({ person, subtitle, children }: { person: RidePerson; subtitle?: string; children?: React.ReactNode }) {
	return (
		<View style={styles.personRow}>
			<Avatar person={person} />
			<View style={styles.personCopy}>
				<Text style={styles.personName}>{person.name}{person.awaiting ? '  ·  awaiting' : ''}</Text>
				{subtitle ? <Text style={styles.personBio}>{subtitle}</Text> : null}
				{children}
			</View>
		</View>
	);
}

/** Someone's number, masked until 12 hours before the trip as on the ride
 *  card; once shown, buttons to call or text them - say, where the car is
 *  parked at uni. */
function ContactLine({ name, phone, revealed }: { name: string; phone?: string; revealed: boolean }) {
	if (!phone) return <Text style={styles.infoLine}>Contact  ·  Not shared</Text>;
	const digits = phone.replace(/[^\d+]/g, '');
	return (
		<>
			<Text style={styles.infoLine}>
				Contact  ·  {revealed ? formatPhone(phone) : `${maskPhone(phone)} (shown 12h before pickup)`}
			</Text>
			{revealed && (
				<View style={styles.contactActions}>
					<Pressable accessibilityLabel={`Call ${name}`} onPress={() => Linking.openURL(`tel:${digits}`)} style={styles.contactButton}>
						<Ionicons name="call" size={13} color={colors.white} />
						<Text style={styles.contactButtonText}>Call</Text>
					</Pressable>
					<Pressable accessibilityLabel={`Text ${name}`} onPress={() => Linking.openURL(`sms:${digits}`)} style={styles.contactButton}>
						<Ionicons name="chatbubble" size={13} color={colors.white} />
						<Text style={styles.contactButtonText}>Text</Text>
					</Pressable>
				</View>
			)}
		</>
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
		<Section title="Journey" icon="navigate-outline">
			{stops.map((stop, index) => (
				<View key={index}>
					<View style={styles.locationRow}>
						{/* The marker, and the line on down to the next stop. */}
						<View style={styles.journeyRail}>
							{stop.marker
								? <View style={[styles.journeyMarker, { backgroundColor: markerColor(stop.kind) }]}><Text style={styles.journeyMarkerText}>{stop.marker}</Text></View>
								: <View style={styles.journeyMarkerHidden} accessibilityLabel="Not shown on the map" />}
							{index < stops.length - 1 && <View style={styles.locationLine} />}
						</View>
						<View style={[styles.personCopy, index < stops.length - 1 && styles.journeyStopCopy]}>
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

/** The car on one line - what it is, and its plate to spot it by. */
function CarLine({ car }: { car?: RideCar }) {
	const name = [car?.colour, car?.make, car?.model].filter(Boolean).join(' ');
	return (
		<View style={styles.carRow}>
			<Ionicons name="car-sport-outline" size={18} color={colors.white} />
			<Text style={styles.carName} numberOfLines={1}>{name || 'Vehicle details not added yet'}</Text>
			{car?.plate ? <Text style={styles.carPlate} accessibilityLabel={`Plate ${car.plate}`}>{car.plate}</Text> : null}
		</View>
	);
}

export default function RideDetailPage({
	ride, date, backLabel = 'Calendar', onBack, onAccept, onDecline, onCancel, onSetLocked, onChangeSeats,
}: RideDetailPageProps) {
	const [details, setDetails] = useState<RideDetails | null>(null);
	// Who's in the car matters most while someone's deciding on a match.
	const [tab, setTab] = useState<Tab>(ride.status === 'awaiting' ? 'People' : 'Trip');
	const isConfirmed = ride.status === 'confirmed';
	// A match needs both sides to accept; once you have, you're waiting on the other.
	const isDriver = ride.kind === 'offer';
	const isMatched = ride.status === 'confirmed' || ride.status === 'awaiting';
	const status = ride.status === 'confirmed' ? 'Confirmed Ride'
		: ride.status === 'awaiting' ? (
			ride.youAccepted ? `You Accepted - Waiting for the ${isDriver ? 'Rider' : 'Driver'}`
			: isDriver ? `Rider Found - ${ride.otherAccepted ? 'They Accepted, ' : ''}Waiting for Your Answer`
			: `Awaiting Your Confirmation${ride.otherAccepted ? ' - Your Driver Accepted' : ''}`
		)
		: 'Pending Ride';
	// What the time at the top is: once the trip is planned, when the driver
	// leaves or the rider is collected; until then, the window they booked.
	const timeLabel = !ride.duration ? 'Travel window' : isDriver ? 'Leave time' : 'Pick-up time';
	const statusColor = ride.status === 'confirmed' ? colors.confirmed : ride.status === 'awaiting' ? colors.awaiting : colors.pending;
	const statusIcon: IconName = ride.status === 'confirmed' ? 'checkmark' : ride.status === 'awaiting' ? 'hourglass' : 'search';
	// Answering a match, calling off the booking, and a driver stopping new
	// riders all live in the footer - always in reach, never in the way.
	const canCancel = (isConfirmed || ride.status === 'pending' || isDriver) && Boolean(onCancel);
	const canAnswer = ride.status === 'awaiting' && Boolean(onAccept || onDecline);
	const canLock = isDriver && ride.seats !== undefined && Boolean(onSetLocked) && canToggleLock(ride.seats);
	const cancelLabel = isDriver ? 'Remove Offer' : ride.status === 'pending' ? 'Cancel Request' : 'Cancel Ride';
	const confirmCancel = () =>
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
			);

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
	// As on the ride card: numbers show in full from 12 hours before the trip,
	// and only their first digits before that. A confirmed rider sees their
	// driver's; a driver, each confirmed passenger's.
	const phoneRevealed = details?.startsAt !== undefined
		&& details.startsAt.getTime() - Date.now() <= PHONE_REVEAL_WINDOW_MS;

	return (
		<View style={styles.detailPage}>
			<ScrollView contentContainerStyle={styles.detailScreen} showsVerticalScrollIndicator={false}>
				<Pressable accessibilityLabel={`Back to ${backLabel}`} onPress={onBack} style={styles.backButton}>
					<Ionicons name="chevron-back" size={22} color={colors.white} />
					<Text style={styles.backButtonLabel}>{backLabel}</Text>
				</Pressable>

				{/* At a glance: what it is, when, and where it's up to. */}
				<View style={styles.detailHero}>
					<View style={styles.detailTitleRow}>
						{isDriver && <Ionicons name="car-sport" size={14} color={colors.white} accessibilityLabel="Driving" />}
						<Text style={styles.detailKicker}>{isDriver ? 'Drive Details' : 'Ride Details'}</Text>
					</View>
					<Text style={styles.detailTitle}>{formatDate(date)}</Text>
					<View style={styles.detailTimeRow}>
						<Text style={styles.detailTime}>{ride.time}</Text>
						<Text style={styles.detailTimeLabel}>{timeLabel}{ride.duration ? `  ·  ${ride.duration} trip` : ''}</Text>
					</View>
					<View style={styles.detailStatusLine}>
						<View style={[styles.detailStatusIcon, { backgroundColor: statusColor }]}>
						<Ionicons name={statusIcon} size={12} color={colors.white} />
					</View>
						<Text style={styles.detailStatusText}>{status}</Text>
					</View>
				</View>

				<View style={styles.detailTabs} accessibilityRole="tablist">
					{TABS.map((name) => (
						<Pressable
							key={name}
							accessibilityRole="tab"
							accessibilityState={{ selected: tab === name }}
							onPress={() => setTab(name)}
							style={[styles.detailTab, tab === name && styles.detailTabActive]}
						>
							<Text style={[styles.detailTabText, tab === name && styles.detailTabTextActive]}>{name}</Text>
						</Pressable>
					))}
				</View>

				{tab === 'Trip' && (
					<>
						<RideMap points={details?.mapPoints ?? []} loading={loading} />
						<JourneySection stops={journey} />
					</>
				)}

				{tab === 'People' && (isDriver ? (
					<Section title="Your Passengers" icon="people-outline">
						{loading ? <Text style={styles.mutedDetail}>Loading passengers...</Text>
							: details.passengers.length === 0 ? <Text style={styles.mutedDetail}>Passengers will appear here once riders are matched to your drive.</Text>
							: details.passengers.map((person, index) => (
								<PersonRow key={index} person={person} subtitle={aboutOf(person)}>
									{person.phone ? <ContactLine name={person.name} phone={person.phone} revealed={phoneRevealed} /> : null}
								</PersonRow>
							))}
						{/* How full the car is, and whether it's still taking riders. */}
						{ride.seats && (
							<DriveControls
								seats={ride.seats}
								riderDeciding={ride.status === 'awaiting'}
								onChangeSeats={onChangeSeats}
							/>
						)}
						{!loading && <CarLine car={details.car} />}
					</Section>
				) : !isMatched ? (
					<Section title="Your Driver" icon="person-outline"><Text style={styles.mutedDetail}>A driver will appear here once you're matched.</Text></Section>
				) : (
					<>
						<Section title="Your Driver" icon="person-outline">
							{loading ? <Text style={styles.mutedDetail}>Loading driver details...</Text>
								: !driver ? <Text style={styles.mutedDetail}>Driver details aren't available right now.</Text>
								: (
									<>
										<PersonRow person={driver} subtitle={driver.bio ?? 'This driver has not added a bio yet.'} />
										<Text style={styles.infoLine}>Degree  ·  {driver.degree ?? 'Not added'}</Text>
										{isConfirmed && <ContactLine name={driver.name} phone={driver.phone} revealed={phoneRevealed} />}
										<CarLine car={details.car} />
									</>
								)}
						</Section>
						{!loading && (
							<Section title="Other Riders" icon="people-outline">
								{details.passengers.length === 0
									? <Text style={styles.mutedDetail}>{isConfirmed ? "You're the only rider so far." : 'No other riders are confirmed in this car yet.'}</Text>
									: details.passengers.map((person, index) => <PersonRow key={index} person={person} subtitle={aboutOf(person)} />)}
							</Section>
						)}
					</>
				))}

				{tab === 'Cost' && (
					<>
						<CostSplitPanel costSplit={ride.costSplit} />
						<View style={{ height: 12 }} />
						<GreenhouseEmissionCard co2SavedKg={ride.co2SavedKg ?? 0} />
					</>
				)}

			</ScrollView>

			{(canAnswer || canLock || canCancel) && (
				<View style={styles.detailFooter}>
					{/* Answering a match comes first; managing the booking under it. */}
					{canAnswer && (
						<View style={styles.footerRow}>
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
								style={[styles.footerButton, styles.footerDecline]}
							>
								<Ionicons name="close" size={18} color={colors.white} />
								<Text style={styles.footerButtonText}>Decline</Text>
							</Pressable>
							{onAccept && (
								<Pressable onPress={onAccept} style={[styles.footerButton, styles.footerAccept]}>
									<Ionicons name="checkmark" size={18} color={colors.white} />
									<Text style={styles.footerButtonText}>Accept</Text>
								</Pressable>
							)}
						</View>
					)}
					{(canLock || canCancel) && (
						<View style={styles.footerRow}>
							{canLock && <LockToggleButton seats={ride.seats!} onSetLocked={onSetLocked!} compact={canAnswer} />}
							{canCancel && (
								<Pressable onPress={confirmCancel} style={[styles.footerButton, styles.footerCancel, canAnswer && styles.footerButtonCompact]}>
									<Ionicons name="trash-outline" size={16} color={colors.white} />
									<Text style={[styles.footerButtonText, canAnswer && styles.footerButtonTextCompact]}>{cancelLabel}</Text>
								</Pressable>
							)}
						</View>
					)}
				</View>
			)}
		</View>
	);
}
