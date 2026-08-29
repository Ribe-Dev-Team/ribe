export interface Booking {
    isDriving: boolean,
    toUni: boolean,
    address: string,
    travelDate: string,
    depTime: string,
    arrTime: string;
    detourTime?: number;
    capacity?: number;
}