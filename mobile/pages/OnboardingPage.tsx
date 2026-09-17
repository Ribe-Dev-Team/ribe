import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView, 
  Platform,             
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  TouchableWithoutFeedback,
  Keyboard, // <-- Added Keyboard here
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import styles from '../styles';

type OnboardingProfileData = {
  profilePhotoBase64?: string;
  profilePhotoMimeType?: string;
  degree: string;
  bio: string;
  isDriver?: boolean;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleColor?: string;
  licensePlate?: string;
  seatsAvailable?: number;
};

type OnboardingPageProps = {
  onComplete: (data: OnboardingProfileData) => Promise<void>;
};

export default function OnboardingPage({ onComplete }: OnboardingPageProps) {
  const [degree, setDegree] = useState('');
  const [bio, setBio] = useState('');
  const [isDriver, setIsDriver] = useState<boolean | null>(null);
  const [vehicleMake, setVehicleMake] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleColor, setVehicleColor] = useState('');
  const [licensePlate, setLicensePlate] = useState('');
  const [seatsAvailable, setSeatsAvailable] = useState('2');
  const [profilePhotoUri, setProfilePhotoUri] = useState<string | null>(null);
  const [profilePhotoBase64, setProfilePhotoBase64] = useState<string | null>(null);
  const [profilePhotoMimeType, setProfilePhotoMimeType] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const pickImage = async () => {
    setUploadError(null);

    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permissionResult.granted) {
        setUploadError('Permission is required to upload a profile photo.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.3, // <-- Lowered to 0.3 for Firestore size limits
        base64: true,
      });

      if (!result.canceled && result.assets?.[0]) {
        setProfilePhotoUri(result.assets[0].uri ?? null);
        setProfilePhotoBase64(result.assets[0].base64 ?? null);
        setProfilePhotoMimeType(result.assets[0].mimeType ?? null);
      }
    } catch (error) {
      setUploadError('Unable to access your photo library right now.');
    }
  };

  const handleSubmit = async () => {
    if (saving) return;

    const driverConfig = isDriver === true
      ? {
          vehicleMake: vehicleMake.trim(),
          vehicleModel: vehicleModel.trim(),
          vehicleColor: vehicleColor.trim(),
          licensePlate: licensePlate.trim(),
          seatsAvailable: Number(seatsAvailable),
        }
      : {};

    if (isDriver === true) {
      if (!driverConfig.vehicleMake || !driverConfig.vehicleModel || !driverConfig.vehicleColor || !driverConfig.licensePlate) {
        setUploadError('Please fill in all vehicle details before finishing setup.');
        return;
      }

      if (!Number.isFinite(driverConfig.seatsAvailable) || driverConfig.seatsAvailable < 1) {
        setUploadError('Please enter a valid number of seats available.');
        return;
      }
    }

    setSaving(true);
    setUploadError(null);

    try {
      await onComplete({
        profilePhotoBase64: profilePhotoBase64 ?? undefined,
        profilePhotoMimeType: profilePhotoMimeType ?? undefined,
        degree: degree.trim(),
        bio: bio.trim(),
        isDriver: isDriver ?? false,
        ...driverConfig,
      });
    } catch (error) {
      setUploadError('Unable to save your profile right now.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
      style={{ flex: 1 }}
    >
      <ScrollView 
        contentContainerStyle={styles.onboardingScrollView}
        keyboardShouldPersistTaps="handled" 
        keyboardDismissMode="on-drag" // <-- Added this as a bonus so scrolling also dismisses it!
      >
        {/* Wrapped the main card in TouchableWithoutFeedback */}
        <TouchableWithoutFeedback onPress={() => Keyboard.dismiss()}>
          <View style={styles.onboardingCard}>
            <Text style={styles.onboardingTitle}>Set up your profile</Text>
            <Text style={styles.onboardingSubtitle}>
              Add a few details to personalize your account. Everything here is optional.
            </Text>

            <Pressable onPress={pickImage} style={styles.avatarUploadButton}>
              {profilePhotoUri ? (
                <Image source={{ uri: profilePhotoUri }} style={styles.avatarPreview} />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Text style={styles.avatarPlaceholderText}>Add photo</Text>
                </View>
              )}
            </Pressable>

            {uploadError ? <Text style={styles.errorText}>{uploadError}</Text> : null}

            <Text style={styles.fieldLabel}>Are you a driver?</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
              <Pressable
                onPress={() => setIsDriver(true)}
                style={{
                  flex: 1,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: isDriver === true ? '#2563eb' : '#cbd5e1',
                  backgroundColor: isDriver === true ? '#dbeafe' : '#ffffff',
                  paddingVertical: 12,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: isDriver === true ? '#1d4ed8' : '#334155', fontWeight: '600' }}>Yes</Text>
              </Pressable>
              <Pressable
                onPress={() => setIsDriver(false)}
                style={{
                  flex: 1,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: isDriver === false ? '#2563eb' : '#cbd5e1',
                  backgroundColor: isDriver === false ? '#dbeafe' : '#ffffff',
                  paddingVertical: 12,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: isDriver === false ? '#1d4ed8' : '#334155', fontWeight: '600' }}>No</Text>
              </Pressable>
            </View>

            <Text style={styles.fieldLabel}>Degree</Text>
            <TextInput
              autoCapitalize="words"
              onChangeText={setDegree}
              placeholder="Bachelor of Science in Computer Science"
              style={styles.input}
              value={degree}
            />

            <Text style={styles.fieldLabel}>Short bio</Text>
            <TextInput
              multiline
              numberOfLines={4}
              onChangeText={setBio}
              placeholder="Write a short bio about yourself..."
              style={styles.bioInput}
              textAlignVertical="top"
              value={bio}
            />

            {isDriver === true ? (
              <View>
                <Text style={styles.fieldLabel}>Vehicle make</Text>
                <TextInput
                  autoCapitalize="words"
                  onChangeText={setVehicleMake}
                  placeholder="Honda"
                  style={styles.input}
                  value={vehicleMake}
                />

                <Text style={styles.fieldLabel}>Vehicle model</Text>
                <TextInput
                  autoCapitalize="words"
                  onChangeText={setVehicleModel}
                  placeholder="Civic"
                  style={styles.input}
                  value={vehicleModel}
                />

                <Text style={styles.fieldLabel}>Vehicle color</Text>
                <TextInput
                  autoCapitalize="words"
                  onChangeText={setVehicleColor}
                  placeholder="Silver"
                  style={styles.input}
                  value={vehicleColor}
                />

                <Text style={styles.fieldLabel}>License plate</Text>
                <TextInput
                  autoCapitalize="characters"
                  onChangeText={setLicensePlate}
                  placeholder="1ABC234"
                  style={styles.input}
                  value={licensePlate}
                />

                <Text style={styles.fieldLabel}>Seats available</Text>
                <TextInput
                  keyboardType="number-pad"
                  onChangeText={setSeatsAvailable}
                  placeholder="2"
                  style={styles.input}
                  value={seatsAvailable}
                />
              </View>
            ) : null}

            <Pressable
              disabled={saving}
              onPress={handleSubmit}
              style={[styles.primaryButton, saving && styles.primaryButtonDisabled]}
            >
              {saving ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.primaryButtonText}>Finish setup</Text>
              )}
            </Pressable>
          </View>
        </TouchableWithoutFeedback>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}