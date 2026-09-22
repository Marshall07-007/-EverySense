import { SafeAreaView } from 'react-native-safe-area-context';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Clipboard,
  Dimensions,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../lib/supabase';
import { useApp } from '../contexts/AppContext';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CHART_WIDTH = SCREEN_WIDTH - 48;

// ─── Types ────────────────────────────────────────────────────────────────────

interface CheckIn {
  id: string;
  mood: number;
  pain: number;
  energy: number;
  created_at: string;
}

// ─── Label helpers (matches CheckInScreen values) ─────────────────────────────

const MOOD_LABELS:   Record<number, string> = { 5: 'Great', 4: 'Good', 3: 'Okay', 2: 'Low', 1: 'Bad' };
const PAIN_LABELS:   Record<number, string> = { 0: 'None', 1: 'Mild', 2: 'Moderate', 3: 'Severe', 4: 'Crisis' };
const ENERGY_LABELS: Record<number, string> = { 3: 'High', 2: 'Normal', 1: 'Low', 0: 'Drained' };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function avg(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function moodEmoji(v: number) {
  return ['', '😢', '😔', '😐', '🙂', '😄'][v] ?? '😐';
}

function streak(data: CheckIn[]): number {
  if (!data.length) return 0;
  const sorted = [...data].sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  let count = 0;
  let expected = new Date();
  expected.setHours(0, 0, 0, 0);
  for (const ci of sorted) {
    const d = new Date(ci.created_at);
    d.setHours(0, 0, 0, 0);
    const diff = (expected.getTime() - d.getTime()) / 86400000;
    if (diff === 0 || diff === 1) {
      count++;
      expected = d;
    } else break;
  }
  return count;
}

function bestDayOfWeek(data: CheckIn[]): string {
  const dayMoods: Record<number, number[]> = {};
  data.forEach(ci => {
    const day = new Date(ci.created_at).getDay();
    if (!dayMoods[day]) dayMoods[day] = [];
    dayMoods[day].push(ci.mood);
  });
  let best = -1, bestAvg = -1;
  Object.entries(dayMoods).forEach(([day, moods]) => {
    const a = avg(moods);
    if (a > bestAvg) { bestAvg = a; best = Number(day); }
  });
  return best >= 0 ? DAYS[best] : '–';
}

// Last 7 days array (oldest → newest), filling missing days with 0
function last7Days(data: CheckIn[], field: 'mood' | 'pain' | 'energy'): { labels: string[]; values: number[] } {
  const labels: string[] = [];
  const values: number[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    labels.push(DAYS[d.getDay()]);
    const dayEntries = data.filter(ci => {
      const cd = new Date(ci.created_at);
      cd.setHours(0, 0, 0, 0);
      return cd.getTime() === d.getTime();
    });
    values.push(dayEntries.length ? avg(dayEntries.map(ci => ci[field])) : 0);
  }
  return { labels, values };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value, emoji, color, sub }: {
  label: string; value: string; emoji: string; color: string; sub?: string;
}) {
  return (
    <View style={[statStyles.card, { borderColor: color + '44' }]}>
      <View style={[statStyles.iconWrap, { backgroundColor: color + '22' }]}>
        <Text style={statStyles.emoji}>{emoji}</Text>
      </View>
      <Text style={[statStyles.value, { color }]}>{value}</Text>
      <Text style={statStyles.label}>{label}</Text>
      {sub ? <Text style={statStyles.sub}>{sub}</Text> : null}
    </View>
  );
}

const statStyles = StyleSheet.create({
  card: {
    flex: 1, alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 16, padding: 14, borderWidth: 1.5,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 6, elevation: 3,
  },
  iconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  emoji: { fontSize: 22 },
  value: { fontSize: 22, fontWeight: '800' },
  label: { fontSize: 11, color: '#6B7280', fontWeight: '600', marginTop: 2, textAlign: 'center' },
  sub:   { fontSize: 10, color: '#9CA3AF', marginTop: 2, textAlign: 'center' },
});

