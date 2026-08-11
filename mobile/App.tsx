import React, { useState } from 'react';
import { SafeAreaView, View, Text, TouchableOpacity } from 'react-native';
import HomePage from './pages/HomePage';
import CalendarPage from './pages/CalendarPage';
import RidesPage from './pages/RidesPage';
import DrivesPage from './pages/DrivesPage';
import ProfilePage from './pages/ProfilePage';
import styles from './styles';

const tabs = [
  { key: 'home', label: 'Home' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'rides', label: 'Rides' },
  { key: 'drives', label: 'Drives' },
  { key: 'profile', label: 'Profile' },
] as const;

type TabKey = (typeof tabs)[number]['key'];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('home');

  const renderPage = () => {
    switch (activeTab) {
      case 'calendar':
        return <CalendarPage />;
      case 'rides':
        return <RidesPage />;
      case 'drives':
        return <DrivesPage />;
      case 'profile':
        return <ProfilePage />;
      default:
        return <HomePage />;
    }
  };

  return (
    <SafeAreaView style={styles.appContainer}>
      <View style={{ flex: 1 }}>
        {renderPage()}
      </View>

      <View style={styles.bottomNav}>
        {tabs.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[
                styles.navButton,
                isActive ? styles.navButtonActive : styles.navButtonInactive,
              ]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Text
                style={[
                  styles.navButtonText,
                  isActive ? styles.navButtonTextActive : null,
                ]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </SafeAreaView>
  );
}
