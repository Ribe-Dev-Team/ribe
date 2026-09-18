import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import styles, { colors } from '../styles';
import CalendarGrid from '../components/CalendarGrid';
import PageHeader from '../components/PageHeader';
import CarouselControls from '../components/CarouselControls';
import NewRideButton from '../components/NewRideButton';
import CalendarRideRow from '../components/CalendarRideRow';
import { useAuth } from '../auth/useAuth';
import { RideCardProps } from '../components/RideCard';
import { fetchUserRides } from '../services/rideData';

export type RideStatus = 'pending' | 'awaiting' | 'confirmed' | 'cancelled';

//TODO: link to real data
//TODO: make the +New Ride button hover over the whole page
//TODO: update calendar dot colours
//TODO: make past days greyed out.

export interface Ride {
  status: RideStatus;
  date?: Date;
  time: string;
  duration?: string;
  start: string;
  destination: string;
  driver: string;
  driverUid?: string;
  vehicle: string;
  id?: string;
  kind?: 'request' | 'offer';
}

const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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
  onNewRide: (date: Date) => void;
}

const today = new Date();

export default function CalendarPage({ onOpenRide, onNewRide }: CalendarPageProps) {
  const { user } = useAuth();
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(today);
  const [rides, setRides] = useState<Record<string, Ride[]>>({});
  const [loading, setLoading] = useState(true);
  const calendarDays = useMemo(() => getCalendarDays(month), [month]);
  const selectedRides = rides[dateKey(selectedDate)] ?? [];

  useEffect(() => {
    if (!user?.uid) {
      setRides({});
      setLoading(false);
      return;
    }

    let isMounted = true;

    const loadCalendarRides = async () => {
      try {
        const { requests, offers } = await fetchUserRides(user.uid);
        if (!isMounted) return;

        const allTrips: Ride[] = [
          ...requests.map((ride: RideCardProps) => ({
            status: ride.status,
            date: ride.date,
            time: ride.pickup.time,
            duration: `${ride.etaMinutes} min`,
            start: ride.pickup.address,
            destination: ride.destination.address,
            driver: ride.driver.name,
            driverUid: ride.driver.uid,
            vehicle: ride.driver.vehicle,
            id: ride.id,
            kind: ride.kind,
          })),
          ...offers.map((ride: RideCardProps) => ({
            status: ride.status,
            date: ride.date,
            time: ride.pickup.time,
            duration: `${ride.etaMinutes} min`,
            start: ride.pickup.address,
            destination: ride.destination.address,
            driver: ride.driver.name,
            driverUid: ride.driver.uid,
            vehicle: ride.driver.vehicle,
            id: ride.id,
            kind: ride.kind,
          })),
        ];

        const grouped: Record<string, Ride[]> = {};
        allTrips.forEach((ride) => {
          const key = dateKey(ride.date ? new Date(ride.date) : selectedDate);
          grouped[key] = grouped[key] ? [...grouped[key], ride] : [ride];
        });

        setRides(grouped);
      } catch (error) {
        console.warn('Failed to load calendar trips:', error);
        if (isMounted) setRides({});
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadCalendarRides();
    return () => {
      isMounted = false;
    };
  }, [user?.uid, selectedDate]);

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

      <View style={styles.ridesHeadingRow}>
        <Text style={styles.ridesHeading}>Rides on {monthNames[selectedDate.getMonth()]} {selectedDate.getDate()}</Text>
        <NewRideButton onPress={() => onNewRide(selectedDate)} />
      </View>
      {loading ? (
        <View style={{ paddingVertical: 18, alignItems: 'center' }}>
          <ActivityIndicator color={colors.white} size="small" />
        </View>
      ) : selectedRides.length ? selectedRides.map((ride) => {
        const detail = statusDetails[ride.status];
        return <CalendarRideRow key={`${ride.status}-${ride.start}-${ride.time}`} onPress={() => onOpenRide(ride, selectedDate)} ride={ride} statusColor={detail.color} statusLabel={detail.label} />;
      }) : <Text style={styles.emptyRides}>No rides scheduled for this day.</Text>}
    </ScrollView>
  );
}
