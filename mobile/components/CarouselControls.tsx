import React from 'react';
import { Pressable, Text, View } from 'react-native';
import styles from '../styles';

interface CarouselControlsProps {
  itemLabel: string;
  onPrevious: () => void;
  onNext: () => void;
}

export default function CarouselControls({ itemLabel: itemLabel, onPrevious, onNext }: CarouselControlsProps) {
  return (
    <View style={styles.monthControls}>
      <Pressable accessibilityLabel="Previous month" onPress={onPrevious} style={styles.monthButton}>
        <Text style={styles.monthButtonText}>‹</Text>
      </Pressable>
      <Text style={styles.monthTitle}>{itemLabel}</Text>
      <Pressable accessibilityLabel="Next month" onPress={onNext} style={styles.monthButton}>
        <Text style={styles.monthButtonText}>›</Text>
      </Pressable>
    </View>
  );
}