function MiniChart({ title, color, labels, data }: {
  title: string; color: string; labels: string[]; data: number[];
}) {
  const hasData = data.some(v => v > 0);
  return (
    <View style={chartStyles.wrap}>
      <Text style={chartStyles.title}>{title}</Text>
      {hasData ? (
        <LineChart
          data={{ labels, datasets: [{ data, color: () => color, strokeWidth: 2.5 }] }}
          width={CHART_WIDTH}
          height={160}
          chartConfig={{
            backgroundColor: '#fff',
            backgroundGradientFrom: '#fff',
            backgroundGradientTo: '#fff',
            decimalPlaces: 1,
            color: (opacity = 1) => color,
            labelColor: () => '#9CA3AF',
            propsForDots: { r: '4', strokeWidth: '2', stroke: color },
            propsForBackgroundLines: { stroke: '#F3F4F6' },
          }}
          bezier
          style={chartStyles.chart}
          withInnerLines={true}
          withOuterLines={false}
        />
      ) : (
        <View style={chartStyles.empty}>
          <Text style={chartStyles.emptyText}>No data for the last 7 days</Text>
        </View>
      )}
    </View>
  );
}

const chartStyles = StyleSheet.create({
  wrap: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 6, elevation: 3,
  },
  title: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 12 },
  chart: { borderRadius: 12, marginLeft: -16 },
  empty: { height: 100, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: '#9CA3AF', fontSize: 13 },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function HealthDashboardScreen() {
  const navigation = useNavigation();
  const { state }  = useApp();

  const [checkIns,   setCheckIns]   = useState<CheckIn[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [loadError,  setLoadError]  = useState(false);

  const load = useCallback(async () => {
    if (!state.user?.id) return;
    setLoadError(false);
    setLoading(true);
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const { data, error } = await supabase
        .from('check_ins')
        .select('*')
        .eq('user_id', state.user.id)
        .gte('created_at', thirtyDaysAgo.toISOString())
        .order('created_at', { ascending: true });
      if (error) throw error;
      setCheckIns(data ?? []);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [state.user?.id]);

  useEffect(() => { load(); }, [load]);

  // ── Computed stats ──────────────────────────────────────────────────────────
  const streakCount = streak(checkIns);

  const thisWeek = checkIns.filter(ci => {
    const d = new Date(ci.created_at);
    const diff = (Date.now() - d.getTime()) / 86400000;
    return diff <= 7;
  });
  const lastWeek = checkIns.filter(ci => {
    const d = new Date(ci.created_at);
    const diff = (Date.now() - d.getTime()) / 86400000;
    return diff > 7 && diff <= 14;
  });

  const avgMoodNow  = avg(thisWeek.map(c => c.mood));
  const avgMoodPrev = avg(lastWeek.map(c => c.mood));
  const avgPainNow  = avg(thisWeek.map(c => c.pain));
  const avgPainPrev = avg(lastWeek.map(c => c.pain));
  const avgEnergyNow = avg(thisWeek.map(c => c.energy));

  const moodTrend   = avgMoodNow > avgMoodPrev ? '↑' : avgMoodNow < avgMoodPrev ? '↓' : '–';
  const painTrend   = avgPainNow < avgPainPrev ? '↓' : avgPainNow > avgPainPrev ? '↑' : '–';

  const mood7   = last7Days(checkIns, 'mood');
  const pain7   = last7Days(checkIns, 'pain');
  const energy7 = last7Days(checkIns, 'energy');

  const bestDay = bestDayOfWeek(checkIns);

  // ── Insight message ─────────────────────────────────────────────────────────
  const insightLines: string[] = [];
  if (thisWeek.length === 0) {
    insightLines.push('No check-ins this week. Start one from the Check-In tab!');
  } else {
    if (moodTrend === '↑') insightLines.push('😊 Your mood has improved compared to last week!');
    if (moodTrend === '↓') insightLines.push('💙 Your mood has been lower this week. You\'re not alone.');
    if (painTrend === '↓') insightLines.push('🎉 Your pain levels have been lower this week — great progress!');
    if (painTrend === '↑') insightLines.push('💊 Pain has increased this week. Consider checking in with your doctor.');
    if (bestDay !== '–')   insightLines.push(`📅 You tend to feel best on ${bestDay}s.`);
  }

  // ── Doctor report ───────────────────────────────────────────────────────────
  const generateReport = () => {
    if (!checkIns.length) {
      Alert.alert('No Data', 'Complete some check-ins first to generate a report.');
      return;
    }
    const report =
      `EverySense Health Summary — Last 30 Days\n` +
      `Generated: ${new Date().toLocaleDateString()}\n\n` +
      `Check-ins completed: ${checkIns.length}\n` +
      `Current streak: ${streakCount} day${streakCount !== 1 ? 's' : ''}\n\n` +
      `This week averages:\n` +
      `• Mood:   ${avgMoodNow > 0 ? MOOD_LABELS[Math.round(avgMoodNow)] : 'N/A'} (${avgMoodNow.toFixed(1)}/5)\n` +
      `• Pain:   ${avgPainNow >= 0 ? PAIN_LABELS[Math.round(avgPainNow)] : 'N/A'} (${avgPainNow.toFixed(1)}/4)\n` +
      `• Energy: ${avgEnergyNow >= 0 ? ENERGY_LABELS[Math.round(avgEnergyNow)] : 'N/A'} (${avgEnergyNow.toFixed(1)}/3)\n\n` +
      `Mood trend vs last week: ${moodTrend === '↑' ? 'Improved' : moodTrend === '↓' ? 'Declined' : 'Stable'}\n` +
      `Pain trend vs last week: ${painTrend === '↓' ? 'Improved' : painTrend === '↑' ? 'Worsened' : 'Stable'}\n\n` +
      `Best day of the week: ${bestDay}\n\n` +
      `— Generated by EverySense`;

    Share.share({ message: report, title: 'Health Summary' }).catch(() => {
      Clipboard.setString(report);
      Alert.alert('Copied!', 'Report copied to clipboard.');
    });
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.root}>

      {/* Header */}
      <LinearGradient colors={['#4C1D95', '#7C3AED']} style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>Health Dashboard</Text>
          <Text style={styles.headerSub}>Last 30 days</Text>
        </View>
        <TouchableOpacity onPress={load} style={styles.refreshBtn}>
          <Ionicons name="refresh" size={20} color="#fff" />
        </TouchableOpacity>
      </LinearGradient>

      {loading ? (
        <View style={styles.centred}>
          <ActivityIndicator size="large" color="#7C3AED" />
          <Text style={styles.loadingText}>Loading your health data…</Text>
        </View>
      ) : loadError ? (
        <View style={styles.centred}>
          <Text style={styles.errorEmoji}>⚠️</Text>
          <Text style={styles.errorTitle}>Could not load health data</Text>
          <Text style={styles.errorSub}>Check your connection and try again.</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={load}>
            <Ionicons name="refresh" size={16} color="#fff" />
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

          {/* Streak banner */}
          <LinearGradient colors={['#7C3AED', '#A855F7']} style={styles.streakBanner}>
            <Text style={styles.streakEmoji}>🔥</Text>
            <View>
              <Text style={styles.streakCount}>{streakCount} day streak</Text>
              <Text style={styles.streakSub}>
                {streakCount === 0
                  ? 'Start your streak today!'
                  : streakCount >= 7
                  ? 'Amazing consistency! Keep it up!'
                  : 'Keep checking in daily!'}
              </Text>
            </View>
            <View style={styles.streakBadge}>
              <Text style={styles.streakBadgeText}>{checkIns.length} total</Text>
            </View>
          </LinearGradient>

          {/* Summary cards */}
          <Text style={styles.sectionTitle}>This Week</Text>
          <View style={styles.statRow}>
            <StatCard
              label="Mood"
              value={avgMoodNow > 0 ? moodEmoji(Math.round(avgMoodNow)) : '–'}
              emoji="😊"
              color="#7C3AED"
              sub={avgMoodNow > 0 ? `${MOOD_LABELS[Math.round(avgMoodNow)]} ${moodTrend}` : 'No data'}
            />
            <StatCard
              label="Pain"
              value={thisWeek.length > 0 ? avgPainNow.toFixed(1) : '–'}
              emoji="💊"
              color="#EF4444"
              sub={thisWeek.length > 0 ? `${PAIN_LABELS[Math.round(avgPainNow)]} ${painTrend}` : 'No data'}
            />
            <StatCard
              label="Energy"
              value={thisWeek.length > 0 ? avgEnergyNow.toFixed(1) : '–'}
              emoji="⚡"
              color="#F59E0B"
              sub={thisWeek.length > 0 ? ENERGY_LABELS[Math.round(avgEnergyNow)] : 'No data'}
            />
          </View>

          {/* Insights */}
          {insightLines.length > 0 && (
            <View style={styles.insightCard}>
              <Text style={styles.insightTitle}>💡 Insights</Text>
              {insightLines.map((line, i) => (
                <Text key={i} style={styles.insightLine}>{line}</Text>
              ))}
            </View>
          )}

          {/* Charts */}
          <Text style={styles.sectionTitle}>Last 7 Days</Text>
          <MiniChart title="😊 Mood" color="#7C3AED" labels={mood7.labels} data={mood7.values} />
          <MiniChart title="💊 Pain Level" color="#EF4444" labels={pain7.labels} data={pain7.values} />
          <MiniChart title="⚡ Energy" color="#F59E0B" labels={energy7.labels} data={energy7.values} />

          {/* Doctor report */}
          <TouchableOpacity style={styles.reportBtn} onPress={generateReport}>
            <LinearGradient colors={['#4C1D95', '#7C3AED']} style={styles.reportGrad}>
              <Ionicons name="document-text-outline" size={20} color="#fff" />
              <Text style={styles.reportText}>Generate Check In Report</Text>
              <Ionicons name="share-outline" size={18} color="rgba(255,255,255,0.7)" />
            </LinearGradient>
          </TouchableOpacity>

          <View style={{ height: 32 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F9FAFB' },

  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  backBtn: { padding: 4 },
  refreshBtn: { padding: 4 },
  headerText: { flex: 1 },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  headerSub: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },

  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: '#6B7280', fontSize: 14 },
  errorEmoji: { fontSize: 48 },
  errorTitle: { color: '#111827', fontSize: 16, fontWeight: '700' },
  errorSub:   { color: '#6B7280', fontSize: 13, textAlign: 'center', paddingHorizontal: 32 },
  retryBtn:   { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#7C3AED', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, marginTop: 4 },
  retryText:  { color: '#fff', fontSize: 14, fontWeight: '700' },

  scroll: { padding: 16, paddingTop: 20 },

  streakBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderRadius: 18, padding: 18, marginBottom: 24,
  },
  streakEmoji: { fontSize: 36 },
  streakCount: { color: '#fff', fontSize: 20, fontWeight: '800' },
  streakSub:   { color: 'rgba(255,255,255,0.75)', fontSize: 12, marginTop: 2 },
  streakBadge: {
    marginLeft: 'auto', backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4,
  },
  streakBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  sectionTitle: { fontSize: 17, fontWeight: '700', color: '#111827', marginBottom: 12 },

  statRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },

  insightCard: {
    backgroundColor: '#FFF7ED', borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: '#FED7AA', marginBottom: 20, gap: 8,
  },
  insightTitle: { fontSize: 14, fontWeight: '700', color: '#92400E' },
  insightLine:  { fontSize: 13, color: '#78350F', lineHeight: 20 },

  reportBtn: { borderRadius: 16, overflow: 'hidden', marginTop: 8 },
  reportGrad: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingVertical: 16, paddingHorizontal: 20,
  },
  reportText: { color: '#fff', fontSize: 16, fontWeight: '700', flex: 1, textAlign: 'center' },
});
