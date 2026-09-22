/**
 * voiceIntentService.ts
 *
 * EverySense AI Intent Understanding Service.
 * Parses spoken or typed commands into structured intent objects:
 * - CREATE_REMINDER
 * - EXPLAIN
 * - SCAN
 * - HELP
 */

import { parseReminderFromSpeech } from '../utils/nlpParser';
import { parseDateTime, toLocalISOString } from '../utils/dateTimeParser';
import { sendChatMessage } from './geminiService';

export type IntentType = 'CREATE_REMINDER' | 'EXPLAIN' | 'SCAN' | 'HELP';

export interface ParsedIntentResult {
  intent: IntentType;
  title?: string;
  description?: string;
  date?: string; // ISO date string if available
  explanationText?: string;
  rawText: string;
  confidence: number;
}

/**
 * Main intent parsing function.
 * Uses fast local NLP first, fallback to Groq AI if needed.
 */
export async function parseUserVoiceIntent(text: string): Promise<ParsedIntentResult> {
  const rawText = text.trim();
  const normalized = rawText.toLowerCase();

  if (!normalized) {
    return {
      intent: 'HELP',
      rawText,
      confidence: 0,
    };
  }

  // 1. HELP INTENT
  if (
    normalized.includes('what can you do') ||
    normalized === 'help' ||
    normalized.includes('how to use') ||
    normalized.includes('show commands') ||
    normalized.includes('command list') ||
    normalized.includes('what options')
  ) {
    return {
      intent: 'HELP',
      rawText,
      confidence: 1.0,
    };
  }

  // 2. SCAN INTENT
  if (
    normalized.includes('open smart scan') ||
    normalized.includes('open scan') ||
    normalized.includes('scan bill') ||
    normalized.includes('scan document') ||
    normalized.includes('scan receipt') ||
    normalized === 'scan' ||
    normalized.includes('take photo') ||
    normalized.includes('upload bill')
  ) {
    return {
      intent: 'SCAN',
      rawText,
      confidence: 0.95,
    };
  }

  // 3. EXPLAIN INTENT
  if (
    normalized.includes('explain this') ||
    normalized.includes('explain document') ||
    normalized.includes('explain bill') ||
    normalized.includes('explain receipt') ||
    normalized === 'explain' ||
    normalized.includes('what does this say') ||
    normalized.includes('simplify this')
  ) {
    return {
      intent: 'EXPLAIN',
      rawText,
      confidence: 0.95,
    };
  }

  // 4. CREATE_REMINDER INTENT via Local NLP Parser
  const parsedReminder = parseReminderFromSpeech(rawText);
  if (parsedReminder && parsedReminder.title && parsedReminder.confidence >= 0.4) {
    let dateIso: string | undefined = undefined;

    if (parsedReminder.datetime) {
      dateIso = toLocalISOString(parsedReminder.datetime);
    } else {
      const dt = parseDateTime(rawText);
      if (dt?.date) {
        dateIso = toLocalISOString(dt.date);
      }
    }

    console.log('🗣️ [voiceIntentService Log]:');
    console.log('   - Raw transcript:', rawText);
    console.log('   - Parsed title:', parsedReminder.title);
    console.log('   - Final navigation prefillDate:', dateIso);

    return {
      intent: 'CREATE_REMINDER',
      title: parsedReminder.title,
      description: rawText,
      date: dateIso,
      rawText,
      confidence: parsedReminder.confidence,
    };
  }

  // Check for common reminder trigger verbs
  if (
    normalized.startsWith('remind') ||
    normalized.startsWith('set ') ||
    normalized.startsWith('call ') ||
    normalized.startsWith('pay ') ||
    normalized.startsWith('buy ') ||
    normalized.includes(' tomorrow') ||
    normalized.includes(' at ')
  ) {
    const dt = parseDateTime(rawText);
    const dateIso = dt?.date ? toLocalISOString(dt.date) : undefined;
    let cleanTitle = rawText
      .replace(/^remind me to /i, '')
      .replace(/^remind me /i, '')
      .replace(/^set a reminder to /i, '')
      .replace(/^set reminder to /i, '')
      .trim();

    if (dt) {
      if (dt.dateMatched) {
        cleanTitle = cleanTitle.replace(new RegExp(`\\b(?:on\\s+)?${dt.dateMatched}\\b`, 'gi'), ' ');
      }
      if (dt.timeMatched) {
        cleanTitle = cleanTitle.replace(new RegExp(`\\b(?:at\\s+)?${dt.timeMatched}\\b`, 'gi'), ' ');
      }
      if (dt.matched && !dt.dateMatched && !dt.timeMatched) {
        cleanTitle = cleanTitle.replace(new RegExp(`\\b${dt.matched}\\b`, 'gi'), ' ');
      }
    }

    cleanTitle = cleanTitle
      .replace(/\b(?:to|for|about|at|on|in)\b/gi, ' ')
      .replace(/[.,!?]+$/, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleanTitle) {
      cleanTitle = cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1);
    }

    console.log('🗣️ [voiceIntentService Fallback Verb Log]:');
    console.log('   - Raw transcript:', rawText);
    console.log('   - Clean title:', cleanTitle);
    console.log('   - Final navigation prefillDate:', dateIso);

    return {
      intent: 'CREATE_REMINDER',
      title: cleanTitle || rawText,
      description: rawText,
      date: dateIso,
      rawText,
      confidence: 0.8,
    };
  }

  // 5. Fallback to Groq AI for complex or conversational phrases
  try {
    const aiPrompt = `Analyze this command for EverySense AI: "${rawText}"
Respond strictly with ONLY a JSON object with NO markdown formatting:
{
  "intent": "CREATE_REMINDER" | "EXPLAIN" | "SCAN" | "HELP",
  "title": "short title if CREATE_REMINDER else null",
  "description": "description if CREATE_REMINDER else null",
  "date": "ISO date string or null"
}`;

    const rawResponse = await sendChatMessage([], aiPrompt);
    let cleanJson = rawResponse.trim();
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    }

    const parsed = JSON.parse(cleanJson);
    if (parsed.intent && ['CREATE_REMINDER', 'EXPLAIN', 'SCAN', 'HELP'].includes(parsed.intent)) {
      return {
        intent: parsed.intent,
        title: parsed.title || rawText,
        description: parsed.description || rawText,
        date: parsed.date || undefined,
        rawText,
        confidence: 0.9,
      };
    }
  } catch (err) {
    console.warn('[voiceIntentService] Groq AI intent parsing fallback warning:', err);
  }

  // Default fallback if unparsed
  return {
    intent: 'CREATE_REMINDER',
    title: rawText,
    description: rawText,
    rawText,
    confidence: 0.5,
  };
}
