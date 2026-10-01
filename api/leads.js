const { getSupabase } = require('./_lib/supabase');
const rateLimit = require('./_lib/rate-limit');
const { isUuid } = require('./_lib/ids');
const { handleCors, originAllowed, ORIGIN_NOT_ALLOWED } = require('./_lib/cors');
const { leadFields, fieldLabel, cleanDetails } = require('./_lib/lead-fields');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[+()\d][\d\s().-]{5,39}$/;

function text(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const { conversationId, business: businessSlug } = body;
  const name = text(body.name, 120);
  const email = text(body.email, 200);
  const phone = text(body.phone, 40);
  const serviceNeeded = text(body.serviceNeeded, 200);
  const budget = text(body.budget, 100);
  const message = text(body.message, 2000);

  // A name, plus an email OR a phone number (many international students
  // prefer WhatsApp to email).
  if (!name) return res.status(400).json({ error: 'Please tell us your name.' });
  if (!email && !phone) return res.status(400).json({ error: 'Please give an email address or a phone number.' });
  if (email && !EMAIL_PATTERN.test(email)) return res.status(400).json({ error: "That email address doesn't look right." });
  if (phone && !PHONE_PATTERN.test(phone)) return res.status(400).json({ error: "That phone number doesn't look right." });

  const slug = businessSlug || 'northstar-plumbing';

  let supabase;
  try {
    supabase = getSupabase();
  } catch (err) {
    return res.status(500).json({ error: 'Database is not configured yet — add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.' });
  }

  try {
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('*')
      .eq('slug', slug)
      .single();

    if (businessError || !business) {
      return res.status(404).json({ error: 'Business configuration not found' });
    }
    if (!originAllowed(req, business)) {
      return res.status(403).json({ error: ORIGIN_NOT_ALLOWED });
    }

    // 5 lead submissions per visitor per 10 minutes is plenty for a real
    // person and stops form spam flooding the owner's inbox.
    const allowed = await rateLimit.allow(supabase, rateLimit.ipKey(req, 'leads'), 10 * 60, 5);
    if (!allowed) {
      return res.status(429).json({ error: "You've sent several requests already — please wait a few minutes and try again." });
    }

    // Only link the lead to the conversation if it belongs to this business.
    let linkedConversationId = null;
    let conversationLanguage = null;
    if (isUuid(conversationId)) {
      const { data: convo } = await supabase
        .from('conversations')
        .select('*')
        .eq('id', conversationId)
        .eq('business_id', business.id)
        .maybeSingle();
      if (convo) {
        linkedConversationId = convo.id;
        conversationLanguage = convo.language || null;
      }
    }

    // Answers to this business's own questions (e.g. course, start date).
    const details = cleanDetails(body.details, business);
    const row = {
      business_id: business.id,
      conversation_id: linkedConversationId,
      name,
      email: email || null,
      service_needed: serviceNeeded || null,
      budget: budget || null,
      message: message || null
    };
    // Only send the newer columns when used, so businesses without lead
    // questions keep working on databases that haven't run migration 005.
    if (phone) row.phone = phone;
    if (Object.keys(details).length) row.details = details;

    const { data: lead, error: leadError } = await supabase.from('leads').insert(row).select('id').single();

    if (leadError) throw leadError;

    if (linkedConversationId) {
      await supabase.from('conversations').update({ handoff_requested: true }).eq('id', linkedConversationId);
    }

    // Email notification is best-effort — a failed email should never stop the
    // lead from being saved, since the lead itself is already safe in the DB.
    let emailSent = false;
    if (business.notify_email && process.env.RESEND_API_KEY) {
      try {
        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`
          },
          body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL || 'AI Lead Assistant <onboarding@resend.dev>',
            to: business.notify_email,
            subject: `New lead: ${name} — ${details.course || serviceNeeded || 'general enquiry'}`,
            html: `
              <h2>New lead from ${escapeHtml(business.name)}'s website</h2>
              ${emailRows([
                ['Name', name],
                ['Email', email],
                ['Phone / WhatsApp', phone],
                ['Service needed', serviceNeeded],
                ['Budget', budget],
                ...leadFields(business).map((field) => [fieldLabel(field), details[field.key]]),
                ['Chat language', conversationLanguage && languageName(conversationLanguage)],
                ['Message', message]
              ])}
              <p style="color:#888;font-size:12px;">Captured via the AI website assistant.</p>
            `
          })
        });
        emailSent = emailRes.ok;
        if (!emailRes.ok) {
          const errText = await emailRes.text();
          console.error('Resend email failed:', errText);
        }
      } catch (err) {
        console.error('Resend request error:', err.message || err);
      }
    }

    return res.status(200).json({ success: true, leadId: lead.id, emailSent });
  } catch (err) {
    console.error('Lead capture error:', err.message || err);
    return res.status(500).json({ error: 'Could not save your details. Please try again.' });
  }
};

function emailRows(rows) {
  return rows
    .filter(([, value]) => value)
    .map(([label, value]) => `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`)
    .join('');
}

function languageName(code) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code;
  } catch {
    return code;
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
