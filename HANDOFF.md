# Still Small Voice — Prayer App
## Technical Handoff Document

**Live at:** https://stillsmallvoice.xyz
**Repo:** GitHub (private) → Vercel auto-deploy on push
**Stack:** Vite + React 19 + TypeScript (client-side SPA, no backend except one edge function)

---

## What This App Does

A single-screen prayer app that takes what's on someone's heart and returns a sacred letter — a canvas-rendered parchment image with a Scripture verse and a deeply personal prayer, ready to share on WhatsApp, iMessage, Instagram, or any platform. Think of it as a chain letter that brings blessings, not fear.

One input. One output. One button to pass it forward.

---

## Architecture Overview

```
User types prayer request
        │
        ▼
┌─────────────────────────────────────────────────┐
│  INTENT TRANSLATION (Gemini Flash)              │
│  "something to smile about"                     │
│  → "joy, laughter, gladness, merry heart,       │
│     rejoicing, delight, singing"                 │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│  RAG SEARCH (Gemini Embedding → Pinecone)       │
│  31,100 KJV verses indexed at 768 dimensions    │
│  Returns top 5 matches with similarity scores   │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│  PRAYER GENERATION (Gemini 3 Flash)             │
│  RAG verses offered as COUNSEL, not command     │
│  Gemini can override weak matches               │
│  Returns: { theme, scripture, reference, prayer }│
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────┬──────────────────┐
│  SACRED LETTER (Canvas API)  │  TTS (InWorld)   │
│  1080x1920 parchment image   │  MP3 via Luna    │
│  Cross, scripture, prayer,   │  On-demand only   │
│  Amen, watermark, CTA        │  (user clicks    │
│  All client-side rendering   │   Listen button)  │
└──────────────────────────────┴──────────────────┘
                     │
                     ▼
        Web Share API / Clipboard
        "Pass This Prayer Forward"
```

---

## File Structure

```
still-small-voice-prayer/
├── index.html              # Mobile-optimized shell, Tailwind CDN, fade-in CSS
├── index.tsx               # React entry point, exposes GEMINI_API_KEY to window
├── App.tsx                 # THE app — single component, three phases
├── components/
│   └── Spinner.tsx         # Contextual loading spinner with rotating messages
├── services/
│   ├── prayerService.ts    # Prayer generation, canvas rendering, KJV cleanup
│   ├── pineconeService.ts  # RAG pipeline: intent translation → embedding → Pinecone
│   └── inworldService.ts   # InWorld TTS: single API call, returns MP3
├── api/
│   └── inworld-tts.js      # Vercel Edge Function — proxies InWorld API (CORS)
├── vercel.json             # Rewrites: /api/* → edge functions, /* → SPA
├── vite.config.ts          # Vite config with InWorld proxy for local dev
├── package.json            # 3 deps: @google/genai, react, react-dom
├── tsconfig.json
└── .env.local              # API keys (gitignored)
```

---

## User Flow (Three Phases)

### Phase 1: COMPOSING (this IS the landing page — no idle gate)
- Cross ornament + "Still Small Voice" header
- Toggle: **For Me** | **For a Friend**
  - "For Me" → textarea auto-focused, placeholder: "I'm struggling with anxiety..."
  - "For a Friend" → name input appears + textarea, placeholder: "They're going through..."
- Gold **PRAY** button (or "Pray for [Name]" in friend mode)
- Ctrl/Cmd+Enter shortcut to submit
- After first prayer: gentle nudge appears — "Is there someone on your heart today? Pray for a friend →"
- Returning from viewing phase shows acknowledgment: "Your prayer for [Name] was written with love." (fades after 3.5s)

### Phase 2: GENERATING (contextual spinner)
- Spinner with emotionally-matched messages based on keyword detection:
  - Anxiety words → "Finding peace for your worry..."
  - Health words → "Lifting up this need for healing..."
  - Financial words → "Seeking God's word on provision..."
  - Grief words → "Holding this grief gently..."
  - Gratitude words → "Celebrating this gratitude..."
  - 9 emotional categories + generic fallback
- Messages rotate every 3.5 seconds
- Subtext: "This prayer is being written with care."

