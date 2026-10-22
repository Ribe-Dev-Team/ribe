import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../styles';
import { useThemedAlert } from './ThemedDialog';
import NumberStepper from './NumberStepper';
import { MAX_CAR_SEATS } from '../pages/schema/user.validation';
import { RideCardProps } from './RideCard';

interface DriveControlsProps {
  seats: NonNullable<RideCardProps['seats']>;
  /** A rider deciding on a match to this drive - they hold a seat too. */
  riderDeciding?: boolean;
  /** Stop (true) or resume (false) taking passengers. */
  onSetLocked?: (locked: boolean) => void;
  /** Change how many passengers the drive takes. */
  onChangeSeats?: (seats: number) => void;
}

/**
 * A driver's own controls for a drive, on its details page: how many seats it
 * offers, and whether it's still taking passengers. Seats until the drive is
 * locked (a locked car takes nobody new, so its seat count would change
 * nothing); lock/unlock once someone's aboard (a full car that isn't locked
 * has nothing to lock).
 */
export default function DriveControls({ seats, riderDeciding = false, onSetLocked, onChangeSeats }: DriveControlsProps) {
  const showAlert = useThemedAlert();
  const [editorVisible, setEditorVisible] = useState(false);
  const [draft, setDraft] = useState(seats.total);
  // Seats can't drop below the riders aboard, or the one deciding.
  const taken = seats.filled + (riderDeciding ? 1 : 0);

  const canEditSeats = Boolean(onChangeSeats) && !seats.locked;
  const canToggleLock = Boolean(onSetLocked) && seats.filled > 0 && (seats.open || seats.locked);
  if (!canEditSeats && !canToggleLock) return null;

  const confirmLockToggle = () => {
    if (!onSetLocked) return;
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
    <View style={localStyles.row}>
      {canEditSeats && (
        <TouchableOpacity
          accessibilityLabel="Change number of seats"
          style={localStyles.button}
          onPress={() => { setDraft(seats.total); setEditorVisible(true); }}
        >
          <Ionicons name="create-outline" size={15} color={colors.white} />
          <Text style={localStyles.buttonText}>Seats ({seats.total})</Text>
        </TouchableOpacity>
      )}
      {/* Says what it does, not just "Lock". */}
      {canToggleLock && (
        <TouchableOpacity
          accessibilityLabel={seats.open ? 'Stop taking passengers' : 'Take more passengers'}
          style={localStyles.button}
          onPress={confirmLockToggle}
        >
          <Ionicons name={seats.open ? 'lock-closed-outline' : 'lock-open-outline'} size={15} color={colors.white} />
          <Text style={localStyles.buttonText}>{seats.open ? 'Lock · No More Passengers' : 'Unlock · Take More'}</Text>
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
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.whiteA50,
    paddingHorizontal: 12,
    paddingVertical: 8,
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
