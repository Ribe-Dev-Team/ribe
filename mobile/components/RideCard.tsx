import React, { useEffect, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import sharedStyles, { colors } from '../styles';
import { RideCostSplit } from '../utility/costDisplay';
import { formatPhone, maskPhone, PHONE_REVEAL_WINDOW_MS } from '../utility/phone';

const APPROVAL_WINDOW_MS = 12 * 60 * 60 * 1000;

function formatCountdown(remainingMs: number) {
  if (remainingMs <= 0) return 'Expired';
  const totalMinutes = Math.floor(remainingMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

// Counts down to the matcher's own acceptDeadline when there is one: that is the
// deadline the runner enforces, and it is clamped to the matching cutoff, so it
// is often much sooner than 12h. matchedAt + 12h is only a fallback.
function useApprovalCountdown(matchedAt?: Date, acceptDeadline?: Date) {
  const deadline = acceptDeadline
    ? acceptDeadline.getTime()
    : matchedAt ? matchedAt.getTime() + APPROVAL_WINDOW_MS : null;
  const [remainingMs, setRemainingMs] = useState(() => (deadline ? deadline - Date.now() : 0));

  useEffect(() => {
    if (!deadline) return;
    const tick = () => setRemainingMs(deadline - Date.now());
    tick();
    const interval = setInterval(tick, 30000);
    return () => clearInterval(interval);
  }, [deadline]);

  return remainingMs;
}

function useTimeUntil(target?: Date) {
  const targetMs = target ? target.getTime() : null;
  const [remainingMs, setRemainingMs] = useState(() => (targetMs ? targetMs - Date.now() : Infinity));

  useEffect(() => {
    if (!targetMs) return;
    const tick = () => setRemainingMs(targetMs - Date.now());
    tick();
    const interval = setInterval(tick, 60000);
    return () => clearInterval(interval);
  }, [targetMs]);

  return remainingMs;
}

export type RideStatus = 'confirmed' | 'awaiting' | 'pending' | 'cancelled';

const statusAccent: Record<RideStatus, string> = {
  confirmed: colors.confirmed,
  awaiting: colors.awaiting,
  pending: colors.pending,
  cancelled: colors.cancelled,
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

/** Just the street part of an address - "12 Example St" from
 *  "Unit 3, 12 Example St, Clayton VIC 3168, Australia". The suburb and the rest
 *  are on the details page. A place with no street number (e.g. "Monash
 *  University Clayton") keeps its first part. */
export function shortAddress(address: string) {
  const parts = address.split(',').map((part) => part.trim()).filter(Boolean);
  return parts.find((part) => /\d+\w*\s+[A-Za-z]/.test(part)) ?? parts[0] ?? address;
}

export function formatRideDate(date: Date) {
  const weekday = date.toLocaleDateString('en-US', { weekday: 'short' });
  const month = date.toLocaleDateString('en-US', { month: 'long' });
  return `${weekday}, ${month} ${date.getDate()}${ordinalSuffix(date.getDate())} ${date.getFullYear()}`;
}

/** A stop between the start and the end of the trip. */
export interface RideStop {
  /** Who's picked up there: name and address on the driver's card, never
   *  another rider's address on a rider's. */
  label: string;
  /** The estimated pickup, e.g. "~08:31". */
  time: string;
}

export interface RideCardProps {
  /** Firestore document id of the rideRequest/rideOffer this card renders.
   *  Accept/Decline need it to write back. Optional so hand-built sample cards
   *  still typecheck. */
  rideId?: string;
  /** Which collection `rideId` belongs to. */
  kind?: 'request' | 'offer';
  status: RideStatus;
  date: Date;
  /** Same as `rideId` - the name main's cancellation and notification code uses. */
  id?: string;
  pickup: { address: string; time: string };
  destination: { address: string; eta: string };
  etaMinutes: number;
  /** When a matched rider should be waiting - a buffer before the estimated
   *  pickup. Absent until the matcher has planned a pickup time. */
  readyBy?: string;
  /** Set while there's no planned trip yet (still searching): the person's own
   *  window, "HH:mm" to "HH:mm". The card then shows the range they gave
   *  rather than a trip length or times that look like real pickups. */
  timeWindow?: { from: string; to: string };
  /** The window this person booked, whether or not a trip has been planned
   *  inside it - what `timeWindow` is set to while still searching. */
  bookingWindow?: { from: string; to: string };
  /** The car's seats: a rider's once they're confirmed in it, a driver's always.
   *  `open` while the drive is still being offered new passengers. */
  seats?: { filled: number; total: number; open: boolean; locked: boolean };
  /** The arrival time this person asked for ("HH:mm"). */
  arriveBy?: string;
  /** Pickups the car makes between this card's first row and campus, in
   *  order, each with its estimated time. Only shown once the trip is planned. */
  stops?: RideStop[];
  /** The suggested contribution - a rider's own, or a driver's passengers'
   *  in total - formatted, or 'TBC' until the runner has priced the car. */
  cost: string;
  /** The breakdown behind `cost`, read from Firestore; see RideCostSplit. */
  costSplit?: RideCostSplit;
  co2SavedKg: number;
  /** Who's driving: a rider's matched driver, or on a driver's own card,
   *  themselves. `vehicle` is make and model; `avatarUri` their profile photo. */
  driver: { uid?: string; name: string; vehicle: string; colour?: string; avatarUri?: string };
  plate: string;
  /** When a driver match was found - only used for 'awaiting' cards to show a 12h approval countdown */
  matchedAt?: Date;
  /** The matcher's enforced accept-by time; when present the countdown runs to this instead */
  acceptDeadline?: Date;
  /** Only relevant for 'confirmed' cards - driver's phone, masked until 12h before pickup */
  driverPhone?: string;
  /** Exact pickup date/time - used to decide when driverPhone gets revealed */
  pickupDateTime?: Date;
  /** Only relevant for 'awaiting' cards - wired to the See Details modal's Accept/Decline buttons */
  onAccept?: () => void;
  onDecline?: () => void;
  /** Opens the full ride details page. Falls back to the in-card modal when omitted. */
  onSeeDetails?: () => void;
  /** Opens the driver's full profile page. Falls back to the in-card modal when omitted. */
  onOpenDriverProfile?: () => void;
}

export default function RideCard({
  kind,
  status,
  date,
  pickup,
  destination,
  readyBy,
  timeWindow,
  seats,
  cost,
  driver,
  plate,
  matchedAt,
  acceptDeadline,
  driverPhone,
  pickupDateTime,
  onAccept,
  onDecline,
  onSeeDetails,
  onOpenDriverProfile,
}: RideCardProps) {
  const accent = statusAccent[status];
  const remainingMs = useApprovalCountdown(
    status === 'awaiting' ? matchedAt : undefined,
    status === 'awaiting' ? acceptDeadline : undefined,
  );
  const msUntilPickup = useTimeUntil(status === 'confirmed' ? pickupDateTime : undefined);
  const phoneRevealed = msUntilPickup <= PHONE_REVEAL_WINDOW_MS;
  const [showPhoneInfo, setShowPhoneInfo] = useState(false);
  const [detailsVisible, setDetailsVisible] = useState(false);
  // Only riders answer a match. A driver is told a rider was found and how long
  // the rider has to accept.
  const isDriver = kind === 'offer';
  // Seats, locking, editing and cancelling are on the details page - the
  // card only shows where things stand.
  const seatLabel = !seats ? '' : seats.open ? 'Still looking' : seats.locked ? 'Locked' : 'Full';

  // The whole card opens the details. The buttons inside it still take their
  // own presses - the innermost one wins.
  const openDetails = () => (onSeeDetails ? onSeeDetails() : setDetailsVisible(true));
  // "Toyota Corolla · Blue" - colour is left off when the driver hasn't added it.
  const vehicleLine = [driver.vehicle, driver.colour].filter(Boolean).join(' · ');

  // The one thing to know at a glance, largest on the card: when to be out the
  // door. A rider's is when to be ready for pickup, a driver's when to leave.
  // Still searching there's no planned time, just the window they booked.
  const hero = timeWindow
    ? { label: 'Your window', value: `${timeWindow.from}–${timeWindow.to}` }
    : isDriver
      ? { label: 'Leave at', value: pickup.time }
      : { label: 'Be ready by', value: readyBy ?? pickup.time };
  const riders = seats?.filled ?? 0;

  return (
    <Pressable
      testID="ride-card"
      onPress={openDetails}
      // Not one accessible element: that would hide the buttons inside from
      // screen readers. Their way to the details is the summary below.
      accessible={false}
      style={({ pressed }) => [styles.card, { borderLeftColor: accent }, pressed && styles.cardPressed]}
    >
      {/* Date and price up top, quieter than the time below them. The rest -
          stops on the way, full addresses, CO2, the cost breakdown - is on the
          details page. One button for screen readers, read as a whole. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${formatRideDate(date)}. ${hero.label} ${hero.value}. See details`}
        onPress={openDetails}
      >
      <View style={styles.topRow}>
        <Text style={styles.dateText}>{formatRideDate(date)}</Text>
        <View style={styles.priceRow}>
          <Ionicons name="cash-outline" size={14} color={colors.confirmedLight} />
          <Text style={styles.priceText}>{cost}</Text>
        </View>
      </View>

      <Text style={styles.heroLabel}>{hero.label}</Text>
      <Text style={styles.heroTime}>{hero.value}</Text>

      <View style={styles.route}>
        <View style={styles.stopRow}>
          <Ionicons name="ellipse" size={10} color={colors.white} style={styles.stopIcon} />
          <Text style={styles.stopAddress} numberOfLines={1}>{shortAddress(pickup.address)}</Text>
          <Text style={styles.stopTime}>{timeWindow ? `from ${timeWindow.from}` : pickup.time}</Text>
        </View>
        <View style={styles.stopConnector} />
        <View style={styles.stopRow}>
          <Ionicons name="location" size={13} color={colors.white} style={styles.stopIcon} />
          <Text style={styles.stopAddress} numberOfLines={1}>{shortAddress(destination.address)}</Text>
          <Text style={styles.stopTime}>{timeWindow ? `by ${timeWindow.to}` : `ETA ${destination.eta}`}</Text>
        </View>
      </View>
      </Pressable>

      {status === 'awaiting' && matchedAt && (
        <View style={styles.countdownBanner}>
          <Ionicons name="time-outline" size={14} color={colors.darkBlue} />
          <Text style={styles.countdownText}>
            {remainingMs <= 0
              ? 'This match has expired.'
              : isDriver
                ? `Rider found. They have ${formatCountdown(remainingMs)} to review and accept before this match is cancelled and a new rider is searched for.`
                : `You have ${formatCountdown(remainingMs)} to review and accept before this trip is canceled.`}
          </Text>
        </View>
      )}

      {/* A rider's driver and car, to spot them at pickup. A driver's own card
          shows their riders instead, below. */}
      {!isDriver && status !== 'pending' && (
        <View style={styles.driverSection}>
          <TouchableOpacity
            style={styles.driverRow}
            accessibilityLabel="View driver profile"
            onPress={() => (onOpenDriverProfile ? onOpenDriverProfile() : openDetails())}
          >
            {driver.avatarUri ? (
              <Image source={{ uri: driver.avatarUri }} style={styles.avatar} accessibilityLabel={`${driver.name}'s profile photo`} />
            ) : (
              <View style={styles.avatarFallback}>
                <Ionicons name="person" size={16} color={colors.white} />
              </View>
            )}
            <View style={styles.driverCopy}>
              <Text style={styles.driverName} numberOfLines={1}>{driver.name}</Text>
              <Text style={styles.vehicleText} numberOfLines={1}>{vehicleLine}</Text>
            </View>
          </TouchableOpacity>
          <Text style={sharedStyles.plateBadge}>{plate}</Text>
        </View>
      )}

      {/* A driver's riders: one icon each, however many seats the car has. */}
      {isDriver && seats && (
        <View style={styles.seatSection}>
          <View style={styles.seatRow}>
            <View style={styles.riderIcons} accessibilityLabel={`${riders} rider${riders === 1 ? '' : 's'}`}>
              {Array.from({ length: riders }, (_, index) => (
                <Ionicons key={index} name="person" size={16} color={colors.white} testID="rider-icon" />
              ))}
            </View>
            <Text style={styles.seatCount}>
              {riders === 0 ? 'No riders yet' : `${riders} rider${riders === 1 ? '' : 's'}`}
            </Text>
            <Text style={styles.seatLabel}>{seatLabel}</Text>
          </View>
        </View>
      )}

      {/* A rider's one decision on a match, right on the card. Everything else
          - editing, cancelling, a driver's seats and lock - is on the details page. */}
      {status === 'awaiting' && !isDriver && (
        <TouchableOpacity style={[styles.cardAcceptButton, styles.footer]} onPress={onAccept}>
          <Ionicons name="checkmark" size={16} color={colors.white} />
          <Text style={styles.acceptText}>Accept</Text>
        </TouchableOpacity>
      )}
      {status === 'pending' && (
        <View style={[styles.searchingRow, styles.footer]}>
          <Ionicons name="search" size={14} color={colors.white} />
          <Text style={styles.searchingText}>{isDriver ? 'Searching for riders...' : 'Searching for driver...'}</Text>
        </View>
      )}

      <Modal
        visible={detailsVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDetailsVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setDetailsVisible(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            {driver.avatarUri ? (
              <Image source={{ uri: driver.avatarUri }} style={styles.modalAvatar} accessibilityLabel={`${driver.name}'s profile photo`} />
            ) : (
              <View style={styles.modalAvatarFallback}>
                <Ionicons name="person" size={28} color={colors.white} />
              </View>
            )}
            <Text style={styles.modalDriverName}>{driver.name}</Text>
            <Text style={styles.modalVehicleText}>{vehicleLine}</Text>
            {plate !== '—' && <Text style={styles.modalPlateText}>Plate: {plate}</Text>}
            {driverPhone && (
              <View style={styles.modalPhoneRow}>
                <Ionicons name="call-outline" size={13} color={colors.white} />
                <Text style={styles.modalPlateText}>
                  {phoneRevealed ? formatPhone(driverPhone) : maskPhone(driverPhone)}
                </Text>
                <TouchableOpacity
                  accessibilityLabel="Why is this number partially hidden?"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={() => setShowPhoneInfo((v) => !v)}
                >
                  <Ionicons name="information-circle-outline" size={13} color={colors.white} />
                </TouchableOpacity>
              </View>
            )}
            {showPhoneInfo && (
              <Text style={styles.modalPhoneInfoText}>
                {phoneRevealed
                  ? 'The full number is shown because your ride is within 12 hours.'
                  : "The driver's number will be fully revealed 12 hours before your matched ride."}
              </Text>
            )}

            {status === 'awaiting' && !isDriver ? (
              <View style={styles.modalButtonRow}>
                <TouchableOpacity
                  style={styles.declineButton}
                  onPress={() => {
                    setDetailsVisible(false);
                    onDecline?.();
                  }}
                >
                  <Text style={styles.declineText}>Decline</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.modalAcceptButton}
                  onPress={() => {
                    setDetailsVisible(false);
                    onAccept?.();
                  }}
                >
                  <Text style={styles.modalAcceptText}>Accept</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.closeButton} onPress={() => setDetailsVisible(false)}>
                <Text style={styles.declineText}>Close</Text>
              </TouchableOpacity>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </Pressable>
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
  cardPressed: {
    opacity: 0.85,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  dateText: {
    color: colors.whiteA85,
    fontSize: 13,
    fontWeight: '600',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  priceText: {
    color: colors.confirmedLight,
    fontSize: 16,
    fontWeight: '700',
  },
  // The time to be out the door - the biggest thing on the card.
  heroLabel: {
    color: colors.whiteA70,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  heroTime: {
    color: colors.white,
    fontFamily: 'Marcellus_400Regular',
    fontSize: 30,
    marginTop: 2,
  },
  route: {
    marginTop: 12,
  },
  driverSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.whiteA20,
  },
  driverCopy: {
    flexShrink: 1,
  },
  riderIcons: {
    flexDirection: 'row',
    gap: 2,
  },
  footer: {
    marginTop: 14,
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
    color: colors.whiteA75,
    fontSize: 12,
    marginLeft: 8,
  },
  seatSection: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.whiteA20,
  },
  seatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  seatCount: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
  seatLabel: {
    flex: 1,
    color: colors.whiteA70,
    fontSize: 12,
    textAlign: 'right',
  },
  stopConnector: {
    width: 1,
    height: 12,
    backgroundColor: colors.whiteA35,
    marginLeft: 6,
    marginVertical: 2,
  },
  countdownBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.awaitingLight,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 10,
  },
  countdownText: {
    flex: 1,
    color: colors.darkBlue,
    fontSize: 12,
    fontWeight: '600',
  },
  driverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
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
    backgroundColor: colors.whiteA20,
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
  modalPhoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  modalPhoneInfoText: {
    color: colors.white,
    fontSize: 11,
    opacity: 0.8,
    textAlign: 'center',
    marginTop: 4,
    paddingHorizontal: 8,
  },
  closeButton: {
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.whiteA50,
    marginTop: 18,
    width: '100%',
  },
  searchingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  searchingText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '600',
    opacity: 0.85,
  },
  cardAcceptButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.confirmed,
    borderRadius: 14,
    paddingVertical: 10,
  },
  acceptText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.blackA50,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: colors.mediumBlue,
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
  },
  modalAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginBottom: 10,
  },
  modalAvatarFallback: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.whiteA20,
    marginBottom: 10,
  },
  modalDriverName: {
    color: colors.white,
    fontSize: 17,
    fontWeight: '600',
  },
  modalVehicleText: {
    color: colors.white,
    fontSize: 13,
    opacity: 0.8,
    marginTop: 2,
  },
  modalPlateText: {
    color: colors.white,
    fontSize: 12,
    opacity: 0.7,
    marginTop: 6,
  },
  modalButtonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
    width: '100%',
  },
  declineButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.whiteA50,
  },
  declineText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
  modalAcceptButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: colors.confirmed,
  },
  modalAcceptText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
});
