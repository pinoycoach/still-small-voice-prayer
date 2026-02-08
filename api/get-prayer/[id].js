/**
 * GET /api/get-prayer/[id]
 *
 * Retrieves a prayer from Vercel Blob Storage by short ID.
 * Returns the prayer data or 404 if not found.
 *
 * Uses Node.js runtime (not Edge) because @vercel/blob requires Node.js modules.
 */

import { list } from '@vercel/blob';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const shortId = req.query.id;

  if (!shortId || shortId.length < 6) {
    return res.status(400).json({ error: 'Invalid prayer ID' });
  }

  try {
    // Find the blob by prefix
    const { blobs } = await list({ prefix: `prayers/${shortId}.json`, limit: 1 });

    if (!blobs || blobs.length === 0) {
      return res.status(404).json({ error: 'Prayer not found or expired' });
    }

    // Fetch the actual blob content
    const blobResponse = await fetch(blobs[0].url);
    if (!blobResponse.ok) {
      return res.status(500).json({ error: 'Failed to retrieve prayer' });
    }

    const prayerData = await blobResponse.json();

    // Set cache headers
    res.setHeader('Cache-Control', 'public, max-age=3600');

    return res.status(200).json({
      success: true,
      prayer: prayerData
    });

  } catch (error) {
    console.error('[get-prayer] Error:', error);
    return res.status(500).json({ error: 'Internal error', message: error.message });
  }
}
