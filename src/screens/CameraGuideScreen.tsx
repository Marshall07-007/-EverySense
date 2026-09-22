import { SafeAreaView } from 'react-native-safe-area-context';
/**
 * CameraGuideScreen.tsx
 * AI-powered camera accessibility guide.
 * Captures frames from the live camera and describes obstacles,
 * paths, ramps, and accessibility features using the Groq vision API.
 */

import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as ImageManipulator from 'expo-image-manipulator';
import { LinearGradient } from 'expo-linear-gradient';
import * as Speech from 'expo-speech';
import { speakText as ttsSpeakText, stopSpeaking as ttsStopSpeaking } from '../services/ttsService';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { getThemeConfig } from '../../constants/theme';
import { sendImageMessage } from '../services/geminiService';
import { useApp } from '../contexts/AppContext';

// Accessibility-focused prompt for the vision model
const GUIDE_PROMPT =
  'You are an accessibility assistant for someone with a physical disability or mobility impairment. ' +
  'Analyse this image and briefly describe (2-4 sentences max): ' +
  '1) Any obstacles, hazards, or barriers (steps, uneven surfaces, clutter). ' +
  '2) Safe paths, ramps, lifts, or accessible routes. ' +
  '3) Any doors, signs, or points of interest. ' +
  'Be concise and speak directly to the user. Start with the most important thing.';

const AUTO_SCAN_INTERVAL_MS = 4000;