### Phase 3: VIEWING (letter first, share is primary)
- Sacred letter image displayed (max 70vh, rounded, shadow, gold ring)
- **PRIMARY CTA: "Pass This Prayer Forward"** — full-width gold button with share icon
  - Mobile: triggers native Web Share API (WhatsApp, iMessage, Instagram, etc.)
  - Desktop: copies image to clipboard, shows "Copied to Clipboard!" toast
- **Secondary row (pill buttons):**
  - **Listen** — generates TTS on demand (InWorld Luna voice, MP3), button changes to "Listen Again" after first play
  - **Save** — downloads the letter as PNG
- **"Write Another Prayer"** link at bottom → returns to composing with acknowledgment

---

## The Three-Layer "Wise RAG" Architecture

### Problem Solved
RAG was too rigid — "something to smile about" returned Job 37:11 about clouds scattering. Prayers felt templated, parroted scripture in the body, and lacked the person's emotional register.

### Layer 1: Intent Translation (pineconeService.ts → translateIntentToBiblical)
- Uses Gemini 2.0 Flash to translate colloquial language into biblical concepts BEFORE Pinecone search
- "something to smile about" → "joy, laughter, gladness, merry heart, rejoicing, delight, singing"
- "I'm scared about money" → "provision, daily bread, treasure, mammon, trust, anxiety, needs supplied"
- Bridges the 400-year gap between modern English and KJV language
- Falls back to raw text if translation fails

### Layer 2: RAG as Counsel, Not Command (prayerService.ts → generatePrayerFromRequest)
- Pinecone results are presented as "Scripture verses that may be relevant" — not "YOU MUST USE"
- Confidence scoring based on similarity:
  - >= 75%: "These are strong matches — one likely speaks to what this person needs."
  - >= 55%: "Partial matches. Use if it fits, otherwise choose from your own knowledge."
  - < 55%: "Weak matches. Feel free to choose a better verse."
- Gemini can override weak RAG results with a verse from its own knowledge of Scripture

### Layer 3: No Parroting + Tone Matching (prompt rules in prayerService.ts)
- **No Parroting**: "The verse is displayed separately above the prayer. Drawing on its meaning is beautiful. Copying its words is lazy."
- **Tone Matching**: Precise emotional calibration — light request gets warm/playful prayer, grief gets tender/still, anger gets honest/raw
- **Varied Openings**: Explicit ban on "Father, we come to You today" — 6+ example alternatives provided
- **Voice**: "I/me/my" for self-prayers (one soul speaking to God), "we/us/our" for friend prayers
- **Theme**: Must mirror the person's language, not just the scripture topic

