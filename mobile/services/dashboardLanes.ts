import { RideCardProps, RideStatus } from '../components/RideCard';

const byDate = (a: RideCardProps, b: RideCardProps) => a.date.getTime() - b.date.getTime();

/**
 * The cards one Dashboard lane shows, in date order.
 *
 * Each ride normally appears once, in the lane for its status. The exception
 * is a driver's drive that has a passenger confirmed but is still open to more:
 * it's an upcoming drive AND an open offer, so it shows in both. Upcoming Drives
 * gets the card as it is - the planned trip, like a rider's confirmed ride. Open
 * Driving Offers gets a copy at the end of the lane, showing the driver's own
 * window instead of the planned times, because what's open is the search for
 * more riders, not a fixed trip. Once the drive is full or locked, the copy goes.
 */
export function ridesForLane(
  rides: RideCardProps[],
  lane: RideStatus,
  mode: 'rider' | 'driver',
): RideCardProps[] {
  const inLane = rides.filter((r) => r.status === lane).sort(byDate);
  if (mode !== 'driver' || lane !== 'pending') return inLane;

  const stillOpen = rides
    .filter((r) => r.status === 'confirmed' && r.seats?.open)
    .sort(byDate)
    .map((r): RideCardProps => ({ ...r, status: 'pending', timeWindow: r.bookingWindow }));
  return [...inLane, ...stillOpen];
}
