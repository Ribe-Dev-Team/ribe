import React, { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import styles from '../styles';

export default function BookingPage() {
  // create hook for dynamic behaviour
  const [toUni, setToUni] = useState(true);

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
          {
            (toUni)
              ? (<View>
                <Text style={styles.helperText}>Enter pick up address:</Text>
                <TextInput style={styles.input} />
              </View>)
              : (<View>
                <Text style={styles.helperText}>Enter destination address:</Text>
                <TextInput style={styles.input} />
              </View>)
          }

          {/* Date and time inputs */}
          <View>
            <Text style={styles.helperText}>What date would you like to travel?</Text>
            <TextInput style={styles.input} />
          </View>
          <View>
            <Text style={styles.helperText}>Earliest Departure:</Text>
            <TextInput style={styles.input} />
          </View>
          <View>
            <Text style={styles.helperText}>Latest Arrival:</Text>
            <TextInput style={styles.input} />
          </View>

          {/* Submit Button */}
          <View>
            <Pressable style={styles.primaryButton}>
              <Text onPress={() => { }} style={styles.primaryButtonText}>Submit</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}