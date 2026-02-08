/**
 * POST /api/share-prayer
 *
 * Stores a prayer as a JSON blob in Vercel Blob Storage.
 * Returns a short shareable URL.
 */

import { put } from '@vercel/blob';

export const config = { runtime: 'edge' };

export default async function handler(request) {
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

    // Generate short ID (8 chars)
    const { customAlphabet } = await import('nanoid');
    const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8);
    const shortId = nanoid();

    const prayerData = {
      prayer,
      imageDataUrl,
      dedicatedTo: dedicatedTo || null,
      createdAt: new Date().toISOString(),
      views: 0
    };

    // Store as a JSON blob in Vercel Blob Storage
    const blob = await put(`prayers/${shortId}.json`, JSON.stringify(prayerData), {
      access: 'public',
      contentType: 'application/json',
    });

    const origin = new URL(request.url).origin;
    const shareUrl = `${origin}/p/${shortId}`;

    console.log(`[share-prayer] Stored ${shortId} → ${blob.url}`);

    return new Response(JSON.stringify({
      success: true,
      shortId,
      shareUrl,
      blobUrl: blob.url
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
