import { Ionicons } from '@expo/vector-icons';
import type { NavigationProp } from '@react-navigation/native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { MainTabParamList } from '../types';
import Constants from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import * as Speech from 'expo-speech';
import { speakText as ttsSpeakText, stopSpeaking as ttsStopSpeaking } from '../services/ttsService';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { AppTheme, getThemeConfig } from '../../constants/theme';
import { EverySenseLogo } from '../components/EverySenseLogo';
import { BackgroundLogo } from '../components/BackgroundLogo';
import { ModernButton } from '../components/ModernButton';
import { ModernCard } from '../components/ModernCard';
import { useApp } from '../contexts/AppContext';
import { supabase } from '../../lib/supabase';
import { voiceManager } from '../utils/voiceCommandManager';
import { sendImageMessage, analyzeSmartScanDocument } from '../services/geminiService';
import { SmartScanUnderstandingCard } from '../components/SmartScanUnderstandingCard';
import { WhatNextCard } from '../components/WhatNextCard';
import { VoiceCommandCard } from '../components/VoiceCommandCard';
import { parseUserVoiceIntent, ParsedIntentResult } from '../services/voiceIntentService';
import type { SmartScanResult, WhatNextAction } from '../types';
import { saveDocument } from '../utils/documentStorage';


// Conditional import for clipboard (same pattern as ReminderScreen)
let Clipboard: any = null;
try {
  Clipboard = require('expo-clipboard');
} catch {
  Clipboard = { setStringAsync: async (_: string) => {} };
}

// Conditional import for expo-speech-recognition (not available in Expo Go)
let ExpoSpeechRecognitionModule: any = null;
try {
  ExpoSpeechRecognitionModule = require('expo-speech-recognition').ExpoSpeechRecognitionModule;
} catch (e) {}

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const isSmallScreen = screenWidth < 375;
const isPhone = screenWidth < 768;

function computeStreak(rows: { created_at: string }[]): number {
  if (!rows.length) return 0;
  const sorted = [...rows].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  let count = 0;
  let expected = new Date();
  expected.setHours(0, 0, 0, 0);
  for (const row of sorted) {
    const d = new Date(row.created_at);
    d.setHours(0, 0, 0, 0);
    const diff = (expected.getTime() - d.getTime()) / 86400000;
    if (diff === 0 || diff === 1) { count++; expected = d; }
    else break;
  }
  return count;
}

