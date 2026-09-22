import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import * as Speech from 'expo-speech';
import { speakText as ttsSpeakText, stopSpeaking as ttsStopSpeaking } from '../services/ttsService';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Animated,
  Dimensions,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { AppTheme, getThemeConfig } from '../../constants/theme';
import { EverySenseLogo } from '../components/EverySenseLogo';
import { AccessibilitySetupPopup } from '../components/AccessibilitySetupPopup';
import { BackgroundLogo } from '../components/BackgroundLogo';
import { useApp } from '../contexts/AppContext';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

const AccessibilitySetupScreen = () => {
  const { state, dispatch } = useApp();
  const [fadeAnim] = useState(new Animated.Value(0));

  const theme = useMemo(() => getThemeConfig(state.accessibilitySettings.isDarkMode), [state.accessibilitySettings.isDarkMode]);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const gradientColors = theme.gradient as [string, string, ...string[]];
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();

    // Welcome message
    if (state.voiceAnnouncementsEnabled) {
      ttsSpeakText(
        'Welcome to EverySense! Let\'s set up your accessibility preferences for the best experience.',
        {
          rate: state.accessibilitySettings.voiceSpeed,
          pitch: 1.0,
        }
      );    
    }
  }, []);

  const handleSaveSettings = (settings: {
    brightness: number;
    textZoom: number;
    voiceSpeed: number;
  }) => {
    // Update accessibility settings
    dispatch({
      type: 'UPDATE_ACCESSIBILITY_SETTINGS',
      payload: {
        brightness: settings.brightness,
        textZoom: settings.textZoom,
        voiceSpeed: settings.voiceSpeed,
      },
    });

    // Mark setup as completed
    dispatch({ type: 'COMPLETE_SETUP' });

    // Success feedback
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleClose = () => {
    // This shouldn't be called as the popup is not dismissible
    // until settings are saved
  };

  return (
    <LinearGradient colors={gradientColors} style={styles.container}>
      <BackgroundLogo />
      <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
        <View style={styles.header}>
          <EverySenseLogo size={100} showText={true} />
          <Text style={styles.welcomeText}>Welcome to EverySense!</Text>
          <Text style={styles.subtitleText}>Let's customize your accessibility experience</Text>
        </View>

        <View style={styles.instructionsContainer}>
          <Text style={styles.instructionsTitle}>Setting Up Your Preferences</Text>
          <Text style={styles.instructionsText}>The setup screen will appear below. You can adjust:</Text>
          
          <View style={styles.featureList}>
            <View style={styles.featureItem}>
              <Text style={styles.featureIcon}>☀️</Text>
              <Text style={styles.featureText}>Display Brightness</Text>
            </View>
            <View style={styles.featureItem}>
              <Text style={styles.featureIcon}>📝</Text>
              <Text style={styles.featureText}>Text Size & Zoom</Text>
            </View>
            <View style={styles.featureItem}>
              <Text style={styles.featureIcon}>🎤</Text>
              <Text style={styles.featureText}>Voice Speed Control</Text>
            </View>
            <View style={styles.featureItem}>
              <Text style={styles.featureIcon}>🗣️</Text>
              <Text style={styles.featureText}>Voice Commands</Text>
            </View>
          </View>

          <Text style={styles.instructionsNote}>
            Use voice commands like "Increase brightness" or "Make text bigger" to control the settings hands-free.
          </Text>
        </View>
      </Animated.View>

      {/* Accessibility Setup Popup */}
      <AccessibilitySetupPopup
        visible={true}
        onSave={handleSaveSettings}
        onClose={handleClose}
        theme={theme}
      />
    </LinearGradient>
  );
};

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
    },
    content: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 30,
      paddingVertical: 40,
    },
    header: {
      alignItems: 'center',
      marginBottom: 40,
    },
    welcomeText: {
      fontSize: 32,
      fontWeight: 'bold',
      color: theme.textInverted,
      marginTop: 20,
      textAlign: 'center',
      textShadowColor: 'rgba(0, 0, 0, 0.35)',
      textShadowOffset: { width: 0, height: 3 },
      textShadowRadius: 6,
    },
    subtitleText: {
      fontSize: 18,
      color: theme.textInverted,
      opacity: 0.9,
      marginTop: 8,
      textAlign: 'center',
    },
    instructionsContainer: {
      backgroundColor: theme.isDark ? 'rgba(15, 23, 42, 0.65)' : 'rgba(255, 255, 255, 0.85)',
      borderRadius: 20,
      padding: 24,
      width: '100%',
      maxWidth: 400,
      borderWidth: theme.isDark ? 1 : 0.5,
      borderColor: theme.cardBorder,
      shadowColor: theme.cardShadow,
      shadowOffset: { width: 0, height: theme.isDark ? 6 : 3 },
      shadowOpacity: theme.isDark ? 0.35 : 0.12,
      shadowRadius: theme.isDark ? 18 : 10,
      elevation: theme.isDark ? 10 : 4,
    },
    instructionsTitle: {
      fontSize: 20,
      fontWeight: 'bold',
      color: theme.textInverted,
      textAlign: 'center',
      marginBottom: 16,
    },
    instructionsText: {
      fontSize: 16,
      color: theme.isDark ? '#CBD5F5' : theme.textSecondary,
      textAlign: 'center',
      marginBottom: 20,
      lineHeight: 22,
    },
    featureList: {
      marginBottom: 20,
    },
    featureItem: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 12,
      paddingVertical: 8,
    },
    featureIcon: {
      fontSize: 20,
      marginRight: 12,
      width: 30,
      textAlign: 'center',
    },
    featureText: {
      fontSize: 16,
      color: theme.textInverted,
      fontWeight: '500',
      flex: 1,
    },
    instructionsNote: {
      fontSize: 14,
      color: theme.isDark ? '#CBD5F5' : theme.textSecondary,
      textAlign: 'center',
      fontStyle: 'italic',
      lineHeight: 20,
    },
  });

export default AccessibilitySetupScreen;