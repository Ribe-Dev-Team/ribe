import React, { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import styles from '../styles';
import { Booking } from './schema/booking.schema';
import { addRideRequest, addRideOffer } from './schema/firebaseBookingMethods';

const datePattern = /^\d{2}-\d{2}-\d{4}$/;
const timePattern = /^\d{2}:\d{2}$/;

interface BookingPageProps {
  onDone: () => void;
}

export default function BookingPage({ onDone }: BookingPageProps) {
  const [isDriving, setIsDriving] = useState<boolean>(false);
  const [toUni, setToUni] = useState<boolean>(true);
  const [address, setAddress] = useState<string>('');
  const [addrErr, setAddrErr] = useState<string>('');
  const [travelDate, setTravelDate] = useState<string>(''); // Format: DD-MM-YYYY
  const [travelDateErr, setTravelDateErr] = useState<string>('');
  const [detourTime, setDetourTime] = useState<number>(0);
  const [detourTimeErr, setDetourTimeErr] = useState<string>('');
  const [numSeats, setNumSeats] = useState<number>(1);
  const [numSeatsErr, setNumSeatsErr] = useState<string>('');
  const [depTime, setDepTime] = useState<string>(''); // Format: HH:mm
  const [depTimeErr, setDepTimeErr] = useState<string>('');
  const [arrTime, setArrTime] = useState<string>(''); // Format: HH:mm
  const [arrTimeErr, setArrTimeErr] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const validateBooking = (): boolean => {
    let valid = true;

    // address validation
    if (!address.trim()) {
      setAddrErr('Address is required.');
      valid = false;
    } else setAddrErr('');

    // travel date validation
    if (!datePattern.test(travelDate.trim())) {
      setTravelDateErr('Enter date in DD-MM-YYYY format.');
      valid = false;
    } else {
      const [day, month, year] = travelDate.trim().split('-').map(Number);
      const parsedDate = new Date(year, month - 1, day);
      if (isNaN(parsedDate.getTime()) || parsedDate <= new Date()) {
        setTravelDateErr('Date must be a valid future date.');
        valid = false;
      } else setTravelDateErr('');
    }

    // detour time & seats validation
    if (!isDriving) {
      setDetourTimeErr('');
      setDetourTime(0);
      setNumSeatsErr('');
    } else {
      if (detourTime <= 0) {
        setDetourTimeErr("Maximum detour time required");
      } else setDetourTimeErr('');

      if (numSeats < 1) {
        setNumSeatsErr("Ride offers require at least one available seat");
      } else if (numSeats > 12) {
        setNumSeatsErr("Too many seats offered. Max 12.");
      } else setNumSeatsErr('');
    }

    // departure time validation
    if (!timePattern.test(depTime.trim())) {
      setDepTimeErr('Departure time must be HH:mm (24-hr).');
      valid = false;
    } else setDepTimeErr('');

    // arrival time validation
    if (!timePattern.test(arrTime.trim())) {
      setArrTimeErr('Arrival time must be HH:mm (24-hr).');
      valid = false;
    } else setArrTimeErr('');

    // return valid if no issues found, otherwise return false
    return valid;
  };

  const submitBooking = async (): Promise<void> => {
    if (!validateBooking() || isSubmitting) return;

    setIsSubmitting(true);

    try {
      // Build common booking data
      const commonData: Booking = {
        isDriving,
        toUni,
        address: address.trim(),
        travelDate: travelDate.trim(),
        depTime: depTime.trim(),
        arrTime: arrTime.trim(),
      };
      // add detour time for drivers
      const bookingData: Booking = (isDriving)
        ? {
          ...commonData,
          detourTime: detourTime,
          capacity: numSeats,
        } : commonData;

      // Pass object to firebaseBookingMethods which converts it to Firestore format
      if (isDriving) {
        const newOfferId = await addRideOffer(bookingData);
        console.log('Ride offer created with ID:', newOfferId);
        alert('Ride offer successfully created!');
      } else {
        const newRequestId = await addRideRequest(bookingData);
        console.log('Ride request created with ID:', newRequestId);
        alert('Ride request successfully created!');
      }
      onDone();
    } catch (error) {
      console.error('Failed to create ride request/offer:', error);
      alert('Error submitting booking.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.calendarScreen} showsVerticalScrollIndicator={false}>
      <View style={styles.pageScreen}>
        <View style={styles.pageCard}>
          <Text style={styles.title}>Make a Booking</Text>

          {/* Driver/Rider Selection */}
          <View>
            <Text style={styles.helperText}>Are you offering to drive?</Text>
            <Pressable onPress={() => setIsDriving(true)} style={
              (isDriving)
                ? [styles.primaryButton, styles.primaryButtonDisabled]
                : styles.primaryButton
            }>
              <Text style={styles.primaryButtonText}>Yes, I'll drive</Text>
            </Pressable>
            <Pressable onPress={() => setIsDriving(false)} style={
              (isDriving)
                ? styles.primaryButton
                : [styles.primaryButton, styles.primaryButtonDisabled]
            }>
              <Text style={styles.primaryButtonText}>No, I'll be a passenger</Text>
            </Pressable>
          </View>

          {/* Travel Direction */}
          <View>
            <Text style={styles.helperText}>Are you heading to uni?</Text>
            <Pressable
              onPress={() => setToUni(true)}
              style={toUni ? [styles.primaryButton, styles.primaryButtonDisabled] : styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>Yes</Text>
            </Pressable>
            <Pressable
              onPress={() => setToUni(false)}
              style={toUni ? styles.primaryButton : [styles.primaryButton, styles.primaryButtonDisabled]}
            >
              <Text style={styles.primaryButtonText}>No</Text>
            </Pressable>
          </View>

          {/* Address Input */}
          <View>
            <Text style={styles.helperText}>{toUni ? 'Pickup Address:' : 'Destination Address:'}</Text>
            <TextInput onChangeText={setAddress} style={styles.input} value={address} placeholder="123 Main St, Suburb" />
            {addrErr !== '' && <Text style={styles.errorText}>{addrErr}</Text>}
          </View>

          {/* Date Input */}
          <View>
            <Text style={styles.helperText}>Travel Date (YYYY-MM-DD):</Text>
            <TextInput onChangeText={setTravelDate} style={styles.input} value={travelDate} placeholder="DD-MM-YYYY" />
            {travelDateErr !== '' && <Text style={styles.errorText}>{travelDateErr}</Text>}
          </View>

          {/* Detour limit, drivers only */}
          {(isDriving) ? (
            <View>
              <Text style={styles.helperText}>How much are you willing to detour? (mins)</Text>
              <TextInput onChangeText={(str) => setDetourTime(Number(str))} style={styles.input} />
              {(detourTimeErr !== '') ? <Text style={styles.errorText}>{detourTimeErr}</Text> : null}
            </View>
          ) : null}

          {/* Departure Time Input */}
          <View>
            <Text style={styles.helperText}>Earliest Departure (HH:mm):</Text>
            <TextInput onChangeText={setDepTime} style={styles.input} value={depTime} placeholder="HH:MM (24hr)" />
            {depTimeErr !== '' && <Text style={styles.errorText}>{depTimeErr}</Text>}
          </View>

          {/* Arrival Time Input */}
          <View>
            <Text style={styles.helperText}>Latest Arrival (HH:mm):</Text>
            <TextInput onChangeText={setArrTime} style={styles.input} value={arrTime} placeholder="HH:MM (24hr)" />
            {arrTimeErr !== '' && <Text style={styles.errorText}>{arrTimeErr}</Text>}
          </View>

          {/* Passenger capacity, drivers only */}
          {(isDriving) ? (
            <View>
              <Text style={styles.helperText}>How many passengers are you willing to take?</Text>
              <TextInput onChangeText={(str) => setNumSeats(Number(str))} style={styles.input} />
              {(numSeatsErr !== '') ? <Text style={styles.errorText}>{numSeatsErr}</Text> : null}
            </View>
          ) : null}

          {/* Submit */}
          <View>
            <Pressable onPress={submitBooking} style={styles.primaryButton} disabled={isSubmitting}>
              <Text style={styles.primaryButtonText}>{isSubmitting ? 'Submitting...' : 'Submit'}</Text>
            </Pressable>
            <Pressable onPress={onDone} style={styles.linkButton}>
              <Text style={styles.linkText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}