import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../styles';
import { monthNames, weekdayLabels, startOfDay } from '../utility/dates';
import PressableScale from './PressableScale';

interface DatePickerModalProps {
  visible: boolean;
  initialDate?: Date;
  minDate?: Date;
  maxDate?: Date;
  /** Month/year to open the calendar on when no initialDate is set yet. Defaults to today. */
  defaultViewDate?: Date;
  onSelect: (date: Date) => void;
  onClose: () => void;
}

type PickerMode = 'days' | 'years';

const YEAR_ROW_HEIGHT = 44;
const YEAR_LIST_HEIGHT = 260;

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getCalendarDays(month: Date) {
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) =>
    new Date(month.getFullYear(), month.getMonth(), index - mondayOffset + 1),
  );
}

export default function DatePickerModal({
  visible,
  initialDate,
  minDate,
  maxDate,
  defaultViewDate,
  onSelect,
  onClose,
}: DatePickerModalProps) {
  const floor = useMemo(() => startOfDay(minDate ?? new Date()), [minDate]);
  const ceiling = useMemo(() => (maxDate ? startOfDay(maxDate) : undefined), [maxDate]);
  const [viewMonth, setViewMonth] = useState(() => {
    const base = initialDate ?? defaultViewDate ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const [pickerMode, setPickerMode] = useState<PickerMode>('days');
  const yearListRef = useRef<ScrollView>(null);

  // Jumping between fields can reopen this modal without remounting it, so make sure
  // a stale "years" view from a previous open doesn't stick around.
  useEffect(() => {
    if (visible) setPickerMode('days');
  }, [visible]);

  const minYear = floor.getFullYear();
  const maxYear = ceiling ? ceiling.getFullYear() : minYear + 50;
  const years = useMemo(() => {
    const list: number[] = [];
    for (let year = minYear; year <= maxYear; year += 1) list.push(year);
    return list;
  }, [minYear, maxYear]);

  // Scroll the year list to roughly center the currently-viewed year whenever the
  // picker switches into year mode, so picking a birth year doesn't start from year 1.
  useEffect(() => {
    if (!visible || pickerMode !== 'years') return;
    const index = years.indexOf(viewMonth.getFullYear());
    if (index < 0) return;
    const offset = Math.max(0, index * YEAR_ROW_HEIGHT - YEAR_LIST_HEIGHT / 2 + YEAR_ROW_HEIGHT / 2);
    const frame = requestAnimationFrame(() => yearListRef.current?.scrollTo({ y: offset, animated: false }));
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerMode, visible]);

  if (!visible) return null;

  const days = getCalendarDays(viewMonth);
  const changeMonth = (amount: number) =>
    setViewMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  const selectYear = (year: number) => {
    setViewMonth((current) => new Date(year, current.getMonth(), 1));
    setPickerMode('days');
  };

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <Pressable style={localStyles.backdrop} onPress={onClose}>
        <Pressable style={localStyles.sheet} onPress={(event) => event.stopPropagation()}>
          {pickerMode === 'days' ? (
            <View style={localStyles.headerRow}>
              <PressableScale accessibilityLabel="Previous month" hitSlop={8} onPress={() => changeMonth(-1)} style={localStyles.navButton}>
                <Ionicons color={colors.white} name="chevron-back" size={20} />
              </PressableScale>
              <PressableScale
                accessibilityLabel="Choose a year"
                hitSlop={8}
                onPress={() => setPickerMode('years')}
                style={localStyles.monthLabelButton}
              >
                <Text style={localStyles.monthLabel}>{monthNames[viewMonth.getMonth()]} {viewMonth.getFullYear()}</Text>
                <Ionicons color={colors.white} name="chevron-down" size={16} style={{ marginLeft: 4 }} />
              </PressableScale>
              <PressableScale accessibilityLabel="Next month" hitSlop={8} onPress={() => changeMonth(1)} style={localStyles.navButton}>
                <Ionicons color={colors.white} name="chevron-forward" size={20} />
              </PressableScale>
            </View>
          ) : (
            <View style={localStyles.headerRow}>
              <PressableScale accessibilityLabel="Back to calendar" hitSlop={8} onPress={() => setPickerMode('days')} style={localStyles.navButton}>
                <Ionicons color={colors.white} name="chevron-back" size={20} />
              </PressableScale>
              <Text style={localStyles.monthLabel}>Select year</Text>
              <View style={localStyles.navButton} />
            </View>
          )}

          {pickerMode === 'days' ? (
            <>
              <View style={localStyles.weekdayRow}>
                {weekdayLabels.map((label) => <Text key={label} style={localStyles.weekdayText}>{label}</Text>)}
              </View>

              <View style={localStyles.grid}>
                {days.map((date) => {
                  const disabled = startOfDay(date) <= floor || (ceiling !== undefined && startOfDay(date) > ceiling);
                  const isCurrentMonth = date.getMonth() === viewMonth.getMonth();
                  const isSelected = !!initialDate && dateKey(date) === dateKey(initialDate);
                  return (
                    <PressableScale
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
                    </PressableScale>
                  );
                })}
              </View>
            </>
          ) : (
            <ScrollView
              ref={yearListRef}
              showsVerticalScrollIndicator={false}
              style={localStyles.yearScroll}
            >
              {years.map((year) => {
                const isSelected = year === viewMonth.getFullYear();
                return (
                  <PressableScale
                    accessibilityLabel={`Select year ${year}`}
                    key={year}
                    onPress={() => selectYear(year)}
                    style={[localStyles.yearRow, isSelected && localStyles.yearRowSelected]}
                  >
                    <Text style={[localStyles.yearRowText, isSelected && localStyles.yearRowTextSelected]}>{year}</Text>
                  </PressableScale>
                );
              })}
            </ScrollView>
          )}

          <PressableScale onPress={onClose} style={localStyles.closeButton}>
            <Text style={localStyles.closeButtonText}>Cancel</Text>
          </PressableScale>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const localStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.navyA60,
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
    backgroundColor: colors.whiteA16,
  },
  monthLabelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
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
    backgroundColor: colors.skyBlueA68,
  },
  dayText: {
    color: colors.white,
    fontSize: 14,
  },
  dayTextMuted: {
    color: colors.whiteA35,
  },
  dayTextDisabled: {
    color: colors.whiteA20,
  },
  dayTextSelected: {
    fontWeight: '700',
  },
  yearScroll: {
    maxHeight: YEAR_LIST_HEIGHT,
  },
  yearRow: {
    height: YEAR_ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  yearRowSelected: {
    backgroundColor: colors.skyBlueA68,
  },
  yearRowText: {
    color: colors.white,
    fontSize: 16,
  },
  yearRowTextSelected: {
    fontWeight: '700',
  },
  closeButton: {
    marginTop: 14,
    alignItems: 'center',
    paddingVertical: 10,
  },
  closeButtonText: {
    color: colors.whiteA75,
    fontSize: 14,
    fontWeight: '600',
  },
});
