import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { speakText as ttsSpeakText, stopSpeaking as ttsStopSpeaking } from '../services/ttsService';
import React, { useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getThemeConfig } from '../../constants/theme';
import { useApp } from '../contexts/AppContext';
import { submitFeedback } from '../utils/feedbackQueue';
import { navigationRef } from '../navigation/AppNavigator';

let ExpoSpeechRecognitionModule: any = null;
try {
  ExpoSpeechRecognitionModule = require('expo-speech-recognition').ExpoSpeechRecognitionModule;
} catch {}

// ── Data ────────────────────────────────────────────────────

const DISABILITY_CATEGORIES = [
  { key: 'visual_impairment', label: '👁 Visual Impairment' },
  { key: 'mobility_impairment', label: '♿ Mobility Impairment' },
  { key: 'hearing_impairment', label: '🦻 Hearing Impairment' },
  { key: 'cognitive_disability', label: '🧠 Cognitive Disability' },
  { key: 'elderly', label: '👴 Elderly User' },
  { key: 'multiple_disabilities', label: '🔗 Multiple Disabilities' },
  { key: 'no_disability', label: '✅ No Disability' },
  { key: 'prefer_not_to_say', label: '🔒 Prefer Not to Say' },
];

const FEATURES = [
  { key: 'reminders', label: '⏰ Reminders' },
  { key: 'voice_commands', label: '🎤 Voice Commands' },
  { key: 'ocr_camera', label: '📸 Camera / OCR' },
  { key: 'ai_assistant', label: '🤖 AI Assistant' },
  { key: 'community', label: '🌐 Community' },
  { key: 'check_in', label: '💚 Daily Check-In' },
  { key: 'accessible_places', label: '🗺 Accessible Places' },
  { key: 'medication_tracker', label: '💊 Medication Tracker' },
  { key: 'emergency_card', label: '🆘 Emergency Card' },
  { key: 'profile_settings', label: '⚙️ Profile / Settings' },
  { key: 'onboarding', label: '👋 Onboarding' },
  { key: 'general', label: '📱 General App' },
];

const TESTING_METHODS = [
  { key: 'self_testing', label: 'Self Testing' },
  { key: 'remote', label: 'Remote Session' },
  { key: 'in_person', label: 'In-Person Session' },
];

const ASSISTIVE_TECH_OPTIONS = [
  'Screen Reader (TalkBack)', 'Switch Control', 'Voice Control',
  'Magnification', 'Braille Display', 'Hearing Aid', 'None',
];

// ── Component ───────────────────────────────────────────────

