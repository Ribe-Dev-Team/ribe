import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  TouchableWithoutFeedback,
  Keyboard,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../auth/useAuth';
import styles, { colors } from '../styles';

interface ProfilePageProps {
  onLogout: () => void;
}

const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

export default function ProfilePage({ onLogout }: ProfilePageProps) {
  const { user, profileData, submitting, updateProfileDetails } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [degree, setDegree] = useState(profileData?.degree || '');
  const [bio, setBio] = useState(profileData?.bio || '');
  const [profilePhotoUri, setProfilePhotoUri] = useState<string | null>(profileData?.profilePhotoUrl || null);
  const [profilePhotoBase64, setProfilePhotoBase64] = useState<string | null>(null);
  const [profilePhotoMimeType, setProfilePhotoMimeType] = useState<string | null>(null);
  // Local-only for now - no backend field yet, follow-up work once profile schema supports it
  const [driverMode, setDriverMode] = useState(false);
  const [campusDays, setCampusDays] = useState<string[]>([]);

  const toggleCampusDay = (day: string) => {
    setCampusDays((current) =>
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day],
    );
  };

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
    } catch {
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
        keyboardDismissMode="on-drag"
      >
        <TouchableWithoutFeedback onPress={() => Keyboard.dismiss()}>
          <View>
            <Text style={localStyles.pageTitle}>Profile</Text>

            <View style={styles.profileCard}>
              {!isEditing ? (
                <Pressable onPress={() => setIsEditing(true)} style={styles.editButton}>
                  <Text style={styles.editButtonText}>Edit</Text>
                </Pressable>
              ) : null}

              <View style={localStyles.photoWrap}>
                {profilePhotoUri ? (
                  <Image source={{ uri: profilePhotoUri }} style={styles.profilePhoto} />
                ) : (
                  <View style={styles.profilePhotoPlaceholder}>
                    <Text style={styles.profilePhotoPlaceholderText}>No photo</Text>
                  </View>
                )}
                {isEditing && (
                  <Pressable
                    accessibilityLabel="Change photo"
                    onPress={openImagePicker}
                    style={localStyles.editPhotoBadge}
                  >
                    <Ionicons name="pencil" size={14} color={colors.darkBlue} />
                  </Pressable>
                )}
              </View>

              <Text style={styles.profileName}>{profileName}</Text>
              <Text style={styles.profileEmail}>{profileEmail}</Text>

              <View style={styles.profileInfoBlock}>
                <Text style={styles.profileLabel}>Date of birth</Text>
                <Text style={styles.profileValue}>{profileDob}</Text>
              </View>

              {isEditing ? (
                <>
                  <View style={styles.profileInfoBlock}>
                    <Text style={styles.profileLabel}>Degree</Text>
                    <TextInput
                      autoCapitalize="words"
                      onChangeText={setDegree}
                      placeholder="Bachelor of Science in Computer Science"
                      placeholderTextColor="rgba(255,255,255,0.4)"
                      style={styles.editInput}
                      value={degree}
                    />
                  </View>

                  <View style={styles.profileInfoBlock}>
                    <Text style={styles.profileLabel}>Bio</Text>
                    <TextInput
                      maxLength={200}
                      multiline
                      numberOfLines={4}
                      onChangeText={setBio}
                      placeholder="Write a short bio about yourself..."
                      placeholderTextColor="rgba(255,255,255,0.4)"
                      style={styles.editBioInput}
                      textAlignVertical="top"
                      value={bio}
                    />
                    <Text style={localStyles.charCount}>{bio.length} / 200</Text>
                  </View>

                  <View style={styles.editActionsRow}>
                    <Pressable onPress={handleCancel} style={styles.secondaryButton}>
                      <Text style={styles.secondaryButtonText}>Cancel</Text>
                    </Pressable>

                    <Pressable
                      onPress={handleSave}
                      style={[styles.primaryButton, submitting && styles.primaryButtonDisabled]}
                    >
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

              <View style={styles.profileInfoBlock}>
                <Text style={styles.profileLabel}>On campus</Text>
                <View style={localStyles.daysRow}>
                  {weekdays.map((day) => {
                    const active = campusDays.includes(day);
                    return (
                      <Pressable
                        key={day}
                        onPress={() => toggleCampusDay(day)}
                        style={[localStyles.dayPill, active && localStyles.dayPillActive]}
                      >
                        <Text style={[localStyles.dayPillText, active && localStyles.dayPillTextActive]}>{day}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={[styles.profileInfoBlock, localStyles.driverModeRow]}>
                <View style={localStyles.driverModeCopy}>
                  <View style={localStyles.driverModeTitleRow}>
                    <Ionicons name="car-sport-outline" size={16} color={colors.white} />
                    <Text style={localStyles.driverModeTitle}>Driver mode</Text>
                  </View>
                  <Text style={localStyles.driverModeSubtitle}>
                    {driverMode ? 'Honda Civic - 1ABC234' : 'Add your vehicle details to start driving'}
                  </Text>
                </View>
                <Switch
                  value={driverMode}
                  onValueChange={setDriverMode}
                  trackColor={{ false: 'rgba(255,255,255,0.3)', true: colors.confirmed }}
                  thumbColor={colors.white}
                />
              </View>
            </View>

            <TouchableOpacity onPress={onLogout} style={localStyles.signOutButton}>
              <Text style={localStyles.signOutText}>Sign out</Text>
            </TouchableOpacity>
          </View>
        </TouchableWithoutFeedback>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const localStyles = StyleSheet.create({
  pageTitle: {
    fontFamily: 'Marcellus_400Regular',
    fontSize: 28,
    color: colors.white,
    marginBottom: 20,
  },
  photoWrap: {
    alignSelf: 'center',
    marginBottom: 4,
  },
  editPhotoBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.mediumBlue,
  },
  daysRow: {
    flexDirection: 'row',
    gap: 6,
  },
  dayPill: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  dayPillActive: {
    backgroundColor: colors.white,
  },
  dayPillText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '600',
  },
  dayPillTextActive: {
    color: colors.mediumBlue,
  },
  driverModeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  driverModeCopy: {
    flex: 1,
    marginRight: 12,
  },
  driverModeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  driverModeTitle: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
  driverModeSubtitle: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
  },
  charCount: {
    alignSelf: 'flex-end',
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    marginTop: 4,
  },
  signOutButton: {
    marginTop: 20,
    alignSelf: 'center',
  },
  signOutText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    fontWeight: '600',
  },
});
