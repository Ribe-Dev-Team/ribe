import { BookingStatus } from './matchStatus';

export type { BookingStatus };

/*
Geographic point, stored alongside the free-text address so the matching module
(matching/src/types.ts) can consume a booking without re-geocoding it.

Deliberately `lon`, not Google's `lng`: this shape is read directly by the
matcher's own Coord, so the conversion happens once here at the boundary rather
than on every read.
*/
export interface Coord {
    lat: number,
    lon: number,
}

export interface Booking {
    userId?: string,
    status?: BookingStatus,
    isDriving: boolean,
    toUni: boolean,
    address: string,
    /*
    Resolved coordinates for `address`. Optional: Places/Geocoding can fail, or
    the API key can be absent, and a booking is still worth accepting without
    them - it just can't be matched until backfilled.
    */
    coord?: Coord,
    travelDate: string,
    depTime: string,
    arrTime: string;
    /*
    Max detour in minutes. Required from BOTH roles now: for a driver it is
    extra time added to the whole trip, for a rider it is extra time absorbed
    over their own direct trip. Optional here only because this type also
    models a half-filled form draft.
    */
    detourTime?: number;
    /** Seats offered. Drivers only. */
    capacity?: number;
}