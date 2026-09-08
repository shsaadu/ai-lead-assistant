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

async function generateAnswer(apiKey, { systemInstruction, contents, generationConfig }) {
  const body = { contents };
  if (systemInstruction) body.system_instruction = { parts: [{ text: systemInstruction }] };
  if (generationConfig) body.generationConfig = generationConfig;

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data && data.error && data.error.message) || 'Gemini request failed');
  const candidate = data.candidates && data.candidates[0];
  const parts = candidate && candidate.content && candidate.content.parts;
  return (parts || []).map((p) => p.text || '').join('');
}

module.exports = { embedTexts, generateAnswer, EMBED_DIMENSIONS, CHAT_MODEL };
