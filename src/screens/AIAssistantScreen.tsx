import { SafeAreaView } from 'react-native-safe-area-context';
/**
 * AIAssistantScreen.tsx
 * Modern ChatGPT-style AI assistant powered by Groq.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import * as Speech from 'expo-speech';
import { speakText as ttsSpeakText, stopSpeaking as ttsStopSpeaking } from '../services/ttsService';
import { EverySenseLogo } from '../components/EverySenseLogo';
import { BackgroundLogo } from '../components/BackgroundLogo';

// Conditional import — not available in Expo Go
let ExpoSpeechRecognitionModule: any = null;
try {
  ExpoSpeechRecognitionModule = require('expo-speech-recognition').ExpoSpeechRecognitionModule;
} catch {
  // running in Expo Go — voice input disabled
}
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { getThemeConfig } from '../../constants/theme';
import { useApp } from '../contexts/AppContext';
import { ChatMessage, sendChatMessage, sendImageMessage } from '../services/geminiService';
import { voiceManager } from '../utils/voiceCommandManager';
import { supabase } from '../../lib/supabase';
import { MainTabParamList } from '../types';

// Clipboard — conditional (not available in all environments)
let Clipboard: any = null;
try { Clipboard = require('expo-clipboard'); } catch {
  Clipboard = { setStringAsync: async (_: string) => {} };
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Message = ChatMessage & { imageUri?: string; timestamp?: Date };

// ─── Quick prompts ────────────────────────────────────────────────────────────

const QUICK_PROMPTS = [
  { icon: 'medkit-outline',        text: 'Missed a dose?',        color: '#ef4444' },
  { icon: 'body-outline',          text: 'Managing chronic pain',  color: '#3b82f6' },
  { icon: 'moon-outline',          text: 'Improve my sleep',       color: '#8b5cf6' },
  { icon: 'accessibility-outline', text: 'My disability rights',   color: '#22c55e' },
];

// ─── Animated typing dots ─────────────────────────────────────────────────────

const TypingDots = ({ color }: { color: string }) => {
  const dots = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];

  useEffect(() => {
    const anims = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 150),
          Animated.timing(dot, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 300, useNativeDriver: true }),
          Animated.delay(600 - i * 150),
        ]),
      ),
    );
    anims.forEach(a => a.start());
    return () => anims.forEach(a => a.stop());
  }, []);

  return (
    <View style={dotStyles.wrap}>
      <View style={dotStyles.row}>
        {dots.map((dot, i) => (
          <Animated.View
            key={i}
            style={[dotStyles.dot, { backgroundColor: color, opacity: dot, transform: [{ translateY: dot.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }] }]}
          />
        ))}
      </View>
      <Text style={[dotStyles.label, { color }]}>One moment…</Text>
    </View>
  );
};

const dotStyles = StyleSheet.create({
  wrap:  { paddingVertical: 4 },
  row:   { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4, paddingVertical: 4 },
  dot:   { width: 7, height: 7, borderRadius: 4 },
  label: { fontSize: 11, fontWeight: '500', paddingHorizontal: 4, opacity: 0.7, marginTop: 2 },
});

// ─── Message bubble ───────────────────────────────────────────────────────────

interface BubbleProps {
  message: Message;
  accent: string;
  bg: string;
  textPrimary: string;
  textMuted: string;
  isDark: boolean;
  fontSize: number;
  voiceSpeed: number;
}

const formatTime = (d?: Date) =>
  d ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';

const MessageBubble = React.memo(({ message, accent, bg, textPrimary, textMuted, isDark, fontSize, voiceSpeed }: BubbleProps) => {
  const isUser = message.role === 'user';
  const [playing, setPlaying] = useState(false);

  const handleCopy = () => {
    Clipboard.setStringAsync(message.text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleToggleSpeak = () => {
    if (playing) {
      // ── Mute: stop speech ──
      ttsStopSpeaking();
      setPlaying(false);
    } else {
      // ── Speak: start speech ──
      setPlaying(true);
      ttsSpeakText(message.text, {
        rate: voiceSpeed,
        onDone: () => setPlaying(false),
        onStopped: () => setPlaying(false),
        onError: () => setPlaying(false),
      });
    }
  };

  if (isUser) {
    return (
      <View style={bStyles.userRow}>
        <View style={bStyles.userBubbleWrap}>
          <TouchableOpacity
            activeOpacity={0.85}
            onLongPress={handleCopy}
            delayLongPress={400}
            style={[bStyles.userBubble, { backgroundColor: accent }]}
            accessibilityLabel={`Your message: ${message.text}. Long press to copy.`}
          >
            {message.imageUri && (
              <Image source={{ uri: message.imageUri }} style={bStyles.image} resizeMode="cover" />
            )}
            <Text style={[bStyles.userText, { fontSize, color: '#0B1020' }]}>{message.text}</Text>
          </TouchableOpacity>
          {message.timestamp && (
            <Text style={[bStyles.timestamp, { color: textMuted, textAlign: 'right' }]}>{formatTime(message.timestamp)}</Text>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={bStyles.aiRow}>
      <View style={[bStyles.aiAvatar, { backgroundColor: 'rgba(214, 179, 106, 0.12)', borderColor: 'rgba(214, 179, 106, 0.28)', borderWidth: 1 }]}>
        <Ionicons name="chatbubble-ellipses-outline" size={15} color={accent} />
      </View>
      <View style={{ flex: 1 }}>
        <TouchableOpacity
          activeOpacity={0.85}
          onLongPress={handleCopy}
          delayLongPress={400}
          style={[bStyles.aiBubble, { backgroundColor: isDark ? '#151D32' : 'rgba(255,255,255,0.92)', borderColor: isDark ? 'rgba(214, 179, 106, 0.16)' : 'rgba(0,0,0,0.08)' }]}
          accessibilityLabel={`Assistant response: ${message.text}. Long press to copy.`}
        >
          <Text style={[bStyles.aiText, { color: textPrimary, fontSize }]}>{message.text}</Text>
        </TouchableOpacity>
        <View style={bStyles.aiFooter}>
          {message.timestamp && (
            <Text style={[bStyles.timestamp, { color: textMuted }]}>{formatTime(message.timestamp)}</Text>
          )}
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); handleToggleSpeak(); }}
            style={[
              bStyles.speakBtn,
              playing
                ? { backgroundColor: '#ef4444' + '22', borderColor: '#ef4444' + '55', borderWidth: 1 }
                : { backgroundColor: accent + '18' },
            ]}
            accessibilityLabel={playing ? 'Stop speaking' : 'Read aloud'}
          >
            <Ionicons
              name={playing ? 'volume-mute' : 'volume-high'}
              size={18}
              color={playing ? '#ef4444' : accent}
            />
            <Text style={[bStyles.speakLabel, { color: playing ? '#ef4444' : accent }]}>
              {playing ? 'Stop' : 'Read aloud'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
});

const bStyles = StyleSheet.create({
  userRow:       { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 16, marginVertical: 6 },
  userBubbleWrap:{ maxWidth: '80%' },
  userBubble:    { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 20, borderBottomRightRadius: 4 },
  userText:  { color: '#fff', lineHeight: 22 },

  aiRow:    { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, marginVertical: 6, gap: 10 },
  aiAvatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 2, flexShrink: 0 },
  aiBubble: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 20, borderBottomLeftRadius: 4, borderWidth: 1 },
  aiText:   { lineHeight: 23 },
  aiFooter: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 8, paddingHorizontal: 4 },

  speakBtn:   { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  speakLabel: { fontSize: 13, fontWeight: '600' },
  timestamp:  { fontSize: 11, marginTop: 3, paddingHorizontal: 4 },

  image:    { width: '100%', height: 160, borderRadius: 12, marginBottom: 8 },
});

// ─── Welcome screen ───────────────────────────────────────────────────────────

interface WelcomeProps {
  accent: string;
  textPrimary: string;
  textMuted: string;
  isDark: boolean;
  onPrompt: (text: string) => void;
}

const WelcomeView = ({ accent, textPrimary, textMuted, isDark, onPrompt }: WelcomeProps) => (
  <View style={wStyles.container}>
    <View style={wStyles.logoWrap}>
      <EverySenseLogo size={46} showText={false} />
    </View>
    <Text style={[wStyles.brandKicker, { color: accent }]}>EVERYSENSE</Text>
    <Text style={[wStyles.title, { color: textPrimary }]}>How can I help?</Text>
    <Text style={[wStyles.subtitle, { color: textMuted }]}>
      Ask questions, understand documents, or organize your day.
    </Text>
    <View style={wStyles.grid}>
      {QUICK_PROMPTS.map(p => (
        <TouchableOpacity
          key={p.text}
          style={[wStyles.chip, { backgroundColor: isDark ? '#151D32' : '#FFFFFF', borderColor: isDark ? 'rgba(214, 179, 106, 0.16)' : 'rgba(0,0,0,0.08)' }]}
          onPress={() => { Haptics.selectionAsync(); onPrompt(p.text); }}
          accessibilityRole="button"
          accessibilityLabel={p.text}
        >
          <Ionicons name={p.icon as any} size={18} color={accent} />
          <Text style={[wStyles.chipText, { color: textPrimary }]}>{p.text}</Text>
        </TouchableOpacity>
      ))}
    </View>
  </View>
);

const wStyles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingBottom: 40 },
  logoWrap:  { marginBottom: 14 },
  brandKicker: { fontSize: 13, fontWeight: '800', letterSpacing: 1.5, marginBottom: 4 },
  title:     { fontSize: 24, fontWeight: '700', marginBottom: 8 },
  subtitle:  { fontSize: 14, textAlign: 'center', lineHeight: 21, marginBottom: 30 },
  grid:      { width: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip:      { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 14, borderRadius: 14, borderWidth: 1, width: '47%' },
  chipText:  { fontSize: 13, fontWeight: '500', flex: 1 },
});

// ─── Main screen ──────────────────────────────────────────────────────────────

const AIAssistantScreen = () => {
  const { state } = useApp();
  const isDark    = state.accessibilitySettings.isDarkMode;
  const theme     = useMemo(() => getThemeConfig(isDark), [isDark]);

  const [messages,        setMessages]        = useState<Message[]>([]);
  const [input,           setInput]           = useState('');
  const [isLoading,       setIsLoading]       = useState(false);
  const [isListening,     setIsListening]     = useState(false);
  const [conversationId,  setConversationId]  = useState<string | null>(null);
  const [userId,          setUserId]          = useState<string | null>(null);
  const [activeDocBanner, setActiveDocBanner] = useState<{ title: string; subtitle?: string } | null>(null);

  const listRef = useRef<FlatList>(null);

  // ── Load user session + most recent conversation on mount ─────────────────
  useEffect(() => {
    console.log('[AIAssistantScreen] Assistant screen opened');
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id ?? null;
      if (!uid) return;
      setUserId(uid);

      // If documentContext was passed in route params, this is a fresh document inquiry;
      // skip loading old past conversations so we don't overwrite the document context
      if (route.params?.documentContext) {
        console.log('[AIAssistantScreen] Skipping historical conversation load due to active documentContext');
        return;
      }

      const { data: conv } = await supabase
        .from('ai_conversations')
        .select('id')
        .eq('user_id', uid)
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();

      if (conv) {
        setConversationId(conv.id);
        const { data: msgs } = await supabase
          .from('ai_messages')
          .select('*')
          .eq('conversation_id', conv.id)
          .order('created_at', { ascending: true });

        if (msgs && msgs.length > 0) {
          setMessages(prev => {
            if (prev.length > 0) return prev;
            return msgs.map(m => ({
              role: m.role as 'user' | 'model',
              text: m.text,
              imageUri: m.image_uri ?? undefined,
              timestamp: new Date(m.created_at),
            }));
          });
        }
      }
    })();
  }, []);

  // ── Persist a single message to Supabase ──────────────────────────────────
  const persistMessage = useCallback(async (
    convId: string,
    uid: string,
    role: 'user' | 'model',
    text: string,
    imageUri?: string,
  ) => {
    const { error } = await supabase.from('ai_messages').insert({
      conversation_id: convId,
      user_id: uid,
      role,
      text,
      image_uri: imageUri ?? null,
    });
    if (error) console.error('[AI] persistMessage error:', error.message);
  }, []);

  // ── Get or create a conversation, returns its id ──────────────────────────
  const getOrCreateConversation = useCallback(async (uid: string, firstMessage: string): Promise<string> => {
    if (conversationId) return conversationId;
    const title = firstMessage.slice(0, 60);
    const { data, error } = await supabase
      .from('ai_conversations')
      .insert({ user_id: uid, title })
      .select('id')
      .single();
    if (error || !data) {
      console.error('[AI] getOrCreateConversation error:', error?.message);
      throw new Error('Could not create conversation');
    }
    setConversationId(data.id);
    return data.id;
  }, [conversationId]);

  const toggleMic = useCallback(async () => {
    if (!ExpoSpeechRecognitionModule) {
      Alert.alert('Not available', 'Voice input requires a development build.\n\nnpx expo run:ios\nnpx expo run:android');
      return;
    }
    if (isListening) {
      ExpoSpeechRecognitionModule.stop();
      setIsListening(false);
      return;
    }
    try {
      const { granted } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!granted) { Alert.alert('Permission needed', 'Microphone access is required for voice input.'); return; }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setIsListening(true);

      const resultSub = ExpoSpeechRecognitionModule.addListener('result', (e: any) => {
        const transcript = e.results?.[0]?.transcript ?? '';
        if (transcript) setInput(prev => (prev ? prev + ' ' + transcript : transcript));
      });
      const endSub = ExpoSpeechRecognitionModule.addListener('end', () => {
        setIsListening(false);
        resultSub.remove();
        endSub.remove();
        errorSub.remove();
      });
      const errorSub = ExpoSpeechRecognitionModule.addListener('error', () => {
        setIsListening(false);
        resultSub.remove();
        endSub.remove();
        errorSub.remove();
      });

      await ExpoSpeechRecognitionModule.start({ lang: 'en-US', interimResults: false, continuous: false });
    } catch (e) {
      console.warn('Speech recognition error:', e);
      setIsListening(false);
    }
  }, [isListening]);

  const speak = useCallback((text: string) => {
    if (!state.voiceAnnouncementsEnabled) return;
    ttsSpeakText(text, { rate: state.accessibilitySettings.voiceSpeed });
  }, [state.voiceAnnouncementsEnabled, state.accessibilitySettings.voiceSpeed]);


  const navigation = useNavigation();
  const route = useRoute<RouteProp<MainTabParamList, 'Assistant'>>();
  const lastDocumentHandledRef = useRef<string | null>(null);

  useEffect(() => {
    voiceManager.announceScreenChange('assistant');
    voiceManager.addCommand({
      keywords: ['clear chat', 'new chat', 'start over'],
      description: 'Clear the chat history',
      category: 'general',
      action: () => { setMessages([]); voiceManager.speak('Chat cleared'); },
    });
    return () => {
      voiceManager.removeCommand(['clear chat', 'new chat', 'start over']);
      ttsStopSpeaking();
    };
  }, []);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
  }, []);

  // Handle incoming document context from What Next engine
  useEffect(() => {
    const docContext = route.params?.documentContext;
    const docTitle = route.params?.documentTitle;
    const initialPrompt = route.params?.initialPrompt;

    if (docContext && docContext !== lastDocumentHandledRef.current) {
      lastDocumentHandledRef.current = docContext;
      console.log('[AIAssistantScreen] Document context received for:', docTitle || 'document', 'length:', docContext.length);
      setActiveDocBanner({ title: docTitle || 'Document' });
      setConversationId(null);

      const greeting = `I’m looking at your ${docTitle || 'document'}. What would you like to know?\n\n${docContext}`;
      const greetingMsg: Message = {
        role: 'model',
        text: greeting,
        timestamp: new Date(),
      };
      setMessages([greetingMsg]);
      speak(`I’m looking at your ${docTitle || 'document'}. What would you like to know?`);
      (navigation as any).setParams?.({
        documentContext: undefined,
        documentTitle: undefined,
      });
      scrollToBottom();
    }

    if (initialPrompt) {
      console.log('[AIAssistantScreen] Initial prompt received:', initialPrompt);
      setInput(initialPrompt);
      (navigation as any).setParams?.({ initialPrompt: undefined });
    }
  }, [route.params?.documentContext, route.params?.documentTitle, route.params?.initialPrompt, speak, scrollToBottom, navigation]);

  const handleSend = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    console.log('[AIAssistantScreen] User message submitted:', trimmed);
    const userMsg: Message = { role: 'user', text: trimmed, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    scrollToBottom();

    try {
      const history = [...messages, userMsg].slice(0, -1);
      const reply = await sendChatMessage(history, trimmed);
      const aiMsg: Message = { role: 'model', text: reply, timestamp: new Date() };
      setMessages(prev => [...prev, aiMsg]);
      console.log('[AIAssistantScreen] Assistant message displayed');
      speak(reply);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      // Persist to Supabase
      if (userId) {
        const convId = await getOrCreateConversation(userId, trimmed);
        await persistMessage(convId, userId, 'user', trimmed);
        await persistMessage(convId, userId, 'model', reply);
      }
    } catch (err: any) {
      console.error('[AIAssistantScreen] Error sending message:', err?.message);
      setMessages(prev => [...prev, { role: 'model', text: `Sorry, something went wrong: ${err?.message ?? 'Unknown error'}` }]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsLoading(false);
      scrollToBottom();
    }
  }, [messages, isLoading, speak, scrollToBottom, userId, getOrCreateConversation, persistMessage]);

  const pickImage = useCallback(() => {
    Alert.alert('Analyse Image', 'Choose a source', [
      {
        text: 'Camera',
        onPress: async () => {
          const p = await ImagePicker.requestCameraPermissionsAsync();
          if (!p.granted) { Alert.alert('Permission needed', 'Camera access is required.'); return; }
          const r = await ImagePicker.launchCameraAsync({ quality: 0.8 });
          if (!r.canceled) processImage(r.assets[0]);
        },
      },
      {
        text: 'Gallery',
        onPress: async () => {
          const p = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!p.granted) { Alert.alert('Permission needed', 'Gallery access is required.'); return; }
          const r = await ImagePicker.launchImageLibraryAsync({ quality: 0.8 });
          if (!r.canceled) processImage(r.assets[0]);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [input]);

  const processImage = useCallback(async (asset: ImagePicker.ImagePickerAsset) => {
    const prompt = input.trim() || 'What is in this image? Please explain it clearly.';
    const userMsg: Message = { role: 'user', text: prompt, imageUri: asset.uri, timestamp: new Date() };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    scrollToBottom();

    try {
      // Resize to max 800px wide and re-encode as JPEG to keep payload small
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 800 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );

      if (!manipulated.base64) throw new Error('Could not encode image');

      const reply = await sendImageMessage(manipulated.base64, 'image/jpeg', prompt);
      setMessages(prev => [...prev, { role: 'model', text: reply, timestamp: new Date() }]);
      speak(reply);

      // Persist to Supabase
      if (userId) {
        const convId = await getOrCreateConversation(userId, prompt);
        await persistMessage(convId, userId, 'user', prompt, asset.uri);
        await persistMessage(convId, userId, 'model', reply);
      }
    } catch (err: any) {
      console.error('Vision error:', err);
      setMessages(prev => [...prev, { role: 'model', text: `Sorry, I couldn't analyse that image: ${err?.message}` }]);
    } finally {
      setIsLoading(false);
      scrollToBottom();
    }
  }, [input, speak, scrollToBottom, userId, getOrCreateConversation, persistMessage]);

  const clearChat = useCallback(() => {
    Alert.alert('New Chat', 'Clear this conversation?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => {
          setMessages([]);
          setConversationId(null); // next message will create a new conversation
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        },
      },
    ]);
  }, []);

  const borderCol      = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';
  const inputBg        = isDark ? 'rgba(22,27,34,0.88)'   : 'rgba(255,255,255,0.88)';
  const headerBg       = isDark ? 'rgba(15,23,42,0.75)'   : 'rgba(255,255,255,0.75)';
  const bg             = 'transparent';
  const canSend        = input.trim().length > 0 && !isLoading;
  const gradientColors = theme.gradient as [string, string, ...string[]];
  const fontSize       = 16 * (state.accessibilitySettings.textZoom / 100);

  return (
    <LinearGradient colors={gradientColors} style={styles.safe}>
      <BackgroundLogo />
      <SafeAreaView style={styles.safeTransparent}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {/* Header */}
      <View style={[styles.header, { backgroundColor: isDark ? 'rgba(11, 16, 32, 0.90)' : headerBg, borderBottomColor: borderCol }]}>
        <View style={styles.headerCenter}>
          <EverySenseLogo size={28} showText={false} />
          <View style={{ alignItems: 'center' }}>
            <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>EVERYSENSE</Text>
            <Text style={[styles.headerSubtitle, { color: theme.textSecondary }]}>How can I help?</Text>
          </View>
        </View>
        {messages.length > 0 && (
          <TouchableOpacity onPress={clearChat} style={styles.newChatBtn} accessibilityLabel="New conversation" accessibilityRole="button">
            <Ionicons name="create-outline" size={22} color={theme.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Document Context Card when launched from What Next */}
      {activeDocBanner && (
        <View
          style={[
            styles.docBannerCard,
            {
              backgroundColor: isDark ? '#151D32' : '#F7F3EA',
              borderColor: isDark ? 'rgba(214, 179, 106, 0.28)' : 'rgba(214, 179, 106, 0.4)',
            },
          ]}
        >
          <View style={[styles.docBannerIconCircle, { backgroundColor: isDark ? 'rgba(214, 179, 106, 0.16)' : 'rgba(214, 179, 106, 0.25)' }]}>
            <Ionicons name="document-text-outline" size={16} color={theme.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.docBannerLabel, { color: theme.accent }]}>
              LOOKING AT
            </Text>
            <Text style={[styles.docBannerTitle, { color: theme.textPrimary }]} numberOfLines={1}>
              {activeDocBanner.title}
            </Text>
            <Text style={[styles.docBannerPrompt, { color: theme.textSecondary }]}>
              Ask me anything about it.
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => setActiveDocBanner(null)}
            style={styles.docBannerCloseBtn}
            accessibilityLabel="Dismiss document context"
            accessibilityRole="button"
          >
            <Ionicons name="close" size={18} color={theme.textMuted} />
          </TouchableOpacity>
        </View>
      )}

      {/* Body */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        {messages.length === 0 ? (
          <WelcomeView
            accent={theme.accent}
            textPrimary={theme.textPrimary}
            textMuted={theme.textMuted}
            isDark={isDark}
            onPrompt={handleSend}
          />
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(_, i) => String(i)}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <MessageBubble
                message={item}
                accent={theme.accent}
                bg={bg}
                textPrimary={theme.textPrimary}
                textMuted={theme.textMuted}
                isDark={isDark}
                fontSize={fontSize}
                voiceSpeed={state.accessibilitySettings.voiceSpeed}
              />
            )}
            contentContainerStyle={styles.msgList}
            showsVerticalScrollIndicator={false}
            ListFooterComponent={
              isLoading ? (
                <View style={[bStyles.aiRow, { paddingHorizontal: 16, marginVertical: 6, gap: 10 }]}>
                  <View style={[bStyles.aiAvatar, { backgroundColor: theme.accent + '22', borderColor: theme.accent + '44', borderWidth: 1 }]}>
                    <Text style={{ fontSize: 14 }}>✦</Text>
                  </View>
                  <View style={[bStyles.aiBubble, { backgroundColor: isDark ? 'rgba(30,36,51,0.85)' : 'rgba(255,255,255,0.85)', borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }]}>
                    <TypingDots color={theme.accent} />
                  </View>
                </View>
              ) : null
            }
          />
        )}

        {/* Input bar */}
        <View style={[styles.inputWrap, { backgroundColor: inputBg, borderTopColor: borderCol }]}>
          <View style={[styles.inputRow, { backgroundColor: inputBg, borderColor: borderCol }]}>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); pickImage(); }}
              disabled={isLoading}
              style={styles.inputIcon}
              accessibilityLabel="Send image"
            >
              <Ionicons name="image-outline" size={22} color={theme.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={toggleMic}
              disabled={isLoading}
              style={[styles.inputIcon, isListening && { backgroundColor: theme.accent + '22', borderRadius: 18 }]}
              accessibilityLabel={isListening ? 'Stop recording' : 'Voice input'}
            >
              <Ionicons
                name={isListening ? 'mic' : 'mic-outline'}
                size={22}
                color={isListening ? theme.accent : theme.textMuted}
              />
            </TouchableOpacity>

            <View style={styles.inputWrapper}>
              <TextInput
                style={[styles.input, { color: theme.textPrimary }]}
                value={input}
                onChangeText={setInput}
                placeholder="Message EverySense AI..."
                placeholderTextColor={theme.placeholder}
                multiline
                maxLength={1000}
                accessibilityLabel="Message input"
              />
            </View>

            <TouchableOpacity
              onPress={() => handleSend(input)}
              disabled={!canSend}
              style={[styles.sendBtn, { backgroundColor: canSend ? theme.accent : 'transparent' }]}
              accessibilityLabel="Send"
            >
              <Ionicons
                name="arrow-up"
                size={18}
                color={canSend ? '#fff' : theme.textMuted}
              />
            </TouchableOpacity>
          </View>
          <Text style={[styles.disclaimer, { color: theme.textMuted }]}>
            Always consult a professional for critical medical or financial matters.
          </Text>
        </View>
      </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
};

