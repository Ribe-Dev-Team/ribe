import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors } from '../styles';
import { isValid24Time, decomposeTime12h, convert12hTo24h, type sepTime12h } from '../utility/times';

interface TimePickerModalProps {
  visible: boolean;
  label: string;
  initialTime?: string; // HH:mm (24-hour)
  onSelect: (time: string) => void; // HH:mm (24-hour)
  onClose: () => void;
}

const ITEM_HEIGHT = 44;
const VISIBLE_ITEMS = 5;
const WHEEL_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS;
const SPACER_HEIGHT = ITEM_HEIGHT * Math.floor(VISIBLE_ITEMS / 2);

const hourValues = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0'));
const minuteValues = Array.from({ length: 12 }, (_, index) => index * 5);
const periodValues = ['AM', 'PM'];

function nearestMinuteIndex(minute: number): number {
  let closestIndex = 0;
  let smallestDiff = Infinity;
  minuteValues.forEach((candidate, index) => {
    const diff = Math.abs(candidate - minute);
    if (diff < smallestDiff) {
      smallestDiff = diff;
      closestIndex = index;
    }
  });
  return closestIndex;
}

function parseInitialTime(time?: string) {
  if (time && isValid24Time(time)) {
    const t12 = decomposeTime12h(time);
    return { hourIndex: t12.hrs - 1, minuteIndex: nearestMinuteIndex(t12.mins), periodIndex: t12.period };
  }
  return { hourIndex: 7, minuteIndex: 0, periodIndex: 0 }; // default 08:00 AM
}

function toTimeString(hourIndex: number, minuteIndex: number, periodIndex: number): string {
  const time12: sepTime12h = {
    hrs: hourIndex + 1, // 1-12
    mins: minuteValues[minuteIndex],
    period: (periodIndex === 0) ? 'AM' : 'PM'
  };
  return convert12hTo24h(time12);
}

interface WheelColumnProps {
  values: (string | number)[];
  selectedIndex: number;
  onChangeIndex: (index: number) => void;
  format?: (value: string | number) => string;
}

function WheelColumn({ values, selectedIndex, onChangeIndex, format }: WheelColumnProps) {
  const scrollRef = useRef<ScrollView>(null);
  const lastReportedIndex = useRef(selectedIndex);

  useEffect(() => {
    lastReportedIndex.current = selectedIndex;
    scrollRef.current?.scrollTo({ y: selectedIndex * ITEM_HEIGHT, animated: false });
    // Only ever want this to run when the modal seeds a new starting index, not on every scroll-driven update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const rawIndex = event.nativeEvent.contentOffset.y / ITEM_HEIGHT;
    const clampedIndex = Math.max(0, Math.min(values.length - 1, Math.round(rawIndex)));
    if (clampedIndex !== lastReportedIndex.current) {
      lastReportedIndex.current = clampedIndex;
      onChangeIndex(clampedIndex);
    }
  };

  return (
    <ScrollView
      decelerationRate="fast"
      onScroll={handleScroll}
      ref={scrollRef}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
      snapToInterval={ITEM_HEIGHT}
      style={localStyles.column}
    >
      <View style={{ height: SPACER_HEIGHT }} />
      {values.map((value, index) => (
        <View key={String(value)} style={localStyles.cell}>
          <Text style={[localStyles.cellText, index === selectedIndex && localStyles.cellTextActive]}>
            {format ? format(value) : value}
          </Text>
        </View>
      ))}
      <View style={{ height: SPACER_HEIGHT }} />
    </ScrollView>
  );
}

export default function TimePickerModal({ visible, label, initialTime, onSelect, onClose }: TimePickerModalProps) {
  const [hourIndex, setHourIndex] = useState(7);
  const [minuteIndex, setMinuteIndex] = useState(0);
  const [periodIndex, setPeriodIndex] = useState(0);
  const [seed, setSeed] = useState(0);

  useEffect(() => {
    if (!visible) return;
    const parsed = parseInitialTime(initialTime);
    setHourIndex(parsed.hourIndex);
    setMinuteIndex(parsed.minuteIndex);
    setPeriodIndex(parsed.periodIndex);
    setSeed((current) => current + 1); // forces the wheels to remount and re-center on the restored value
  }, [visible, initialTime]);

  if (!visible) return null;

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <View style={localStyles.backdrop}>
        {/*
          Dismiss target is a Pressable that only fills the space behind the sheet, as a
          sibling rather than an ancestor of it. A Pressable *wrapping* the sheet claims the
          touch responder on press-down and won't release it to the ScrollView wheels below,
          which silently breaks their drag-to-scroll gesture.
        */}
        <Pressable onPress={onClose} style={StyleSheet.absoluteFillObject} />

        <View style={localStyles.sheet}>
          <Text style={localStyles.title}>{label}</Text>

          <View style={localStyles.wheelContainer}>
            <View pointerEvents="none" style={localStyles.selectionBand} />
            <View key={seed} style={localStyles.columnsRow}>
              <WheelColumn onChangeIndex={setHourIndex} selectedIndex={hourIndex} values={hourValues} />
              <Text style={localStyles.colon}>:</Text>
              <WheelColumn
                format={(value) => String(value).padStart(2, '0')}
                onChangeIndex={setMinuteIndex}
                selectedIndex={minuteIndex}
                values={minuteValues}
              />
              <WheelColumn onChangeIndex={setPeriodIndex} selectedIndex={periodIndex} values={periodValues} />
            </View>
          </View>

          <View style={localStyles.actionsRow}>
            <Pressable onPress={onClose} style={localStyles.cancelButton}>
              <Text style={localStyles.cancelButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => onSelect(toTimeString(hourIndex, minuteIndex, periodIndex))}
              style={localStyles.confirmButton}
            >
              <Text style={localStyles.confirmButtonText}>Set time</Text>
            </Pressable>
          </View>
        </View>
      </View>
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
    marginBottom: 12,
  },
  wheelContainer: {
    height: WHEEL_HEIGHT,
    justifyContent: 'center',
  },
  selectionBand: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: SPACER_HEIGHT,
    height: ITEM_HEIGHT,
    borderRadius: 12,
    backgroundColor: 'rgba(145, 211, 249, 0.22)',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  columnsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: WHEEL_HEIGHT,
  },
  column: {
    width: 70,
    height: WHEEL_HEIGHT,
  },
  colon: {
    color: colors.white,
    fontSize: 20,
    fontWeight: '700',
  },
  cell: {
    height: ITEM_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellText: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 17,
  },
  cellTextActive: {
    color: colors.white,
    fontSize: 20,
    fontWeight: '700',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
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
