import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../styles';
import { useThemedAlert } from './ThemedDialog';
import NumberStepper from './NumberStepper';
import { MAX_CAR_SEATS } from '../pages/schema/user.validation';
import { RideCardProps } from './RideCard';

type Seats = NonNullable<RideCardProps['seats']>;

interface DriveControlsProps {
  seats: Seats;
  /** A rider deciding on a match to this drive - they hold a seat too. */
  riderDeciding?: boolean;
  /** Change how many passengers the drive takes. */
  onChangeSeats?: (seats: number) => void;
}

/** Lock/unlock once someone's aboard - a full car that isn't locked has
 *  nothing to lock. */
export function canToggleLock(seats: Seats) {
  return seats.filled > 0 && (seats.open || seats.locked);
}

/**
 * A driver's stop/resume taking passengers button, for the details page's
 * footer. Says what it does, not just "Lock", and confirms first.
 */
export function LockToggleButton({ seats, onSetLocked, compact = false }: {
  seats: Seats;
  onSetLocked: (locked: boolean) => void;
  /** Smaller, for under Accept/Decline. */
  compact?: boolean;
}) {
  const showAlert = useThemedAlert();
  if (!canToggleLock(seats)) return null;

  const confirmLockToggle = () => {
    if (seats.open) {
      showAlert(
        'Stop taking passengers?',
        `You keep the ${seats.filled} rider${seats.filled === 1 ? '' : 's'} already confirmed. No new riders will be matched to this drive.`,
        [
          { text: 'Keep Looking', style: 'cancel' },
          { text: 'Lock Drive', onPress: () => onSetLocked(true) },
        ],
      );
    } else {
      showAlert(
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
    <TouchableOpacity
      accessibilityLabel={seats.open ? 'Stop taking passengers' : 'Take more passengers'}
      style={[localStyles.footerButton, compact && localStyles.footerButtonCompact]}
      onPress={confirmLockToggle}
    >
      <Ionicons name={seats.open ? 'lock-closed-outline' : 'lock-open-outline'} size={16} color={colors.white} />
      <Text style={[localStyles.footerButtonText, compact && localStyles.footerButtonTextCompact]}>{seats.open ? 'Stop New Riders' : 'Take More Riders'}</Text>
    </TouchableOpacity>
  );
}

/**
 * A driver's seats on their drive's details page: one line under the
 * passengers saying how full the car is, with a pill to change how many seats
 * it offers - until the drive is locked, since a locked car takes nobody new
 * and its seat count would change nothing.
 */
export default function DriveControls({ seats, riderDeciding = false, onChangeSeats }: DriveControlsProps) {
  const [editorVisible, setEditorVisible] = useState(false);
  const [draft, setDraft] = useState(seats.total);
  // Seats can't drop below the riders aboard, or the one deciding.
  const taken = seats.filled + (riderDeciding ? 1 : 0);

  const canEditSeats = Boolean(onChangeSeats) && !seats.locked;
  const state = seats.locked ? 'Locked' : seats.open ? 'Taking riders' : 'Car full';
  const summary = `${seats.filled}/${seats.total} seats  ·  ${state}${riderDeciding ? '  ·  1 deciding' : ''}`;

  return (
    <View style={localStyles.line}>
      <Ionicons name={seats.locked ? 'lock-closed-outline' : 'people-outline'} size={18} color={colors.white} />
      <Text style={localStyles.summary}>{summary}</Text>
      {canEditSeats && (
        <TouchableOpacity
          accessibilityLabel="Change number of seats"
          style={localStyles.pill}
          onPress={() => { setDraft(seats.total); setEditorVisible(true); }}
        >
          <Ionicons name="create-outline" size={13} color={colors.white} />
          <Text style={localStyles.pillText}>Edit Seats</Text>
        </TouchableOpacity>
      )}

      <Modal visible={editorVisible} transparent animationType="fade" onRequestClose={() => setEditorVisible(false)}>
        <Pressable style={localStyles.backdrop} onPress={() => setEditorVisible(false)}>
          <Pressable style={localStyles.modalCard} onPress={() => {}}>
            <Text style={localStyles.modalTitle}>Seats for This Drive</Text>
            <Text style={localStyles.modalHint}>
              {taken > 0 ? `${taken} already taken, so at least ${taken}.` : 'How many passengers you can take.'}
            </Text>
            <NumberStepper value={draft} onChange={setDraft} min={Math.max(1, taken)} max={MAX_CAR_SEATS} style={localStyles.stepper} />
            <View style={localStyles.modalButtons}>
              <TouchableOpacity style={localStyles.cancelButton} onPress={() => setEditorVisible(false)}>
                <Text style={localStyles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={localStyles.saveButton}
                onPress={() => {
                  setEditorVisible(false);
                  if (draft !== seats.total) onChangeSeats?.(draft);
                }}
              >
                <Text style={localStyles.buttonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const localStyles = StyleSheet.create({
  // Matches the car line beneath it on the details page.
  line: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.whiteA16,
  },
  summary: {
    flex: 1,
    minWidth: 120,
    color: colors.white,
    fontFamily: 'Marcellus_400Regular',
    fontSize: 14,
  },
  // Matches the Call/Text buttons beside a passenger.
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.whiteA16,
  },
  footerButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 13,
    backgroundColor: colors.whiteA16,
  },
  footerButtonCompact: {
    paddingVertical: 9,
  },
  footerButtonText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '600',
  },
  footerButtonTextCompact: {
    fontSize: 13,
  },
  pillText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '600',
  },
  buttonText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '600',
  },
  backdrop: {
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
  modalTitle: {
    color: colors.white,
    fontSize: 17,
    fontWeight: '600',
  },
  modalHint: {
    color: colors.white,
    fontSize: 13,
    opacity: 0.8,
    marginTop: 4,
    textAlign: 'center',
  },
  stepper: {
    marginTop: 14,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
    width: '100%',
  },
  cancelButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.whiteA50,
  },
  saveButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: colors.confirmed,
  },
});
