const { getSupabase } = require('./_lib/supabase');
const { handleCors, originAllowed, ORIGIN_NOT_ALLOWED } = require('./_lib/cors');

// Public branding for the chat widget. Only these fields ever leave the
// server — the rest of the business row (system prompt, notification email,
// allowed websites) stays private.
const PUBLIC_FIELDS = ['slug', 'name', 'assistant_name', 'assistant_avatar', 'widget_theme', 'tagline', 'brand_color', 'services', 'lead_fields'];

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const slug = req.query.business || 'northstar-plumbing';

  try {
    const supabase = getSupabase();
    // select('*') so this keeps working whether or not newer columns
    // (e.g. allowed_origins from migration 004) exist yet.
    const { data, error } = await supabase.from('businesses').select('*').eq('slug', slug).single();

    if (error || !data) return res.status(404).json({ error: 'Business not found' });
    if (!originAllowed(req, data)) return res.status(403).json({ error: ORIGIN_NOT_ALLOWED });

    const config = {};
    for (const field of PUBLIC_FIELDS) config[field] = data[field];
    return res.status(200).json(config);
  } catch (err) {
    // No database yet — return sensible defaults so the widget still renders.
    return res.status(200).json({
      slug,
      name: 'Northstar Plumbing',
      tagline: 'Plumbing that shows up.',
      brand_color: '#1d4ed8',
      services: ['Emergency repairs', 'Bathroom & kitchen installs', 'Maintenance & servicing']
    });
  }
};
