import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import styles from '../styles';

type OnboardingProfileData = {
  profilePhotoBase64?: string;
  profilePhotoMimeType?: string;
  degree: string;
  bio: string;
};

type OnboardingPageProps = {
  onComplete: (data: OnboardingProfileData) => Promise<void>;
};

export default function OnboardingPage({ onComplete }: OnboardingPageProps) {
  const [degree, setDegree] = useState('');
  const [bio, setBio] = useState('');
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
        quality: 0.8,
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

    setSaving(true);
    setUploadError(null);

    try {
      await onComplete({
        profilePhotoBase64: profilePhotoBase64 ?? undefined,
        profilePhotoMimeType: profilePhotoMimeType ?? undefined,
        degree: degree.trim(),
        bio: bio.trim(),
      });
    } catch (error) {
      setUploadError('Unable to save your profile right now.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.onboardingScrollView}>
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
    </ScrollView>
  );
}
