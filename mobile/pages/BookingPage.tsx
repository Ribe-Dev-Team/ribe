import React, { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import styles from '../styles';
import { Booking } from './schema/booking.schema';

export default function BookingPage() {
  // create hook for dynamic behaviour
  const [toUni, setToUni] = useState<boolean>(true);
  const [address, setAddress] = useState<string>('');
  const [addrErr, setAddrErr] = useState<string>('');
  const [travelDate, setTravelDate] = useState<string>('');
  const [travelDateErr, setTravelDateErr] = useState<string>('');
  const [depTime, setDepTime] = useState<string>('');
  const [depTimeErr, setDepTimeErr] = useState<string>('');
  const [arrTime, setArrTime] = useState<string>('');
  const [arrTimeErr, setArrTimeErr] = useState<string>('');

  const isValid = (): boolean => {
    return (addrErr === '') && (travelDateErr === '') && (depTimeErr === '') && (arrTimeErr === '');
  };

  const validateBooking = (): boolean => {
    console.log(travelDate);

    // address validation
    if (address === '') {
      setAddrErr("Address required");
    } else {
      setAddrErr('');
    }

    // date validation
    if (travelDate === '') {
      setTravelDateErr("Travel date required");
    } else {
      setTravelDateErr('');
    }

    // departure time validation
    if (depTime === '') {
      setDepTimeErr("Departure time required");
    } else {
      setDepTimeErr('');
    }

    // arrival time validation
    if (arrTime === '') {
      setArrTimeErr("Arrival time required");
    } else {
      setArrTimeErr('');
    }

    return isValid();
  };
  const submitBooking = async (): Promise<void> => {
    if (!validateBooking()) return;

    // send to database/backend
  };

  return (
    <ScrollView contentContainerStyle={styles.calendarScreen} showsVerticalScrollIndicator={false}>
      <View style={styles.pageScreen}>
        <View style={styles.pageCard}>
          <Text style={styles.title}>Make a Booking</Text>

          {/* To/From Uni Selection */}
          <View>
            <Text style={styles.helperText}>Are you heading to uni?</Text>
            <Pressable onPress={() => setToUni(true)} style={
              (toUni)
                ? [styles.primaryButton, styles.primaryButtonDisabled]
                : styles.primaryButton
            }>
              <Text style={styles.primaryButtonText}>Yes</Text>
            </Pressable>
            <Pressable onPress={() => setToUni(false)} style={
              (toUni)
                ? styles.primaryButton
                : [styles.primaryButton, styles.primaryButtonDisabled]
            }>
              <Text style={styles.primaryButtonText}>No</Text>
            </Pressable>
          </View>

          {/* Address Selection (depending on travel direction) */}
          <View>
            <Text style={styles.helperText}>{(toUni) ? "Enter pick up address:" : "Enter destination address:"}</Text>
            <TextInput onChangeText={setAddress} style={styles.input} />
            {(addrErr !== '') ? <Text style={styles.errorText}>{addrErr}</Text> : null}
          </View>


          {/* Date and time inputs */}
          <View>
            <Text style={styles.helperText}>What date would you like to travel?</Text>
            <TextInput onChangeText={setTravelDate} style={styles.input} />
            {(travelDateErr !== '') ? <Text style={styles.errorText}>{travelDateErr}</Text> : null}
          </View>
          <View>
            <Text style={styles.helperText}>Earliest Departure:</Text>
            <TextInput onChangeText={setDepTime} style={styles.input} />
            {(depTimeErr !== '') ? <Text style={styles.errorText}>{depTimeErr}</Text> : null}
          </View>
          <View>
            <Text style={styles.helperText}>Latest Arrival:</Text>
            <TextInput onChangeText={setArrTime} style={styles.input} />
            {(arrTimeErr !== '') ? <Text style={styles.errorText}>{arrTimeErr}</Text> : null}
          </View>

          {/* Submit Button */}
          <View>
            <Pressable onPress={validateBooking} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Submit</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}