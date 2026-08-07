import { useEffect, useState } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, Text, View } from 'react-native';

const API_URL = 'http://127.0.0.1:3000';

export default function App() {
  const [status, setStatus] = useState<'loading' | 'connected' | 'error'>('loading');

  useEffect(() => {
    const controller = new AbortController();

    fetch(`${API_URL}/api/health`, { signal: controller.signal })
      .then((response) => response.json())
      .then(() => setStatus('connected'))
      .catch(() => setStatus('error'));

    return () => controller.abort();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Ribe</Text>
      <Text style={styles.subtitle}>A mobile web app shell</Text>

      <View style={styles.statusBox}>
        {status === 'loading' ? (
          <ActivityIndicator color="#2563eb" />
        ) : (
          <Text style={status === 'connected' ? styles.connected : styles.error}>
            {status === 'connected' ? 'Meteor backend connected' : 'Backend unavailable'}
          </Text>
        )}
      </View>

      <StatusBar barStyle="dark-content" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 42,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#475569',
    marginBottom: 20,
  },
  statusBox: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
  },
  connected: {
    color: '#166534',
    fontWeight: '600',
  },
  error: {
    color: '#b91c1c',
    fontWeight: '600',
  },
});
