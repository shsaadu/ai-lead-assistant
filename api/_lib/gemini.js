// Shared Gemini API helpers used by both the public chat endpoint and the
// admin document-indexing endpoint.

const EMBED_MODEL = 'gemini-embedding-001';
const CHAT_MODEL = 'gemini-3.5-flash';
const EMBED_DIMENSIONS = 768; // must match the `vector(768)` column in supabase/schema.sql

async function embedTexts(apiKey, texts, taskType = 'RETRIEVAL_DOCUMENT') {
  const requests = texts.map((text) => ({
    model: `models/${EMBED_MODEL}`,
    content: { parts: [{ text: String(text).slice(0, 6000) }] },
    taskType,
    outputDimensionality: EMBED_DIMENSIONS
  }));

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ requests })
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data && data.error && data.error.message) || 'Embedding request failed');
  return (data.embeddings || []).map((e) => e.values || []);
}

// Short FAQ-style answers don't benefit from the model "thinking" first, and
// thinking was most of the ~13s reply time. Ask for minimal thinking; if the
// model rejects the setting, retry once without it rather than failing.
const THINKING_CONFIG = { thinkingLevel: 'minimal' };

async function callGenerate(apiKey, body) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body)
  });
  return { res, data: await res.json() };
}

async function generateAnswer(apiKey, { systemInstruction, contents, generationConfig }) {
  const body = { contents };
  if (systemInstruction) body.system_instruction = { parts: [{ text: systemInstruction }] };
  body.generationConfig = { ...(generationConfig || {}), thinkingConfig: THINKING_CONFIG };

  let { res, data } = await callGenerate(apiKey, body);
  if (res.status === 400) {
    console.error('Gemini rejected thinkingConfig, retrying without it:', data && data.error && data.error.message);
    const { thinkingConfig, ...withoutThinking } = body.generationConfig;
    ({ res, data } = await callGenerate(apiKey, { ...body, generationConfig: withoutThinking }));
  }
  if (!res.ok) throw new Error((data && data.error && data.error.message) || 'Gemini request failed');
  const candidate = data.candidates && data.candidates[0];
  const parts = candidate && candidate.content && candidate.content.parts;
  return (parts || []).map((p) => p.text || '').join('');
}

module.exports = { embedTexts, generateAnswer, EMBED_DIMENSIONS, CHAT_MODEL };
