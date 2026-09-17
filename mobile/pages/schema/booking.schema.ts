export interface Booking {
    userId?: string,
    status?: 'pending' | 'awaiting' | 'confirmed',
    isDriving: boolean,
    toUni: boolean,
    address: string,
    travelDate: string,
    depTime: string,
    arrTime: string;
    detourTime?: number;
    capacity?: number;
}