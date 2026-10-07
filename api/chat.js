const { getSupabase } = require('./_lib/supabase');
const { embedTexts, generateAnswer, CHAT_MODEL } = require('./_lib/gemini');
const rateLimit = require('./_lib/rate-limit');
const { isUuid } = require('./_lib/ids');
const { REPLY_SCHEMA, REPLY_INSTRUCTIONS, parseReply } = require('./_lib/reply-format');
const { handleCors, originAllowed, ORIGIN_NOT_ALLOWED } = require('./_lib/cors');

const TOP_K = 4;
// Chunks less similar than this to the question are treated as unrelated and
// not shown to the model. Tune per knowledge base if answers miss obvious
// matches (lower it) or pull in irrelevant text (raise it).
const MIN_SIMILARITY = 0.5;
const HISTORY_LIMIT = 12;
const MAX_MESSAGE_LENGTH = 2000;
// Time limits for Gemini calls, kept well inside the function's 30s
// maxDuration (vercel.json) so slow free-tier responses get a fallback reply
// instead of a crash.
const EMBED_TIMEOUT_MS = 6000;
const GENERATE_TIMEOUT_MS = 15000;

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { message, conversationId, business: businessSlug } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'A message is required' });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `Please keep messages under ${MAX_MESSAGE_LENGTH} characters.` });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const slug = businessSlug || 'northstar-plumbing';

  let supabase;
  try {
    supabase = getSupabase();
  } catch (err) {
    // No database configured yet — degrade to a stateless canned response so
    // the widget still works while Supabase is being set up.
    return res.status(200).json({
      answer: "Thanks for your message — our team will follow up shortly. (Note: the assistant's database isn't connected yet, so this reply isn't AI-generated.)",
      conversationId: null,
      suggestLeadCapture: true
    });
  }

  // Timestamp the visitor's message now; it's saved together with the reply at
  // the end so the two rows always sort in the right order.
  const userMessageAt = new Date().toISOString();
  const timings = {};
  const timed = async (label, promise) => {
    const t0 = Date.now();
    try {
      return await promise;
    } finally {
      timings[label] = Date.now() - t0;
    }
  };

  // The embedding only needs the message text, so start it straight away and
  // let it run alongside the database lookups below.
  const embeddingPromise = apiKey
    ? timed('embed', embedTexts(apiKey, [message], 'RETRIEVAL_QUERY', { timeoutMs: EMBED_TIMEOUT_MS }))
        .then(([embedding]) => embedding)
        .catch((err) => {
          console.error('Embedding failed:', err.message || err);
          return null;
        })
    : Promise.resolve(null);

  let convoId = null;
  try {
    const { data: business, error: businessError } = await timed(
      'business',
      // select('*') so newer optional columns (allowed_origins) never break chat.
      supabase.from('businesses').select('*').eq('slug', slug).single()
    );

    if (businessError || !business) {
      return res.status(404).json({ error: 'Business configuration not found' });
    }
    if (!originAllowed(req, business)) {
      return res.status(403).json({ error: ORIGIN_NOT_ALLOWED, answer: ORIGIN_NOT_ALLOWED, conversationId: null });
    }

    // In parallel: rate limits — per visitor (stops one person/bot hammering
    // the widget) and per business per day (caps total AI usage, protecting
    // the Gemini quota) — and checking the visitor's conversation belongs to
    // this business.
    const [visitorOk, businessOk, existingConvo] = await timed('limits+convo', Promise.all([
      rateLimit.allow(supabase, rateLimit.ipKey(req, 'chat'), 60, rateLimit.envInt('CHAT_LIMIT_PER_MINUTE', 15)),
      rateLimit.allow(supabase, `chat:biz:${business.id}`, 24 * 60 * 60, rateLimit.envInt('CHAT_LIMIT_PER_BUSINESS_PER_DAY', 500)),
      isUuid(conversationId)
        ? supabase.from('conversations').select('id').eq('id', conversationId).eq('business_id', business.id).maybeSingle()
            .then(({ data }) => data)
        : Promise.resolve(null)
    ]));

    if (!visitorOk || !businessOk) {
      return res.status(429).json({
        answer: visitorOk
          ? "The assistant is very busy right now. Please leave your details and the team will get back to you."
          : "You're sending messages quite quickly — please wait a minute and try again.",
        conversationId: conversationId || null,
        suggestLeadCapture: !businessOk
      });
    }

    // Reuse the conversation only if it belongs to this business; otherwise
    // (missing, malformed, or someone else's ID) start a new one.
    if (existingConvo) {
      convoId = existingConvo.id;
    } else {
      const { data: newConvo, error: convoError } = await timed(
        'new-convo',
        supabase.from('conversations').insert({ business_id: business.id }).select('id').single()
      );
      if (convoError) throw convoError;
      convoId = newConvo.id;
    }

    // In parallel: earlier messages in this conversation, and knowledge-base
    // retrieval (pgvector similarity search on the question's embedding).
    const [earlier, chunks] = await Promise.all([
      existingConvo
        ? timed('history', supabase
            .from('messages')
            .select('role, content')
            .eq('conversation_id', convoId)
            // Newest-first so the limit keeps the latest turns; reversed below.
            .order('created_at', { ascending: false })
            .limit(HISTORY_LIMIT - 1)
          ).then(({ data }) => (data || []).reverse())
        : Promise.resolve([]),
      embeddingPromise.then(async (queryEmbedding) => {
        if (!queryEmbedding) return [];
        const { data, error } = await timed('retrieve', supabase.rpc('match_chunks', {
          query_embedding: queryEmbedding,
          match_business_id: business.id,
          match_count: TOP_K,
          min_similarity: MIN_SIMILARITY
        }));
        // Most likely cause: supabase/migrations/002_multi_tenant.sql not run yet.
        if (error) console.error('match_chunks failed:', error.message);
        return data || [];
      })
    ]);

    const hasKnowledgeBase = chunks.length > 0;
    const contextBlock = hasKnowledgeBase
      ? '\n\nRelevant information from the business\'s own FAQs/documents:\n' +
        chunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n')
      : '';

    // A named assistant (e.g. "Lumi") introduces itself by name, and never
    // pretends to be a person.
    const identity = business.assistant_name
      ? `\n\nYour name is ${business.assistant_name}. You are ${business.name}'s AI assistant. Introduce yourself by name in your first reply only. If anyone asks whether you're a person, say plainly that you're an AI assistant; don't repeat this unprompted in every reply.`
      : '';
    const systemInstruction = business.system_prompt + identity + contextBlock + '\n' + REPLY_INSTRUCTIONS;

    let parsed = null;
    if (apiKey) {
      try {
        const contents = [...earlier, { role: 'user', content: message }].map((m) => ({
          role: m.role === 'user' ? 'user' : 'model',
          parts: [{ text: m.content }]
        }));
        const { text, structured } = await timed('generate', generateAnswer(apiKey, {
          systemInstruction,
          contents,
          generationConfig: { temperature: 0.4 },
          responseSchema: REPLY_SCHEMA,
          timeoutMs: GENERATE_TIMEOUT_MS
        }));
        parsed = parseReply(text, structured);
        if (!parsed.reply) parsed = null;
      } catch (err) {
        console.error('Gemini request failed:', err.message || err);
      }
    }

    // No AI answer (Gemini slow, down, or not configured): reply politely and
    // open the lead form so the enquiry isn't lost.
    const usedFallback = !parsed;
    if (usedFallback) {
      parsed = {
        reply: `Thanks for your message! I can't answer that right now, but the ${business.name} team can. Leave your details and they'll get back to you shortly.`,
        language: null,
        intent: 'other',
        needsHuman: true,
        summary: ''
      };
    }
    const answer = parsed.reply;

    // The model's own judgement (works in any language): open the lead form
    // when the visitor is ready to act or a person needs to step in.
    const suggestLeadCapture = parsed.intent === 'ready' || parsed.needsHuman;

    const convoUpdate = { last_message_at: new Date().toISOString() };
    if (parsed.needsHuman) convoUpdate.handoff_requested = true;
    const insights = {};
    if (parsed.language) insights.language = parsed.language;
    if (!usedFallback) insights.intent = parsed.intent;
    if (parsed.summary) insights.summary = parsed.summary;

    // Save both messages and update the conversation in parallel.
    const [{ error: saveError }, { error: updateError }] = await timed('save', Promise.all([
      supabase.from('messages').insert([
        { conversation_id: convoId, role: 'user', content: message, created_at: userMessageAt },
        { conversation_id: convoId, role: 'assistant', content: answer, created_at: new Date().toISOString() }
      ]),
      supabase.from('conversations').update({ ...convoUpdate, ...insights }).eq('id', convoId)
    ]));
    if (saveError) console.error('Saving messages failed:', saveError.message);
    if (updateError) {
      // Most likely supabase/migrations/003_conversation_insights.sql hasn't
      // been run, so the insight columns don't exist yet — save the rest.
      console.error('Conversation update failed, retrying without insights:', updateError.message);
      await supabase.from('conversations').update(convoUpdate).eq('id', convoId);
    }

    console.log(
      `chat timings (ms) [${CHAT_MODEL}${usedFallback ? ', FALLBACK' : ''}] intent=${parsed.intent} human=${parsed.needsHuman} lang=${parsed.language}:`,
      JSON.stringify(timings)
    );
    return res.status(200).json({
      answer,
      conversationId: convoId,
      suggestLeadCapture,
      intent: parsed.intent,
      language: parsed.language,
      summary: parsed.summary
    });
  } catch (err) {
    console.error('Chat handler error:', err.message || err, 'timings (ms):', JSON.stringify(timings));
    // Keep the visitor's message even though the reply failed, so the team can follow up.
    if (convoId) {
      await supabase
        .from('messages')
        .insert({ conversation_id: convoId, role: 'user', content: message, created_at: userMessageAt })
        .then(() => {}, () => {});
    }
    return res.status(200).json({
      answer: 'Sorry, something went wrong on our end. Please leave your details and the team will follow up.',
      conversationId: convoId || conversationId || null,
      suggestLeadCapture: true
    });
  }
};
