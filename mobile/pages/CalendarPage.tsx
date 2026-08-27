import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import styles, { colors } from '../styles';

export type RideStatus = 'pending' | 'awaiting' | 'confirmed';

export interface Ride {
  status: RideStatus;
  time: string;
  duration?: string;
  start: string;
  destination: string;
  driver: string;
  vehicle: string;
}

const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const rides: Record<string, Ride[]> = {
  '2026-08-16': [
    { status: 'confirmed', time: '10:30 AM', duration: '45 min', start: '12 Gambler Crescent', destination: 'Monash University Clayton', driver: 'Marcus Vance', vehicle: 'Honda Civic · Silver' },
    { status: 'awaiting', time: '1:15 PM', start: 'Clayton Station Bus Interchange', destination: '45 Wellington Road', driver: 'Pending Driver', vehicle: 'Matching system in progress...' },
    { status: 'pending', time: '3:00 PM - 4:30 PM', duration: 'Flexible window', start: 'Monash University Clayton', destination: '12 Gambler Crescent', driver: 'Unassigned', vehicle: 'Time window awaiting driver claim' },
  ],
  '2026-08-05': [{ status: 'confirmed', time: '10:30 AM', duration: '45 min', start: '12 Gambler Crescent', destination: 'Monash University Clayton', driver: 'Marcus Vance', vehicle: 'Honda Civic · Silver' }],
  '2026-08-12': [{ status: 'awaiting', time: '1:15 PM', start: 'Clayton Station Bus Interchange', destination: '45 Wellington Road', driver: 'Pending Driver', vehicle: 'Matching system in progress...' }],
  '2026-08-19': [{ status: 'pending', time: '3:00 PM - 4:30 PM', duration: 'Flexible window', start: 'Monash University Clayton', destination: '12 Gambler Crescent', driver: 'Unassigned', vehicle: 'Time window awaiting driver claim' }],
};

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

const statusDetails: Record<RideStatus, { label: string; color: string }> = {
  pending: { label: 'Pending Ride', color: colors.pending },
  awaiting: { label: 'Awaiting Confirmation', color: colors.awaiting },
  confirmed: { label: 'Confirmed Ride', color: colors.confirmed },
};

interface CalendarPageProps {
  onOpenRide: (ride: Ride, date: Date) => void;
}

export default function CalendarPage({ onOpenRide }: CalendarPageProps) {
  const [month, setMonth] = useState(new Date(2026, 7, 1));
  const [selectedDate, setSelectedDate] = useState(new Date(2026, 7, 16));
  const calendarDays = useMemo(() => getCalendarDays(month), [month]);
  const selectedRides = rides[dateKey(selectedDate)] ?? [];

  const changeMonth = (amount: number) => {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  };

  return (
    <ScrollView contentContainerStyle={styles.calendarScreen} showsVerticalScrollIndicator={false}>
      <View style={styles.calendarHeader}>
        <Text style={styles.calendarTitle}>Calendar</Text>
      </View>

      <View style={styles.monthControls}>
        <Pressable accessibilityLabel="Previous month" onPress={() => changeMonth(-1)} style={styles.monthButton}>
          <Text style={styles.monthButtonText}>‹</Text>
        </Pressable>
        <Text style={styles.monthTitle}>{monthNames[month.getMonth()]} {month.getFullYear()}</Text>
        <Pressable accessibilityLabel="Next month" onPress={() => changeMonth(1)} style={styles.monthButton}>
          <Text style={styles.monthButtonText}>›</Text>
        </Pressable>
      </View>

      <View style={styles.calendarCard}>
        <View style={styles.weekdayRow}>
          {weekdays.map((weekday) => <Text key={weekday} style={styles.weekday}>{weekday}</Text>)}
        </View>
        <View style={styles.daysGrid}>
          {calendarDays.map((date) => {
            const isCurrentMonth = date.getMonth() === month.getMonth();
            const isSelected = dateKey(date) === dateKey(selectedDate);
            const dayRides = rides[dateKey(date)] ?? [];
            return (
              <Pressable
                accessibilityLabel={`Select ${monthNames[date.getMonth()]} ${date.getDate()}`}
                key={dateKey(date)}
                onPress={() => { setSelectedDate(date); if (!isCurrentMonth) setMonth(new Date(date.getFullYear(), date.getMonth(), 1)); }}
                style={[styles.dayCell, isSelected ? styles.selectedDay : null]}
              >
                <Text style={[styles.dayText, !isCurrentMonth ? styles.outsideMonthText : null]}>{date.getDate()}</Text>
                <View style={styles.dotRow}>
                  {dayRides.map((ride) => <View key={ride.status} style={[styles.dayDot, { backgroundColor: statusDetails[ride.status].color }]} />)}
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Text style={styles.ridesHeading}>Rides on {monthNames[selectedDate.getMonth()]} {selectedDate.getDate()}</Text>
      {selectedRides.length ? selectedRides.map((ride) => {
        const detail = statusDetails[ride.status];
        return (
          <Pressable accessibilityRole="button" accessibilityLabel={`Open details for ${ride.driver} ride`} key={ride.status} onPress={() => onOpenRide(ride, selectedDate)} style={[styles.rideCard, { borderLeftColor: detail.color }]}>
            <View style={styles.rideTopRow}>
              <Text style={styles.rideStatus}><Text style={{ color: detail.color }}>●</Text> {detail.label}</Text>
              <Text style={styles.rideTime}>{ride.time}{ride.duration ? ` (${ride.duration})` : ''}</Text>
            </View>
            <Text style={styles.rideDetail}>•  {ride.start}</Text>
            <Text style={styles.rideDetail}>▰  {ride.destination}</Text>
            <View style={styles.rideDivider} />
            <Text style={styles.driverName}>●  {ride.driver}</Text>
            <Text style={styles.vehicleText}>     {ride.vehicle}</Text>
          </Pressable>
        );
      }) : <Text style={styles.emptyRides}>No rides scheduled for this day.</Text>}

      <Pressable onPress={() => Alert.alert('New Ride', 'The new ride form will be available here.')} style={styles.newRideButton}>
        <Text style={styles.newRidePlus}>＋</Text>
        <Text style={styles.newRideText}>New Ride</Text>
      </Pressable>
    </ScrollView>
  );
}