const CameraGuideScreen = ({ navigation }: { navigation: any }) => {
  const { state } = useApp();
  const isDark = state.accessibilitySettings.isDarkMode;
  const theme = useMemo(() => getThemeConfig(isDark), [isDark]);

  const [permission, requestPermission] = useCameraPermissions();
  const [isScanning, setIsScanning]   = useState(false);
  const [autoScan,   setAutoScan]     = useState(false);
  const [result,     setResult]       = useState('');
  const [facing,     setFacing]       = useState<'back' | 'front'>('back');

  const cameraRef          = useRef<CameraView>(null);
  const autoTimer          = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef       = useRef(true);
  const captureAndAnalyseRef = useRef<() => void>(() => {});
  const pulseAnim          = useRef(new Animated.Value(1)).current;

  // Mark unmounted, clear the interval, and stop speech when the screen is removed
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (autoTimer.current) clearInterval(autoTimer.current);
      ttsStopSpeaking();
    };
  }, []);

  // Pulse animation while scanning
  useEffect(() => {
    if (isScanning) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.15, duration: 500, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1,    duration: 500, useNativeDriver: true }),
        ]),
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isScanning]);

  const speak = useCallback((text: string) => {
    ttsSpeakText(text, { rate: state.accessibilitySettings.voiceSpeed });
  }, [state.accessibilitySettings.voiceSpeed]);

  const captureAndAnalyse = useCallback(async () => {
    if (!cameraRef.current || isScanning) return;
    setIsScanning(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      // Capture frame
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.6,
        base64: false,
        skipProcessing: true,
      });

      if (!photo?.uri) throw new Error('No photo captured');

      // Resize to 640px wide to keep payload small
      const manipulated = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ resize: { width: 640 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );

      if (!manipulated.base64) throw new Error('Could not encode image');

      const description = await sendImageMessage(manipulated.base64, 'image/jpeg', GUIDE_PROMPT);

      if (!isMountedRef.current) return;
      setResult(description);
      speak(description);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      if (!isMountedRef.current) return;
      const msg = 'Could not analyse the scene. Please try again.';
      setResult(msg);
      if (!autoScan) speak(msg);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      if (isMountedRef.current) setIsScanning(false);
    }
  }, [isScanning, autoScan, speak]);

  // Keep the ref in sync so the interval always calls the latest captureAndAnalyse
  useEffect(() => {
    captureAndAnalyseRef.current = captureAndAnalyse;
  }, [captureAndAnalyse]);

  // Auto-scan timer — uses ref to avoid stale closure
  useEffect(() => {
    if (autoScan) {
      autoTimer.current = setInterval(() => {
        captureAndAnalyseRef.current();
      }, AUTO_SCAN_INTERVAL_MS);
    } else {
      if (autoTimer.current) clearInterval(autoTimer.current);
    }
    return () => { if (autoTimer.current) clearInterval(autoTimer.current); };
  }, [autoScan]);

  // ── Permission gate ──────────────────────────────────────────────────────────

  if (!permission) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.accent} />
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: theme.background }]}>
        <Ionicons name="camera-outline" size={64} color={theme.textMuted} style={{ marginBottom: 20 }} />
        <Text style={[styles.permTitle, { color: theme.textPrimary }]}>Camera Access Needed</Text>
        <Text style={[styles.permSub, { color: theme.textMuted }]}>
          Camera Guide needs camera access to analyse your surroundings.
        </Text>
        <TouchableOpacity style={[styles.permBtn, { backgroundColor: theme.accent }]} onPress={requestPermission}>
          <Text style={styles.permBtnText}>Grant Access</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginTop: 16 }}>
          <Text style={{ color: theme.textMuted, fontSize: 14 }}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ── Main UI ──────────────────────────────────────────────────────────────────

  const bg = isDark ? '#0d1117' : '#ffffff';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: '#000' }]}>
      <StatusBar barStyle="light-content" />

      {/* ── Camera viewfinder ── */}
      <View style={styles.cameraWrap}>
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing={facing}
        />

        {/* Corner frame overlay */}
        <View style={styles.frameOverlay} pointerEvents="none">
          <View style={styles.frameTL} />
          <View style={styles.frameTR} />
          <View style={styles.frameBL} />
          <View style={styles.frameBR} />
        </View>

        {/* Scanning pulse ring */}
        {isScanning && (
          <Animated.View style={[styles.scanRing, { transform: [{ scale: pulseAnim }] }]} />
        )}

        {/* Auto-scan badge */}
        {autoScan && (
          <View style={styles.autoBadge}>
            <View style={styles.autoDot} />
            <Text style={styles.autoBadgeText}>Auto-scan ON</Text>
          </View>
        )}

        {/* Top bar */}
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.topBtn} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.topTitle}>Camera Guide</Text>
          <TouchableOpacity
            style={styles.topBtn}
            onPress={() => setFacing(f => f === 'back' ? 'front' : 'back')}
          >
            <Ionicons name="camera-reverse-outline" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Controls + result panel ── */}
      <View style={[styles.panel, { backgroundColor: bg }]}>

        {/* Scan button row */}
        <View style={styles.btnRow}>
          {/* Auto-scan toggle */}
          <TouchableOpacity
            style={[styles.autoBtn, autoScan && styles.autoBtnActive]}
            onPress={() => {
              setAutoScan(prev => !prev);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            }}
          >
            <Ionicons name={autoScan ? 'pause-circle' : 'repeat'} size={20} color={autoScan ? '#fff' : theme.accent} />
            <Text style={[styles.autoBtnText, { color: autoScan ? '#fff' : theme.accent }]}>
              {autoScan ? 'Stop Auto' : 'Auto'}
            </Text>
          </TouchableOpacity>

          {/* Main scan button */}
          <TouchableOpacity
            onPress={captureAndAnalyse}
            disabled={isScanning}
            activeOpacity={0.85}
            accessibilityLabel="Scan surroundings"
            style={styles.scanBtnOuter}
          >
            <LinearGradient
              colors={isScanning ? ['#6b7280', '#4b5563'] : ['#7C3AED', '#A855F7']}
              style={styles.scanBtn}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              {isScanning
                ? <ActivityIndicator color="#fff" size="small" />
                : <Ionicons name="scan" size={28} color="#fff" />}
            </LinearGradient>
          </TouchableOpacity>

          {/* Stop speech */}
          <TouchableOpacity
            style={[styles.autoBtn, { borderColor: '#ef4444' }]}
            onPress={() => { ttsStopSpeaking(); }}
          >
            <Ionicons name="volume-mute-outline" size={20} color="#ef4444" />
            <Text style={[styles.autoBtnText, { color: '#ef4444' }]}>Mute</Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.hint, { color: theme.textMuted }]}>
          {isScanning
            ? 'Analysing your surroundings…'
            : autoScan
            ? `Scanning every ${AUTO_SCAN_INTERVAL_MS / 1000}s automatically`
            : 'Tap Scan or enable Auto to describe your surroundings'}
        </Text>

        {/* Result */}
        {result ? (
          <ScrollView
            style={[styles.resultBox, { backgroundColor: isDark ? '#161b22' : '#f7f7f8', borderColor: isDark ? '#30363d' : '#e5e7eb' }]}
            contentContainerStyle={{ padding: 14 }}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.resultHeader}>
              <View style={[styles.resultDot, { backgroundColor: '#22c55e' }]} />
              <Text style={[styles.resultLabel, { color: theme.textMuted }]}>Scene Description</Text>
              <TouchableOpacity onPress={() => speak(result)} style={styles.replayBtn}>
                <Ionicons name="volume-high-outline" size={16} color={theme.accent} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.resultText, { color: theme.textPrimary }]}>{result}</Text>
          </ScrollView>
        ) : null}
      </View>
    </SafeAreaView>
  );
};

