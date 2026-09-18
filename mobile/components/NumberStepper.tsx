import React from 'react';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../styles';

interface NumberStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  style?: StyleProp<ViewStyle>;
}

export default function NumberStepper({ value, onChange, min = 0, max = Infinity, step = 1, suffix, style }: NumberStepperProps) {
  const atMin = value <= min;
  const atMax = value >= max;

  return (
    <View style={[localStyles.row, style]}>
      <Pressable
        accessibilityLabel="Decrease"
        disabled={atMin}
        hitSlop={8}
        onPress={() => onChange(Math.max(min, value - step))}
        style={[localStyles.button, atMin && localStyles.buttonDisabled]}
      >
        <Ionicons color={colors.white} name="remove" size={18} />
      </Pressable>

      <Text style={localStyles.value}>{value}{suffix ? ` ${suffix}` : ''}</Text>

      <Pressable
        accessibilityLabel="Increase"
        disabled={atMax}
        hitSlop={8}
        onPress={() => onChange(Math.min(max, value + step))}
        style={[localStyles.button, atMax && localStyles.buttonDisabled]}
      >
        <Ionicons color={colors.white} name="add" size={18} />
      </Pressable>
    </View>
  );
}

const localStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  button: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  buttonDisabled: {
    opacity: 0.35,
  },
  value: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
});
