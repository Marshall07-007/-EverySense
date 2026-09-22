/**
 * UsabilityRating.tsx
 * A lightweight modal that asks users to rate a completed task.
 * Drop this into any screen and call show() after a key user action.
 *
 * Usage:
 *   const ratingRef = useRef<UsabilityRatingRef>(null);
 *   ...
 *   ratingRef.current?.show('Create reminder by voice', 'Reminders');
 *   ...
 *   <UsabilityRating ref={ratingRef} />
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { forwardRef, useImperativeHandle, useMemo, useState } from 'react';
import {
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

export interface UsabilityRatingRef {
  show: (taskName: string, screenName: string) => void;
}

const DIFFICULTY_LABELS = ['', 'Very Easy', 'Easy', 'Neutral', 'Hard', 'Very Hard'];

const UsabilityRating = forwardRef<UsabilityRatingRef>((_, ref) => {
  const { state } = useApp();
  const theme = useMemo(() => getThemeConfig(state.accessibilitySettings.isDarkMode), [state.accessibilitySettings.isDarkMode]);

  const [visible, setVisible] = useState(false);
  const [taskName, setTaskName] = useState('');
  const [screenName, setScreenName] = useState('');
  const [success, setSuccess] = useState<boolean | null>(null);
  const [difficulty, setDifficulty] = useState(0);
  const [notes, setNotes] = useState('');
  const [startTime] = useState(Date.now());
  const [submitting, setSubmitting] = useState(false);

  useImperativeHandle(ref, () => ({
    show: (task: string, screen: string) => {
      setTaskName(task);
      setScreenName(screen);
      setSuccess(null);
      setDifficulty(0);
      setNotes('');
      setVisible(true);
    },
  }));

  const dismiss = () => setVisible(false);

  const submit = async () => {
    if (success === null || difficulty === 0) {
      return; // silent — user hasn't answered yet
    }
    setSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const { data: sessionData } = await supabase.auth.getSession();
    const authUserId = sessionData.session?.user?.id ?? 'anonymous';

    await submitFeedback({
      type: 'rating',
      data: {
        user_id: authUserId,
        task_name: taskName,
        screen_name: screenName,
        success,
        difficulty,
        time_seconds: Math.round((Date.now() - startTime) / 1000),
        notes: notes || undefined,
      },
    });

    setSubmitting(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    dismiss();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={dismiss}>
      <View style={s.overlay}>
        <View style={[s.card, { backgroundColor: theme.cardBackground }]}>
          {/* Header */}
          <View style={s.row}>
            <Text style={[s.title, { color: theme.textPrimary }]}>Quick Feedback</Text>
            <TouchableOpacity onPress={dismiss} accessibilityLabel="Skip rating" accessibilityRole="button">
              <Ionicons name="close" size={20} color={theme.textMuted} />
            </TouchableOpacity>
          </View>

          <Text style={[s.taskLabel, { color: theme.textSecondary }]}>{taskName}</Text>

          {/* Success / Failure */}
          <Text style={[s.question, { color: theme.textPrimary }]}>Did you complete this task?</Text>
          <View style={s.row}>
            {[true, false].map(val => (
              <TouchableOpacity
                key={String(val)}
                style={[s.outcomeBtn, {
                  borderColor: success === val ? (val ? '#22C55E' : '#EF4444') : theme.cardBorder,
                  backgroundColor: success === val ? (val ? '#22C55E' : '#EF4444') : theme.inputBackground,
                  flex: 1, marginHorizontal: 4,
                }]}
                onPress={() => { setSuccess(val); Haptics.selectionAsync(); }}
                accessibilityRole="radio"
                accessibilityState={{ selected: success === val }}
                accessibilityLabel={val ? 'Yes, completed' : 'No, could not complete'}
              >
                <Ionicons name={val ? 'checkmark-circle' : 'close-circle'} size={18} color={success === val ? '#fff' : theme.textMuted} />
                <Text style={[s.outcomeTxt, { color: success === val ? '#fff' : theme.textPrimary }]}>
                  {val ? 'Yes' : 'No'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Difficulty */}
          <Text style={[s.question, { color: theme.textPrimary, marginTop: 16 }]}>How difficult was it?</Text>
          <View style={[s.row, { justifyContent: 'space-between', marginTop: 6 }]}>
            {[1, 2, 3, 4, 5].map(d => (
              <TouchableOpacity
                key={d}
                style={[s.diffBtn, {
                  backgroundColor: difficulty === d ? theme.accent : theme.inputBackground,
                  borderColor: theme.cardBorder,
                }]}
                onPress={() => { setDifficulty(d); Haptics.selectionAsync(); }}
                accessibilityLabel={DIFFICULTY_LABELS[d]}
                accessibilityRole="radio"
                accessibilityState={{ selected: difficulty === d }}
              >
                <Text style={[s.diffNum, { color: difficulty === d ? '#fff' : theme.textPrimary }]}>{d}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={s.diffLabels}>
            <Text style={[s.diffHint, { color: theme.textMuted }]}>Easy</Text>
            <Text style={[s.diffHint, { color: theme.textMuted }]}>Hard</Text>
          </View>

          {/* Optional notes */}
          <TextInput
            style={[s.notes, { color: theme.textPrimary, backgroundColor: theme.inputBackground, borderColor: theme.inputBorder }]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Any comments? (optional)"
            placeholderTextColor={theme.textMuted}
            multiline
            accessibilityLabel="Optional comments"
          />

          <TouchableOpacity
            style={[s.submitBtn, {
              backgroundColor: (success !== null && difficulty > 0 && !submitting) ? theme.accent : theme.textMuted,
            }]}
            onPress={submit}
            disabled={success === null || difficulty === 0 || submitting}
            accessibilityLabel="Submit usability rating"
            accessibilityRole="button"
          >
            <Text style={s.submitTxt}>{submitting ? 'Saving...' : 'Submit Rating'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
});

UsabilityRating.displayName = 'UsabilityRating';

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  card: { borderRadius: 18, padding: 20, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, elevation: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 17, fontWeight: '700' },
  taskLabel: { fontSize: 13, marginTop: 4, marginBottom: 16 },
  question: { fontSize: 15, fontWeight: '600', marginBottom: 10 },
  outcomeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5,
  },
  outcomeTxt: { fontSize: 15, fontWeight: '600' },
  diffBtn: {
    width: 46, height: 46, borderRadius: 12, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  diffNum: { fontSize: 15, fontWeight: '700' },
  diffLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  diffHint: { fontSize: 11 },
  notes: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    fontSize: 14, minHeight: 60, textAlignVertical: 'top', marginTop: 14, marginBottom: 14,
  },
  submitBtn: { paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  submitTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
});

export default UsabilityRating;
