/**
 * InWorld TTS Service for Still Small Voice — Prayer
 *
 * Generates speech audio using InWorld AI's TTS API.
 * Returns base64-encoded MP3 — fast, single-call, no chunking needed.
 *
 * Ported from the Still Small Voice main app.
 */

interface InworldTTSConfig {
  apiKeyBase64: string;
  voice: string;
}

/** Use Vite proxy in dev, Vercel API route in production */
const getEndpoint = () => {
  const isLocalDev = typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  return isLocalDev ? '/inworld-api/tts/v1/voice' : '/api/inworld-tts';
};

/** Retry with exponential backoff for 5xx and network errors */
async function retry<T>(fn: () => Promise<T>, maxAttempts = 3, delayMs = 1000): Promise<T> {
  let attempts = 0;
  while (true) {
    try {
      return await fn();
    } catch (error: any) {
      attempts++;
      const isRetryable =
        (error.response?.status >= 500) ||
        (!error.response && error.message === 'Failed to fetch');
      if (attempts >= maxAttempts || !isRetryable) throw error;
      const wait = delayMs * Math.pow(2, attempts - 1);
      console.warn(`[InWorld TTS] Attempt ${attempts}/${maxAttempts} failed, retrying in ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

/**
 * Generate speech audio from text using InWorld TTS.
 * Returns base64-encoded MP3 audio.
 */
export async function generateInworldTTS(text: string): Promise<string> {
  const apiKeyBase64 = import.meta.env.VITE_INWORLD_API_KEY_BASE64 || '';
  const voice = import.meta.env.VITE_INWORLD_VOICE_ID || 'Luna';

  if (!apiKeyBase64) {
    throw new Error('InWorld API key not configured (VITE_INWORLD_API_KEY_BASE64)');
  }

  // InWorld supports up to 2000 chars — more than enough for prayer + scripture
  const truncated = text.length > 2000 ? text.substring(0, 2000) : text;
  const endpoint = getEndpoint();

  console.log(`[InWorld TTS] Generating audio: ${truncated.length} chars, voice: ${voice}`);

  const response = await retry(async () => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${apiKeyBase64}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: truncated,
        voice_id: voice,
        audio_config: {
          audio_encoding: 'MP3',
          speaking_rate: 1
        },
        temperature: 0.93,
        model_id: 'inworld-tts-1.5-max'
      }),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      console.error('[InWorld TTS] Error:', res.status, errorBody);
      const error: any = new Error(`InWorld TTS error: ${res.status} ${res.statusText}`);
      error.response = res;
      throw error;
    }
    return res;
  });

  const result = await response.json();

  // Extract audio from response (handles multiple response formats)
  const audioContent = result.audioContent || result.audio || result.data?.audioContent;
  if (!audioContent || audioContent.length < 100) {
    throw new Error('InWorld TTS returned no valid audio');
  }

  console.log(`[InWorld TTS] Audio received: ${audioContent.length} base64 chars`);
  return audioContent;
}
