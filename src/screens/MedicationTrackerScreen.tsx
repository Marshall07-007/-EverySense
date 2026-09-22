import { SafeAreaView } from 'react-native-safe-area-context';
/**
 * MedicationTrackerScreen.tsx
 * Track daily medications — add, mark as taken, view history.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import * as Speech from 'expo-speech';
import { speakText as ttsSpeakText, stopSpeaking as ttsStopSpeaking } from '../services/ttsService';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Modal,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { getThemeConfig } from '../../constants/theme';
import { useApp } from '../contexts/AppContext';
import { supabase } from '../../lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

type Frequency = 'daily' | 'twice_daily' | 'weekly' | 'as_needed';

interface Medication {
  id: string;
  name: string;
  dose: string;
  frequency: Frequency;
  time_of_day: string;
  notes: string;
  is_active: boolean;
}

interface MedLog {
  id: string;
  medication_id: string;
  scheduled_date: string;
  taken_at: string | null;
  was_missed: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FREQ_LABELS: Record<Frequency, string> = {
  daily:       'Once daily',
  twice_daily: 'Twice daily',
  weekly:      'Weekly',
  as_needed:   'As needed',
};

const FREQ_OPTIONS: Frequency[] = ['daily', 'twice_daily', 'weekly', 'as_needed'];

const todayStr = () => new Date().toISOString().split('T')[0];

const fmt12h = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12  = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
};

const adherencePct = (taken: number, total: number) =>
  total === 0 ? 100 : Math.round((taken / total) * 100);

// ─── Default form state ───────────────────────────────────────────────────────

const EMPTY_FORM = { name: '', dose: '', frequency: 'daily' as Frequency, time_of_day: '08:00', notes: '' };

// ─── Main Screen ──────────────────────────────────────────────────────────────

const MedicationTrackerScreen = ({ navigation }: { navigation: any }) => {
  const { state } = useApp();
  const isDark = state.accessibilitySettings.isDarkMode;
  const theme  = useMemo(() => getThemeConfig(isDark), [isDark]);

  const [meds,       setMeds]       = useState<Medication[]>([]);
  const [logs,       setLogs]       = useState<MedLog[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [savingId,   setSavingId]   = useState<string | null>(null);
  const [showModal,  setShowModal]  = useState(false);
  const [editTarget, setEditTarget] = useState<Medication | null>(null);
  const [form,       setForm]       = useState({ ...EMPTY_FORM });
  const [formSaving, setFormSaving] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;

  const userId = state.user?.id;

  const speak = useCallback((text: string) => {
    if (!state.voiceAnnouncementsEnabled) return;
    ttsSpeakText(text, { rate: state.accessibilitySettings.voiceSpeed });
  }, [state.voiceAnnouncementsEnabled, state.accessibilitySettings.voiceSpeed]);

  // ── Load data ──────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [medsRes, logsRes] = await Promise.all([
        supabase
          .from('medications')
          .select('*')
          .eq('user_id', userId)
          .eq('is_active', true)
          .order('time_of_day'),
        supabase
          .from('medication_logs')
          .select('*')
          .eq('user_id', userId)
          .eq('scheduled_date', todayStr()),
      ]);

      if (medsRes.data)  setMeds(medsRes.data as Medication[]);
      if (logsRes.data)  setLogs(logsRes.data as MedLog[]);
    } catch (e) {
      console.warn('MedicationTracker: load failed', e);
    } finally {
      setLoading(false);
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    }
  }, [userId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Today's status helpers ─────────────────────────────────────────────────

  const logFor = useCallback((medId: string) =>
    logs.find(l => l.medication_id === medId), [logs]);

  const isTaken = useCallback((medId: string) =>
    !!logFor(medId)?.taken_at, [logFor]);

  // ── Mark taken ─────────────────────────────────────────────────────────────

  const markTaken = useCallback(async (med: Medication) => {
    if (!userId) return;
    if (isTaken(med.id)) {
      speak(`${med.name} already marked as taken`);
      return;
    }
    setSavingId(med.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const today = todayStr();
      const now   = new Date().toISOString();

      const existing = logFor(med.id);
      if (existing) {
        await supabase
          .from('medication_logs')
          .update({ taken_at: now, was_missed: false })
          .eq('id', existing.id);
        setLogs(prev => prev.map(l => l.id === existing.id ? { ...l, taken_at: now, was_missed: false } : l));
      } else {
        const { data } = await supabase
          .from('medication_logs')
          .insert({ user_id: userId, medication_id: med.id, scheduled_date: today, taken_at: now, was_missed: false })
          .select()
          .single();
        if (data) setLogs(prev => [...prev, data as MedLog]);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      speak(`${med.name} marked as taken`);
    } catch (e) {
      Alert.alert('Error', 'Could not save. Please try again.');
    } finally {
      setSavingId(null);
    }
  }, [userId, isTaken, logFor, speak]);

  // ── Undo taken ─────────────────────────────────────────────────────────────

  const undoTaken = useCallback(async (med: Medication) => {
    const log = logFor(med.id);
    if (!log) return;
    setSavingId(med.id);
    try {
      await supabase.from('medication_logs').update({ taken_at: null }).eq('id', log.id);
      setLogs(prev => prev.map(l => l.id === log.id ? { ...l, taken_at: null } : l));
      speak(`${med.name} unmarked`);
    } catch {
      Alert.alert('Error', 'Could not undo. Please try again.');
    } finally {
      setSavingId(null);
    }
  }, [logFor, speak]);

  // ── Save medication ────────────────────────────────────────────────────────

  const saveMedication = useCallback(async () => {
    if (!form.name.trim()) { Alert.alert('Required', 'Please enter the medication name.'); return; }
    if (!form.dose.trim()) { Alert.alert('Required', 'Please enter the dose.'); return; }
    if (!userId) return;
    setFormSaving(true);
    try {
      if (editTarget) {
        const { data } = await supabase
          .from('medications')
          .update({ name: form.name.trim(), dose: form.dose.trim(), frequency: form.frequency, time_of_day: form.time_of_day, notes: form.notes.trim() })
          .eq('id', editTarget.id)
          .select()
          .single();
        if (data) setMeds(prev => prev.map(m => m.id === editTarget.id ? data as Medication : m));
        speak(`${form.name} updated`);
      } else {
        const { data } = await supabase
          .from('medications')
          .insert({ user_id: userId, name: form.name.trim(), dose: form.dose.trim(), frequency: form.frequency, time_of_day: form.time_of_day, notes: form.notes.trim() })
          .select()
          .single();
        if (data) setMeds(prev => [...prev, data as Medication].sort((a, b) => a.time_of_day.localeCompare(b.time_of_day)));
        speak(`${form.name} added`);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowModal(false);
      setForm({ ...EMPTY_FORM });
      setEditTarget(null);
    } catch {
      Alert.alert('Error', 'Could not save medication. Please try again.');
    } finally {
      setFormSaving(false);
    }
  }, [form, editTarget, userId, speak]);

  // ── Delete medication ──────────────────────────────────────────────────────

  const deleteMedication = useCallback((med: Medication) => {
    Alert.alert('Remove Medication', `Remove ${med.name} from your list?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          try {
            await supabase.from('medications').update({ is_active: false }).eq('id', med.id);
            setMeds(prev => prev.filter(m => m.id !== med.id));
            speak(`${med.name} removed`);
          } catch { Alert.alert('Error', 'Could not remove medication.'); }
        },
      },
    ]);
  }, [speak]);

  // ── Open edit modal ────────────────────────────────────────────────────────

  const openEdit = useCallback((med: Medication) => {
    setEditTarget(med);
    setForm({ name: med.name, dose: med.dose, frequency: med.frequency, time_of_day: med.time_of_day, notes: med.notes });
    setShowModal(true);
  }, []);

  const openAdd = useCallback(() => {
    setEditTarget(null);
    setForm({ ...EMPTY_FORM });
    setShowModal(true);
  }, []);

  // ── Stats ──────────────────────────────────────────────────────────────────

  const scheduledMeds = meds.filter(m => m.frequency !== 'as_needed');
  const takenToday    = logs.filter(l => l.taken_at && scheduledMeds.some(m => m.id === l.medication_id)).length;
  const totalToday    = scheduledMeds.length;
  const pct           = adherencePct(takenToday, totalToday);

  // ── Theme helpers ──────────────────────────────────────────────────────────

  const bg       = isDark ? '#0d1117' : '#f5f5f7';
  const cardBg   = isDark ? '#161b22' : '#ffffff';
  const border   = isDark ? '#30363d' : '#e5e7eb';
  const muted    = theme.textMuted;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: bg }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {/* ── Header ── */}
      <View style={[s.header, { backgroundColor: cardBg, borderBottomColor: border }]}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: theme.textPrimary }]}>Medications</Text>
        <TouchableOpacity style={s.addBtn} onPress={openAdd} accessibilityLabel="Add medication">
          <Ionicons name="add" size={24} color={theme.accent} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={theme.accent} />
          <Text style={[s.loadingText, { color: muted }]}>Loading medications…</Text>
        </View>
      ) : (
        <Animated.ScrollView
          style={{ opacity: fadeAnim }}
          contentContainerStyle={[s.scroll, { backgroundColor: bg }]}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Summary banner ── */}
          <LinearGradient
            colors={pct === 100 ? ['#10b981', '#059669'] : pct >= 50 ? ['#7C3AED', '#A855F7'] : ['#f59e0b', '#d97706']}
            style={s.banner}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          >
            <View style={s.bannerLeft}>
              <Text style={s.bannerPct}>{pct}%</Text>
              <Text style={s.bannerLabel}>Today's adherence</Text>
            </View>
            <View style={s.bannerRight}>
              <Text style={s.bannerCount}>{takenToday} / {totalToday}</Text>
              <Text style={s.bannerSub}>doses taken</Text>
            </View>
            <View style={s.bannerIcon}>
              <Text style={{ fontSize: 36 }}>
                {pct === 100 ? '🎉' : pct >= 50 ? '💊' : '⏰'}
              </Text>
            </View>
          </LinearGradient>

          {/* ── Today's medications ── */}
          <Text style={[s.sectionLabel, { color: muted }]}>TODAY'S MEDICATIONS</Text>

          {meds.length === 0 ? (
            <View style={[s.emptyCard, { backgroundColor: cardBg, borderColor: border }]}>
              <Text style={{ fontSize: 40, marginBottom: 12 }}>💊</Text>
              <Text style={[s.emptyTitle, { color: theme.textPrimary }]}>No medications yet</Text>
              <Text style={[s.emptySub, { color: muted }]}>Tap + to add your first medication</Text>
              <TouchableOpacity
                style={[s.emptyBtn, { backgroundColor: theme.accent }]}
                onPress={openAdd}
              >
                <Ionicons name="add" size={18} color="#fff" />
                <Text style={s.emptyBtnText}>Add Medication</Text>
              </TouchableOpacity>
            </View>
          ) : (
            meds.map((med) => {
              const taken   = isTaken(med.id);
              const takenAt = logFor(med.id)?.taken_at ?? null;
              const saving  = savingId === med.id;
              return (
                <View
                  key={med.id}
                  style={[s.medCard, { backgroundColor: cardBg, borderColor: taken ? '#10b981' : border }]}
                >
                  {/* Left colour bar */}
                  <View style={[s.medBar, { backgroundColor: taken ? '#10b981' : theme.accent }]} />

                  <View style={s.medBody}>
                    <View style={s.medTop}>
                      <View style={s.medInfo}>
                        <Text style={[s.medName, { color: theme.textPrimary }]}>{med.name}</Text>
                        <Text style={[s.medDose, { color: muted }]}>{med.dose} · {FREQ_LABELS[med.frequency]}</Text>
                        <View style={s.medTimePill}>
                          <Ionicons name="time-outline" size={12} color={muted} />
                          <Text style={[s.medTime, { color: muted }]}>{fmt12h(med.time_of_day)}</Text>
                        </View>
                        {med.notes ? <Text style={[s.medNotes, { color: muted }]} numberOfLines={1}>{med.notes}</Text> : null}
                      </View>

                      {/* Take / Taken button */}
                      <TouchableOpacity
                        onPress={() => taken ? undoTaken(med) : markTaken(med)}
                        disabled={saving}
                        style={[s.takeBtn, { backgroundColor: taken ? '#10b981' : theme.accent }]}
                        accessibilityLabel={taken ? `Undo ${med.name}` : `Mark ${med.name} as taken`}
                      >
                        {saving
                          ? <ActivityIndicator size="small" color="#fff" />
                          : <Ionicons name={taken ? 'checkmark' : 'add'} size={22} color="#fff" />}
                      </TouchableOpacity>
                    </View>

                    {takenAt && (
                      <View style={s.takenRow}>
                        <Ionicons name="checkmark-circle" size={14} color="#10b981" />
                        <Text style={[s.takenText, { color: '#10b981' }]}>
                          Taken at {new Date(takenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Edit / Delete actions */}
                  <View style={[s.medActions, { borderTopColor: border }]}>
                    <TouchableOpacity style={s.medActionBtn} onPress={() => openEdit(med)}>
                      <Ionicons name="create-outline" size={16} color={theme.accent} />
                      <Text style={[s.medActionText, { color: theme.accent }]}>Edit</Text>
                    </TouchableOpacity>
                    <View style={[s.medActionDiv, { backgroundColor: border }]} />
                    <TouchableOpacity style={s.medActionBtn} onPress={() => deleteMedication(med)}>
                      <Ionicons name="trash-outline" size={16} color="#ef4444" />
                      <Text style={[s.medActionText, { color: '#ef4444' }]}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}

          <View style={{ height: 40 }} />
        </Animated.ScrollView>
      )}

      {/* ── Add / Edit Modal ── */}
      <Modal visible={showModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowModal(false)}>
        <SafeAreaView style={[s.modal, { backgroundColor: isDark ? '#0d1117' : '#f5f5f7' }]}>
          {/* Modal header */}
          <View style={[s.modalHeader, { backgroundColor: cardBg, borderBottomColor: border }]}>
            <TouchableOpacity onPress={() => { setShowModal(false); setEditTarget(null); setForm({ ...EMPTY_FORM }); }}>
              <Text style={[s.modalCancel, { color: muted }]}>Cancel</Text>
            </TouchableOpacity>
            <Text style={[s.modalTitle, { color: theme.textPrimary }]}>
              {editTarget ? 'Edit Medication' : 'Add Medication'}
            </Text>
            <TouchableOpacity onPress={saveMedication} disabled={formSaving}>
              {formSaving
                ? <ActivityIndicator size="small" color={theme.accent} />
                : <Text style={[s.modalSave, { color: '#10b981' }]}>Save</Text>}
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={s.modalScroll} keyboardShouldPersistTaps="handled">
            {/* Name */}
            <Text style={[s.fieldLabel, { color: muted }]}>MEDICATION NAME *</Text>
            <View style={[s.fieldWrap, { backgroundColor: cardBg, borderColor: border }]}>
              <TextInput
                style={[s.fieldInput, { color: theme.textPrimary }]}
                value={form.name}
                onChangeText={t => setForm(p => ({ ...p, name: t }))}
                placeholder="e.g. Metformin"
                placeholderTextColor={muted}
              />
            </View>

            {/* Dose */}
            <Text style={[s.fieldLabel, { color: muted }]}>DOSE *</Text>
            <View style={[s.fieldWrap, { backgroundColor: cardBg, borderColor: border }]}>
              <TextInput
                style={[s.fieldInput, { color: theme.textPrimary }]}
                value={form.dose}
                onChangeText={t => setForm(p => ({ ...p, dose: t }))}
                placeholder="e.g. 500mg"
                placeholderTextColor={muted}
              />
            </View>

            {/* Frequency */}
            <Text style={[s.fieldLabel, { color: muted }]}>FREQUENCY</Text>
            <View style={s.freqRow}>
              {FREQ_OPTIONS.map(f => (
                <TouchableOpacity
                  key={f}
                  style={[s.freqChip, { borderColor: form.frequency === f ? theme.accent : border, backgroundColor: form.frequency === f ? theme.accent + '22' : cardBg }]}
                  onPress={() => setForm(p => ({ ...p, frequency: f }))}
                >
                  <Text style={[s.freqChipText, { color: form.frequency === f ? theme.accent : theme.textPrimary }]}>
                    {FREQ_LABELS[f]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Time */}
            <Text style={[s.fieldLabel, { color: muted }]}>TIME OF DAY</Text>
            <View style={s.timeRow}>
              {['06:00','08:00','10:00','12:00','14:00','18:00','20:00','22:00'].map(t => (
                <TouchableOpacity
                  key={t}
                  style={[s.timeChip, { borderColor: form.time_of_day === t ? theme.accent : border, backgroundColor: form.time_of_day === t ? theme.accent + '22' : cardBg }]}
                  onPress={() => setForm(p => ({ ...p, time_of_day: t }))}
                >
                  <Text style={[s.timeChipText, { color: form.time_of_day === t ? theme.accent : theme.textPrimary }]}>
                    {fmt12h(t)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Notes */}
            <Text style={[s.fieldLabel, { color: muted }]}>NOTES (optional)</Text>
            <View style={[s.fieldWrap, { backgroundColor: cardBg, borderColor: border }]}>
              <TextInput
                style={[s.fieldInput, s.fieldInputMulti, { color: theme.textPrimary }]}
                value={form.notes}
                onChangeText={t => setForm(p => ({ ...p, notes: t }))}
                placeholder="e.g. Take with food"
                placeholderTextColor={muted}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>

            <View style={{ height: 40 }} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
};

export default MedicationTrackerScreen;

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe:   { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 14 },

  // Header
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1 },
  backBtn:     { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  addBtn:      { padding: 4 },

  scroll: { paddingHorizontal: 16, paddingTop: 16 },

  // Banner
  banner:      { borderRadius: 18, padding: 20, flexDirection: 'row', alignItems: 'center', marginBottom: 24, overflow: 'hidden' },
  bannerLeft:  { flex: 1 },
  bannerPct:   { fontSize: 36, fontWeight: '800', color: '#fff' },
  bannerLabel: { fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  bannerRight: { alignItems: 'center', marginHorizontal: 16 },
  bannerCount: { fontSize: 22, fontWeight: '700', color: '#fff' },
  bannerSub:   { fontSize: 11, color: 'rgba(255,255,255,0.8)' },
  bannerIcon:  {},

  // Section label
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10 },

  // Empty state
  emptyCard:  { borderRadius: 18, borderWidth: 1, padding: 32, alignItems: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 17, fontWeight: '700', marginBottom: 6 },
  emptySub:   { fontSize: 13, textAlign: 'center', marginBottom: 20 },
  emptyBtn:   { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12 },
  emptyBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  // Med card
  medCard:    { borderRadius: 16, borderWidth: 1.5, marginBottom: 12, overflow: 'hidden' },
  medBar:     { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  medBody:    { paddingLeft: 16, paddingRight: 12, paddingTop: 14, paddingBottom: 10 },
  medTop:     { flexDirection: 'row', alignItems: 'flex-start' },
  medInfo:    { flex: 1, paddingRight: 12 },
  medName:    { fontSize: 16, fontWeight: '700', marginBottom: 3 },
  medDose:    { fontSize: 13, marginBottom: 4 },
  medTimePill:{ flexDirection: 'row', alignItems: 'center', gap: 4 },
  medTime:    { fontSize: 12 },
  medNotes:   { fontSize: 12, marginTop: 4, fontStyle: 'italic' },
  takeBtn:    { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 4, elevation: 3 },
  takenRow:   { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  takenText:  { fontSize: 12, fontWeight: '600' },

  // Card actions
  medActions:  { flexDirection: 'row', borderTopWidth: 1, marginTop: 10 },
  medActionBtn:{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 10 },
  medActionDiv:{ width: 1, marginVertical: 6 },
  medActionText:{ fontSize: 13, fontWeight: '600' },

  // Modal
  modal:       { flex: 1 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1 },
  modalCancel: { fontSize: 15 },
  modalTitle:  { fontSize: 17, fontWeight: '700' },
  modalSave:   { fontSize: 15, fontWeight: '700' },
  modalScroll: { paddingHorizontal: 20, paddingTop: 20 },

  // Form fields
  fieldLabel:  { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8, marginTop: 18 },
  fieldWrap:   { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 14 : 4 },
  fieldInput:  { fontSize: 15 },
  fieldInputMulti: { minHeight: 80, textAlignVertical: 'top', paddingTop: 8 },

  // Frequency chips
  freqRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  freqChip:    { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1.5 },
  freqChipText:{ fontSize: 13, fontWeight: '600' },

  // Time chips
  timeRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  timeChip:    { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5 },
  timeChipText:{ fontSize: 13, fontWeight: '600' },
});
