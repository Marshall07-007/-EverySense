/**
 * geminiService.ts
 *
 * AI chat via Groq (free tier — llama-3.3-70b).
 * Uses the OpenAI-compatible Groq REST API.
 */

const GROQ_API_KEY = process.env.EXPO_PUBLIC_GROQ_API_KEY ?? '';
const ENDPOINT     = 'https://api.groq.com/openai/v1/chat/completions';
const TEXT_MODEL   = 'qwen/qwen3.8-27b';
const FALLBACK_TEXT_MODEL = 'openai/gpt-oss-120b';
const VISION_MODEL = 'qwen/qwen3.8-27b';
const DEFAULT_TIMEOUT_MS = 30000; // 30 seconds for text chat
const VISION_TIMEOUT_MS  = 60000; // 60 seconds for vision inference

function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const startTime = Date.now();

  const timer = setTimeout(() => {
    console.error(`[GeminiService Network Timeout] Aborting request after ${timeoutMs}ms for URL: ${url}`);
    controller.abort();
  }, timeoutMs);

  return fetch(url, { ...options, signal: controller.signal })
    .then((response) => {
      const elapsed = Date.now() - startTime;
      console.error(`[GeminiService Network Success] Status ${response.status} in ${elapsed}ms for: ${url}`);
      return response;
    })
    .catch((err: any) => {
      const elapsed = Date.now() - startTime;
      const isAbort = err?.name === 'AbortError' || err?.message?.toLowerCase().includes('canceled') || err?.message?.toLowerCase().includes('aborted');
      if (isAbort) {
        console.error(`[GeminiService Network AbortError] Request explicitly canceled/aborted after ${elapsed}ms (Timeout limit: ${timeoutMs}ms)`);
        const abortError = new Error(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds. Vision processing requires more time.`);
        abortError.name = 'AbortError';
        throw abortError;
      }
      console.error(`[GeminiService Network Error] Fetch failure after ${elapsed}ms:`, err?.message || String(err));
      throw err;
    })
    .finally(() => clearTimeout(timer));
}

const SYSTEM_PROMPT = `You are EverySense AI Assistant — a compassionate, knowledgeable AI companion built into the EverySense app, which is designed for multi-sensory awareness, accessibility, and health support.

Your role:
- Answer health, medication, and accessibility questions clearly and empathetically
- Help users understand medical documents, prescriptions, or terminology
- Suggest reminders (e.g. "You could set a medication reminder for that")
- Provide mental health support and encouragement when users feel low
- Explain disability-related rights and accessibility accommodations
- Give practical daily living tips for people with various disabilities

Your tone:
- Warm, patient, and non-judgmental
- Use simple, plain language — avoid jargon
- Short responses unless detail is needed
- Always acknowledge the user's feelings before giving advice

Important:
- You are NOT a replacement for professional medical advice. Always recommend consulting a doctor for diagnosis or treatment decisions.
- If a user expresses a mental health crisis or mentions self-harm, respond with empathy and provide crisis resources (e.g. call 988 in the US).
- Keep responses concise and mobile-friendly (no long walls of text).`;

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export async function sendChatMessage(
  history: ChatMessage[],
  newMessage: string,
): Promise<string> {
  if (!GROQ_API_KEY) {
    console.error('[EverySense AI Error] EXPO_PUBLIC_GROQ_API_KEY is not defined in environment.');
    throw new Error('AI service is not configured. Please contact support.');
  }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map(m => ({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text })),
    { role: 'user', content: newMessage },
  ];

  console.log('[EverySense AI] AI request started. Model:', TEXT_MODEL, 'Message count:', messages.length);

  let response = await fetchWithTimeout(
    ENDPOINT,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: TEXT_MODEL,
        messages,
        temperature: 0.7,
        max_tokens: 512,
      }),
    },
    DEFAULT_TIMEOUT_MS,
  );

  console.log('[EverySense AI] HTTP status:', response.status);

  // Fallback to secondary model if primary model errors
  if (!response.ok && FALLBACK_TEXT_MODEL) {
    console.warn(`[EverySense AI] Primary model ${TEXT_MODEL} returned ${response.status}, attempting fallback ${FALLBACK_TEXT_MODEL}...`);
    response = await fetchWithTimeout(
      ENDPOINT,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: FALLBACK_TEXT_MODEL,
          messages,
          temperature: 0.7,
          max_tokens: 512,
        }),
      },
      DEFAULT_TIMEOUT_MS,
    );
    console.log('[EverySense AI] Fallback HTTP status:', response.status);
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    console.error('[EverySense AI Error] Chat completion failed HTTP', response.status, err);
    throw new Error((err as any)?.error?.message ?? `HTTP ${response.status}`);
  }

  const data = await response.json();
  const text: string = data?.choices?.[0]?.message?.content ?? '';
  console.log('[EverySense AI] Response parsed successfully. Length:', text.length);

  if (!text) throw new Error('Empty response');
  return text.trim();
}

/**
 * Send an image (base64) with an optional text prompt to the vision model.
 * @param base64 - Pure base64 string (no data URI prefix)
 * @param mimeType - e.g. 'image/jpeg'
 * @param prompt  - Optional user question about the image
 */
export async function sendImageMessage(
  base64: string,
  mimeType: string = 'image/jpeg',
  prompt: string = 'Please describe and explain what you see in this image in simple, clear language.',
): Promise<string> {
  console.error('[EverySense Vision Stage 3] EXPO_PUBLIC_GROQ_API_KEY available:', !!GROQ_API_KEY);

  if (!GROQ_API_KEY) {
    console.error('[EverySense Vision Error] EXPO_PUBLIC_GROQ_API_KEY is missing.');
    throw new Error('AI service is not configured. Please contact support.');
  }

  console.error('[EverySense Vision Stage 3] Image payload check: base64Length=', base64 ? base64.length : 0, 'mimeType=', mimeType, 'modelName=', VISION_MODEL);

  const response = await fetchWithTimeout(
    ENDPOINT,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
            ],
          },
        ],
        temperature: 0.5,
        max_tokens: 512,
      }),
    },
    VISION_TIMEOUT_MS,
  );

  console.error('[EverySense Vision Stage 4] HTTP Response status:', response.status);

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    console.error('[EverySense Vision Stage 4 HTTP Error Body]: status=', response.status, 'errSnippet=', errText.slice(0, 100));
    let parsedErr: any = {};
    try { parsedErr = JSON.parse(errText); } catch {}
    throw new Error(parsedErr?.error?.message ?? `HTTP ${response.status}: ${errText.slice(0, 100)}`);
  }

  const data = await response.json();
  const text: string = data?.choices?.[0]?.message?.content ?? '';
  console.error('[EverySense Vision Stage 5] Vision model output received, length:', text.length);
  if (!text) throw new Error('Empty response');
  return text.trim();
}

export interface SmartScanResultData {
  documentType: 'Electricity bill' | 'Water bill' | 'Invoice/receipt' | 'College/education document' | 'General document';
  title: string;
  amount: string;
  dueDate: string;
  keyDates: string;
  importantInfo: string;
  explanation: string;
}

/**
 * Smart Scan AI Analyzer using Groq Vision model.
 * Extracts structured document understanding JSON from bills, receipts, education docs, etc.
 */
export async function analyzeSmartScanDocument(
  base64: string,
  mimeType: string = 'image/jpeg',
): Promise<SmartScanResultData> {
  const startTime = Date.now();
  console.error('[SmartScan Stage 3 - API Key Check]: hasKey=', !!GROQ_API_KEY, 'keyLength=', GROQ_API_KEY ? GROQ_API_KEY.length : 0);

  if (!GROQ_API_KEY) {
    console.error('[SmartScan Stage 3 Error]: EXPO_PUBLIC_GROQ_API_KEY is not defined in environment!');
    throw new Error('AI service is not configured. Missing API key.');
  }

  console.error('[SmartScan Stage 3 - Input Validation]: base64Length=', base64 ? base64.length : 0, 'mimeType=', mimeType, 'modelName=', VISION_MODEL);

  if (!base64 || base64.length < 50) {
    console.error('[SmartScan Stage 3 Error]: Base64 image data is invalid or empty!');
    throw new Error('Invalid or corrupted document image data.');
  }

  const prompt = `You are EverySense Smart Scan AI. Analyze this image of a document (bill, invoice, receipt, education doc, etc.).
Extract key details and output ONLY a raw JSON object with NO markdown or code fences matching this schema:
{
  "documentType": "Electricity bill" | "Water bill" | "Invoice/receipt" | "College/education document" | "General document",
  "title": "Short title describing the document or Not detected",
  "amount": "Total amount with currency symbol or Not detected",
  "dueDate": "Exact due date (e.g. Oct 15, 2026) or Not detected",
  "keyDates": "Any other key dates or Not detected",
  "importantInfo": "Key account numbers, invoice IDs, or critical notes or Not detected",
  "explanation": "2-3 clear, simple sentences explaining what this document is and what action the user needs to take."
}
Rules:
- Select the single best matching documentType from the 5 options.
- If a field is missing, unclear, or not found, set its string value strictly to "Not detected".
- Do NOT invent or hallucinate information.
- Output ONLY valid JSON.`;

  console.error(`[SmartScan Stage 4 - Sending Request to Groq API]: Model=${VISION_MODEL}, PayloadSize=${base64.length}, Timeout=${VISION_TIMEOUT_MS}ms`);

  let response: Response;
  try {
    response = await fetchWithTimeout(
      ENDPOINT,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: VISION_MODEL,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
              ],
            },
          ],
          temperature: 0.2,
          max_tokens: 512,
        }),
      },
      VISION_TIMEOUT_MS,
    );
  } catch (err: any) {
    const elapsed = Date.now() - startTime;
    if (err?.name === 'AbortError') {
      console.error(`[SmartScan Stage 4 AbortError]: Groq API request aborted/timed out after ${elapsed}ms`);
      throw err;
    }
    console.error(`[SmartScan Stage 4 Network Error]: Failed after ${elapsed}ms:`, err?.message || String(err));
    throw err;
  }

  const elapsed = Date.now() - startTime;
  console.error(`[SmartScan Stage 4 - Groq Response Status]: ${response.status} (elapsed=${elapsed}ms)`);

  if (!response.ok) {
    const rawError = await response.text().catch(() => '');
    console.error(`[SmartScan Stage 4 - Groq HTTP ERROR Response Body]: status=${response.status}, errSnippet=${rawError.slice(0, 100)}`);
    let errObj: any = {};
    try { errObj = JSON.parse(rawError); } catch {}
    throw new Error(errObj?.error?.message ?? `Groq Vision HTTP ${response.status}: ${rawError.slice(0, 150)}`);
  }

  const data = await response.json();
  const rawText: string = data?.choices?.[0]?.message?.content ?? '';
  console.error(`[SmartScan Stage 5 - Raw AI Response Content Length]: ${rawText.length}`);

  if (!rawText) {
    console.error('[SmartScan Stage 5 Error]: Groq response choice content was empty!');
    throw new Error('Empty AI response from Smart Scan');
  }

  // Strip JSON markdown formatting if present
  let cleanJson = rawText.trim();
  if (cleanJson.startsWith('```')) {
    cleanJson = cleanJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }

  console.error(`[SmartScan Stage 5 - Clean JSON Length]: ${cleanJson.length}`);

  try {
    const parsed = JSON.parse(cleanJson);
    const validDocTypes = ['Electricity bill', 'Water bill', 'Invoice/receipt', 'College/education document', 'General document'];
    const docType = validDocTypes.includes(parsed.documentType) ? parsed.documentType : 'General document';

    const resultData: SmartScanResultData = {
      documentType: docType as any,
      title: parsed.title || 'Not detected',
      amount: parsed.amount || 'Not detected',
      dueDate: parsed.dueDate || 'Not detected',
      keyDates: parsed.keyDates || 'Not detected',
      importantInfo: parsed.importantInfo || 'Not detected',
      explanation: parsed.explanation || 'No description available for this document.',
    };

    console.error(`[SmartScan Stage 5 - Parsed JSON Result Success]: docType=${resultData.documentType}, title=${resultData.title}, elapsed=${Date.now() - startTime}ms`);
    return resultData;
  } catch (parseError: any) {
    console.error('[SmartScan Stage 5 - JSON Parse Exception]:', parseError?.message || String(parseError));
    return {
      documentType: 'General document',
      title: 'Scanned Document',
      amount: 'Not detected',
      dueDate: 'Not detected',
      keyDates: 'Not detected',
      importantInfo: rawText.slice(0, 100),
      explanation: rawText,
    };
  }
}

