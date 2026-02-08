/**
 * POST /api/share-prayer
 *
 * Stores a prayer in Upstash Redis with 30-day TTL.
 * Returns a short shareable URL.
 *
 * Body: { prayer, imageDataUrl, dedicatedTo? }
 * Returns: { success, shortId, shareUrl }
 */

export const config = { runtime: 'edge' };

export default async function handler(request) {
  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { prayer, imageDataUrl, dedicatedTo } = await request.json();

    if (!prayer || !imageDataUrl) {
      return new Response(JSON.stringify({ error: 'Missing prayer or image data' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Generate short ID (8 chars, URL-safe)
    const { customAlphabet } = await import('nanoid');
    const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8);
    const shortId = nanoid();

    // Store in Upstash Redis with 30-day TTL
    const upstashUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const upstashToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!upstashUrl || !upstashToken) {
      console.error('[share-prayer] Upstash not configured');
      return new Response(JSON.stringify({ error: 'Storage not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const prayerData = {
      prayer,
      imageDataUrl,
      dedicatedTo: dedicatedTo || null,
      createdAt: new Date().toISOString(),
      views: 0
    };

    // SET with EX (expire in 30 days = 2592000 seconds)
    const redisResponse = await fetch(`${upstashUrl}/set/prayer:${shortId}?EX=2592000`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${upstashToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(prayerData),
    });

    if (!redisResponse.ok) {
      const err = await redisResponse.text();
      console.error('[share-prayer] Redis error:', err);
      return new Response(JSON.stringify({ error: 'Failed to store prayer' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const origin = new URL(request.url).origin;
    const shareUrl = `${origin}/p/${shortId}`;

    console.log(`[share-prayer] Stored prayer:${shortId} → ${shareUrl}`);

    return new Response(JSON.stringify({
      success: true,
      shortId,
      shareUrl
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });

  } catch (error) {
    console.error('[share-prayer] Error:', error);
    return new Response(JSON.stringify({ error: 'Internal error', message: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
