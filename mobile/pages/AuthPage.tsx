import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import styles, { colors } from '../styles';
import DatePickerModal from '../components/DatePickerModal';
import PressableScale from '../components/PressableScale';
import {
  isValidDob,
  isValidEmail,
  isValidName,
  isValidPassword,
  isValidPhoneNumber,
} from './schema/user.validation';

interface SignupProfileExtras {
  profilePhotoBase64?: string;
  profilePhotoMimeType?: string;
  degree?: string;
  bio?: string;
  isDriver?: boolean;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleColor?: string;
  licensePlate?: string;
  seatsAvailable?: number;
}

interface AuthPageProps {
  mode: 'login' | 'signup';
  submitting: boolean;
  error: string | null;
  name: string;
  dob: string;
  phoneNumber: string;
  email: string;
  password: string;
  confirmPassword: string;
  setName: (value: string) => void;
  setDob: (value: string) => void;
  setPhoneNumber: (value: string) => void;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  setConfirmPassword: (value: string) => void;
  clearError: () => void;
  toggleMode: () => void;
  handleLogin: () => Promise<void>;
  handleSignup: (extra?: SignupProfileExtras) => Promise<void>;
}

type SignupStep = 'about' | 'account' | 'profile' | 'driver' | 'confirm';
type FieldName =
  | 'name'
  | 'phone'
  | 'email'
  | 'password'
  | 'confirm'
  | 'degree'
  | 'bio'
  | 'vehicleMake'
  | 'vehicleModel'
  | 'vehicleColor'
  | 'licensePlate'
  | 'seatsAvailable';

const signupStepLabels: Record<SignupStep, string> = {
  about: 'Step 1 of 5 · About you',
  account: 'Step 2 of 5 · Account',
  profile: 'Step 3 of 5 · Profile',
  driver: 'Step 4 of 5 · Driver details',
  confirm: 'Step 5 of 5 · Confirm & submit',
};

