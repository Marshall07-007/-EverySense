/**
 * CheckInScreen.tsx
 *
 * Daily wellness check-in for EverySense users.
 * Users tap big emoji buttons to log their mood, pain level, and energy.
 * All check-ins are saved to Supabase and shown as a history list below.
 *
 * Designed for accessibility:
 *  - Large tap targets (no typing required)
 *  - TTS announces selections and confirmations
 *  - Full dark mode support
 *  - Screen-reader labels on every interactive element
 */

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { speakText as ttsSpeakText, stopSpeaking as ttsStopSpeaking } from '../services/ttsService';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { getThemeConfig } from '../../constants/theme';
import { BackgroundLogo } from '../components/BackgroundLogo';
import { ModernCard } from '../components/ModernCard';
import { useApp } from '../contexts/AppContext';
import { supabase } from '../../lib/supabase';
import { voiceManager } from '../utils/voiceCommandManager';
import { navigationRef } from '../navigation/AppNavigator';

//  Types  
type MoodOption = { emoji: string; label: string; value: number; color: string };
type PainOption = { emoji: string; label: string; value: number; color: string };
type EnergyOption = { emoji: string; label: string; value: number; color: string };
type SleepOption = { emoji: string; label: string; value: number; color: string };

interface CheckIn {
  id: string;
  mood: number;
  pain: number;
  energy: number;
  sleep?: number;
  note?: string;
  created_at: string;
}

//  Data  

const MOOD_OPTIONS: MoodOption[] = [
  { emoji: '😄', label: 'Great',   value: 5, color: '#22C55E' },
  { emoji: '🙂', label: 'Good',    value: 4, color: '#84CC16' },
  { emoji: '😐', label: 'Okay',    value: 3, color: '#F59E0B' },
  { emoji: '😔', label: 'Low',     value: 2, color: '#F97316' },
  { emoji: '😢', label: 'Bad',     value: 1, color: '#EF4444' },
];

const PAIN_OPTIONS: PainOption[] = [
  { emoji: '✅', label: 'None',    value: 0, color: '#22C55E' },
  { emoji: '😌', label: 'Mild',    value: 1, color: '#84CC16' },
  { emoji: '😣', label: 'Moderate',value: 2, color: '#F59E0B' },
  { emoji: '😖', label: 'Severe',  value: 3, color: '#F97316' },
  { emoji: '🆘', label: 'Crisis',  value: 4, color: '#EF4444' },
];

const ENERGY_OPTIONS: EnergyOption[] = [
  { emoji: '⚡', label: 'High',    value: 3, color: '#22C55E' },
  { emoji: '🔋', label: 'Normal',  value: 2, color: '#84CC16' },
  { emoji: '🪫', label: 'Low',     value: 1, color: '#F59E0B' },
  { emoji: '😴', label: 'Drained', value: 0, color: '#EF4444' },
];

const SLEEP_OPTIONS = [
  { emoji: '😴', label: 'Great',    value: 4, color: '#6366F1' },
  { emoji: '🙂', label: 'Good',     value: 3, color: '#818CF8' },
  { emoji: '😐', label: 'Fair',     value: 2, color: '#F59E0B' },
  { emoji: '😣', label: 'Poor',     value: 1, color: '#F97316' },
  { emoji: '🥱', label: 'No Sleep', value: 0, color: '#EF4444' },
];

//  Helpers  


const moodLabel  = (v: number) => MOOD_OPTIONS.find(o => o.value === v)?.label   ?? '–';
const painLabel  = (v: number) => PAIN_OPTIONS.find(o => o.value === v)?.label   ?? '–';
const sleepLabel = (v: number) => SLEEP_OPTIONS.find(o => o.value === v)?.label  ?? '–';
const energyLabel= (v: number) => ENERGY_OPTIONS.find(o => o.value === v)?.label ?? '–';

