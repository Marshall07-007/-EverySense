import { Ionicons } from '@expo/vector-icons';
import * as Brightness from 'expo-brightness';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { speakText as ttsSpeakText, stopSpeaking as ttsStopSpeaking } from '../services/ttsService';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { AppTheme, getThemeConfig } from '../../constants/theme';
import { useApp } from '../contexts/AppContext';
import { EverySenseLogo } from './EverySenseLogo';
import { ModernButton } from './ModernButton';

const { height: screenHeight } = Dimensions.get('window');

interface AccessibilitySetupPopupProps {
  visible: boolean;
  onSave: (settings: {
    brightness: number;
    textZoom: number;
    voiceSpeed: number;
  }) => void;
  onClose: () => void;
  theme?: AppTheme;
}

const BRIGHTNESS_LEVELS = [
  { label: 'Low', value: 25 },
  { label: 'Mid', value: 50 },
  { label: 'High', value: 75 },
  { label: 'Extra High', value: 100 },
];

const TEXT_ZOOM_LEVELS = [
  { label: 'Low', value: 80 },
  { label: 'Mid', value: 100 },
  { label: 'High', value: 140 },
  { label: 'Extra High', value: 180 },
];

const VOICE_SPEED_LEVELS = [
  { label: 'Low', value: 0.5 },
  { label: 'Mid', value: 1.0 },
  { label: 'High', value: 1.5 },
  { label: 'Extra High', value: 2.0 },
];

interface LevelSelectorProps {
  levels: { label: string; value: number }[];
  selectedValue: number;
  onSelect: (value: number) => void;
  theme: AppTheme;
}

