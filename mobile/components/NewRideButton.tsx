import React from 'react';
import { Pressable, Text } from 'react-native';
import styles from '../styles';

interface NewRideButtonProps {
  onPress: () => void;
}

export default function NewRideButton({ onPress }: NewRideButtonProps) {
  return (
    <Pressable onPress={onPress} style={styles.newRideButton}>
      <Text style={styles.newRidePlus}>＋</Text>
      <Text style={styles.newRideText}>New Ride</Text>
    </Pressable>
  );
}
