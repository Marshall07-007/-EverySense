/**
 * ttsService.ts
 *
 * Centralized, reliable Text-to-Speech (TTS) Service for EverySense AI.
 * Handles speech queueing, cancellation, language fallback, and diagnostic logging on Android dev builds.
 */

import * as Speech from 'expo-speech';

export interface TTSOptions {
  rate?: number;
  pitch?: number;
  language?: string;
  voice?: string;
  onStart?: () => void;
  onDone?: () => void;
  onStopped?: () => void;
  onError?: (error: any) => void;
}

/**
 * Checks whether speech is currently in progress.
 */
export async function isSpeaking(): Promise<boolean> {
  try {
    if (!Speech || typeof Speech.isSpeakingAsync !== 'function') return false;
    return await Speech.isSpeakingAsync().catch(() => false);
  } catch {
    return false;
  }
}

/**
 * Immediately stops any ongoing speech output safely.
 */
export async function stopSpeaking(): Promise<void> {
  try {
    if (!Speech || typeof Speech.stop !== 'function') return;
    await Speech.stop().catch(() => {});
  } catch (err) {
    console.warn('[ttsService] stop error:', err);
  }
}

/**
 * Safely speaks text out loud using expo-speech on Android dev build / iOS / web.
 * Stops previous speech before starting new speech and provides full diagnostic handling.
 */
export async function speakText(
  text: string,
  options?: TTSOptions
): Promise<void> {
  if (!text || typeof text !== 'string' || !text.trim()) {
    return;
  }

  const cleanText = text.trim();

  if (!Speech || typeof Speech.speak !== 'function') {
    console.warn('[ttsService] expo-speech module is not available or not linked properly');
    return;
  }

  try {
    // 1. Properly await stopping any prior speech and wait a tick for native audio track cleanup
    try {
      await Speech.stop().catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 60));
    } catch {}

    const safeRate = options?.rate ? Math.max(0.5, Math.min(options.rate, 2.0)) : 1.0;
    const safePitch = options?.pitch ? Math.max(0.5, Math.min(options.pitch, 2.0)) : 1.0;
    const language = options?.language || 'en-US';

    console.log('[ttsService] Speaking text (length:', cleanText.length, 'rate:', safeRate, 'pitch:', safePitch, 'lang:', language, ')');

    Speech.speak(cleanText, {
      language,
      rate: safeRate,
      pitch: safePitch,
      voice: options?.voice,
      onStart: () => {
        options?.onStart?.();
      },
      onDone: () => {
        options?.onDone?.();
      },
      onStopped: () => {
        options?.onStopped?.();
      },
      onError: (err: any) => {
        console.warn('[ttsService] Speech.speak onError callback:', err?.message || String(err));
        // Fallback: If custom language failed, retry with system default language/voice
        if (options?.language) {
          try {
            Speech.speak(cleanText, {
              rate: safeRate,
              pitch: safePitch,
            });
          } catch {}
        }
        options?.onError?.(err);
      },
    });
  } catch (err: any) {
    console.warn('[ttsService] speakText caught error:', err?.message || String(err));
    // Fallback attempt without options
    try {
      Speech.speak(cleanText);
    } catch {}
  }
}
