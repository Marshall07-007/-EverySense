import { SafeAreaView } from 'react-native-safe-area-context';
/**
 * OnboardingScreen.tsx
 * Shown once after first sign-up. 4 slides introducing key features.
 */

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import React, { useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useApp } from '../contexts/AppContext';

const { width } = Dimensions.get('window');

// ─── Slide data ───────────────────────────────────────────────────────────────

const SLIDES = [
  {
    id: '1',
    emoji: '👋',
    title: 'Welcome to EverySense',
    description: 'Your personal health & accessibility companion — designed to make everyday life easier for people with disabilities.',
    gradient: ['#667eea', '#764ba2'],
    accent: '#a78bfa',
  },
  {
    id: '2',
    emoji: '⏰',
    title: 'Smart Reminders',
    description: 'Never miss a medication, therapy session, or doctor appointment. Set voice-powered reminders with one tap.',
    gradient: ['#f093fb', '#f5576c'],
    accent: '#fca5a5',
  },
  {
    id: '3',
    emoji: '✦',
    title: 'AI Health Assistant',
    description: 'Ask our AI anything about your health, medications, or disability rights. Even send a photo and get instant explanations.',
    gradient: ['#4facfe', '#00f2fe'],
    accent: '#7dd3fc',
  },
  {
    id: '4',
    emoji: '💚',
    title: 'Daily Check-Ins',
    description: 'Track your mood, pain, and energy every day. Build a health history you can share with your doctor.',
    gradient: ['#43e97b', '#38f9d7'],
    accent: '#6ee7b7',
  },
  {
    id: '5',
    emoji: '🤝',
    title: 'Community',
    description: 'Connect with others on a similar journey. Discover people, share experiences, and chat with your connections.',
    gradient: ['#fa709a', '#fee140'],
    accent: '#fde68a',
  },
];

// ─── Dot indicator ────────────────────────────────────────────────────────────

const Dots = ({ current, total, accent }: { current: number; total: number; accent: string }) => (
  <View style={dotStyles.row}>
    {Array.from({ length: total }).map((_, i) => (
      <View
        key={i}
        style={[
          dotStyles.dot,
          i === current
            ? { width: 24, backgroundColor: '#fff' }
            : { width: 8, backgroundColor: 'rgba(255,255,255,0.4)' },
        ]}
      />
    ))}
  </View>
);

const dotStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { height: 8, borderRadius: 4 },
});

// ─── Main screen ──────────────────────────────────────────────────────────────

const OnboardingScreen = () => {
  const { dispatch } = useApp();
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const current = SLIDES[currentIndex];

  const goToNext = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (currentIndex < SLIDES.length - 1) {
      Animated.sequence([
        Animated.timing(fadeAnim, { toValue: 0.7, duration: 100, useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();

      const next = currentIndex + 1;
      setCurrentIndex(next);
      flatListRef.current?.scrollToIndex({ index: next, animated: true });
    } else {
      finish();
    }
  };

  const finish = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    dispatch({ type: 'COMPLETE_ONBOARDING' });
  };

  const isLast = currentIndex === SLIDES.length - 1;

  return (
    <LinearGradient colors={current.gradient as any} style={styles.container}>
      <SafeAreaView style={styles.safe}>

        {/* Skip button */}
        <View style={styles.topBar}>
          <TouchableOpacity onPress={finish} style={styles.skipBtn} accessibilityLabel="Skip onboarding">
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
        </View>

        {/* Slide content */}
        <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
          {/* Icon */}
          <View style={[styles.iconWrap, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
            {current.id === '3' ? (
              <Text style={styles.sparkle}>✦</Text>
            ) : (
              <Text style={styles.emoji}>{current.emoji}</Text>
            )}
          </View>

          {/* Feature icon strip */}
          {currentIndex === 0 && (
            <View style={styles.featureRow}>
              {[
                { icon: 'alarm-outline',    label: 'Reminders' },
                { icon: 'sparkles-outline', label: 'AI Chat' },
                { icon: 'heart-outline',    label: 'Check-ins' },
                { icon: 'people-outline',   label: 'Community' },
              ].map(f => (
                <View key={f.label} style={styles.featureItem}>
                  <View style={styles.featureIcon}>
                    <Ionicons name={f.icon as any} size={20} color="#fff" />
                  </View>
                  <Text style={styles.featureLabel}>{f.label}</Text>
                </View>
              ))}
            </View>
          )}

          <Text style={styles.title}>{current.title}</Text>
          <Text style={styles.description}>{current.description}</Text>
        </Animated.View>

        {/* Bottom controls */}
        <View style={styles.bottom}>
          <Dots current={currentIndex} total={SLIDES.length} accent={current.accent} />

          <TouchableOpacity
            style={styles.nextBtn}
            onPress={goToNext}
            accessibilityRole="button"
            accessibilityLabel={isLast ? 'Get started' : 'Next'}
          >
            {isLast ? (
              <Text style={styles.nextBtnText}>Get Started</Text>
            ) : (
              <Ionicons name="arrow-forward" size={30} color={current.gradient[0]} />
            )}
          </TouchableOpacity>
        </View>

      </SafeAreaView>
    </LinearGradient>
  );
};

export default OnboardingScreen;

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe:      { flex: 1 },

  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  skipBtn:  { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.35)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.8)' },
  skipText: { color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: 0.5 },

  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 0,
  },

  iconWrap: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
  },
  emoji:   { fontSize: 56 },
  sparkle: { fontSize: 52, color: '#fff' },

  featureRow: {
    flexDirection: 'row',
    gap: 20,
    marginBottom: 32,
  },
  featureItem: { alignItems: 'center', gap: 6 },
  featureIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '600' },

  title: {
    fontSize: 30,
    fontWeight: '800',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 36,
  },
  description: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
    lineHeight: 24,
  },

  bottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 32,
    paddingBottom: 32,
    paddingTop: 16,
  },

  nextBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  nextBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1F2933',
    textAlign: 'center',
    paddingHorizontal: 4,
  },
});
