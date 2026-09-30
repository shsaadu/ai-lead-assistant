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

  try {
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('id, name, system_prompt, services')
      .eq('slug', slug)
      .single();

    if (businessError || !business) {
      return res.status(404).json({ error: 'Business configuration not found' });
    }

    // Limits: per visitor (stops one person/bot hammering the widget) and per
    // business per day (caps total AI usage, protecting the Gemini quota).
    const [visitorOk, businessOk] = await Promise.all([
      rateLimit.allow(supabase, rateLimit.ipKey(req, 'chat'), 60, rateLimit.envInt('CHAT_LIMIT_PER_MINUTE', 15)),
      rateLimit.allow(supabase, `chat:biz:${business.id}`, 24 * 60 * 60, rateLimit.envInt('CHAT_LIMIT_PER_BUSINESS_PER_DAY', 500))
    ]);
    if (!visitorOk || !businessOk) {
      return res.status(429).json({
        answer: visitorOk
          ? "The assistant is very busy right now. Please leave your details and the team will get back to you."
          : "You're sending messages quite quickly — please wait a minute and try again.",
        conversationId: conversationId || null,
        suggestLeadCapture: !businessOk
      });
    }

    // Reuse the visitor's conversation only if it really belongs to this
    // business; otherwise (missing, malformed, or someone else's ID) start a
    // new one.
    let convoId = null;
    if (isUuid(conversationId)) {
      const { data: existing } = await supabase
        .from('conversations')
        .select('id')
        .eq('id', conversationId)
        .eq('business_id', business.id)
        .maybeSingle();
      if (existing) convoId = existing.id;
    }
    if (!convoId) {
      const { data: newConvo, error: convoError } = await supabase
        .from('conversations')
        .insert({ business_id: business.id })
        .select('id')
        .single();
      if (convoError) throw convoError;
      convoId = newConvo.id;
    }

    await supabase.from('messages').insert({ conversation_id: convoId, role: 'user', content: message });

    // Retrieve relevant document chunks via pgvector cosine similarity.
    let contextBlock = '';
    let hasKnowledgeBase = false;
    if (apiKey) {
      try {
        const [queryEmbedding] = await embedTexts(apiKey, [message], 'RETRIEVAL_QUERY');
        const { data: chunks, error: matchError } = await supabase.rpc('match_chunks', {
          query_embedding: queryEmbedding,
          match_business_id: business.id,
          match_count: TOP_K,
          min_similarity: MIN_SIMILARITY
        });
        // Most likely cause: supabase/migrations/002_multi_tenant.sql not run yet.
        if (matchError) console.error('match_chunks failed:', matchError.message);
        if (chunks && chunks.length > 0) {
          hasKnowledgeBase = true;
          contextBlock =
            '\n\nRelevant information from the business\'s own FAQs/documents:\n' +
            chunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n');
        }
      } catch {
        // Retrieval failure shouldn't block the whole response — fall back to
        // the base system prompt with no retrieved context.
      }
    }

    // Most recent messages for context: fetch newest-first so the limit keeps
    // the latest turns, then flip back into chronological order for the model.
    const { data: recent } = await supabase
      .from('messages')
      .select('role, content')
      .eq('conversation_id', convoId)
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT);
    const history = (recent || []).reverse();

    const systemInstruction =
      business.system_prompt +
      contextBlock +
      '\n\nIf you are not confident an answer is correct or the information above doesn\'t cover it, say so plainly and offer to connect the customer with the team — never guess.';

    let answer;
    if (apiKey) {
      try {
        const contents = history.map((m) => ({
          role: m.role === 'user' ? 'user' : 'model',
          parts: [{ text: m.content }]
        }));
        answer = await generateAnswer(apiKey, { systemInstruction, contents, generationConfig: { temperature: 0.4 } });
      } catch (err) {
        console.error('Gemini request failed:', err.message || err);
      }
    }

    if (!answer) {
      answer = `I can help you get in touch with ${business.name}. Could you share a few details about what you need?`;
    }

    await supabase.from('messages').insert({ conversation_id: convoId, role: 'assistant', content: answer });
    await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', convoId);

    const seemsUnsure = UNSURE_PHRASES.some((phrase) => answer.toLowerCase().includes(phrase));
    const seemsHighIntent = LEAD_INTENT_PATTERN.test(message);
    const suggestLeadCapture = seemsUnsure || seemsHighIntent || !hasKnowledgeBase && seemsHighIntent;

    if (seemsUnsure) {
      await supabase.from('conversations').update({ handoff_requested: true }).eq('id', convoId);
    }

    return res.status(200).json({ answer, conversationId: convoId, suggestLeadCapture });
  } catch (err) {
    console.error('Chat handler error:', err.message || err);
    return res.status(200).json({
      answer: 'Sorry, something went wrong on our end. Please leave your details and the team will follow up.',
      conversationId: conversationId || null,
      suggestLeadCapture: true
    });
  }
};
