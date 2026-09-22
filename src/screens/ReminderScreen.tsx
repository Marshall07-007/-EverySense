import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { getNotificationsModule } from '../utils/safeNotifications';
import * as Speech from 'expo-speech';
import { speakText as ttsSpeakText, stopSpeaking as ttsStopSpeaking } from '../services/ttsService';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Animated,
    AppState,
    FlatList,
    LayoutAnimation,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    UIManager,
    View,
} from 'react-native';
import { AppTheme, getThemeConfig } from '../../constants/theme';
import { supabase } from '../../lib/supabase';
import { BackgroundLogo } from '../components/BackgroundLogo';
import Toast, { ToastType } from '../components/Toast';
import { useApp } from '../contexts/AppContext';
import type { MainTabParamList } from '../types';
import { cancelForReminder, rescheduleAll, scheduleForReminder } from '../utils/notificationService';
import { addToQueue, getQueueLength, processQueue } from '../utils/syncQueue';
import { networkMonitor } from '../utils/networkMonitor';
import { voiceManager } from '../utils/voiceCommandManager'; // ADDED: Import voice manager
// ADDED: NLP imports for natural language reminder creation
import { describeReminder, getReminderHelpText, isValidParsedReminder, parseReminderFromSpeech } from '../utils/nlpParser';
import { generateUUID } from '../utils/uuid'; // ADDED: UUID generator for temporary reminder IDs
import { sendChatMessage } from '../services/geminiService';

// BlurView fallback for environments without expo-blur
const BlurViewComponent: any = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('expo-blur').BlurView;
  } catch {
    return View;
  }
})();
let Clipboard: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Clipboard = require('expo-clipboard');
} catch {
  Clipboard = { setStringAsync: async (_: string) => { } };
}

// ADDED: Conditional import for voice input
let ExpoSpeechRecognitionModule: any = null;
try {
  ExpoSpeechRecognitionModule = require('expo-speech-recognition').ExpoSpeechRecognitionModule;
} catch (e) {}

type ReminderCategory = 'medication' | 'doctor' | 'therapy' | 'exercise' | 'personal' | 'emergency';
type ReminderPriority = 'low' | 'medium' | 'high';
type ReminderRecurrence = 'once' | 'daily' | 'weekly' | 'monthly';

type Reminder = {
  id: string;
  title: string;
  description?: string;
  datetime: Date;
  isCompleted: boolean;
  createdAt: Date;
  hasFired?: boolean;
  category?: ReminderCategory;
  priority?: ReminderPriority;
  recurrence?: ReminderRecurrence;
};

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const animateLayout = () => LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

const baseKey = 'reminders_v2';
const storageKey = (userId?: string | null) => (userId ? `${baseKey}_${userId}` : baseKey);

const ReminderScreen: React.FC = () => {
  const { state, dispatch } = useApp();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<MainTabParamList, 'Reminders'>>();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<ToastType>('success');
  const [modalVisible, setModalVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState<Date>(new Date(Date.now() + 60 * 60 * 1000));
  const [category, setCategory] = useState<ReminderCategory>('personal');
  const [priority, setPriority] = useState<ReminderPriority>('medium');
  const [recurrence, setRecurrence] = useState<ReminderRecurrence>('once');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<ReminderCategory | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'completed'>('active');
  const [showFilters, setShowFilters] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [fadeIn] = useState(new Animated.Value(0));
  const [slideUp] = useState(new Animated.Value(40));

  // Sync local reminders to AppContext so HomeScreen Quick Stats stays current
  useEffect(() => {
    const mapped = reminders.map(r => ({
      id: r.id,
      title: r.title,
      description: r.description,
      date: r.datetime,
      time: r.datetime,
      isCompleted: r.isCompleted,
      isActive: !r.isCompleted,
      createdAt: r.createdAt,
      updatedAt: new Date(),
      category: r.category as any,
      priority: r.priority as any,
      recurrence: r.recurrence,
    }));
    dispatch({ type: 'SET_REMINDERS', payload: mapped });
  }, [reminders]);

  const intervalRef = useRef<any>(null);
  const notifSubRef = useRef<any>(null);
  const spokenCooldownRef = useRef<Record<string, number>>({});
  const [alertReminder, setAlertReminder] = useState<Reminder | null>(null);
  const speakIntervalRef = useRef<any>(null);
  const voiceEditCleanupRef = useRef<(() => void) | null>(null);
  const isMountedRef = useRef(true);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [sendingTest, setSendingTest] = useState(false);
  const [editingReminderId, setEditingReminderId] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  // Briefing button states
  const [briefingLoading, setBriefingLoading] = useState(false); // blue — AI thinking
  const [briefingPlaying, setBriefingPlaying] = useState(false); // green — TTS speaking
  const [briefingMuted, setBriefingMuted]   = useState(false); // gray — muted after playing
  const briefingAbortRef  = useRef(false);
  const briefingTextRef   = useRef('');      // last generated briefing text for unmute replay
  const mutedByUserRef    = useRef(false);   // true when user explicitly tapped Mute

  // ADDED: Voice input states
  const [isVoiceInputMode, setIsVoiceInputMode] = useState(false);
  const [voiceField, setVoiceField] = useState<'title' | 'description' | null>(null);

   //Advanced voice action confirmation state
  type VoiceActionType = 'complete' | 'delete' | 'snooze' | 'edit';
  const [voiceConfirmVisible, setVoiceConfirmVisible] = useState(false);
  const [voiceConfirmAction, setVoiceConfirmAction] = useState<VoiceActionType | null>(null);
  const [voiceConfirmReminder, setVoiceConfirmReminder] = useState<Reminder | null>(null);

  // Voice edit wizard state
  type VoiceEditField = 'title' | 'description' | 'datetime' | 'category' | 'priority' | 'recurrence';
  type VoiceEditStep = 'select_reminder' | 'select_field' | 'capture_input' | 'confirm_change' | 'ask_continue';

  const [voiceEditActive, setVoiceEditActive] = useState(false);
  const [voiceEditReminder, setVoiceEditReminder] = useState<Reminder | null>(null);
  const [voiceEditStep, setVoiceEditStep] = useState<VoiceEditStep>('select_reminder');
  const [editReminderModalVisible, setEditReminderModalVisible] = useState(false);
  const [voiceEditField, setVoiceEditField] = useState<VoiceEditField | null>(null);
  const [voiceEditPending, setVoiceEditPending] = useState<Partial<Reminder>>({});
  const [voiceEditFlowVisible, setVoiceEditFlowVisible] = useState(false);
  
  // Optional import of DateTimePicker; fallback on web
  const DateTimePicker: any = Platform.OS === 'web' ? null : require('@react-native-community/datetimepicker').default;

  const theme = useMemo(() => getThemeConfig(state.accessibilitySettings.isDarkMode), [state.accessibilitySettings.isDarkMode]);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [androidPickerMode, setAndroidPickerMode] = useState<'date' | 'time' | null>(null);

  const parsePrefillDateSafely = (rawDate?: string): Date => {
    const defaultFuture = new Date(Date.now() + 60 * 60 * 1000); // Default to 1 hr in future
    if (!rawDate || typeof rawDate !== 'string' || rawDate.trim() === '' || rawDate === 'Not detected') {
      return defaultFuture;
    }

    const cleanStr = rawDate.trim();
    console.log('🗣️ [ReminderScreen Stage 3 - Parsing Prefill Date]:', cleanStr);

    try {
      let parsedDate: Date | null = null;

      // Priority Pattern 1: Local ISO string (YYYY-MM-DDTHH:mm:ss) without timezone suffix
      if (cleanStr.includes('T') || cleanStr.includes('Z')) {
        const localIsoMatch = cleanStr.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
        if (localIsoMatch && !cleanStr.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(cleanStr)) {
          const [, y, m, d, hr, min, sec] = localIsoMatch;
          const localParsed = new Date(
            parseInt(y, 10),
            parseInt(m, 10) - 1,
            parseInt(d, 10),
            parseInt(hr, 10),
            parseInt(min, 10),
            sec ? parseInt(sec, 10) : 0
          );
          if (!isNaN(localParsed.getTime())) parsedDate = localParsed;
        }

        if (!parsedDate) {
          const ts = Date.parse(cleanStr);
          if (!isNaN(ts)) {
            const d = new Date(ts);
            if (!isNaN(d.getTime()) && d.getFullYear() >= 2000) parsedDate = d;
          }
        }
      }

      // Pattern 1: DD-MM-YYYY or DD/MM/YYYY (4-digit year at end) e.g. "11-07-2020", "15/10/2026"
      if (!parsedDate) {
        const ddmmyyyyMatch = cleanStr.match(/^(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{4})$/);
        if (ddmmyyyyMatch) {
          const day = parseInt(ddmmyyyyMatch[1], 10);
          const month = parseInt(ddmmyyyyMatch[2], 10);
          const year = parseInt(ddmmyyyyMatch[3], 10);
          if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2000) {
            const d = new Date(year, month - 1, day, 10, 0, 0);
            if (!isNaN(d.getTime())) parsedDate = d;
          }
        }
      }

      // Pattern 2: YYYY-MM-DD or YYYY/MM/DD (4-digit year at start) e.g. "2026-10-15"
      if (!parsedDate) {
        const yyyymmddMatch = cleanStr.match(/^(\d{4})[\/\.-](\d{1,2})[\/\.-](\d{1,2})$/);
        if (yyyymmddMatch) {
          const year = parseInt(yyyymmddMatch[1], 10);
          const month = parseInt(yyyymmddMatch[2], 10);
          const day = parseInt(yyyymmddMatch[3], 10);
          if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2000) {
            const d = new Date(year, month - 1, day, 10, 0, 0);
            if (!isNaN(d.getTime())) parsedDate = d;
          }
        }
      }

      // Pattern 3: Fallback to standard Date.parse for text dates (e.g. "Oct 15, 2026")
      if (!parsedDate) {
        const ts = Date.parse(cleanStr);
        if (!isNaN(ts)) {
          const d = new Date(ts);
          if (!isNaN(d.getTime()) && d.getFullYear() >= 2000) parsedDate = d;
        }
      }

      if (!parsedDate || isNaN(parsedDate.getTime())) {
        console.error('[Reminder Debug Stage 3 Warning]: Unparseable date string, defaulting to +1 hr:', cleanStr);
        return defaultFuture;
      }

      // If parsed date is in the past, roll to tomorrow at the exact requested time rather than overwriting with +1hr
      if (parsedDate.getTime() <= Date.now()) {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const parsedStart = new Date(parsedDate);
        parsedStart.setHours(0, 0, 0, 0);
        if (parsedStart.getTime() <= todayStart.getTime()) {
          parsedDate.setDate(parsedDate.getDate() + 1);
        }
      }

      console.log('🗣️ [ReminderScreen Date Applied Successfully]:');
      console.log('   - Applied local date:', parsedDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }));
      console.log('   - Applied local time:', parsedDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }));
      return parsedDate;
    } catch (err) {
      console.error('[Reminder Debug Stage 3 Error]: Date parsing threw exception:', err);
      return defaultFuture;
    }
  };

  // Auto-open Create Reminder modal when navigated with prefillDescription or prefillTitle
  useEffect(() => {
    const prefill = route.params?.prefillDescription;
    const prefillTitleParam = route.params?.prefillTitle;
    const prefillDateParam = route.params?.prefillDate;

    if (prefill || prefillTitleParam || prefillDateParam) {
      console.log('🗣️ [Reminder Stage 3]: Navigation Params Received, title:', prefillTitleParam, 'rawDate:', prefillDateParam);

      const reminderTitle = prefillTitleParam || (prefill && prefill.length > 50 ? prefill.substring(0, 50) + '...' : prefill || 'New Reminder');
      setTitle(reminderTitle);
      setDescription(prefill || '');

      const targetDate = parsePrefillDateSafely(prefillDateParam);
      setDate(targetDate);

      setCategory('personal');
      setPriority('medium');
      setRecurrence('once');
      setEditingReminderId(null);
      setModalVisible(true);

      // Clear params safely using React Navigation API (never mutate route.params in-place)
      (navigation as any).setParams?.({
        prefillDescription: undefined,
        prefillTitle: undefined,
        prefillDate: undefined,
      });
    }
  }, [route.params?.prefillDescription, route.params?.prefillTitle, route.params?.prefillDate]);

  // Helper to speak with voice announcements check
  const speakText = (text: string) => {
    if (!state.voiceAnnouncementsEnabled) return;
    if (!text?.trim()) return;
    const safeRate = Math.max(0.5, Math.min(state.accessibilitySettings.voiceSpeed, 2.0));
    ttsSpeakText(text, {
      rate: safeRate,
      pitch: 1.0,
    });
  };

