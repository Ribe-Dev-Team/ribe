import React, { useEffect, useState } from 'react';
import { Alert, Image, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../styles';

const APPROVAL_WINDOW_MS = 12 * 60 * 60 * 1000;

function formatCountdown(remainingMs: number) {
  if (remainingMs <= 0) return 'Expired';
  const totalMinutes = Math.floor(remainingMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function useApprovalCountdown(matchedAt?: Date) {
  const deadline = matchedAt ? matchedAt.getTime() + APPROVAL_WINDOW_MS : null;
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
  status: RideStatus;
  date: Date;
  pickup: { address: string; time: string };
  destination: { address: string; eta: string };
  etaMinutes: number;
  cost: string;
  co2SavedKg: number;
  driver: { name: string; vehicle: string; avatarUri?: string };
  plate: string;
  /** When a driver match was found - only used for 'awaiting' cards to show a 12h approval countdown */
  matchedAt?: Date;
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
  matchedAt,
  driverPhone,
  pickupDateTime,
  onAccept,
  onDecline,
  onEdit,
  onCancel,
}: RideCardProps) {
  const accent = statusAccent[status];
  const remainingMs = useApprovalCountdown(status === 'awaiting' ? matchedAt : undefined);
  const msUntilPickup = useTimeUntil(status === 'confirmed' ? pickupDateTime : undefined);
  const phoneRevealed = msUntilPickup <= PHONE_REVEAL_WINDOW_MS;
  const [showCostInfo, setShowCostInfo] = useState(false);
  const [showPhoneInfo, setShowPhoneInfo] = useState(false);
  const [detailsVisible, setDetailsVisible] = useState(false);

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

      {status === 'awaiting' && matchedAt && (
        <View style={styles.countdownBanner}>
          <Ionicons name="time-outline" size={14} color={colors.darkBlue} />
          <Text style={styles.countdownText}>
            {remainingMs > 0
              ? `You have ${formatCountdown(remainingMs)} to review and accept before this trip is canceled.`
              : 'This match has expired.'}
          </Text>
        </View>
      )}

      <View style={styles.statsRow}>
        <View style={styles.statChip}>
          <Ionicons name="cash-outline" size={14} color={colors.white} />
          <Text style={styles.statText}>{cost}</Text>
          <TouchableOpacity
            accessibilityLabel="What does this fee cover?"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={() => setShowCostInfo((v) => !v)}
          >
            <Ionicons name="information-circle-outline" size={14} color={colors.white} />
          </TouchableOpacity>
        </View>
        <View style={styles.statChip}>
          <Ionicons name="leaf-outline" size={14} color={colors.confirmedLight} />
          <Text style={styles.statText}>{co2SavedKg}kg CO2 saved</Text>
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
          <TouchableOpacity style={styles.seeDetailsButton} onPress={() => setDetailsVisible(true)}>
            <Ionicons name="eye-outline" size={16} color={colors.white} />
            <Text style={styles.seeDetailsText}>See Details</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.acceptButton} onPress={onAccept}>
            <Ionicons name="checkmark" size={16} color={colors.white} />
            <Text style={styles.acceptText}>Accept</Text>
          </TouchableOpacity>
        </View>
      ) : status === 'pending' ? (
        <View style={styles.footerRow}>
          <View style={styles.searchingRow}>
            <Ionicons name="search" size={14} color={colors.white} />
            <Text style={styles.searchingText}>Searching for driver...</Text>
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
              accessibilityLabel="Cancel ride request"
              style={[styles.pendingIconButton, styles.cancelIconButton]}
              onPress={() =>
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
      ) : (
        <View style={styles.footerRow}>
          <TouchableOpacity
            style={styles.driverRow}
            accessibilityLabel="View driver profile"
            onPress={() => setDetailsVisible(true)}
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

            {status === 'awaiting' ? (
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
  stopConnector: {
    width: 1,
    height: 12,
    backgroundColor: 'rgba(255,255,255,0.35)',
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
    gap: 8,
    marginTop: 10,
  },
  infoNote: {
    backgroundColor: 'rgba(255,255,255,0.14)',
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
    borderColor: 'rgba(255,255,255,0.5)',
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
    backgroundColor: 'rgba(255,255,255,0.16)',
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
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 14,
    paddingVertical: 9,
  },
  seeDetailsText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '600',
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
    backgroundColor: 'rgba(0,0,0,0.5)',
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
    backgroundColor: 'rgba(255,255,255,0.2)',
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
    borderColor: 'rgba(255,255,255,0.5)',
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