const moodEmoji  = (v: number) => MOOD_OPTIONS.find(o => o.value === v)?.emoji   ?? '–';
const painEmoji  = (v: number) => PAIN_OPTIONS.find(o => o.value === v)?.emoji   ?? '–';
const sleepEmoji = (v: number) => SLEEP_OPTIONS.find(o => o.value === v)?.emoji  ?? '–';
const energyEmoji= (v: number) => ENERGY_OPTIONS.find(o => o.value === v)?.emoji ?? '–';
const moodColor  = (v: number) => MOOD_OPTIONS.find(o => o.value === v)?.color   ?? '#94A3B8';
const painColor  = (v: number) => PAIN_OPTIONS.find(o => o.value === v)?.color   ?? '#94A3B8';
const sleepColor = (v: number) => SLEEP_OPTIONS.find(o => o.value === v)?.color  ?? '#94A3B8';
const energyColor= (v: number) => ENERGY_OPTIONS.find(o => o.value === v)?.color ?? '#94A3B8';

const formatDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

//  Sub-components 

interface SelectorProps<T extends { emoji: string; label: string; value: number; color: string }> {
  options: T[];
  selected: number | null;
  onSelect: (value: number, label: string) => void;
  themeTextPrimary: string;
  themeCardBackground: string;
  themeCardBorder: string;
}

