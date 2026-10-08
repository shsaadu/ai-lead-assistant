// The structured reply the assistant returns on every turn. Instead of
// guessing from English keywords, the model itself reports what the visitor
// wants and whether a human needs to step in, in any language.

const INTENTS = ['ready', 'researching', 'other'];

// Gemini responseSchema (OpenAPI subset).
const REPLY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    reply: { type: 'STRING', description: "The message shown to the visitor, in the visitor's language." },
    language: { type: 'STRING', description: "ISO 639-1 code of the language of the visitor's latest message, e.g. en, ar, zh." },
    intent: { type: 'STRING', enum: INTENTS },
    needs_human: { type: 'BOOLEAN' },
    summary: { type: 'STRING', description: 'What the visitor wants so far, in English, at most 15 words.' }
  },
  required: ['reply', 'language', 'intent', 'needs_human', 'summary'],
  propertyOrdering: ['reply', 'language', 'intent', 'needs_human', 'summary']
};

// Appended after the business's own instructions and knowledge base.
const REPLY_INSTRUCTIONS = `
How to reply:
- Write "reply" in the same language as the visitor's latest message, even if the information above is in English.
- Only offer to connect the visitor with the team when they are ready to act, ask for a person, or you can't answer. Don't end every message with that offer.
- You can't contact anyone, transfer the chat, book visits or send anyone yourself. When the visitor wants that, ask them to leave their details in the form that appears so the team can get back to them. Never say "please hold" or promise someone is joining the chat.
- Facts about this business (prices, services, availability, dates, policies, people, results) come ONLY from the information above. If a business fact isn't covered, say so plainly and never guess it.
- General questions (how something works, general advice, ideas for the visitor's situation, explaining terms) can be answered briefly from general knowledge, as long as you don't present it as this business's own policy or promise, and you respect any topics the instructions above say not to advise on.
- Be genuinely helpful first, then suggest a next step when it fits.

Also fill in:
- "language": the ISO 639-1 code of the visitor's latest message.
- "intent": "ready" if they want to book, get a quote or price for their own case, be contacted, or have an urgent problem; "researching" if they are asking questions or comparing options; "other" for greetings, thanks, off-topic or unclear messages.
- "needs_human": true only if you could not answer a question about this business from the information above, the visitor asks for a person, or they are complaining. Otherwise false.
- "summary": what the visitor wants so far, in English, at most 15 words, for the team to read.`;

function clean(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

// Turns the model's output into { reply, language, intent, needsHuman,
// summary }. Never throws. Without a schema (the model doesn't support it),
// the raw text is the reply and the signals are neutral. With a schema but
// unusable JSON, the reply is empty so the caller uses its fallback message —
// raw JSON must never be shown to a visitor.
function parseReply(text, structured) {
  const neutral = { reply: '', language: null, intent: 'other', needsHuman: false, summary: '' };
  if (!structured) return { ...neutral, reply: clean(text, 4000) };

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    // Sometimes JSON arrives wrapped in a code fence or extra words.
    const match = String(text).match(/\{[\s\S]*\}/);
    try {
      data = match ? JSON.parse(match[0]) : null;
    } catch {
      data = null;
    }
  }
  if (!data || typeof data !== 'object' || !clean(data.reply, 4000)) return neutral;

  const language = clean(data.language, 8).toLowerCase();
  return {
    reply: clean(data.reply, 4000),
    language: /^[a-z]{2,3}(-[a-z0-9]{2,4})?$/.test(language) ? language : null,
    intent: INTENTS.includes(data.intent) ? data.intent : 'other',
    needsHuman: data.needs_human === true,
    summary: clean(data.summary, 200)
  };
}

module.exports = { REPLY_SCHEMA, REPLY_INSTRUCTIONS, parseReply, INTENTS };
