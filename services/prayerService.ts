/**
 * Prayer Service for Still Small Voice — Prayer
 *
 * Handles prayer generation (RAG-grounded), sacred letter rendering,
 * text-to-speech, and KJV text cleanup.
 *
 * Extracted from Sacred Creator Studio's geminiService.ts.
 */

import { GoogleGenAI, Type, Modality } from "@google/genai";
import { searchVersesForPrayer } from "./pineconeService";

/** Retry wrapper for Gemini API calls (handles 503 overload errors) */
const withRetry = async <T>(fn: () => Promise<T>, maxRetries: number = 3): Promise<T> => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const isRetryable = error?.message?.includes('503') || error?.message?.includes('overloaded') || error?.message?.includes('UNAVAILABLE');
      if (isRetryable && attempt < maxRetries) {
        const delay = attempt * 2000;
        console.warn(`[Retry] Attempt ${attempt}/${maxRetries} failed (503), retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
};

const getApiKey = () => {
  return import.meta.env.VITE_GEMINI_API_KEY ||
    import.meta.env.GEMINI_API_KEY ||
    (window as any).GEMINI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.API_KEY ||
    '';
};

/** Strip KJV translator marginal notes like {wish: or, pray} */
export const cleanKJV = (text: string): string =>
  text.replace(/\s*\{[^}]*\}/g, '').replace(/\s{2,}/g, ' ').trim();

export interface PrayerResponse {
  scripture: string;
  scripture_reference: string;
  prayer: string;
  theme: string;
}

export interface LetterOptions {
  dedicatedTo?: string;
}

/**
 * Generate speech audio from text. For longer texts, splits into chunks
 * and concatenates the raw PCM audio to avoid truncation.
 */
export const generateSpeech = async (text: string): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  // Split long text into chunks at sentence boundaries
  const chunks: string[] = [];
  if (text.length <= 500) {
    chunks.push(text);
  } else {
    // Split at sentence endings (. ! ?) keeping under ~500 chars per chunk
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    let current = '';
    for (const sentence of sentences) {
      if ((current + sentence).length > 500 && current) {
        chunks.push(current.trim());
        current = sentence;
      } else {
        current += sentence;
      }
    }
    if (current.trim()) chunks.push(current.trim());
  }

  console.log(`[TTS] Text is ${text.length} chars, split into ${chunks.length} chunk(s)`);

  // Generate audio for each chunk
  const audioChunks: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    console.log(`[TTS] Chunk ${i + 1}/${chunks.length}: ${chunks[i].length} chars`);
    const response = await withRetry(() => ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `Read with profound stillness, warmth, and grace. A soft, wise female voice: ${chunks[i]}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
        },
      },
    }));
    const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
    if (audioData) {
      audioChunks.push(audioData);
      console.log(`[TTS] Chunk ${i + 1}: ${audioData.length} base64 chars`);
    }
  }

  if (audioChunks.length === 0) return "";

  // If single chunk, return directly
  if (audioChunks.length === 1) return audioChunks[0];

  // Concatenate PCM audio chunks (raw Int16 samples at 24kHz)
  const buffers = audioChunks.map(chunk => {
    const binary = atob(chunk);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  });
  const totalLength = buffers.reduce((sum, b) => sum + b.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const buf of buffers) {
    combined.set(buf, offset);
    offset += buf.length;
  }

  // Convert back to base64
  let base64 = '';
  const chunkSize = 8192;
  for (let i = 0; i < combined.length; i += chunkSize) {
    base64 += String.fromCharCode(...combined.subarray(i, Math.min(i + chunkSize, combined.length)));
  }
  const result = btoa(base64);
  console.log(`[TTS] Combined ${audioChunks.length} chunks: ${result.length} base64 chars total`);
  return result;
};

