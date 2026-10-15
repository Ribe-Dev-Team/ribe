import { acceptMatch, addRideOffer, addRideRequest } from '../../mobile/pages/schema/firebaseBookingMethods';
import { db } from '../../mobile/firebaseConfig';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { fetchUserRides } from '../../mobile/services/rideData';

jest.mock('../../mobile/utility/emissions', () => {
  const actual = jest.requireActual('../../mobile/utility/emissions');
  return {
    ...actual,
    estimateEmissionsSaved: jest.fn(async (address: string) => {
      if (address.includes('Driver')) return 3.4;
      if (address.includes('Rider 1')) return 2.5;
      if (address.includes('Rider 2')) return 1.8;
      return 2.0;
    }),
  };
});

jest.useRealTimers();

describe('Driver emissions saved when getting riders', () => {
  it('updates driver offer emissionsSavedKg as the total distance plus each riders emission upon acceptMatch', async () => {
    const offerId = 'driver-offer-emissions-test';
    const req1Id = 'rider-1-req';
    const req2Id = 'rider-2-req';

    // Seed driver offer with driverEmissionsKg = 3.4 and 0 initial saved
    await setDoc(doc(db, 'rideOffers', offerId), {
      status: 'awaiting',
      userId: 'driver-uid',
      address: 'Driver Home, Clayton',
      seatCapacity: 3,
      confirmedRequestIds: [],
      pendingRequestId: req1Id,
      matchedRiderId: 'rider-1-uid',
      driverEmissionsKg: 3.4,
      emissionsSavedKg: 0,
    });

    // Seed rider 1 request with emissionsSavedKg = 2.5
    await setDoc(doc(db, 'rideRequests', req1Id), {
      status: 'awaiting',
      userId: 'rider-1-uid',
      address: 'Rider 1 Home',
      matchedOfferId: offerId,
      matchedDriverId: 'driver-uid',
      routeIndex: 0,
      emissionsSavedKg: 2.5,
    });

    // Rider 1 accepts match
    await acceptMatch(req1Id);

    const offerSnap1 = await getDoc(doc(db, 'rideOffers', offerId));
    expect(offerSnap1.exists()).toBe(true);
    const offerData1 = offerSnap1.data()!;
    expect(offerData1.confirmedRequestIds).toEqual([req1Id]);
    // Amount saved is driver total distance emission (3.4) + rider 1 emission (2.5) = 5.9
    expect(offerData1.emissionsSavedKg).toBe(5.9);

    // Now driver gets a second rider (Rider 2)
    await setDoc(doc(db, 'rideOffers', offerId), {
      ...offerData1,
      status: 'awaiting',
      pendingRequestId: req2Id,
      matchedRiderId: 'rider-2-uid',
    });

    await setDoc(doc(db, 'rideRequests', req2Id), {
      status: 'awaiting',
      userId: 'rider-2-uid',
      address: 'Rider 2 Home',
      matchedOfferId: offerId,
      matchedDriverId: 'driver-uid',
      routeIndex: 1,
      emissionsSavedKg: 1.8,
    });

    // Rider 2 accepts match
    await acceptMatch(req2Id);

    const offerSnap2 = await getDoc(doc(db, 'rideOffers', offerId));
    const offerData2 = offerSnap2.data()!;
    expect(offerData2.confirmedRequestIds).toEqual([req1Id, req2Id]);
    // Amount saved is driver total distance emission (3.4) + rider 1 (2.5) + rider 2 (1.8) = 7.7
    expect(offerData2.emissionsSavedKg).toBe(7.7);
  });

  it('reflects correct emissions saved on driver ride card via fetchUserRides', async () => {
    const driverUid = 'driver-user-test-77';
    const offerId = 'driver-offer-card-test';
    const riderReqId = 'rider-card-test-req';

    // 1. Offer with NO riders yet
    await setDoc(doc(db, 'rideOffers', offerId), {
      status: 'pending',
      userId: driverUid,
      address: 'Driver Home, Clayton',
      toUni: true,
      departureTime: '08:00',
      arrivalTime: '09:00',
      seatCapacity: 3,
      confirmedRequestIds: [],
      driverEmissionsKg: 3.4,
      emissionsSavedKg: 0,
    });

    const ridesBefore = await fetchUserRides(driverUid);
    expect(ridesBefore.offers.length).toBe(1);
    // With 0 riders, driver co2SavedKg is 0
    expect(ridesBefore.offers[0].co2SavedKg).toBe(0);

    // 2. Offer with 1 confirmed rider
    await setDoc(doc(db, 'rideRequests', riderReqId), {
      status: 'confirmed',
      userId: 'rider-uid-abc',
      address: 'Rider 1 Home',
      toUni: true,
      matchedOfferId: offerId,
      emissionsSavedKg: 2.5,
    });

    await setDoc(doc(db, 'rideOffers', offerId), {
      status: 'confirmed',
      userId: driverUid,
      address: 'Driver Home, Clayton',
      toUni: true,
      departureTime: '08:00',
      arrivalTime: '09:00',
      seatCapacity: 3,
      confirmedRequestIds: [riderReqId],
      driverEmissionsKg: 3.4,
      emissionsSavedKg: 5.9,
    });

    const ridesAfter = await fetchUserRides(driverUid);
    expect(ridesAfter.offers.length).toBe(1);
    // Driver gets rider: emission saved is total distance (3.4) + rider emission (2.5) = 5.9
    expect(ridesAfter.offers[0].co2SavedKg).toBe(5.9);
  });
});