export default CameraGuideScreen;

const CORNER = 22;
const BORDER = 3;
const CORNER_COLOR = '#A855F7';

const styles = StyleSheet.create({
  safe:       { flex: 1 },
  center:     { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },

  // Camera
  cameraWrap: { flex: 1, position: 'relative', backgroundColor: '#000' },
  camera:     { flex: 1 },

  // Corner frame
  frameOverlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  frameTL: { position: 'absolute', top: 40, left: 30, width: CORNER, height: CORNER, borderTopWidth: BORDER, borderLeftWidth: BORDER, borderColor: CORNER_COLOR, borderTopLeftRadius: 6 },
  frameTR: { position: 'absolute', top: 40, right: 30, width: CORNER, height: CORNER, borderTopWidth: BORDER, borderRightWidth: BORDER, borderColor: CORNER_COLOR, borderTopRightRadius: 6 },
  frameBL: { position: 'absolute', bottom: 40, left: 30, width: CORNER, height: CORNER, borderBottomWidth: BORDER, borderLeftWidth: BORDER, borderColor: CORNER_COLOR, borderBottomLeftRadius: 6 },
  frameBR: { position: 'absolute', bottom: 40, right: 30, width: CORNER, height: CORNER, borderBottomWidth: BORDER, borderRightWidth: BORDER, borderColor: CORNER_COLOR, borderBottomRightRadius: 6 },

  // Scan ring
  scanRing: {
    position: 'absolute', alignSelf: 'center', top: '35%',
    width: 80, height: 80, borderRadius: 40,
    borderWidth: 3, borderColor: '#A855F7',
  },

  // Top bar
  topBar: {
    position: 'absolute', top: Platform.OS === 'ios' ? 10 : 16, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  topBtn:   { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 20 },
  topTitle: { fontSize: 16, fontWeight: '700', color: '#fff', textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },

  // Auto badge
  autoBadge: { position: 'absolute', bottom: 14, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 },
  autoDot:   { width: 7, height: 7, borderRadius: 4, backgroundColor: '#22c55e' },
  autoBadgeText: { color: '#fff', fontSize: 12, fontWeight: '600' },

  // Panel
  panel:  { paddingHorizontal: 16, paddingTop: 16, paddingBottom: Platform.OS === 'ios' ? 8 : 16 },

  // Buttons row
  btnRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },

  scanBtnOuter: {},
  scanBtn: { width: 70, height: 70, borderRadius: 35, alignItems: 'center', justifyContent: 'center', shadowColor: '#7C3AED', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 6 },

  autoBtn: { flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, borderWidth: 1.5, borderColor: '#7C3AED', width: 80 },
  autoBtnActive: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  autoBtnText: { fontSize: 11, fontWeight: '700' },

  hint: { fontSize: 12, textAlign: 'center', marginBottom: 10 },

  // Result
  resultBox:    { maxHeight: 140, borderRadius: 14, borderWidth: 1, marginTop: 4 },
  resultHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  resultDot:    { width: 8, height: 8, borderRadius: 4 },
  resultLabel:  { flex: 1, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  replayBtn:    { padding: 4 },
  resultText:   { fontSize: 14, lineHeight: 21 },

  // Permission screen
  permTitle:   { fontSize: 22, fontWeight: '700', textAlign: 'center', marginBottom: 10 },
  permSub:     { fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 28, paddingHorizontal: 16 },
  permBtn:     { paddingHorizontal: 32, paddingVertical: 14, borderRadius: 14 },
  permBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