const LevelSelector: React.FC<LevelSelectorProps> = ({ levels, selectedValue, onSelect, theme }) => {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {levels.map((level) => {
        const isActive = selectedValue === level.value;
        return (
          <TouchableOpacity
            key={level.label}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onSelect(level.value);
            }}
            style={[
              selectorStyles.pill,
              isActive
                ? { backgroundColor: theme.accent, borderColor: theme.accent }
                : { backgroundColor: theme.cardBackground, borderColor: theme.cardBorder },
            ]}
            accessibilityLabel={level.label}
            accessibilityRole="button"
          >
            <Text
              style={[
                selectorStyles.pillText,
                { color: isActive ? '#FFFFFF' : theme.textSecondary },
              ]}
            >
              {level.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const selectorStyles = StyleSheet.create({
  pill: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
  },
});

export const AccessibilitySetupPopup: React.FC<AccessibilitySetupPopupProps> = ({
  visible,
  onSave,
  onClose,
  theme,
}) => {
  const { state } = useApp();
  const [brightness, setBrightness] = useState(50);
  const [textZoom, setTextZoom] = useState(100);
  const [voiceSpeed, setVoiceSpeed] = useState(1.0);
  const [fadeAnim] = useState(new Animated.Value(0));
  const [slideAnim] = useState(new Animated.Value(screenHeight));

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.spring(slideAnim, {
          toValue: 0,
          tension: 80,
          friction: 9,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: screenHeight,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  useEffect(() => {
    Brightness.setBrightnessAsync(brightness / 100);
  }, [brightness]);

  const speakText = (text: string) => {
    if (!state.voiceAnnouncementsEnabled) return;
    ttsSpeakText(text, {
      rate: voiceSpeed,
      pitch: 1.0,
    });
  };

  const handleSaveAndContinue = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    speakText('Settings saved successfully. Welcome to EverySense!');
    onSave({ brightness, textZoom, voiceSpeed });
    Brightness.setBrightnessAsync(brightness / 100);
  };

  const resolvedTheme = useMemo(() => theme ?? getThemeConfig(false), [theme]);
  const styles = useMemo(() => createStyles(resolvedTheme), [resolvedTheme]);
  const popupGradient = (resolvedTheme.isDark
    ? ['#1F2937', '#0B1120']
    : ['#FFFFFF', '#F8F9FA']) as [string, string, ...string[]];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
        <Animated.View
          style={[
            styles.sheetWrapper,
            { transform: [{ translateY: slideAnim }] },
          ]}
        >
          <LinearGradient colors={popupGradient} style={styles.popup}>
            {/* Drag handle */}
            <View style={styles.handle} />

            {/* Header */}
            <View style={styles.header}>
              <EverySenseLogo size={32} showText={false} />
              <View style={styles.headerText}>
                <Text style={styles.title}>Accessibility Setup</Text>
                <Text style={styles.subtitle}>Customize your experience</Text>
              </View>
            </View>

            {/* Settings */}
            <View style={styles.settingsContainer}>
              {/* Brightness */}
              <View style={styles.settingRow}>
                <View style={styles.settingLabel}>
                  <Ionicons name="sunny" size={20} color="#FFA726" />
                  <Text style={styles.settingTitle}>Display Brightness</Text>
                </View>
                <LevelSelector
                  levels={BRIGHTNESS_LEVELS}
                  selectedValue={brightness}
                  onSelect={setBrightness}
                  theme={resolvedTheme}
                />
              </View>

              <View style={styles.divider} />

              {/* Text Size */}
              <View style={styles.settingRow}>
                <View style={styles.settingLabel}>
                  <Ionicons name="text" size={20} color={resolvedTheme.accent} />
                  <Text style={styles.settingTitle}>Text Size</Text>
                </View>
                <LevelSelector
                  levels={TEXT_ZOOM_LEVELS}
                  selectedValue={textZoom}
                  onSelect={setTextZoom}
                  theme={resolvedTheme}
                />
              </View>

              <View style={styles.divider} />

              {/* Voice Speed */}
              <View style={styles.settingRow}>
                <View style={styles.settingLabel}>
                  <Ionicons name="volume-high" size={20} color={resolvedTheme.success} />
                  <Text style={styles.settingTitle}>Voice Speed</Text>
                </View>
                <LevelSelector
                  levels={VOICE_SPEED_LEVELS}
                  selectedValue={voiceSpeed}
                  onSelect={setVoiceSpeed}
                  theme={resolvedTheme}
                />
              </View>
            </View>

            {/* Save Button */}
            <ModernButton
              title="Save & Continue"
              onPress={handleSaveAndContinue}
              variant="primary"
              size="large"
              icon={<Ionicons name="checkmark" size={20} color="white" />}
              style={styles.saveButton}
            />
          </LinearGradient>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: theme.overlay,
      justifyContent: 'flex-end',
    },
    sheetWrapper: {
      width: '100%',
    },
    popup: {
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 36,
      shadowColor: theme.cardShadow,
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: theme.isDark ? 0.4 : 0.12,
      shadowRadius: 16,
      elevation: 20,
    },
    handle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.textSecondary,
      opacity: 0.3,
      alignSelf: 'center',
      marginBottom: 16,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 24,
    },
    headerText: {
      flex: 1,
    },
    title: {
      fontSize: 20,
      fontWeight: '700',
      color: theme.textPrimary,
    },
    subtitle: {
      fontSize: 13,
      color: theme.textSecondary,
      marginTop: 2,
    },
    settingsContainer: {
      backgroundColor: theme.cardBackground,
      borderRadius: 14,
      borderWidth: theme.isDark ? 1 : 0.5,
      borderColor: theme.cardBorder,
      marginBottom: 20,
      overflow: 'hidden',
    },
    settingRow: {
      paddingHorizontal: 16,
      paddingVertical: 14,
      gap: 10,
    },
    settingLabel: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 2,
    },
    settingTitle: {
      fontSize: 15,
      fontWeight: '600',
      color: theme.textPrimary,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.cardBorder,
      marginHorizontal: 16,
    },
    saveButton: {
      width: '100%',
    },
  });

export default AccessibilitySetupPopup;