### Post-Generation Validation (advisory, not rigid)
- If Gemini chose a RAG verse → use Pinecone's clean text (strips KJV marginal annotations like {wish: or, pray})
- If Gemini chose its own verse → trust it (log for debugging, don't override)
- cleanKJV() strips {…} translator notes from all scripture text

---

## API Services & Models

| Service | Model | Purpose | Cost |
|---------|-------|---------|------|
| Gemini 3 Flash | gemini-3-flash-preview | Prayer generation (structured JSON output) | ~$0.0001/prayer |
| Gemini 2.0 Flash | gemini-2.0-flash | Intent translation (colloquial → biblical) | ~$0.00005/call |
| Gemini Embedding | gemini-embedding-001 | Query embedding for Pinecone (768 dims) | ~$0.00001/embed |
| Pinecone | Serverless index (kjv namespace) | 31,100 KJV verses, 768-dim vectors | Free tier |
| InWorld AI | inworld-tts-1.5-max, Luna voice | Text-to-speech, returns MP3 | ~$0.001/prayer |

**Total cost per prayer**: ~$0.0003 without audio, ~$0.0013 with audio (~3,000 prayers per dollar without audio)

### Environment Variables (in .env.local, also set in Vercel dashboard)
```
VITE_GEMINI_API_KEY=...
VITE_PINECONE_API_KEY=...
VITE_PINECONE_HOST=...           # Pinecone host (with or without https://)
VITE_INWORLD_API_KEY_BASE64=...  # Pre-encoded Base64 key
VITE_INWORLD_VOICE_ID=Luna
```

---

## Sacred Letter Rendering (Canvas API)

The prayer letter is a 1080x1920 PNG rendered entirely client-side with Canvas API. No AI image generation — pure typography.

**Layout (top to bottom, vertically centered via two-pass measurement):**
1. Cross ornament (thin lines)
2. Decorative top rule
3. Dedication line (friend mode only): "Written for [Name], from a friend who prays"
4. "A PRAYER FOR" — spaced uppercase sans-serif
5. Theme title — large italic serif (e.g., "A Reason to Smile")
6. Thin rule
7. Scripture quote — italic serif, word-wrapped
8. Scripture reference — right-aligned, spaced uppercase
9. Prayer body — regular serif, word-wrapped (Amen stripped here)
10. "Amen." — centered italic
11. Decorative bottom rule
12. "STILL SMALL VOICE" watermark
13. "Pass this prayer forward — stillsmallvoice.xyz" CTA

**Background**: Parchment gradient (#F5F0E1 → #DDD4BC) with 15,000 random noise dots and radial vignette for aged look.

---

## Audio (InWorld TTS)

- **On-demand only** — no audio generated during prayer creation (saves cost and time)
- User clicks "Listen" → calls InWorld TTS → returns base64 MP3 → blob URL → `new Audio(url).play()`
- Single API call handles up to 2000 characters (no chunking needed unlike Gemini TTS)
- Voice: Luna (gentle female voice)
- Speech text format: "[Reference]. [Scripture]. ... [Prayer body] Amen."
- If prayer text doesn't end with "Amen", it's appended automatically
- In production: routed through Vercel Edge Function at /api/inworld-tts (CORS proxy)
- In local dev: routed through Vite proxy at /inworld-api/tts/v1/voice

---

## Sharing & Virality Mechanic

- **Web Share API** (mobile): native share sheet — WhatsApp, iMessage, Instagram Stories, Telegram, etc.
- **Clipboard fallback** (desktop): copies PNG image to clipboard with toast notification
- **CTA baked into every letter image**: "Pass this prayer forward — stillsmallvoice.xyz"
- **Chain letter mechanic**: Every prayer carries the URL. Recipient visits → writes their own prayer → shares → organic growth loop
- **Share button text**: "Pass This Prayer Forward" (primary gold CTA, full-width, always visible first)

---

## Deployment

- **Hosting**: Vercel (auto-deploys from GitHub on push to master)
- **Domain**: stillsmallvoice.xyz
- **Build**: `vite build` → static dist/ folder (~122KB gzipped)
- **Edge Function**: `api/inworld-tts.js` — proxies InWorld TTS API calls (handles CORS)
- **Framework**: Auto-detected as Vite by Vercel

---

## Known Decisions & Trade-offs

1. **Client-side API keys**: All API keys are baked into the client bundle via VITE_ env vars. This is a known trade-off for simplicity — no backend server needed. For production scale, these should move to server-side API routes.

2. **Tailwind via CDN**: Using `<script src="https://cdn.tailwindcss.com">` in index.html rather than PostCSS build. Simple and works, but adds ~100KB to initial load. Could be replaced with a proper Tailwind build for optimization.

3. **No user accounts**: Completely anonymous. No login, no saved prayers, no analytics. Pure simplicity.

4. **No prayer history**: Each prayer is ephemeral — generated, shared, gone. The sacred letter PNG is the only artifact (user can save it).

5. **KJV only**: The RAG index contains only King James Version verses. This was a deliberate choice for the reverent, timeless tone of the letters.

6. **generateSpeech() is dead code**: The old Gemini TTS function still exists in prayerService.ts but is no longer imported or called. Kept as a fallback option if InWorld becomes unavailable.

---

## Improvement Ideas (Not Yet Implemented)

- **OG meta tags for social previews** — when someone shares a stillsmallvoice.xyz link, show a preview card
- **Shareable prayer URLs** — /prayer/[id] routes that show a specific prayer letter (requires storage)
- **Prayer count** — simple counter showing how many prayers have been written ("Join 12,847 prayers")
- **PWA / Add to Home Screen** — service worker for offline-capable app icon
- **Prayer journal** — optional local storage of past prayers (no server needed)
- **Multiple Bible translations** — RAG index for NIV, ESV alongside KJV
- **Voice selection** — let user choose between Luna, Kore, Puck voices
- **Prayer duration slider** — short (40 words) vs standard (80-120) vs extended (200+)
- **Seasonal themes** — Christmas, Easter, Lent prayer styles
- **Rate limiting** — protect API keys from abuse at scale
- **Server-side API routes** — move all API keys to Vercel serverless functions for security
