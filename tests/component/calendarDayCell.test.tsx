// Component tests for mobile/components/CalendarDayCell.tsx: past days are
// greyed out as in the booking date picker, but can still be tapped to see
// the rides on them.

import * as React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import CalendarDayCell from '../../mobile/components/CalendarDayCell';
import styles from '../../mobile/styles';

const daysFromToday = (days: number) => {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date;
};

const show = async (date: Date, onPress = () => {}) => {
  await render(<CalendarDayCell date={date} month={date} isSelected={false} rideColors={[]} onPress={onPress} />);
  return StyleSheet.flatten(screen.getByText(String(date.getDate())).props.style);
};

it('greys out a past day', async () => {
  expect((await show(daysFromToday(-1))).color).toBe(styles.pastDayText.color);
});

it('leaves today and later days white', async () => {
  expect((await show(daysFromToday(0))).color).toBe(styles.dayText.color);
  expect((await show(daysFromToday(1))).color).toBe(styles.dayText.color);
});

it('still lets a past day be selected', async () => {
  const onPress = jest.fn();
  const date = daysFromToday(-3);
  await show(date, onPress);
  await fireEvent.press(screen.getByLabelText(`Select ${date.toLocaleString('en-AU', { month: 'long' })} ${date.getDate()}`));
  expect(onPress).toHaveBeenCalled();
});
