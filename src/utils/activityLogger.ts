/**
 * EverySense – Activity Logger
 * ---------------------------
 * Logs every time the user uses a key accessibility feature.
 * All data stays on-device using AsyncStorage (no backend needed).
 *
**/

import AsyncStorage from '@react-native-async-storage/async-storage';

// types for the different features in our app
export type ActivityType =
  | 'tts'         // Text-to-Speech used
  | 'ocr'         // Camera OCR scan
  | 'voice'       // Voice command used
  | 'reminder'    // Reminder created
  | 'sos'         // SOS button triggered
  | 'community';  // Community / social feature used

export type ActivityEntry = {
  id: string;
  type: ActivityType;
  label: string;
  timestamp: number;
};

const STORAGE_KEY = 'everysense_activity_log';
const MAX_ENTRIES = 200;

// emojis for each type to show in the UI
export const ACTIVITY_EMOJI: Record<ActivityType, string> = {
  tts: '🔊',
  ocr: '📸',
  voice: '🎤',
  reminder: '⏰',
  sos: '🆘',
  community: '🌐',
};

// colors i picked for each activity type
export const ACTIVITY_COLOR: Record<ActivityType, string> = {
  tts: '#4A90E2',
  ocr: '#8B5CF6',
  voice: '#10B981',
  reminder: '#F59E0B',
  sos: '#EF4444',
  community: '#EC4899',
};

// saves a new activity entry to storage
export const logActivity = async (type: ActivityType, label: string) => {
  try {
    const existing = await getActivityLog();
    const entry: ActivityEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type,
      label,
      timestamp: Date.now(),
    };
    const updated = [entry, ...existing].slice(0, MAX_ENTRIES);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.warn('ActivityLogger error', err);
  }
};

// gets all saved entries
export const getActivityLog = async (): Promise<ActivityEntry[]> => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

// clears all history
export const clearActivityLog = async () => {
  await AsyncStorage.removeItem(STORAGE_KEY);
};

// counts how many times each feature was used this week
export const getWeeklyStats = async (): Promise<Record<ActivityType, number>> => {
  const log = await getActivityLog();
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const counts = { tts: 0, ocr: 0, voice: 0, reminder: 0, sos: 0, community: 0 };
  log.filter(e => e.timestamp >= cutoff).forEach(e => { counts[e.type]++; });
  return counts;
};

