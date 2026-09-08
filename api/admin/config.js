const { getSupabase } = require('../_lib/supabase');
const { requireAuth } = require('../_lib/admin-auth');

const EDITABLE_FIELDS = ['name', 'tagline', 'brand_color', 'notify_email', 'system_prompt', 'services'];

module.exports = async function handler(req, res) {
  if (!requireAuth(req, res)) return;

  const supabase = getSupabase();
  const slug = req.query.business || 'northstar-plumbing';

  if (req.method === 'GET') {
    const { data, error } = await supabase.from('businesses').select('*').eq('slug', slug).single();
    if (error || !data) return res.status(404).json({ error: 'Business not found' });
    return res.status(200).json({ business: data });
  }

  if (req.method === 'PATCH') {
    const updates = {};
    for (const field of EDITABLE_FIELDS) {
      if (req.body && req.body[field] !== undefined) updates[field] = req.body[field];
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    const { error } = await supabase.from('businesses').update(updates).eq('slug', slug);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