const AccessibilityFeedbackScreen: React.FC = () => {
  const { state } = useApp();
  const theme = useMemo(() => getThemeConfig(state.accessibilitySettings.isDarkMode), [state.accessibilitySettings.isDarkMode]);

  // Tab state
  const [activeTab, setActiveTab] = useState<'feedback' | 'report_issue'>('feedback');

  // ── Feedback form state ──
  const [disabilityCategory, setDisabilityCategory] = useState('');
  const [featureTested, setFeatureTested] = useState('');
  const [testingMethod, setTestingMethod] = useState('self_testing');
  const [assistiveTech, setAssistiveTech] = useState('None');
  const [whatWorked, setWhatWorked] = useState('');
  const [whatDidntWork, setWhatDidntWork] = useState('');
  const [suggestions, setSuggestions] = useState('');
  const [overallRating, setOverallRating] = useState(0);
  const [easeOfUse, setEaseOfUse] = useState(0);
  const [accessibilityRating, setAccessibilityRating] = useState(0);
  const [isAnonymous, setIsAnonymous] = useState(false);

  // ── Report issue state ──
  const [issueType, setIssueType] = useState('');
  const [issueScreen, setIssueScreen] = useState('');
  const [issueDescription, setIssueDescription] = useState('');
  const [issueSeverity, setIssueSeverity] = useState('medium');
  const [wcagCriterion, setWcagCriterion] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [voiceListening, setVoiceListening] = useState<string | null>(null);

  const getAuthUserId = async (): Promise<string> => {
    const { data } = await supabase.auth.getSession();
    return data.session?.user?.id ?? 'anonymous';
  };

  const speakText = (text: string) => {
    if (!state.voiceAnnouncementsEnabled) return;
    ttsSpeakText(text, { rate: state.accessibilitySettings.voiceSpeed });
  };

  // ── Voice input helper ────────────────────────────────────

  const startVoiceInput = (field: string, setter: (v: string) => void) => {
    if (!ExpoSpeechRecognitionModule) {
      Alert.alert('Voice Input', 'Voice input requires a development build.');
      return;
    }
    speakText(`Speak your ${field}`);
    setVoiceListening(field);
    try {
      const listener = ExpoSpeechRecognitionModule.addListener('result', (e: any) => {
        if (e.isFinal) {
          const t = e.results?.[0]?.transcript || '';
          setter(t);
          setVoiceListening(null);
          listener.remove();
          speakText(`${field} set to: ${t}`);
        }
      });
      ExpoSpeechRecognitionModule.start({ language: 'en-US', maxResults: 1 });
    } catch {
      setVoiceListening(null);
    }
  };

  // ── Submit feedback ───────────────────────────────────────

  const handleSubmitFeedback = async () => {
    if (!disabilityCategory || !featureTested) {
      Alert.alert('Required Fields', 'Please select your disability category and the feature you tested.');
      speakText('Please select your disability category and the feature you tested.');
      return;
    }
    if (overallRating === 0) {
      Alert.alert('Required', 'Please provide an overall rating.');
      return;
    }
    setSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const authUserId = await getAuthUserId();

    const { queued } = await submitFeedback({
      type: 'feedback',
      data: {
        user_id: authUserId,
        disability_category: disabilityCategory,
        feature_tested: featureTested,
        what_worked: whatWorked || undefined,
        what_didnt_work: whatDidntWork || undefined,
        suggestions: suggestions || undefined,
        overall_rating: overallRating,
        ease_of_use: easeOfUse || undefined,
        accessibility_rating: accessibilityRating || undefined,
        testing_method: testingMethod,
        assistive_tech_used: assistiveTech !== 'None' ? assistiveTech : undefined,
        is_anonymous: isAnonymous,
        session_id: `session-${Date.now()}`,
      },
    });

    setSubmitting(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const msg = queued
      ? 'Feedback saved! It will sync when you are online.'
      : 'Thank you! Your feedback has been submitted.';
    Alert.alert('Feedback Submitted', msg);
    speakText(msg);

    // Reset
    setDisabilityCategory('');
    setFeatureTested('');
    setWhatWorked('');
    setWhatDidntWork('');
    setSuggestions('');
    setOverallRating(0);
    setEaseOfUse(0);
    setAccessibilityRating(0);
  };

  // ── Submit issue ──────────────────────────────────────────

  const handleSubmitIssue = async () => {
    if (!issueType || !issueScreen || !issueDescription.trim()) {
      Alert.alert('Required Fields', 'Please fill in issue type, screen name, and description.');
      return;
    }
    setSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const authUserId = await getAuthUserId();

    const { queued } = await submitFeedback({
      type: 'issue',
      data: {
        user_id: authUserId,
        issue_type: issueType,
        screen_name: issueScreen,
        description: issueDescription,
        severity: issueSeverity,
        wcag_criterion: wcagCriterion || undefined,
      },
    });

    setSubmitting(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const msg = queued
      ? 'Issue saved offline. It will sync when online.'
      : 'Accessibility issue reported. Thank you!';
    Alert.alert('Issue Reported', msg);
    speakText(msg);

    setIssueType('');
    setIssueScreen('');
    setIssueDescription('');
    setWcagCriterion('');
    setIssueSeverity('medium');
  };

  // ── Subcomponents ─────────────────────────────────────────

  const StarRating = ({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) => (
    <View style={s.ratingRow} accessibilityLabel={`${label} rating`}>
      <Text style={[s.label, { color: theme.textSecondary }]}>{label}</Text>
      <View style={s.stars}>
        {[1, 2, 3, 4, 5].map(star => (
          <TouchableOpacity
            key={star}
            onPress={() => { onChange(star); Haptics.selectionAsync(); }}
            accessibilityLabel={`${star} star${star > 1 ? 's' : ''}`}
            accessibilityRole="button"
          >
            <Ionicons
              name={star <= value ? 'star' : 'star-outline'}
              size={30}
              color={star <= value ? '#F59E0B' : theme.textMuted}
              style={{ marginHorizontal: 3 }}
            />
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  const ChipSelector = ({ options, selected, onSelect }: {
    options: { key: string; label: string }[];
    selected: string;
    onSelect: (k: string) => void;
  }) => (
    <View style={s.chipGrid}>
      {options.map(o => (
        <TouchableOpacity
          key={o.key}
          style={[s.chip, { borderColor: theme.cardBorder, backgroundColor: selected === o.key ? theme.accent : theme.cardBackground }]}
          onPress={() => { onSelect(o.key); Haptics.selectionAsync(); }}
          accessibilityRole="radio"
          accessibilityState={{ selected: selected === o.key }}
        >
          <Text style={[s.chipText, { color: selected === o.key ? '#fff' : theme.textPrimary }]}>{o.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  const VoiceField = ({ label, value, onChange, field }: {
    label: string; value: string; onChange: (v: string) => void; field: string;
  }) => (
    <View style={{ marginBottom: 14 }}>
      <View style={s.fieldHeader}>
        <Text style={[s.label, { color: theme.textSecondary }]}>{label}</Text>
        <TouchableOpacity
          onPress={() => startVoiceInput(field, onChange)}
          accessibilityLabel={`Voice input for ${label}`}
          accessibilityRole="button"
        >
          <Ionicons
            name={voiceListening === field ? 'mic' : 'mic-outline'}
            size={20}
            color={voiceListening === field ? theme.accent : theme.textMuted}
          />
        </TouchableOpacity>
      </View>
      <TextInput
        style={[s.input, { color: theme.textPrimary, backgroundColor: theme.inputBackground, borderColor: theme.inputBorder }]}
        value={value}
        onChangeText={onChange}
        placeholder={`Type or tap mic to speak...`}
        placeholderTextColor={theme.textMuted}
        multiline
        numberOfLines={3}
        accessibilityLabel={label}
      />
    </View>
  );

  // ── Render ────────────────────────────────────────────────

  return (
    <SafeAreaView style={[s.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={[s.header, { borderBottomColor: theme.cardBorder }]}>
        <TouchableOpacity onPress={() => navigationRef.current?.goBack()} accessibilityLabel="Go back" accessibilityRole="button">
          <Ionicons name="arrow-back" size={24} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: theme.textPrimary }]}>♿ Accessibility Testing</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Tabs */}
      <View style={[s.tabBar, { borderBottomColor: theme.cardBorder }]}>
        {(['feedback', 'report_issue'] as const).map(tab => (
          <TouchableOpacity
            key={tab}
            style={[s.tab, activeTab === tab && { borderBottomColor: theme.accent, borderBottomWidth: 2 }]}
            onPress={() => { setActiveTab(tab); Haptics.selectionAsync(); }}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === tab }}
          >
            <Text style={[s.tabText, { color: activeTab === tab ? theme.accent : theme.textMuted }]}>
              {tab === 'feedback' ? '📋 Submit Feedback' : '🚨 Report Issue'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>

        {/* ── FEEDBACK TAB ── */}
        {activeTab === 'feedback' && (
          <>
            <Text style={[s.sectionTitle, { color: theme.textPrimary }]}>About You</Text>

            <Text style={[s.label, { color: theme.textSecondary }]}>Your accessibility needs</Text>
            <ChipSelector options={DISABILITY_CATEGORIES} selected={disabilityCategory} onSelect={setDisabilityCategory} />

            <Text style={[s.label, { color: theme.textSecondary, marginTop: 16 }]}>Feature tested</Text>
            <ChipSelector options={FEATURES} selected={featureTested} onSelect={setFeatureTested} />

            <Text style={[s.label, { color: theme.textSecondary, marginTop: 16 }]}>Testing method</Text>
            <ChipSelector options={TESTING_METHODS} selected={testingMethod} onSelect={setTestingMethod} />

            <Text style={[s.label, { color: theme.textSecondary, marginTop: 16 }]}>Assistive technology used</Text>
            <ChipSelector
              options={ASSISTIVE_TECH_OPTIONS.map(t => ({ key: t, label: t }))}
              selected={assistiveTech}
              onSelect={setAssistiveTech}
            />

            <Text style={[s.sectionTitle, { color: theme.textPrimary, marginTop: 24 }]}>Your Experience</Text>

            <VoiceField label="What worked well?" value={whatWorked} onChange={setWhatWorked} field="what worked" />
            <VoiceField label="What didn't work?" value={whatDidntWork} onChange={setWhatDidntWork} field="what didn't work" />
            <VoiceField label="Suggestions for improvement" value={suggestions} onChange={setSuggestions} field="suggestions" />

            <Text style={[s.sectionTitle, { color: theme.textPrimary, marginTop: 24 }]}>Ratings</Text>

            <StarRating label="Overall Experience" value={overallRating} onChange={setOverallRating} />
            <StarRating label="Ease of Use" value={easeOfUse} onChange={setEaseOfUse} />
            <StarRating label="Accessibility" value={accessibilityRating} onChange={setAccessibilityRating} />

            {/* Anonymous toggle */}
            <TouchableOpacity
              style={s.toggleRow}
              onPress={() => { setIsAnonymous(!isAnonymous); Haptics.selectionAsync(); }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isAnonymous }}
            >
              <Ionicons name={isAnonymous ? 'checkbox' : 'square-outline'} size={22} color={theme.accent} />
              <Text style={[s.toggleLabel, { color: theme.textSecondary }]}>Submit anonymously</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.submitBtn, { backgroundColor: submitting ? theme.textMuted : theme.accent }]}
              onPress={handleSubmitFeedback}
              disabled={submitting}
              accessibilityLabel="Submit accessibility feedback"
              accessibilityRole="button"
            >
              <Text style={s.submitBtnText}>{submitting ? 'Submitting...' : '✓ Submit Feedback'}</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── REPORT ISSUE TAB ── */}
        {activeTab === 'report_issue' && (
          <>
            <Text style={[s.sectionTitle, { color: theme.textPrimary }]}>Report an Accessibility Issue</Text>
            <Text style={[s.hint, { color: theme.textSecondary }]}>
              Help us fix WCAG 2.2 AA issues. Your report goes directly to the developer.
            </Text>

            <Text style={[s.label, { color: theme.textSecondary, marginTop: 16 }]}>Issue type</Text>
            <ChipSelector
              options={[
                { key: 'screen_reader_incompatible', label: 'Screen Reader' },
                { key: 'too_small_touch_target', label: 'Touch Target' },
                { key: 'low_contrast', label: 'Low Contrast' },
                { key: 'missing_label', label: 'Missing Label' },
                { key: 'voice_command_failed', label: 'Voice Command' },
                { key: 'tts_not_working', label: 'TTS Issue' },
                { key: 'navigation_blocked', label: 'Navigation' },
                { key: 'content_unreadable', label: 'Unreadable' },
                { key: 'crash_or_error', label: 'Crash/Error' },
                { key: 'other', label: 'Other' },
              ]}
              selected={issueType}
              onSelect={setIssueType}
            />

            <Text style={[s.label, { color: theme.textSecondary, marginTop: 16 }]}>Severity</Text>
            <ChipSelector
              options={[
                { key: 'low', label: '🟢 Low' },
                { key: 'medium', label: '🟡 Medium' },
                { key: 'high', label: '🟠 High' },
                { key: 'critical', label: '🔴 Critical' },
              ]}
              selected={issueSeverity}
              onSelect={setIssueSeverity}
            />

            <View style={{ marginBottom: 14, marginTop: 16 }}>
              <Text style={[s.label, { color: theme.textSecondary }]}>Screen / Feature name</Text>
              <TextInput
                style={[s.input, { color: theme.textPrimary, backgroundColor: theme.inputBackground, borderColor: theme.inputBorder }]}
                value={issueScreen}
                onChangeText={setIssueScreen}
                placeholder="e.g. Reminders screen"
                placeholderTextColor={theme.textMuted}
                accessibilityLabel="Screen or feature name"
              />
            </View>

            <VoiceField label="Describe the issue *" value={issueDescription} onChange={setIssueDescription} field="issue description" />

            <View style={{ marginBottom: 14 }}>
              <Text style={[s.label, { color: theme.textSecondary }]}>WCAG criterion (optional)</Text>
              <TextInput
                style={[s.input, { color: theme.textPrimary, backgroundColor: theme.inputBackground, borderColor: theme.inputBorder }]}
                value={wcagCriterion}
                onChangeText={setWcagCriterion}
                placeholder="e.g. 1.4.3 Contrast, 4.1.2 Labels"
                placeholderTextColor={theme.textMuted}
                accessibilityLabel="WCAG criterion"
              />
            </View>

            <TouchableOpacity
              style={[s.submitBtn, { backgroundColor: submitting ? theme.textMuted : '#EF4444' }]}
              onPress={handleSubmitIssue}
              disabled={submitting}
              accessibilityLabel="Report accessibility issue"
              accessibilityRole="button"
            >
              <Text style={s.submitBtnText}>{submitting ? 'Submitting...' : '🚨 Report Issue'}</Text>
            </TouchableOpacity>
          </>
        )}

      </ScrollView>
    </SafeAreaView>
  );
};

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabText: { fontSize: 14, fontWeight: '600' },
  scroll: { flex: 1 },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginBottom: 12, marginTop: 8 },
  label: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
  hint: { fontSize: 13, marginBottom: 12, lineHeight: 18 },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 13, fontWeight: '500' },
  fieldHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  input: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, minHeight: 44, textAlignVertical: 'top',
  },
  ratingRow: { marginBottom: 16 },
  stars: { flexDirection: 'row', marginTop: 6 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 10 },
  toggleLabel: { fontSize: 14 },
  submitBtn: {
    paddingVertical: 16, borderRadius: 14, alignItems: 'center',
    marginTop: 8, marginBottom: 20,
  },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});

export default AccessibilityFeedbackScreen;
