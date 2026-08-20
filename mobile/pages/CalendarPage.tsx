import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import PageScreen from './PageScreen';
import styles from '../styles';

export default function CalendarPage(): React.JSX.Element {

  const page1 = (
    <View>
      <Text>Are you heading to uni?</Text>
      <Pressable>Yes</Pressable>
      <Pressable>No</Pressable>
    </View>
  );

  const page2a = (
    <View>
      <Text>Enter pick up address:</Text>
      <TextInput />
    </View>
  );

  const page2b = (
    <View>
      <Text>Enter destination address:</Text>
      <TextInput />
    </View>
  );

  const page3 = (
    <View>
      <Text>What date would you like to travel?</Text>
      <TextInput />
      <Text>Earliest Departure:</Text>
      <TextInput />
      <Text>Latest Arrival:</Text>
      <TextInput />
    </View>
  );

  const page4 = (
    <View>
      <Text>Request sent!</Text>
    </View>
  );

  return (
    <View style={ styles.appContainer }>
      {/* <PageScreen title="Calendar" subtitle="INSERT CALENDAR PAGE" /> */ }
      <Text style={ styles.title }>Calendarr</Text>
      { page1 }
    </View>
  );
}
