/**
 * dateTimeParser.ts
 * Converts natural language date/time phrases into local Date objects.
 * Supports:
 * - "tomorrow at 6 PM", "at 6 PM tomorrow"
 * - "tomorrow at 9 AM", "at 9 AM tomorrow"
 * - "today at 8 PM", "at 8 PM"
 * - "September 25 at 4 PM", "25th September at 4 PM", "Sept 25th at 4 PM"
 * - "at 17:00 tomorrow", "at 5 o'clock tomorrow"
 * - "in 2 hours", "in 30 minutes"
 * - Date-only phrases: "tomorrow", "September 25", "25th September"
 */

export interface ParsedDateTime {
  date: Date;
  confidence: number;
  matched: string;
  dateMatched?: string;
  timeMatched?: string;
}

const MONTHS: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

const DAYS_OF_WEEK: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

/**
 * Format a Date object as a local ISO string (YYYY-MM-DDTHH:mm:ss) preserving local timezone components.
 */
export function toLocalISOString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

/**
 * Parse time fragment from text.
 * Handles 12-hour (6 pm, 9:15 am), o'clock (5 o'clock), 24-hour military (17:00, 05:00), etc.
 */
function parseTimeFragment(text: string): { hour: number; minute: number; matched: string } | null {
  // 1. 12-hour format: e.g. "6 pm", "6:30 pm", "9 am", "9:15 am", "5pm", "at 6 pm"
  const m12 = text.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)\b/i);
  if (m12) {
    let hour = parseInt(m12[1], 10);
    const minute = m12[2] ? parseInt(m12[2], 10) : 0;
    const isPM = m12[3].toLowerCase().replace(/\./g, '') === 'pm';
    if (isPM && hour !== 12) hour += 12;
    if (!isPM && hour === 12) hour = 0;
    return { hour, minute, matched: m12[0] };
  }

  // 2. o'clock format: e.g. "5 o'clock", "5 o'clock pm", "at 5 o'clock"
  const moc = text.match(/\b(?:at\s+)?(\d{1,2})\s*(?:o'?clock)(?:\s*([ap]\.?m\.?))?\b/i);
  if (moc) {
    let hour = parseInt(moc[1], 10);
    const ampm = moc[2]?.toLowerCase().replace(/\./g, '');
    if (ampm === 'pm' && hour !== 12) hour += 12;
    else if (ampm === 'am' && hour === 12) hour = 0;
    else if (!ampm) {
      // If no am/pm specified for o'clock: default 1-6 to PM (13-18)
      if (hour >= 1 && hour <= 6) hour += 12;
    }
    return { hour, minute: 0, matched: moc[0] };
  }

  // 3. 24-hour military format: e.g. "17:00", "05:00", "at 17:00"
  const m24 = text.match(/\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/i);
  if (m24) {
    const hour = parseInt(m24[1], 10);
    const minute = parseInt(m24[2], 10);
    return { hour, minute, matched: m24[0] };
  }

  // 4. Standalone "at 5" (e.g. "at 5 tomorrow" or "at 5")
  const mAt = text.match(/\bat\s+(\d{1,2})\b(?!\s*:\s*\d)/i);
  if (mAt) {
    let hour = parseInt(mAt[1], 10);
    if (hour >= 1 && hour <= 6) hour += 12;
    return { hour, minute: 0, matched: mAt[0] };
  }

  return null;
}

/**
 * Parse date fragment from text.
 * Handles relative days (today, tomorrow, day after tomorrow), calendar dates, days of week.
 */
function parseDateFragment(text: string, referenceDate: Date): { date: Date; matched: string } | null {
  // Day after tomorrow
  const mDayAfter = text.match(/\b(?:day\s+after\s+tomorrow|overmorrow)\b/i);
  if (mDayAfter) {
    const d = new Date(referenceDate);
    d.setDate(d.getDate() + 2);
    return { date: d, matched: mDayAfter[0] };
  }

  // Tomorrow
  const mTomorrow = text.match(/\b(?:tomorrow|tmrw)\b/i);
  if (mTomorrow) {
    const d = new Date(referenceDate);
    d.setDate(d.getDate() + 1);
    return { date: d, matched: mTomorrow[0] };
  }

  // Today
  const mToday = text.match(/\btoday\b/i);
  if (mToday) {
    const d = new Date(referenceDate);
    return { date: d, matched: mToday[0] };
  }

  // Next week
  const mNextWeek = text.match(/\bnext\s+week\b/i);
  if (mNextWeek) {
    const d = new Date(referenceDate);
    d.setDate(d.getDate() + 7);
    return { date: d, matched: mNextWeek[0] };
  }

  // Month-Day: e.g. "September 25", "September 25th", "Sept 25", "Sep 25th", "on September 25"
  const mMonthDay = text.match(/\b(?:on\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i);
  if (mMonthDay) {
    const mNum = MONTHS[mMonthDay[1].toLowerCase()];
    const day = parseInt(mMonthDay[2], 10);
    if (mNum !== undefined && day >= 1 && day <= 31) {
      const d = new Date(referenceDate);
      d.setMonth(mNum);
      d.setDate(day);
      if (d < referenceDate && (referenceDate.getMonth() > mNum || (referenceDate.getMonth() === mNum && referenceDate.getDate() > day))) {
        d.setFullYear(d.getFullYear() + 1);
      }
      return { date: d, matched: mMonthDay[0] };
    }
  }

  // Day-Month: e.g. "25th September", "25 September", "25th of September", "25th Sept", "25 Sept", "on 25th September"
  const mDayMonth = text.match(/\b(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i);
  if (mDayMonth) {
    const day = parseInt(mDayMonth[1], 10);
    const mNum = MONTHS[mDayMonth[2].toLowerCase()];
    if (mNum !== undefined && day >= 1 && day <= 31) {
      const d = new Date(referenceDate);
      d.setMonth(mNum);
      d.setDate(day);
      if (d < referenceDate && (referenceDate.getMonth() > mNum || (referenceDate.getMonth() === mNum && referenceDate.getDate() > day))) {
        d.setFullYear(d.getFullYear() + 1);
      }
      return { date: d, matched: mDayMonth[0] };
    }
  }

  // Day of week: e.g. "next monday", "monday", "on friday"
  const mDayOfWeek = text.match(/\b(?:on\s+)?(?:next\s+)?(monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat|sunday|sun)\b/i);
  if (mDayOfWeek) {
    const targetDay = DAYS_OF_WEEK[mDayOfWeek[1].toLowerCase()];
    if (targetDay !== undefined) {
      const d = new Date(referenceDate);
      const currentDay = referenceDate.getDay();
      let daysToAdd = targetDay - currentDay;
      if (mDayOfWeek[0].toLowerCase().includes('next') || daysToAdd <= 0) {
        daysToAdd += 7;
      }
      d.setDate(d.getDate() + daysToAdd);
      return { date: d, matched: mDayOfWeek[0] };
    }
  }

  return null;
}

/**
 * Parse relative offset phrases (e.g. "in 2 hours", "in 30 minutes", "in 3 days").
 */
function parseRelativeOffset(text: string, referenceDate: Date): ParsedDateTime | null {
  const mRel = text.match(/\bin\s+(\d+)\s+(hours?|minutes?|days?)\b/i);
  if (mRel) {
    const amount = parseInt(mRel[1], 10);
    const unit = mRel[2].toLowerCase();
    const d = new Date(referenceDate);
    if (unit.startsWith('hour')) d.setHours(d.getHours() + amount);
    else if (unit.startsWith('minute')) d.setMinutes(d.getMinutes() + amount);
    else if (unit.startsWith('day')) d.setDate(d.getDate() + amount);
    return { date: d, matched: mRel[0], confidence: 0.95 };
  }
  return null;
}

/**
 * Main function to parse natural language text into a local Date object.
 */
export function parseDateTime(text: string, referenceDate: Date = new Date()): ParsedDateTime | null {
  const normalized = text.toLowerCase().trim();

  // 1. Relative offset ("in 2 hours", "in 30 minutes")
  const relResult = parseRelativeOffset(normalized, referenceDate);
  if (relResult) return relResult;

  // 2. Extract date fragment and time fragment independently
  const dateFrag = parseDateFragment(normalized, referenceDate);
  const timeFrag = parseTimeFragment(normalized);

  // Both Date and Time found (in any order: "tomorrow at 6 PM" or "at 6 PM tomorrow")
  if (dateFrag && timeFrag) {
    const resultDate = new Date(dateFrag.date);
    resultDate.setHours(timeFrag.hour, timeFrag.minute, 0, 0);

    const isExplicitToday = /\btoday\b/i.test(dateFrag.matched);
    if (isExplicitToday && resultDate <= referenceDate) {
      resultDate.setDate(resultDate.getDate() + 1);
    }

    return {
      date: resultDate,
      confidence: 0.95,
      matched: `${dateFrag.matched} ${timeFrag.matched}`,
      dateMatched: dateFrag.matched,
      timeMatched: timeFrag.matched,
    };
  }

  // Time only found (e.g. "at 8 PM", "17:00")
  if (timeFrag) {
    const resultDate = new Date(referenceDate);
    resultDate.setHours(timeFrag.hour, timeFrag.minute, 0, 0);
    if (resultDate <= referenceDate) {
      resultDate.setDate(resultDate.getDate() + 1);
    }
    return {
      date: resultDate,
      confidence: 0.9,
      matched: timeFrag.matched,
      timeMatched: timeFrag.matched,
    };
  }

  // Date only found (e.g. "tomorrow", "September 25")
  if (dateFrag) {
    const resultDate = new Date(dateFrag.date);
    resultDate.setHours(9, 0, 0, 0); // Default to 9:00 AM
    return {
      date: resultDate,
      confidence: 0.85,
      matched: dateFrag.matched,
      dateMatched: dateFrag.matched,
    };
  }

  return null;
}

/**
 * Format a date for display
 */
export function formatDateTime(date: Date): string {
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = date.toDateString() === tomorrow.toDateString();

  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  if (isToday) {
    return `today at ${timeStr}`;
  } else if (isTomorrow) {
    return `tomorrow at ${timeStr}`;
  } else {
    const dateStr = date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
    return `${dateStr} at ${timeStr}`;
  }
}

/**
 * Helper to validate if parsed date is reasonable (not too far future)
 */
export function isReasonableDate(date: Date, referenceDate: Date = new Date()): boolean {
  const oneYearFromNow = new Date(referenceDate);
  oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
  return date >= referenceDate && date <= oneYearFromNow;
}