//Find the best matching reminder by name using fuzzy matching
  const findReminderByVoice = (transcript: string): Reminder | null => {
    const active = reminders.filter(r => !r.isCompleted);
    if (active.length === 0) return null;
    const t = transcript.toLowerCase();
    // Try exact title match first
    let match = active.find(r => t.includes(r.title.toLowerCase()));
    if (match) return match;
    // Try partial word match (at least 3 chars)
    match = active.find(r =>
      r.title.toLowerCase().split(' ').some(word => word.length >= 3 && t.includes(word))
    );
    return match || null;
  };

  // Show a voice confirmation dialog before performing destructive/important action
  const askVoiceConfirmation = (action: VoiceActionType, reminder: Reminder) => {
    const actionLabel = action === 'complete' ? 'mark as complete' : action === 'delete' ? 'delete' : 'snooze by 30 minutes';
    setVoiceConfirmAction(action);
    setVoiceConfirmReminder(reminder);
    setVoiceConfirmVisible(true);
    speakText(`Did you mean to ${actionLabel} "${reminder.title}"? Say yes or no, or tap a button.`);
  };

  // Execute the confirmed voice action
  const executeVoiceAction = async () => {
    if (!voiceConfirmReminder || !voiceConfirmAction) return;
    setVoiceConfirmVisible(false);
    const rem = voiceConfirmReminder;

    if (voiceConfirmAction === 'complete') {
      await toggleComplete(rem.id);
      speakText(`Reminder "${rem.title}" marked as complete.`);
    } else if (voiceConfirmAction === 'delete') {
      await cancelForReminder(rem.id);
      animateLayout();
      setReminders(prev => prev.filter(r => r.id !== rem.id));
      speakText(`Reminder "${rem.title}" deleted.`);
      (async () => {
        try {
          await supabase.from('reminders').delete().eq('id', rem.id);
        } catch {
          await addToQueue({ type: 'delete', reminderId: rem.id });
          if (isMountedRef.current) setPendingCount(prev => prev + 1);
        }
      })();
    } else if (voiceConfirmAction === 'snooze') {
      const newDate = new Date(Date.now() + 30 * 60 * 1000);
      const updated = { ...rem, datetime: newDate, hasFired: false };
      animateLayout();
      setReminders(prev => prev.map(r => r.id === rem.id ? updated : r));
      await scheduleForReminder(updated);
      speakText(`Reminder "${rem.title}" snoozed for 30 minutes.`);
      (async () => {
        try {
          await supabase.from('reminders').update({ reminder_datetime: newDate.toISOString() }).eq('id', rem.id);
        } catch {
          await addToQueue({ type: 'update', reminderId: rem.id, data: { reminder_datetime: newDate.toISOString() } });
          if (isMountedRef.current) setPendingCount(prev => prev + 1);
        }
      })();
    } else if (voiceConfirmAction === 'edit') {
      // Handle edit confirmation flow
      if (voiceEditStep === 'select_reminder') {
        // User confirmed the reminder selection - move to field selection
        setVoiceEditStep('select_field');
        setVoiceEditFlowVisible(true);
        speakText(`What would you like to edit? You can say title, description, time, category, priority, or repeat.`);
        setupVoiceEditListener('select_field');
      } else if (voiceEditStep === 'select_field') {
        // User confirmed the field selection - move to input capture
        captureVoiceEditValue();
      } else if (voiceEditStep === 'confirm_change') {
        // User confirmed the change value - save to pending and ask to continue
        setVoiceEditPending(prev => ({
          ...prev,
          [voiceEditField!]: voiceEditPending[voiceEditField!],
        }));
        askVoiceEditContinue();
      }
    }

    setVoiceConfirmAction(null);
    setVoiceConfirmReminder(null);
  };

  const cancelVoiceAction = () => {
    setVoiceConfirmVisible(false);
    setVoiceConfirmAction(null);
    setVoiceConfirmReminder(null);
    speakText('Action cancelled.');
  };

  // Helper function to set up voice listeners for edit flow
  const setupVoiceEditListener = (step?: VoiceEditStep, field?: VoiceEditField) => {
    const currentStep = step || voiceEditStep;
    const currentField = field || voiceEditField;

    if (!ExpoSpeechRecognitionModule) return;

    // Kill any listeners from a previous call before registering new ones
    voiceEditCleanupRef.current?.();
    voiceEditCleanupRef.current = null;

    try {
      let cleaned = false;
      let resultListener: any;
      let endListener: any;

      const cleanup = () => {
        if (!cleaned) {
          cleaned = true;
          resultListener?.remove();
          endListener?.remove();
          voiceEditCleanupRef.current = null;
        }
      };
      voiceEditCleanupRef.current = cleanup;

      resultListener = ExpoSpeechRecognitionModule.addListener('result', (event: any) => {
        if (event.isFinal) {
          const transcript = event.results?.[0]?.transcript || '';
          cleanup();

          // Route transcript to appropriate handler based on current step
          if (currentStep === 'select_field' && voiceEditReminder) {
            handleVoiceEditFieldSelection(transcript);
          } else if (currentStep === 'capture_input' && currentField) {
            // Process captured value based on field type
            processCapturedEditValue(transcript);
          } else if (currentStep === 'ask_continue') {
            // Handle yes/no for continuing edit
            const t = transcript.toLowerCase();
            if (t.includes('yes') || t.includes('yeah') || t.includes('yep')) {
              setVoiceEditStep('select_field');
              setVoiceEditFlowVisible(true);
              speakText('What field would you like to edit now? You can say title, description, time, category, priority, or repeat.');
              setupVoiceEditListener('select_field', undefined); // Reset field for new selection
            } else {
              finalizeVoiceEdit();
            }
          }
        }
      });

      // Clean up result listener if recognition ends without producing a final result
      endListener = ExpoSpeechRecognitionModule.addListener('end', () => {
        cleanup();
      });

      // Add a small delay to ensure microphone is ready before starting recognition
      setTimeout(() => {
        try {
          ExpoSpeechRecognitionModule.start({
            language: 'en-US',
            maxResults: 1,
            timeout: 8000, // 8 second timeout for user to speak
          });
        } catch (e) {
          console.error('Error starting speech recognition:', e);
          cleanup();
          speakText('Sorry, I had trouble starting voice input. Please try again.');
        }
      }, 300); // 300ms delay for microphone to be ready
    } catch (e) {
      console.error('Voice listener setup error:', e);
      speakText('Sorry, I had trouble with voice input. Please try again.');
    }
  };

  // Process captured value and format for field type
  const processCapturedEditValue = async (transcript: string) => {
    if (!voiceEditField) return;

    let processedValue: any = transcript;

    try {
      // Field-specific processing
      if (voiceEditField === 'datetime') {
        const parsed = parseReminderFromSpeech(transcript);
        if (parsed && parsed.datetime) {
          processedValue = parsed.datetime;
        } else {
          speakText('Sorry, I couldn\'t parse that time. Please try again.');
          captureVoiceEditValue();
          return;
        }
      } else if (voiceEditField === 'priority') {
        const t = transcript.toLowerCase();
        if (t.includes('high')) processedValue = 'high';
        else if (t.includes('medium') || t.includes('mid')) processedValue = 'medium';
        else if (t.includes('low')) processedValue = 'low';
        else {
          speakText('Please say high, medium, or low.');
          captureVoiceEditValue();
          return;
        }
      } else if (voiceEditField === 'category') {
        const t = transcript.toLowerCase();
        const categories: VoiceEditField[] = [];
        if (t.includes('personal')) processedValue = 'personal';
        else if (t.includes('work')) processedValue = 'work';
        else if (t.includes('health')) processedValue = 'health';
        else if (t.includes('finance') || t.includes('money') || t.includes('cash')) processedValue = 'finance';
        else if (t.includes('shopping') || t.includes('shop')) processedValue = 'shopping';
        else if (t.includes('other')) processedValue = 'other';
        else {
          speakText('Please say personal, work, health, finance, shopping, or other.');
          captureVoiceEditValue();
          return;
        }
      } else if (voiceEditField === 'recurrence') {
        const t = transcript.toLowerCase();
        if (t.includes('once') || t.includes('one time')) processedValue = 'once';
        else if (t.includes('daily')) processedValue = 'daily';
        else if (t.includes('weekly')) processedValue = 'weekly';
        else if (t.includes('monthly')) processedValue = 'monthly';
        else {
          speakText('Please say once, daily, weekly, or monthly.');
          captureVoiceEditValue();
          return;
        }
      }

      // Store the processed value in pending
      setVoiceEditPending(prev => ({
        ...prev,
        [voiceEditField]: processedValue,
      }));

      // Move to confirmation step
      confirmVoiceEditChange();
    } catch (e) {
      console.error('Error processing value:', e);
      speakText('Sorry, I had trouble processing that. Please try again.');
      captureVoiceEditValue();
    }
  };

  // Voice edit wizard functions
  const startVoiceEditWizard = () => {
    setVoiceEditActive(true);
    setVoiceEditStep('select_reminder');
    setVoiceEditReminder(null);
    setVoiceEditField(null);
    setVoiceEditPending({});
    setVoiceEditFlowVisible(true);
    speakText('Say the name or number of the reminder you want to edit');

    if (!ExpoSpeechRecognitionModule) {
      Alert.alert('Voice Input Not Available', 'Voice input is only available in development builds');
      setVoiceEditActive(false);
      setVoiceEditFlowVisible(false);
      return;
    }

    try {
      // Set up listener for reminder selection
      let ciCleaned = false;
      let resultListener: any;
      let endListener: any;
      const ciCleanup = () => {
        if (!ciCleaned) { ciCleaned = true; resultListener?.remove(); endListener?.remove(); }
      };
      resultListener = ExpoSpeechRecognitionModule.addListener('result', (event: any) => {
        if (event.isFinal) {
          const transcript = event.results?.[0]?.transcript || '';
          ciCleanup();
          handleVoiceEditReminderSelection(transcript);
        }
      });
      endListener = ExpoSpeechRecognitionModule.addListener('end', () => { ciCleanup(); });

      // Add delay to ensure microphone is ready
      setTimeout(() => {
        try {
          ExpoSpeechRecognitionModule.start({
            language: 'en-US',
            maxResults: 1,
            timeout: 8000, // 8 second timeout for user to speak
          });
        } catch (e) {
          console.error('Voice input error:', e);
          resultListener.remove();
          speakText('Sorry, I had trouble starting voice input. Please try again.');
          setVoiceEditActive(false);
          setVoiceEditFlowVisible(false);
        }
      }, 300); // 300ms delay for microphone to be ready
    } catch (e) {
      console.error('Voice input error:', e);
      speakText('Sorry, I had trouble starting voice input. Please try again.');
      setVoiceEditActive(false);
      setVoiceEditFlowVisible(false);
    }
  };

  const handleVoiceEditReminderSelection = (transcript: string) => {
    if (!transcript.trim()) {
      speakText('I did not hear anything. Please say the reminder name or number again.');
      startVoiceEditWizard();
      return;
    }

    // Try fuzzy matching first
    let found = findReminderByVoice(transcript);

    // Try number matching if no name match (e.g., "number 2" or "2")
    if (!found) {
      const numberMatch = transcript.match(/(?:number\s+)?(\d+)/i);
      if (numberMatch) {
        const activeReminders = reminders.filter(r => !r.isCompleted);
        const index = parseInt(numberMatch[1], 10) - 1;
        if (index >= 0 && index < activeReminders.length) {
          found = activeReminders[index];
        }
      }
    }

    if (!found) {
      const activeReminders = reminders.filter(r => !r.isCompleted);
      if (activeReminders.length === 0) {
        speakText('You have no reminders to edit.');
        setVoiceEditActive(false);
        setVoiceEditFlowVisible(false);
        return;
      }

      const firstFew = activeReminders.slice(0, 3).map(r => r.title).join(', ');
      speakText(`I couldn't find that. You have reminders: ${firstFew}. Try saying the reminder name more clearly.`);
      startVoiceEditWizard();
      return;
    }

    // Found a reminder - ask for confirmation
    setVoiceEditReminder(found);
    setVoiceConfirmAction('edit');
    setVoiceConfirmReminder(found);
    setVoiceConfirmVisible(true);
    speakText(`Did you mean to edit "${found.title}"? Say yes or no.`);
  };

  const handleVoiceEditFieldSelection = (transcript: string) => {
    if (!transcript.trim()) {
      speakText('I did not hear anything. Please say the field name again. You can say: title, description, time, category, priority, or repeat.');
      return;
    }

    const t = transcript.toLowerCase();
    let field: VoiceEditField | null = null;

    // Match variations of field names
    if (t.includes('title') || t.includes('name') || t.includes('task')) {
      field = 'title';
    } else if (t.includes('time') || t.includes('datetime') || t.includes('date') || t.includes('when')) {
      field = 'datetime';
    } else if (t.includes('description') || t.includes('details') || t.includes('note')) {
      field = 'description';
    } else if (t.includes('category') || t.includes('type') || t.includes('tag')) {
      field = 'category';
    } else if (t.includes('priority') || t.includes('importance') || t.includes('level')) {
      field = 'priority';
    } else if (t.includes('repeat') || t.includes('recurrence') || t.includes('frequency')) {
      field = 'recurrence';
    }

    if (!field) {
      speakText('I didn\'t recognize that field. You can say: title, description, time, category, priority, or repeat.');
      return;
    }

    setVoiceEditField(field);
    setVoiceConfirmAction('edit');
    setVoiceConfirmVisible(true);
    speakText(`Edit the ${field}? Say yes or no.`);
  };

  const captureVoiceEditValue = () => {
    if (!voiceEditField) return;

    setVoiceEditStep('capture_input');
    setVoiceEditFlowVisible(true);

    const fieldLabels: Record<VoiceEditField, string> = {
      title: 'reminder title',
      description: 'description',
      datetime: 'reminder time, for example: tomorrow at 3 PM',
      category: 'category: personal, work, health, finance, shopping, or other',
      priority: 'priority: high, medium, or low',
      recurrence: 'repeat option: once, daily, weekly, or monthly',
    };

    speakText(`Say the new ${fieldLabels[voiceEditField]}`);
    setupVoiceEditListener();
  };

  const confirmVoiceEditChange = () => {
    if (!voiceEditField) return;

    setVoiceEditStep('confirm_change');
    let confirmationText = '';

    const fieldValue = voiceEditPending[voiceEditField];

    switch (voiceEditField) {
      case 'title':
        confirmationText = `Change title to "${fieldValue}"?`;
        break;
      case 'description':
        confirmationText = `Change description to "${fieldValue}"?`;
        break;
      case 'datetime':
        if (fieldValue instanceof Date) {
          const formatted = fieldValue.toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
          confirmationText = `Change time to ${formatted}?`;
        } else {
          confirmationText = `Change time to "${fieldValue}"?`;
        }
        break;
      case 'category':
        confirmationText = `Change category to ${fieldValue}?`;
        break;
      case 'priority':
        confirmationText = `Change priority to ${fieldValue}?`;
        break;
      case 'recurrence':
        confirmationText = `Change repeat to ${fieldValue}?`;
        break;
    }

    setVoiceConfirmVisible(true);
    speakText(confirmationText);
  };

  const askVoiceEditContinue = () => {
    setVoiceEditStep('ask_continue');
    setVoiceEditFlowVisible(true);
    speakText('Edit another field? Say yes or no.');
    setupVoiceEditListener();
  };

  const finalizeVoiceEdit = async () => {
    if (!voiceEditReminder || Object.keys(voiceEditPending).length === 0) {
      setVoiceEditActive(false);
      setVoiceEditFlowVisible(false);
      return;
    }

    const updated: Reminder = {
      ...voiceEditReminder,
      ...voiceEditPending,
    };

    // Update local state immediately
    animateLayout();
    setReminders(prev => prev.map(r => r.id === updated.id ? updated : r));

    // Reschedule if datetime changed
    if (voiceEditPending.datetime) {
      await cancelForReminder(updated.id);
      await scheduleForReminder(updated);
    }

    // Announce what was changed
    const editedFields = Object.keys(voiceEditPending).join(', ');
    speakText(`Reminder updated: ${editedFields}`);

    // Sync to Supabase (or queue if offline)
    try {
      const updateData: any = {};
      if (voiceEditPending.title) updateData.title = voiceEditPending.title;
      if (voiceEditPending.description) updateData.description = voiceEditPending.description;
      if (voiceEditPending.datetime) updateData.reminder_datetime = voiceEditPending.datetime.toISOString();
      if (voiceEditPending.category) updateData.category = voiceEditPending.category;
      if (voiceEditPending.priority) updateData.priority = voiceEditPending.priority;
      if (voiceEditPending.recurrence) updateData.frequency = voiceEditPending.recurrence;

      await supabase.from('reminders').update(updateData).eq('id', updated.id);
    } catch (error) {
      // Queue if offline
      await addToQueue({
        type: 'update',
        reminderId: updated.id,
        data: voiceEditPending,
      });
      setPendingCount(prev => prev + 1);
      speakText('Changes queued. Will sync when online.');
    }

    // Reset state
    setVoiceEditActive(false);
    setVoiceEditFlowVisible(false);
    setVoiceEditReminder(null);
    setVoiceEditField(null);
    setVoiceEditPending({});
  };

  // ADDED: Voice command registration with NLP support
  useEffect(() => {
    // Clear previous reminder commands
    voiceManager.removeCommand(['set reminder', 'remind me to', 'create reminder']);
    voiceManager.removeCommand(['show reminders', 'list reminders', 'view reminders', 'my reminders',
      'read reminders', 'read my reminders',
      'what reminders do i have', 'what reminders do i have today',
      'tell me my reminders', 'do i have any reminders',
      'what do i have', 'check reminders']);
    voiceManager.removeCommand(['reminder help', 'help with reminders']);

    // NLP-POWERED VOICE COMMAND - Supports natural language
    voiceManager.addCommand({
      keywords: ['set reminder', 'remind me to', 'create reminder', 'add reminder', 'make reminder'],
      action: (fullTranscript) => {
        if (fullTranscript) {
          console.log('🎯 Processing natural language reminder:', fullTranscript);
          handleNaturalLanguageReminder(fullTranscript);
        } else {
          // Fallback: just open modal
          speakText('Opening reminder creation');
          openModal();
        }
      },
      description: 'Create reminder from natural language',
      category: 'reminder',
      captureFullTranscript: true // IMPORTANT: Capture full transcript for NLP
    });

    // Read reminders — covers both "show" and "read" intents
    voiceManager.addCommand({
      keywords: [
        'show reminders', 'list reminders', 'view reminders', 'my reminders',
        'read reminders', 'read my reminders',
        'what reminders do i have', 'what reminders do i have today',
        'tell me my reminders', 'do i have any reminders',
        'what do i have', 'check reminders',
      ],
      action: () => {
        const activeReminders = reminders.filter(r => !r.isCompleted);

        if (activeReminders.length === 0) {
          Alert.alert('Your Reminders', 'You have no active reminders.');
          speakText('You have no active reminders');
          return;
        }

        const now = new Date();
        let announcement = `You have ${activeReminders.length} active reminder${activeReminders.length !== 1 ? 's' : ''}. `;
        const lines: string[] = [];

        activeReminders.forEach((reminder, index) => {
          const isOverdue = reminder.datetime < now;
          const time = reminder.datetime.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          });
          const date = reminder.datetime.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          });
          const overdueTag = isOverdue ? ' (overdue)' : '';
          const line = `${index + 1}. ${reminder.title} at ${time} on ${date}${overdueTag}`;
          announcement += line + '. ';
          lines.push(line);
        });

        Alert.alert('Your Reminders', lines.join('\n'));
        speakText(announcement);
      },
      description: 'Read all active reminders with times',
      category: 'reminder',
    });

    // Help command
    voiceManager.addCommand({
      keywords: ['reminder help', 'help with reminders', 'how to create reminder'],
      action: () => {
        speakText(getReminderHelpText());
      },
      description: 'Get help with voice commands',
      category: 'reminder'
    });

        // Complete reminder by voice
    voiceManager.addCommand({
      keywords: ['complete reminder', 'done reminder', 'finish reminder', 'mark complete', 'mark done', 'complete task'],
      action: (fullTranscript) => {
        const transcript = fullTranscript || '';
        const found = findReminderByVoice(transcript);
        if (!found) {
          const activeCount = reminders.filter(r => !r.isCompleted).length;
          if (activeCount === 0) {
            speakText('You have no active reminders to complete.');
          } else {
            speakText(`I couldn't find that reminder. You have ${activeCount} active reminders. Try saying the reminder name more clearly.`);
          }
          return;
        }
        askVoiceConfirmation('complete', found);
      },
      description: 'Mark a reminder as complete by voice',
      category: 'reminder',
      captureFullTranscript: true,
    });

    // Delete reminder by voice
    voiceManager.addCommand({
      keywords: ['delete reminder', 'remove reminder', 'cancel reminder', 'delete task', 'remove task'],
      action: (fullTranscript) => {
        const transcript = fullTranscript || '';
        const found = findReminderByVoice(transcript);
        if (!found) {
          speakText(`I couldn't find that reminder. Try saying the reminder name more clearly.`);
          return;
        }
        askVoiceConfirmation('delete', found);
      },
      description: 'Delete a reminder by voice',
      category: 'reminder',
      captureFullTranscript: true,
    });

    // Snooze reminder by voice
    voiceManager.addCommand({
      keywords: ['snooze reminder', 'snooze task', 'remind me later', 'delay reminder', 'postpone reminder'],
      action: (fullTranscript) => {
        const transcript = fullTranscript || '';
        const found = findReminderByVoice(transcript);
        if (!found) {
          speakText(`I couldn't find that reminder. Try saying the reminder name more clearly.`);
          return;
        }
        askVoiceConfirmation('snooze', found);
      },
      description: 'Snooze a reminder by 30 minutes',
      category: 'reminder',
      captureFullTranscript: true,
    });

    // Edit reminder by voice (guided wizard)
    voiceManager.addCommand({
      keywords: ['edit reminder', 'modify reminder', 'change reminder', 'update reminder'],
      action: (fullTranscript) => {
        console.log('🎯 Edit reminder command triggered');
        const transcript = fullTranscript || '';
        // Try to find reminder directly if mentioned in same sentence
        const found = findReminderByVoice(transcript);
        if (found) {
          console.log('✅ Found reminder by voice:', found.title);
          setVoiceEditReminder(found);
          setVoiceEditStep('select_field');
          setVoiceEditFlowVisible(true);
          speakText(`Editing "${found.title}". What would you like to edit? You can say title, description, time, category, priority, or repeat.`);
        } else {
          // Show visual reminder selection modal instead of voice input
          console.log('📋 Opening reminder selection modal');
          setEditReminderModalVisible(true);
          speakText('Please select a reminder to edit from the list.');
        }
      },
      description: 'Edit a reminder using guided voice steps',
      category: 'reminder',
      captureFullTranscript: true,
    });

        // Cleanup on unmount
    return () => {
      voiceManager.removeCommand(['set reminder', 'remind me to', 'create reminder']);
      voiceManager.removeCommand(['show reminders', 'list reminders', 'view reminders', 'my reminders',
        'read reminders', 'read my reminders',
        'what reminders do i have', 'what reminders do i have today',
        'tell me my reminders', 'do i have any reminders',
        'what do i have', 'check reminders']);
      voiceManager.removeCommand(['reminder help', 'help with reminders']);
      voiceManager.removeCommand(['complete reminder', 'done reminder', 'finish reminder', 'mark complete', 'mark done', 'complete task']);
      voiceManager.removeCommand(['delete reminder', 'remove reminder', 'cancel reminder', 'delete task', 'remove task']);
      voiceManager.removeCommand(['snooze reminder', 'snooze task', 'remind me later', 'delay reminder', 'postpone reminder']);
      voiceManager.removeCommand(['edit reminder', 'modify reminder', 'change reminder', 'update reminder']);
    };
  }, [reminders]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeIn, { toValue: 1, duration: 450, useNativeDriver: true }),
      Animated.timing(slideUp, { toValue: 0, duration: 450, useNativeDriver: true }),
    ]).start();
  }, []);

  useEffect(() => { return () => { isMountedRef.current = false; }; }, []);

  // Announce active reminder count every time the screen comes into focus
  useFocusEffect(
    useCallback(() => {
      if (!state.voiceAnnouncementsEnabled) return;
      const timer = setTimeout(() => {
        voiceManager.announceScreenChange('reminders');
        const activeCount = reminders.filter(r => !r.isCompleted).length;
        speakText(`You have ${activeCount} active ${activeCount === 1 ? 'reminder' : 'reminders'}.`);
      }, 500);
      return () => clearTimeout(timer);
    }, [reminders, state.voiceAnnouncementsEnabled])
  );

  // Reusable function to fetch reminders from Supabase
  const fetchReminders = async () => {
    try {
      const userId = state.user?.id;
      if (!userId) {
        setReminders([]);
        return;
      }

      // Try to flush any offline operations first
      await processQueue();

      const { data, error } = await supabase
        .from('reminders')
        .select('*')
        .eq('user_id', userId)
        .order('reminder_datetime', { ascending: true });

      if (error) throw error;

      const localReminders: Reminder[] = (data || []).map((r: any) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        datetime: new Date(r.reminder_datetime),
        isCompleted: r.is_completed,
        createdAt: r.created_at ? new Date(r.created_at) : new Date(),
        category: 'personal' as ReminderCategory,
        priority: (r.priority?.toLowerCase() || 'medium') as ReminderPriority,
        recurrence: (r.frequency?.toLowerCase() || 'once') as ReminderRecurrence,
      }));

      setReminders(localReminders);
      await rescheduleAll(localReminders);

      // Reflect how many ops are still waiting
      const remaining = await getQueueLength();
      setPendingCount(remaining);
    } catch (e) {
      console.warn('Failed to load reminders from Supabase, trying AsyncStorage fallback:', e);

      // Fallback to AsyncStorage if Supabase is unreachable
      try {
        const key = storageKey(state.user?.id);
        const stored = await AsyncStorage.getItem(key);
        if (stored) {
          const parsed: Reminder[] = JSON.parse(stored).map((r: any) => ({
            ...r,
            datetime: new Date(r.datetime),
            createdAt: new Date(r.createdAt),
          }));
          setReminders(parsed);
          await rescheduleAll(parsed);
        } else {
          setReminders([]);
        }
      } catch (fallbackError) {
        console.warn('Failed to load reminders from AsyncStorage too');
        setReminders([]);
      }

      // Show how many ops are pending even when offline
      const remaining = await getQueueLength();
      setPendingCount(remaining);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchReminders();
    setRefreshing(false);
  };

  useEffect(() => {
    fetchReminders();
  }, [state.user?.id]);

  // Auto-sync when app comes back to foreground
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        fetchReminders();
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const key = storageKey(state.user?.id);
    AsyncStorage.setItem(
      key,
      JSON.stringify(reminders.map(r => ({ ...r, datetime: r.datetime.toISOString(), createdAt: r.createdAt.toISOString() })))
    ).catch(() => { });
  }, [reminders, state.user?.id]);

  // Effect 1: One-time setup — permissions, push token, Android channel, notification handler
  useEffect(() => {
    (async () => {
      const Notifications = getNotificationsModule();
      if (!Notifications) return;

      try {
        await Notifications.requestPermissionsAsync();
      } catch (e) {
        console.warn('Failed to request notification permissions:', e);
      }

      // Check if running inside Expo Go (remote push tokens removed in Expo Go on SDK 53+)
      const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient || (Constants as any).appOwnership === 'expo';

      if (!isExpoGo) {
        try {
          const projectId = (Constants as any).expoConfig?.extra?.eas?.projectId || (Constants as any).easConfig?.projectId || (Constants as any).expoConfig?.projectId;
          const tokenResp = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined as any);
          if (tokenResp?.data) setPushToken(tokenResp.data);
        } catch (e) {
          console.warn('Failed to get Expo push token:', e);
        }
      }

      if (Platform.OS === 'android') {
        try {
          await Notifications.setNotificationChannelAsync('reminders', {
            name: 'Reminders',
            importance: Notifications.AndroidImportance.HIGH,
            sound: 'default',
            vibrationPattern: [0, 250, 250, 250],
            lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
          });
        } catch (e) {
          console.warn('Failed to set notification channel:', e);
        }
      }

      try {
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowAlert: true,
            shouldPlaySound: true,
            shouldSetBadge: false,
            // @ts-ignore
            shouldShowBanner: true,
            // @ts-ignore
            shouldShowList: true,
          }),
        });
      } catch (e) {
        console.warn('Failed to set notification handler:', e);
      }
    })();
  }, []);

  // Effect 2: Foreground notification listener — needs reminders in closure
  useEffect(() => {
    const Notifications = getNotificationsModule();
    if (Notifications) {
      if (notifSubRef.current) {
        try { (Notifications as any).removeNotificationSubscription?.(notifSubRef.current); } catch { }
      }
      try {
        notifSubRef.current = Notifications.addNotificationReceivedListener((notification) => {
          const { data } = notification.request.content as any;
          const reminderId: string | undefined = data?.reminderId;
          const nowTs = Date.now();
          if (reminderId) {
            const last = spokenCooldownRef.current[reminderId] || 0;
            if (nowTs - last < 15000) {
              return; // prevent duplicates within 15s
            }
            spokenCooldownRef.current[reminderId] = nowTs;
            const rem = reminders.find(r => r.id === reminderId);
            if (rem) presentAlert(rem);
          }
        });
      } catch (e) {}
    }

    // Web/background fallback checker (fires once per reminder when Notifications module is absent or on web)
    if (Platform.OS === 'web' || !Notifications) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(() => {
        const now = new Date();
        reminders.forEach(rem => {
          if (!rem.isCompleted && !rem.hasFired && now.getTime() >= rem.datetime.getTime()) {
            triggerReminder(rem);
            setReminders(prev => prev.map(r => r.id === rem.id ? { ...r, hasFired: true } : r));
          }
        });
      }, 1000);
      return () => intervalRef.current && clearInterval(intervalRef.current);
    }
  }, [reminders]);

  const triggerReminder = async (rem: Reminder) => {
    // Haptic alert so hearing-impaired users feel the reminder firing
    try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } catch (_) { }
    const Notifications = getNotificationsModule();
    if (Notifications) {
      try {
        // Default notification sound + TTS
        await Notifications.scheduleNotificationAsync({
          content: {
            title: '⏰ Reminder',
            body: `It's time for: ${rem.title}${rem.description ? `. ${rem.description}` : ''}`,
            sound: true,
            data: { reminderId: rem.id },
          },
          trigger: null,
        });
      } catch (_) { }
    }
    presentAlert(rem);
  };

  const presentAlert = (rem: Reminder) => {
    setAlertReminder(rem);
    ttsStopSpeaking();
    speakText(buildSpokenMessage(rem.title, rem.description));
    if (speakIntervalRef.current) clearInterval(speakIntervalRef.current);
    speakIntervalRef.current = setInterval(() => {
      // repeat speech every 7 seconds until user responds
      speakText(buildSpokenMessage(rem.title, rem.description));
    }, 7000);
  };

  const handleAlertYes = () => {
    try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch (_) { }
    ttsStopSpeaking();
    if (speakIntervalRef.current) clearInterval(speakIntervalRef.current);
    if (alertReminder) {
      setReminders(prev => prev.map(r => r.id === alertReminder.id ? { ...r, hasFired: true } : r));
    }
    setAlertReminder(null);
  };

  const handleSnooze = async (minutes: number) => {
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch (_) { }
    ttsStopSpeaking();
    if (speakIntervalRef.current) clearInterval(speakIntervalRef.current);
    if (alertReminder) {
      const newDate = new Date(Date.now() + minutes * 60 * 1000);
      const updated = { ...alertReminder, datetime: newDate, hasFired: false };
      setReminders(prev => prev.map(r => r.id === alertReminder.id ? updated : r));
      await scheduleForReminder(updated);
      speakText(`Snoozed for ${minutes} minutes.`);
    }
    setAlertReminder(null);
  };

  const scheduleNative = async (rem: Reminder) => {
    const Notifications = getNotificationsModule();
    if (Notifications && Platform.OS !== 'web') {
      try {
        const delayMs = Math.max(1, rem.datetime.getTime() - Date.now());
        await Notifications.scheduleNotificationAsync({
          content: { title: '⏰ Reminder', body: rem.title, sound: true, data: { reminderId: rem.id } },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(Date.now() + delayMs) },
        });
      } catch (e) {}
    }
  };

  const openModal = () => {
    setTitle('');
    setDescription('');
    setDate(new Date(Date.now() + 60 * 60 * 1000));
    setCategory('personal');
    setPriority('medium');
    setRecurrence('once');
    setEditingReminderId(null);
    setModalVisible(true);
  };

  const handleCopyToken = async () => {
    if (!pushToken) return;
    try {
      await Clipboard.setStringAsync(pushToken);
      Alert.alert('Copied', 'Push token copied to clipboard.');
    } catch {
      Alert.alert('Error', 'Failed to copy token');
    }
  };

  const handleSendTestPush = async () => {
    const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient || (Constants as any).appOwnership === 'expo';
    if (isExpoGo) {
      Alert.alert('Expo Go Limitation', 'Remote push notifications are not supported in Expo Go on SDK 57. Use local reminders or a development build.');
      return;
    }
    if (!pushToken) return;
    try {
      setSendingTest(true);
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: pushToken,
          title: '⏰ Reminder (Test Push)',
          body: 'This is a test push notification.',
          sound: 'default',
          data: { kind: 'test' },
        }),
      });
      Alert.alert('Sent', 'Test push sent. Check your device.');
    } catch (e) {
      Alert.alert('Error', 'Failed to send test push');
    } finally {
      setSendingTest(false);
    }
  };

  // ADDED: Voice input handler for title and description
  const handleVoiceInput = async (field: 'title' | 'description') => {
    if (!ExpoSpeechRecognitionModule) {
      Alert.alert(
        'Feature Not Available',
        'Voice input requires a development build. Please run:\n\nnpx expo run:android --device'
      );
      return;
    }

    try {
      // Stop any ongoing TTS first
      await ttsStopSpeaking();

      setVoiceField(field);
      setIsVoiceInputMode(true);

      // Request permissions
      const permissionResult = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permissionResult.granted) {
        Alert.alert('Permission Required', 'Microphone permission is needed for voice input');
        setIsVoiceInputMode(false);
        return;
      }

      speakText(`Speak ${field} now`);

      // Set up one-time listener for the result
      let fCleaned = false;
      let resultListener: any;
      let endListener: any;
      const fCleanup = () => {
        if (!fCleaned) { fCleaned = true; resultListener?.remove(); endListener?.remove(); }
      };
      resultListener = ExpoSpeechRecognitionModule.addListener('result', (event: any) => {
        const transcript = event.results?.[0]?.transcript;
        const isFinal = event.isFinal;

        if (transcript && isFinal) {
          if (field === 'title') {
            setTitle(transcript);
          } else {
            setDescription(transcript);
          }
          speakText(`${field} set to: ${transcript}`);
          setIsVoiceInputMode(false);
          setVoiceField(null);
          fCleanup();
        }
      });
      endListener = ExpoSpeechRecognitionModule.addListener('end', () => {
        fCleanup();
        setIsVoiceInputMode(false);
        setVoiceField(null);
      });

      // Add a small delay to ensure microphone is ready before starting recognition
      setTimeout(() => {
        try {
          // Start recognition with extended timeout
          ExpoSpeechRecognitionModule.start({
            lang: 'en-US',
            interimResults: false,
            maxAlternatives: 1,
            continuous: false,
            timeout: 8000, // 8 second timeout for user to speak
          });
        } catch (error) {
          console.error('Error starting speech recognition:', error);
          resultListener.remove();
          setIsVoiceInputMode(false);
          setVoiceField(null);
          Alert.alert('Voice Error', 'Could not start voice input');
        }
      }, 300); // 300ms delay for microphone to be ready

    } catch (error) {
      console.error('Voice input error:', error);
      Alert.alert('Voice Error', 'Could not process voice input');
      setIsVoiceInputMode(false);
      setVoiceField(null);
    }
  };

  // ── AI Briefing ──────────────────────────────────────────────────────────────
  const speakBriefingText = (text: string) => {
    mutedByUserRef.current = false;
    ttsStopSpeaking();
    setBriefingPlaying(true);
    setBriefingMuted(false);

    ttsSpeakText(text, {
      rate: Math.max(0.5, Math.min(state.accessibilitySettings.voiceSpeed, 2.0)),
      onDone: () => {
        if (!mutedByUserRef.current) {
          setBriefingPlaying(false);
          setBriefingMuted(false);
        }
      },
      onStopped: () => {
        setBriefingPlaying(false);
      },
      onError: () => {
        setBriefingPlaying(false);
        if (!mutedByUserRef.current) setBriefingMuted(false);
      },
    });
  };

  const handleBriefing = async () => {
    // Mute — stop ongoing speech
    if (briefingPlaying) {
      mutedByUserRef.current = true;   // signal callbacks not to clear muted state
      ttsStopSpeaking();
      setBriefingPlaying(false);
      setBriefingMuted(true);
      return;
    }

    // Unmute — replay last briefing without another API call
    if (briefingMuted) {
      if (briefingTextRef.current) {
        speakBriefingText(briefingTextRef.current);
      } else {
        setBriefingMuted(false);
      }
      return;
    }

    // Cancel in-progress request
    if (briefingLoading) {
      briefingAbortRef.current = true;
      setBriefingLoading(false);
      return;
    }

    // ── Generate new briefing ──
    briefingAbortRef.current = false;
    setBriefingLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      const now = new Date();
      const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
      const todayEnd   = new Date(todayStart); todayEnd.setDate(todayStart.getDate() + 1);

      const todayReminders = reminders
        .filter(r => {
          const t = r.datetime.getTime();
          return t >= todayStart.getTime() && t < todayEnd.getTime() && !r.isCompleted;
        })
        .sort((a, b) => a.datetime.getTime() - b.datetime.getTime());

      const overdue       = reminders.filter(r => r.datetime.getTime() < now.getTime() && !r.isCompleted);
      const completedToday = reminders.filter(r => {
        const t = r.datetime.getTime();
        return r.isCompleted && t >= todayStart.getTime() && t < todayEnd.getTime();
      });

      const nextReminder      = todayReminders[0];
      const minutesUntilNext  = nextReminder
        ? Math.round((nextReminder.datetime.getTime() - now.getTime()) / 60000)
        : null;

      const overdueList = overdue
        .map(r => {
          const minsAgo = Math.round((now.getTime() - r.datetime.getTime()) / 60000);
          const timeAgo = minsAgo < 60
            ? `${minsAgo} minute${minsAgo !== 1 ? 's' : ''} ago`
            : `${Math.round(minsAgo / 60)} hour${Math.round(minsAgo / 60) !== 1 ? 's' : ''} ago`;
          return `- "${r.title}" was due ${timeAgo}${r.priority === 'high' ? ' (high priority)' : ''}`;
        })
        .join('\n') || 'none';

      const reminderList = todayReminders
        .map(r => {
          const minsLeft = Math.round((r.datetime.getTime() - now.getTime()) / 60000);
          const timeLeft = minsLeft < 60
            ? `in ${minsLeft} minute${minsLeft !== 1 ? 's' : ''}`
            : `in ${Math.round(minsLeft / 60)} hour${Math.round(minsLeft / 60) !== 1 ? 's' : ''}`;
          return `- "${r.title}" ${timeLeft} at ${r.datetime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` +
            (r.priority === 'high' ? ' (high priority)' : '');
        })
        .join('\n') || 'none today';

      const prompt =
        `Generate a warm, concise spoken daily briefing (2–4 sentences, under 60 words) for an accessibility app user. ` +
        `Natural speech only — no markdown, no bullet points, no asterisks.\n\n` +
        `Current time: ${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.\n` +
        `Overdue reminders (${overdue.length}): ${overdueList}\n` +
        `Upcoming reminders today (${todayReminders.length}): ${reminderList}\n` +
        `Completed today: ${completedToday.length}.\n` +
        (nextReminder && minutesUntilNext !== null && minutesUntilNext > 0
          ? `Next up: "${nextReminder.title}" in ${minutesUntilNext} minutes.\n`
          : '') +
        `Mention any overdue items by name and how long ago they were due. Be encouraging. Start with a time-of-day greeting.`;

      const briefing = await sendChatMessage([], prompt);

      if (briefingAbortRef.current) {
        setBriefingLoading(false);
        return;
      }

      if (!briefing || !briefing.trim()) {
        throw new Error('Empty briefing returned');
      }

      briefingTextRef.current = briefing.trim();
      setBriefingLoading(false);
      speakBriefingText(briefingTextRef.current);

    } catch (err: any) {
      briefingAbortRef.current = false;
      setBriefingLoading(false);
      setBriefingPlaying(false);
      const msg = err?.message === 'GROQ_API_KEY_MISSING'
        ? 'Groq API key is not configured.'
        : 'Could not generate briefing. Check your connection and try again.';
      Alert.alert('Briefing failed', msg);
    }
  };

  const showToast = (message: string, type: ToastType = 'success') => {
    setToastMessage(message);
    setToastType(type);
    setToastVisible(true);
  };

  const saveReminder = async () => {
    try {
      console.error('[Reminder Stage 4]: saveReminder Initiated, title:', title.trim());

      if (!title.trim()) {
        console.error('[Reminder Stage 4 Error]: Missing reminder title');
        Alert.alert('Missing title', 'Please enter a reminder title.');
        return;
      }
      if (!editingReminderId && reminders.length >= 50) {
        console.error('[Reminder Stage 4 Error]: Reminder limit reached');
        Alert.alert('Limit reached', 'You can only have up to 50 reminders.');
        return;
      }

      // Safely validate and sanitize date object without wiping user's intended hour
      let safeDate = date instanceof Date && !isNaN(date.getTime()) ? date : new Date(Date.now() + 60 * 60 * 1000);
      if (safeDate.getTime() <= Date.now()) {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const safeStart = new Date(safeDate);
        safeStart.setHours(0, 0, 0, 0);
        if (safeStart.getTime() <= todayStart.getTime()) {
          safeDate.setDate(safeDate.getDate() + 1);
        }
      }

      const userId = state.user?.id;

      if (editingReminderId) {
        const existingReminder = reminders.find(r => r.id === editingReminderId);

        // Apply update to local state immediately so the user sees changes right away
        if (existingReminder) {
          const updated: Reminder = {
            ...existingReminder,
            title: title.trim(),
            description: description.trim() || undefined,
            datetime: safeDate,
            category,
            priority,
            recurrence,
          };
          animateLayout();
          setReminders(prev => prev.map(r => r.id === editingReminderId ? updated : r));
          scheduleForReminder(updated).catch(err => console.warn('[Reminder Warning]: scheduleForReminder error:', err?.message || String(err)));
        }

        setModalVisible(false);
        setEditingReminderId(null);
        speakText(`Reminder "${title.trim()}" updated`);
        const isOnline = networkMonitor.getIsConnected();
        showToast(isOnline ? 'Reminder updated' : 'Saved locally — will sync when online', isOnline ? 'success' : 'info');

        // Sync to Supabase in background — queue if offline
        const idToUpdate = editingReminderId!;
        const updateData = {
          title: title.trim(),
          description: description.trim() || null,
          reminder_datetime: safeDate.toISOString(),
          frequency: recurrence,
          priority: priority,
        };
        (async () => {
          try {
            const { error } = await supabase
              .from('reminders')
              .update(updateData)
              .eq('id', idToUpdate);
            if (error) {
              console.warn('[Reminder] Supabase update response note:', error.message);
              await addToQueue({ type: 'update', reminderId: idToUpdate, data: updateData });
              if (isMountedRef.current) setPendingCount(prev => prev + 1);
            }
          } catch (err: any) {
            console.warn('[Reminder] Supabase update catch:', err?.message || String(err));
            await addToQueue({ type: 'update', reminderId: idToUpdate, data: updateData });
            if (isMountedRef.current) setPendingCount(prev => prev + 1);
          }
        })();

        return;
      }

      // Build the reminder object immediately so UI updates instantly
      const reminderId = generateUUID(); // Generate UUID once and reuse
      const newReminder: Reminder = {
        id: reminderId,
        title: title.trim(),
        description: description.trim() || undefined,
        datetime: safeDate,
        isCompleted: false,
        createdAt: new Date(),
        category,
        priority,
        recurrence,
      };

      console.error('[Reminder Stage 5]: Reminder Object Created Locally, id:', newReminder.id);

      // Close modal and show reminder in list right away
      animateLayout();
      setReminders(prev => [...prev, newReminder]);
      setModalVisible(false);
      speakText(`Reminder "${title.trim()}" created successfully`);
      const isOnline = networkMonitor.getIsConnected();
      showToast(isOnline ? 'Reminder saved!' : 'Saved locally — will sync when online', isOnline ? 'success' : 'info');

      // Do the background work (Supabase sync + local notification scheduling)
      const createData = {
        id: reminderId,
        title: title.trim(),
        description: description.trim() || null,
        reminder_datetime: safeDate.toISOString(),
        frequency: recurrence,
        priority: priority,
      };

      (async () => {
        try {
          if (userId) {
            try {
              const { error } = await supabase.from('reminders').insert({ user_id: userId, ...createData });
              if (error) {
                console.warn('[Reminder] Supabase insert response note (offline fallback):', error.message);
                await addToQueue({ type: 'create', data: { userId, ...createData } } as any);
                if (isMountedRef.current) setPendingCount(prev => prev + 1);
              }
            } catch (supaErr: any) {
              console.warn('[Reminder] Supabase insert exception (offline fallback):', supaErr?.message || String(supaErr));
              await addToQueue({ type: 'create', data: { userId, ...createData } } as any);
              if (isMountedRef.current) setPendingCount(prev => prev + 1);
            }
          }

          // Schedule local notification safely (respects Expo Go / null Notifications module)
          console.error('[Reminder Stage 6]: Scheduling Local Notification...');
          await scheduleForReminder(newReminder);
          console.error('[Reminder Stage 6]: Local Notification Scheduling Finished Successfully');
        } catch (bgErr: any) {
          console.error('[Reminder Stage 6 Error in background scheduling]:', bgErr?.message || String(bgErr));
        }
      })();
    } catch (saveErr: any) {
      console.error('[Reminder Stage 4 Fatal Error in saveReminder]:', saveErr?.message || String(saveErr));
      Alert.alert('Error', 'Could not save reminder. Please try again.');
    }
  };

  const scheduleRecurringReminders = async (reminder: Reminder) => {
    // Schedule future occurrences for recurring reminders
    const occurrences = 5; // Schedule next 5 occurrences
    for (let i = 1; i <= occurrences; i++) {
      const nextDate = new Date(reminder.datetime);
      if (reminder.recurrence === 'daily') {
        nextDate.setDate(nextDate.getDate() + i);
      } else if (reminder.recurrence === 'weekly') {
        nextDate.setDate(nextDate.getDate() + (i * 7));
      } else if (reminder.recurrence === 'monthly') {
        nextDate.setMonth(nextDate.getMonth() + i);
      }

      const Notifications = getNotificationsModule();
      if (Notifications && Platform.OS !== 'web' && nextDate.getTime() > Date.now()) {
        try {
          await Notifications.scheduleNotificationAsync({
            content: {
              title: '⏰ Recurring Reminder',
              body: reminder.title,
              sound: true,
              data: { reminderId: reminder.id }
            },
            trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: nextDate },
          });
        } catch (e) {}
      }
    }
  };

  // ADDED: Handle natural language reminder creation
  const handleNaturalLanguageReminder = async (transcript: string) => {
    try {
      console.log('📝 Parsing natural language:', transcript);

      const parsed = parseReminderFromSpeech(transcript);

      if (!parsed) {
        speakText("I couldn't understand that. Try saying: Set reminder for task at time");
        return;
      }

      if (!isValidParsedReminder(parsed)) {
        speakText(`I extracted "${parsed.title}" but couldn't understand the time. Try saying the time more clearly.`);
        return;
      }

      const reminderDatetime = parsed.datetime || new Date(Date.now() + 60 * 60 * 1000);
      if (isNaN(reminderDatetime.getTime()) || reminderDatetime.getTime() <= Date.now()) {
        speakText("The date or time seems invalid. Please try again with a future time.");
        return;
      }

      const userId = state.user?.id;
      if (!userId) {
        speakText("Please sign in first");
        return;
      }

      // Generate UUID for this reminder
      const reminderId = generateUUID();

      const createData = {
        id: reminderId, // Include the generated UUID
        title: parsed.title,
        description: parsed.description,
        reminder_datetime: reminderDatetime.toISOString(),
        frequency: 'once',
        priority: parsed.priority || 'medium',
      };

      // Add to local state immediately so user sees it right away
      const tempReminder: Reminder = {
        id: reminderId,
        title: parsed.title,
        description: parsed.description,
        datetime: reminderDatetime,
        isCompleted: false,
        createdAt: new Date(),
        category: (parsed.category as ReminderCategory) || 'personal',
        priority: (parsed.priority as ReminderPriority) || 'medium',
        recurrence: 'once',
        hasFired: false,
      };
      animateLayout();
      setReminders(prev => [...prev, tempReminder]);

      // Announce success immediately
      const desc = describeReminder(parsed);
      speakText(`Reminder created: ${desc}`);
      showToast(`Reminder saved!`);

      // Try to save to Supabase
      try {
        const { data: backendReminder, error: insertError } = await supabase
          .from('reminders')
          .insert({ user_id: userId, ...createData })
          .select()
          .single();

        if (insertError) throw insertError;

        // Success - backend created the reminder with the ID we provided
        await scheduleForReminder(tempReminder);
      } catch {
        // Offline — queue for later sync, keep temp reminder in local state
        await addToQueue({ type: 'create', userId, data: createData });
        setPendingCount(prev => prev + 1);
        await scheduleForReminder(tempReminder);
      }

    } catch (error) {
      console.error('❌ Error processing natural language reminder:', error);
      speakText("Sorry, I had trouble creating that reminder. Please try again.");
    }
  };

  const toggleComplete = async (id: string) => {
    const reminder = reminders.find(r => r.id === id);
    if (!reminder) return;

    const newCompletedStatus = !reminder.isCompleted;

    // Animate the completion state change
    animateLayout();
    // Update locally first for immediate feedback
    setReminders(prev => prev.map(r => (r.id === id ? { ...r, isCompleted: newCompletedStatus } : r)));

    // Cancel notification when completing; reschedule when re-activating
    if (newCompletedStatus) {
      await cancelForReminder(id);
    } else {
      await scheduleForReminder({ ...reminder, isCompleted: false });
    }

    // Sync with Supabase — queue if offline, never revert the local state
    try {
      const { error } = await supabase
        .from('reminders')
        .update({
          is_completed: newCompletedStatus,
        })
        .eq('id', id);

      if (error) throw error;
      speakText(newCompletedStatus ? 'Reminder marked as completed' : 'Reminder marked as active');
    } catch {
      await addToQueue({ type: 'complete', reminderId: id, isCompleted: newCompletedStatus });
      setPendingCount(prev => prev + 1);
      speakText(newCompletedStatus ? 'Marked complete — will sync when online' : 'Marked active — will sync when online');
    }
  };

  const showEditModal = (id: string) => {
    const reminder = reminders.find(r => r.id === id);
    if (!reminder) return;

    setEditingReminderId(id);
    setTitle(reminder.title);
    setDescription(reminder.description || '');
    setDate(reminder.datetime);
    setCategory(reminder.category || 'personal');
    setPriority(reminder.priority || 'medium');
    setRecurrence(reminder.recurrence || 'once');
    setModalVisible(true);
  }

  const removeReminder = (id: string) => {
    Alert.alert('Delete Reminder', 'Are you sure you want to delete this reminder?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          // Cancel scheduled notification before removing
          await cancelForReminder(id);

          // Remove from local state immediately
          animateLayout();
          setReminders(prev => prev.filter(r => r.id !== id));
          speakText('Reminder deleted');

          // Sync to Supabase in background — queue if offline
          (async () => {
            try {
              const { error } = await supabase
                .from('reminders')
                .delete()
                .eq('id', id);
              if (error) throw error;
            } catch {
              await addToQueue({ type: 'delete', reminderId: id });
              setPendingCount(prev => prev + 1);
            }
          })();
        }
      },
    ]);
  };
  const getCategoryIcon = (cat?: ReminderCategory) => {
    switch (cat) {
            case 'medication': return '💊';
            case 'doctor':     return '🏥';
            case 'therapy':    return '🧠';
            case 'exercise':   return '💪';
            case 'personal':   return '👤';
            case 'emergency':  return '🚨';
            default:           return '📌';
      
        
    }
  };

  const getPriorityColor = (pri?: ReminderPriority) => {
    switch (pri) {
      case 'high': return '#FF3B30';
      case 'medium': return '#FF9500';
      case 'low': return '#34C759';
      default: return '#8E8E93';
    }
  };

  const getPriorityLabel = (pri?: ReminderPriority) => {
    switch (pri) {
      case 'high': return '▲ High';
      case 'medium': return '● Medium';
      case 'low': return '▼ Low';
      default: return '';
    }
  };

  const getRecurrenceText = (rec?: ReminderRecurrence) => {
    switch (rec) {
      case 'daily': return '🔁 Daily';
      case 'weekly': return '🔁 Weekly';
      case 'monthly': return '🔁 Monthly';
      default: return '🔔 Once';
    }
  };

  // Filter reminders
  const filteredReminders = useMemo(() => {
    let filtered = reminders;

    // Search filter
    if (searchQuery.trim()) {
      filtered = filtered.filter(r =>
        r.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (r.description && r.description.toLowerCase().includes(searchQuery.toLowerCase()))
      );
    }

    // Category filter
    if (filterCategory !== 'all') {
      filtered = filtered.filter(r => r.category === filterCategory);
    }

    // Status filter
    if (filterStatus === 'active') {
      filtered = filtered.filter(r => !r.isCompleted);
    } else if (filterStatus === 'completed') {
      filtered = filtered.filter(r => r.isCompleted);
    }

    return filtered.sort((a, b) => a.datetime.getTime() - b.datetime.getTime());
  }, [reminders, searchQuery, filterCategory, filterStatus]);

  type ListItem =
    | { type: 'sectionHeader'; label: string; groupKey: string }
    | { type: 'reminder'; reminder: Reminder };

  const groupedData = useMemo((): ListItem[] => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart); tomorrowStart.setDate(todayStart.getDate() + 1);
    const weekEnd = new Date(todayStart); weekEnd.setDate(todayStart.getDate() + 7);

    const getGroup = (d: Date): string => {
      const ds = new Date(d); ds.setHours(0, 0, 0, 0);
      const t = ds.getTime();
      if (t < todayStart.getTime()) return 'overdue';
      if (t === todayStart.getTime()) return 'today';
      if (t === tomorrowStart.getTime()) return 'tomorrow';
      if (t < weekEnd.getTime()) return 'thisWeek';
      return 'later';
    };

    const labels: Record<string, string> = {
      overdue: '⚠️ Overdue', today: '📅 Today', tomorrow: '🌅 Tomorrow',
      thisWeek: '📆 This Week', later: '🗓️ Later',
    };

    const sections: Record<string, Reminder[]> = { overdue: [], today: [], tomorrow: [], thisWeek: [], later: [] };
    filteredReminders.forEach(r => { sections[getGroup(r.datetime)].push(r); });

    const result: ListItem[] = [];
    (['overdue', 'today', 'tomorrow', 'thisWeek', 'later'] as const).forEach(key => {
      if (sections[key].length > 0) {
        result.push({ type: 'sectionHeader', label: labels[key], groupKey: key });
        sections[key].forEach(r => result.push({ type: 'reminder', reminder: r }));
      }
    });
    return result;
  }, [filteredReminders]);

  const renderItem = ({ item }: { item: Reminder }) => {
    const isOverdue = !item.isCompleted && item.datetime < new Date();
    const dateStr = item.datetime.toLocaleDateString([], { month: 'short', day: 'numeric', weekday: 'short' });
    const timeStr = item.datetime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    return (
      <TouchableOpacity
        style={[
          styles.card,
          item.isCompleted && styles.cardCompleted,
          isOverdue && styles.cardOverdue,
        ]}
        activeOpacity={0.7}
        onPress={() => showEditModal(item.id)}
        onLongPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          const overdueNote = isOverdue ? ' This reminder is overdue.' : '';
          const msg = `${item.title}. Scheduled for ${dateStr} at ${timeStr}.${overdueNote}`;
          speakText(msg);
        }}
        delayLongPress={400}
      >
        <View style={{ flex: 1 }}>
          {/* Title and Status Row */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text style={[styles.cardTitle, item.isCompleted && styles.cardTitleCompleted, { flex: 1, marginRight: 8 }]} numberOfLines={2}>
              {item.title}
            </Text>
            <View style={{
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: 6,
              borderWidth: 1,
              backgroundColor: item.isCompleted
                ? 'rgba(52, 211, 153, 0.12)'
                : isOverdue
                  ? 'rgba(224, 106, 106, 0.14)'
                  : 'rgba(214, 179, 106, 0.14)',
              borderColor: item.isCompleted
                ? 'rgba(52, 211, 153, 0.35)'
                : isOverdue
                  ? 'rgba(224, 106, 106, 0.35)'
                  : 'rgba(214, 179, 106, 0.35)',
            }}>
              <Text style={{
                fontSize: 11,
                fontWeight: '700',
                letterSpacing: 0.3,
                color: item.isCompleted ? theme.success : isOverdue ? theme.danger : theme.accent,
              }}>
                {item.isCompleted ? 'Done' : isOverdue ? 'Overdue' : 'Active'}
              </Text>
            </View>
          </View>

          {item.description ? (
            <Text style={styles.cardDescription} numberOfLines={2} ellipsizeMode="tail">{item.description}</Text>
          ) : null}

          {/* Date & Time Row */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name="calendar-outline" size={14} color={isOverdue ? theme.danger : theme.accent} />
              <Text style={[styles.cardSubtitle, isOverdue && { color: theme.danger, fontWeight: '600' }]}>
                {dateStr}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name="time-outline" size={14} color={isOverdue ? theme.danger : theme.textSecondary} />
              <Text style={[styles.cardSubtitle, isOverdue && { color: theme.danger, fontWeight: '600' }]}>
                {timeStr}
              </Text>
            </View>
            {item.recurrence && item.recurrence !== 'once' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Ionicons name="repeat-outline" size={13} color={theme.textMuted} />
                <Text style={{ fontSize: 12, color: theme.textMuted }}>{item.recurrence}</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.cardActions}>
          <TouchableOpacity
            onPress={() => toggleComplete(item.id)}
            style={styles.actionBtn}
            accessibilityLabel={item.isCompleted ? 'Mark as active' : 'Mark as completed'}
          >
            <Ionicons
              name={item.isCompleted ? 'checkmark-circle' : 'ellipse-outline'}
              size={24}
              color={item.isCompleted ? theme.success : theme.textMuted}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => showEditModal(item.id)}
            style={styles.actionBtn}
            accessibilityLabel="Edit reminder"
          >
            <Ionicons name="create-outline" size={22} color={theme.accent} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => removeReminder(item.id)}
            style={styles.actionBtn}
            accessibilityLabel="Delete reminder"
          >
            <Ionicons name="trash-outline" size={22} color={theme.danger} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  const renderListItem = ({ item }: { item: ListItem }) => {
    if (item.type === 'sectionHeader') {
      return (
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionHeaderLabel}>{item.label}</Text>
        </View>
      );
    }
    return renderItem({ item: item.reminder });
  };

  return (
    <View style={styles.container}>
      <BackgroundLogo />
      <Animated.View style={[styles.header, { opacity: fadeIn, transform: [{ translateY: slideUp }] }]}>
        {/* Title row with Briefing button */}
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.headerTitle}>Reminders</Text>
            <Text style={styles.headerSubtitle}>
              {filteredReminders.filter(r => !r.isCompleted).length} Active • {reminders.length} Total
              {pendingCount > 0 ? `  •  ${pendingCount} pending sync` : ''}
            </Text>
          </View>
          <TouchableOpacity
            style={[
              styles.briefingBtn,
              briefingLoading && styles.briefingBtnLoading,
              briefingPlaying && styles.briefingBtnPlaying,
              briefingMuted   && styles.briefingBtnMuted,
            ]}
            onPress={handleBriefing}
            activeOpacity={0.8}
            accessibilityLabel={
              briefingPlaying ? 'Mute briefing' :
              briefingMuted   ? 'Unmute briefing' :
              'Play briefing'
            }
          >
            <Ionicons
              name={
                briefingMuted   ? 'volume-mute'     :
                briefingPlaying ? 'volume-high'      :
                briefingLoading ? 'hourglass-outline':
                'volume-medium'
              }
              size={16}
              color="#0B1020"
            />
            <Text style={[styles.briefingBtnText, { color: '#0B1020' }]}>
              {briefingMuted   ? 'Unmute'    :
               briefingPlaying ? 'Mute'      :
               briefingLoading ? 'One moment…' :
               'Daily Briefing'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={20} color={theme.textMuted} style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search reminders..."
            placeholderTextColor={theme.placeholder}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={20} color={theme.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {/* Filter Button */}
        <TouchableOpacity
          style={styles.filterButton}
          onPress={() => setShowFilters(!showFilters)}
          accessibilityLabel={showFilters ? 'Hide filters' : 'Show filters'}
          accessibilityRole="button"
        >
          <Ionicons name="filter" size={18} color={theme.textInverted} />
          <Text style={styles.filterButtonText}>Filters</Text>
        </TouchableOpacity>

        {/* Filters Panel */}
        {showFilters && (
          <View style={styles.filtersPanel}>
            <Text style={styles.filterLabel}>Category:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              {(['all', 'personal', 'work', 'health', 'finance', 'shopping', 'other'] as const).map(cat => (
                <TouchableOpacity
                  key={cat}
                  style={[
                    styles.filterChip,
                    filterCategory === cat && styles.filterChipActive
                  ]}
                  onPress={() => setFilterCategory(cat as any)}
                  accessibilityLabel={`Filter by ${cat === 'all' ? 'all categories' : cat}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: filterCategory === cat }}
                >
                  <Text style={[
                    styles.filterChipText,
                    filterCategory === cat && styles.filterChipTextActive
                  ]}>
                    {cat === 'all' ? '🌟 All' : `${getCategoryIcon(cat as ReminderCategory)} ${cat.charAt(0).toUpperCase() + cat.slice(1)}`}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.filterLabel}>Status:</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
              {(['all', 'active', 'completed'] as const).map(status => (
                <TouchableOpacity
                  key={status}
                  style={[
                    styles.filterChip,
                    filterStatus === status && styles.filterChipActive
                  ]}
                  onPress={() => setFilterStatus(status)}
                  accessibilityLabel={`Filter by ${status === 'all' ? 'all statuses' : status} reminders`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: filterStatus === status }}
                >
                  <Text style={[
                    styles.filterChipText,
                    filterStatus === status && styles.filterChipTextActive
                  ]}>
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}

            </View>
          </View>

        )}
      </Animated.View>

      <FlatList
        data={groupedData}
        keyExtractor={(item) => item.type === 'sectionHeader' ? `hdr-${item.groupKey}` : item.reminder.id}
        contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
        renderItem={renderListItem}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        ListEmptyComponent={
          (() => {
            const isFiltered = searchQuery || filterCategory !== 'all' || filterStatus !== 'all';
            return (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyIcon}>{isFiltered ? '🔍' : '🔔'}</Text>
                <Text style={styles.emptyTitle}>
                  {isFiltered ? 'No matches found' : 'No reminders yet'}
                </Text>
                <Text style={styles.emptyText}>
                  {isFiltered
                    ? 'Try adjusting your search or filters to find what you\'re looking for.'
                    : 'Stay on top of your day! Add your first reminder by tapping + or by saying "Set reminder for [task] at [time]".'}
                </Text>
                {!isFiltered && (
                  <TouchableOpacity
                    style={styles.emptyBtn}
                    onPress={openModal}
                    accessibilityLabel="Add your first reminder"
                    accessibilityRole="button"
                  >
                    <Ionicons name="add-circle-outline" size={18} color={theme.accent} style={{ marginRight: 6 }} />
                    <Text style={styles.emptyBtnText}>Add a Reminder</Text>
                  </TouchableOpacity>
                )}
                {isFiltered && (
                  <TouchableOpacity
                    style={styles.emptyBtn}
                    onPress={() => { setSearchQuery(''); setFilterCategory('all'); setFilterStatus('all'); }}
                    accessibilityLabel="Clear all filters"
                    accessibilityRole="button"
                  >
                    <Ionicons name="close-circle-outline" size={18} color={theme.accent} style={{ marginRight: 6 }} />
                    <Text style={styles.emptyBtnText}>Clear Filters</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })()
        }
      />

      <TouchableOpacity style={styles.fab} activeOpacity={0.8} onPress={openModal} accessibilityLabel="Add Reminder">
        <Ionicons name="add" size={48} color={theme.textInverted} />
      </TouchableOpacity>

      <Toast
        visible={toastVisible}
        message={toastMessage}
        type={toastType}
        onHide={() => setToastVisible(false)}
      />

      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <BlurViewComponent intensity={40} tint={Platform.OS === 'ios' ? 'systemThinMaterial' : 'light'} style={styles.blurFill} />
          <View style={{ flex: 1, justifyContent: 'flex-end' }}>
            <Animated.View style={[styles.bottomSheet, { opacity: fadeIn }]}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>{editingReminderId ? '✏️ Edit Reminder' : '⏰ Create Reminder'}</Text>

              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: '80%' }}>
                {/* ADDED: Title with Voice Input */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    placeholder="Reminder Title *"
                    placeholderTextColor={theme.placeholder}
                    value={title}
                    onChangeText={setTitle}
                    returnKeyType="done"
                  />
                  <TouchableOpacity
                    style={styles.voiceButton}
                    onPress={() => handleVoiceInput('title')}
                    disabled={isVoiceInputMode}
                    accessibilityLabel={isVoiceInputMode && voiceField === 'title' ? 'Stop voice input for title' : 'Use voice input for title'}
                    accessibilityRole="button"
                  >
                    <Ionicons
                      name={isVoiceInputMode && voiceField === 'title' ? 'mic' : 'mic-outline'}
                      size={24}
                      color={isVoiceInputMode && voiceField === 'title' ? theme.accent : theme.textMuted}
                    />
                  </TouchableOpacity>
                </View>

                {/* ADDED: Description with Voice Input */}
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 8 }}>
                  <TextInput
                    style={[styles.input, { flex: 1, minHeight: 60 }]}
                    placeholder="Description (optional)"
                    placeholderTextColor={theme.placeholder}
                    value={description}
                    onChangeText={setDescription}
                    multiline
                    numberOfLines={3}
                  />
                  <TouchableOpacity
                    style={styles.voiceButton}
                    onPress={() => handleVoiceInput('description')}
                    disabled={isVoiceInputMode}
                    accessibilityLabel={isVoiceInputMode && voiceField === 'description' ? 'Stop voice input for description' : 'Use voice input for description'}
                    accessibilityRole="button"
                  >
                    <Ionicons
                      name={isVoiceInputMode && voiceField === 'description' ? 'mic' : 'mic-outline'}
                      size={24}
                      color={isVoiceInputMode && voiceField === 'description' ? theme.accent : theme.textMuted}
                    />
                  </TouchableOpacity>
                </View>

                {/* Category Selector */}
                <Text style={styles.sectionLabel}>Category</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                  {(['medication', 'doctor', 'therapy', 'exercise', 'personal', 'emergency'] as ReminderCategory[]).map(cat => (
                    <TouchableOpacity
                      key={cat}
                      style={[
                        styles.categoryChip,
                        category === cat && styles.categoryChipActive
                      ]}
                      onPress={() => setCategory(cat)}
                      accessibilityLabel={`Category: ${cat}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: category === cat }}
                    >
                      <Text style={{ fontSize: 18 }}>{getCategoryIcon(cat)}</Text>
                      <Text style={[
                        styles.categoryChipText,
                        category === cat && styles.categoryChipTextActive
                      ]}>
                        {cat.charAt(0).toUpperCase() + cat.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Priority Selector */}
                <Text style={styles.sectionLabel}>Priority</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                  {(['low', 'medium', 'high'] as ReminderPriority[]).map(pri => (
                    <TouchableOpacity
                      key={pri}
                      style={[
                        styles.priorityChip,
                        { borderColor: getPriorityColor(pri) },
                        priority === pri && { backgroundColor: getPriorityColor(pri) }
                      ]}
                      onPress={() => setPriority(pri)}
                      accessibilityLabel={`Priority: ${pri}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: priority === pri }}
                    >
                      <Text style={[
                        styles.priorityChipText,
                        { color: priority === pri ? '#FFF' : getPriorityColor(pri) }
                      ]}>
                        {pri.charAt(0).toUpperCase() + pri.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Recurrence Selector */}
                <Text style={styles.sectionLabel}>Repeat</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                  {(['once', 'daily', 'weekly', 'monthly'] as ReminderRecurrence[]).map(rec => (
                    <TouchableOpacity
                      key={rec}
                      style={[
                        styles.recurrenceChip,
                        recurrence === rec && styles.recurrenceChipActive
                      ]}
                      onPress={() => setRecurrence(rec)}
                      accessibilityLabel={`Repeat: ${rec === 'once' ? 'once only' : rec}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: recurrence === rec }}
                    >
                      <Text style={[
                        styles.recurrenceChipText,
                        recurrence === rec && styles.recurrenceChipTextActive
                      ]}>
                        {rec === 'once' ? 'Once' : rec.charAt(0).toUpperCase() + rec.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Date Time Picker */}
                <Text style={styles.sectionLabel}>Date & Time</Text>
                {DateTimePicker ? (
                  <View style={styles.datePickerContainer}>
                    {Platform.OS === 'ios' ? (
                      <DateTimePicker
                        value={date}
                        mode="datetime"
                        display="spinner"
                        onChange={(event: any, selectedDate?: Date) => {
                          try {
                            if (selectedDate && selectedDate instanceof Date && !isNaN(selectedDate.getTime())) {
                              setDate(selectedDate);
                            }
                          } catch (error) {
                            console.error('DatePicker error:', error);
                          }
                        }}
                        minimumDate={new Date()}
                        textColor={theme.textPrimary}
                        style={styles.datePicker}
                      />
                    ) : (
                      <View style={{ gap: 10 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, backgroundColor: theme.inputBackground, borderRadius: 12, borderWidth: 1, borderColor: theme.inputBorder }}>
                          <View>
                            <Text style={{ fontSize: 12, color: theme.textMuted, fontWeight: '600' }}>Scheduled For</Text>
                            <Text style={{ fontSize: 14, color: theme.textPrimary, fontWeight: '700', marginTop: 2 }}>
                              {date instanceof Date && !isNaN(date.getTime()) ? date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Set Date & Time'}
                            </Text>
                          </View>
                        </View>
                        <View style={{ flexDirection: 'row', gap: 10 }}>
                          <TouchableOpacity
                            style={[styles.actionButton, { flex: 1, paddingVertical: 10 }]}
                            onPress={() => setAndroidPickerMode('date')}
                            accessibilityLabel="Change reminder date"
                            accessibilityRole="button"
                          >
                            <Text style={styles.actionButtonText}>📅 Change Date</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.actionButton, { flex: 1, paddingVertical: 10 }]}
                            onPress={() => setAndroidPickerMode('time')}
                            accessibilityLabel="Change reminder time"
                            accessibilityRole="button"
                          >
                            <Text style={styles.actionButtonText}>⏰ Change Time</Text>
                          </TouchableOpacity>
                        </View>
                        {androidPickerMode === 'date' && (
                          <DateTimePicker
                            value={date instanceof Date && !isNaN(date.getTime()) ? date : new Date()}
                            mode="date"
                            display="default"
                            onChange={(event: any, selectedDate?: Date) => {
                              setAndroidPickerMode(null);
                              try {
                                if (event?.type !== 'dismissed' && selectedDate && selectedDate instanceof Date && !isNaN(selectedDate.getTime())) {
                                  const base = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
                                  const updated = new Date(base);
                                  updated.setFullYear(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
                                  if (!isNaN(updated.getTime())) setDate(updated);
                                }
                              } catch (error) {
                                console.error('DatePicker date error:', error);
                              }
                            }}
                          />
                        )}
                        {androidPickerMode === 'time' && (
                          <DateTimePicker
                            value={date instanceof Date && !isNaN(date.getTime()) ? date : new Date()}
                            mode="time"
                            display="default"
                            onChange={(event: any, selectedDate?: Date) => {
                              setAndroidPickerMode(null);
                              try {
                                if (event?.type !== 'dismissed' && selectedDate && selectedDate instanceof Date && !isNaN(selectedDate.getTime())) {
                                  const base = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
                                  const updated = new Date(base);
                                  updated.setHours(selectedDate.getHours(), selectedDate.getMinutes());
                                  if (!isNaN(updated.getTime())) setDate(updated);
                                }
                              } catch (error) {
                                console.error('DatePicker time error:', error);
                              }
                            }}
                          />
                        )}
                      </View>
                    )}
                  </View>
                ) : (
                  <View style={{ marginTop: 8 }}>
                    <Text style={styles.preview}>Pickers not supported on web. Enter ISO date-time:</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="YYYY-MM-DD HH:MM"
                      placeholderTextColor={theme.placeholder}
                      value={formatISOInput(date)}
                      onChangeText={(t) => {
                        const parsed = parseISOInput(t);
                        if (parsed) setDate(parsed);
                      }}
                    />
                  </View>
                )}

                <View style={styles.previewBox}>
                  <Text style={styles.preview}>🔔 {formatPreview(date)}</Text>
                  {!!description && (
                    <Text style={[styles.preview, { marginTop: 4 }]} numberOfLines={2}>📝 {description}</Text>
                  )}
                </View>
              </ScrollView>

              <View style={styles.actionsRow}>
                <TouchableOpacity style={[styles.btn, styles.btnCancel]} onPress={() => setModalVisible(false)} accessibilityLabel="Cancel" accessibilityRole="button">
                  <Text style={[styles.btnText, { color: theme.textSecondary }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, styles.btnPrimary, !title.trim() && styles.btnDisabled, { opacity: title.trim() ? 1 : 0.6 }]}
                  onPress={saveReminder}
                  disabled={!title.trim()}
                  accessibilityLabel={editingReminderId ? 'Update reminder' : 'Create reminder'}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !title.trim() }}
                >
                  <Text style={[styles.btnText, { color: theme.textInverted }]}>{editingReminderId ? 'Update Reminder' : 'Create Reminder'}</Text>
                </TouchableOpacity>
              </View>
            </Animated.View>
          </View>
        </View>
      </Modal>

      {/* Real-time Alert Modal */}
      <Modal visible={!!alertReminder} transparent animationType="fade" onRequestClose={handleAlertYes}>
        <View style={styles.modalBackdrop}>
          <BlurViewComponent intensity={50} tint={Platform.OS === 'ios' ? 'systemChromeMaterial' : 'light'} style={styles.blurFill} />
          <Animated.View style={[styles.sheet, { opacity: fadeIn }]}>
            <Text style={styles.sheetTitle}>🔔 Reminder</Text>
            <Text style={[styles.preview, { marginTop: 8 }]}>{alertReminder?.title}</Text>
            {!!alertReminder?.description && (
              <Text style={[styles.preview, { marginTop: 6 }]} numberOfLines={3}>{alertReminder?.description}</Text>
            )}
            <Text style={[styles.preview, { marginTop: 6 }]}>{formatPreview(alertReminder?.datetime || new Date())}</Text>
            <Text style={[styles.preview, { marginTop: 16, marginBottom: 8, fontWeight: '600' }]}>Snooze for:</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {([5, 10, 30] as const).map(min => (
                <TouchableOpacity
                  key={min}
                  style={[styles.btn, styles.btnCancel]}
                  onPress={() => handleSnooze(min)}
                  accessibilityLabel={`Snooze reminder for ${min} minutes`}
                  accessibilityRole="button"
                >
                  <Text style={[styles.btnText, { color: theme.textSecondary }]}>{min} min</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={[styles.btn, styles.btnPrimary, { marginTop: 12 }]} onPress={handleAlertYes} accessibilityLabel="Mark reminder as done" accessibilityRole="button">
              <Text style={[styles.btnText, { color: theme.textInverted }]}>✅ Mark Done</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Modal>
          {/*  Voice Action Confirmation Modal */}
      <Modal visible={voiceConfirmVisible} transparent animationType="fade" onRequestClose={cancelVoiceAction}>
        <View style={styles.modalBackdrop}>
          <BlurViewComponent intensity={50} tint={Platform.OS === 'ios' ? 'systemChromeMaterial' : 'light'} style={styles.blurFill} />
          <View style={{ flexGrow: 1, justifyContent: 'center', padding: 20 }}>
            <View style={styles.sheet}>
              <Text style={styles.sheetTitle}>
                {voiceConfirmAction === 'complete' ? '✅ Complete Reminder?' :
                 voiceConfirmAction === 'delete'   ? '🗑️ Delete Reminder?' :
                 voiceConfirmAction === 'snooze'   ? '⏰ Snooze Reminder?' :
                                                     '✏️ Edit Reminder?'}
              </Text>
              <Text style={[styles.preview, { fontSize: 17, color: styles.cardTitle.color, marginBottom: 6 }]}>
                {voiceConfirmReminder?.title}
              </Text>
              <Text style={styles.preview}>
                {voiceConfirmAction === 'complete' ? 'Mark this reminder as done?' :
                 voiceConfirmAction === 'delete'   ? 'Permanently delete this reminder?' :
                 voiceConfirmAction === 'snooze'   ? 'Snooze this reminder for 30 minutes?' :
                                                     'Confirm this change?'}
              </Text>
              <View style={styles.actionsRow}>
                <TouchableOpacity style={[styles.btn, styles.btnCancel]} onPress={cancelVoiceAction}>
                  <Text style={[styles.btnText, { color: styles.preview.color }]}>No, Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, styles.btnPrimary,
                    voiceConfirmAction === 'delete' && { backgroundColor: '#FF3B30' }]}
                  onPress={executeVoiceAction}
                >
                  <Text style={[styles.btnText, { color: '#FFF' }]}>Yes, Confirm</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Voice Edit Flow Modal */}
      <Modal visible={voiceEditFlowVisible && voiceEditActive} transparent animationType="fade" onRequestClose={() => {
        setVoiceEditActive(false);
        setVoiceEditFlowVisible(false);
      }}>
        <View style={styles.modalBackdrop}>
          <BlurViewComponent intensity={50} tint={Platform.OS === 'ios' ? 'systemChromeMaterial' : 'light'} style={styles.blurFill} />
          <View style={{ flexGrow: 1, justifyContent: 'center', padding: 20 }}>
            <View style={styles.sheet}>
              <Text style={styles.sheetTitle}>✏️ Edit Reminder</Text>
              <Text style={styles.preview}>
                {voiceEditStep === 'select_reminder' ? '🎤 Say reminder name or number' :
                 voiceEditStep === 'select_field' ? `🎤 What field to edit? (title, time, category...)` :
                 voiceEditStep === 'capture_input' ? `🎤 Say new ${voiceEditField} value` :
                 voiceEditStep === 'confirm_change' ? '✓ Confirm change?' :
                 '🎤 Edit another field?'}
              </Text>
              {voiceEditReminder && (
                <Text style={[styles.preview, { marginTop: 10, fontSize: 12, color: theme.textSecondary }]}>
                  Editing: {voiceEditReminder.title}
                  {voiceEditField && ` • Current field: ${voiceEditField}`}
                </Text>
              )}
              {Object.keys(voiceEditPending).length > 0 && (
                <Text style={[styles.preview, { marginTop: 6, fontSize: 11, color: theme.textSecondary }]}>
                  Changes pending: {Object.keys(voiceEditPending).join(', ')}
                </Text>
              )}
              <TouchableOpacity style={[styles.btn, styles.btnCancel]} onPress={() => {
                setVoiceEditActive(false);
                setVoiceEditFlowVisible(false);
                speakText('Edit cancelled.');
              }}>
                <Text style={[styles.btnText, { color: styles.preview.color }]}>Cancel Edit</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Reminder Selection Modal for Voice Edit */}
      <Modal visible={editReminderModalVisible} transparent animationType="slide" onRequestClose={() => setEditReminderModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <BlurViewComponent intensity={40} tint={Platform.OS === 'ios' ? 'systemThinMaterial' : 'light'} style={styles.blurFill} />
          <View style={{ flex: 1, justifyContent: 'center', padding: 20 }}>
            <View style={[styles.sheet]}>
              <Text style={styles.sheetTitle}>Select Reminder to Edit</Text>
              <Text style={[styles.preview, { marginBottom: 16, fontSize: 14 }]}>
                Tap on the reminder you want to edit
              </Text>

              <View style={{ maxHeight: 400, marginBottom: 12 }}>
                <FlatList
                  data={reminders.filter(r => !r.isCompleted)}
                  keyExtractor={(item) => item.id}
                  scrollEnabled={true}
                  showsVerticalScrollIndicator={true}
                  nestedScrollEnabled={true}
                  renderItem={({ item, index }) => (
                    <TouchableOpacity
                      style={[styles.reminderSelectItem, { paddingVertical: 12, paddingHorizontal: 14, marginVertical: 6 }]}
                      onPress={() => {
                        // Close the selection modal
                        console.log('📝 Selected reminder:', item.title);
                        setEditReminderModalVisible(false);
                        // Open the regular edit modal with this reminder
                        showEditModal(item.id);
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.cardTitle, { marginBottom: 4 }]}>{index + 1}. {item.title}</Text>
                        <Text style={[styles.cardSubtitle, { fontSize: 12 }]}>
                          {formatPreview(item.datetime)} • {item.category || 'personal'}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
                    </TouchableOpacity>
                  )}
                  ListEmptyComponent={
                    <View style={{ padding: 20, alignItems: 'center' }}>
                      <Text style={[styles.preview, { color: theme.textSecondary }]}>
                        No active reminders to edit
                      </Text>
                    </View>
                  }
                />
              </View>

              <TouchableOpacity
                style={[styles.btn, styles.btnCancel]}
                onPress={() => {
                  console.log('❌ Cancelled reminder selection');
                  setEditReminderModalVisible(false);
                  setVoiceEditFlowVisible(false);
                }}
              >
                <Text style={[styles.btnText, { color: styles.preview.color }]}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const formatPreview = (d: Date) => {
  try {
    return d.toLocaleString(undefined, {
      weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  } catch {
    return d.toISOString();
  }
};

const formatISOInput = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const parseISOInput = (t: string) => {
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [_, y, mo, da, h, mi] = m;
  const dt = new Date(Number(y), Number(mo) - 1, Number(da), Number(h), Number(mi), 0, 0);
  return isNaN(dt.getTime()) ? null : dt;
};

const buildSpokenMessage = (title: string, description?: string) => {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const intro = `${greeting}. User, this is your reminder for ${title}.`;
  const desc = description ? ` ${description}.` : '';
  return `${intro}${desc} Please take action now.`;
};

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },
    header: {
      paddingTop: 52,
      paddingHorizontal: 20,
      paddingBottom: 16,
    },
    headerTitle: { fontSize: 32, fontWeight: '700', color: theme.textPrimary },
    headerSubtitle: { marginTop: 4, color: theme.textSecondary, fontSize: 15 },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
    },

    // Briefing button
    briefingBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: theme.accent,
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: 12,
      marginTop: 6,
    },
    briefingBtnLoading: {
      backgroundColor: theme.accent,
      opacity: 0.75,
    },
    briefingBtnPlaying: {
      backgroundColor: '#34D399',
    },
    briefingBtnMuted: {
      backgroundColor: theme.surfaceSecondary,
      borderWidth: 1,
      borderColor: theme.cardBorder,
    },
    briefingBtnText: {
      color: '#fff',
      fontSize: 13,
      fontWeight: '700',
    },

    // Search & Filters
    searchContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.inputBackground,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      marginTop: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.inputBorder,
    },
    searchInput: {
      flex: 1,
      color: theme.textPrimary,
      fontSize: 16,
    },
    filterButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.accent,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 16,
      marginTop: 12,
      gap: 6,
    },
    filterButtonText: {
      color: theme.textInverted,
      fontWeight: '600',
      fontSize: 15,
    },
    filtersPanel: {
      backgroundColor: theme.cardBackground,
      borderRadius: 12,
      padding: 14,
      marginTop: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.cardBorder,
    },
    filterLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.textSecondary,
      marginBottom: 8,
    },
    filterChip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 20,
      backgroundColor: theme.tagBackground,
      marginRight: 8,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    filterChipActive: {
      backgroundColor: theme.accent,
      borderColor: theme.accent,
    },
    filterChipText: {
      color: theme.textSecondary,
      fontSize: 14,
      fontWeight: '500',
    },
    filterChipTextActive: {
      color: theme.textInverted,
      fontWeight: '600',
    },

    // Empty State
    emptyContainer: {
      alignItems: 'center',
      marginTop: 72,
      paddingHorizontal: 36,
    },
    emptyIcon: {
      fontSize: 72,
      marginBottom: 16,
    },
    emptyTitle: {
      fontSize: 20,
      fontWeight: '700',
      color: theme.textPrimary,
      marginBottom: 10,
      textAlign: 'center',
    },
    emptyText: {
      textAlign: 'center',
      color: theme.textMuted,
      fontSize: 15,
      lineHeight: 22,
      marginBottom: 24,
    },
    emptyBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1.5,
      borderColor: theme.accent,
      borderRadius: 12,
      paddingVertical: 10,
      paddingHorizontal: 20,
    },
    emptyBtnText: {
      color: theme.accent,
      fontSize: 15,
      fontWeight: '600',
    },
    //Cards
    card: {
      backgroundColor: theme.cardBackground,
      borderRadius: 16,
      padding: 16,
      marginBottom: 14,
      shadowColor: theme.cardShadow,
      shadowOffset: { width: 0, height: theme.isDark ? 6 : 4 },
      shadowOpacity: theme.isDark ? 0.25 : 0.08,
      shadowRadius: theme.isDark ? 14 : 10,
      elevation: theme.isDark ? 6 : 2,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      borderWidth: theme.isDark ? 1 : StyleSheet.hairlineWidth,
      borderColor: theme.cardBorder,
      overflow: 'hidden',
    },
    cardCompleted: {
      opacity: 0.6,
    },
    cardOverdue: {
      borderColor: theme.danger,
      borderWidth: 1.5,
    },
    overdueLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: theme.danger,
    },
    priorityIndicator: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: 5,
    },
    cardTitle: {
      fontSize: 17,
      fontWeight: '600',
      color: theme.textPrimary,
      lineHeight: 22,
    },
    cardTitleCompleted: {
      textDecorationLine: 'line-through',
      color: theme.textMuted,
    },
    cardDescription: {
      fontSize: 14,
      color: theme.textSecondary,
      marginTop: 4,
      lineHeight: 20,
    },
    cardSubtitle: {
      fontSize: 14,
      color: theme.textSecondary
    },
    recurrenceBadge: {
      fontSize: 14,
      fontWeight: '600',
    },
    priorityLabel: {
      fontSize: 14,
      fontWeight: '700',
    },
    cardActions: { flexDirection: 'row', alignItems: 'center' },
    actionBtn: { paddingHorizontal: 8, paddingVertical: 10 },

    fab: {
      position: 'absolute',
      right: 20,
      bottom: 30,
      width: 96,
      height: 96,
      borderRadius: 48,
      backgroundColor: theme.fabBackground,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: theme.fabShadow,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: theme.isDark ? 0.35 : 0.2,
      shadowRadius: 12,
      elevation: 6,
    },

    // Section headers for date grouping
    sectionHeaderRow: {
      marginTop: 16,
      marginBottom: 6,
    },
    sectionHeaderLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: theme.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.9,
    },

    // Meta chips (recurrence + priority) on cards
    metaChip: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 8,
      backgroundColor: theme.tagBackground,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    metaChipText: {
      fontSize: 12,
      fontWeight: '600',
    },

    //Modal
    modalBackdrop: {
      flex: 1,
      backgroundColor: theme.overlay,
    },
    blurFill: { ...StyleSheet.absoluteFill, borderRadius: 24 },
    // Used by alert/voice modals (centred card)
    sheet: {
      backgroundColor: theme.modalBackground,
      borderRadius: 20,
      padding: 20,
      marginHorizontal: 20,
      shadowColor: theme.cardShadow,
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: theme.isDark ? 0.35 : 0.15,
      shadowRadius: theme.isDark ? 24 : 18,
      elevation: 8,
      borderWidth: theme.isDark ? 1 : StyleSheet.hairlineWidth,
      borderColor: theme.cardBorder,
      maxHeight: '90%',
    },
    // Used by create/edit modal (slides up from bottom)
    bottomSheet: {
      backgroundColor: theme.modalBackground,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      padding: 20,
      paddingBottom: Platform.OS === 'ios' ? 40 : 28,
      shadowColor: theme.cardShadow,
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: theme.isDark ? 0.35 : 0.15,
      shadowRadius: 16,
      elevation: 8,
      borderWidth: theme.isDark ? 1 : 0,
      borderColor: theme.cardBorder,
      maxHeight: '92%',
    },
    sheetHandle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.textMuted,
      alignSelf: 'center',
      marginBottom: 14,
      opacity: 0.4,
    },
    sheetTitle: {
      fontSize: 24,
      fontWeight: '700',
      color: theme.textPrimary,
      marginBottom: 16,
    },
    sectionLabel: {
      fontSize: 15,
      fontWeight: '600',
      color: theme.textPrimary,
      marginTop: 12,
      marginBottom: 8,
    },
    input: {
      marginTop: 12,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.inputBorder,
      paddingHorizontal: 14,
      paddingVertical: 12,
      color: theme.textPrimary,
      backgroundColor: theme.inputBackground,
      fontSize: 16,
    },
    // Date Picker Styles
    datePickerContainer: {
      backgroundColor: theme.inputBackground,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.inputBorder,
      marginTop: 8,
      padding: 8,
      alignItems: 'center',
      overflow: 'hidden',
    },
    datePicker: {
      width: '100%',
      height: 200,
    },

    // Category Chips
    categoryChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 20,
      backgroundColor: theme.tagBackground,
      marginRight: 10,
      borderWidth: 2,
      borderColor: 'transparent',
    },
    categoryChipActive: {
      backgroundColor: theme.accent,
      borderColor: theme.accent,
    },
    categoryChipText: {
      color: theme.textSecondary,
      fontSize: 14,
      fontWeight: '500',
    },
    categoryChipTextActive: {
      color: theme.textInverted,
      fontWeight: '600',
    },

    // Priority Chips
    priorityChip: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 10,
      alignItems: 'center',
      borderWidth: 2,
    },
    priorityChipText: {
      fontSize: 14,
      fontWeight: '600',
    },

    // Recurrence Chips
    recurrenceChip: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 10,
      alignItems: 'center',
      backgroundColor: theme.tagBackground,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    recurrenceChipActive: {
      backgroundColor: theme.accent,
      borderColor: theme.accent,
    },
    recurrenceChipText: {
      fontSize: 14,
      fontWeight: '500',
      color: theme.textSecondary,
    },
    recurrenceChipTextActive: {
      color: theme.textInverted,
      fontWeight: '600',
    },

    // ADDED: Voice button style
    voiceButton: {
      padding: 12,
      backgroundColor: theme.inputBackground,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.inputBorder,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 12,
    },

    // Reminder selection item
    reminderSelectItem: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.cardBackground,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.cardBorder,
    },

    actionButton: {
      backgroundColor: theme.accent,
      paddingVertical: 12,
      borderRadius: 10,
      alignItems: 'center',
    },
    actionButtonText: {
      color: theme.textInverted,
      fontWeight: '600',
      fontSize: 15,
    },

    previewBox: {
      backgroundColor: theme.tagBackground,
      borderRadius: 12,
      padding: 12,
      marginTop: 12,
    },
    preview: {
      color: theme.textSecondary,
      fontSize: 14,
      lineHeight: 20,
    },
    actionsRow: { flexDirection: 'row', marginTop: 20, gap: 12 },

    btn: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: 'center',
    },
    btnCancel: {
      backgroundColor: theme.tagBackground,
    },
    btnPrimary: {
      backgroundColor: theme.accent,
      shadowColor: theme.accent,
      shadowOpacity: 0.25,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 3 },
    },
    btnDisabled: {
      backgroundColor: theme.accentSoft,
      shadowOpacity: 0,
    },
    btnText: { fontWeight: '600', fontSize: 16 },
  });

export default ReminderScreen;
