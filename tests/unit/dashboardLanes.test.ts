// Unit tests for mobile/services/dashboardLanes.ts: which Dashboard lane each
// ride card appears in, the copy of a still-open drive in Open Driving Offers,
// and past rides being left to the Calendar.

import { ridesForLane, upcomingRides } from '../../mobile/services/dashboardLanes';
import { RideCardProps } from '../../mobile/components/RideCard';

const window = { from: '07:00', to: '09:00' };

function card(p: Partial<RideCardProps> & { rideId: string; status: RideCardProps['status'] }): RideCardProps {
  return {
    kind: 'offer',
    date: new Date('2026-10-05T00:00:00+11:00'),
    pickup: { address: 'Box Hill', time: '08:26' },
    destination: { address: 'Monash University', eta: '~08:50' },
    etaMinutes: 23,
    bookingWindow: window,
    cost: '$8.50',
    co2SavedKg: 2.4,
    driver: { name: 'You', vehicle: 'Your vehicle' },
    plate: 'Your plate',
    ...p,
  };
}

const open = card({ rideId: 'open', status: 'confirmed', seats: { filled: 1, total: 3, open: true, locked: false } });
const locked = card({ rideId: 'locked', status: 'confirmed', seats: { filled: 1, total: 3, open: false, locked: true } });
const full = card({ rideId: 'full', status: 'confirmed', seats: { filled: 3, total: 3, open: false, locked: false } });
const searching = card({ rideId: 'searching', status: 'pending', timeWindow: window, seats: { filled: 0, total: 3, open: true, locked: false } });

describe('driver lanes', () => {
  const drives = [open, locked, full, searching];

  it('keeps every drive with a passenger in Upcoming Drives, with its planned times', () => {
    const upcoming = ridesForLane(drives, 'confirmed', 'driver');

    expect(upcoming.map((r) => r.rideId)).toEqual(['open', 'locked', 'full']);
    expect(upcoming[0]).toBe(open); // untouched: still the planned trip
  });

  it('also lists a drive still open to passengers under Open Driving Offers, at the end, showing its window', () => {
    const offers = ridesForLane(drives, 'pending', 'driver');

    expect(offers.map((r) => r.rideId)).toEqual(['searching', 'open']);
    const copy = offers[1];
    expect(copy.status).toBe('pending');
    // The card shows the range, not "23 min" / 08:26 / ETA ~08:50.
    expect(copy.timeWindow).toEqual(window);
    expect(open.timeWindow).toBeUndefined(); // the Upcoming card isn't changed
  });

  it("doesn't copy a drive that is full or locked", () => {
    const ids = ridesForLane(drives, 'pending', 'driver').map((r) => r.rideId);
    expect(ids).not.toContain('locked');
    expect(ids).not.toContain('full');
  });
});

describe('rider lanes', () => {
  it('shows each ride once, in its own lane', () => {
    const rider = card({ rideId: 'mine', kind: 'request', status: 'confirmed', seats: { filled: 1, total: 3, open: true, locked: false } });

    expect(ridesForLane([rider], 'confirmed', 'rider')).toEqual([rider]);
    expect(ridesForLane([rider], 'pending', 'rider')).toEqual([]);
  });
});

describe('upcoming rides only', () => {
  const now = new Date(2026, 9, 5, 14, 30); // Mon 5 Oct, 2:30pm
  const on = (rideId: string, day: number) => card({ rideId, status: 'confirmed', date: new Date(2026, 9, day) });

  it("leaves past days' rides to the Calendar", () => {
    const rides = [on('last-week', 1), on('yesterday', 4), on('tomorrow', 6), on('next-week', 12)];

    expect(upcomingRides(rides, now).map((r) => r.rideId)).toEqual(['tomorrow', 'next-week']);
  });

  it("keeps all of today's rides, even ones that have already happened", () => {
    const today = (rideId: string, eta: string) => card({
      rideId, status: 'confirmed', date: new Date(2026, 9, 5), destination: { address: 'Monash University', eta },
    });
    const rides = [today('this-morning', '~08:50'), today('this-evening', '~18:10')];

    expect(upcomingRides(rides, now).map((r) => r.rideId)).toEqual(['this-morning', 'this-evening']);
  });
});
