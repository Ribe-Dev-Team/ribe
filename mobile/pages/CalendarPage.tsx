import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import styles, { colors } from '../styles';
import CalendarGrid from '../components/CalendarGrid';
import PageHeader from '../components/PageHeader';
import CarouselControls from '../components/CarouselControls';
import NewRideButton from '../components/NewRideButton';
import CalendarRideRow from '../components/CalendarRideRow';

export type RideStatus = 'pending' | 'awaiting' | 'confirmed';

//TODO: link to real data
//TODO: make the +New Ride button hover over the whole page
//TODO: make the +New Ride button go to form
//TODO: update calendar dot colours
//TODO: have it auto open on TODAY
//TODO: make past days greyed out.

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
      <PageHeader />

      <CarouselControls
        itemLabel={`${monthNames[month.getMonth()]} ${month.getFullYear()}`}
        onNext={() => changeMonth(1)}
        onPrevious={() => changeMonth(-1)}
      />

      <CalendarGrid
        days={calendarDays}
        getDateKey={dateKey}
        getRideColors={(date) => (rides[dateKey(date)] ?? []).map((ride) => statusDetails[ride.status].color)}
        month={month}
        onSelectDate={(date) => {
          setSelectedDate(date);
          if (date.getMonth() !== month.getMonth()) setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
        }}
        selectedDate={selectedDate}
        weekdays={weekdays}
      />

      <Text style={styles.ridesHeading}>Rides on {monthNames[selectedDate.getMonth()]} {selectedDate.getDate()}</Text>
      {selectedRides.length ? selectedRides.map((ride) => {
        const detail = statusDetails[ride.status];
        return <CalendarRideRow key={ride.status} onPress={() => onOpenRide(ride, selectedDate)} ride={ride} statusColor={detail.color} statusLabel={detail.label} />;
      }) : <Text style={styles.emptyRides}>No rides scheduled for this day.</Text>}

      <NewRideButton onPress={() => Alert.alert('New Ride', 'The new ride form will be available here.')} />
    </ScrollView>
  );
}
