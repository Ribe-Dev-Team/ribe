import React, { useEffect, useState } from 'react';
import { Alert, Image, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../styles';
import NumberStepper from './NumberStepper';

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

const PHONE_REVEAL_WINDOW_MS = 12 * 60 * 60 * 1000;

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

function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, '');
  return `${digits.slice(0, 4)} •• •• ••`;
}

function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, '');
  return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 10)}`;
}

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
  /** Firestore document id of the rideRequest/rideOffer this card renders.
   *  Accept/Decline need it to write back. Optional so hand-built sample cards
   *  still typecheck. */
  rideId?: string;
  /** Which collection `rideId` belongs to. */
  kind?: 'request' | 'offer';
  status: RideStatus;
  date: Date;
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
  cost: string;
  co2SavedKg: number;
  driver: { uid?: string; name: string; vehicle: string; avatarUri?: string };
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
  /** Only relevant for 'pending' cards */
  onEdit?: () => void;
  onCancel?: () => void;
  /** Opens the full ride details page. Falls back to the in-card modal when omitted. */
  onSeeDetails?: () => void;
  /** Opens the driver's full profile page. Falls back to the in-card modal when omitted. */
  onOpenDriverProfile?: () => void;
  /** Driver only: stop (true) or resume (false) taking passengers. */
  onSetLocked?: (locked: boolean) => void;
  /** Driver only: change how many passengers the drive takes. */
  onChangeSeats?: (seats: number) => void;
}

/** Most passengers an offer can take - the booking form's limit. */
const MAX_SEATS = 12;

export default function RideCard({
  kind,
  status,
  date,
  pickup,
  destination,
  etaMinutes,
  readyBy,
  timeWindow,
  seats,
  arriveBy,
  cost,
  co2SavedKg,
  driver,
  plate,
  matchedAt,
  acceptDeadline,
  driverPhone,
  pickupDateTime,
  onAccept,
  onDecline,
  onEdit,
  onCancel,
  onSeeDetails,
  onOpenDriverProfile,
  onSetLocked,
  onChangeSeats,
}: RideCardProps) {
  const accent = statusAccent[status];
  const remainingMs = useApprovalCountdown(
    status === 'awaiting' ? matchedAt : undefined,
    status === 'awaiting' ? acceptDeadline : undefined,
  );
  const msUntilPickup = useTimeUntil(status === 'confirmed' ? pickupDateTime : undefined);
  const phoneRevealed = msUntilPickup <= PHONE_REVEAL_WINDOW_MS;
  const [showCostInfo, setShowCostInfo] = useState(false);
  const [showPhoneInfo, setShowPhoneInfo] = useState(false);
  const [detailsVisible, setDetailsVisible] = useState(false);
  // Only riders answer a match. A driver is told a rider was found and how long
  // the rider has to accept; all they can do is remove the whole offer.
  const isDriver = kind === 'offer';
  const confirmRemoveOffer = () =>
    Alert.alert(
      'Remove this drive offer?',
      'Any rider matched to it will go back to searching for another driver.',
      [
        { text: 'Keep Offer', style: 'cancel' },
        { text: 'Remove Offer', style: 'destructive', onPress: onCancel },
      ],
    );

  // Seats: a rider sees them once confirmed; a driver always sees their own.
  const showSeats = Boolean(seats) && (isDriver || status === 'confirmed');
  // A rider deciding on a match holds a seat too, so seats can't drop below it.
  const seatsTaken = (seats?.filled ?? 0) + (isDriver && status === 'awaiting' ? 1 : 0);
  const [seatEditorVisible, setSeatEditorVisible] = useState(false);
  const [seatDraft, setSeatDraft] = useState(seats?.total ?? 1);
  // Locked, the car is as full as it's going to get: it reads 1/1, not 1/3,
  // because the empty seats aren't on offer any more.
  const seatTotal = seats && seats.locked && seats.filled > 0 ? seats.filled : seats?.total ?? 0;
  // The driver's own controls: seats any time, lock/unlock once someone's
  // aboard (a full car that isn't locked has nothing to lock).
  const canEditSeats = isDriver && Boolean(onChangeSeats);
  const canToggleLock = isDriver && Boolean(onSetLocked) && (seats?.filled ?? 0) > 0
    && Boolean(seats?.open || seats?.locked);
  const seatLabel = !seats ? '' : seats.open
    ? (isDriver ? 'Still looking for passengers' : 'Driver may add passengers')
    : !isDriver ? 'No more passengers will be added'
      : seats.locked ? 'Locked' : 'Full';

  const confirmLockToggle = () => {
    if (!seats || !onSetLocked) return;
    if (seats.open) {
      Alert.alert(
        'Stop taking passengers?',
        `You keep the ${seats.filled} rider${seats.filled === 1 ? '' : 's'} already confirmed. No new riders will be matched to this drive.`,
        [
          { text: 'Keep Looking', style: 'cancel' },
          { text: 'Lock Drive', onPress: () => onSetLocked(true) },
        ],
      );
    } else {
      Alert.alert(
        'Take more passengers?',
        'This drive goes back into matching for its free seats. New riders still have to fit your route and everyone\'s arrival time.',
        [
          { text: 'Keep Locked', style: 'cancel' },
          { text: 'Unlock', onPress: () => onSetLocked(false) },
        ],
      );
    }
  };

  return (
    <View style={[styles.card, { borderLeftColor: accent }]}>
      <View style={styles.topRow}>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: accent }]} />
          <Text style={styles.statusLabel}>{formatRideDate(date)}</Text>
        </View>
        {/* Still searching: the window they gave, not a trip length - nothing
            has been planned yet, so there is no trip to time. */}
        <Text style={styles.etaBadge}>
          {timeWindow ? `${timeWindow.from}–${timeWindow.to}` : `${etaMinutes} min`}
        </Text>
      </View>

      <View style={styles.stopRow}>
        <Ionicons name="ellipse" size={10} color={colors.white} style={styles.stopIcon} />
        <Text style={styles.stopAddress} numberOfLines={1}>{pickup.address}</Text>
        <Text style={styles.stopTime}>{timeWindow ? `from ${timeWindow.from}` : pickup.time}</Text>
      </View>
      {readyBy && <Text style={styles.readyBy}>Be ready by {readyBy}</Text>}
      <View style={styles.stopConnector} />
      <View style={styles.stopRow}>
        <Ionicons name="location" size={13} color={colors.white} style={styles.stopIcon} />
        <Text style={styles.stopAddress} numberOfLines={1}>{destination.address}</Text>
        <Text style={styles.stopTime}>{timeWindow ? `by ${timeWindow.to}` : `ETA ${destination.eta}`}</Text>
      </View>

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

      <View style={styles.statsRow}>
        <View style={styles.statInline}>
          <Ionicons name="cash-outline" size={13} color={colors.white} />
          <Text style={styles.statInlineText}>{cost}</Text>
          <TouchableOpacity
            accessibilityLabel="What does this fee cover?"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={() => setShowCostInfo((v) => !v)}
          >
            <Ionicons name="information-circle-outline" size={13} color={colors.white} style={{ opacity: 0.7 }} />
          </TouchableOpacity>
        </View>
        <Text style={styles.statSeparator}>·</Text>
        <View style={styles.statInline}>
          <Ionicons name="leaf-outline" size={13} color={colors.confirmedLight} />
          <Text style={styles.statInlineText}>{co2SavedKg}kg CO2 saved</Text>
        </View>
      </View>

      {showCostInfo && (
        <View style={styles.infoNote}>
          <Text style={styles.infoNoteText}>
            This is the recommended fee to pay, including parking. See the FAQ for more information.
          </Text>
        </View>
      )}

      <View style={styles.divider} />

      {status === 'awaiting' ? (
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.seeDetailsButton}
            onPress={() => (onSeeDetails ? onSeeDetails() : setDetailsVisible(true))}
          >
            <Ionicons name="eye-outline" size={16} color={colors.white} />
            <Text style={styles.seeDetailsText}>See Details</Text>
          </TouchableOpacity>
          {isDriver ? (
            <TouchableOpacity style={styles.removeOfferButton} onPress={confirmRemoveOffer}>
              <Ionicons name="close" size={16} color={colors.white} />
              <Text style={styles.acceptText}>Remove offer</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.acceptButton} onPress={onAccept}>
              <Ionicons name="checkmark" size={16} color={colors.white} />
              <Text style={styles.acceptText}>Accept</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : status === 'pending' ? (
        <>
          <View style={styles.footerRow}>
            <View style={styles.searchingRow}>
              <Ionicons name="search" size={14} color={colors.white} />
              <Text style={styles.searchingText}>{isDriver ? 'Searching for riders...' : 'Searching for driver...'}</Text>
            </View>
            <View style={styles.pendingIconRow}>
              <TouchableOpacity
                accessibilityLabel="Edit ride request"
                style={styles.pendingIconButton}
                onPress={onEdit}
              >
                <Ionicons name="create-outline" size={16} color={colors.white} />
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityLabel={isDriver ? 'Remove drive offer' : 'Cancel ride request'}
                style={[styles.pendingIconButton, styles.cancelIconButton]}
                onPress={() => isDriver ? confirmRemoveOffer() :
                  Alert.alert(
                    'Cancel ride request?',
                    'Are you sure you want to cancel this ride request?',
                    [
                      { text: 'Keep Request', style: 'cancel' },
                      { text: 'Cancel Ride', style: 'destructive', onPress: onCancel },
                    ],
                  )
                }
              >
                <Ionicons name="close" size={16} color={colors.white} />
              </TouchableOpacity>
            </View>
          </View>
          <TouchableOpacity style={styles.seeMoreLink} onPress={onSeeDetails}>
            <Text style={styles.seeMoreLinkText}>See more information</Text>
            <Ionicons name="chevron-forward" size={13} color={colors.white} />
          </TouchableOpacity>
        </>
      ) : (
        <>
          <View style={styles.footerRow}>
            <TouchableOpacity
              style={styles.driverRow}
              accessibilityLabel="View driver profile"
              onPress={() => (onOpenDriverProfile ? onOpenDriverProfile() : setDetailsVisible(true))}
            >
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
            </TouchableOpacity>
            <Text style={styles.plateBadge}>{plate}</Text>
          </View>
          {/* "See more information" for an upcoming ride is at the very
              bottom of the card, below the seats - see after the seat section. */}
        </>
      )}

      {showSeats && seats && (
        <View style={styles.seatSection}>
          {/* The status gets the whole line - the driver's buttons sit on
              their own row below, so they never squeeze it out. */}
          <View style={styles.seatRow}>
            <Ionicons name="people" size={14} color={colors.white} />
            <Text style={styles.seatCount}>{seats.filled}/{seatTotal} seats</Text>
            <Text style={styles.seatLabel}>{seatLabel}</Text>
          </View>
          {/* A progress bar of the car filling up: green for seats taken,
              orange for seats still on offer (1 of 3 = one third green). Once
              the car is full or locked there's nothing left on offer, so it's
              all green. */}
          {seats.filled > 0 && (
            <View style={styles.seatBar} accessibilityLabel={seats.open ? 'Confirmed, still taking passengers' : 'Confirmed, no more passengers'}>
              <View
                testID="seat-bar-taken"
                style={[styles.seatBarPart, { flex: seats.open ? seats.filled : 1, backgroundColor: colors.confirmed }]}
              />
              {seats.open && (
                <View
                  testID="seat-bar-free"
                  style={[styles.seatBarPart, { flex: seats.total - seats.filled, backgroundColor: colors.awaiting }]}
                />
              )}
            </View>
          )}
          {!isDriver && seats.open && (
            <Text style={styles.seatNote}>
              Your driver may still pick up more passengers on the way. You'll still arrive by {arriveBy ?? 'your requested time'}.
            </Text>
          )}
          {(canEditSeats || canToggleLock) && (
            <View style={styles.seatActionRow}>
              {canEditSeats && (
                <TouchableOpacity
                  accessibilityLabel="Change number of seats"
                  style={styles.seatAction}
                  onPress={() => { setSeatDraft(seats.total); setSeatEditorVisible(true); }}
                >
                  <Ionicons name="create-outline" size={14} color={colors.white} />
                  <Text style={styles.seatActionText}>Seats</Text>
                </TouchableOpacity>
              )}
              {canToggleLock && (
                <TouchableOpacity
                  accessibilityLabel={seats.open ? 'Stop taking passengers' : 'Take more passengers'}
                  style={styles.seatAction}
                  onPress={confirmLockToggle}
                >
                  <Ionicons name={seats.open ? 'lock-closed-outline' : 'lock-open-outline'} size={14} color={colors.white} />
                  <Text style={styles.seatActionText}>{seats.open ? 'Lock' : 'Unlock'}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      )}

      {status === 'confirmed' && (
        <TouchableOpacity
          style={styles.seeMoreLink}
          onPress={() => (onSeeDetails ? onSeeDetails() : setDetailsVisible(true))}
        >
          <Text style={styles.seeMoreLinkText}>See more information</Text>
          <Ionicons name="chevron-forward" size={13} color={colors.white} />
        </TouchableOpacity>
      )}

      <Modal
        visible={seatEditorVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSeatEditorVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setSeatEditorVisible(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalDriverName}>Seats for this drive</Text>
            <Text style={styles.seatEditorHint}>
              {seatsTaken > 0
                ? `${seatsTaken} already taken, so at least ${seatsTaken}.`
                : 'How many passengers you can take.'}
            </Text>
            <NumberStepper
              value={seatDraft}
              onChange={setSeatDraft}
              min={Math.max(1, seatsTaken)}
              max={MAX_SEATS}
              style={styles.seatEditorStepper}
            />
            <View style={styles.modalButtonRow}>
              <TouchableOpacity style={styles.declineButton} onPress={() => setSeatEditorVisible(false)}>
                <Text style={styles.declineText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.acceptButton}
                onPress={() => {
                  setSeatEditorVisible(false);
                  if (seats && seatDraft !== seats.total) onChangeSeats?.(seatDraft);
                }}
              >
                <Text style={styles.acceptText}>Save</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={detailsVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDetailsVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setDetailsVisible(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            {driver.avatarUri ? (
              <Image source={{ uri: driver.avatarUri }} style={styles.modalAvatar} />
            ) : (
              <View style={styles.modalAvatarFallback}>
                <Ionicons name="person" size={28} color={colors.white} />
              </View>
            )}
            <Text style={styles.modalDriverName}>{driver.name}</Text>
            <Text style={styles.modalVehicleText}>{driver.vehicle}</Text>
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

            {status === 'awaiting' && isDriver ? (
              <View style={styles.modalButtonRow}>
                <TouchableOpacity style={styles.declineButton} onPress={() => setDetailsVisible(false)}>
                  <Text style={styles.declineText}>Close</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.declineButton}
                  onPress={() => {
                    setDetailsVisible(false);
                    confirmRemoveOffer();
                  }}
                >
                  <Text style={styles.declineText}>Remove offer</Text>
                </TouchableOpacity>
              </View>
            ) : status === 'awaiting' ? (
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
  readyBy: {
    color: colors.white,
    fontSize: 12,
    opacity: 0.85,
    marginLeft: 22, // under the address, past the stop icon and gap
    marginTop: 2,
  },
  seatSection: {
    marginTop: 12,
  },
  seatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  seatCount: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '600',
  },
  seatLabel: {
    flex: 1,
    color: colors.white,
    fontSize: 12,
    opacity: 0.85,
  },
  seatActionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 10,
  },
  seatAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.whiteA50,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  seatActionText: {
    color: colors.white,
    fontSize: 12,
  },
  // Split green/orange when the car may still take a passenger, solid green
  // once it's full or locked.
  seatBar: {
    flexDirection: 'row',
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 8,
  },
  seatBarPart: {
    height: '100%',
  },
  seatNote: {
    color: colors.white,
    fontSize: 12,
    opacity: 0.85,
    marginTop: 6,
  },
  seatEditorHint: {
    color: colors.white,
    fontSize: 13,
    opacity: 0.8,
    marginTop: 4,
    textAlign: 'center',
  },
  seatEditorStepper: {
    marginTop: 14,
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
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  infoNote: {
    backgroundColor: colors.whiteA14,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 6,
  },
  infoNoteText: {
    color: colors.white,
    fontSize: 11,
    opacity: 0.9,
  },
  statInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statInlineText: {
    color: colors.white,
    fontSize: 12,
    opacity: 0.9,
  },
  statSeparator: {
    color: colors.white,
    opacity: 0.4,
    fontSize: 12,
  },
  divider: {
    height: 1,
    backgroundColor: colors.whiteA28,
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
  seeMoreLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 10,
  },
  seeMoreLinkText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.85,
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
  actionRow: {
    flexDirection: 'row',
    gap: 8,
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
  pendingIconRow: {
    flexDirection: 'row',
    gap: 8,
  },
  pendingIconButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.whiteA16,
  },
  cancelIconButton: {
    backgroundColor: colors.pending,
  },
  seeDetailsButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.whiteA16,
    borderRadius: 14,
    paddingVertical: 9,
  },
  seeDetailsText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '600',
  },
  // Outlined rather than filled: removing an offer is the destructive choice.
  removeOfferButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.whiteA50,
    paddingVertical: 9,
  },
  acceptButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.confirmed,
    borderRadius: 14,
    paddingVertical: 9,
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
