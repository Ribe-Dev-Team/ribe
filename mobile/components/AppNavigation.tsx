import React, { useEffect, useRef } from 'react';
import { Animated, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import styles from '../styles';

// "Drives" isn't a separate tab: driver mode lives inside My Rides via the rider/driver toggle
export type NavigationTab = 'home' | 'rides' | 'calendar' | 'profile';

interface NavigationItem {
  key: NavigationTab;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const navigationItems: NavigationItem[] = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'rides', label: 'My Rides', icon: 'car' },
  { key: 'calendar', label: 'Calendar', icon: 'calendar' },
  { key: 'profile', label: 'Profile', icon: 'person' },
];

interface AppNavigationProps {
  activeTab: NavigationTab;
  onChange: (tab: NavigationTab) => void;
  hidden?: boolean;
}

export default function AppNavigation({ activeTab, onChange, hidden = false }: AppNavigationProps) {
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
        {navigationItems.map((item) => {
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
              <Text style={[styles.navigationLabel, isActive && styles.navigationLabelActive]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </Animated.View>
  );
}
