/**
 * GET /api/get-prayer/[id]
 *
 * Retrieves a prayer from Vercel Blob Storage by short ID.
 * Returns the prayer data or 404 if not found.
 */

import { list } from '@vercel/blob';

export const config = { runtime: 'edge' };

export default async function handler(request) {
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

  const url = new URL(request.url);
  const pathParts = url.pathname.split('/');
  const shortId = pathParts[pathParts.length - 1];

  if (!shortId || shortId.length < 6) {
    return new Response(JSON.stringify({ error: 'Invalid prayer ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  try {
    // Find the blob by prefix
    const { blobs } = await list({ prefix: `prayers/${shortId}.json`, limit: 1 });

    if (!blobs || blobs.length === 0) {
      return new Response(JSON.stringify({ error: 'Prayer not found or expired' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Fetch the actual blob content
    const blobResponse = await fetch(blobs[0].url);
    if (!blobResponse.ok) {
      return new Response(JSON.stringify({ error: 'Failed to retrieve prayer' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const prayerData = await blobResponse.json();

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
