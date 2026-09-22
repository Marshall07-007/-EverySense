import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import * as Speech from 'expo-speech';
import { speakText as ttsSpeakText, stopSpeaking as ttsStopSpeaking } from '../services/ttsService';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { AppTheme, getThemeConfig } from '../../constants/theme';
import { supabase } from '../../lib/supabase';
import { EverySenseLogo } from '../components/EverySenseLogo';
import { BackgroundLogo } from '../components/BackgroundLogo';
import { ModernButton } from '../components/ModernButton';
import { ModernCard } from '../components/ModernCard';
import { useApp } from '../contexts/AppContext';
import { User } from '../types';

// Voice-to-text module (not available in Expo Go, only dev builds)
let ExpoSpeechRecognitionModule: any = null;
try {
  ExpoSpeechRecognitionModule = require('expo-speech-recognition').ExpoSpeechRecognitionModule;
} catch {}

const LoginScreen = () => {
  const { dispatch, state } = useApp();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [name, setName] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Issue 3: confirm PIN for sign-up
  const [confirmPin, setConfirmPin] = useState('');

  // Issue 2: forgot PIN flow — only revealed after a failed login attempt
  const [showForgotPin, setShowForgotPin] = useState(false);
  const [isForgot, setIsForgot] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [resetNewPin, setResetNewPin] = useState('');
  const [resetConfirmPin, setResetConfirmPin] = useState('');

  // Issue 6: refs for keyboard navigation
  const nameRef = useRef<any>(null);
  const emailRef = useRef<any>(null);
  const pinRef = useRef<any>(null);
  const confirmPinRef = useRef<any>(null);
  const otpRef = useRef<any>(null);
  const resetNewPinRef = useRef<any>(null);
  const resetConfirmPinRef = useRef<any>(null);

  // Voice-to-text: which field is currently listening
  const [listeningField, setListeningField] = useState<'email' | 'name' | 'forgotEmail' | null>(null);
  const voiceListenersRef = useRef<any[]>([]);
  const isListeningRef   = useRef(false); // synchronous guard to prevent race condition

  const theme = useMemo(() => getThemeConfig(state.accessibilitySettings.isDarkMode), [state.accessibilitySettings.isDarkMode]);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const gradientColors = theme.gradient as [string, string, ...string[]];
  const placeholderColor = theme.placeholder;

  useEffect(() => {
    speakText('Welcome to EverySense. You can sign in or create a new account.');
  }, []);

  const speakText = (text: string) => {
    if (!state.voiceAnnouncementsEnabled) return;
    const safeRate = Math.max(0.5, Math.min(state.accessibilitySettings.voiceSpeed, 2.0));
    ttsSpeakText(text, { rate: safeRate, pitch: 1.0 });
  };

  const validateEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const validatePin = (pin: string) => /^\d{4}$/.test(pin);
  const toSupabasePassword = (pin: string) => `${pin}##`;

  const handleLogin = async () => {
    if (!validateEmail(email)) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      speakText('Please enter a valid email address');
      return;
    }
    if (!validatePin(pin)) {
      Alert.alert('Invalid PIN', 'Please enter a 4-digit PIN.');
      speakText('Please enter a 4-digit PIN');
      return;
    }
    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.toLowerCase().trim(),
        password: toSupabasePassword(pin),
      });
      if (error) throw error;
      const supabaseUser = data.user!;
      // Preserve any cached fields (profilePhoto, bio, etc.) that the login form doesn't know about
      const existingRaw = await AsyncStorage.getItem('user');
      const existing = existingRaw ? JSON.parse(existingRaw) : {};
      const appUser: User = {
        ...existing,
        id: supabaseUser.id,
        email: supabaseUser.email!,
        pin,
        name: supabaseUser.user_metadata?.name || existing.name || email.split('@')[0],
        joinDate: supabaseUser.created_at,
      };
      await AsyncStorage.setItem('user', JSON.stringify(appUser));
      dispatch({ type: 'LOGIN', payload: appUser });
      speakText('Login successful! Welcome to EverySense.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error: any) {
      Alert.alert('Login Failed', error.message || 'Invalid email or PIN.');
      speakText('Login failed. Please check your email and PIN.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      // Reveal "Forgot PIN?" after a failed attempt so the user can recover
      setShowForgotPin(true);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignUp = async () => {
    if (!validateEmail(email)) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      speakText('Please enter a valid email address');
      return;
    }
    if (!validatePin(pin)) {
      Alert.alert('Invalid PIN', 'Please enter a 4-digit PIN.');
      speakText('Please enter a 4-digit PIN');
      return;
    }
    if (pin !== confirmPin) {
      Alert.alert('PIN Mismatch', 'PINs do not match. Please try again.');
      speakText('PINs do not match. Please try again.');
      return;
    }
    if (!name.trim()) {
      Alert.alert('Name Required', 'Please enter your name.');
      speakText('Please enter your name');
      return;
    }
    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.toLowerCase().trim(),
        password: toSupabasePassword(pin),
        options: { data: { name: name.trim() } },
      });
      if (error) throw error;
      const supabaseUser = data.user!;
      const appUser: User = {
        id: supabaseUser.id,
        email: supabaseUser.email!,
        pin,
        name: name.trim(),
        joinDate: supabaseUser.created_at,
      };
      await AsyncStorage.setItem('user', JSON.stringify(appUser));
      dispatch({ type: 'LOGIN', payload: appUser });
      speakText('Account created successfully! Welcome to EverySense.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error: any) {
      if (error.message?.includes('already registered')) {
        Alert.alert('Email In Use', 'This email is already registered. Please sign in.');
        speakText('This email is already registered. Please sign in.');
      } else {
        Alert.alert('Sign Up Failed', error.message || 'Could not create account. Please try again.');
        speakText('Could not create account. Please try again.');
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleMode = () => {
    setIsLogin(!isLogin);
    setEmail('');
    setPin('');
    setName('');
    setConfirmPin('');
    setShowForgotPin(false);
    speakText(isLogin ? 'Switched to create account mode' : 'Switched to sign in mode');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const toggleVoiceAnnouncements = () => {
    const newState = !state.voiceAnnouncementsEnabled;
    dispatch({ type: 'TOGGLE_VOICE_ANNOUNCEMENTS', payload: newState });
    if (newState) {
      const safeRate = Math.max(0.5, Math.min(state.accessibilitySettings.voiceSpeed, 2.0));
      ttsSpeakText('Voice announcements enabled', { rate: safeRate, pitch: 1.0 });
    } else {
      ttsStopSpeaking();
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  // ── Voice-to-text for text fields ─────────────────────────────────────────

  const cleanupVoiceListeners = () => {
    voiceListenersRef.current.forEach(sub => { try { sub?.remove?.(); } catch {} });
    voiceListenersRef.current = [];
    isListeningRef.current = false;
  };

  // Cleanup listeners if the component unmounts while voice is active
  useEffect(() => {
    return () => {
      cleanupVoiceListeners();
      try { ExpoSpeechRecognitionModule?.stop?.(); } catch {}
    };
  }, []);

  const applyVoiceResult = (field: 'email' | 'name' | 'forgotEmail', text: string) => {
    if (field === 'email' || field === 'forgotEmail') {
      // Normalize spoken email: "john at gmail dot com" → "john@gmail.com"
      let normalized = text.toLowerCase().trim();
      normalized = normalized.replace(/\s+at\s+/gi, '@');
      normalized = normalized.replace(/\s+dot\s+/gi, '.');
      normalized = normalized.replace(/\s+/g, '');
      if (!normalized.includes('@')) {
        Alert.alert('Invalid Email', 'Please say "at" to separate the address and domain.');
        return;
      }
      setEmail(normalized);
      speakText(`Email set to ${normalized}`);
    } else {
      setName(text.trim());
      speakText(`Name set to ${text.trim()}`);
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const startVoiceInput = async (field: 'email' | 'name' | 'forgotEmail') => {
    if (isListeningRef.current) return; // synchronous guard — prevents race condition on rapid taps
    isListeningRef.current = true;

    const label = field === 'name' ? 'your full name' : 'your email address';

    // ── Web (Chrome / Expo web) ──────────────────────────────────────────────
    if (Platform.OS === 'web') {
      const SRWeb =
        (globalThis as any).webkitSpeechRecognition ||
        (typeof window !== 'undefined' && (window as any).webkitSpeechRecognition) ||
        (globalThis as any).SpeechRecognition ||
        (typeof window !== 'undefined' && (window as any).SpeechRecognition);

      if (!SRWeb) {
        Alert.alert('Not Available', 'Voice input is not supported in this browser.');
        return;
      }

      setListeningField(field);
      speakText(`Listening. Say ${label}.`);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const rec = new SRWeb();
      rec.lang = 'en-US';
      rec.continuous = false;
      rec.interimResults = false;
      rec.onresult = (event: any) => {
        const text = event.results?.[0]?.[0]?.transcript;
        if (text) applyVoiceResult(field, text);
        setListeningField(null);
      };
      rec.onerror = () => setListeningField(null);
      rec.onend = () => setListeningField(null);
      rec.start();
      return;
    }

    // ── Native (dev build only) ──────────────────────────────────────────────
    if (!ExpoSpeechRecognitionModule) {
      isListeningRef.current = false;
      Alert.alert('Not Available', 'Voice input requires a development build.');
      return;
    }

    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) {
      isListeningRef.current = false;
      speakText('Microphone permission is required for voice input.');
      return;
    }

    setListeningField(field);
    speakText(`Listening. Say ${label}.`);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    cleanupVoiceListeners();

    const resultSub = ExpoSpeechRecognitionModule.addListener('result', (event: any) => {
      const transcript = event.results?.[0]?.transcript;
      const isFinal = event.isFinal;
      if (transcript && isFinal) {
        applyVoiceResult(field, transcript);
        cleanupVoiceListeners();
        setListeningField(null);
      }
    });
    const endSub = ExpoSpeechRecognitionModule.addListener('end', () => {
      cleanupVoiceListeners();
      setListeningField(null);
    });
    const errorSub = ExpoSpeechRecognitionModule.addListener('error', () => {
      cleanupVoiceListeners();
      setListeningField(null);
    });
    voiceListenersRef.current = [resultSub, endSub, errorSub];

    ExpoSpeechRecognitionModule.start({
      lang: 'en-US',
      interimResults: false,
      maxAlternatives: 1,
      continuous: false,
    });
  };

  // ── Forgot PIN handlers ────────────────────────────────────────────────────

  const enterForgotMode = () => {
    setIsForgot(true);
    setOtpSent(false);
    setOtp('');
    setResetNewPin('');
    setResetConfirmPin('');
    speakText('Forgot PIN. Enter your email address to receive a verification code.');
  };

  const exitForgotMode = () => {
    setIsForgot(false);
    setOtpSent(false);
    setOtp('');
    setResetNewPin('');
    setResetConfirmPin('');
  };

  const handleSendOtp = async () => {
    if (!validateEmail(email)) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      speakText('Please enter a valid email address');
      return;
    }
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.toLowerCase().trim(),
        options: { shouldCreateUser: false },
      });
      if (error) throw error;
      setOtpSent(true);
      speakText('Verification code sent. Check your email and enter the 6-digit code.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error: any) {
      const msg = error.message?.toLowerCase().includes('not found') || error.message?.toLowerCase().includes('no user')
        ? 'No account found with this email.'
        : error.message || 'Could not send verification code. Please try again.';
      Alert.alert('Error', msg);
      speakText(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPin = async () => {
    if (!/^\d{6}$/.test(otp)) {
      Alert.alert('Invalid Code', 'Please enter the 6-digit code from your email.');
      speakText('Please enter the 6-digit code from your email');
      return;
    }
    if (!validatePin(resetNewPin)) {
      Alert.alert('Invalid PIN', 'Please enter a 4-digit PIN.');
      speakText('Please enter a 4-digit PIN');
      return;
    }
    if (resetNewPin !== resetConfirmPin) {
      Alert.alert('PIN Mismatch', 'PINs do not match. Please try again.');
      speakText('PINs do not match. Please try again.');
      return;
    }
    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: email.toLowerCase().trim(),
        token: otp,
        type: 'email',
      });
      if (error) throw error;
      await supabase.auth.updateUser({ password: toSupabasePassword(resetNewPin) });
      const supabaseUser = data.user!;
      const appUser: User = {
        id: supabaseUser.id,
        email: supabaseUser.email!,
        pin: resetNewPin,
        name: supabaseUser.user_metadata?.name || email.split('@')[0],
        joinDate: supabaseUser.created_at,
      };
      await AsyncStorage.setItem('user', JSON.stringify(appUser));
      dispatch({ type: 'LOGIN', payload: appUser });
      speakText('PIN reset successfully! Welcome back to EverySense.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error: any) {
      Alert.alert('Reset Failed', error.message || 'Invalid or expired code. Please try again.');
      speakText('Reset failed. Please check your code and try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <LinearGradient colors={gradientColors} style={styles.container}>
      <BackgroundLogo />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoidingView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <EverySenseLogo size={64} showText={false} />
            <Text style={styles.brandTitleText}>EVERYSENSE</Text>
            <Text style={styles.welcomeText}>Welcome to EverySense</Text>
            <Text style={styles.subtitleText}>Understand what matters. Take the next step with confidence.</Text>
          </View>

          <ModernCard variant="elevated" style={styles.formContainer}>
            {/* Form header: title + voice toggle */}
            <View style={styles.formHeader}>
              <Text style={styles.formTitle}>
                {isForgot ? 'Reset PIN' : isLogin ? 'Sign In' : 'Create Account'}
              </Text>
              <TouchableOpacity
                style={[styles.voiceButton, state.voiceAnnouncementsEnabled && styles.voiceButtonActive]}
                onPress={toggleVoiceAnnouncements}
                accessibilityLabel={state.voiceAnnouncementsEnabled ? 'Disable voice announcements' : 'Enable voice announcements'}
              >
                <Ionicons
                  name={state.voiceAnnouncementsEnabled ? 'volume-high' : 'volume-mute'}
                  size={20}
                  color={state.voiceAnnouncementsEnabled ? theme.textInverted : theme.textSecondary}
                />
                <Text style={[styles.voiceButtonText, state.voiceAnnouncementsEnabled && styles.voiceButtonTextActive]}>
                  {state.voiceAnnouncementsEnabled ? 'Audio ON' : 'Audio OFF'}
                </Text>
              </TouchableOpacity>
            </View>

            {isForgot ? (
              // ── Forgot PIN form ────────────────────────────────────────────
              <>
                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>Email Address</Text>
                  <View style={styles.inputRow}>
                    <TextInput
                      ref={emailRef}
                      style={[styles.textInput, styles.textInputFlex, otpSent && styles.textInputDisabled]}
                      value={email}
                      onChangeText={setEmail}
                      placeholder="Enter your email"
                      placeholderTextColor={placeholderColor}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType={otpSent ? 'next' : 'send'}
                      onSubmitEditing={otpSent ? () => otpRef.current?.focus() : handleSendOtp}
                      onFocus={() => speakText('Email address. Enter the email you used to sign up.')}
                      editable={!otpSent}
                      accessibilityLabel="Email address input"
                    />
                    {!otpSent && (
                      <TouchableOpacity
                        style={[styles.micButton, listeningField === 'forgotEmail' && styles.micButtonActive]}
                        onPress={() => startVoiceInput('forgotEmail')}
                        disabled={!!listeningField}
                        accessibilityLabel="Voice input for email"
                      >
                        {listeningField === 'forgotEmail'
                          ? <ActivityIndicator size="small" color={theme.textInverted} />
                          : <Ionicons name="mic" size={20} color={theme.accent} />
                        }
                      </TouchableOpacity>
                    )}
                  </View>
                </View>

                {!otpSent ? (
                  <ModernButton
                    title="Send Verification Code"
                    onPress={handleSendOtp}
                    variant="primary"
                    size="large"
                    disabled={isLoading}
                    loading={isLoading}
                    icon={<Ionicons name="mail" size={20} color="white" />}
                    style={styles.primaryButton}
                  />
                ) : (
                  <>
                    <View style={styles.inputContainer}>
                      <Text style={styles.inputLabel}>6-Digit Code (from email)</Text>
                      <TextInput
                        ref={otpRef}
                        style={styles.textInput}
                        value={otp}
                        onChangeText={setOtp}
                        placeholder="Enter 6-digit code"
                        placeholderTextColor={placeholderColor}
                        keyboardType="numeric"
                        maxLength={6}
                        returnKeyType="next"
                        onSubmitEditing={() => resetNewPinRef.current?.focus()}
                        onFocus={() => speakText('Verification code. Enter the 6-digit code sent to your email.')}
                        accessibilityLabel="Verification code input"
                      />
                    </View>

                    <View style={styles.inputContainer}>
                      <Text style={styles.inputLabel}>New 4-Digit PIN</Text>
                      <TextInput
                        ref={resetNewPinRef}
                        style={styles.textInput}
                        value={resetNewPin}
                        onChangeText={setResetNewPin}
                        placeholder="Enter new PIN"
                        placeholderTextColor={placeholderColor}
                        keyboardType="numeric"
                        maxLength={4}
                        secureTextEntry
                        returnKeyType="next"
                        onSubmitEditing={() => resetConfirmPinRef.current?.focus()}
                        onFocus={() => speakText('New PIN. Enter your new 4-digit PIN.')}
                        accessibilityLabel="New PIN input"
                      />
                    </View>

                    <View style={styles.inputContainer}>
                      <Text style={styles.inputLabel}>Confirm New PIN</Text>
                      <TextInput
                        ref={resetConfirmPinRef}
                        style={styles.textInput}
                        value={resetConfirmPin}
                        onChangeText={setResetConfirmPin}
                        placeholder="Re-enter new PIN"
                        placeholderTextColor={placeholderColor}
                        keyboardType="numeric"
                        maxLength={4}
                        secureTextEntry
                        returnKeyType="done"
                        onSubmitEditing={handleResetPin}
                        onFocus={() => speakText('Confirm new PIN. Re-enter your new 4-digit PIN to confirm.')}
                        accessibilityLabel="Confirm new PIN input"
                      />
                    </View>

                    <ModernButton
                      title="Reset PIN"
                      onPress={handleResetPin}
                      variant="primary"
                      size="large"
                      disabled={isLoading}
                      loading={isLoading}
                      icon={<Ionicons name="key" size={20} color="white" />}
                      style={styles.primaryButton}
                    />
                  </>
                )}

                <TouchableOpacity style={styles.forgotLink} onPress={exitForgotMode}>
                  <Text style={styles.forgotLinkText}>← Back to Sign In</Text>
                </TouchableOpacity>
              </>
            ) : (
              // ── Normal sign-in / sign-up form ─────────────────────────────
              <>
                {!isLogin && (
                  <View style={styles.inputContainer}>
                    <Text style={styles.inputLabel}>Full Name</Text>
                    <View style={styles.inputRow}>
                      <TextInput
                        ref={nameRef}
                        style={[styles.textInput, styles.textInputFlex]}
                        value={name}
                        onChangeText={setName}
                        placeholder="Enter your full name"
                        placeholderTextColor={placeholderColor}
                        autoCapitalize="words"
                        returnKeyType="next"
                        onSubmitEditing={() => emailRef.current?.focus()}
                        onFocus={() => speakText('Full name. Enter your full name.')}
                        accessibilityLabel="Full name input"
                      />
                      <TouchableOpacity
                        style={[styles.micButton, listeningField === 'name' && styles.micButtonActive]}
                        onPress={() => startVoiceInput('name')}
                        disabled={!!listeningField}
                        accessibilityLabel="Voice input for name"
                      >
                        {listeningField === 'name'
                          ? <ActivityIndicator size="small" color={theme.textInverted} />
                          : <Ionicons name="mic" size={20} color={theme.accent} />
                        }
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>Email Address</Text>
                  <View style={styles.inputRow}>
                    <TextInput
                      ref={emailRef}
                      style={[styles.textInput, styles.textInputFlex]}
                      value={email}
                      onChangeText={setEmail}
                      placeholder="Enter your email"
                      placeholderTextColor={placeholderColor}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="next"
                      onSubmitEditing={() => pinRef.current?.focus()}
                      onFocus={() => speakText('Email address. Enter your email address.')}
                      accessibilityLabel="Email address input"
                    />
                    <TouchableOpacity
                      style={[styles.micButton, listeningField === 'email' && styles.micButtonActive]}
                      onPress={() => startVoiceInput('email')}
                      disabled={!!listeningField}
                      accessibilityLabel="Voice input for email"
                    >
                      {listeningField === 'email'
                        ? <ActivityIndicator size="small" color={theme.textInverted} />
                        : <Ionicons name="mic" size={20} color={theme.accent} />
                      }
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>4-Digit PIN</Text>
                  <TextInput
                    ref={pinRef}
                    style={styles.textInput}
                    value={pin}
                    onChangeText={setPin}
                    placeholder="Enter 4-digit PIN"
                    placeholderTextColor={placeholderColor}
                    keyboardType="numeric"
                    maxLength={4}
                    secureTextEntry
                    returnKeyType={isLogin ? 'done' : 'next'}
                    onSubmitEditing={isLogin ? handleLogin : () => confirmPinRef.current?.focus()}
                    onFocus={() => speakText('4-digit PIN. Enter your secret 4-digit PIN.')}
                    accessibilityLabel="PIN input"
                  />
                </View>

                {/* Issue 3: Confirm PIN — sign-up only */}
                {!isLogin && (
                  <View style={styles.inputContainer}>
                    <Text style={styles.inputLabel}>Confirm PIN</Text>
                    <TextInput
                      ref={confirmPinRef}
                      style={styles.textInput}
                      value={confirmPin}
                      onChangeText={setConfirmPin}
                      placeholder="Re-enter 4-digit PIN"
                      placeholderTextColor={placeholderColor}
                      keyboardType="numeric"
                      maxLength={4}
                      secureTextEntry
                      returnKeyType="done"
                      onSubmitEditing={handleSignUp}
                      onFocus={() => speakText('Confirm PIN. Re-enter your 4-digit PIN to confirm.')}
                      accessibilityLabel="Confirm PIN input"
                    />
                  </View>
                )}

                <ModernButton
                  title={isLogin ? 'Sign In' : 'Create Account'}
                  onPress={isLogin ? handleLogin : handleSignUp}
                  variant="primary"
                  size="large"
                  disabled={isLoading}
                  loading={isLoading}
                  icon={<Ionicons name={isLogin ? 'log-in' : 'person-add'} size={20} color="white" />}
                  style={styles.primaryButton}
                />

                {/* Issue 2: Forgot PIN link — only shown after a failed login attempt */}
                {isLogin && showForgotPin && (
                  <TouchableOpacity style={styles.forgotLink} onPress={enterForgotMode}>
                    <Text style={styles.forgotLinkText}>Forgot PIN?</Text>
                  </TouchableOpacity>
                )}

                <ModernButton
                  title={isLogin ? "Don't have an account? Sign Up" : 'Already have an account? Sign In'}
                  onPress={toggleMode}
                  variant="outline"
                  style={styles.secondaryButton}
                />
              </>
            )}
          </ModernCard>

        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
};

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
    },
    keyboardAvoidingView: {
      flex: 1,
    },
    scrollContainer: {
      flexGrow: 1,
      justifyContent: 'center',
      paddingHorizontal: 20,
      paddingVertical: 40,
    },
    header: {
      alignItems: 'center',
      marginBottom: 40,
    },
    brandTitleText: {
      fontSize: 13,
      fontWeight: '600',
      letterSpacing: 3,
      color: theme.accent, // Champagne Gold
      marginTop: 14,
      marginBottom: 6,
    },
    welcomeText: {
      fontSize: 26,
      fontWeight: '700',
      color: theme.textPrimary,
      textAlign: 'center',
      letterSpacing: 0.2,
    },
    subtitleText: {
      fontSize: 14,
      color: theme.textSecondary,
      marginTop: 8,
      textAlign: 'center',
      lineHeight: 20,
      maxWidth: 300,
    },
    formContainer: {
      padding: 30,
      marginBottom: 20,
      backgroundColor: theme.cardBackground,
      borderRadius: 24,
      borderWidth: theme.isDark ? 1 : 0.5,
      borderColor: theme.cardBorder,
      shadowColor: theme.cardShadow,
      shadowOffset: { width: 0, height: theme.isDark ? 8 : 4 },
      shadowOpacity: theme.isDark ? 0.35 : 0.12,
      shadowRadius: theme.isDark ? 20 : 12,
      elevation: theme.isDark ? 10 : 4,
    },
    formHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 30,
    },
    formTitle: {
      fontSize: 28,
      fontWeight: 'bold',
      color: theme.textPrimary,
      flex: 1,
    },
    // Issue 1: active state now uses accent (positive) not danger (red)
    voiceButton: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
      paddingHorizontal: 12,
      backgroundColor: theme.accentSoft,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: theme.accent,
    },
    voiceButtonActive: {
      backgroundColor: theme.accent,
      borderColor: theme.accent,
    },
    voiceButtonText: {
      color: theme.accent,
      fontSize: 12,
      fontWeight: '600',
      marginLeft: 6,
    },
    voiceButtonTextActive: {
      color: theme.textInverted,
    },
    inputContainer: {
      marginBottom: 20,
    },
    inputLabel: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.textPrimary,
      marginBottom: 8,
    },
    textInput: {
      borderWidth: 2,
      borderColor: theme.inputBorder,
      borderRadius: 16,
      paddingHorizontal: 20,
      paddingVertical: 16,
      fontSize: 16,
      backgroundColor: theme.inputBackground,
      minHeight: 56,
      color: theme.textPrimary,
    },
    textInputDisabled: {
      opacity: 0.55,
    },
    primaryButton: {
      marginTop: 10,
      marginBottom: 20,
    },
    secondaryButton: {
      marginTop: 0,
    },
    forgotLink: {
      alignItems: 'center',
      marginBottom: 16,
    },
    forgotLinkText: {
      color: theme.accent,
      fontSize: 14,
      fontWeight: '600',
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    textInputFlex: {
      flex: 1,
    },
    micButton: {
      width: 56,
      height: 56,
      backgroundColor: theme.accentSoft,
      borderRadius: 16,
      borderWidth: 2,
      borderColor: theme.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    micButtonActive: {
      backgroundColor: theme.accent,
      borderColor: theme.accent,
    },
  });

export default LoginScreen;