const HomeScreen = () => {
  const { state } = useApp();
  const navigation = useNavigation<NavigationProp<MainTabParamList>>();
  const [ttsText, setTtsText] = useState('');
  const ttsTextRef = useRef(''); // mirrors ttsText; read by stale-closure voice commands
  const [isListening, setIsListening] = useState(false);
  const [isVoiceInputMode, setIsVoiceInputMode] = useState(false);
  const [fadeAnim] = useState(new Animated.Value(0));
  
  // AI Reader state
  const [aiReaderText, setAiReaderText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const [streakCount, setStreakCount] = useState(0);
  const [isReadingAloud, setIsReadingAloud] = useState(false);

  const handleReadAloudPress = () => {
    if (isReadingAloud) {
      ttsStopSpeaking();
      setIsReadingAloud(false);
      return;
    }
    if (!ttsText.trim()) {
      Alert.alert('No Text', 'Please enter some text to read aloud.');
      return;
    }
    setIsReadingAloud(true);
    const safeRate = Math.max(0.5, Math.min(state.accessibilitySettings.voiceSpeed, 2.0));
    ttsSpeakText(ttsText, {
      rate: safeRate,
      pitch: 1.0,
      onDone: () => setIsReadingAloud(false),
      onStopped: () => setIsReadingAloud(false),
      onError: () => setIsReadingAloud(false),
    });
  };

  // Smart Scan state
  const [smartScanResult, setSmartScanResult] = useState<SmartScanResult | null>(null);
  const [isSmartScanning, setIsSmartScanning] = useState(false);
  const [smartScanStatus, setSmartScanStatus] = useState('');
  const [smartScanError, setSmartScanError] = useState<string | null>(null);

  const handleSmartScanCamera = async () => {
    try {
      console.error('[SmartScan Stage 1]: Camera Initiated');
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        console.error('[SmartScan Stage 1 Error]: Camera permission denied');
        Alert.alert('Camera Permission Needed', 'Please allow camera access to scan bills and documents.');
        speakText('Please allow camera access to scan documents.');
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setIsSmartScanning(true);
      setSmartScanError(null);
      setSmartScanStatus('Capturing document...');

      const res = await ImagePicker.launchCameraAsync({ quality: 0.8 });
      if (res.canceled || !res.assets?.[0]?.uri) {
        console.error('[SmartScan Stage 1]: User canceled camera capture');
        setIsSmartScanning(false);
        setSmartScanStatus('');
        return;
      }

      console.error('[SmartScan Stage 1]: Image Captured, width:', res.assets[0].width ?? 0, 'height:', res.assets[0].height ?? 0);

      setSmartScanStatus('Understanding your document...');
      speakText('Understanding your document with EverySense AI...');

      console.error('[SmartScan Stage 2]: Converting Image to Base64 JPEG');
      const manip = await ImageManipulator.manipulateAsync(
        res.assets[0].uri,
        [{ resize: { width: 900 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );

      console.error('[SmartScan Stage 2]: Base64 length:', manip.base64?.length ?? 0);

      if (!manip.base64) {
        console.error('[SmartScan Stage 2 Error]: Base64 encoding failed');
        throw new Error('Could not encode document image.');
      }

      const resultData = await analyzeSmartScanDocument(manip.base64, 'image/jpeg');
      // Ensure imageUri is only stored if it's a file URI (not base64 data URI)
      const safeUri = res.assets[0].uri && !res.assets[0].uri.startsWith('data:') ? res.assets[0].uri : undefined;
      const fullResult: SmartScanResult = {
        ...resultData,
        imageUri: safeUri,
      };

      console.error('[SmartScan Stage 6]: Displaying Result Card docType:', fullResult.documentType, 'title:', fullResult.title);
      setSmartScanResult(fullResult);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      speakText(`Smart Scan complete! Detected ${fullResult.documentType}. ${fullResult.explanation}`);
    } catch (err: any) {
      const isAbort = err?.name === 'AbortError' || err?.message?.toLowerCase().includes('canceled') || err?.message?.toLowerCase().includes('timed out');
      console.error('[SmartScan Flow Error]:', isAbort ? `[AbortError/Timeout] ${err?.message || 'Canceled'}` : (err?.message || String(err)));
      const isNetwork = !isAbort && (err?.message?.toLowerCase().includes('network') || err?.message?.toLowerCase().includes('failed to fetch') || err?.message?.toLowerCase().includes('reach'));
      const errorMessage = isNetwork
        ? "EverySense couldn't reach the AI service. Check your connection and try again."
        : "We couldn't understand this document. Try another image.";
      setSmartScanError(errorMessage);
      speakText(errorMessage);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsSmartScanning(false);
      setSmartScanStatus('');
    }
  };

  const handleSmartScanGallery = async () => {
    try {
      console.error('[SmartScan Stage 1]: Gallery Initiated');
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        console.error('[SmartScan Stage 1 Error]: Gallery permission denied');
        Alert.alert('Permission Needed', 'Please allow photo library access to select documents.');
        speakText('Please allow photo library access to select documents.');
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setIsSmartScanning(true);
      setSmartScanError(null);
      setSmartScanStatus('Selecting document...');

      const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.8 });
      if (res.canceled || !res.assets?.[0]?.uri) {
        console.error('[SmartScan Stage 1]: User canceled image selection');
        setIsSmartScanning(false);
        setSmartScanStatus('');
        return;
      }

      console.error('[SmartScan Stage 1]: Image Selected, width:', res.assets[0].width ?? 0, 'height:', res.assets[0].height ?? 0);

      setSmartScanStatus('Understanding your document...');
      speakText('Understanding your document with EverySense AI...');

      console.error('[SmartScan Stage 2]: Converting Image to Base64 JPEG');
      const manip = await ImageManipulator.manipulateAsync(
        res.assets[0].uri,
        [{ resize: { width: 900 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );

      console.error('[SmartScan Stage 2]: Base64 length:', manip.base64?.length ?? 0);

      if (!manip.base64) {
        console.error('[SmartScan Stage 2 Error]: Base64 encoding failed');
        throw new Error('Could not encode document image.');
      }

      const resultData = await analyzeSmartScanDocument(manip.base64, 'image/jpeg');
      // Ensure imageUri is only stored if it's a file URI (not base64 data URI)
      const safeUri = res.assets[0].uri && !res.assets[0].uri.startsWith('data:') ? res.assets[0].uri : undefined;
      const fullResult: SmartScanResult = {
        ...resultData,
        imageUri: safeUri,
      };

      console.error('[SmartScan Stage 6]: Displaying Result Card docType:', fullResult.documentType, 'title:', fullResult.title);
      setSmartScanResult(fullResult);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      speakText(`Smart Scan complete! Detected ${fullResult.documentType}. ${fullResult.explanation}`);
    } catch (err: any) {
      const isAbort = err?.name === 'AbortError' || err?.message?.toLowerCase().includes('canceled') || err?.message?.toLowerCase().includes('timed out');
      console.error('[SmartScan Flow Error]:', isAbort ? `[AbortError/Timeout] ${err?.message || 'Canceled'}` : (err?.message || String(err)));
      const isNetwork = !isAbort && (err?.message?.toLowerCase().includes('network') || err?.message?.toLowerCase().includes('failed to fetch') || err?.message?.toLowerCase().includes('reach'));
      const errorMessage = isNetwork
        ? "EverySense couldn't reach the AI service. Check your connection and try again."
        : "We couldn't understand this document. Try another image.";
      setSmartScanError(errorMessage);
      speakText(errorMessage);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsSmartScanning(false);
      setSmartScanStatus('');
    }
  };

  const handleSmartScanReset = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSmartScanResult(null);
    setSmartScanError(null);
    setSmartScanStatus('');
  };

  const handleCreateSmartScanReminder = (res: SmartScanResult) => {
    try {
      console.error('[SmartScan Stage 7]: Create Reminder tapped for title:', res.title);

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const prefillTitle = res.title !== 'Not detected' ? `Pay ${res.title}` : `Action required for ${res.documentType}`;
      const prefillDesc = `${res.explanation}\nAmount: ${res.amount}\nDue Date: ${res.dueDate}`;

      console.error('[SmartScan Stage 7]: Navigating to Reminders screen with prefillTitle:', prefillTitle);

      speakText(`Opening reminders to create reminder for ${prefillTitle}`);
      navigation.navigate('Reminders', {
        prefillTitle,
        prefillDescription: prefillDesc,
        prefillDate: res.dueDate !== 'Not detected' ? res.dueDate : undefined,
      });
    } catch (err: any) {
      console.error('[SmartScan Stage 7 Error]:', err?.message || String(err));
    }
  };

  const handleWhatNextAction = async (action: WhatNextAction) => {
    if (!smartScanResult) return;

    try {
      switch (action.type) {
        case 'CREATE_REMINDER': {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          const prefillTitle = action.metadata?.prefillTitle || (smartScanResult.title !== 'Not detected' ? `Pay ${smartScanResult.title}` : `Action required for ${smartScanResult.documentType}`);
          const prefillDesc = `${smartScanResult.explanation}\nAmount: ${smartScanResult.amount}\nDue Date: ${smartScanResult.dueDate}`;
          const prefillDate = action.metadata?.suggestedDateIso || (smartScanResult.dueDate !== 'Not detected' ? smartScanResult.dueDate : undefined);

          speakText(`Opening reminders to set reminder for ${prefillTitle}`);
          navigation.navigate('Reminders', {
            prefillTitle,
            prefillDescription: prefillDesc,
            prefillDate,
          });
          break;
        }

        case 'EXPLAIN': {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          const explainText = smartScanResult.explanation || `This is a ${smartScanResult.documentType} titled ${smartScanResult.title}. Amount: ${smartScanResult.amount}, Due: ${smartScanResult.dueDate}.`;
          speakText(explainText);
          Alert.alert(
            action.title,
            explainText,
            [{ text: 'OK', style: 'default' }]
          );
          break;
        }

        case 'CHAT': {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          const docTitle = smartScanResult.title !== 'Not detected' ? smartScanResult.title : smartScanResult.documentType;
          const docContext = [
            `Document: ${docTitle}`,
            `Type: ${smartScanResult.documentType}`,
            smartScanResult.amount !== 'Not detected' ? `Amount: ${smartScanResult.amount}` : null,
            smartScanResult.dueDate !== 'Not detected' ? `Due: ${smartScanResult.dueDate}` : null,
            smartScanResult.keyDates !== 'Not detected' ? `Key Dates: ${smartScanResult.keyDates}` : null,
            smartScanResult.importantInfo !== 'Not detected' ? `Details: ${smartScanResult.importantInfo}` : null,
            `Summary: ${smartScanResult.explanation}`,
          ].filter(Boolean).join('\n');

          speakText(`Opening assistant for ${docTitle}`);
          navigation.navigate('Assistant', {
            documentContext: docContext,
            documentTitle: docTitle,
          });
          break;
        }

        case 'SAVE': {
          const res = await saveDocument(smartScanResult);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          const docTitle = smartScanResult.title !== 'Not detected' ? smartScanResult.title : smartScanResult.documentType;
          const msg = res.alreadySaved
            ? `${docTitle} is already in your saved documents.`
            : `${docTitle} has been saved for later reference.`;
          speakText(msg);
          Alert.alert('Document Saved', msg, [{ text: 'OK' }]);
          break;
        }
      }
    } catch (err: any) {
      console.error('[WhatNext Action Error]:', err);
    }
  };

  const handleExecuteVoiceIntent = (result: ParsedIntentResult) => {
    switch (result.intent) {
      case 'CREATE_REMINDER':
        console.log('🗣️ [HomeScreen Navigation Log]:');
        console.log('   - Raw transcript:', result.rawText);
        console.log('   - Parsed title:', result.title);
        console.log('   - Final navigation prefillDate:', result.date);
        navigation.navigate('Reminders', {
          prefillTitle: result.title || 'New Reminder',
          prefillDescription: result.description || result.title || 'Created via Voice Command',
          prefillDate: result.date,
        });
        break;
      case 'SCAN':
        console.error('[VoiceCommand Intent SCAN]: Triggering Smart Scan');
        handleSmartScanCamera();
        break;
      case 'EXPLAIN':
        console.error('[VoiceCommand Intent EXPLAIN]: SmartScan result available =', !!smartScanResult);
        if (smartScanResult) {
          speakText(`I'll explain the document in simple words: ${smartScanResult.explanation}`);
        } else {
          speakText("Please scan a document first and I'll explain it simply.");
        }
        break;
      case 'HELP':
        console.error('[VoiceCommand Intent HELP]');
        break;
    }
  };

  const theme = useMemo(() => getThemeConfig(state.accessibilitySettings.isDarkMode), [state.accessibilitySettings.isDarkMode]);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const gradientColors = theme.gradient as [string, string, ...string[]];
  const placeholderColor = theme.placeholder;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();

    // Clear previous commands
    voiceManager.removeCommand(['read text', 'speak text', 'read aloud']);
    voiceManager.removeCommand(['go to profile', 'profile', 'settings']);
    voiceManager.removeCommand(['go to reminders', 'reminders', 'show reminders']);
    voiceManager.removeCommand(['add reminder', 'create reminder', 'set reminder', 'remind me to', 'new reminder']);
    voiceManager.removeCommand(['help', 'commands', 'what can I say']);
    voiceManager.removeCommand(['enable voice', 'voice on', 'start voice']);
    voiceManager.removeCommand(['disable voice', 'voice off', 'stop voice']);

    // Set up voice commands for home screen
    voiceManager.addCommand({
      keywords: ['read text', 'speak text', 'read aloud'],
      action: () => {
        speakText('Executing text-to-speech command. ' + ttsTextRef.current);
      },
      description: 'Read the text in the input field',
      category: 'general'
    });

    // Camera commands removed


    voiceManager.addCommand({
      keywords: ['go to profile', 'profile', 'settings'],
      action: () => {
        setIsListening(false);
        navigation.navigate('Profile');
        speakText('Navigating to profile');
      },
      description: 'Go to profile screen',
      category: 'navigation'
    });

    voiceManager.addCommand({
      keywords: ['go to reminders', 'reminders', 'show reminders'],
      action: () => {
        setIsListening(false);
        navigation.navigate('Reminders');
        speakText('Navigating to reminders');
      },
      description: 'Go to reminders screen',
      category: 'navigation'
    });

    voiceManager.addCommand({
      keywords: ['add reminder', 'create reminder', 'set reminder', 'remind me to', 'new reminder'],
      action: async (fullTranscript) => {
        setIsListening(false);
        if (fullTranscript) {
          const res = await parseUserVoiceIntent(fullTranscript);
          handleExecuteVoiceIntent(res);
        } else {
          navigation.navigate('Reminders');
          speakText('Opening reminders to add a new one. You can say the reminder details naturally.');
        }
      },
      description: 'Create a new reminder',
      category: 'reminder',
      captureFullTranscript: true,
    });

    voiceManager.addCommand({
      keywords: ['help', 'commands', 'what can I say'],
      action: () => {
        setIsListening(false);
        speakText('You can say: Read text, Add reminder, Go to reminders, Go to profile, or Help');
      },
      description: 'Show available voice commands',
      category: 'general'
    });

    voiceManager.addCommand({
      keywords: ['enable voice', 'voice on', 'start voice'],
      action: () => {
        setIsListening(true);
        voiceManager.startListening();
        speakText('Voice commands enabled. You can now speak your commands.');
      },
      description: 'Enable voice commands',
      category: 'general'
    });

    voiceManager.addCommand({
      keywords: ['disable voice', 'voice off', 'stop voice'],
      action: () => {
        setIsListening(false);
        voiceManager.stopListening();
        speakText('Voice commands disabled');
      },
      description: 'Disable voice commands',
      category: 'general'
    });

    return () => {
      // Clean up voice commands when component unmounts
      voiceManager.removeCommand(['read text', 'speak text', 'read aloud']);
      voiceManager.removeCommand(['go to profile', 'profile', 'settings']);
      voiceManager.removeCommand(['go to reminders', 'reminders', 'show reminders']);
      voiceManager.removeCommand(['add reminder', 'create reminder', 'set reminder', 'remind me to', 'new reminder']);
      voiceManager.removeCommand(['help', 'commands', 'what can I say']);
      voiceManager.removeCommand(['enable voice', 'voice on', 'start voice']);
      voiceManager.removeCommand(['disable voice', 'voice off', 'stop voice']);
    };
  }, []);

  // Keep ref in sync so voice commands registered once can read the current value
  useEffect(() => {
    ttsTextRef.current = ttsText;
  }, [ttsText]);

  // Announce screen on mount only
  useEffect(() => {
    voiceManager.announceScreenChange('home');
    speakText(`Welcome back, ${state.user?.name || 'User'}! You can use text-to-speech. Say "help" for voice commands.`);
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!state.user?.id) return;
      (async () => {
        try {
          const { data } = await supabase
            .from('check_ins')
            .select('created_at')
            .eq('user_id', state.user!.id)
            .order('created_at', { ascending: false })
            .limit(90);
          setStreakCount(computeStreak(data ?? []));
        } catch { /* silent — streak badge is non-critical */ }
      })();
    }, [state.user?.id])
  );

  const speakText = (text: string) => {
    if (!text.trim()) {
      Alert.alert('No Text', 'Please enter some text to read aloud.');
      return;
    }
    if (!state.voiceAnnouncementsEnabled) return;
    const safeRate = Math.max(0.5, Math.min(state.accessibilitySettings.voiceSpeed, 2.0));
    ttsSpeakText(text, {
      rate: safeRate,
      pitch: 1.0,
    });
  };

  // Helper for direct Speech.speak calls (respects voice announcements setting)
  const speakDirect = (text: string, options?: any) => {
    if (!state.voiceAnnouncementsEnabled) return;
    ttsSpeakText(text, options || { language: 'en-US', rate: 1.0 });
  };

  const handleVoiceInput = async () => {
    if (isVoiceInputMode) {
      setIsVoiceInputMode(false);
      return;
    }

    // Check if voice recognition is available
    if (!ExpoSpeechRecognitionModule) {
      Alert.alert(
        'Feature Not Available',
        'Voice input requires a development build. Please run:\n\nnpx expo run:android --device\n\nVoice input is not available in Expo Go.'
      );
      return;
    }

    setIsVoiceInputMode(true);

    try {
      const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!result.granted) {
        Alert.alert('Permission Required', 'Microphone permission is needed for voice input.');
        setIsVoiceInputMode(false);
        return;
      }

      // Set up one-time listener for voice-to-text
      const subscription = ExpoSpeechRecognitionModule.addListener('result', (event: any) => {
        const transcript = event.results?.[0]?.transcript;
        const isFinal = event.isFinal;
        
        if (transcript && isFinal) {
          setTtsText((prev: string) => prev ? `${prev} ${transcript}` : transcript);
          setIsVoiceInputMode(false);
          subscription.remove();
        }
      });

      const errorSubscription = ExpoSpeechRecognitionModule.addListener('error', () => {
        setIsVoiceInputMode(false);
        subscription.remove();
        errorSubscription.remove();
      });

      await ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: true,
        maxAlternatives: 1,
        continuous: false,
        requiresOnDeviceRecognition: false,
        addsPunctuation: false,
        contextualStrings: [],
      });
    } catch (error) {
      console.error('Voice input error:', error);
      setIsVoiceInputMode(false);
    }
  };

  /**
   * Resize/compress an image asset and return base64 for AI extraction
   */
  const prepareImageForAI = async (
    asset: ImagePicker.ImagePickerAsset
  ): Promise<string> => {
    const targetWidth = Math.min(asset.width ?? 1600, 1600);
    const manipResult = await ImageManipulator.manipulateAsync(
      asset.uri,
      [{ resize: { width: targetWidth } }],
      { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
    );
    if (!manipResult.base64) {
      throw new Error('Unable to process image. Please try again.');
    }
    return manipResult.base64;
  };

  /**
   * Extract text from an image using the Groq vision AI model
   */
  const extractTextWithAI = async (base64: string): Promise<string> => {
    const text = await sendImageMessage(
      base64,
      'image/jpeg',
      'Extract all text from this image exactly as it appears. Return only the raw text content, preserving line breaks. Do not add descriptions or commentary.'
    );
    if (!text.trim()) {
      throw new Error('No text found in the image. Please try again with better lighting and make sure the text is in focus.');
    }
    return text.trim();
  };

  /**
   * Handle taking a picture with camera
   */
  const handleTakePicture = async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      if (state.voiceAnnouncementsEnabled) {
        speakDirect('Opening camera...');
      }

      // Request camera permission
      const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
      if (cameraPermission.status !== 'granted') {
        Alert.alert('Permission Required', 'Camera permission is needed to take pictures.');
        return;
      }

      // Launch camera
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.9,
        base64: false,
      });

      if (result.canceled || !result.assets?.[0]) {
        return;
      }

      const asset = result.assets[0];

      setIsProcessing(true);
      setAiReaderText('');
      speakDirect('Analyzing image with AI...');

      const base64 = await prepareImageForAI(asset);
      const extractedText = await extractTextWithAI(base64);

      setAiReaderText(extractedText);
      if (state.voiceAnnouncementsEnabled) {
        const safeRate = Math.max(0.5, Math.min(state.accessibilitySettings.voiceSpeed, 2.0));
        speakDirect(extractedText, { language: 'en-US', rate: safeRate, pitch: 1.0 });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error: any) {
      console.error('Error taking picture:', error);
      Alert.alert('Error', error.message || 'Failed to extract text. Please try again.');
      if (state.voiceAnnouncementsEnabled) speakDirect('Could not read text. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * Handle uploading an image from gallery
   */
  const handleUploadImage = async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      speakDirect('Opening image gallery...');

      // Request media library permission
      const mediaPermission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (mediaPermission.status !== 'granted') {
        Alert.alert('Permission Required', 'Media library permission is needed to select images.');
        return;
      }

      // Launch image picker
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.9,
        base64: false,
      });

      if (result.canceled || !result.assets?.[0]) {
        return;
      }

      const asset = result.assets[0];

      setIsProcessing(true);
      setAiReaderText('');
      speakDirect('Analyzing image with AI...');

      const base64 = await prepareImageForAI(asset);
      const extractedText = await extractTextWithAI(base64);

      setAiReaderText(extractedText);
      if (state.voiceAnnouncementsEnabled) {
        const safeRate = Math.max(0.5, Math.min(state.accessibilitySettings.voiceSpeed, 2.0));
        speakDirect(extractedText, { language: 'en-US', rate: safeRate, pitch: 1.0 });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error: any) {
      console.error('Error uploading image:', error);
      Alert.alert('Error', error.message || 'Failed to extract text. Please try again.');
      if (state.voiceAnnouncementsEnabled) speakDirect('Could not read text. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * Handle uploading a file (PDF or text)
   */
  const handleUploadFile = async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      speakDirect('Opening file picker...');

      // Launch document picker
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'text/plain', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled || !result.assets?.[0]) {
        return;
      }

      const file = result.assets[0];
      const mimeType = (file.mimeType || 'application/pdf').toLowerCase();

      setIsProcessing(true);
      setAiReaderText('');
      speakDirect('Processing file...');

      // If it's a plain text file, read directly without OCR
      if (mimeType.includes('text')) {
        try {
          const content = await FileSystemLegacy.readAsStringAsync(file.uri, {
            encoding: 'utf8',
          });
          const trimmed = content.trim();
          if (trimmed) {
            setAiReaderText(trimmed);
            if (state.voiceAnnouncementsEnabled) {
              const safeRate = Math.max(0.5, Math.min(state.accessibilitySettings.voiceSpeed, 2.0));
              speakDirect(trimmed, {
                language: 'en-US',
                rate: safeRate,
                pitch: 1.0,
              });
            }
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } else {
            Alert.alert('No Text Found', 'The selected file appears to be empty.');
          }
        } catch (readError: any) {
          Alert.alert('Error', `Failed to read the text file: ${readError.message || 'Unknown error'}`);
        } finally {
          setIsProcessing(false);
        }
        return;
      }

      // PDFs and other non-image files are not supported by AI vision
      Alert.alert(
        'Unsupported File Type',
        'PDF text extraction is not supported. Please take a photo of the document or upload an image file instead.'
      );
      speakDirect('PDF files are not supported. Please take a photo of the document instead.');
      setIsProcessing(false);
      return;
    } catch (error: any) {
      console.error('Error uploading file:', error);
      Alert.alert('Error', `Failed to process file: ${error.message || 'Unknown error'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * Read the extracted text again
   */
  const handleReadAgain = () => {
    if (aiReaderText.trim()) {
      if (state.voiceAnnouncementsEnabled) {
        const safeRate = Math.max(0.5, Math.min(state.accessibilitySettings.voiceSpeed, 2.0));
        speakDirect(aiReaderText, {
          language: 'en-US',
          rate: safeRate,
          pitch: 1.0,
        });
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else {
      Alert.alert('No Text', 'No text to read. Please upload or capture a document first.');
    }
  };

  /**
   * Stop reading
   */
  const handleStopReading = () => {
    ttsStopSpeaking();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  /**
   * Copy extracted OCR text to clipboard
   */
  const handleCopyText = async () => {
    try {
      await Clipboard.setStringAsync(aiReaderText);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Copied!', 'Text copied to clipboard.');
      if (state.voiceAnnouncementsEnabled) {
        speakDirect('Text copied to clipboard.');
      }
    } catch (error) {
      console.error('Failed to copy text:', error);
      Alert.alert('Error', 'Failed to copy text. Please try again.');
    }
  };

  /**
   * Save extracted OCR text as a reminder (tries API, falls back to local state)
   */
  const handleSaveAsReminder = () => {
    // Navigate to Reminders tab with the scanned text pre-filled in the Create Reminder form
    navigation.navigate('Reminders', { prefillDescription: aiReaderText });
    if (state.voiceAnnouncementsEnabled) {
      speakDirect('Opening create reminder with scanned text.');
    }
  };

  const FeatureCard = ({
    title,
    description,
    icon,
    onPress,
    gradientColors,
    accessibilityLabel
  }: {
    title: string;
    description: string;
    icon: string;
    onPress: () => void;
    gradientColors: string[];
    accessibilityLabel: string;
  }) => (
    <ModernCard
      variant="gradient"
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      style={styles.featureCard}
    >
      <View style={styles.cardContent}>
        <Ionicons name={icon as any} size={52} color="white" />
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardDescription}>{description}</Text>
      </View>
    </ModernCard>
  );

  const STAT_META = [
    { icon: 'sunny-outline',     color: '#F59E0B', bg: '#FFF7ED' },
    { icon: 'text-outline',      color: '#10B981', bg: '#ECFDF5' },
    { icon: 'mic-outline',       color: '#4F46E5', bg: '#EEF2FF' },
    { icon: 'notifications-outline', color: '#EF4444', bg: '#FEF2F2' },
  ];

  const QuickStatsCard = ({
    title,
    stats
  }: {
    title: string;
    stats: { value: string; label: string }[]
  }) => (
    <View style={styles.quickStatsCard}>
      {/* Header */}
      <View style={styles.quickStatsHeader}>
        <View style={styles.quickStatsHeaderLeft}>
          <View style={styles.quickStatsTitleDot} />
          <Text style={styles.quickStatsTitle}>{title}</Text>
        </View>
        <Text style={styles.quickStatsSubtitle}>Live</Text>
      </View>

      {/* Grid */}
      <View style={styles.statsGrid}>
        {stats.map((stat, index) => {
          const meta = STAT_META[index] ?? { icon: 'stats-chart-outline', color: '#6B7280', bg: '#F3F4F6' };
          return (
            <View key={index} style={styles.statCard}>
              <View style={[styles.statIconBox, { backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : meta.bg }]}>
                <Ionicons name={meta.icon as any} size={20} color={meta.color} />
              </View>
              <Text style={[styles.statNumber, { color: meta.color }]}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return { emoji: '🌅', text: 'Good Morning' };
    if (hour < 17) return { emoji: '☀️', text: 'Good Afternoon' };
    return { emoji: '🌙', text: 'Good Evening' };
  };

  const QUOTES = [
    { text: 'Accessibility is not a feature, it\'s a social trend.', author: 'Antonio Santos' },
    { text: 'The power of the web is in its universality.', author: 'Tim Berners-Lee' },
    { text: 'Design for the extremes and everyone benefits.', author: 'Unknown' },
    { text: 'Inclusion is not bringing people into what already exists.', author: 'Dei Tomlinson' },
    { text: 'Small steps every day lead to big changes.', author: 'EverySense' },
    { text: 'Technology should improve life for everyone.', author: 'EverySense' },
    { text: 'Your needs are valid. Your voice matters.', author: 'EverySense' },
  ];

  const greeting = getGreeting();
  const quote = QUOTES[new Date().getDate() % QUOTES.length];

  return (
    <LinearGradient colors={gradientColors} style={styles.container}>
      <BackgroundLogo />
      <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          showsVerticalScrollIndicator={false}
        >
          {/* ── 1. Top Brand Treatment ── */}
          <Animated.View style={[styles.brandHeader, { opacity: fadeAnim }]}>
            <View style={styles.brandRow}>
              <EverySenseLogo size={34} showText={false} />
              <View style={styles.brandTitleWrap}>
                <Text style={[styles.brandKicker, { color: theme.accent }]}>EVERYSENSE</Text>
                <Text style={[styles.brandTagline, { color: theme.textMuted }]}>Understand. Decide. Act.</Text>
              </View>
            </View>
          </Animated.View>

          {/* ── 2. Hero Section ── */}
          <View style={styles.heroSection}>
            <Text style={[styles.heroHeading, { color: theme.textPrimary }]}>
              Understand what matters.
            </Text>
            <Text style={[styles.heroSubtext, { color: theme.textSecondary }]}>
              Scan something, understand it, and know what to do next.
            </Text>
          </View>

          {/* ── 3. Primary Actions (Scan & Gallery) ── */}
          <View style={styles.primaryScanActionsRow}>
            <TouchableOpacity
              style={[styles.scanActionBtnPrimary, { backgroundColor: theme.accent }]}
              onPress={handleSmartScanCamera}
              disabled={isSmartScanning}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Scan document with camera"
            >
              <Ionicons name="camera-outline" size={22} color="#0B1020" style={{ marginRight: 8 }} />
              <Text style={styles.scanActionPrimaryText}>Scan document</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.scanActionBtnSecondary, { borderColor: theme.cardBorder, backgroundColor: theme.surfaceSecondary }]}
              onPress={handleSmartScanGallery}
              disabled={isSmartScanning}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Choose document from gallery"
            >
              <Ionicons name="image-outline" size={20} color={theme.accent} style={{ marginRight: 8 }} />
              <Text style={[styles.scanActionSecondaryText, { color: theme.textPrimary }]}>Choose from gallery</Text>
            </TouchableOpacity>
          </View>

          {/* ── Scanning Progress Banner ── */}
          {isSmartScanning && (
            <View style={[styles.scanningBanner, { backgroundColor: theme.surfaceSecondary, borderColor: theme.cardBorder }]}>
              <ActivityIndicator size="small" color={theme.accent} style={{ marginRight: 12 }} />
              <Text style={[styles.scanningBannerText, { color: theme.textPrimary }]}>
                {smartScanStatus || 'One moment...'}
              </Text>
            </View>
          )}

          {/* ── Scanning Error Banner ── */}
          {smartScanError && (
            <View style={[styles.scanErrorBox, { borderColor: theme.danger, backgroundColor: theme.surfaceSecondary }]}>
              <Ionicons name="alert-circle-outline" size={20} color={theme.danger} style={{ marginRight: 10 }} />
              <Text style={[styles.scanErrorText, { color: theme.textPrimary }]}>{smartScanError}</Text>
              <TouchableOpacity onPress={handleSmartScanReset} style={styles.retryBtn}>
                <Text style={[styles.retryText, { color: theme.accent }]}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── 4. WHAT'S NEXT? Centerpiece ── */}
          {smartScanResult ? (
            <>
              <SmartScanUnderstandingCard
                result={smartScanResult}
                theme={theme}
                onReset={handleSmartScanReset}
                onCreateReminder={handleCreateSmartScanReminder}
              />
              <WhatNextCard
                result={smartScanResult}
                theme={theme}
                onAction={handleWhatNextAction}
              />
            </>
          ) : (
            <View style={[styles.allCaughtUpCard, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
              <View style={styles.allCaughtUpHeader}>
                <View style={[styles.allCaughtUpIconCircle, { backgroundColor: theme.accentSoft }]}>
                  <Ionicons name="shield-checkmark-outline" size={20} color={theme.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.allCaughtUpKicker, { color: theme.accent }]}>WHAT'S NEXT?</Text>
                  <Text style={[styles.allCaughtUpHeading, { color: theme.textPrimary }]}>You’re all caught up.</Text>
                </View>
              </View>
              <Text style={[styles.allCaughtUpBody, { color: theme.textSecondary }]}>
                Scan a bill, prescription, notice, or document above to see your recommended next steps and reminders.
              </Text>
            </View>
          )}

          {/* ── 5. Natural Voice Assistant ── */}
          <VoiceCommandCard
            theme={theme}
            onExecuteIntent={handleExecuteVoiceIntent}
            speakText={speakText}
            isSmartScanAvailable={!!smartScanResult}
          />

          {/* ── 6. Read Aloud (Accessibility) ── */}
          <View style={[styles.ttsCard, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
            <View style={styles.ttsHeader}>
              <View style={[styles.ttsIconWrap, { backgroundColor: theme.accentSoft }]}>
                <Ionicons name="volume-high-outline" size={18} color={theme.accent} />
              </View>
              <Text style={[styles.ttsTitle, { color: theme.textPrimary }]}>READ ALOUD</Text>
            </View>

            <TextInput
              style={[
                styles.ttsInput,
                {
                  backgroundColor: theme.surfaceSecondary,
                  borderColor: theme.cardBorder,
                  color: theme.textPrimary,
                  fontSize: 15 * (state.accessibilitySettings.textZoom / 100),
                },
              ]}
              value={ttsText}
              onChangeText={setTtsText}
              placeholder="Type or paste any text to read aloud..."
              placeholderTextColor={placeholderColor}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              accessibilityLabel="Text input for read aloud"
            />

            <TouchableOpacity
              style={[
                styles.readAloudBtn,
                {
                  backgroundColor: isReadingAloud ? theme.surfaceSecondary : theme.accent,
                  borderColor: theme.accent,
                },
              ]}
              onPress={handleReadAloudPress}
              accessibilityRole="button"
              accessibilityLabel={isReadingAloud ? "Stop reading" : "Read text aloud"}
            >
              <Ionicons
                name={isReadingAloud ? "volume-mute" : "volume-high"}
                size={20}
                color={isReadingAloud ? theme.accent : "#0B1020"}
                style={{ marginRight: 8 }}
              />
              <Text style={[styles.readAloudBtnText, { color: isReadingAloud ? theme.accent : "#0B1020" }]}>
                {isReadingAloud ? "Reading..." : "READ ALOUD"}
              </Text>
            </TouchableOpacity>
          </View>

          {/* ── 7. Quick Navigation Shortcuts ── */}
          <View style={styles.shortcutsRow}>
            <TouchableOpacity
              style={[styles.shortcutItem, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}
              onPress={() => navigation.navigate('Reminders')}
              accessibilityRole="button"
              accessibilityLabel="Reminders"
            >
              <Ionicons name="alarm-outline" size={20} color={theme.accent} />
              <Text style={[styles.shortcutText, { color: theme.textPrimary }]}>Reminders</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.shortcutItem, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}
              onPress={() => navigation.navigate('CheckIn')}
              accessibilityRole="button"
              accessibilityLabel="Check In"
            >
              <Ionicons name="heart-outline" size={20} color={theme.accent} />
              <Text style={[styles.shortcutText, { color: theme.textPrimary }]}>Check In</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.shortcutItem, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}
              onPress={() => navigation.navigate('Assistant')}
              accessibilityRole="button"
              accessibilityLabel="AI Assistant"
            >
              <Ionicons name="chatbubble-ellipses-outline" size={20} color={theme.accent} />
              <Text style={[styles.shortcutText, { color: theme.textPrimary }]}>Assistant</Text>
            </TouchableOpacity>
          </View>


        </ScrollView>
      </Animated.View>
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
    },
    scrollContainer: {
      flexGrow: 1,
      paddingHorizontal: 20,
      paddingVertical: 20,
    },
    header: {
      alignItems: 'center',
      marginBottom: isSmallScreen ? 20 : 30,
      paddingTop: isSmallScreen ? 15 : 20,
      paddingHorizontal: isSmallScreen ? 10 : 0,
    },
    logoContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: isSmallScreen ? 15 : 20,
      minWidth: isSmallScreen ? 180 : 200,
      maxWidth: screenWidth - 40,
    },
    welcomeText: {
      fontSize: isSmallScreen ? 24 : 28,
      fontWeight: 'bold',
      color: theme.textInverted,
      marginTop: isSmallScreen ? 10 : 15,
      textAlign: 'center',
      textShadowColor: 'rgba(0, 0, 0, 0.35)',
      textShadowOffset: { width: 0, height: 2 },
      textShadowRadius: 5,
      paddingHorizontal: isSmallScreen ? 10 : 0,
    },
    greetingText: {
      fontSize: isSmallScreen ? 22 : 26,
      fontWeight: 'bold',
      color: theme.textInverted,
      marginTop: isSmallScreen ? 10 : 15,
      textAlign: 'center',
      textShadowColor: 'rgba(0, 0, 0, 0.35)',
      textShadowOffset: { width: 0, height: 2 },
      textShadowRadius: 5,
      paddingHorizontal: isSmallScreen ? 10 : 0,
    },
    taglineBadge: {
      paddingHorizontal: 14,
      paddingVertical: 5,
      borderRadius: 16,
      backgroundColor: theme.isDark ? 'rgba(99, 102, 241, 0.22)' : 'rgba(255, 255, 255, 0.22)',
      borderWidth: 1,
      borderColor: theme.isDark ? 'rgba(99, 102, 241, 0.45)' : 'rgba(255, 255, 255, 0.45)',
      marginTop: 6,
      marginBottom: 6,
    },
    taglineBadgeText: {
      fontSize: 12,
      fontWeight: '700',
      color: theme.isDark ? '#C7D2FE' : '#FFFFFF',
      letterSpacing: 0.9,
      textTransform: 'uppercase',
    },
    heroTitle: {
      fontSize: isSmallScreen ? 20 : 23,
      fontWeight: '800',
      color: theme.textInverted,
      textAlign: 'center',
      marginTop: 4,
      letterSpacing: 0.2,
    },
    heroSubtitle: {
      fontSize: isSmallScreen ? 13 : 14,
      fontWeight: '500',
      color: 'rgba(255, 255, 255, 0.88)',
      textAlign: 'center',
      marginTop: 4,
      paddingHorizontal: 16,
      lineHeight: 20,
    },
    quoteCard: {
      borderRadius: 20,
      padding: 18,
      marginBottom: 20,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 8,
      elevation: 3,
    },
    quoteTopRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
    },
    quoteDecor: {
      fontSize: 40,
      fontWeight: '900',
      color: '#4F46E5',
      lineHeight: 38,
      opacity: 0.35,
    },
    quoteBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 20,
    },
    quoteBadgeText: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.5,
    },
    quoteText: {
      fontSize: 15,
      fontStyle: 'italic',
      lineHeight: 22,
      fontWeight: '500',
      marginBottom: 8,
    },
    quoteAuthor: {
      fontSize: 12,
      fontWeight: '600',
    },
    subtitleText: {
      fontSize: isSmallScreen ? 14 : 16,
      color: theme.textInverted,
      opacity: 0.85,
      marginTop: isSmallScreen ? 6 : 8,
      textAlign: 'center',
      textShadowColor: 'rgba(0, 0, 0, 0.2)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 3,
      paddingHorizontal: isSmallScreen ? 10 : 0,
    },
    streakBadge: {
      marginTop: 10,
      alignSelf: 'center',
      backgroundColor: 'rgba(255, 255, 255, 0.22)',
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingVertical: 5,
    },
    streakBadgeText: {
      color: '#fff',
      fontSize: 14,
      fontWeight: '700',
    },
    ttsContainer: {
      padding: 20,
      marginBottom: 20,
      backgroundColor: theme.cardBackground,
      borderRadius: 20,
      borderWidth: theme.isDark ? 1 : 0.5,
      borderColor: theme.cardBorder,
      shadowColor: theme.cardShadow,
      shadowOffset: { width: 0, height: theme.isDark ? 6 : 3 },
      shadowOpacity: theme.isDark ? 0.35 : 0.08,
      shadowRadius: theme.isDark ? 16 : 8,
      elevation: theme.isDark ? 8 : 3,
    },
    sectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 15,
    },
    sectionTitle: {
      fontSize: 20,
      fontWeight: 'bold',
      color: theme.textPrimary,
    },
    voiceInputButton: {
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    inputContainer: {
      marginBottom: 15,
    },
    textInput: {
      borderWidth: 2,
      borderColor: theme.inputBorder,
      borderRadius: 16,
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: theme.inputBackground,
      minHeight: 100,
      color: theme.textPrimary,
    },
    speakButton: {
      width: '100%',
    },
    featuresContainer: {
      marginBottom: 20,
    },
    featureCard: {
      marginBottom: 15,
    },
    cardContent: {
      alignItems: 'center',
      padding: 30,
    },
    cardTitle: {
      color: theme.textInverted,
      fontSize: 20,
      fontWeight: 'bold',
      marginTop: 12,
      marginBottom: 8,
    },
    cardDescription: {
      color: theme.textInverted,
      fontSize: 14,
      opacity: 0.9,
      textAlign: 'center',
    },
    voiceCommandsContainer: {
      padding: 20,
      marginBottom: 20,
      backgroundColor: theme.cardBackground,
      borderRadius: 20,
      borderWidth: theme.isDark ? 1 : 0.5,
      borderColor: theme.cardBorder,
      shadowColor: theme.cardShadow,
      shadowOffset: { width: 0, height: theme.isDark ? 5 : 2 },
      shadowOpacity: theme.isDark ? 0.25 : 0.08,
      shadowRadius: theme.isDark ? 12 : 6,
      elevation: theme.isDark ? 6 : 2,
    },
    voiceCommandsText: {
      fontSize: 14,
      color: theme.textSecondary,
      marginBottom: 15,
      lineHeight: 20,
    },
    voiceCommandButton: {
      width: '100%',
    },
    quickStatsCard: {
      marginBottom: 20,
      borderRadius: 22,
      backgroundColor: theme.cardBackground,
      padding: 18,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: theme.isDark ? 0.3 : 0.08,
      shadowRadius: 12,
      elevation: 5,
      borderWidth: theme.isDark ? 1 : 0,
      borderColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'transparent',
    },
    quickStatsHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 16,
    },
    quickStatsHeaderLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    quickStatsTitleDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: '#4F46E5',
    },
    quickStatsTitle: {
      fontSize: 16,
      fontWeight: '800',
      color: theme.textPrimary,
    },
    quickStatsSubtitle: {
      fontSize: 11,
      fontWeight: '700',
      color: '#10B981',
      backgroundColor: theme.isDark ? 'rgba(16,185,129,0.15)' : '#ECFDF5',
      paddingHorizontal: 10,
      paddingVertical: 3,
      borderRadius: 20,
      overflow: 'hidden',
      letterSpacing: 0.5,
    },
    statsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
    },
    statCard: {
      width: '46%',
      backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : '#F9FAFB',
      borderRadius: 16,
      padding: 14,
      alignItems: 'flex-start',
      borderWidth: 1,
      borderColor: theme.isDark ? 'rgba(255,255,255,0.08)' : '#F3F4F6',
    },
    statIconBox: {
      width: 38,
      height: 38,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 10,
    },
    statNumber: {
      fontSize: 22,
      fontWeight: '800',
      marginBottom: 2,
    },
    statLabel: {
      fontSize: 12,
      color: theme.textSecondary,
      fontWeight: '500',
    },
    infoText: {
      color: theme.textMuted,
      marginTop: 8,
      fontSize: 12,
    },
    statsRow: {
      flexDirection: 'row',
      justifyContent: 'space-around',
    },
    statItem: {
      alignItems: 'center',
    },
    aiReaderContainer: {
      marginBottom: 20,
      borderRadius: 22,
      overflow: 'hidden',
      backgroundColor: theme.cardBackground,
      shadowColor: '#4F46E5',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.18,
      shadowRadius: 14,
      elevation: 6,
    },
    aiReaderHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 16,
      paddingHorizontal: 18,
    },
    aiReaderHeaderIcon: {
      width: 42,
      height: 42,
      borderRadius: 13,
      backgroundColor: 'rgba(255,255,255,0.18)',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    aiReaderHeaderText: {
      flex: 1,
    },
    aiReaderTitle: {
      fontSize: 17,
      fontWeight: '800',
      color: '#fff',
    },
    aiReaderSubtitle: {
      fontSize: 12,
      color: 'rgba(255,255,255,0.75)',
      marginTop: 1,
    },
    aiReaderBadgePill: {
      backgroundColor: 'rgba(255,255,255,0.2)',
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 20,
    },
    aiReaderBadgeText: {
      color: '#fff',
      fontWeight: '800',
      fontSize: 12,
      letterSpacing: 1,
    },
    aiReaderBody: {
      padding: 16,
    },
    cameraPrimaryBtn: {
      borderRadius: 14,
      overflow: 'hidden',
      marginBottom: 12,
    },
    cameraPrimaryBtnInner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 16,
      gap: 10,
    },
    cameraPrimaryBtnText: {
      color: '#fff',
      fontWeight: '700',
      fontSize: 16,
    },
    aiReaderSecondRow: {
      flexDirection: 'row',
      gap: 12,
      marginBottom: 4,
    },
    cameraSecondaryBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 13,
      borderRadius: 13,
      borderWidth: 1.5,
      backgroundColor: theme.cardBackground,
      gap: 6,
    },
    cameraSecondaryBtnText: {
      fontWeight: '700',
      fontSize: 14,
    },
    btnDisabled: {
      opacity: 0.5,
    },
    processingContainer: {
      alignItems: 'center',
      paddingVertical: 24,
      paddingHorizontal: 16,
      marginTop: 12,
      backgroundColor: theme.isDark ? '#1E1B4B' : '#EEF2FF',
      borderRadius: 16,
    },
    processingTitle: {
      marginTop: 12,
      fontSize: 15,
      fontWeight: '700',
      color: '#4F46E5',
    },
    processingSubText: {
      marginTop: 4,
      fontSize: 12,
      color: theme.textSecondary,
    },
    resultContainer: {
      marginTop: 14,
      borderRadius: 16,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: theme.isDark ? '#312E81' : '#E0E7FF',
      backgroundColor: theme.isDark ? '#1E1B4B' : '#F5F3FF',
    },
    resultHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: theme.isDark ? '#312E81' : '#E0E7FF',
    },
    resultHeaderLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    resultDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: '#4F46E5',
    },
    resultTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: theme.textPrimary,
    },
    resultHeaderActions: {
      flexDirection: 'row',
    },
    resultIconBtn: {
      width: 34,
      height: 34,
      borderRadius: 10,
      backgroundColor: theme.isDark ? '#312E81' : '#EEF2FF',
      alignItems: 'center',
      justifyContent: 'center',
    },
    resultScroll: {
      maxHeight: 260,
    },
    resultScrollContent: {
      padding: 14,
    },
    resultText: {
      color: theme.textPrimary,
      lineHeight: 24,
      fontSize: 15,
    },
    resultActions: {
      flexDirection: 'row',
      gap: 10,
      padding: 12,
      borderTopWidth: 1,
      borderTopColor: theme.isDark ? '#312E81' : '#E0E7FF',
    },
    resultActionOutline: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 11,
      borderRadius: 11,
      borderWidth: 1.5,
      borderColor: '#4F46E5',
      backgroundColor: 'transparent',
    },
    resultActionFilled: {
      flex: 2,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 11,
      borderRadius: 11,
      backgroundColor: '#4F46E5',
    },
    resultActionText: {
      fontWeight: '700',
      fontSize: 13,
    },
    sectionDescription: {
      fontSize: 14,
      color: theme.textSecondary,
      marginTop: 4,
      lineHeight: 20,
    },
    // ── Smart Scan styles ──
    smartScanHeroContainer: {
      marginBottom: 20,
      borderRadius: 20,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: theme.cardBorder,
      shadowColor: '#10B981',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 10,
      elevation: 5,
    },
    smartScanHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    smartScanHeaderLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      flex: 1,
    },
    smartScanIconCircle: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: 'rgba(255, 255, 255, 0.2)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    smartScanHeaderText: {
      flex: 1,
    },
    smartScanTitle: {
      fontSize: 18,
      fontWeight: '800',
      color: '#FFFFFF',
    },
    smartScanSubtitle: {
      fontSize: 12,
      color: 'rgba(255, 255, 255, 0.85)',
      marginTop: 2,
    },
    smartScanBadgePill: {
      backgroundColor: 'rgba(255, 255, 255, 0.25)',
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 12,
    },
    smartScanBadgeText: {
      color: '#FFFFFF',
      fontSize: 11,
      fontWeight: '700',
    },
    smartScanBody: {
      padding: 16,
    },
    smartScanDocPillHeader: {
      fontSize: 11,
      fontWeight: '600',
      textTransform: 'uppercase',
      marginBottom: 8,
    },
    smartScanPillsScroll: {
      gap: 8,
      marginBottom: 16,
    },
    smartScanPill: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 16,
    },
    smartScanPillText: {
      fontSize: 12,
      fontWeight: '700',
    },
    smartScanBtnRow: {
      flexDirection: 'row',
      gap: 10,
    },
    smartScanPrimaryBtn: {
      flex: 1,
      borderRadius: 14,
      overflow: 'hidden',
    },
    smartScanBtnGradient: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 14,
    },
    smartScanBtnText: {
      color: '#FFFFFF',
      fontSize: 15,
      fontWeight: '700',
    },
    smartScanSecondaryBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 14,
      borderRadius: 14,
      borderWidth: 1.5,
      backgroundColor: 'transparent',
    },
    smartScanSecondaryBtnText: {
      fontSize: 15,
      fontWeight: '700',
    },
    smartScanLoadingBox: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 20,
      gap: 8,
    },
    smartScanLoadingTitle: {
      fontSize: 15,
      fontWeight: '700',
    },
    smartScanLoadingSub: {
      fontSize: 12,
    },
    smartScanErrorCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: 'rgba(239, 68, 68, 0.1)',
      borderWidth: 1,
      borderColor: '#EF4444',
      padding: 12,
      borderRadius: 14,
      marginTop: 12,
    },
    smartScanErrorTitle: {
      color: '#EF4444',
      fontWeight: '700',
      fontSize: 14,
    },
    smartScanErrorText: {
      color: '#EF4444',
      fontSize: 12,
      marginTop: 2,
    },
    smartScanRetryBtn: {
      backgroundColor: '#EF4444',
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
    },
    smartScanRetryBtnText: {
      color: '#FFFFFF',
      fontSize: 12,
      fontWeight: '700',
    },
    // ── Royal EverySense Overhaul Styles ──
    brandHeader: {
      paddingTop: 8,
      paddingBottom: 4,
    },
    brandRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    brandTitleWrap: {
      marginLeft: 10,
    },
    brandKicker: {
      fontSize: 13,
      fontWeight: '800',
      letterSpacing: 1.5,
    },
    brandTagline: {
      fontSize: 11,
      fontWeight: '500',
      marginTop: 1,
    },
    heroSection: {
      marginVertical: 18,
    },
    heroHeading: {
      fontSize: 26,
      fontWeight: '700',
      letterSpacing: -0.4,
      marginBottom: 6,
    },
    heroSubtext: {
      fontSize: 14,
      lineHeight: 21,
      fontWeight: '400',
    },
    primaryScanActionsRow: {
      flexDirection: 'row',
      gap: 12,
      marginBottom: 16,
    },
    scanActionBtnPrimary: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 48,
      borderRadius: 16,
      paddingHorizontal: 14,
      paddingVertical: 14,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 4,
      elevation: 3,
    },
    scanActionPrimaryText: {
      color: '#0B1020',
      fontSize: 14,
      fontWeight: '700',
    },
    scanActionBtnSecondary: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 48,
      borderRadius: 16,
      paddingHorizontal: 12,
      paddingVertical: 14,
      borderWidth: 1,
    },
    scanActionSecondaryText: {
      fontSize: 13,
      fontWeight: '600',
    },
    scanningBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 14,
      borderRadius: 14,
      borderWidth: 1,
      marginBottom: 16,
    },
    scanningBannerText: {
      fontSize: 14,
      fontWeight: '500',
    },
    scanErrorBox: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 14,
      borderRadius: 14,
      borderWidth: 1,
      marginBottom: 16,
    },
    scanErrorText: {
      flex: 1,
      fontSize: 13,
      lineHeight: 18,
    },
    retryBtn: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
    },
    retryText: {
      fontSize: 13,
      fontWeight: '700',
    },
    allCaughtUpCard: {
      padding: 20,
      borderRadius: 18,
      borderWidth: 1,
      marginBottom: 20,
    },
    allCaughtUpHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 10,
    },
    allCaughtUpIconCircle: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
    },
    allCaughtUpKicker: {
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 1.2,
    },
    allCaughtUpHeading: {
      fontSize: 17,
      fontWeight: '700',
      marginTop: 2,
    },
    allCaughtUpBody: {
      fontSize: 14,
      lineHeight: 20,
    },
    ttsCard: {
      padding: 18,
      borderRadius: 18,
      borderWidth: 1,
      marginBottom: 20,
    },
    ttsHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 12,
    },
    ttsIconWrap: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ttsTitle: {
      fontSize: 12,
      fontWeight: '800',
      letterSpacing: 1.2,
    },
    ttsInput: {
      borderWidth: 1,
      borderRadius: 14,
      padding: 12,
      minHeight: 80,
      marginBottom: 14,
    },
    readAloudBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 48,
      borderRadius: 14,
      borderWidth: 1,
      paddingVertical: 12,
    },
    readAloudBtnText: {
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 0.8,
    },
    shortcutsRow: {
      flexDirection: 'row',
      gap: 10,
      marginBottom: 24,
    },
    shortcutItem: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      minHeight: 46,
      paddingVertical: 12,
      borderRadius: 14,
      borderWidth: 1,
    },
    shortcutText: {
      fontSize: 13,
      fontWeight: '600',
    },
  });

export default HomeScreen;

