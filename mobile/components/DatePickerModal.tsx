import React, { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../styles';

interface DatePickerModalProps {
  visible: boolean;
  initialDate?: Date;
  minDate?: Date;
  onSelect: (date: Date) => void;
  onClose: () => void;
}

const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const weekdayLabels = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function getCalendarDays(month: Date) {
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) =>
    new Date(month.getFullYear(), month.getMonth(), index - mondayOffset + 1),
  );
}

export default function DatePickerModal({ visible, initialDate, minDate, onSelect, onClose }: DatePickerModalProps) {
  const floor = useMemo(() => startOfDay(minDate ?? new Date()), [minDate]);
  const [viewMonth, setViewMonth] = useState(() => {
    const base = initialDate ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  if (!visible) return null;

  const days = getCalendarDays(viewMonth);
  const changeMonth = (amount: number) =>
    setViewMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <Pressable style={localStyles.backdrop} onPress={onClose}>
        <Pressable style={localStyles.sheet} onPress={(event) => event.stopPropagation()}>
          <View style={localStyles.headerRow}>
            <Pressable accessibilityLabel="Previous month" hitSlop={8} onPress={() => changeMonth(-1)} style={localStyles.navButton}>
              <Ionicons color={colors.white} name="chevron-back" size={20} />
            </Pressable>
            <Text style={localStyles.monthLabel}>{monthNames[viewMonth.getMonth()]} {viewMonth.getFullYear()}</Text>
            <Pressable accessibilityLabel="Next month" hitSlop={8} onPress={() => changeMonth(1)} style={localStyles.navButton}>
              <Ionicons color={colors.white} name="chevron-forward" size={20} />
            </Pressable>
          </View>

          <View style={localStyles.weekdayRow}>
            {weekdayLabels.map((label) => <Text key={label} style={localStyles.weekdayText}>{label}</Text>)}
          </View>

          <View style={localStyles.grid}>
            {days.map((date) => {
              const disabled = startOfDay(date) <= floor;
              const isCurrentMonth = date.getMonth() === viewMonth.getMonth();
              const isSelected = !!initialDate && dateKey(date) === dateKey(initialDate);
              return (
                <Pressable
                  accessibilityLabel={`Select ${monthNames[date.getMonth()]} ${date.getDate()}`}
                  disabled={disabled}
                  key={dateKey(date)}
                  onPress={() => onSelect(date)}
                  style={[localStyles.dayCell, isSelected && localStyles.dayCellSelected]}
                >
                  <Text
                    style={[
                      localStyles.dayText,
                      !isCurrentMonth && localStyles.dayTextMuted,
                      disabled && localStyles.dayTextDisabled,
                      isSelected && localStyles.dayTextSelected,
                    ]}
                  >
                    {date.getDate()}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable onPress={onClose} style={localStyles.closeButton}>
            <Text style={localStyles.closeButtonText}>Cancel</Text>
          </Pressable>
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
    maxWidth: 360,
    borderRadius: 24,
    padding: 18,
    backgroundColor: colors.mediumBlue,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  navButton: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  monthLabel: {
    fontFamily: 'Marcellus_400Regular',
    fontSize: 18,
    color: colors.white,
  },
  weekdayRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  weekdayText: {
    flex: 1,
    textAlign: 'center',
    color: colors.white,
    opacity: 0.65,
    fontSize: 12,
    fontWeight: '600',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: '14.2857%',
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  dayCellSelected: {
    backgroundColor: 'rgba(145, 211, 249, 0.68)',
  },
  dayText: {
    color: colors.white,
    fontSize: 14,
  },
  dayTextMuted: {
    color: 'rgba(255,255,255,0.35)',
  },
  dayTextDisabled: {
    color: 'rgba(255,255,255,0.2)',
  },
  dayTextSelected: {
    fontWeight: '700',
  },
  closeButton: {
    marginTop: 14,
    alignItems: 'center',
    paddingVertical: 10,
  },
  closeButtonText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 14,
    fontWeight: '600',
  },
});
