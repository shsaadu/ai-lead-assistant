const { getSupabase } = require('./_lib/supabase');
const { embedTexts, generateAnswer } = require('./_lib/gemini');
const rateLimit = require('./_lib/rate-limit');
const { isUuid } = require('./_lib/ids');

const TOP_K = 4;
// Chunks less similar than this to the question are treated as unrelated and
// not shown to the model. Tune per knowledge base if answers miss obvious
// matches (lower it) or pull in irrelevant text (raise it).
const MIN_SIMILARITY = 0.5;
const HISTORY_LIMIT = 12;
const MAX_MESSAGE_LENGTH = 2000;
const UNSURE_PHRASES = [
  "don't have that information",
  'not sure',
  "can't confirm",
  'cannot confirm',
  "don't know",
  'connect you with',
  'best to check with',
  'team can confirm'
];
const LEAD_INTENT_PATTERN = /\b(book|quote|price|pricing|cost|repair|leak|call|visit|appointment|emergency|urgent|hire|available)\b/i;

module.exports = async function handler(req, res) {
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
      suggestLeadCapture: LEAD_INTENT_PATTERN.test(message)
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
    ? timed('embed', embedTexts(apiKey, [message], 'RETRIEVAL_QUERY'))
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
      supabase.from('businesses').select('id, name, system_prompt, services').eq('slug', slug).single()
    );

    if (businessError || !business) {
      return res.status(404).json({ error: 'Business configuration not found' });
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

    const systemInstruction =
      business.system_prompt +
      contextBlock +
      '\n\nIf you are not confident an answer is correct or the information above doesn\'t cover it, say so plainly and offer to connect the customer with the team — never guess.';

    let answer;
    if (apiKey) {
      try {
        const contents = [...earlier, { role: 'user', content: message }].map((m) => ({
          role: m.role === 'user' ? 'user' : 'model',
          parts: [{ text: m.content }]
        }));
        answer = await timed('generate', generateAnswer(apiKey, { systemInstruction, contents, generationConfig: { temperature: 0.4 } }));
      } catch (err) {
        console.error('Gemini request failed:', err.message || err);
      }
    }

    if (!answer) {
      answer = `I can help you get in touch with ${business.name}. Could you share a few details about what you need?`;
    }

    const seemsUnsure = UNSURE_PHRASES.some((phrase) => answer.toLowerCase().includes(phrase));
    const seemsHighIntent = LEAD_INTENT_PATTERN.test(message);
    const suggestLeadCapture = seemsUnsure || seemsHighIntent;

    const convoUpdate = { last_message_at: new Date().toISOString() };
    if (seemsUnsure) convoUpdate.handoff_requested = true;

    // Save both messages and update the conversation in parallel.
    const [{ error: saveError }] = await timed('save', Promise.all([
      supabase.from('messages').insert([
        { conversation_id: convoId, role: 'user', content: message, created_at: userMessageAt },
        { conversation_id: convoId, role: 'assistant', content: answer, created_at: new Date().toISOString() }
      ]),
      supabase.from('conversations').update(convoUpdate).eq('id', convoId)
    ]));
    if (saveError) console.error('Saving messages failed:', saveError.message);

    console.log('chat timings (ms):', JSON.stringify(timings));
    return res.status(200).json({ answer, conversationId: convoId, suggestLeadCapture });
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
