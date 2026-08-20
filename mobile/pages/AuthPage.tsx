import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StatusBar,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAuth } from '../auth/useAuth';
import styles from '../styles';

/* Page to manage user authentication and account registration */

export function AuthPage() {
  // set up necessary values for account registration
  const {
    submitting,
    error,
    mode,
    clearError,
    toggleMode,
    name,
    setName,
    dob,
    setDob,
    phoneNumber,
    setPhoneNumber,
    email,
    setEmail,
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    isFormValid,
    handleLogin,
    handleSignup,
  } = useAuth();

  return (
    <KeyboardAvoidingView
      style={ styles.screen }
      behavior={ Platform.OS === 'ios' ? 'padding' : undefined }
    >
      <StatusBar barStyle="dark-content" />
      <View style={ styles.card }>
        <Text style={ styles.title }>Ribe</Text>
        <Text style={ styles.subtitle }>
          { mode === 'login' ? 'Sign in to continue' : 'Create your account' }
        </Text>

        {/* Sign-up specific fields */ }
        { mode === 'signup' && (
          <>
            <TextInput
              autoCapitalize="words"
              onChangeText={ (value) => {
                setName(value);
                if (error) clearError();
              } }
              placeholder="Name"
              style={ styles.input }
              value={ name }
            />

            <TextInput
              onChangeText={ (value) => {
                setDob(value);
                if (error) clearError();
              } }
              placeholder="Date of Birth"
              style={ styles.input }
              value={ dob }
            />

            <TextInput
              autoCapitalize="none"
              keyboardType="phone-pad"
              onChangeText={ (value) => {
                setPhoneNumber(value);
                if (error) clearError();
              } }
              placeholder="Phone Number"
              style={ styles.input }
              value={ phoneNumber }
            />
          </>
        ) }

        {/* email + password for either sign up or log in */ }
        <TextInput
          autoCapitalize="none"
          autoCorrect={ false }
          keyboardType="email-address"
          onChangeText={ (value) => {
            setEmail(value);
            if (error) clearError();
          } }
          placeholder="Email"
          style={ styles.input }
          value={ email }
        />

        <TextInput
          onChangeText={ (value) => {
            setPassword(value);
            if (error) clearError();
          } }
          placeholder="Password"
          secureTextEntry
          style={ styles.input }
          value={ password }
        />

        {/* Only need to confirm password during sign up */ }
        { mode === 'signup' && (
          <TextInput
            onChangeText={ (value) => {
              setConfirmPassword(value);
              if (error) clearError();
            } }
            placeholder="Confirm password"
            secureTextEntry
            style={ styles.input }
            value={ confirmPassword }
          />
        ) }

        { error ? <Text style={ styles.errorText }>{ error }</Text> : null }

        {/* Submit button */ }
        <Pressable
          disabled={ !isFormValid || submitting }
          onPress={ mode === 'login' ? handleLogin : handleSignup }
          style={ [
            styles.primaryButton,
            (!isFormValid || submitting) && styles.primaryButtonDisabled,
          ] }
        >
          { submitting ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={ styles.primaryButtonText }>
              { mode === 'login' ? 'Log in' : 'Create account' }
            </Text>
          ) }
        </Pressable>

        {/* Swap between log in and sign up */ }
        <Pressable onPress={ toggleMode } style={ styles.linkButton }>
          <Text style={ styles.linkText }>
            { mode === 'login'
              ? 'Need an account? Sign up'
              : 'Already have an account? Log in' }
          </Text>
        </Pressable>

        <Text style={ styles.helperText }>
          { mode === 'login'
            ? 'Use a valid Firebase-authenticated email and password.'
            : 'Create an account to sign in with Firebase Authentication.' }
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}
