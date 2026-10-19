import React, { useRef, useState } from 'react';
import { Platform, Pressable, StyleProp, StyleSheet, TextInput, TextStyle, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../styles';

interface PasswordInputProps {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  style?: StyleProp<TextStyle>;
  onFocus?: () => void;
  onBlur?: () => void;
}

/**
 * A password field with a button to show or hide what's been typed.

 */
export default function PasswordInput({ value, onChangeText, placeholder, style, onFocus, onBlur }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  // The key behind the change about to arrive - iOS reports it first.
  const lastKey = useRef<string | null>(null);

  const handleChange = (next: string) => {
    let kept = next;
    if (Platform.OS === 'ios' && !visible && value.length > 1 && next.length <= 1) {
      kept = lastKey.current === 'Backspace' ? value.slice(0, -1) : value + next;
    }
    lastKey.current = null;
    onChangeText(kept);
  };

  return (
    <View style={localStyles.wrap}>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        onBlur={onBlur}
        onChangeText={handleChange}
        onFocus={onFocus}
        onKeyPress={(event) => { lastKey.current = event.nativeEvent.key; }}
        placeholder={placeholder}
        placeholderTextColor={colors.whiteA40}
        secureTextEntry={!visible}
        style={[style, localStyles.input]}
        value={value}
      />
      <Pressable
        accessibilityLabel={visible ? 'Hide password' : 'Show password'}
        hitSlop={8}
        onPress={() => setVisible((shown) => !shown)}
        style={localStyles.toggle}
      >
        <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.whiteA70} />
      </Pressable>
    </View>
  );
}

const localStyles = StyleSheet.create({
  wrap: {
    justifyContent: 'center',
  },
  input: {
    paddingRight: 46,
  },
  toggle: {
    position: 'absolute',
    right: 12,
    padding: 4,
  },
});
