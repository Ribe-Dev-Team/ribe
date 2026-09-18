import React, { useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../auth/useAuth';
import styles, { colors } from '../styles';
import PressableScale from '../components/PressableScale';
import { getDriverValidationError } from './schema/user.validation';

interface DriverRegistrationPageProps {
  onDone: () => void;
}

export default function DriverRegistrationPage({ onDone }: DriverRegistrationPageProps) {
  const { profileData, submitting, updateProfileDetails } = useAuth();
  const isDriver = Boolean(profileData?.isDriver);

  const [vehicleMake, setVehicleMake] = useState(profileData?.vehicleMake || '');
  const [vehicleModel, setVehicleModel] = useState(profileData?.vehicleModel || '');
  const [vehicleColor, setVehicleColor] = useState(profileData?.vehicleColor || '');
  const [licensePlate, setLicensePlate] = useState(profileData?.licensePlate || '');
  const [seatsAvailable, setSeatsAvailable] = useState(
    profileData?.seatsAvailable != null ? String(profileData.seatsAvailable) : '2',
  );
  const [driverErr, setDriverErr] = useState('');

  const handleSave = async () => {
    if (submitting) {
      return;
    }

    const validationError = getDriverValidationError({
      isDriver: true,
      vehicleMake,
      vehicleModel,
      vehicleColor,
      licensePlate,
      seatsAvailable,
    });

    if (validationError) {
      setDriverErr(validationError);
      return;
    }

    try {
      await updateProfileDetails({
        isDriver: true,
        vehicleMake: vehicleMake.trim(),
        vehicleModel: vehicleModel.trim(),
        vehicleColor: vehicleColor.trim(),
        licensePlate: licensePlate.trim(),
        seatsAvailable: Number(seatsAvailable),
      });
      setDriverErr('');
      onDone();
    } catch {
      // keep the form open so the user can retry after a failed save
    }
  };

  return (
    <View style={localStyles.pageContainer}>
      <View style={localStyles.fixedHeader}>
        <PressableScale style={localStyles.backButton} onPress={onDone}>
          <Ionicons name="chevron-back" size={24} color={colors.white} />
          <Text style={localStyles.backButtonLabel}>Back</Text>
        </PressableScale>
        <Text style={localStyles.headerTitle}>
          {isDriver ? 'Update driver details' : 'Register as a driver'}
        </Text>
      </View>

      <TouchableWithoutFeedback onPress={() => Keyboard.dismiss()}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView
            contentContainerStyle={localStyles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={localStyles.card}>
              <View style={localStyles.cardTitleRow}>
                <Ionicons name="car-sport-outline" size={16} color={colors.white} />
                <Text style={localStyles.cardTitle}>Vehicle details</Text>
              </View>
              <Text style={localStyles.helperText}>
                This is what passengers see when they book a ride with you, so make sure it's accurate.
              </Text>

              <Text style={styles.profileLabel}>Vehicle make</Text>
              <TextInput
                autoCapitalize="words"
                onChangeText={setVehicleMake}
                placeholder="Honda"
                placeholderTextColor={colors.whiteA40}
                style={styles.editInput}
                value={vehicleMake}
              />

              <Text style={[styles.profileLabel, localStyles.fieldSpacing]}>Vehicle model</Text>
              <TextInput
                autoCapitalize="words"
                onChangeText={setVehicleModel}
                placeholder="Civic"
                placeholderTextColor={colors.whiteA40}
                style={styles.editInput}
                value={vehicleModel}
              />

              <Text style={[styles.profileLabel, localStyles.fieldSpacing]}>Vehicle color</Text>
              <TextInput
                autoCapitalize="words"
                onChangeText={setVehicleColor}
                placeholder="Silver"
                placeholderTextColor={colors.whiteA40}
                style={styles.editInput}
                value={vehicleColor}
              />

              <Text style={[styles.profileLabel, localStyles.fieldSpacing]}>License plate</Text>
              <TextInput
                autoCapitalize="characters"
                onChangeText={setLicensePlate}
                placeholder="1ABC234"
                placeholderTextColor={colors.whiteA40}
                style={styles.editInput}
                value={licensePlate}
              />

              <Text style={[styles.profileLabel, localStyles.fieldSpacing]}>Seats available</Text>
              <TextInput
                keyboardType="number-pad"
                onChangeText={setSeatsAvailable}
                placeholder="2"
                placeholderTextColor={colors.whiteA40}
                style={styles.editInput}
                value={seatsAvailable}
              />

              {driverErr !== '' && <Text style={[styles.errorText, localStyles.fieldSpacing]}>{driverErr}</Text>}
            </View>

            <PressableScale
              disabled={submitting}
              onPress={handleSave}
              style={[localStyles.saveButton, submitting && localStyles.saveButtonDisabled]}
            >
              {submitting ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={localStyles.saveButtonText}>Save</Text>
              )}
            </PressableScale>
          </ScrollView>
        </KeyboardAvoidingView>
      </TouchableWithoutFeedback>
    </View>
  );
}

const localStyles = StyleSheet.create({
  pageContainer: {
    flex: 1,
    backgroundColor: colors.darkBlue,
  },
  fixedHeader: {
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 12,
    backgroundColor: colors.darkBlue,
    borderBottomWidth: 1,
    borderBottomColor: colors.whiteA08,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginBottom: 14,
  },
  backButtonLabel: {
    fontFamily: 'Marcellus_400Regular',
    fontSize: 17,
    color: colors.white,
  },
  headerTitle: {
    fontFamily: 'Marcellus_400Regular',
    fontSize: 22,
    color: colors.white,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 200,
  },
  card: {
    borderRadius: 20,
    padding: 18,
    marginBottom: 14,
    backgroundColor: colors.mediumBlue,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  cardTitle: {
    color: colors.white,
    fontSize: 16,
    fontFamily: 'Marcellus_400Regular',
  },
  helperText: {
    color: colors.whiteA70,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 16,
  },
  fieldSpacing: {
    marginTop: 12,
  },
  saveButton: {
    alignItems: 'center',
    backgroundColor: colors.darkBlue,
    borderWidth: 1,
    borderColor: colors.whiteA25,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 4,
  },
  saveButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
});
