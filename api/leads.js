const { getSupabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, serviceNeeded, budget, message, conversationId, business: businessSlug } = req.body || {};

  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }

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
      .select('id, name, notify_email')
      .eq('slug', slug)
      .single();

    if (businessError || !business) {
      return res.status(404).json({ error: 'Business configuration not found' });
    }

    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .insert({
        business_id: business.id,
        conversation_id: conversationId || null,
        name,
        email,
        service_needed: serviceNeeded || null,
        budget: budget || null,
        message: message || null
      })
      .select('id')
      .single();

    if (leadError) throw leadError;

    if (conversationId) {
      await supabase.from('conversations').update({ handoff_requested: true }).eq('id', conversationId);
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
            subject: `New lead: ${name} — ${serviceNeeded || 'general enquiry'}`,
            html: `
              <h2>New lead from ${business.name}'s website</h2>
              <p><strong>Name:</strong> ${escapeHtml(name)}</p>
              <p><strong>Email:</strong> ${escapeHtml(email)}</p>
              ${serviceNeeded ? `<p><strong>Service needed:</strong> ${escapeHtml(serviceNeeded)}</p>` : ''}
              ${budget ? `<p><strong>Budget:</strong> ${escapeHtml(budget)}</p>` : ''}
              ${message ? `<p><strong>Message:</strong> ${escapeHtml(message)}</p>` : ''}
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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
