import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import PageScreen from './PageScreen';
import styles from '../styles';

interface ProfilePageProps {
  onLogout: () => void;
}

export default function ProfilePage({ onLogout }: ProfilePageProps) {
  return (
    <PageScreen title="Profile" subtitle="View and edit your Ribe account details.">
      <View style={{ marginTop: 24 }}>
        <TouchableOpacity onPress={onLogout}>
          <Text style={styles.linkText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </PageScreen>
  );
}
