const { getSupabase } = require('./_lib/supabase');
const { generateAnswer } = require('./_lib/gemini');
const rateLimit = require('./_lib/rate-limit');
const { handleCors, originAllowed, ORIGIN_NOT_ALLOWED } = require('./_lib/cors');

// Voice messages from the widget's microphone button. The widget records a
// short clip (16kHz mono WAV, at most 30 seconds), this endpoint asks Gemini
// to write down what was said, and the widget then sends that text through
// /api/chat like a typed message. The recording itself is never stored.

// 30s of 16kHz 16-bit mono WAV is ~960KB, ~1.3MB as base64.
const MAX_AUDIO_BASE64_LENGTH = 1400000;
const TRANSCRIBE_TIMEOUT_MS = 20000;

const TRANSCRIBE_INSTRUCTIONS = `You write down short voice messages that visitors send to a business's website chat.
Write exactly what the speaker says, in the language they speak, using that language's usual script (for example Bengali or Sylheti in Bengali script, Arabic in Arabic script, Urdu in Urdu script). If they mix languages, keep the mix.
Do not translate, answer, summarise or add anything. Fix only obvious filler sounds ("um", "uh").
If there is no clear speech, return an empty text.`;

const TRANSCRIPT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    text: { type: 'STRING', description: 'What the speaker said, word for word.' },
    language: { type: 'STRING', description: 'ISO 639-1 code of the main language spoken, e.g. "en", "bn", "ar".' }
  },
  required: ['text', 'language']
};

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { audio, business: businessSlug } = req.body || {};
  if (typeof audio !== 'string' || !audio || audio.length > MAX_AUDIO_BASE64_LENGTH || !/^[A-Za-z0-9+/]+=*$/.test(audio)) {
    return res.status(400).json({ error: 'Please send a recording of up to 30 seconds.' });
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Voice messages are not available right now.' });

  try {
    const supabase = getSupabase();
    const { data: business } = await supabase.from('businesses').select('*').eq('slug', businessSlug || '').maybeSingle();
    if (!business) return res.status(404).json({ error: 'Business configuration not found' });
    if (!originAllowed(req, business)) return res.status(403).json({ error: ORIGIN_NOT_ALLOWED });

    const [visitorOk, businessOk] = await Promise.all([
      rateLimit.allow(supabase, rateLimit.ipKey(req, 'voice'), 60, rateLimit.envInt('VOICE_LIMIT_PER_MINUTE', 8)),
      rateLimit.allow(supabase, `voice:biz:${business.id}`, 24 * 60 * 60, rateLimit.envInt('VOICE_LIMIT_PER_BUSINESS_PER_DAY', 300))
    ]);
    if (!visitorOk || !businessOk) {
      return res.status(429).json({ error: 'Too many voice messages just now. Please wait a minute, or type your message.' });
    }

    const t0 = Date.now();
    const { text, structured } = await generateAnswer(apiKey, {
      systemInstruction: TRANSCRIBE_INSTRUCTIONS,
      contents: [{ role: 'user', parts: [{ inline_data: { mime_type: 'audio/wav', data: audio } }, { text: 'Write down this voice message.' }] }],
      generationConfig: { temperature: 0 },
      responseSchema: TRANSCRIPT_SCHEMA,
      timeoutMs: TRANSCRIBE_TIMEOUT_MS
    });

    let transcript = '';
    let language = '';
    if (structured) {
      try {
        const parsed = JSON.parse(text);
        transcript = typeof parsed.text === 'string' ? parsed.text : '';
        language = typeof parsed.language === 'string' ? parsed.language.slice(0, 10) : '';
      } catch {
        transcript = '';
      }
    } else {
      transcript = text;
    }
    transcript = transcript.trim().slice(0, 2000);
    console.log('voice transcribed', { business: business.slug, ms: Date.now() - t0, chars: transcript.length, language });
    return res.status(200).json({ text: transcript, language });
  } catch (err) {
    console.error('Transcription failed:', err.message || err);
    return res.status(502).json({ error: "Sorry, I couldn't hear that. Please try again or type your message." });
  }
};
