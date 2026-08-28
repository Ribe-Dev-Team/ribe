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

import { useAuth } from '../auth/useAuth';
import styles from '../styles';

export default function ProfilePage() {
  const { user, profileData, submitting, updateProfileDetails } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [degree, setDegree] = useState(profileData?.degree || '');
  const [bio, setBio] = useState(profileData?.bio || '');
  const [profilePhotoUri, setProfilePhotoUri] = useState<string | null>(profileData?.profilePhotoUrl || null);
  const [profilePhotoBase64, setProfilePhotoBase64] = useState<string | null>(null);
  const [profilePhotoMimeType, setProfilePhotoMimeType] = useState<string | null>(null);

  const profileName = profileData?.name || user?.displayName || 'Your name';
  const profileEmail = profileData?.email || user?.email || 'No email added';
  const profileDob = profileData?.dob || 'Not added';

  const openImagePicker = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.3, 
        base64: true,
      });

      if (!result.canceled && result.assets?.[0]) {
        setProfilePhotoUri(result.assets[0].uri ?? profileData?.profilePhotoUrl ?? null);
        setProfilePhotoBase64(result.assets[0].base64 ?? null);
        setProfilePhotoMimeType(result.assets[0].mimeType ?? null);
      }
    } catch {
      // Ignore picker errors here; UI can remain unchanged.
    }
  };

  const handleSave = async () => {

    if (submitting) {
      return;
    }

    try {
      await updateProfileDetails({
        profilePhotoBase64: profilePhotoBase64 ?? undefined,
        profilePhotoMimeType: profilePhotoMimeType ?? undefined,
        degree: degree.trim(),
        bio: bio.trim(),
      });
      setIsEditing(false);
    } catch (error) {
      // keep the edit screen open so the user can retry after a failed save
    }
  };

  const handleCancel = () => {
    setDegree(profileData?.degree || '');
    setBio(profileData?.bio || '');
    setProfilePhotoUri(profileData?.profilePhotoUrl || null);
    setProfilePhotoBase64(null);
    setProfilePhotoMimeType(null);
    setIsEditing(false);
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
      style={{ flex: 1 }}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0} 
    >
      <ScrollView 
        contentContainerStyle={styles.profileScrollView}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag" // <-- Added this so dragging down also closes the keyboard
      >
        {/* Wrapped the main card in TouchableWithoutFeedback */}
        <TouchableWithoutFeedback onPress={() => Keyboard.dismiss()}>
          <View style={styles.profileCard}>
            {!isEditing ? (
              <Pressable onPress={() => setIsEditing(true)} style={styles.editButton}>
                <Text style={styles.editButtonText}>Edit</Text>
              </Pressable>
            ) : null}

            {profilePhotoUri ? (
              <Image source={{ uri: profilePhotoUri }} style={styles.profilePhoto} />
            ) : (
              <View style={styles.profilePhotoPlaceholder}>
                <Text style={styles.profilePhotoPlaceholderText}>No photo</Text>
              </View>
            )}

            <Text style={styles.profileName}>{profileName}</Text>
            <Text style={styles.profileEmail}>{profileEmail}</Text>

            <View style={styles.profileInfoBlock}>
              <Text style={styles.profileLabel}>Date of birth</Text>
              <Text style={styles.profileValue}>{profileDob}</Text>
            </View>

            {isEditing ? (
              <>
                <Pressable onPress={openImagePicker} style={styles.avatarUploadButton}>
                  <Text style={styles.avatarUploadText}>Change photo</Text>
                </Pressable>

                <View style={styles.profileInfoBlock}>
                  <Text style={styles.profileLabel}>Degree</Text>
                  <TextInput
                    autoCapitalize="words"
                    onChangeText={setDegree}
                    placeholder="Bachelor of Science in Computer Science"
                    style={styles.editInput}
                    value={degree}
                  />
                </View>

                <View style={styles.profileInfoBlock}>
                  <Text style={styles.profileLabel}>Bio</Text>
                  <TextInput
                    multiline
                    numberOfLines={4}
                    onChangeText={setBio}
                    placeholder="Write a short bio about yourself..."
                    style={styles.editBioInput}
                    textAlignVertical="top"
                    value={bio}
                  />
                </View>

                <View style={styles.editActionsRow}>
                  <Pressable onPress={handleCancel} style={[styles.secondaryButton]}>
                    <Text style={styles.secondaryButtonText}>Cancel</Text>
                  </Pressable>

                  <Pressable onPress={handleSave} style={[styles.primaryButton, submitting && styles.primaryButtonDisabled]}>
                    {submitting ? (
                      <ActivityIndicator color="#ffffff" />
                    ) : (
                      <Text style={styles.primaryButtonText}>Save</Text>
                    )}
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <View style={styles.profileInfoBlock}>
                  <Text style={styles.profileLabel}>Degree</Text>
                  <Text style={styles.profileValue}>{profileData?.degree || 'Not added'}</Text>
                </View>

                <View style={styles.profileInfoBlock}>
                  <Text style={styles.profileLabel}>Bio</Text>
                  <Text style={styles.profileValue}>{profileData?.bio || 'No bio yet'}</Text>
                </View>
              </>
            )}
          </View>
        </TouchableWithoutFeedback>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}