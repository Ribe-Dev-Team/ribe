import React from 'react';
import { Text, View } from 'react-native';
import styles from '../styles';
import CalendarDayCell from './CalendarDayCell';

interface CalendarGridProps {
  month: Date;
  days: Date[];
  weekdays: string[];
  selectedDate: Date;
  getDateKey: (date: Date) => string;
  getRideColors: (date: Date) => string[];
  onSelectDate: (date: Date) => void;
}

export default function CalendarGrid({
  month,
  days,
  weekdays,
  selectedDate,
  getDateKey,
  getRideColors,
  onSelectDate,
}: CalendarGridProps) {
  return (
    <View style={styles.calendarCard}>
      <View style={styles.weekdayRow}>
        {weekdays.map((weekday) => <Text key={weekday} style={styles.weekday}>{weekday}</Text>)}
      </View>
      <View style={styles.daysGrid}>
        {days.map((date) => (
          <CalendarDayCell
            date={date}
            isSelected={getDateKey(date) === getDateKey(selectedDate)}
            key={getDateKey(date)}
            month={month}
            onPress={() => onSelectDate(date)}
            rideColors={getRideColors(date)}
          />
        ))}
      </View>
    </View>
  );
}
