import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StatusBar,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  Keyboard,
  View,
} from 'react-native';

import styles from '../styles';

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
  handleSignup: () => Promise<void>;
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
  return (
    <TouchableWithoutFeedback onPress={() => Keyboard.dismiss()}>
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <StatusBar barStyle="light-content" />
        <View style={styles.card}>
          <Text style={styles.title}>Ribe</Text>
          <Text style={styles.subtitle}>
            {mode === 'login' ? 'Sign in to continue' : 'Create your account'}
          </Text>

          {mode === 'signup' && (
            <>
              <TextInput
                autoCapitalize="words"
                onChangeText={(value) => {
                  setName(value);
                  if (error) clearError();
                }}
                placeholder="Name"
                style={styles.input}
                value={name}
              />

              <TextInput
                onChangeText={(value) => {
                  setDob(value);
                  if (error) clearError();
                }}
                placeholder="Date of Birth (DD/MM/YYYY)"
                style={styles.input}
                value={dob}
              />

              <TextInput
                autoCapitalize="none"
                keyboardType="phone-pad"
                onChangeText={(value) => {
                  setPhoneNumber(value);
                  if (error) clearError();
                }}
                placeholder="Phone Number"
                style={styles.input}
                value={phoneNumber}
              />
            </>
          )}

          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            onChangeText={(value) => {
              setEmail(value);
              if (error) clearError();
            }}
            placeholder="Email"
            style={styles.input}
            value={email}
          />

          <TextInput
            onChangeText={(value) => {
              setPassword(value);
              if (error) clearError();
            }}
            placeholder="Password"
            secureTextEntry
            style={styles.input}
            value={password}
          />

          {mode === 'signup' && (
            <TextInput
              onChangeText={(value) => {
                setConfirmPassword(value);
                if (error) clearError();
              }}
              placeholder="Confirm password"
              secureTextEntry
              style={styles.input}
              value={confirmPassword}
            />
          )}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <Pressable
            disabled={submitting}
            onPress={mode === 'login' ? handleLogin : handleSignup}
            style={[styles.primaryButton, submitting && styles.primaryButtonDisabled]}
          >
            {submitting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.primaryButtonText}>
                {mode === 'login' ? 'Log in' : 'Create account'}
              </Text>
            )}
          </Pressable>

          <Pressable onPress={toggleMode} style={styles.linkButton}>
            <Text style={styles.linkText}>
              {mode === 'login'
                ? 'Need an account? Sign up'
                : 'Already have an account? Log in'}
            </Text>
          </Pressable>

          <Text style={styles.helperText}>
            {mode === 'login'
              ? 'Use a valid Firebase-authenticated email and password.'
              : 'Create an account to sign in with Firebase Authentication. Make sure your email is valid, DOB is 18+, and the password has upper/lowercase letters and a number.'}
          </Text>
        </View>
      </KeyboardAvoidingView>
    </TouchableWithoutFeedback>
  );
}
