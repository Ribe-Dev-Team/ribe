import React, { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import styles from '../styles';
import { Booking } from './schema/booking.schema';
import { addRideRequest, addRideOffer } from './schema/firebaseBookingMethods';

export default function BookingPage() {
  const [toUni, setToUni] = useState<boolean>(true);
  const [address, setAddress] = useState<string>('');
  const [addrErr, setAddrErr] = useState<string>('');
  const [travelDate, setTravelDate] = useState<string>(''); // Format: YYYY-MM-DD
  const [travelDateErr, setTravelDateErr] = useState<string>('');
  const [depTime, setDepTime] = useState<string>(''); // Format: HH:mm
  const [depTimeErr, setDepTimeErr] = useState<string>('');
  const [arrTime, setArrTime] = useState<string>(''); // Format: HH:mm
  const [arrTimeErr, setArrTimeErr] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const validateBooking = (): boolean => {
    let valid = true;

    if (!address.trim()) {
      setAddrErr('Address is required.');
      valid = false;
    } else setAddrErr('');

    if (!/^\d{4}-\d{2}-\d{2}$/.test(travelDate.trim())) {
      setTravelDateErr('Enter date in YYYY-MM-DD format.');
      valid = false;
    } else {
      const [year, month, day] = travelDate.trim().split('-').map(Number);
      const parsedDate = new Date(year, month - 1, day);
      if (isNaN(parsedDate.getTime()) || parsedDate <= new Date()) {
        setTravelDateErr('Date must be a valid future date.');
        valid = false;
      } else setTravelDateErr('');
    }

    if (!/^\d{2}:\d{2}$/.test(depTime.trim())) {
      setDepTimeErr('Departure time must be HH:mm (24-hr).');
      valid = false;
    } else setDepTimeErr('');

    if (!/^\d{2}:\d{2}$/.test(arrTime.trim())) {
      setArrTimeErr('Arrival time must be HH:mm (24-hr).');
      valid = false;
    } else setArrTimeErr('');

    return valid;
  };

  const submitBooking = async (): Promise<void> => {
    if (!validateBooking() || isSubmitting) return;

    setIsSubmitting(true);

    try {
      // 1. Build local Booking object matching booking.schema.ts
      const bookingData: Booking = {
        toUni,
        address: address.trim(),
        travelDate: travelDate.trim(),
        depTime: depTime.trim(),
        arrTime: arrTime.trim(),
      };

      // 2. Pass to firebaseBookingMethods which converts it to RideRequest for Firestore
      const newRequestId = await addRideRequest(bookingData);
      console.log('Ride request created with ID:', newRequestId);
      alert('Ride request successfully created!');
    } catch (error) {
      console.error('Failed to create ride request:', error);
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
            <TextInput onChangeText={setTravelDate} style={styles.input} value={travelDate} placeholder="2026-09-01" />
            {travelDateErr !== '' && <Text style={styles.errorText}>{travelDateErr}</Text>}
          </View>

          {/* Departure Time Input */}
          <View>
            <Text style={styles.helperText}>Earliest Departure (HH:mm):</Text>
            <TextInput onChangeText={setDepTime} style={styles.input} value={depTime} placeholder="08:30" />
            {depTimeErr !== '' && <Text style={styles.errorText}>{depTimeErr}</Text>}
          </View>

          {/* Arrival Time Input */}
          <View>
            <Text style={styles.helperText}>Latest Arrival (HH:mm):</Text>
            <TextInput onChangeText={setArrTime} style={styles.input} value={arrTime} placeholder="09:15" />
            {arrTimeErr !== '' && <Text style={styles.errorText}>{arrTimeErr}</Text>}
          </View>

          {/* Submit */}
          <View>
            <Pressable onPress={submitBooking} style={styles.primaryButton} disabled={isSubmitting}>
              <Text style={styles.primaryButtonText}>{isSubmitting ? 'Submitting...' : 'Submit'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}