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
 *
 * iOS wipes a hidden password field on the first key pressed after it's
 * focused again - one typed letter replaces the whole password, and backspace
 * empties it - so fixing a password the form rejected for a missing number
 * meant retyping all of it. That first change is turned back into an edit at
 * the end, where iOS keeps the cursor in a hidden field.
 */
export default function PasswordInput({ value, onChangeText, placeholder, style, onFocus, onBlur }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const refocused = useRef(false);

  const handleChange = (next: string) => {
    let kept = next;
    if (refocused.current && Platform.OS === 'ios' && !visible && value.length > 1 && next.length <= 1) {
      kept = next ? value + next : value.slice(0, -1);
    }
    refocused.current = false;
    onChangeText(kept);
  };

  return (
    <View style={localStyles.wrap}>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        onBlur={onBlur}
        onChangeText={handleChange}
        onFocus={() => {
          refocused.current = value.length > 0;
          onFocus?.();
        }}
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
