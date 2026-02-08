import React, { useState, useRef, useEffect } from 'react';
import { generatePrayerFromRequest, renderSacredLetter, cleanKJV, PrayerResponse, LetterOptions } from './services/prayerService';
import { generateInworldTTS } from './services/inworldService';
import Spinner from './components/Spinner';

type AppPhase = 'composing' | 'generating' | 'viewing';

/** Check if current URL is a shared prayer link: /p/[id] */
const getSharedPrayerId = (): string | null => {
  const match = window.location.pathname.match(/^\/p\/([a-z0-9]{6,12})$/);
  return match ? match[1] : null;
};

/** Extract emotional keywords from prayer text for contextual spinner messages */
const getContextualMessages = (text: string): string[] => {
  const lower = text.toLowerCase();
  const base = ["Searching Scripture...", "Writing with care..."];

  if (lower.match(/anxious|anxiety|worry|worried|fear|afraid|scared/))
    return ["Finding peace for your worry...", "Searching for words of comfort...", ...base];
  if (lower.match(/sick|illness|healing|health|hospital|cancer|pain/))
    return ["Lifting up this need for healing...", "Finding Scripture for strength...", ...base];
  if (lower.match(/money|job|work|provision|financial|rent|bills/))
    return ["Seeking God's word on provision...", "Finding comfort for this burden...", ...base];
  if (lower.match(/lonely|alone|grief|loss|died|death|mourning/))
    return ["Holding this grief gently...", "Finding words for the weight you carry...", ...base];
  if (lower.match(/marriage|relationship|divorce|family|husband|wife|child/))
    return ["Searching for wisdom in relationships...", "Finding Scripture for your family...", ...base];
  if (lower.match(/thank|grateful|gratitude|blessed|praise|joy/))
    return ["Celebrating this gratitude...", "Finding a song of praise...", ...base];
  if (lower.match(/guidance|direction|decision|confused|lost|purpose/))
    return ["Seeking divine direction...", "Finding light for your path...", ...base];
  if (lower.match(/forgive|forgiveness|guilt|shame|sorry/))
    return ["Finding grace for this moment...", "Searching for words of restoration...", ...base];
  if (lower.match(/strength|tired|exhausted|overwhelmed|burnout|weary/))
    return ["Finding strength for the weary...", "Seeking rest for your spirit...", ...base];

  return ["Listening to your heart...", "Finding the right words...", "Weaving Scripture into prayer...", "Preparing your sacred letter...", ...base];
};

// ══════════════════════════════════════════════════════════════
// SHARED PRAYER VIEWER — shown when visiting /p/[id]
// ══════════════════════════════════════════════════════════════

