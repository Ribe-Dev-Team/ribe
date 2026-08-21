import React from 'react';
import { Pressable, Text, View } from 'react-native';
import styles from '../styles';

export type NavigationTab = 'home' | 'calendar' | 'rides' | 'drives' | 'profile';

interface NavigationItem {
  key: NavigationTab;
  label: string;
  icon: string;
}

const navigationItems: NavigationItem[] = [
  { key: 'home', label: 'Home', icon: '⌂' },
  { key: 'rides', label: 'My Rides', icon: '▣' },
  { key: 'calendar', label: 'Calendar', icon: '▦' },
  { key: 'profile', label: 'Profile', icon: '♙' },
];

interface AppNavigationProps {
  activeTab: NavigationTab;
  onChange: (tab: NavigationTab) => void;
}

export default function AppNavigation({ activeTab, onChange }: AppNavigationProps) {
  return (
    <View style={styles.navigationBar}>
      {navigationItems.map((item) => {
        const isActive = item.key === activeTab;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            key={item.key}
            onPress={() => onChange(item.key)}
            style={[styles.navigationItem, isActive && styles.navigationItemActive]}
          >
            {/* <Text style={styles.navigationIcon}>{item.icon}</Text> */}
            <Text style={styles.navigationLabel}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}