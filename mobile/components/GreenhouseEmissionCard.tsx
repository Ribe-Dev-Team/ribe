import React from 'react';
import { View, Text } from 'react-native';
import styles from '../styles';

interface GreenhouseEmissionCardProps {
  co2SavedKg: number;
}

export default function GreenhouseEmissionCard({ co2SavedKg }: GreenhouseEmissionCardProps) {
  return (
    <View style={styles.savingsPanel}>
      <Text style={styles.savingsKicker}>CO2 SAVINGS</Text>
      <Text style={styles.savingsValue}>{co2SavedKg ?? 0} kg saved</Text>
      <Text style={styles.savingsText}>
        Sharing this ride keeps another car off the road.
      </Text>
    </View>
  );
}
