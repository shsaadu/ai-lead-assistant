// Shared Gemini API helpers used by both the public chat endpoint and the
// admin document-indexing endpoint.

const EMBED_MODEL = 'gemini-embedding-001';
// Set GEMINI_CHAT_MODEL in Vercel to switch models without a code change
// (e.g. a faster "flash-lite" model if replies are slow on the free tier).
const CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || 'gemini-3.5-flash';
const EMBED_DIMENSIONS = 768; // must match the `vector(768)` column in supabase/schema.sql

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Gemini's free tier sometimes takes 30s+ to answer. Every request gets a hard
// deadline so a slow response turns into a handled error (and a fallback
// reply) instead of the whole serverless function timing out.
async function postJson(url, apiKey, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    return { res, data: await res.json() };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Gemini did not respond within ${timeoutMs / 1000}s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function embedTexts(apiKey, texts, taskType = 'RETRIEVAL_DOCUMENT', { timeoutMs = 25000 } = {}) {
  const requests = texts.map((text) => ({
    model: `models/${EMBED_MODEL}`,
    content: { parts: [{ text: String(text).slice(0, 6000) }] },
    taskType,
    outputDimensionality: EMBED_DIMENSIONS
  }));

  const { res, data } = await postJson(`${API_BASE}/${EMBED_MODEL}:batchEmbedContents`, apiKey, { requests }, timeoutMs);
  if (!res.ok) throw new Error((data && data.error && data.error.message) || 'Embedding request failed');
  return (data.embeddings || []).map((e) => e.values || []);
}

// Short FAQ-style answers don't benefit from the model "thinking" first, so
// ask for minimal thinking. If the model rejects the setting, retry without it
// and remember that, so later requests on this instance don't pay for a
// failed call first.
const THINKING_CONFIG = { thinkingLevel: 'minimal' };
let thinkingConfigSupported = true;

async function generateAnswer(apiKey, { systemInstruction, contents, generationConfig, timeoutMs = 15000 }) {
  const deadline = Date.now() + timeoutMs;
  const url = `${API_BASE}/${CHAT_MODEL}:generateContent`;
  const body = { contents, generationConfig: { ...(generationConfig || {}) } };
  if (systemInstruction) body.system_instruction = { parts: [{ text: systemInstruction }] };

  let res, data;
  if (thinkingConfigSupported) {
    ({ res, data } = await postJson(url, apiKey, {
      ...body,
      generationConfig: { ...body.generationConfig, thinkingConfig: THINKING_CONFIG }
    }, timeoutMs));
    if (res.status === 400) {
      console.error(`Gemini (${CHAT_MODEL}) rejected thinkingConfig, retrying without it:`, data && data.error && data.error.message);
      thinkingConfigSupported = false;
    }
  }
  if (!thinkingConfigSupported) {
    // Whatever time is left of the overall deadline (at least 1s).
    ({ res, data } = await postJson(url, apiKey, body, Math.max(1000, deadline - Date.now())));
  }

  if (!res.ok) throw new Error((data && data.error && data.error.message) || 'Gemini request failed');
  const candidate = data.candidates && data.candidates[0];
  const parts = candidate && candidate.content && candidate.content.parts;
  return (parts || []).map((p) => p.text || '').join('');
}

module.exports = { embedTexts, generateAnswer, EMBED_DIMENSIONS, CHAT_MODEL };
