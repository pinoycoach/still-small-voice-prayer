/**
 * POST /api/share-prayer
 *
 * Stores a prayer as a JSON blob in Vercel Blob Storage.
 * Returns a short shareable URL.
 *
 * Uses Node.js runtime (not Edge) because @vercel/blob requires Node.js modules.
 */

import { put } from '@vercel/blob';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { prayer, imageDataUrl, dedicatedTo } = req.body;

    if (!prayer || !imageDataUrl) {
      return res.status(400).json({ error: 'Missing prayer or image data' });
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

    // Build share URL from request headers
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const origin = `${protocol}://${host}`;
    const shareUrl = `${origin}/p/${shortId}`;

    console.log(`[share-prayer] Stored ${shortId} → ${blob.url}`);

    return res.status(200).json({
      success: true,
      shortId,
      shareUrl,
      blobUrl: blob.url
    });

  } catch (error) {
    console.error('[share-prayer] Error:', error);
    return res.status(500).json({ error: 'Internal error', message: error.message });
  }
}
