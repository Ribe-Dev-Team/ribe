import React, { useEffect, useRef } from 'react';
import { Animated, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import styles from '../styles';

// My Rides (the user's ride requests) and My Drives (their driving offers) are
// separate tabs. My Drives shows only for drivers - see `showDrives`.
export type NavigationTab = 'home' | 'rides' | 'drives' | 'calendar' | 'profile';

interface NavigationItem {
  key: NavigationTab;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const navigationItems: NavigationItem[] = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'rides', label: 'My Rides', icon: 'people' },
  { key: 'drives', label: 'My Drives', icon: 'car-sport' },
  { key: 'calendar', label: 'Calendar', icon: 'calendar' },
  { key: 'profile', label: 'Profile', icon: 'person' },
];

interface AppNavigationProps {
  activeTab: NavigationTab;
  onChange: (tab: NavigationTab) => void;
  hidden?: boolean;
  /** Whether to show My Drives: for registered drivers and anyone with a
   *  drive posted. Hidden for everyone else. */
  showDrives?: boolean;
}

export default function AppNavigation({ activeTab, onChange, hidden = false, showDrives = false }: AppNavigationProps) {
  const items = navigationItems.filter((item) => item.key !== 'drives' || showDrives);
  const offset = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(offset, {
      toValue: hidden ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [hidden, offset]);

  return (
    <Animated.View
      style={{
        opacity: offset.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
        transform: [
          { translateY: offset.interpolate({ inputRange: [0, 1], outputRange: [0, 120] }) },
        ],
      }}
    >
      <View style={styles.navigationBar}>
        {items.map((item) => {
          const isActive = item.key === activeTab;
          return (
            <TouchableOpacity
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              key={item.key}
              onPress={() => onChange(item.key)}
              style={[styles.navigationItem, isActive && styles.navigationItemActive]}
            >
              <Ionicons name={item.icon} size={20} color={isActive ? '#ffffff' : '#bfdbfe'} />
              {/* Five tabs are tight on a narrow phone: shrink a label rather than wrap it. */}
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
                style={[styles.navigationLabel, isActive && styles.navigationLabelActive]}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </Animated.View>
  );
}
