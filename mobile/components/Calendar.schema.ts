/*
Define the different types for the calendar page
*/

import { Ride } from "../pages/CalendarPage";

export {
  CalendarDayCellProps,
  CalendarGridProps,
  CalendarRideRowProps,
  CarouselControlsProps,
};

interface CalendarDayCellProps {
  date: Date;
  month: Date;
  isSelected: boolean;
  rideColors: string[];
  onPress: () => void;
};

interface CalendarGridProps {
  month: Date;
  days: Date[];
  weekdays: string[];
  selectedDate: Date;
  getDateKey: (date: Date) => string;
  getRideColors: (date: Date) => string[];
  onSelectDate: (date: Date) => void;
};

interface CalendarRideRowProps {
  ride: Ride;
  statusLabel: string;
  statusColor: string;
  onPress: () => void;
};

interface CarouselControlsProps {
  itemLabel: string;
  onPrevious: () => void;
  onNext: () => void;
};