export default AIAssistantScreen;

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:            { flex: 1 },
  safeTransparent: { flex: 1, backgroundColor: 'transparent' },
  flex:            { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTitle:  { fontSize: 16, fontWeight: '800', letterSpacing: 1.2 },
  headerSubtitle: { fontSize: 12, fontWeight: '500', marginTop: 1 },
  newChatBtn:   { position: 'absolute', right: 16, minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },

  docBannerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
  },
  docBannerIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docBannerLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  docBannerTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginTop: 2,
  },
  docBannerPrompt: {
    fontSize: 12,
    fontWeight: '400',
    marginTop: 1,
  },
  docBannerCloseBtn: {
    padding: 6,
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  msgList: { paddingVertical: 16, paddingBottom: 8 },

  inputWrap: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 8 : 12,
    borderTopWidth: 1,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: 26,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 6,
    gap: 4,
  },
  inputIcon: { padding: 6 },
  inputWrapper: {
    flex: 1,
    minHeight: 36,
    maxHeight: 120,
    justifyContent: 'center',
  },
  input: {
    fontSize: 15,
    lineHeight: 22,
    paddingHorizontal: 6,
    paddingVertical: 4,
    textAlignVertical: 'center',
  },
  sendBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disclaimer: {
    fontSize: 11,
    textAlign: 'center',
    marginTop: 6,
  },
});
