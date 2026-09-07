import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '../styles';

interface TimePickerModalProps {
  visible: boolean;
  label: string;
  initialTime?: string; // HH:mm
  onSelect: (time: string) => void;
  onClose: () => void;
}

const hours = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'));
const minutes = Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, '0'));
const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

function nearestMinute(value: string): string {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return '00';
  let closest = minutes[0];
  let smallestDiff = Infinity;
  for (const candidate of minutes) {
    const diff = Math.abs(Number(candidate) - numeric);
    if (diff < smallestDiff) {
      smallestDiff = diff;
      closest = candidate;
    }
  }
  return closest;
}

export default function TimePickerModal({ visible, label, initialTime, onSelect, onClose }: TimePickerModalProps) {
  const [selectedHour, setSelectedHour] = useState('08');
  const [selectedMinute, setSelectedMinute] = useState('00');

  useEffect(() => {
    if (!visible) return;
    if (initialTime && timePattern.test(initialTime)) {
      const [h, m] = initialTime.split(':');
      setSelectedHour(h);
      setSelectedMinute(nearestMinute(m));
    } else {
      setSelectedHour('08');
      setSelectedMinute('00');
    }
  }, [visible, initialTime]);

  if (!visible) return null;

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <Pressable style={localStyles.backdrop} onPress={onClose}>
        <Pressable style={localStyles.sheet} onPress={(event) => event.stopPropagation()}>
          <Text style={localStyles.title}>{label}</Text>
          <Text style={localStyles.preview}>{selectedHour}:{selectedMinute}</Text>

          <View style={localStyles.columnsRow}>
            <ScrollView showsVerticalScrollIndicator={false} style={localStyles.column}>
              {hours.map((hour) => (
                <Pressable
                  key={hour}
                  onPress={() => setSelectedHour(hour)}
                  style={[localStyles.cell, hour === selectedHour && localStyles.cellActive]}
                >
                  <Text style={[localStyles.cellText, hour === selectedHour && localStyles.cellTextActive]}>{hour}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <Text style={localStyles.colon}>:</Text>

            <ScrollView showsVerticalScrollIndicator={false} style={localStyles.column}>
              {minutes.map((minute) => (
                <Pressable
                  key={minute}
                  onPress={() => setSelectedMinute(minute)}
                  style={[localStyles.cell, minute === selectedMinute && localStyles.cellActive]}
                >
                  <Text style={[localStyles.cellText, minute === selectedMinute && localStyles.cellTextActive]}>{minute}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          <View style={localStyles.actionsRow}>
            <Pressable onPress={onClose} style={localStyles.cancelButton}>
              <Text style={localStyles.cancelButtonText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={() => onSelect(`${selectedHour}:${selectedMinute}`)} style={localStyles.confirmButton}>
              <Text style={localStyles.confirmButtonText}>Set time</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const localStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(6,32,54,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  sheet: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 24,
    padding: 18,
    backgroundColor: colors.mediumBlue,
  },
  title: {
    fontFamily: 'Marcellus_400Regular',
    fontSize: 16,
    color: colors.white,
    textAlign: 'center',
    marginBottom: 4,
  },
  preview: {
    fontFamily: 'Marcellus_400Regular',
    fontSize: 30,
    color: colors.white,
    textAlign: 'center',
    marginBottom: 12,
  },
  columnsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 200,
  },
  column: {
    width: 72,
  },
  colon: {
    color: colors.white,
    fontSize: 22,
    fontWeight: '700',
    marginHorizontal: 6,
  },
  cell: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    marginVertical: 2,
  },
  cellActive: {
    backgroundColor: 'rgba(145, 211, 249, 0.68)',
  },
  cellText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 16,
  },
  cellTextActive: {
    color: colors.white,
    fontWeight: '700',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  cancelButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  cancelButtonText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
  confirmButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: colors.darkBlue,
  },
  confirmButtonText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
});