function OptionSelector<T extends { emoji: string; label: string; value: number; color: string }>({
  options, selected, onSelect, themeTextPrimary, themeCardBackground, themeCardBorder,
}: SelectorProps<T>) {
  return (
    <View style={selectorStyles.row}>
      {options.map(opt => {
        const isSelected = selected === opt.value;
        return (
          <TouchableOpacity
            key={opt.value}
            style={[
              selectorStyles.option,
              {
                backgroundColor: isSelected ? opt.color + '33' : themeCardBackground,
                borderColor: isSelected ? opt.color : themeCardBorder,
                borderWidth: isSelected ? 2.5 : 1,
              },
            ]}
            onPress={() => onSelect(opt.value, opt.label)}
            accessibilityRole="button"
            accessibilityLabel={opt.label}
            accessibilityState={{ selected: isSelected }}
          >
            <Text style={selectorStyles.emoji}>{opt.emoji}</Text>
            <Text style={[selectorStyles.label, { color: isSelected ? opt.color : themeTextPrimary }]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const selectorStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 12,
  },
  option: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 14,
    gap: 4,
  },
  emoji: { fontSize: 24 },
  label: { fontSize: 11, fontWeight: '600', textAlign: 'center' },
});

//  Main Screen

const CheckInScreen = () => {
  const { state } = useApp();
  const isDark = state.accessibilitySettings.isDarkMode;
  const theme = useMemo(() => getThemeConfig(isDark), [isDark]);

  // Form state
  const [mood,   setMood]   = useState<number | null>(null);
  const [pain,   setPain]   = useState<number | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  const [sleep, setSleep] = useState<number | null>(null);

  // UI state
  const [isSaving,   setIsSaving]   = useState(false);
  const [isLoading,  setIsLoading]  = useState(true);
  const [history,    setHistory]    = useState<CheckIn[]>([]);
  const [todayDone,  setTodayDone]  = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;

  //  TTS helper
  const speak = useCallback((text: string) => {
    if (!state.voiceAnnouncementsEnabled) return;
    ttsSpeakText(text, { rate: state.accessibilitySettings.voiceSpeed });
  }, [state.voiceAnnouncementsEnabled, state.accessibilitySettings.voiceSpeed]);

  // Load history from Supabase  
  const loadHistory = useCallback(async () => {
    if (!state.user?.id) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('check_ins')
        .select('*')
        .eq('user_id', state.user.id)
        .order('created_at', { ascending: false })
        .limit(20);
      
      
      if (error) throw error;
 
      setHistory(data || []);
 
      // Check if user already checked in today
      if (data && data.length > 0) {
        const latest = new Date(data[0].created_at);
        const today  = new Date();
        const sameDay =
          latest.getFullYear() === today.getFullYear() &&
          latest.getMonth()    === today.getMonth()    &&
          latest.getDate()     === today.getDate();
        setTodayDone(sameDay);
      }
    } catch (err) {
      console.warn('CheckIn: failed to load history:', err);
    } finally {
      setIsLoading(false);
    }
  }, [state.user?.id]);
 
  //  On mount
  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start();
    loadHistory();
    voiceManager.announceScreenChange('checkin');

    // Screen-specific voice commands
    voiceManager.addCommand({
      keywords: ['save check in', 'submit check in', 'log check in'],
      description: 'Save your daily check-in',
      category: 'general',
      action: () => { handleSubmit(); },
    });

    return () => {
      voiceManager.removeCommand(['save check in', 'submit check in', 'log check in']);
    };
  }, []);
 
  // Save check-in  
  const handleSubmit = async () => {
    if (mood === null || pain === null || energy === null || sleep === null) {
      Alert.alert('Almost there!', 'Please select an option for mood, pain, energy, and sleep.');
      speak('Please fill in all four sections before saving.');
      return;
    }
 
    setIsSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
 
    try {
      const { error } = await supabase.from('check_ins').insert({
        user_id: state.user!.id,
        mood,
        pain,
        energy,
        sleep, 
      });
 
      if (error) throw error;
 
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      speak(`Check-in saved. Mood ${moodLabel(mood)}, pain ${painLabel(pain)}, energy ${energyLabel(energy)}, sleep ${sleepLabel(sleep)}.`);
      setTodayDone(true);
      setMood(null);
      setPain(null);
      setEnergy(null);
      setSleep(null);
      await loadHistory();
    } catch (err) {
      console.warn('CheckIn: save failed:', err);
      Alert.alert('Save failed', 'Could not save your check-in. Please try again.');
      speak('Save failed. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };
 
  // History item  
  const renderHistoryItem = ({ item }: { item: CheckIn }) => (
    <ModernCard variant="elevated" style={[histStyles.card, { backgroundColor: theme.cardBackground, borderColor: theme.cardBorder }] as any}>
      <Text style={[histStyles.date, { color: theme.textSecondary }]}>{formatDate(item.created_at)}</Text>
      <View style={histStyles.row}>
        {/* Mood */}
        <View style={histStyles.pill}>
          <Text style={histStyles.pillEmoji}>{moodEmoji(item.mood)}</Text>
          <View style={[histStyles.pillBadge, { backgroundColor: moodColor(item.mood) + '22' }]}>
            <Text style={[histStyles.pillText, { color: moodColor(item.mood) }]}>{moodLabel(item.mood)}</Text>
          </View>
        </View>
        {/* Pain */}
        <View style={histStyles.pill}>
          <Text style={histStyles.pillEmoji}>{painEmoji(item.pain)}</Text>
          <View style={[histStyles.pillBadge, { backgroundColor: painColor(item.pain) + '22' }]}>
            <Text style={[histStyles.pillText, { color: painColor(item.pain) }]}>{painLabel(item.pain)}</Text>
          </View>
        </View>
        {/* Energy */}
        <View style={histStyles.pill}>
          <Text style={histStyles.pillEmoji}>{energyEmoji(item.energy)}</Text>
          <View style={[histStyles.pillBadge, { backgroundColor: energyColor(item.energy) + '22' }]}>
            <Text style={[histStyles.pillText, { color: energyColor(item.energy) }]}>{energyLabel(item.energy)}</Text>
          </View>
        </View>
        {/* Sleep */}
        {item.sleep !== undefined && item.sleep !== null && (
          <View style={histStyles.pill}>
            <Text style={histStyles.pillEmoji}>{sleepEmoji(item.sleep)}</Text>
            <View style={[histStyles.pillBadge, { backgroundColor: sleepColor(item.sleep) + '22' }]}>
              <Text style={[histStyles.pillText, { color: sleepColor(item.sleep) }]}>{sleepLabel(item.sleep)}</Text>
            </View>
          </View>
        )}
      </View>
    </ModernCard>
  );
 
  //  Render 
  return (
    <LinearGradient colors={theme.gradient as any} style={styles.container}>
      <BackgroundLogo />
      <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.textPrimary }]}>HOW ARE YOU DOING?</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
              {todayDone
                ? "You're all set for today. Take care of yourself."
                : 'Take a calm moment to check in with yourself.'}
            </Text>

            {/* Medication Tracker card */}
            <TouchableOpacity
              onPress={() => navigationRef.current?.navigate('MedicationTracker')}
              style={[styles.dashCard, { marginBottom: 10, backgroundColor: theme.surface, borderColor: theme.cardBorder }]}
              accessibilityLabel="Open medication tracker"
            >
              <View style={styles.dashCardLeft}>
                <View style={[styles.dashIconWrap, { backgroundColor: 'rgba(53, 198, 163, 0.16)' }]}>
                  <Ionicons name="medical-outline" size={20} color={theme.teal} />
                </View>
                <View>
                  <Text style={[styles.dashCardTitle, { color: theme.textPrimary }]}>Medications</Text>
                  <Text style={[styles.dashCardSub, { color: theme.textSecondary }]}>Track daily doses · Mark as taken</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.accent} />
            </TouchableOpacity>

            {/* Dashboard card */}
            <TouchableOpacity
              onPress={() => navigationRef.current?.navigate('HealthDashboard')}
              style={[styles.dashCard, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}
              accessibilityLabel="View health dashboard"
            >
              <View style={styles.dashCardLeft}>
                <View style={[styles.dashIconWrap, { backgroundColor: 'rgba(214, 179, 106, 0.16)' }]}>
                  <Ionicons name="stats-chart-outline" size={20} color={theme.accent} />
                </View>
                <View>
                  <Text style={[styles.dashCardTitle, { color: theme.textPrimary }]}>Health Summary</Text>
                  <Text style={[styles.dashCardSub, { color: theme.textSecondary }]}>Patterns · Streaks · Insights</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.accent} />
            </TouchableOpacity>
          </View>
 
          {/* Form card */}
          {!todayDone && (
            <ModernCard variant="elevated" style={[styles.formCard, { backgroundColor: theme.cardBackground, borderColor: theme.cardBorder }] as any}>
 
              {/* Mood */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="happy-outline" size={20} color={theme.accent} />
                  <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Mood</Text>
                </View>
                <OptionSelector
                  options={MOOD_OPTIONS}
                  selected={mood}
                  onSelect={(v, l) => { setMood(v); speak(`Mood set to ${l}`); Haptics.selectionAsync(); }}
                  themeTextPrimary={theme.textPrimary}
                  themeCardBackground={theme.inputBackground}
                  themeCardBorder={theme.cardBorder}
                />
              </View>
 
              <View style={[styles.divider, { backgroundColor: theme.cardBorder }]} />
 
              {/* Pain */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="fitness-outline" size={20} color={theme.danger} />
                  <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Pain Level</Text>
                </View>
                <OptionSelector
                  options={PAIN_OPTIONS}
                  selected={pain}
                  onSelect={(v, l) => { setPain(v); speak(`Pain set to ${l}`); Haptics.selectionAsync(); }}
                  themeTextPrimary={theme.textPrimary}
                  themeCardBackground={theme.inputBackground}
                  themeCardBorder={theme.cardBorder}
                />
              </View>
 
              <View style={[styles.divider, { backgroundColor: theme.cardBorder }]} />
 
              {/* Energy */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="flash-outline" size={20} color={theme.warning} />
                  <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Energy</Text>
                </View>
                <OptionSelector
                  options={ENERGY_OPTIONS}
                  selected={energy}
                  onSelect={(v, l) => { setEnergy(v); speak(`Energy set to ${l}`); Haptics.selectionAsync(); }}
                  themeTextPrimary={theme.textPrimary}
                  themeCardBackground={theme.inputBackground}
                  themeCardBorder={theme.cardBorder}
                />
              </View>
 
              <View style={[styles.divider, { backgroundColor: theme.cardBorder }]} />
 
              {/* Sleep */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="moon-outline" size={20} color="#6366F1" />
                  <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Sleep Quality</Text>
                </View>
                <OptionSelector
                  options={SLEEP_OPTIONS}
                  selected={sleep}
                  onSelect={(v, l) => { setSleep(v); speak(`Sleep set to ${l}`); Haptics.selectionAsync(); }}
                  themeTextPrimary={theme.textPrimary}
                  themeCardBackground={theme.inputBackground}
                  themeCardBorder={theme.cardBorder}
                />
              </View>
 
              {/* Save button */}
              <TouchableOpacity
                style={[
                  styles.saveBtn,
                  {
                    backgroundColor: (mood !== null && pain !== null && energy !== null && sleep !== null)
                      ? theme.accent
                      : theme.inputBorder,
                  },
                ]}
                onPress={handleSubmit}
                disabled={isSaving || mood === null || pain === null || energy === null || sleep === null}
                accessibilityRole="button"
                accessibilityLabel="Save check-in"
              >
                {isSaving
                  ? <ActivityIndicator color="#fff" />
                  : (
                    <>
                      <Ionicons name="checkmark-circle-outline" size={22} color="#fff" />
                      <Text style={styles.saveBtnText}>Save Check-In</Text>
                    </>
                  )}
              </TouchableOpacity>
            </ModernCard>
          )}
 
          {/* History */}
          <View style={styles.historyHeader}>
            <Ionicons name="time-outline" size={20} color={theme.accent} />
            <Text style={[styles.historyTitle, { color: theme.textPrimary }]}>Past Check-Ins</Text>
          </View>
 
          {isLoading ? (
            <ActivityIndicator color={theme.accent} style={{ marginTop: 20 }} />
          ) : history.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={{ fontSize: 40 }}>📋</Text>
              <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                No check-ins yet.{'\n'}Complete your first one above!
              </Text>
            </View>
          ) : (
            <FlatList
              data={history}
              keyExtractor={item => item.id}
              renderItem={renderHistoryItem}
              scrollEnabled={false}
              contentContainerStyle={{ gap: 10 }}
            />
          )}
 
          <View style={{ height: 40 }} />
        </ScrollView>
      </Animated.View>
    </LinearGradient>
  );
};
 
export default CheckInScreen;
 
//Styles 
 
const styles = StyleSheet.create({
  container:   { flex: 1 },
  content:     { flex: 1 },
  scroll:      { padding: 20, paddingTop: 60 },
  header:      { marginBottom: 20 },
  title:       { fontSize: 28, fontWeight: '800', marginBottom: 6 },
  subtitle:    { fontSize: 15, lineHeight: 22 },
  formCard:    { padding: 20, borderRadius: 20, borderWidth: 1, marginBottom: 28 },
  section:     { paddingVertical: 4 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  sectionTitle:  { fontSize: 17, fontWeight: '700' },
  divider:     { height: 1, marginVertical: 16 },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 20,
    paddingVertical: 16,
    borderRadius: 16,
  },
  saveBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  dashCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff', borderRadius: 16, padding: 14, marginTop: 14,
    shadowColor: '#7C3AED', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15, shadowRadius: 10, elevation: 5,
  },
  dashCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dashIconWrap: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: '#EDE9FE', alignItems: 'center', justifyContent: 'center',
  },
  dashCardTitle: { fontSize: 15, fontWeight: '700', color: '#1F2937' },
  dashCardSub:   { fontSize: 12, color: '#7C3AED', fontWeight: '600', marginTop: 2 },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  historyTitle: { fontSize: 20, fontWeight: '700' },
  emptyState: { alignItems: 'center', gap: 10, paddingVertical: 30 },
  emptyText:  { fontSize: 15, textAlign: 'center', lineHeight: 22 },
});
 
const histStyles = StyleSheet.create({
  card:  { padding: 14, borderRadius: 16, borderWidth: 1, marginBottom: 2 },
  date:  { fontSize: 12, fontWeight: '600', marginBottom: 10 },
  row:   { flexDirection: 'row', gap: 10 },
  pill:  { flex: 1, alignItems: 'center', gap: 4 },
  pillEmoji: { fontSize: 22 },
  pillBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  pillText:  { fontSize: 11, fontWeight: '700' },
});


 

      
