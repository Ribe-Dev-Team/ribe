import React from 'react';
import { Pressable, Text, View } from 'react-native';
import styles from '../styles';

interface CalendarDayCellProps {
  date: Date;
  month: Date;
  isSelected: boolean;
  rideColors: string[];
  onPress: () => void;
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function CalendarDayCell({ date, month, isSelected, rideColors, onPress }: CalendarDayCellProps) {
  const isCurrentMonth = date.getMonth() === month.getMonth();
  const isToday = isSameDay(date, new Date());
  const monthName = date.toLocaleString('en-AU', { month: 'long' });

  return (
    <Pressable
      accessibilityLabel={`Select ${monthName} ${date.getDate()}`}
      onPress={onPress}
      style={[styles.dayCell, isToday && !isSelected ? styles.todayDay : null, isSelected ? styles.selectedDay : null]}
    >
      <Text style={[styles.dayText, !isCurrentMonth ? styles.outsideMonthText : null]}>{date.getDate()}</Text>
      <View style={styles.dotRow}>
        {rideColors.map((color, index) => <View key={`${color}-${index}`} style={[styles.dayDot, { backgroundColor: color }]} />)}
      </View>
    </Pressable>
  );
}