// dob is stored/validated as DD/MM/YYYY (see isValidDob), unlike the DD-MM-YYYY
// used elsewhere for bookings, so it needs its own small format helpers here.
function formatDobToStr(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getFullYear()}`;
}

function parseDobAsDate(value: string): Date | undefined {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return undefined;
  const [, day, month, year] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export default function AuthPage({
  mode,
  submitting,
  error,
  name,
  dob,
  phoneNumber,
  email,
  password,
  confirmPassword,
  setName,
  setDob,
  setPhoneNumber,
  setEmail,
  setPassword,
  setConfirmPassword,
  clearError,
  toggleMode,
  handleLogin,
  handleSignup,
}: AuthPageProps) {
  const [signupStep, setSignupStep] = useState<SignupStep>('about');
  const [dobPickerVisible, setDobPickerVisible] = useState(false);
  const [focusedField, setFocusedField] = useState<FieldName | null>(null);
  const [nameErr, setNameErr] = useState('');
  const [dobErr, setDobErr] = useState('');
  const [phoneErr, setPhoneErr] = useState('');
  const [emailErr, setEmailErr] = useState('');
  const [passwordErr, setPasswordErr] = useState('');
  const [confirmErr, setConfirmErr] = useState('');

  const [degree, setDegree] = useState('');
  const [bio, setBio] = useState('');
  const [profilePhotoUri, setProfilePhotoUri] = useState<string | null>(null);
  const [profilePhotoBase64, setProfilePhotoBase64] = useState<string | null>(null);
  const [profilePhotoMimeType, setProfilePhotoMimeType] = useState<string | null>(null);
  const [photoErr, setPhotoErr] = useState('');

  const [isDriver, setIsDriver] = useState<boolean | null>(null);
  const [vehicleMake, setVehicleMake] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleColor, setVehicleColor] = useState('');
  const [licensePlate, setLicensePlate] = useState('');
  const [seatsAvailable, setSeatsAvailable] = useState('2');
  const [driverErr, setDriverErr] = useState('');

  // Always land on the first step when (re-)entering signup mode.
  useEffect(() => {
    if (mode === 'signup') setSignupStep('about');
  }, [mode]);

  const maxDob = useMemo(() => {
    const date = new Date();
    date.setFullYear(date.getFullYear() - 18);
    return date;
  }, []);
  // Year list in the picker starts from 1950 - old enough to cover any real signup, without
  // an unbounded scroll back through every year since 1900.
  const minDob = useMemo(() => new Date(1950, 0, 1), []);
  const defaultDobView = useMemo(() => new Date(2000, 0, 1), []);

  const validateAboutStep = (): boolean => {
    let valid = true;

    if (!isValidName(name.trim())) {
      setNameErr('Please enter your full name.');
      valid = false;
    } else setNameErr('');

    if (!isValidDob(dob.trim())) {
      setDobErr('Please select a date of birth. You must be at least 18 years old.');
      valid = false;
    } else setDobErr('');

    if (!isValidPhoneNumber(phoneNumber.trim())) {
      setPhoneErr('Please enter a valid phone number.');
      valid = false;
    } else setPhoneErr('');

    return valid;
  };

  const validateAccountStep = (): boolean => {
    let valid = true;

    if (!isValidEmail(email.trim())) {
      setEmailErr('Enter a valid email address.');
      valid = false;
    } else setEmailErr('');

    if (!isValidPassword(password)) {
      setPasswordErr('Use 8+ characters with upper and lower case letters and a number.');
      valid = false;
    } else setPasswordErr('');

    if (!confirmPassword || password !== confirmPassword) {
      setConfirmErr('Passwords do not match.');
      valid = false;
    } else setConfirmErr('');

    return valid;
  };

  const pickProfilePhoto = async () => {
    setPhotoErr('');

    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permissionResult.granted) {
        setPhotoErr('Permission is required to upload a profile photo.');
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
        setProfilePhotoUri(result.assets[0].uri ?? null);
        setProfilePhotoBase64(result.assets[0].base64 ?? null);
        setProfilePhotoMimeType(result.assets[0].mimeType ?? null);
      }
    } catch {
      setPhotoErr('Unable to access your photo library right now.');
    }
  };

  const goToAccountStep = () => {
    if (error) clearError();
    if (validateAboutStep()) setSignupStep('account');
  };

  const goToProfileStep = () => {
    if (error) clearError();
    if (validateAccountStep()) setSignupStep('profile');
  };

  const validateDriverStep = (): boolean => {
    if (isDriver !== true) {
      setDriverErr('');
      return true;
    }

    if (!vehicleMake.trim() || !vehicleModel.trim() || !vehicleColor.trim() || !licensePlate.trim()) {
      setDriverErr('Please fill in all vehicle details.');
      return false;
    }

    if (!Number.isInteger(Number(seatsAvailable)) || Number(seatsAvailable) < 1) {
      setDriverErr('Please enter a valid number of seats available.');
      return false;
    }

    setDriverErr('');
    return true;
  };

  const goToDriverStep = () => {
    if (error) clearError();
    setSignupStep('driver');
  };

  const goToConfirmStep = () => {
    if (error) clearError();
    if (validateDriverStep()) setSignupStep('confirm');
  };

  const submitSignup = () => {
    handleSignup({
      profilePhotoBase64: profilePhotoBase64 ?? undefined,
      profilePhotoMimeType: profilePhotoMimeType ?? undefined,
      degree: degree.trim() || undefined,
      bio: bio.trim() || undefined,
      isDriver: isDriver ?? false,
      ...(isDriver === true
        ? {
            vehicleMake: vehicleMake.trim(),
            vehicleModel: vehicleModel.trim(),
            vehicleColor: vehicleColor.trim(),
            licensePlate: licensePlate.trim(),
            seatsAvailable: Number(seatsAvailable),
          }
        : {}),
    });
  };

  const signupProgress = (
    <View style={localStyles.progressBlock}>
      <View style={localStyles.progressRow}>
        <View style={[localStyles.progressSegment, localStyles.progressSegmentActive]} />
        <View style={[localStyles.progressSegment, signupStep !== 'about' && localStyles.progressSegmentActive]} />
        <View
          style={[
            localStyles.progressSegment,
            (signupStep === 'profile' || signupStep === 'driver' || signupStep === 'confirm') &&
              localStyles.progressSegmentActive,
          ]}
        />
        <View
          style={[
            localStyles.progressSegment,
            (signupStep === 'driver' || signupStep === 'confirm') && localStyles.progressSegmentActive,
          ]}
        />
        <View style={[localStyles.progressSegment, signupStep === 'confirm' && localStyles.progressSegmentActive]} />
      </View>
      <Text style={localStyles.progressLabel}>{signupStepLabels[signupStep]}</Text>
    </View>
  );

  if (mode === 'signup') {
    const onBack =
      signupStep === 'about'
        ? toggleMode
        : signupStep === 'account'
        ? () => setSignupStep('about')
        : signupStep === 'profile'
        ? () => setSignupStep('account')
        : signupStep === 'driver'
        ? () => setSignupStep('profile')
        : () => setSignupStep('driver');
    const backLabel = signupStep === 'about' ? 'Log-In' : 'Back';

    return (
      <View style={localStyles.pageContainer}>
        <StatusBar barStyle="light-content" />
        <View style={localStyles.fixedHeader}>
          <PressableScale style={localStyles.backButton} onPress={onBack}>
            <Ionicons name="chevron-back" size={24} color={colors.white} />
            <Text style={localStyles.backButtonLabel}>{backLabel}</Text>
          </PressableScale>
          <Text style={localStyles.headerTitle}>Create New Account</Text>
          {signupProgress}
        </View>

        <TouchableWithoutFeedback onPress={() => Keyboard.dismiss()}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <ScrollView
              contentContainerStyle={localStyles.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {signupStep === 'about' && (
                <View style={localStyles.card}>
                  <Text style={localStyles.cardLabel}>Personal details</Text>

                  <Text style={localStyles.fieldLabel}>Full name</Text>
                  <TextInput
                    autoCapitalize="words"
                    onBlur={() => setFocusedField(null)}
                    onChangeText={(value) => {
                      setName(value);
                      if (error) clearError();
                    }}
                    onFocus={() => setFocusedField('name')}
                    placeholder="Jane Doe"
                    placeholderTextColor="rgba(255,255,255,0.4)"
                    style={[localStyles.fieldInput, focusedField === 'name' && localStyles.fieldInputFocused]}
                    value={name}
                  />
                  {nameErr !== '' && <Text style={[styles.errorText, styles.errorTextOnDark]}>{nameErr}</Text>}

                  <Text style={[localStyles.fieldLabel, { marginTop: 12 }]}>Date of birth</Text>
                  <PressableScale
                    onPress={() => setDobPickerVisible(true)}
                    style={[localStyles.fieldInput, localStyles.pickerField, dobPickerVisible && localStyles.fieldInputFocused]}
                  >
                    <Text style={dob ? localStyles.pickerValueText : localStyles.pickerPlaceholderText}>
                      {dob || 'DD/MM/YYYY'}
                    </Text>
                    <Ionicons color="rgba(255,255,255,0.6)" name="calendar-outline" size={18} />
                  </PressableScale>
                  {dobErr !== '' && <Text style={[styles.errorText, styles.errorTextOnDark]}>{dobErr}</Text>}

                  <Text style={[localStyles.fieldLabel, { marginTop: 12 }]}>Phone number</Text>
                  <TextInput
                    autoCapitalize="none"
                    keyboardType="phone-pad"
                    onBlur={() => setFocusedField(null)}
                    onChangeText={(value) => {
                      setPhoneNumber(value);
                      if (error) clearError();
                    }}
                    onFocus={() => setFocusedField('phone')}
                    placeholder="04XX XXX XXX"
                    placeholderTextColor="rgba(255,255,255,0.4)"
                    style={[localStyles.fieldInput, focusedField === 'phone' && localStyles.fieldInputFocused]}
                    value={phoneNumber}
                  />
                  {phoneErr !== '' && <Text style={[styles.errorText, styles.errorTextOnDark]}>{phoneErr}</Text>}
                </View>
              )}

              {signupStep === 'account' && (
                <View style={localStyles.card}>
                  <Text style={localStyles.cardLabel}>Login details</Text>

                  <Text style={localStyles.fieldLabel}>Email</Text>
                  <TextInput
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    onBlur={() => setFocusedField(null)}
                    onChangeText={(value) => {
                      setEmail(value);
                      if (error) clearError();
                    }}
                    onFocus={() => setFocusedField('email')}
                    placeholder="you@example.com"
                    placeholderTextColor="rgba(255,255,255,0.4)"
                    style={[localStyles.fieldInput, focusedField === 'email' && localStyles.fieldInputFocused]}
                    value={email}
                  />
                  {emailErr !== '' && <Text style={[styles.errorText, styles.errorTextOnDark]}>{emailErr}</Text>}

                  <Text style={[localStyles.fieldLabel, { marginTop: 12 }]}>Password</Text>
                  <TextInput
                    onBlur={() => setFocusedField(null)}
                    onChangeText={(value) => {
                      setPassword(value);
                      if (error) clearError();
                    }}
                    onFocus={() => setFocusedField('password')}
                    placeholder="Password"
                    placeholderTextColor="rgba(255,255,255,0.4)"
                    secureTextEntry
                    style={[localStyles.fieldInput, focusedField === 'password' && localStyles.fieldInputFocused]}
                    value={password}
                  />
                  {passwordErr !== '' && <Text style={[styles.errorText, styles.errorTextOnDark]}>{passwordErr}</Text>}

                  <Text style={[localStyles.fieldLabel, { marginTop: 12 }]}>Confirm password</Text>
                  <TextInput
                    onBlur={() => setFocusedField(null)}
                    onChangeText={(value) => {
                      setConfirmPassword(value);
                      if (error) clearError();
                    }}
                    onFocus={() => setFocusedField('confirm')}
                    placeholder="Confirm password"
                    placeholderTextColor="rgba(255,255,255,0.4)"
                    secureTextEntry
                    style={[localStyles.fieldInput, focusedField === 'confirm' && localStyles.fieldInputFocused]}
                    value={confirmPassword}
                  />
                  {confirmErr !== '' && <Text style={[styles.errorText, styles.errorTextOnDark]}>{confirmErr}</Text>}
                </View>
              )}

              {signupStep === 'profile' && (
                <View style={localStyles.card}>
                  <Text style={localStyles.cardLabel}>Profile (optional)</Text>
                  <Text style={localStyles.stepHelperText}>
                    Add a few details to personalize your account. You can skip this and fill it in later.
                  </Text>

                  <PressableScale onPress={pickProfilePhoto} style={localStyles.avatarButton}>
                    {profilePhotoUri ? (
                      <Image source={{ uri: profilePhotoUri }} style={localStyles.avatarImage} />
                    ) : (
                      <>
                        <Ionicons color="rgba(255,255,255,0.7)" name="camera-outline" size={26} />
                        <Text style={localStyles.avatarButtonText}>Add photo</Text>
                      </>
                    )}
                  </PressableScale>
                  {photoErr !== '' && (
                    <Text style={[styles.errorText, styles.errorTextOnDark, localStyles.centerText]}>{photoErr}</Text>
                  )}

                  <Text style={localStyles.fieldLabel}>Degree</Text>
                  <TextInput
                    autoCapitalize="words"
                    onBlur={() => setFocusedField(null)}
                    onChangeText={setDegree}
                    onFocus={() => setFocusedField('degree')}
                    placeholder="Bachelor of Science in Computer Science"
                    placeholderTextColor="rgba(255,255,255,0.4)"
                    style={[localStyles.fieldInput, focusedField === 'degree' && localStyles.fieldInputFocused]}
                    value={degree}
                  />

                  <Text style={[localStyles.fieldLabel, { marginTop: 12 }]}>Short bio</Text>
                  <TextInput
                    multiline
                    numberOfLines={4}
                    onBlur={() => setFocusedField(null)}
                    onChangeText={setBio}
                    onFocus={() => setFocusedField('bio')}
                    placeholder="Write a short bio about yourself..."
                    placeholderTextColor="rgba(255,255,255,0.4)"
                    style={[localStyles.fieldInput, localStyles.bioInput, focusedField === 'bio' && localStyles.fieldInputFocused]}
                    textAlignVertical="top"
                    value={bio}
                  />
                </View>
              )}

              {signupStep === 'driver' && (
                <View style={localStyles.card}>
                  <Text style={localStyles.cardLabel}>Driver details (optional)</Text>
                  <Text style={localStyles.stepHelperText}>
                    Are you planning to give rides? Add your vehicle details so passengers can book with you.
                  </Text>

                  <View style={localStyles.choiceRow}>
                    <PressableScale
                      onPress={() => setIsDriver(true)}
                      style={[localStyles.choiceButton, isDriver === true && localStyles.choiceButtonActive]}
                    >
                      <Text style={[localStyles.choiceButtonText, isDriver === true && localStyles.choiceButtonTextActive]}>
                        Yes, I'm a driver
                      </Text>
                    </PressableScale>
                    <PressableScale
                      onPress={() => setIsDriver(false)}
                      style={[localStyles.choiceButton, isDriver === false && localStyles.choiceButtonActive]}
                    >
                      <Text style={[localStyles.choiceButtonText, isDriver === false && localStyles.choiceButtonTextActive]}>
                        Not right now
                      </Text>
                    </PressableScale>
                  </View>

                  {isDriver === true && (
                    <>
                      <Text style={[localStyles.fieldLabel, { marginTop: 4 }]}>Vehicle make</Text>
                      <TextInput
                        autoCapitalize="words"
                        onBlur={() => setFocusedField(null)}
                        onChangeText={setVehicleMake}
                        onFocus={() => setFocusedField('vehicleMake')}
                        placeholder="Honda"
                        placeholderTextColor="rgba(255,255,255,0.4)"
                        style={[localStyles.fieldInput, focusedField === 'vehicleMake' && localStyles.fieldInputFocused]}
                        value={vehicleMake}
                      />

                      <Text style={[localStyles.fieldLabel, { marginTop: 12 }]}>Vehicle model</Text>
                      <TextInput
                        autoCapitalize="words"
                        onBlur={() => setFocusedField(null)}
                        onChangeText={setVehicleModel}
                        onFocus={() => setFocusedField('vehicleModel')}
                        placeholder="Civic"
                        placeholderTextColor="rgba(255,255,255,0.4)"
                        style={[localStyles.fieldInput, focusedField === 'vehicleModel' && localStyles.fieldInputFocused]}
                        value={vehicleModel}
                      />

                      <Text style={[localStyles.fieldLabel, { marginTop: 12 }]}>Vehicle color</Text>
                      <TextInput
                        autoCapitalize="words"
                        onBlur={() => setFocusedField(null)}
                        onChangeText={setVehicleColor}
                        onFocus={() => setFocusedField('vehicleColor')}
                        placeholder="Silver"
                        placeholderTextColor="rgba(255,255,255,0.4)"
                        style={[localStyles.fieldInput, focusedField === 'vehicleColor' && localStyles.fieldInputFocused]}
                        value={vehicleColor}
                      />

                      <Text style={[localStyles.fieldLabel, { marginTop: 12 }]}>License plate</Text>
                      <TextInput
                        autoCapitalize="characters"
                        onBlur={() => setFocusedField(null)}
                        onChangeText={setLicensePlate}
                        onFocus={() => setFocusedField('licensePlate')}
                        placeholder="1ABC234"
                        placeholderTextColor="rgba(255,255,255,0.4)"
                        style={[localStyles.fieldInput, focusedField === 'licensePlate' && localStyles.fieldInputFocused]}
                        value={licensePlate}
                      />

                      <Text style={[localStyles.fieldLabel, { marginTop: 12 }]}>Seats available</Text>
                      <TextInput
                        keyboardType="number-pad"
                        onBlur={() => setFocusedField(null)}
                        onChangeText={setSeatsAvailable}
                        onFocus={() => setFocusedField('seatsAvailable')}
                        placeholder="2"
                        placeholderTextColor="rgba(255,255,255,0.4)"
                        style={[localStyles.fieldInput, focusedField === 'seatsAvailable' && localStyles.fieldInputFocused]}
                        value={seatsAvailable}
                      />
                    </>
                  )}

                  {driverErr !== '' && <Text style={[styles.errorText, styles.errorTextOnDark]}>{driverErr}</Text>}
                </View>
              )}

              {signupStep === 'confirm' && (
                <>
                  <View style={localStyles.card}>
                    {profilePhotoUri && (
                      <Image source={{ uri: profilePhotoUri }} style={localStyles.confirmAvatarImage} />
                    )}
                    <View style={localStyles.summaryRow}>
                      <Text style={localStyles.summaryLabel}>Name</Text>
                      <Text style={localStyles.summaryValue} numberOfLines={1}>{name}</Text>
                    </View>
                    <View style={localStyles.summaryRow}>
                      <Text style={localStyles.summaryLabel}>Date of birth</Text>
                      <Text style={localStyles.summaryValue}>{dob}</Text>
                    </View>
                    <View style={localStyles.summaryRow}>
                      <Text style={localStyles.summaryLabel}>Phone number</Text>
                      <Text style={localStyles.summaryValue}>{phoneNumber}</Text>
                    </View>
                    <View style={localStyles.summaryRow}>
                      <Text style={localStyles.summaryLabel}>Email</Text>
                      <Text style={localStyles.summaryValue} numberOfLines={1}>{email}</Text>
                    </View>
                    {degree.trim() !== '' && (
                      <View style={localStyles.summaryRow}>
                        <Text style={localStyles.summaryLabel}>Degree</Text>
                        <Text style={localStyles.summaryValue} numberOfLines={1}>{degree.trim()}</Text>
                      </View>
                    )}
                    {bio.trim() !== '' && (
                      <View style={[localStyles.summaryRow, isDriver !== true && { borderBottomWidth: 0 }]}>
                        <Text style={localStyles.summaryLabel}>Bio</Text>
                        <Text style={localStyles.summaryValue} numberOfLines={3}>{bio.trim()}</Text>
                      </View>
                    )}
                    {isDriver === true && (
                      <View style={[localStyles.summaryRow, { borderBottomWidth: 0 }]}>
                        <Text style={localStyles.summaryLabel}>Vehicle</Text>
                        <Text style={localStyles.summaryValue} numberOfLines={1}>
                          {[vehicleColor, vehicleMake, vehicleModel].filter(Boolean).join(' ')} · {licensePlate}
                        </Text>
                      </View>
                    )}
                  </View>

                  {error ? <Text style={[styles.errorText, styles.errorTextOnDark]}>{error}</Text> : null}
                </>
              )}

              {signupStep === 'about' && (
                <PressableScale onPress={goToAccountStep} style={localStyles.actionButton}>
                  <Text style={styles.primaryButtonText}>Next</Text>
                </PressableScale>
              )}
              {signupStep === 'account' && (
                <PressableScale onPress={goToProfileStep} style={localStyles.actionButton}>
                  <Text style={styles.primaryButtonText}>Next</Text>
                </PressableScale>
              )}
              {signupStep === 'profile' && (
                <PressableScale onPress={goToDriverStep} style={localStyles.actionButton}>
                  <Text style={styles.primaryButtonText}>Next</Text>
                </PressableScale>
              )}
              {signupStep === 'driver' && (
                <PressableScale onPress={goToConfirmStep} style={localStyles.actionButton}>
                  <Text style={styles.primaryButtonText}>Next</Text>
                </PressableScale>
              )}
              {signupStep === 'confirm' && (
                <PressableScale
                  disabled={submitting}
                  onPress={submitSignup}
                  style={[localStyles.actionButton, submitting && localStyles.actionButtonDisabled]}
                >
                  {submitting ? (
                    <ActivityIndicator color={colors.white} />
                  ) : (
                    <Text style={styles.primaryButtonText}>Create Account</Text>
                  )}
                </PressableScale>
              )}
            </ScrollView>

            <DatePickerModal
              defaultViewDate={defaultDobView}
              initialDate={parseDobAsDate(dob)}
              maxDate={maxDob}
              minDate={minDob}
              onClose={() => setDobPickerVisible(false)}
              onSelect={(date) => {
                setDob(formatDobToStr(date));
                if (error) clearError();
                setDobPickerVisible(false);
              }}
              visible={dobPickerVisible}
            />
          </KeyboardAvoidingView>
        </TouchableWithoutFeedback>
      </View>
    );
  }

  return (
    <View style={localStyles.pageContainer}>
      <StatusBar barStyle="light-content" />

      <TouchableWithoutFeedback onPress={() => Keyboard.dismiss()}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView
            contentContainerStyle={localStyles.loginScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={localStyles.card}>
              <Text style={localStyles.loginTitle}>Ribe</Text>
              <Text style={localStyles.cardLabel}>Log-In</Text>

              <Text style={localStyles.fieldLabel}>Email</Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                onBlur={() => setFocusedField(null)}
                onChangeText={(value) => {
                  setEmail(value);
                  if (error) clearError();
                }}
                onFocus={() => setFocusedField('email')}
                placeholder="you@example.com"
                placeholderTextColor="rgba(255,255,255,0.4)"
                style={[localStyles.fieldInput, focusedField === 'email' && localStyles.fieldInputFocused]}
                value={email}
              />

              <Text style={[localStyles.fieldLabel, { marginTop: 12 }]}>Password</Text>
              <TextInput
                onBlur={() => setFocusedField(null)}
                onChangeText={(value) => {
                  setPassword(value);
                  if (error) clearError();
                }}
                onFocus={() => setFocusedField('password')}
                placeholder="Password"
                placeholderTextColor="rgba(255,255,255,0.4)"
                secureTextEntry
                style={[localStyles.fieldInput, focusedField === 'password' && localStyles.fieldInputFocused]}
                value={password}
              />
              {error ? <Text style={[styles.errorText, styles.errorTextOnDark]}>{error}</Text> : null}
            </View>

            <PressableScale
              disabled={submitting}
              onPress={handleLogin}
              style={[localStyles.actionButton, submitting && localStyles.actionButtonDisabled]}
            >
              {submitting ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.primaryButtonText}>Log in</Text>
              )}
            </PressableScale>

            <PressableScale onPress={toggleMode} style={localStyles.switchModeLink}>
              <Text style={localStyles.switchModeLinkText}>Need an account? Sign up</Text>
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
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 20,
  },
  loginScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingVertical: 10,
    paddingLeft: 10,
    paddingRight: 20,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.16)',
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
    marginTop: 14,
  },
  progressBlock: {
    marginTop: 14,
  },
  progressRow: {
    flexDirection: 'row',
    gap: 6,
  },
  progressSegment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  progressSegmentActive: {
    backgroundColor: colors.white,
  },
  progressLabel: {
    marginTop: 8,
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    fontWeight: '600',
  },
  card: {
    borderRadius: 20,
    padding: 18,
    marginBottom: 14,
    backgroundColor: colors.mediumBlue,
  },
  cardLabel: {
    fontFamily: 'Marcellus_400Regular',
    fontSize: 16,
    color: colors.white,
    marginBottom: 10,
  },
  loginTitle: {
    fontFamily: 'Marcellus_400Regular',
    fontSize: 26,
    color: colors.white,
    marginBottom: 4,
  },
  fieldLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  fieldInput: {
    borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.white,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  fieldInputFocused: {
    borderColor: colors.white,
    borderWidth: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  switchModeLink: {
    marginTop: 14,
    alignItems: 'center',
  },
  switchModeLinkText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  bioInput: {
    minHeight: 100,
  },
  choiceRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  choiceButton: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingVertical: 12,
  },
  choiceButtonActive: {
    borderColor: colors.white,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  choiceButtonText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontWeight: '600',
  },
  choiceButtonTextActive: {
    color: colors.white,
  },
  stepHelperText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  centerText: {
    textAlign: 'center',
  },
  avatarButton: {
    alignSelf: 'center',
    width: 110,
    height: 110,
    borderRadius: 55,
    marginBottom: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  avatarImage: {
    width: 110,
    height: 110,
    borderRadius: 55,
  },
  avatarButtonText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  confirmAvatarImage: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignSelf: 'center',
    marginBottom: 12,
  },
  pickerField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickerValueText: {
    fontSize: 15,
    color: colors.white,
  },
  pickerPlaceholderText: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.4)',
  },
  actionButton: {
    alignItems: 'center',
    backgroundColor: colors.mediumBlue,
    borderRadius: 12,
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  actionButtonDisabled: {
    backgroundColor: 'rgba(19, 118, 190, 0.45)',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.2)',
    paddingVertical: 9,
  },
  summaryLabel: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
  },
  summaryValue: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '600',
    maxWidth: '60%',
    textAlign: 'right',
  },
});
