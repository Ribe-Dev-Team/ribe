import React from 'react';
import { View, Text } from 'react-native';
import styles from '../styles';

interface PageScreenProps {
  title: string;
  subtitle?: string;
}

export default function PageScreen({ title, subtitle }: PageScreenProps) {
  return (
    <View style={styles.pageScreen}>
      <View style={styles.pageCard}>
        <Text style={styles.pageTitle}>{title}</Text>
        {subtitle ? <Text style={styles.pageSubtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}