export const generatePrayerFromRequest = async (request: string, mode: 'self' | 'friend' = 'self'): Promise<PrayerResponse> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });
  const schema = {
    type: Type.OBJECT,
    properties: {
      scripture: { type: Type.STRING },
      scripture_reference: { type: Type.STRING },
      prayer: { type: Type.STRING },
      theme: { type: Type.STRING },
    },
    required: ["scripture", "scripture_reference", "prayer", "theme"]
  };

  // RAG: Search Pinecone for semantically relevant Bible verses
  // These serve as COUNSEL — inspiration, not a cage
  let ragContext = '';
  let ragVerses: { reference: string; text: string; score: number }[] = [];
  try {
    const ragResult = await searchVersesForPrayer(request, 5);
    if (ragResult.results.length > 0) {
      ragVerses = ragResult.results.map(v => ({ reference: v.reference, text: v.text, score: v.score }));
      const bestScore = ragResult.results[0].score;

      // Signal confidence level to Gemini based on relevance scores
      const confidenceNote = bestScore >= 0.75
        ? 'These are strong matches — one of them likely speaks to what this person needs.'
        : bestScore >= 0.55
          ? 'These are partial matches. Use one if it genuinely fits, but if none truly speak to their heart, you may choose a different verse from your knowledge of Scripture.'
          : 'These matches are weak. Feel free to choose a verse that better fits their need from your own knowledge of Scripture. The retrieved verses are only suggestions.';

      ragContext = `

Scripture verses that may be relevant (use the best fit, or find a better one if none truly match):
${ragResult.results.map((v, i) => `  ${i + 1}. ${v.reference} (relevance: ${(v.score * 100).toFixed(0)}%): "${v.text}"`).join('\n')}

${confidenceNote}`;
      console.log(`[RAG->Prayer] Found ${ragResult.results.length} verses, best: ${ragResult.results[0].reference} (${ragResult.results[0].score.toFixed(3)}), confidence: ${bestScore >= 0.75 ? 'HIGH' : bestScore >= 0.55 ? 'MEDIUM' : 'LOW'}`);
    }
  } catch (error) {
    console.warn('[RAG->Prayer] Pinecone search failed, Gemini will select verse from its knowledge:', error);
  }

  // Voice guidance: I/me/my for self, we/us/our for friend
  const voiceGuide = mode === 'self'
    ? `VOICE: Write in "I / me / my" voice — this is a deeply personal prayer for the person themselves. One soul speaking to God. NOT "we" or "us" — this person came alone. Do NOT use "they", "them", "this person", "this dear soul" or any third-person language.`
    : `VOICE: Write in "we / us / our" voice — this prayer is being written for someone else. Use their name naturally. Example: "Lord, surround [name] with Your peace..." "We bring [name] before You..."`;

  const response = await withRetry(() => ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `You are a gentle, wise prayer minister — not a theologian, not a robot. Someone has come to you with something on their heart. Your job is to write a prayer that makes them feel HEARD.

The person's prayer request: "${request}"

${voiceGuide}
${ragContext}

Write a prayer that directly addresses what this person asked for. The Scripture supports — it does not lead.

CRITICAL RULES:

1. THE PERSON'S WORDS COME FIRST. Their request is more important than any Scripture match. If they asked for "something to smile about" — the prayer must be about joy, delight, laughter. Period.

2. NEVER repeat the Scripture text inside the prayer body. The verse is displayed separately above the prayer on the letter. Drawing on its meaning is beautiful. Copying its words is lazy. Let the spirit of the verse breathe through your prayer naturally without restating it.

3. VARY YOUR OPENINGS. Never start with "Father, we come to You today" or any variation of "we come before You." Use diverse, natural, surprising openings:
   - "Lord, today I'm just asking for..."
   - "God, You know what's been weighing on my heart..."
   - "Jesus, I need..."
   - "Father, thank You for..."
   - "Holy Spirit, meet me in this moment..."
   - Or start with the request itself: "I just need a reason to smile today, Lord."
   - A prayer can start with a statement, a question, a confession, a thanks.
   - Surprise me. Make it feel like a real person talking to God, not a template.

4. MATCH THE EMOTIONAL TONE of the request precisely:
   - Light/casual request ("something to smile about") -> warm, gentle, maybe even playful prayer
   - Heavy/grief request ("I lost my mom") -> tender, still, reverent prayer. No toxic positivity.
   - Anxious request ("I'm scared about money") -> steady, reassuring, grounding prayer
   - Grateful request ("thank you for today") -> celebratory, joyful prayer
   - Angry/frustrated request ("I'm so tired of this") -> honest, raw, direct-with-God prayer
   - Quiet/uncertain request ("I don't know what to pray") -> gentle, meet them in the silence

5. SOUL — Name their specific situation. Use the details they gave you. This prayer should feel like it could only have been written for this one person. No generic "bless them" language. No platitudes. End with a quiet declaration of trust or hope.

OUTPUT (JSON):
1. 'theme': A 2-5 word title that mirrors the PERSON'S language and feelings, not just the scripture topic. If they said "smile" the theme should have warmth. If they said "scared" the theme should have safety.

2. 'scripture': The FULL TEXT of a Bible verse (KJV) that truly speaks to what they need. Choose the verse that best answers the cry of their heart — whether from the suggestions above or from your own deep knowledge of Scripture. Write the complete verse text.

3. 'scripture_reference': The verse reference (e.g. "Philippians 4:6-7").

4. 'prayer': A deeply personal, intimate prayer (80-120 words). Every word should earn its place. No hashtags, no emojis. Write like a handwritten letter from a dear friend who truly prays.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: schema as any
    }
  }));

  const prayer: PrayerResponse = JSON.parse(response.text || '{}');

  // POST-GENERATION: Advisory validation — clean up scripture text but don't force-override Gemini's choice
  if (ragVerses.length > 0) {
    const matchedVerse = ragVerses.find(v =>
      prayer.scripture_reference.includes(v.reference) ||
      v.reference.includes(prayer.scripture_reference) ||
      prayer.scripture_reference.split(' ')[0] === v.reference.split(' ')[0]
    );

    if (matchedVerse) {
      // Gemini chose a RAG verse — use the clean Pinecone text (avoids KJV annotation artifacts)
      console.log(`[Validation] Scripture "${prayer.scripture_reference}" matches RAG. Using Pinecone's clean text.`);
      prayer.scripture = cleanKJV(matchedVerse.text);
      prayer.scripture_reference = matchedVerse.reference;
    } else {
      // Gemini chose its own verse — trust its judgment, it may have found a better fit
      console.log(`[Validation] Gemini chose "${prayer.scripture_reference}" (not in RAG results). Trusting Gemini's selection.`);
      prayer.scripture = cleanKJV(prayer.scripture);
    }
  } else {
    // No RAG results at all — clean whatever Gemini returned
    prayer.scripture = cleanKJV(prayer.scripture);
  }

  return prayer;
};

