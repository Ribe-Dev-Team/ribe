import React from 'react';
import { Pressable, Text, View } from 'react-native';
import styles from '../styles';
import { isToday } from '../utility/dates';
import { CalendarDayCellProps } from './Calendar.schema';

export default function CalendarDayCell({ date, month, isSelected, rideColors, onPress }: CalendarDayCellProps) {
  const isCurrentMonth = date.getMonth() === month.getMonth();
  const isDateToday = isToday(date);
  const monthName = date.toLocaleString('en-AU', { month: 'long' });

  return (
    <Pressable
      accessibilityLabel={`Select ${monthName} ${date.getDate()}`}
      onPress={onPress}
      style={[styles.dayCell, isDateToday && !isSelected ? styles.todayDay : null, isSelected ? styles.selectedDay : null]}
    >
      <Text style={[styles.dayText, !isCurrentMonth ? styles.outsideMonthText : null]}>{date.getDate()}</Text>
      <View style={styles.dotRow}>
        {rideColors.map((color, index) => <View key={`${color}-${index}`} style={[styles.dayDot, { backgroundColor: color }]} />)}
      </View>
    </Pressable>
  );
}
