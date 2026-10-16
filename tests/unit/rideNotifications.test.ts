import {
  getOfferNotificationEvents,
  getOfferNotificationText,
  getRiderMatchNotificationText,
} from '../../mobile/services/rideNotifications';

describe('offer notification events', () => {
  it('does not emit events from the initial offer snapshot', () => {
    expect(getOfferNotificationEvents(undefined, { status: 'pending' })).toEqual([]);
  });

  it('detects a newly matched rider and an accepted rider joining', () => {
    expect(getOfferNotificationEvents(
      { status: 'pending', confirmedRequestIds: [] },
      { status: 'awaiting', pendingRequestId: 'r1', confirmedRequestIds: [] },
    )).toEqual([{ type: 'new-match', requestId: 'r1' }]);
    expect(getOfferNotificationEvents(
      { status: 'awaiting', pendingRequestId: null, confirmedRequestIds: [] },
      { status: 'pending', confirmedRequestIds: ['r1'] },
    )).toEqual([{ type: 'passenger-added', requestId: 'r1' }]);
  });

  it('detects rider and driver cancellations', () => {
    expect(getOfferNotificationEvents(
      { status: 'confirmed', confirmedRequestIds: ['r1', 'r2'] },
      { status: 'pending', confirmedRequestIds: ['r2'] },
    )).toEqual([{ type: 'passenger-cancelled', requestId: 'r1' }]);
    expect(getOfferNotificationEvents(
      { status: 'confirmed', confirmedRequestIds: ['r1'] },
      { status: 'cancelled', confirmedRequestIds: ['r1'] },
    )).toEqual([{ type: 'drive-cancelled' }]);
  });

  it('uses different copy for drivers and riders', () => {
    const event = { type: 'passenger-added', requestId: 'r1' } as const;
    const details = { destination: 'Monash University', date: 'Oct 16', time: '8:00' };

    expect(getOfferNotificationText(event, 'driver', details)).toBe(
      'A new passenger joined your drive to Monash University on Oct 16.',
    );
    expect(getOfferNotificationText(event, 'rider', details)).toBe(
      'Your driver added a passenger to the shared ride to Monash University on Oct 16.',
    );
    expect(getRiderMatchNotificationText('Monash University', 'Oct 16')).toMatch(/matched with a driver/);
  });
});
