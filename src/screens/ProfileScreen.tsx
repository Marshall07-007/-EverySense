import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Brightness from 'expo-brightness';

// Voice-to-text (dev build only)
let ExpoSpeechRecognitionModule: any = null;
try {
  ExpoSpeechRecognitionModule = require('expo-speech-recognition').ExpoSpeechRecognitionModule;
} catch {};
import * as Haptics from 'expo-haptics';
import * as ImageManipulator from 'expo-image-manipulator';
import { LinearGradient } from 'expo-linear-gradient';
import * as Speech from 'expo-speech';
import { speakText as ttsSpeakText, stopSpeaking as ttsStopSpeaking } from '../services/ttsService';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Image,
  Modal,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { AppTheme, getThemeConfig } from '../../constants/theme';

import { useApp } from '../contexts/AppContext';
import { supabase } from '../../lib/supabase';
import { voiceManager } from '../utils/voiceCommandManager';
import SocialSection from '../../components/social/SocialSection';
import { navigationRef } from '../navigation/AppNavigator';

// Constants
let ImagePicker: any = null;
try {
  ImagePicker = require('expo-image-picker');
} catch {}

const { width: screenWidth } = Dimensions.get('window');
const ANIMATION_DURATION = 600;

// Utility Functions
const getBrightnessLabel = (value: number): string => {
  if (value <= 25) return 'Low';
  if (value <= 50) return 'Medium';
  if (value <= 75) return 'High';
  return 'Maximum';
};

const getTextZoomLabel = (value: number): string => {
  if (value <= 90) return 'Small';
  if (value <= 110) return 'Normal';
  if (value <= 140) return 'Large';
  return 'Extra Large';
};

const getVoiceSpeedLabel = (value: number): string => {
  if (value <= 0.7) return 'Slow';
  if (value <= 1.3) return 'Normal';
  return 'Fast';
};

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
  accentColor: string;
}

const LevelSelector: React.FC<LevelSelectorProps> = ({ levels, selectedValue, onSelect, accentColor }) => (
  <View style={{ flexDirection: 'row', gap: 6, marginTop: 10 }}>
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
            lvlStyles.pill,
            {
              backgroundColor: isActive ? accentColor : accentColor + '15',
              borderColor: isActive ? accentColor : accentColor + '40',
            },
          ]}
          accessibilityLabel={level.label}
          accessibilityRole="button"
        >
          <Text style={[lvlStyles.pillText, { color: isActive ? '#FFFFFF' : accentColor }]}>
            {level.label}
          </Text>
        </TouchableOpacity>
      );
    })}
  </View>
);

const lvlStyles = StyleSheet.create({
  pill: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: {
    fontSize: 11,
    fontWeight: '700',
  },
});

// ── Reusable sub-components ────────────────────────────────────────────────

interface InfoRowProps {
  icon: string;
  color: string;
  label: string;
  value: string;
  isLast?: boolean;
  theme: AppTheme;
}