/** Helper: word-wrap text for canvas rendering */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";
  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

/**
 * Renders a prayer as a sacred letter / scribe-style image.
 * Parchment background with elegant serif typography.
 * Two-pass approach: measure content first, then vertically center on 1080x1920 canvas.
 */
export const renderSacredLetter = (prayer: PrayerResponse, options: LetterOptions = {}): Promise<string> => {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    const width = 1080;
    const height = 1920;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return reject(new Error("Canvas context failed"));

    const marginX = 100;
    const contentWidth = width - marginX * 2;
    const centerX = width / 2;
    const hasDedication = !!options.dedicatedTo?.trim();

    // --- PASS 1: Measure content height ---
    let prayerText = cleanKJV(prayer.prayer.replace(/\s*Amen\.?\s*$/i, "").trim());
    const cleanScripture = cleanKJV(prayer.scripture);
    ctx.font = `italic 26px "Georgia", "Times New Roman", serif`;
    const scriptureLines = wrapText(ctx, `"${cleanScripture}"`, contentWidth - 40);
    ctx.font = `28px "Georgia", "Times New Roman", serif`;
    const prayerLines = wrapText(ctx, prayerText, contentWidth - 20);

    const contentHeight =
      30 +   // cross ornament
      40 +   // gap to top line
      (hasDedication ? 50 : 0) +
      60 +   // "A PRAYER FOR" + theme
      30 +   // line under theme
      60 +   // gap to scripture
      (scriptureLines.length * 38) +
      15 +   // gap to reference
      70 +   // gap to prayer body
      (prayerLines.length * 42) +
      40 +   // gap to Amen
      32 +   // Amen text
      60 +   // gap to ornament line
      50 +   // watermark
      30 +   // CTA line
      20;    // bottom padding

    const offsetY = Math.max(80, Math.floor((height - contentHeight) / 2));

    // --- PASS 2: Draw everything ---

    // Parchment background
    const bgGradient = ctx.createLinearGradient(0, 0, 0, height);
    bgGradient.addColorStop(0, "#F5F0E1");
    bgGradient.addColorStop(0.3, "#EDE5D0");
    bgGradient.addColorStop(0.7, "#E8DFC8");
    bgGradient.addColorStop(1, "#DDD4BC");
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, width, height);

    // Subtle texture noise
    for (let i = 0; i < 15000; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      const alpha = Math.random() * 0.04;
      ctx.fillStyle = `rgba(139, 119, 80, ${alpha})`;
      ctx.fillRect(x, y, 1, 1);
    }

    // Aged edges vignette
    const vignetteGradient = ctx.createRadialGradient(
      centerX, height / 2, height * 0.35,
      centerX, height / 2, height * 0.75
    );
    vignetteGradient.addColorStop(0, "rgba(0,0,0,0)");
    vignetteGradient.addColorStop(1, "rgba(80, 60, 30, 0.15)");
    ctx.fillStyle = vignetteGradient;
    ctx.fillRect(0, 0, width, height);

    let y = offsetY;

    // Cross ornament
    ctx.strokeStyle = "rgba(140, 110, 55, 0.5)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(centerX, y);
    ctx.lineTo(centerX, y + 30);
    ctx.moveTo(centerX - 12, y + 15);
    ctx.lineTo(centerX + 12, y + 15);
    ctx.stroke();
    y += 40;

    // Top ornament line
    ctx.strokeStyle = "rgba(160, 130, 70, 0.4)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(marginX + 60, y);
    ctx.lineTo(width - marginX - 60, y);
    ctx.stroke();
    y += 50;

    // Dedication line (if praying for a friend)
    if (hasDedication) {
      ctx.fillStyle = "#8A7040";
      ctx.textAlign = "center";
      ctx.font = `italic 20px "Georgia", "Times New Roman", serif`;
      ctx.fillText(`Written for ${options.dedicatedTo}, from a friend who prays`, centerX, y);
      y += 50;
    }

    // "A PRAYER FOR"
    ctx.fillStyle = "#8A7040";
    ctx.textAlign = "center";
    ctx.font = `600 14px "Segoe UI", Arial, sans-serif`;
    ctx.letterSpacing = "8px";
    ctx.fillText(`A  P R A Y E R  F O R`, centerX, y);
    ctx.letterSpacing = "0px";
    y += 55;

    // Theme title
    ctx.fillStyle = "#4A3A1A";
    ctx.font = `italic 42px "Georgia", "Times New Roman", serif`;
    ctx.fillText(prayer.theme, centerX, y);
    y += 35;

    // Thin line under theme
    ctx.strokeStyle = "rgba(160, 130, 70, 0.3)";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(marginX + 120, y);
    ctx.lineTo(width - marginX - 120, y);
    ctx.stroke();
    y += 55;

    // Scripture quote
    ctx.textAlign = "left";
    ctx.fillStyle = "#5A4A25";
    ctx.font = `italic 26px "Georgia", "Times New Roman", serif`;
    for (const line of scriptureLines) {
      ctx.fillText(line, marginX + 20, y);
      y += 38;
    }

    // Scripture reference
    y += 15;
    ctx.textAlign = "right";
    ctx.fillStyle = "#8A7040";
    ctx.font = `600 18px "Segoe UI", Arial, sans-serif`;
    ctx.letterSpacing = "3px";
    ctx.fillText(`\u2014 ${prayer.scripture_reference}`, width - marginX - 20, y);
    ctx.letterSpacing = "0px";

    // Prayer body
    y += 70;
    ctx.textAlign = "left";
    ctx.fillStyle = "#3A2E15";
    ctx.font = `28px "Georgia", "Times New Roman", serif`;
    for (const line of prayerLines) {
      ctx.fillText(line, marginX + 10, y);
      y += 42;
    }

    // Amen
    y += 40;
    ctx.textAlign = "center";
    ctx.fillStyle = "#6A5A30";
    ctx.font = `italic 32px "Georgia", "Times New Roman", serif`;
    ctx.fillText("Amen.", centerX, y);

    // Footer ornament
    y += 60;
    ctx.strokeStyle = "rgba(160, 130, 70, 0.3)";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(marginX + 120, y);
    ctx.lineTo(width - marginX - 120, y);
    ctx.stroke();

    // Watermark
    ctx.fillStyle = "rgba(100, 80, 35, 0.45)";
    ctx.font = `600 12px "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.letterSpacing = "6px";
    ctx.fillText("S T I L L   S M A L L   V O I C E", centerX, y + 50);
    ctx.letterSpacing = "0px";

    // Sharing CTA
    ctx.fillStyle = "rgba(120, 100, 50, 0.35)";
    ctx.font = `italic 16px "Georgia", "Times New Roman", serif`;
    ctx.fillText("Pass this prayer forward \u2014 stillsmallvoice.app", centerX, y + 80);

    resolve(canvas.toDataURL("image/png", 0.95));
  });
};
