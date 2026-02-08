/**
 * GET /api/get-prayer/[id]
 *
 * Retrieves a prayer from Upstash Redis by short ID.
 * Increments view count.
 *
 * Returns: { success, prayer } or 404 if expired/not found.
 */

export const config = { runtime: 'edge' };

export default async function handler(request) {
  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  // Extract the short ID from the URL path
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/');
  const shortId = pathParts[pathParts.length - 1];

  if (!shortId || shortId.length < 6) {
    return new Response(JSON.stringify({ error: 'Invalid prayer ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const upstashUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!upstashUrl || !upstashToken) {
    return new Response(JSON.stringify({ error: 'Storage not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  try {
    // GET from Redis
    const redisResponse = await fetch(`${upstashUrl}/get/prayer:${shortId}`, {
      headers: { 'Authorization': `Bearer ${upstashToken}` },
    });

    if (!redisResponse.ok) {
      return new Response(JSON.stringify({ error: 'Storage error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const redisData = await redisResponse.json();

    if (!redisData.result) {
      return new Response(JSON.stringify({ error: 'Prayer not found or expired' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Parse prayer data (Upstash returns the value as a string or object)
    let prayerData;
    if (typeof redisData.result === 'string') {
      prayerData = JSON.parse(redisData.result);
    } else {
      prayerData = redisData.result;
    }

    // Increment view count (fire and forget — don't block response)
    const updatedData = { ...prayerData, views: (prayerData.views || 0) + 1 };
    fetch(`${upstashUrl}/set/prayer:${shortId}?KEEPTTL=true`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${upstashToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updatedData),
    }).catch(err => console.error('[get-prayer] Failed to increment views:', err));

    return new Response(JSON.stringify({
      success: true,
      prayer: prayerData
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      },
    });

  } catch (error) {
    console.error('[get-prayer] Error:', error);
    return new Response(JSON.stringify({ error: 'Internal error', message: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