const InfoRow: React.FC<InfoRowProps> = ({ icon, color, label, value, isLast = false, theme }) => (
  <View style={[s.row, !isLast && { borderBottomWidth: 1, borderBottomColor: theme.cardBorder }]}>
    <View style={[s.rowIcon, { backgroundColor: color + '22' }]}>
      <Ionicons name={icon as any} size={16} color={color} />
    </View>
    <View style={s.rowContent}>
      <Text style={[s.rowLabel, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[s.rowValue, { color: theme.textPrimary }]} numberOfLines={2}>{value}</Text>
    </View>
  </View>
);

interface AppInfoRowProps {
  label: string;
  value: string;
  isLast?: boolean;
  theme: AppTheme;
}

const AppInfoRow: React.FC<AppInfoRowProps> = ({ label, value, isLast = false, theme }) => (
  <View style={[s.infoSimpleRow, !isLast && { borderBottomWidth: 1, borderBottomColor: theme.cardBorder }]}>
    <Text style={[s.infoSimpleLabel, { color: theme.textMuted }]}>{label}</Text>
    <Text style={[s.infoSimpleValue, { color: theme.textPrimary }]}>{value}</Text>
  </View>
);

interface JoinDateModalProps {
  visible: boolean;
  onClose: () => void;
  theme: AppTheme;
  joinDate: Date | null;
  formattedJoinDate: string;
}

const JoinDateModal: React.FC<JoinDateModalProps> = ({ visible, onClose, theme, joinDate, formattedJoinDate }) => (
  <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
    <View style={s.modalBackdrop}>
      <TouchableOpacity style={s.modalBackdropTouchable} onPress={onClose} accessible={false}>
        <View />
      </TouchableOpacity>
      <View style={[s.joinDateModal, { backgroundColor: theme.cardBackground, borderColor: theme.cardBorder }]}>
        <View style={s.modalHeaderRow}>
          <View style={[s.calendarBadge, { backgroundColor: theme.accent }]}>
            <Ionicons name="calendar" size={20} color="white" />
          </View>
          <View style={s.modalHeaderTextWrapper}>
            <Text style={[s.modalTitle, { color: theme.textPrimary }]}>Membership details</Text>
            <Text style={[s.modalSubtitle, { color: theme.textSecondary }]}>Tap anywhere outside to close</Text>
          </View>
          <TouchableOpacity
            onPress={onClose}
            accessibilityLabel="Close membership details"
            accessibilityRole="button"
          >
            <Ionicons name="close" size={22} color={theme.textSecondary} />
          </TouchableOpacity>
        </View>

        <View style={[s.calendarCard, { backgroundColor: theme.inputBackground, borderColor: theme.cardBorder }]}>
          <Text style={[s.calendarMonth, { color: theme.accent }]}>
            {joinDate ? joinDate.toLocaleString(undefined, { month: 'short' }) : '--'}
          </Text>
          <Text style={[s.calendarDay, { color: theme.textPrimary }]}>
            {joinDate ? joinDate.getDate() : '--'}
          </Text>
          <Text style={[s.calendarYear, { color: theme.textSecondary }]}>
            {joinDate ? joinDate.getFullYear() : 'N/A'}
          </Text>
        </View>

        <Text style={[s.modalDescription, { color: theme.textSecondary }]}>
          {joinDate ? `You joined EverySense on ${formattedJoinDate}.` : 'We could not find your join date yet.'}
        </Text>
      </View>
    </View>
  </Modal>
);

// ── Main Component ─────────────────────────────────────────────────────────

const ProfileScreen = () => {
  const { state, dispatch } = useApp();
  const [isEditingPersonal, setIsEditingPersonal] = useState(false);
  const isEditingProfileRef = useRef(false); // mirrors isEditingPersonal for voice command closures
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(state.accessibilitySettings.isDarkMode);
  const [isJoinDateModalVisible, setIsJoinDateModalVisible] = useState(false);
  const [profileData, setProfileData] = useState({
    name: state.user?.name || '',
    email: state.user?.email || '',
    bio: state.user?.bio || '',
    weight: state.user?.weight || '',
    height: state.user?.height || '',
    bloodGroup: state.user?.bloodGroup || '',
    allergies: state.user?.allergies || '',
    medicalConditions: state.user?.medicalConditions || '',
    medications: state.user?.medications || '',
    profilePhoto: state.user?.profilePhoto || '',
    emergencyContactName: state.user?.emergencyContactName || '',
    emergencyContactRelationship: state.user?.emergencyContactRelationship || '',
    emergencyContactPhone: state.user?.emergencyContactPhone || '',
  });

  // Local state for sliders — only used to drive the slider visual; context is NOT updated mid-drag
  const [brightnessValue, setBrightnessValue] = useState(state.accessibilitySettings.brightness);
  const [textZoomValue, setTextZoomValue] = useState(state.accessibilitySettings.textZoom);
  const [voiceSpeedValue, setVoiceSpeedValue] = useState(state.accessibilitySettings.voiceSpeed);

  // Voice-to-text
  const [listeningField, setListeningField] = useState<string | null>(null);
  const [showCommunity, setShowCommunity]   = useState(false);
  const voiceListenersRef = useRef<any[]>([]);

  const cleanupVoiceListeners = () => {
    voiceListenersRef.current.forEach(l => { try { l?.remove(); } catch {} });
    voiceListenersRef.current = [];
  };

  const startVoiceInput = (field: string) => {
    if (!ExpoSpeechRecognitionModule) {
      Alert.alert('Voice Input', 'Voice input requires a development build. You can still type in the field directly.');
      return;
    }
    cleanupVoiceListeners();
    setListeningField(field);

    const onResult = ExpoSpeechRecognitionModule.addListener('result', (e: any) => {
      const transcript = e.results?.[0]?.transcript;
      if (transcript && e.isFinal) {
        updateProfileField(field as any, transcript);
        setListeningField(null);
        cleanupVoiceListeners();
      }
    });
    const onEnd = ExpoSpeechRecognitionModule.addListener('end', () => {
      setListeningField(null);
      cleanupVoiceListeners();
    });
    const onError = ExpoSpeechRecognitionModule.addListener('error', () => {
      setListeningField(null);
      cleanupVoiceListeners();
    });
    voiceListenersRef.current = [onResult, onEnd, onError];

    ExpoSpeechRecognitionModule.requestPermissionsAsync().then((r: any) => {
      if (r.granted) {
        ExpoSpeechRecognitionModule.start({ lang: 'en-US', interimResults: false, maxAlternatives: 1 });
      } else {
        setListeningField(null);
        cleanupVoiceListeners();
      }
    });
  };

  // Animation refs
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const profileScaleAnim = useRef(new Animated.Value(0)).current;

  const theme = useMemo(() => getThemeConfig(isDarkMode), [isDarkMode]);
  const joinDate = useMemo(() => (state.user?.joinDate ? new Date(state.user.joinDate) : null), [state.user?.joinDate]);
  const formattedJoinDate = useMemo(
    () => joinDate?.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) || 'Join date not available',
    [joinDate]
  );

  // Sync profileData from context whenever AppContext updates user fields asynchronously
  useEffect(() => {
    if (isEditingPersonal) return;
    setProfileData(prev => ({
      ...prev,
      name: state.user?.name || prev.name,
      bio: state.user?.bio || prev.bio,
      profilePhoto: state.user?.profilePhoto || prev.profilePhoto,
      weight: state.user?.weight || prev.weight,
      height: state.user?.height || prev.height,
      bloodGroup: state.user?.bloodGroup || prev.bloodGroup,
      allergies: state.user?.allergies || prev.allergies,
      medicalConditions: state.user?.medicalConditions || prev.medicalConditions,
      medications: state.user?.medications || prev.medications,
      emergencyContactName: state.user?.emergencyContactName || prev.emergencyContactName,
      emergencyContactRelationship: state.user?.emergencyContactRelationship || prev.emergencyContactRelationship,
      emergencyContactPhone: state.user?.emergencyContactPhone || prev.emergencyContactPhone,
    }));
  }, [state.user?.name, state.user?.bio, state.user?.profilePhoto, state.user?.weight, state.user?.height, state.user?.bloodGroup, state.user?.allergies, state.user?.medicalConditions, state.user?.medications, state.user?.emergencyContactName, state.user?.emergencyContactRelationship, state.user?.emergencyContactPhone]);

  // Keep ref in sync so voice command closures always read the current value
  useEffect(() => {
    isEditingProfileRef.current = isEditingPersonal;
  }, [isEditingPersonal]);

  // Initialize animations and voice commands
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: ANIMATION_DURATION,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: ANIMATION_DURATION,
        useNativeDriver: true,
      }),
      Animated.spring(profileScaleAnim, {
        toValue: 1,
        tension: 40,
        friction: 6,
        delay: 200,
        useNativeDriver: true,
      }),
    ]).start();

    setupVoiceCommands();
    voiceManager.announceScreenChange('profile');
    speakText('Profile screen. You can edit your information or adjust accessibility settings.');

    return cleanupVoiceCommands;
  }, []);

  const setupVoiceCommands = () => {
    voiceManager.addCommand({
      keywords: ['edit profile', 'edit information', 'update profile'],
      action: () => {
        const currently = isEditingProfileRef.current;
        setIsEditingPersonal(!currently);
        speakText(currently ? 'Profile editing disabled' : 'Profile editing enabled');
      },
      description: 'Toggle profile editing mode',
      category: 'general',
    });

    voiceManager.addCommand({
      keywords: ['save profile', 'save changes', 'update information'],
      action: () => handleSaveProfile(),
      description: 'Save profile changes',
      category: 'general',
    });

    voiceManager.addCommand({
      keywords: ['logout', 'sign out', 'log out'],
      action: handleLogout,
      description: 'Log out of your account',
      category: 'general',
    });
  };

  const cleanupVoiceCommands = () => {
    voiceManager.removeCommand(['edit profile', 'edit information', 'update profile']);
    voiceManager.removeCommand(['save profile', 'save changes', 'update information']);
    voiceManager.removeCommand(['logout', 'sign out', 'log out']);
  };

  const speakText = (text: string) => {
    if (!state.voiceAnnouncementsEnabled) return;
    const safeRate = Math.max(0.5, Math.min(state.accessibilitySettings.voiceSpeed, 2.0));
    ttsSpeakText(text, { rate: safeRate, pitch: 1.0 });
  };

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: () => {
          dispatch({ type: 'LOGOUT' });
          speakText('You have been logged out successfully');
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        },
      },
    ]);
  };

  const handleProfilePicture = async () => {
    if (!ImagePicker) {
      Alert.alert('Unavailable', 'Image picking is unavailable in this environment.');
      return;
    }

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow photo library access to set a profile picture.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
        allowsEditing: true,
        aspect: [1, 1],
      });

      if (!result.canceled && result.assets?.[0]?.uri) {
        const uri = result.assets[0].uri;
        setIsUploadingPhoto(true);

        try {
          // Resize + compress to JPEG and get base64 (no extra packages needed)
          const manipResult = await ImageManipulator.manipulateAsync(
            uri,
            [{ resize: { width: 400 } }],
            { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
          );
          if (!manipResult.base64) throw new Error('Failed to process image');

          // Convert base64 → Uint8Array for Supabase Storage upload
          const binaryString = atob(manipResult.base64);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }

          const filePath = `${state.user!.id}/avatar.jpg`;
          const { error: uploadError } = await supabase.storage
            .from('avatars')
            .upload(filePath, bytes, { contentType: 'image/jpeg', upsert: true });

          if (uploadError) throw uploadError;

          // Get the permanent public URL
          const { data: { publicUrl } } = supabase.storage
            .from('avatars')
            .getPublicUrl(filePath);

          // Save avatar_url to profiles table
          await supabase.from('profiles').upsert({
            id: state.user!.id,
            avatar_url: publicUrl,
          });

          // Update local state with the public URL so it persists across reinstalls
          setProfileData(prev => ({ ...prev, profilePhoto: publicUrl }));
          dispatch({ type: 'UPDATE_USER', payload: { profilePhoto: publicUrl } });
          speakText('Profile picture updated');
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        } catch (uploadErr) {
          console.warn('Failed to upload photo to Supabase:', uploadErr);
          // Fallback: store local URI (works until reinstall)
          setProfileData(prev => ({ ...prev, profilePhoto: uri }));
          dispatch({ type: 'UPDATE_USER', payload: { profilePhoto: uri } });
          speakText('Profile picture updated locally');
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        } finally {
          setIsUploadingPhoto(false);
        }
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to update profile picture');
      setIsUploadingPhoto(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!profileData.name.trim()) {
      Alert.alert('Name Required', 'Please enter your name.');
      speakText('Please enter your name');
      return;
    }

    // Update local state immediately so UI reflects changes at once
    dispatch({
      type: 'UPDATE_USER',
      payload: { ...state.user!, ...profileData },
    });

    setIsSaving(true);
    try {
      await supabase.auth.updateUser({ data: { name: profileData.name.trim() } });
      await supabase.from('profiles').upsert({
        id: state.user!.id,
        name: profileData.name.trim(),
        blood_group: profileData.bloodGroup.trim(),
        weight: profileData.weight.trim(),
        height: profileData.height.trim(),
        allergies: profileData.allergies.trim(),
        medical_conditions: profileData.medicalConditions.trim(),
        medications: profileData.medications.trim(),
        emergency_contact_name: profileData.emergencyContactName.trim(),
        emergency_contact_relationship: profileData.emergencyContactRelationship.trim(),
        emergency_contact_phone: profileData.emergencyContactPhone.trim(),
      });
      setIsEditingPersonal(false);
      speakText('Profile updated successfully');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert('Save Failed', 'Could not save your profile. Please try again.');
      speakText('Failed to save profile. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAccessibilityChange = (setting: string, value: number | boolean) => {
    dispatch({
      type: 'UPDATE_ACCESSIBILITY_SETTINGS',
      payload: { [setting]: value },
    });

    if (setting === 'brightness') {
      Brightness.setBrightnessAsync((value as number) / 100);
    }

    if (setting === 'isDarkMode') {
      speakText(`Dark mode ${value ? 'on' : 'off'}`);
    } else if (setting === 'brightness') {
      speakText(`Brightness set to ${getBrightnessLabel(value as number)}`);
    } else if (setting === 'textZoom') {
      speakText(`Text size set to ${getTextZoomLabel(value as number)}`);
    } else if (setting === 'voiceSpeed') {
      speakText(`Voice speed set to ${getVoiceSpeedLabel(value as number)}`);
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleDarkModeToggle = (value: boolean) => {
    setIsDarkMode(value);
    handleAccessibilityChange('isDarkMode', value);
  };

  const updateProfileField = (field: keyof typeof profileData, value: string) => {
    setProfileData({ ...profileData, [field]: value });
  };

  // ── Health info rows config ──
  const healthRows = [
    { icon: 'barbell-outline',  color: '#FF7043', label: 'Weight',     value: profileData.weight },
    { icon: 'resize-outline',   color: '#AB47BC', label: 'Height',     value: profileData.height },
    { icon: 'water-outline',    color: '#E53935', label: 'Blood Group',value: profileData.bloodGroup },
    { icon: 'warning-outline',  color: '#FFA726', label: 'Allergies',  value: profileData.allergies },
    { icon: 'medkit-outline',   color: '#26A69A', label: 'Conditions', value: profileData.medicalConditions },
    { icon: 'flask-outline',    color: '#42A5F5', label: 'Medications',value: profileData.medications },
  ].filter(r => r.value);

  const emergencyRows = [
    { icon: 'person-outline',   color: '#D32F2F', label: 'Contact',      value: profileData.emergencyContactName },
    { icon: 'heart-outline',    color: '#D32F2F', label: 'Relationship', value: profileData.emergencyContactRelationship },
    { icon: 'call-outline',     color: '#D32F2F', label: 'Phone',        value: profileData.emergencyContactPhone },
  ].filter(r => r.value);

  const profileRows = [
    ...(profileData.bio ? [{ icon: 'document-text-outline', color: theme.accent, label: 'Bio', value: profileData.bio }] : []),
    ...healthRows,
    ...emergencyRows,
  ];

  if (!state.user) {
    return (
      <SafeAreaView style={[s.safe, { backgroundColor: theme.background }]}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: theme.textSecondary, fontSize: 16 }}>Signing out...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <>
      <JoinDateModal
        visible={isJoinDateModalVisible}
        onClose={() => setIsJoinDateModalVisible(false)}
        theme={theme}
        joinDate={joinDate}
        formattedJoinDate={formattedJoinDate}
      />

      <SafeAreaView style={[s.safe, { backgroundColor: theme.background }]}>
        <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor={theme.background} />

        <Animated.View style={[s.flex, { opacity: fadeAnim }]}>
          <ScrollView
            contentContainerStyle={s.scroll}
            showsVerticalScrollIndicator={false}
          >

            {/* ── Hero ── */}
            <View style={s.hero}>
              <TouchableOpacity
                onPress={handleProfilePicture}
                disabled={isUploadingPhoto}
                accessibilityLabel="Profile picture"
                style={s.avatarWrap}
              >
                <LinearGradient
                  colors={[theme.accent, '#357ABD']}
                  style={s.avatarRing}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  {profileData.profilePhoto ? (
                    <Image source={{ uri: profileData.profilePhoto }} style={s.avatarImg} />
                  ) : (
                    <View style={[s.avatarPlaceholder, { backgroundColor: theme.cardBackground }]}>
                      <Ionicons name="person" size={46} color={theme.accent} />
                    </View>
                  )}
                  {isUploadingPhoto && (
                    <View style={s.avatarOverlay}>
                      <ActivityIndicator size="large" color="white" />
                    </View>
                  )}
                </LinearGradient>
                <View style={[s.cameraBadge, { backgroundColor: theme.accent }]}>
                  {isUploadingPhoto
                    ? <ActivityIndicator size="small" color="white" />
                    : <Ionicons name="camera" size={14} color="white" />}
                </View>
              </TouchableOpacity>

              <Text style={[s.heroName, { color: theme.textPrimary }]}>
                {state.user?.name || 'User'}
              </Text>
              <Text style={[s.heroEmail, { color: theme.textMuted }]}>
                {state.user?.email || 'user@example.com'}
              </Text>

              <View style={s.heroBadges}>
                <View style={[s.badge, { backgroundColor: theme.accent + '22' }]}>
                  <Ionicons name="shield-checkmark" size={12} color={theme.accent} />
                  <Text style={[s.badgeText, { color: theme.accent }]}>Verified</Text>
                </View>
                <TouchableOpacity
                  style={[s.badge, { backgroundColor: '#10b981' + '22' }]}
                  onPress={() => setIsJoinDateModalVisible(true)}
                  accessibilityLabel="Membership status"
                  accessibilityHint="Shows the date you joined"
                >
                  <Ionicons name="calendar-outline" size={12} color="#10b981" />
                  <Text style={[s.badgeText, { color: '#10b981' }]}>Member</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* ── Emergency Card banner ── */}
            <TouchableOpacity
              onPress={() => navigationRef.current?.navigate('EmergencyCard')}
              style={s.emergencyBtn}
              accessibilityLabel="Open emergency card"
            >
              <LinearGradient
                colors={['#DC2626', '#EF4444']}
                style={s.emergencyGrad}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                <View style={s.emergencyLeft}>
                  <View style={s.emergencyIcon}>
                    <Text style={{ fontSize: 22 }}>🆘</Text>
                  </View>
                  <View>
                    <Text style={s.emergencyTitle}>Emergency Card</Text>
                    <Text style={s.emergencySub}>Blood type · Allergies · Emergency contact</Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.8)" />
              </LinearGradient>
            </TouchableOpacity>

            {/* ── Profile Information ── */}
            <View style={s.section}>
              <Text style={[s.sectionLabel, { color: theme.textMuted }]}>PROFILE</Text>

              {/* Prominent Edit Profile button */}
              <TouchableOpacity
                onPress={() => setIsEditingPersonal(true)}
                accessibilityLabel="Edit profile"
                style={[s.editProfileBtn, { backgroundColor: theme.cardBackground, borderColor: theme.accent + '55' }]}
              >
                <View style={[s.editProfileIconWrap, { backgroundColor: theme.accent + '18' }]}>
                  <Ionicons name="person-circle-outline" size={22} color={theme.accent} />
                </View>
                <View style={s.editProfileTextWrap}>
                  <Text style={[s.editProfileTitle, { color: theme.textPrimary }]}>Edit Profile</Text>
                  <Text style={[s.editProfileSub, { color: theme.textMuted }]}>Update health info, emergency contact & more</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.accent} />
              </TouchableOpacity>

              <View style={[s.card, { backgroundColor: theme.cardBackground, borderColor: theme.cardBorder }]}>
                {profileRows.length === 0 ? (
                  <View style={s.emptyState}>
                    <Ionicons name="person-circle-outline" size={32} color={theme.textMuted} />
                    <Text style={[s.emptyStateText, { color: theme.textMuted }]}>
                      Tap Edit to add your health information.
                    </Text>
                  </View>
                ) : (
                  profileRows.map((row, idx) => (
                    <InfoRow
                      key={row.label}
                      icon={row.icon}
                      color={row.color}
                      label={row.label}
                      value={row.value}
                      isLast={idx === profileRows.length - 1}
                      theme={theme}
                    />
                  ))
                )}
              </View>
            </View>

            {/* ── Community — single entry button ── */}
            {state.user && (
              <View style={s.section}>
                <Text style={[s.sectionLabel, { color: theme.textMuted }]}>COMMUNITY</Text>
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => setShowCommunity(true)}
                  accessibilityLabel="Open community"
                  style={s.communityBtn}
                >
                  <LinearGradient
                    colors={['#4C1D95', '#7C3AED', '#A855F7']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={s.communityBtnGradient}
                  >
                    <View style={s.communityBtnLeft}>
                      <View style={s.communityIconBox}>
                        <Text style={{ fontSize: 28 }}>🌍</Text>
                      </View>
                      <View>
                        <Text style={s.communityBtnTitle}>Community</Text>
                        <Text style={s.communityBtnSub}>
                          Connect · Discover · Chat
                        </Text>
                      </View>
                    </View>
                    <Ionicons name="chevron-forward" size={22} color="rgba(255,255,255,0.8)" />
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            )}

            {/* ── Community Modal ── */}
            <Modal
              visible={showCommunity}
              animationType="slide"
              presentationStyle="pageSheet"
              onRequestClose={() => setShowCommunity(false)}
            >
              <SafeAreaView style={[s.communityModal, { backgroundColor: theme.background }]}>
                <View style={[s.communityModalHeader, { borderBottomColor: theme.cardBorder }]}>
                  <Text style={[s.communityModalTitle, { color: theme.textPrimary }]}>🌍 Community</Text>
                  <TouchableOpacity
                    onPress={() => setShowCommunity(false)}
                    style={[s.communityCloseBtn, { backgroundColor: theme.cardBackground }]}
                    accessibilityLabel="Close community"
                  >
                    <Ionicons name="close" size={20} color={theme.textPrimary} />
                  </TouchableOpacity>
                </View>
                <ScrollView showsVerticalScrollIndicator={false}>
                  <SocialSection
                    userId={state.user.id}
                    userName={state.user.name}
                    ui={{
                      bg: theme.background,
                      cardBg: theme.cardBackground,
                      text: theme.textPrimary,
                      subtext: theme.textSecondary,
                      divider: theme.cardBorder,
                      accent: theme.accent,
                      inputBg: theme.inputBackground,
                      inputBorder: theme.inputBorder,
                      inputText: theme.textPrimary,
                      danger: theme.danger,
                    }}
                    scale={(n: number) => n * (state.accessibilitySettings.textZoom / 100)}
                  />
                </ScrollView>
              </SafeAreaView>
            </Modal>

            {/* ── 2. ACCESSIBILITY ── */}
            <View style={s.section}>
              <Text style={[s.sectionLabel, { color: theme.accent }]}>ACCESSIBILITY</Text>
              <View style={[s.card, { backgroundColor: theme.cardBackground, borderColor: theme.cardBorder }]}>

                {/* Brightness */}
                <View style={s.accessibilityRow}>
                  <View style={s.accessibilityLabelRow}>
                    <View style={[s.rowIcon, { backgroundColor: 'rgba(214, 179, 106, 0.16)' }]}>
                      <Ionicons name="sunny-outline" size={16} color={theme.accent} />
                    </View>
                    <Text style={[s.accessibilityTitle, { color: theme.textPrimary }]}>Screen Brightness</Text>
                  </View>
                  <LevelSelector
                    levels={BRIGHTNESS_LEVELS}
                    selectedValue={brightnessValue}
                    onSelect={(value) => {
                      setBrightnessValue(value);
                      handleAccessibilityChange('brightness', value);
                    }}
                    accentColor={theme.accent}
                  />
                </View>

                <View style={[s.divider, { backgroundColor: theme.cardBorder }]} />

                {/* Text Size */}
                <View style={s.accessibilityRow}>
                  <View style={s.accessibilityLabelRow}>
                    <View style={[s.rowIcon, { backgroundColor: 'rgba(79, 124, 255, 0.16)' }]}>
                      <Ionicons name="text-outline" size={16} color={theme.blue} />
                    </View>
                    <Text style={[s.accessibilityTitle, { color: theme.textPrimary }]}>Text Scaling</Text>
                  </View>
                  <LevelSelector
                    levels={TEXT_ZOOM_LEVELS}
                    selectedValue={textZoomValue}
                    onSelect={(value) => {
                      setTextZoomValue(value);
                      handleAccessibilityChange('textZoom', value);
                    }}
                    accentColor={theme.accent}
                  />
                </View>
              </View>
            </View>

            {/* ── 3. VOICE & SPEECH ── */}
            <View style={s.section}>
              <Text style={[s.sectionLabel, { color: theme.accent }]}>VOICE & SPEECH</Text>
              <View style={[s.card, { backgroundColor: theme.cardBackground, borderColor: theme.cardBorder }]}>

                {/* Spoken Announcements */}
                <View style={s.darkModeRow}>
                  <View style={[s.rowIcon, { backgroundColor: 'rgba(53, 198, 163, 0.16)' }]}>
                    <Ionicons name="volume-high-outline" size={16} color={theme.teal} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.darkModeLabel, { color: theme.textPrimary }]}>Spoken Feedback</Text>
                    <Text style={{ fontSize: 11, color: theme.textSecondary }}>Speak results and navigation</Text>
                  </View>
                  <Switch
                    value={state.voiceAnnouncementsEnabled}
                    onValueChange={(val) => {
                      dispatch({ type: 'TOGGLE_VOICE_ANNOUNCEMENTS', payload: val });
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      speakText(`Voice announcements ${val ? 'enabled' : 'disabled'}`);
                    }}
                    trackColor={{ false: theme.inputBorder, true: theme.accent }}
                    thumbColor={state.voiceAnnouncementsEnabled ? theme.accent : '#FFFFFF'}
                    ios_backgroundColor={theme.inputBorder}
                    accessibilityLabel="Spoken feedback toggle"
                  />
                </View>

                <View style={[s.divider, { backgroundColor: theme.cardBorder }]} />

                {/* Voice Speed */}
                <View style={s.accessibilityRow}>
                  <View style={s.accessibilityLabelRow}>
                    <View style={[s.rowIcon, { backgroundColor: 'rgba(214, 179, 106, 0.16)' }]}>
                      <Ionicons name="speedometer-outline" size={16} color={theme.accent} />
                    </View>
                    <Text style={[s.accessibilityTitle, { color: theme.textPrimary }]}>Speech Rate</Text>
                  </View>
                  <LevelSelector
                    levels={VOICE_SPEED_LEVELS}
                    selectedValue={voiceSpeedValue}
                    onSelect={(value) => {
                      setVoiceSpeedValue(value);
                      handleAccessibilityChange('voiceSpeed', value);
                    }}
                    accentColor={theme.accent}
                  />
                </View>
              </View>
            </View>

            {/* ── 4. NOTIFICATIONS ── */}
            <View style={s.section}>
              <Text style={[s.sectionLabel, { color: theme.accent }]}>NOTIFICATIONS</Text>
              <View style={[s.card, { backgroundColor: theme.cardBackground, borderColor: theme.cardBorder }]}>
                <View style={s.darkModeRow}>
                  <View style={[s.rowIcon, { backgroundColor: 'rgba(214, 179, 106, 0.16)' }]}>
                    <Ionicons name="alarm-outline" size={16} color={theme.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.darkModeLabel, { color: theme.textPrimary }]}>Smart Reminders</Text>
                    <Text style={{ fontSize: 11, color: theme.textSecondary }}>Timely audio and push alerts</Text>
                  </View>
                  <Ionicons name="checkmark-circle" size={20} color={theme.success} />
                </View>
              </View>
            </View>

            {/* ── 5. PREFERENCES ── */}
            <View style={s.section}>
              <Text style={[s.sectionLabel, { color: theme.accent }]}>PREFERENCES</Text>
              <View style={[s.card, { backgroundColor: theme.cardBackground, borderColor: theme.cardBorder }]}>
                {/* Dark Mode */}
                <View style={s.darkModeRow}>
                  <View style={[s.rowIcon, { backgroundColor: 'rgba(214, 179, 106, 0.16)' }]}>
                    <Ionicons name="moon-outline" size={16} color={theme.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.darkModeLabel, { color: theme.textPrimary }]}>Midnight Theme</Text>
                    <Text style={{ fontSize: 11, color: theme.textSecondary }}>Deep Navy & Warm Ivory palette</Text>
                  </View>
                  <Switch
                    value={isDarkMode}
                    onValueChange={handleDarkModeToggle}
                    trackColor={{ false: theme.inputBorder, true: theme.accent }}
                    thumbColor={isDarkMode ? theme.accent : '#FFFFFF'}
                    ios_backgroundColor={theme.inputBorder}
                    accessibilityLabel="Midnight theme toggle"
                  />
                </View>

                <View style={[s.divider, { backgroundColor: theme.cardBorder }]} />

                <AppInfoRow label="Version" value="1.0.0" theme={theme} />
                <AppInfoRow label="Member Since" value={formattedJoinDate} isLast theme={theme} />
              </View>
            </View>

            {/* ── User Testing & Accessibility Feedback ── */}
            <View style={[s.sectionCard, { borderColor: theme.cardBorder, backgroundColor: theme.cardBackground, marginBottom: 16 }]}>
              <Text style={[s.sectionHeading, { color: theme.textPrimary }]}>♿ Accessibility Testing</Text>
              <Text style={[s.sectionSubtitle, { color: theme.textSecondary }]}>
                Help improve EverySense for everyone. Share your experience or report issues.
              </Text>
              <TouchableOpacity
                style={[s.testingBtn, { backgroundColor: theme.accent }]}
                onPress={() => (navigationRef.current as any)?.navigate('AccessibilityFeedback')}
                accessibilityLabel="Open accessibility feedback form"
                accessibilityRole="button"
                accessibilityHint="Opens a form to share your testing experience and rate accessibility features"
              >
                <Ionicons name="clipboard-outline" size={18} color="#fff" />
                <Text style={s.testingBtnText}>Submit Feedback & Ratings</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.testingBtn, { backgroundColor: '#EF4444', marginTop: 8 }]}
                onPress={() => (navigationRef.current as any)?.navigate('AccessibilityFeedback')}
                accessibilityLabel="Report an accessibility issue"
                accessibilityRole="button"
              >
                <Ionicons name="flag-outline" size={18} color="#fff" />
                <Text style={s.testingBtnText}>Report Accessibility Issue</Text>
              </TouchableOpacity>
            </View>

            {/* ── Logout ── */}
            <TouchableOpacity
              onPress={handleLogout}
              style={s.logoutBtn}
              accessibilityLabel="Sign out"
            >
              <LinearGradient
                colors={['#ef4444', '#dc2626']}
                style={s.logoutGrad}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                <Ionicons name="log-out-outline" size={20} color="white" />
                <Text style={s.logoutText}>Sign Out</Text>
              </LinearGradient>
            </TouchableOpacity>

            <View style={{ height: 40 }} />
          </ScrollView>
        </Animated.View>
      </SafeAreaView>

      {/* ── Edit Profile Modal (pageSheet) ── */}
      <Modal
        visible={isEditingPersonal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setIsEditingPersonal(false)}
      >
        <View style={[s.editModalContainer, { backgroundColor: theme.background }]}>
          {/* Modal header */}
          <View style={[s.editModalHeader, { borderBottomColor: theme.cardBorder, backgroundColor: theme.cardBackground }]}>
            <TouchableOpacity style={s.editModalHeaderBtn} onPress={() => setIsEditingPersonal(false)}>
              <Text style={[s.editModalCancelText, { color: theme.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
            <Text style={[s.editModalTitle, { color: theme.textPrimary }]}>Edit Profile</Text>
            <TouchableOpacity style={s.editModalHeaderBtn} onPress={() => handleSaveProfile()} disabled={isSaving}>
              {isSaving
                ? <ActivityIndicator size="small" color={theme.accent} />
                : <Text style={[s.editModalSaveText, { color: '#2E7D32' }]}>Save</Text>}
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={s.editModalScroll} keyboardShouldPersistTaps="handled">
            {/* Health Info section label */}
            <Text style={[s.editModalSectionLabel, { color: theme.textSecondary }]}>HEALTH INFO</Text>

            {[
              { field: 'name',             label: 'Full Name',           placeholder: 'Enter your full name',         multiline: false, keyboard: 'default'     },
              { field: 'bio',              label: 'About Me',            placeholder: 'A short bio about yourself',   multiline: true,  keyboard: 'default'     },
              { field: 'weight',           label: 'Weight',              placeholder: 'e.g., 70 kg',                  multiline: false, keyboard: 'default'     },
              { field: 'height',           label: 'Height',              placeholder: 'e.g., 170 cm',                 multiline: false, keyboard: 'default'     },
              { field: 'bloodGroup',       label: 'Blood Group',         placeholder: 'e.g., O+',                     multiline: false, keyboard: 'default'     },
              { field: 'allergies',        label: 'Allergies',           placeholder: 'List any allergies',           multiline: true,  keyboard: 'default'     },
              { field: 'medicalConditions',label: 'Medical Conditions',  placeholder: 'e.g., Diabetes, Hypertension', multiline: true,  keyboard: 'default'     },
              { field: 'medications',      label: 'Current Medications', placeholder: 'e.g., Metformin 500mg daily',  multiline: true,  keyboard: 'default'     },
            ].map(({ field, label, placeholder, multiline, keyboard }) => (
              <View key={field} style={[s.editModalField, { backgroundColor: theme.cardBackground, borderColor: theme.cardBorder }]}>
                <Text style={[s.editModalFieldLabel, { color: theme.textSecondary }]}>{label}</Text>
                <View style={s.fieldRow}>
                  <TextInput
                    style={[s.editModalInput, multiline && s.editModalInputMultiline, { color: theme.textPrimary }]}
                    value={(profileData as any)[field]}
                    onChangeText={(t) => updateProfileField(field as any, t)}
                    placeholder={placeholder}
                    placeholderTextColor={theme.placeholder}
                    multiline={multiline}
                    numberOfLines={multiline ? 3 : 1}
                    textAlignVertical={multiline ? 'top' : 'center'}
                    keyboardType={keyboard as any}
                  />
                  <TouchableOpacity
                    style={[s.micButton, listeningField === field && s.micButtonActive]}
                    onPress={() => startVoiceInput(field)}
                  >
                    <Ionicons
                      name={listeningField === field ? 'mic' : 'mic-outline'}
                      size={20}
                      color={listeningField === field ? 'white' : theme.accent}
                    />
                  </TouchableOpacity>
                </View>
              </View>
            ))}

            {/* Emergency Contact section label */}
            <Text style={[s.editModalSectionLabel, { color: theme.textSecondary, marginTop: 24 }]}>EMERGENCY CONTACT</Text>

            {[
              { field: 'emergencyContactName',         label: 'Contact Name',  placeholder: 'e.g., Jane Doe',             keyboard: 'default'   },
              { field: 'emergencyContactRelationship', label: 'Relationship',  placeholder: 'e.g., Mother, Friend, Carer', keyboard: 'default'   },
              { field: 'emergencyContactPhone',        label: 'Phone Number',  placeholder: 'e.g., +1 555 000 0000',       keyboard: 'phone-pad' },
            ].map(({ field, label, placeholder, keyboard }) => (
              <View key={field} style={[s.editModalField, { backgroundColor: theme.cardBackground, borderColor: theme.cardBorder }]}>
                <Text style={[s.editModalFieldLabel, { color: theme.textSecondary }]}>{label}</Text>
                <View style={s.fieldRow}>
                  <TextInput
                    style={[s.editModalInput, { color: theme.textPrimary }]}
                    value={(profileData as any)[field]}
                    onChangeText={(t) => updateProfileField(field as any, t)}
                    placeholder={placeholder}
                    placeholderTextColor={theme.placeholder}
                    keyboardType={keyboard as any}
                  />
                  <TouchableOpacity
                    style={[s.micButton, listeningField === field && s.micButtonActive]}
                    onPress={() => startVoiceInput(field)}
                  >
                    <Ionicons
                      name={listeningField === field ? 'mic' : 'mic-outline'}
                      size={20}
                      color={listeningField === field ? 'white' : theme.accent}
                    />
                  </TouchableOpacity>
                </View>
              </View>
            ))}

            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </Modal>
    </>
  );
};

export default ProfileScreen;

// ── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  scroll: {
    paddingBottom: 20,
  },

  // ── Hero ──
  hero: {
    alignItems: 'center',
    paddingTop: 32,
    paddingBottom: 24,
    paddingHorizontal: 20,
  },
  avatarWrap: {
    marginBottom: 16,
    position: 'relative',
  },
  avatarRing: {
    width: 120,
    height: 120,
    borderRadius: 60,
    padding: 3,
  },
  avatarImg: {
    width: '100%',
    height: '100%',
    borderRadius: 57,
  },
  avatarPlaceholder: {
    width: '100%',
    height: '100%',
    borderRadius: 57,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 57,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    borderColor: 'white',
  },
  heroName: {
    fontSize: 26,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  heroEmail: {
    fontSize: 14,
    marginTop: 4,
    marginBottom: 14,
    textAlign: 'center',
  },
  heroBadges: {
    flexDirection: 'row',
    gap: 10,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // ── Emergency banner ──
  emergencyBtn: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 16,
    overflow: 'hidden',
  },
  emergencyGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  emergencyLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  emergencyIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emergencyTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  emergencySub: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    marginTop: 2,
  },

  // ── Section wrapper ──
  section: {
    marginHorizontal: 16,
    marginTop: 24,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },

  // ── Edit Profile prominent button ──
  editProfileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 16,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  editProfileIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editProfileTextWrap: {
    flex: 1,
  },
  editProfileTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  editProfileSub: {
    fontSize: 12,
  },

  // ── Card ──
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },

  // ── Info row (profile data) ──
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rowContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  rowLabel: {
    fontSize: 13,
    fontWeight: '500',
    width: 88,
  },
  rowValue: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'right',
    lineHeight: 20,
  },

  // ── Empty state ──
  emptyState: {
    alignItems: 'center',
    paddingVertical: 28,
    gap: 10,
    paddingHorizontal: 20,
  },
  emptyStateText: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },

  // ── Accessibility rows (pill selectors) ──
  accessibilityRow: {
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  accessibilityLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  accessibilityTitle: {
    fontSize: 15,
    fontWeight: '600',
  },

  // ── Divider ──
  divider: {
    height: 1,
    marginHorizontal: 14,
  },

  // ── Dark mode row ──
  darkModeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
  },
  darkModeLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },

  // ── App info rows ──
  infoSimpleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  infoSimpleLabel: {
    fontSize: 15,
    fontWeight: '400',
  },
  infoSimpleValue: {
    fontSize: 15,
    fontWeight: '500',
  },

  // ── Community button ──
  communityBtn: {
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  communityBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  communityBtnLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  communityIconBox: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  communityBtnTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 3,
  },
  communityBtnSub: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
    fontWeight: '500',
  },

  // ── Community modal ──
  communityModal: {
    flex: 1,
  },
  communityModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  communityModalTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  communityCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── User Testing ──
  sectionCard: {
    marginHorizontal: 16, borderRadius: 16, borderWidth: 1, padding: 16,
  },
  sectionHeading: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  sectionSubtitle: { fontSize: 13, lineHeight: 18, marginBottom: 12 },
  testingBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 13, borderRadius: 12,
  },
  testingBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  // ── Logout ──
  logoutBtn: {
    marginHorizontal: 16,
    marginTop: 28,
    borderRadius: 16,
    overflow: 'hidden',
  },
  logoutGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 10,
  },
  logoutText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  // ── JoinDate modal ──
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  modalBackdropTouchable: {
    ...StyleSheet.absoluteFill,
  },
  joinDateModal: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  calendarBadge: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  modalHeaderTextWrapper: {
    flex: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  modalSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  calendarCard: {
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 16,
    borderWidth: 1,
    width: 200,
    marginBottom: 14,
  },
  calendarMonth: {
    fontSize: 16,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  calendarDay: {
    fontSize: 44,
    fontWeight: '800',
    marginVertical: 6,
  },
  calendarYear: {
    fontSize: 16,
    fontWeight: '600',
  },
  modalDescription: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },

  // ── Edit Profile Modal ──
  editModalContainer: {
    flex: 1,
  },
  editModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  editModalHeaderBtn: {
    minWidth: 60,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  editModalTitle: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    flex: 1,
  },
  editModalCancelText: {
    fontSize: 16,
    fontWeight: '500',
  },
  editModalSaveText: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'right',
  },
  editModalScroll: {
    padding: 20,
    paddingBottom: 60,
  },
  editModalSectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
    marginTop: 4,
  },
  editModalField: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  editModalFieldLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  editModalInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
    minHeight: 24,
  },
  editModalInputMultiline: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  micButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(74,144,226,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  micButtonActive: {
    backgroundColor: '#E53935',
  },
});
