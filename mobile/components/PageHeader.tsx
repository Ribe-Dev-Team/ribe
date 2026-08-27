import React from 'react';
import { Text, View } from 'react-native';
import styles from '../styles';

export default function PageHeader() {
  return (
    <View style={styles.calendarHeader}>
      <Text style={styles.calendarTitle}>Calendar</Text>
    </View>
  );
}
