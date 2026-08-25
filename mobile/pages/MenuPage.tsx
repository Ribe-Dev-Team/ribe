import React, { useState } from 'react';
import {
  StatusBar,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import styles from '../styles';

import HomePage from './HomePage';
import CalendarPage from './CalendarPage';
import RidesPage from './RidesPage';
import DrivesPage from './DrivesPage';
import ProfilePage from './ProfilePage';

import { useAuth } from '../auth/useAuth';

/*
Parent container of all main menu pages
- ensures consistent formatting and handling of tabs and common features
*/

// Define tabs for the bottom navigation
type TabKey = 'home' | 'calendar' | 'rides' | 'drives' | 'profile';
const tabs: { key: TabKey; label: string; }[] = [
  { key: 'home', label: 'Home' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'rides', label: 'Rides' },
  { key: 'drives', label: 'Drives' },
  { key: 'profile', label: 'Profile' },
];

export function MenuPage(): React.JSX.Element {
  // Navigation State
  const [activeTab, setActiveTab] = useState<TabKey>('home');

  const {
    user,
    handleLogout,
  } = useAuth();

  // Routing table for all 'main menu' pages/options
  const renderPage = () => {
    switch (activeTab) {
      case 'calendar':
        return CalendarPage();
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
    <SafeAreaProvider style={ styles.appContainer }>

      {/* Page Header */ }
      <StatusBar barStyle="dark-content" />
      <View style={ styles.header }>
        <Text style={ styles.headerText }>Hi, { user?.displayName || user?.email }</Text>;
        <TouchableOpacity onPress={ handleLogout }>
          <Text style={ styles.logoutText }>Sign out</Text>
        </TouchableOpacity>
      </View>

      {/* Page Body */ }
      < View style={ styles.contentContainer } > { renderPage() }</View >

      {/* Page Footer / Navigation Bar */ }
      <View style={ styles.bottomNav }>
        { tabs.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <TouchableOpacity
              key={ tab.key }
              style={ [
                styles.navButton,
                isActive ? styles.navButtonActive : styles.navButtonInactive,
              ] }
              onPress={ () => setActiveTab(tab.key) }
            >
              <Text
                style={ [
                  styles.navButtonText,
                  isActive ? styles.navButtonTextActive : null,
                ] }
              >
                { tab.label }
              </Text>
            </TouchableOpacity>
          );
        }) }
      </View>
    </SafeAreaProvider>
  );
}