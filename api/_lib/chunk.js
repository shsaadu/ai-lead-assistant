// Splits text into overlapping word-window chunks for embedding + retrieval.
// Same approach as the AI Research Assistant project, just running
// server-side here since documents are admin-managed rather than per-visitor.

function chunkText(text, chunkWords = 140, overlapWords = 30) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const chunks = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + chunkWords, words.length);
    chunks.push(words.slice(start, end).join(' '));
    if (end === words.length) break;
    start = end - overlapWords;
  }
  return chunks;
}

module.exports = { chunkText };
