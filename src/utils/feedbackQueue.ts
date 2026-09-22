/**
 * feedbackQueue.ts
 * Offline-safe queue for accessibility feedback, issues, and usability ratings.
 * Mirrors the pattern used by syncQueue.ts for reminders.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../lib/supabase';

const QUEUE_KEY = 'everysense_feedback_queue_v1';

export type FeedbackOp =
  | { type: 'feedback'; data: AccessibilityFeedbackData }
  | { type: 'issue'; data: AccessibilityIssueData }
  | { type: 'rating'; data: UsabilityRatingData };

export interface AccessibilityFeedbackData {
  user_id: string;
  disability_category: string;
  feature_tested: string;
  what_worked?: string;
  what_didnt_work?: string;
  suggestions?: string;
  overall_rating?: number;
  ease_of_use?: number;
  accessibility_rating?: number;
  testing_method?: string;
  device_type?: string;
  assistive_tech_used?: string;
  voice_feedback_url?: string;
  session_id?: string;
  is_anonymous?: boolean;
}

export interface AccessibilityIssueData {
  user_id: string;
  issue_type: string;
  screen_name: string;
  description: string;
  severity?: string;
  wcag_criterion?: string;
  screenshot_url?: string;
  device_info?: string;
  app_version?: string;
}

export interface UsabilityRatingData {
  user_id: string;
  task_name: string;
  screen_name: string;
  success: boolean;
  difficulty?: number;
  time_seconds?: number;
  error_count?: number;
  notes?: string;
}

interface QueueEntry {
  id: string;
  op: FeedbackOp;
  timestamp: number;
}

async function loadQueue(): Promise<QueueEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function saveQueue(queue: QueueEntry[]): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {}
}

export async function addFeedbackToQueue(op: FeedbackOp): Promise<void> {
  const queue = await loadQueue();
  queue.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    op,
    timestamp: Date.now(),
  });
  await saveQueue(queue);
}

export async function getFeedbackQueueLength(): Promise<number> {
  const queue = await loadQueue();
  return queue.length;
}

export async function processFeedbackQueue(): Promise<number> {
  const queue = await loadQueue();
  if (queue.length === 0) return 0;

  const remaining: QueueEntry[] = [];
  let synced = 0;

  for (const entry of queue) {
    try {
      const { op } = entry;
      let error: any = null;

      if (op.type === 'feedback') {
        ({ error } = await supabase.from('accessibility_feedback').insert(op.data));
      } else if (op.type === 'issue') {
        ({ error } = await supabase.from('accessibility_issues').insert(op.data));
      } else if (op.type === 'rating') {
        ({ error } = await supabase.from('usability_ratings').insert(op.data));
      }

      if (error) {
        remaining.push(entry);
      } else {
        synced++;
      }
    } catch {
      remaining.push(entry);
    }
  }

  await saveQueue(remaining);
  return synced;
}

/** Try Supabase directly; queue only on network errors */
export async function submitFeedback(op: FeedbackOp): Promise<{ queued: boolean; error?: string }> {
  let error: any = null;

  try {
    if (op.type === 'feedback') {
      ({ error } = await supabase.from('accessibility_feedback').insert(op.data));
    } else if (op.type === 'issue') {
      ({ error } = await supabase.from('accessibility_issues').insert(op.data));
    } else if (op.type === 'rating') {
      ({ error } = await supabase.from('usability_ratings').insert(op.data));
    }
  } catch (networkErr: any) {
    // True network failure — queue for later
    console.warn('[feedbackQueue] Network error, queuing:', networkErr?.message);
    await addFeedbackToQueue(op);
    return { queued: true };
  }

  if (error) {
    console.error('[feedbackQueue] Supabase error:', error.message, error.details, error.hint);
    // Don't queue Supabase validation errors — they won't fix themselves
    return { queued: false, error: error.message };
  }

  return { queued: false };
}
