export interface OfferNotificationState {
  status?: string;
  pendingRequestId?: string | null;
  confirmedRequestIds?: string[];
}

export type OfferNotificationEvent =
  | { type: 'new-match'; requestId: string }
  | { type: 'passenger-added'; requestId: string }
  | { type: 'passenger-cancelled'; requestId: string }
  | { type: 'drive-cancelled' };

export type OfferNotificationAudience = 'driver' | 'rider';

export interface OfferNotificationDetails {
  destination: string;
  date: string;
  time: string;
}

/** Detect offer changes that should notify its driver and riders. */
export function getOfferNotificationEvents(
  previous: OfferNotificationState | undefined,
  current: OfferNotificationState,
): OfferNotificationEvent[] {
  if (!previous) return [];

  const events: OfferNotificationEvent[] = [];
  if (previous.status !== 'cancelled' && current.status === 'cancelled') {
    events.push({ type: 'drive-cancelled' });
  }

  if (current.pendingRequestId && current.pendingRequestId !== previous.pendingRequestId) {
    events.push({ type: 'new-match', requestId: current.pendingRequestId });
  }

  const previousRiders = new Set(previous.confirmedRequestIds ?? []);
  const currentRiders = new Set(current.confirmedRequestIds ?? []);
  for (const requestId of currentRiders) {
    if (!previousRiders.has(requestId)) events.push({ type: 'passenger-added', requestId });
  }
  for (const requestId of previousRiders) {
    if (!currentRiders.has(requestId)) events.push({ type: 'passenger-cancelled', requestId });
  }

  return events;
}

/** A rider's events about other passengers only. Their own request being
 *  matched, confirmed or cancelled shows up in the offer too, but it isn't
 *  another passenger - and their request's own notifications cover it. */
export function excludeOwnRequests(
  events: OfferNotificationEvent[],
  ownRequestIds: Iterable<string>,
): OfferNotificationEvent[] {
  const own = new Set(ownRequestIds);
  return events.filter((event) => !('requestId' in event) || !own.has(event.requestId));
}

export function getOfferNotificationText(
  event: OfferNotificationEvent,
  audience: OfferNotificationAudience,
  { destination, date, time }: OfferNotificationDetails,
): string {
  if (audience === 'driver') {
    switch (event.type) {
      case 'new-match':
        return `A new passenger was matched to your drive to ${destination} on ${date}; they are deciding whether to accept.`;
      case 'passenger-added':
        return `A new passenger joined your drive to ${destination} on ${date}.`;
      case 'passenger-cancelled':
        return `A passenger cancelled their ride. Your drive to ${destination} on ${date} will continue with the remaining passengers.`;
      case 'drive-cancelled':
        return `Your drive to ${destination} on ${date} at ${time} was cancelled.`;
    }
  }

  switch (event.type) {
    case 'new-match':
      return `Your driver is considering another passenger for the shared ride to ${destination} on ${date}.`;
    case 'passenger-added':
      return `Your driver added a passenger to the shared ride to ${destination} on ${date}.`;
    case 'passenger-cancelled':
      return `Another passenger cancelled. Your ride to ${destination} on ${date} is still scheduled.`;
    case 'drive-cancelled':
      return `Your driver cancelled the drive to ${destination} on ${date} at ${time}.`;
  }
}

export function getRiderMatchNotificationText(destination: string, date: string): string {
  return `Your ride request to ${destination} on ${date} has been matched with a driver. Review the match to accept or decline.`;
}
