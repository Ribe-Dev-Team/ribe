import { StyleSheet, Text, View } from 'react-native';

const API_URL = 'http://127.0.0.1:3000'; //aka local host

export default function App() {

  return (
    //temporary page contents
    <View style={styles.container}>
      <Text style={styles.title}>Ribe</Text>
      <Text style={styles.subtitle}>A mobile web app shell</Text>
    </View>
  );
}

//temporary styling - in future we should use separate style sheet files
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
});