const SharedPrayerViewer: React.FC<{ prayerId: string }> = ({ prayerId }) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [theme, setTheme] = useState<string>('');
  const [dedicatedTo, setDedicatedTo] = useState<string | null>(null);
  const [views, setViews] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const fetchPrayer = async () => {
      try {
        const res = await fetch(`/api/get-prayer/${prayerId}`);
        if (!res.ok) { setNotFound(true); setLoading(false); return; }
        const data = await res.json();
        if (!data.success || !data.prayer) { setNotFound(true); setLoading(false); return; }

        setImageUrl(data.prayer.imageDataUrl);
        setTheme(data.prayer.prayer?.theme || '');
        setDedicatedTo(data.prayer.dedicatedTo || null);
        setViews(data.prayer.views || 0);
      } catch {
        setNotFound(true);
      }
      setLoading(false);
    };
    fetchPrayer();
  }, [prayerId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center">
        <p className="text-[#C9A050] italic animate-pulse">Loading prayer...</p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center px-6 text-center font-serif">
        <div className="text-[#C9A050]/30 text-2xl mb-4">&#10013;</div>
        <h1 className="text-2xl font-black text-[#C9A050] mb-2">Prayer Not Found</h1>
        <p className="text-gray-500 text-sm mb-8 italic">
          This prayer may have expired or the link is incorrect.
        </p>
        <a
          href="/"
          className="bg-[#C9A050] text-black px-6 py-3 rounded-xl font-black uppercase tracking-widest text-sm hover:scale-[1.02] transition-transform shadow-2xl shadow-[#C9A050]/20"
        >
          Write a Prayer
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-[#E0D7C6] font-serif flex flex-col items-center justify-center px-6 py-8">
      <div className="w-full max-w-lg flex flex-col items-center space-y-6 animate-fade-in">

        {/* Dedication context */}
        {dedicatedTo && (
          <p className="text-[11px] italic text-[#C9A050]/60 tracking-wide">
            A prayer written for {dedicatedTo}
          </p>
        )}

        {/* Sacred letter image */}
        {imageUrl && (
          <img
            src={imageUrl}
            alt={`Prayer: ${theme}`}
            className="w-full max-h-[70vh] object-contain rounded-lg shadow-2xl border border-white/10 ring-1 ring-[#C9A050]/20"
          />
        )}

        {/* View count (subtle) */}
        {views > 1 && (
          <p className="text-gray-600 text-[10px] italic">
            This prayer has been viewed {views} {views === 1 ? 'time' : 'times'}
          </p>
        )}

        {/* CTA — Write Your Own */}
        <a
          href="/"
          className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-[#C9A050] text-black rounded-xl font-black uppercase tracking-widest text-sm hover:scale-[1.02] transition-transform shadow-2xl shadow-[#C9A050]/20"
        >
          Write Your Own Prayer
        </a>

        <p className="text-center text-gray-600 text-[10px] italic">
          Someone prayed for you today. Pass the blessing forward.
        </p>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════
// MAIN APP — prayer creation flow
// ══════════════════════════════════════════════════════════════

const App: React.FC = () => {
  // Check if this is a shared prayer URL
  const [sharedPrayerId] = useState<string | null>(getSharedPrayerId);

  // If viewing a shared prayer, render the viewer instead of the main app
  if (sharedPrayerId) {
    return <SharedPrayerViewer prayerId={sharedPrayerId} />;
  }

  return <PrayerCreator />;
};

const PrayerCreator: React.FC = () => {
  // Flow state — starts at composing, no idle gate
  const [phase, setPhase] = useState<AppPhase>('composing');

  // Prayer input
  const [prayerRequest, setPrayerRequest] = useState('');
  const [prayerMode, setPrayerMode] = useState<'self' | 'friend'>('self');
  const [friendName, setFriendName] = useState('');

  // Results
  const [prayerResult, setPrayerResult] = useState<{
    prayer: PrayerResponse;
    imageUrl: string;
    speechText: string;
    forFriend?: string;
  } | null>(null);

  // Share URL (generated after prayer creation)
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  // Audio (InWorld returns MP3 — simple playback)
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // UI feedback
  const [error, setError] = useState<string | null>(null);
  const [loadingMessages, setLoadingMessages] = useState<string[]>(getContextualMessages(''));
  const [loadingMessage, setLoadingMessage] = useState('');
  const [shareToast, setShareToast] = useState(false);
  const [sentAcknowledgment, setSentAcknowledgment] = useState<string | null>(null);

  const messageIntervalRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-focus textarea on mount and on return to composing
  useEffect(() => {
    if (phase === 'composing' && textareaRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [phase]);

  // Rotate contextual loading messages during generation
  useEffect(() => {
    if (phase === 'generating') {
      let idx = 0;
      setLoadingMessage(loadingMessages[0]);
      messageIntervalRef.current = window.setInterval(() => {
        idx = (idx + 1) % loadingMessages.length;
        setLoadingMessage(loadingMessages[idx]);
      }, 3500);
    } else if (messageIntervalRef.current) {
      clearInterval(messageIntervalRef.current);
    }
    return () => { if (messageIntervalRef.current) clearInterval(messageIntervalRef.current); };
  }, [phase, loadingMessages]);

  // Fade out the sent acknowledgment after 3 seconds
  useEffect(() => {
    if (sentAcknowledgment) {
      const timer = setTimeout(() => setSentAcknowledgment(null), 3500);
      return () => clearTimeout(timer);
    }
  }, [sentAcknowledgment]);

  // --- Core Actions ---

  const handlePray = async () => {
    if (!prayerRequest.trim()) return;
    if (prayerMode === 'friend' && !friendName.trim()) return;

    setLoadingMessages(getContextualMessages(prayerRequest));
    setPhase('generating');
    setError(null);
    setShareUrl(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }

    const currentFriendName = friendName.trim();

    try {
      const requestText = prayerMode === 'friend'
        ? `I'm praying for my friend ${currentFriendName}. ${prayerRequest}`
        : prayerRequest;

      const prayer = await generatePrayerFromRequest(requestText, prayerMode);

      const letterOptions: LetterOptions = prayerMode === 'friend'
        ? { dedicatedTo: currentFriendName }
        : {};
      const imageUrl = await renderSacredLetter(prayer, letterOptions);

      const prayerBody = cleanKJV(prayer.prayer);
      const speechText = `${prayer.scripture_reference}. ${cleanKJV(prayer.scripture)}. ... ${prayerBody}${/amen\.?\s*$/i.test(prayerBody) ? '' : ' Amen.'}`;

      setPrayerResult({
        prayer, imageUrl, speechText,
        forFriend: prayerMode === 'friend' ? currentFriendName : undefined
      });
      setPhase('viewing');
      setPrayerRequest('');
      setFriendName('');

      // Generate shareable URL in the background (non-blocking)
      fetch('/api/share-prayer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prayer,
          imageDataUrl: imageUrl,
          dedicatedTo: prayerMode === 'friend' ? currentFriendName : undefined
        })
      })
        .then(res => res.json())
        .then(data => {
          if (data.success && data.shareUrl) {
            setShareUrl(data.shareUrl);
            console.log(`[Share] Prayer URL: ${data.shareUrl}`);
          }
        })
        .catch(err => console.warn('[Share] Could not generate share URL:', err));

    } catch (e) {
      console.error(e);
      setError("The prayer could not be written. Please try again.");
      setPhase('composing');
    }
  };

  const playMp3 = (url: string) => {
    if (audioRef.current) audioRef.current.pause();
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.play();
  };

  const handleListen = async () => {
    if (!prayerResult || isListening) return;
    if (audioUrl) { playMp3(audioUrl); return; }

    setIsListening(true);
    try {
      const base64Mp3 = await generateInworldTTS(prayerResult.speechText);
      if (!base64Mp3) throw new Error('TTS returned empty');
      const binary = atob(base64Mp3);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'audio/mp3' });
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      playMp3(url);
    } catch (e) {
      console.error('[TTS] Failed:', e);
      setError("Could not generate audio. Try again.");
    }
    setIsListening(false);
  };

  const handleShare = async () => {
    if (!prayerResult) return;
    try {
      const res = await fetch(prayerResult.imageUrl);
      const blob = await res.blob();
      const file = new File([blob], 'sacred-prayer.png', { type: 'image/png' });

      // Build share text with URL if available
      const shareText = shareUrl
        ? `Someone prayed for you. Read it here: ${shareUrl}`
        : 'Someone prayed for you. Pass this prayer forward. \u2014 stillsmallvoice.xyz';

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: prayerResult.forFriend
            ? `A prayer for ${prayerResult.forFriend}`
            : 'A Prayer for You',
          text: shareText,
          files: [file]
        });
      } else {
        // Desktop fallback: copy image to clipboard
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob })
        ]);
        setShareToast(true);
        setTimeout(() => setShareToast(false), 2000);
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        console.error('Share failed:', e);
      }
    }
  };

  const handleSave = () => {
    if (!prayerResult) return;
    const link = document.createElement('a');
    link.href = prayerResult.imageUrl;
    link.download = `prayer-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleWriteAnother = () => {
    if (prayerResult?.forFriend) {
      setSentAcknowledgment(`Your prayer for ${prayerResult.forFriend} was written with love.`);
    } else if (prayerResult) {
      setSentAcknowledgment(`Your prayer was received.`);
    }
    setPrayerResult(null);
    setShareUrl(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setError(null);
    setPhase('composing');
  };

  // --- Render ---

  return (
    <div className="min-h-screen bg-[#050505] text-[#E0D7C6] font-serif flex flex-col items-center justify-center px-6 py-8">

      {/* COMPOSING — This IS the landing page */}
      {phase === 'composing' && (
        <div className="w-full max-w-lg space-y-6 animate-fade-in">

          {/* Brand header */}
          <div className="text-center space-y-3 mb-2">
            <div className="text-[#C9A050]/30 text-2xl">&#10013;</div>
            <h1 className="text-2xl md:text-3xl font-black italic tracking-tight text-[#C9A050]">
              Still Small Voice
            </h1>
          </div>

          {/* Acknowledgment of previous prayer */}
          {sentAcknowledgment && (
            <div className="text-center animate-fade-in">
              <p className="text-[11px] italic text-[#C9A050]/70 tracking-wide">{sentAcknowledgment}</p>
            </div>
          )}

          {/* Mode toggle */}
          <div className="flex justify-center">
            <div className="flex bg-white/5 rounded-lg p-0.5">
              <button
                onClick={() => setPrayerMode('self')}
                className={`px-4 py-2 rounded-md text-xs uppercase font-bold tracking-wider transition-all ${prayerMode === 'self' ? 'bg-[#C9A050] text-black' : 'text-gray-500 hover:text-gray-300'}`}
              >
                For Me
              </button>
              <button
                onClick={() => setPrayerMode('friend')}
                className={`px-4 py-2 rounded-md text-xs uppercase font-bold tracking-wider transition-all ${prayerMode === 'friend' ? 'bg-[#C9A050] text-black' : 'text-gray-500 hover:text-gray-300'}`}
              >
                For a Friend
              </button>
            </div>
          </div>

          <p className="text-[10px] italic text-gray-500 leading-relaxed text-center">
            {prayerMode === 'self'
              ? "What's on your heart? You'll receive a personal prayer anchored in Scripture."
              : "Who needs prayer today? We'll create a sacred letter you can share with them."}
          </p>

          {/* Friend name */}
          {prayerMode === 'friend' && (
            <input
              type="text"
              value={friendName}
              onChange={(e) => setFriendName(e.target.value)}
              placeholder="Their first name..."
              className="w-full bg-white/5 border border-white/10 rounded-xl px-5 py-3 text-base italic outline-none focus:border-[#C9A050]/50 placeholder-gray-600"
            />
          )}

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={prayerRequest}
            onChange={(e) => setPrayerRequest(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handlePray(); }}
            placeholder={prayerMode === 'self'
              ? "I'm struggling with anxiety about my future..."
              : "They're going through a difficult season..."}
            className="w-full h-32 bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-base italic outline-none focus:border-[#C9A050]/50 placeholder-gray-600 resize-none"
          />

          {/* Submit */}
          <button
            onClick={handlePray}
            disabled={!prayerRequest.trim() || (prayerMode === 'friend' && !friendName.trim())}
            className="w-full bg-[#C9A050] text-black font-black uppercase tracking-widest py-4 rounded-xl text-sm hover:scale-[1.02] transition-transform shadow-2xl shadow-[#C9A050]/20 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {prayerMode === 'self' ? 'Pray' : `Pray for ${friendName || '...'}`}
          </button>

          {/* Gentle nudge toward friend mode */}
          {prayerMode === 'self' && sentAcknowledgment && (
            <button
              onClick={() => setPrayerMode('friend')}
              className="w-full text-center text-[10px] italic text-gray-600 hover:text-[#C9A050] transition-colors py-1"
            >
              Is there someone on your heart today? Pray for a friend &rarr;
            </button>
          )}

          {error && <p className="text-red-400 text-xs italic text-center">{error}</p>}
        </div>
      )}

      {/* GENERATING — contextual spinner */}
      {phase === 'generating' && (
        <div className="animate-fade-in">
          <Spinner message={loadingMessage} />
        </div>
      )}

      {/* VIEWING — letter first, Pass This Prayer is primary */}
      {phase === 'viewing' && prayerResult && (
        <div className="w-full max-w-lg flex flex-col items-center space-y-5 animate-fade-in">

          {/* Sacred letter image */}
          <img
            src={prayerResult.imageUrl}
            alt={`Prayer: ${prayerResult.prayer.theme}`}
            className="w-full max-h-[70vh] object-contain rounded-lg shadow-2xl border border-white/10 ring-1 ring-[#C9A050]/20"
          />

          {/* PRIMARY CTA — Pass This Prayer */}
          <button
            onClick={handleShare}
            className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-[#C9A050] text-black rounded-xl font-black uppercase tracking-widest text-sm hover:scale-[1.02] transition-transform shadow-2xl shadow-[#C9A050]/20"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
            {shareToast ? 'Copied to Clipboard!' : 'Pass This Prayer Forward'}
          </button>

          {/* Secondary actions row */}
          <div className="flex gap-3 justify-center">
            <button
              onClick={handleListen}
              disabled={isListening}
              className="flex items-center gap-2 px-5 py-2.5 bg-white/5 border border-white/10 rounded-full text-[10px] uppercase font-bold tracking-widest hover:bg-white/10 transition-all disabled:opacity-30"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              </svg>
              {isListening ? 'Loading...' : audioUrl ? 'Listen Again' : 'Listen'}
            </button>

            <button
              onClick={handleSave}
              className="flex items-center gap-2 px-5 py-2.5 bg-white/5 border border-white/10 rounded-full text-[10px] uppercase font-bold tracking-widest hover:bg-white/10 transition-all"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Save
            </button>
          </div>

          {/* Write Another */}
          <button
            onClick={handleWriteAnother}
            className="text-gray-600 text-[10px] uppercase tracking-widest hover:text-[#C9A050] transition-colors mt-1"
          >
            Write Another Prayer
          </button>

          {error && <p className="text-red-400 text-xs italic text-center">{error}</p>}
        </div>
      )}
    </div>
  );
};

export default App;
