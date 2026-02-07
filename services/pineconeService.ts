/**
 * Pinecone RAG Service for Still Small Voice — Prayer
 *
 * Semantic Bible verse retrieval using Gemini embeddings + Pinecone vectors.
 * Searches 31,100 KJV verses by meaning, not just keywords.
 *
 * Ported from Still Small Voice app — adapted for client-side Vite use.
 */

export interface RetrievedVerse {
  reference: string;   // e.g., "John 3:16"
  text: string;        // Full verse text
  book: string;
  chapter: number;
  verse: number;
  score: number;       // Similarity score (0-1)
}

export interface RAGSearchResult {
  query: string;
  results: RetrievedVerse[];
  totalFound: number;
}

const API_TIMEOUT_MS = 15000;

const getPineconeConfig = () => {
  const apiKey = import.meta.env.VITE_PINECONE_API_KEY || process.env.PINECONE_API_KEY;
  const rawHost = import.meta.env.VITE_PINECONE_HOST || process.env.PINECONE_HOST || '';
  const host = rawHost.replace(/^https?:\/\//, ''); // Normalize: remove protocol
  return { apiKey, host };
};

const getGeminiKey = () => {
  return import.meta.env.VITE_GEMINI_API_KEY ||
    import.meta.env.GEMINI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    '';
};

/**
 * Generate an embedding vector for a text query using Gemini text-embedding-004
 */
async function embedQuery(text: string, signal?: AbortSignal): Promise<number[]> {
  const geminiKey = getGeminiKey();
  if (!geminiKey) throw new Error('Gemini API key not configured for embeddings');

  // Use gemini-embedding-001 (text-embedding-004 was shut down Jan 2026)
  // Request 768 dimensions to match existing Pinecone index (built with text-embedding-004)
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/gemini-embedding-001',
        content: { parts: [{ text }] },
        outputDimensionality: 768  // MRL: match Pinecone index dimension
      }),
      signal
    }
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    console.error('[RAG] Embedding error:', err);
    throw new Error('Failed to generate query embedding');
  }

  const data = await response.json();
  return data.embedding.values;
}

/**
 * Query Pinecone for semantically similar Bible verses
 */
async function queryPinecone(
  vector: number[],
  topK: number = 5,
  filter?: Record<string, any>,
  signal?: AbortSignal
): Promise<RetrievedVerse[]> {
  const { apiKey, host } = getPineconeConfig();
  if (!apiKey || !host) throw new Error('Pinecone not configured');

  const body: any = {
    vector,
    topK: Math.min(topK, 10),
    namespace: 'kjv',
    includeMetadata: true
  };
  if (filter) body.filter = filter;

  const response = await fetch(`https://${host}/query`, {
    method: 'POST',
    headers: {
      'Api-Key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    console.error('[RAG] Pinecone error:', err);
    throw new Error('Failed to search vector database');
  }

  const data = await response.json();
  return (data.matches || []).map((match: any) => ({
    reference: match.metadata?.reference || match.id,
    text: match.metadata?.text || '',
    book: match.metadata?.book || '',
    chapter: match.metadata?.chapter || 0,
    verse: match.metadata?.verse || 0,
    score: match.score || 0
  }));
}

/**
 * Search for Bible verses semantically similar to a query.
 * Full pipeline: text -> Gemini embedding -> Pinecone search -> ranked verses.
 */
export async function searchVerses(
  query: string,
  options: { topK?: number; filter?: Record<string, any> } = {}
): Promise<RAGSearchResult> {
  if (!query || query.trim().length === 0) {
    throw new Error('Query must be a non-empty string');
  }

  const { topK = 5, filter } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    console.log(`[RAG] Searching 31,100 KJV verses for: "${query.substring(0, 80)}..."`);

    // Step 1: Embed the query
    const vector = await embedQuery(query.trim(), controller.signal);

    // Step 2: Search Pinecone
    const results = await queryPinecone(vector, topK, filter, controller.signal);

    clearTimeout(timeoutId);

    // Log top matches
    console.log(`[RAG] Found ${results.length} matches:`);
    results.forEach((v, i) => {
      console.log(`[RAG]   ${i + 1}. ${v.reference} (${v.score.toFixed(3)}) — "${v.text.substring(0, 50)}..."`);
    });

    return { query, results, totalFound: results.length };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('RAG search timed out');
    }
    throw error;
  }
}

/**
 * Translate a colloquial prayer request into biblical concepts.
 * "Something to smile about" → "joy, laughter, gladness, merry heart, rejoicing, delight"
 * This bridges the gap between modern language and 400-year-old KJV text.
 */
export async function translateIntentToBiblical(prayerRequest: string): Promise<string> {
  const geminiKey = getGeminiKey();
  if (!geminiKey) return prayerRequest; // Fallback to raw text

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `A person wrote this prayer request: "${prayerRequest}"

Translate their intent into biblical/spiritual concepts that would appear in the King James Bible. Output ONLY a comma-separated list of 5-8 biblical keywords and phrases. No explanation.

Examples:
- "something to smile about" → "joy, laughter, gladness, merry heart, rejoicing, delight, singing"
- "I'm scared about money" → "provision, daily bread, treasure, mammon, trust, anxiety, needs supplied"
- "I miss my mom" → "comfort in grief, mourning, loss, brokenhearted, nearness of God, wiping tears"
- "I can't sleep" → "rest, peace, sleep, safety, lying down, quietness, trust in the night"

Now translate: "${prayerRequest}"` }] }]
        })
      }
    );

    if (!response.ok) return prayerRequest;
    const data = await response.json();
    const translated = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || prayerRequest;
    console.log(`[RAG] Intent translation: "${prayerRequest.substring(0, 50)}..." → "${translated}"`);
    return translated;
  } catch (e) {
    console.warn('[RAG] Intent translation failed, using raw text:', e);
    return prayerRequest;
  }
}

/**
 * Search verses using a prayer request context.
 * Step 1: Translate colloquial request into biblical concepts
 * Step 2: Embed the enriched query and search Pinecone
 */
export async function searchVersesForPrayer(
  prayerRequest: string,
  topK: number = 5
): Promise<RAGSearchResult> {
  console.log('[RAG] ═══════════════════════════════════════');
  console.log('[RAG] PRAYER CONTEXT SEARCH:');
  console.log(`[RAG]   Raw request: "${prayerRequest.substring(0, 80)}..."`);

  // Step 1: Translate intent to biblical language
  const biblicalConcepts = await translateIntentToBiblical(prayerRequest);

  // Step 2: Build enriched query using biblical concepts
  const query = `Bible verses about ${biblicalConcepts}. Scripture for someone who needs ${biblicalConcepts}.`;

  console.log(`[RAG]   Biblical concepts: "${biblicalConcepts}"`);
  console.log(`[RAG]   Search query: "${query.substring(0, 100)}..."`);
  console.log('[RAG] ═══════════════════════════════════════');

  return searchVerses(query, { topK });
}

/**
 * Check if RAG (Pinecone) is available and configured.
 */
export async function isRAGAvailable(): Promise<boolean> {
  try {
    const { apiKey, host } = getPineconeConfig();
    if (!apiKey || !host) return false;
    const result = await searchVerses('peace', { topK: 1 });
    return result.totalFound > 0;
  } catch {
    return false;
  }
}
