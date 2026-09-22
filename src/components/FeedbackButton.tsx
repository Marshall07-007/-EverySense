/**
 * FeedbackButton.tsx
 * A small "Report Accessibility Issue" button that can be placed
 * in any screen header or footer. Tapping it opens a quick issue
 * report sheet without leaving the current screen.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { getThemeConfig } from '../../constants/theme';
import { useApp } from '../contexts/AppContext';
import { supabase } from '../../lib/supabase';
import { submitFeedback } from '../utils/feedbackQueue';

interface FeedbackButtonProps {
  screenName: string;      // current screen, pre-fills the form
  compact?: boolean;       // icon-only mode (no label)
}

const ISSUE_TYPES = [
  { key: 'screen_reader_incompatible', label: 'Screen Reader' },
  { key: 'too_small_touch_target', label: 'Touch Target' },
  { key: 'low_contrast', label: 'Low Contrast' },
  { key: 'missing_label', label: 'Missing Label' },
  { key: 'voice_command_failed', label: 'Voice Command' },
  { key: 'tts_not_working', label: 'TTS Issue' },
  { key: 'navigation_blocked', label: 'Navigation' },
  { key: 'crash_or_error', label: 'Crash/Error' },
  { key: 'other', label: 'Other' },
];

const SEVERITIES = [
  { key: 'low', label: '🟢 Low' },
  { key: 'medium', label: '🟡 Medium' },
  { key: 'high', label: '🟠 High' },
  { key: 'critical', label: '🔴 Critical' },
];

const FeedbackButton: React.FC<FeedbackButtonProps> = ({ screenName, compact = false }) => {
  const { state } = useApp();
  const theme = useMemo(() => getThemeConfig(state.accessibilitySettings.isDarkMode), [state.accessibilitySettings.isDarkMode]);

  const [visible, setVisible] = useState(false);
  const [issueType, setIssueType] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const open = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setVisible(true);
  };

  const close = () => {
    setVisible(false);
    setIssueType('');
    setSeverity('medium');
    setDescription('');
  };

  const submit = async () => {
    if (!issueType || !description.trim()) {
      Alert.alert('Required', 'Please select an issue type and describe the problem.');
      return;
    }
    setSubmitting(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const authUserId = sessionData.session?.user?.id ?? 'anonymous';
    const { queued } = await submitFeedback({
      type: 'issue',
      data: {
        user_id: authUserId,
        issue_type: issueType,
        screen_name: screenName,
        description,
        severity,
      },
    });
    setSubmitting(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    close();
    Alert.alert(
      'Reported',
      queued ? 'Saved offline — will sync when online.' : 'Issue reported. Thank you!'
    );
  };

  return (
    <>
      {/* Trigger button */}
      <TouchableOpacity
        onPress={open}
        style={[s.trigger, { backgroundColor: theme.cardBackground, borderColor: theme.cardBorder }]}
        accessibilityLabel="Report accessibility issue"
        accessibilityRole="button"
        accessibilityHint="Opens a quick form to report an accessibility problem on this screen"
      >
        <Ionicons name="flag-outline" size={16} color="#EF4444" />
        {!compact && <Text style={[s.triggerLabel, { color: '#EF4444' }]}>Report Issue</Text>}
      </TouchableOpacity>

      {/* Quick report sheet */}
      <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
        <View style={s.overlay}>
          <View style={[s.sheet, { backgroundColor: theme.cardBackground }]}>
            <View style={s.sheetHeader}>
              <Text style={[s.sheetTitle, { color: theme.textPrimary }]}>🚨 Report Accessibility Issue</Text>
              <TouchableOpacity onPress={close} accessibilityLabel="Close" accessibilityRole="button">
                <Ionicons name="close" size={22} color={theme.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={[s.screenTag, { backgroundColor: theme.inputBackground, color: theme.textSecondary }]}>
              Screen: {screenName}
            </Text>

            {/* Issue type chips */}
            <Text style={[s.label, { color: theme.textSecondary }]}>Issue type *</Text>
            <View style={s.chips}>
              {ISSUE_TYPES.map(o => (
                <TouchableOpacity
                  key={o.key}
                  style={[s.chip, {
                    borderColor: theme.cardBorder,
                    backgroundColor: issueType === o.key ? '#EF4444' : theme.inputBackground,
                  }]}
                  onPress={() => { setIssueType(o.key); Haptics.selectionAsync(); }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: issueType === o.key }}
                >
                  <Text style={[s.chipText, { color: issueType === o.key ? '#fff' : theme.textPrimary }]}>
                    {o.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Severity chips */}
            <Text style={[s.label, { color: theme.textSecondary, marginTop: 12 }]}>Severity</Text>
            <View style={s.chips}>
              {SEVERITIES.map(o => (
                <TouchableOpacity
                  key={o.key}
                  style={[s.chip, {
                    borderColor: theme.cardBorder,
                    backgroundColor: severity === o.key ? theme.accent : theme.inputBackground,
                  }]}
                  onPress={() => { setSeverity(o.key); Haptics.selectionAsync(); }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: severity === o.key }}
                >
                  <Text style={[s.chipText, { color: severity === o.key ? '#fff' : theme.textPrimary }]}>
                    {o.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Description */}
            <Text style={[s.label, { color: theme.textSecondary, marginTop: 12 }]}>Describe the issue *</Text>
            <TextInput
              style={[s.input, { color: theme.textPrimary, backgroundColor: theme.inputBackground, borderColor: theme.inputBorder }]}
              value={description}
              onChangeText={setDescription}
              placeholder="What happened? What did you expect?"
              placeholderTextColor={theme.textMuted}
              multiline
              numberOfLines={3}
              accessibilityLabel="Issue description"
            />

            <TouchableOpacity
              style={[s.submitBtn, { backgroundColor: submitting ? theme.textMuted : '#EF4444' }]}
              onPress={submit}
              disabled={submitting}
              accessibilityLabel="Submit issue report"
              accessibilityRole="button"
            >
              <Text style={s.submitText}>{submitting ? 'Sending...' : 'Report Issue'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
};

const s = StyleSheet.create({
  trigger: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1,
  },
  triggerLabel: { fontSize: 12, fontWeight: '600' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sheetTitle: { fontSize: 16, fontWeight: '700' },
  screenTag: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, fontSize: 12, marginBottom: 14 },
  label: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  chipText: { fontSize: 12, fontWeight: '500' },
  input: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, minHeight: 80, textAlignVertical: 'top', marginBottom: 16,
  },
  submitBtn: { paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});

export default FeedbackButton;
