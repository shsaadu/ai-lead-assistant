// Per-business lead-form questions (businesses.lead_fields) — see
// supabase/migrations/005_lead_questions.sql for the format.

const MAX_ANSWER_LENGTH = 200;

function leadFields(business) {
  const fields = business && Array.isArray(business.lead_fields) ? business.lead_fields : [];
  return fields.filter((f) => f && typeof f.key === 'string' && f.key);
}

// A field's label in `lang` (falls back to English, then any translation).
function fieldLabel(field, lang = 'en') {
  const label = field.label;
  if (typeof label === 'string') return label;
  if (label && typeof label === 'object') {
    return label[lang] || label.en || Object.values(label)[0] || field.key;
  }
  return field.key;
}

// Keeps only answers to this business's questions, as trimmed strings.
function cleanDetails(raw, business) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const details = {};
  for (const field of leadFields(business)) {
    const value = raw[field.key];
    if (typeof value === 'string' && value.trim()) {
      details[field.key] = value.trim().slice(0, MAX_ANSWER_LENGTH);
    }
  }
  return details;
}

module.exports = { leadFields, fieldLabel, cleanDetails };
