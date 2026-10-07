const { getSupabase } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/admin-auth');
const { normalizeOrigin } = require('../_lib/cors');

const EDITABLE_FIELDS = ['name', 'assistant_name', 'assistant_avatar', 'widget_theme', 'tagline', 'brand_color', 'notify_email', 'system_prompt', 'services', 'allowed_origins'];

module.exports = async function handler(req, res) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const { business } = auth;
  const supabase = getSupabase();

  if (req.method === 'GET') {
    const { data, error } = await supabase.from('businesses').select('*').eq('id', business.id).single();
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
    if (updates.widget_theme !== undefined && !['light', 'dark'].includes(updates.widget_theme)) {
      return res.status(400).json({ error: 'Theme must be light or dark.' });
    }
    if (updates.assistant_avatar !== undefined) {
      const avatar = String(updates.assistant_avatar || '').trim();
      if (avatar && avatar !== 'lamp' && !/^https:\/\/\S+$/i.test(avatar)) {
        return res.status(400).json({ error: 'Avatar must be "lamp", an https:// image link, or empty.' });
      }
      updates.assistant_avatar = avatar || null;
    }
    if (updates.assistant_name !== undefined) {
      updates.assistant_name = String(updates.assistant_name || '').trim().slice(0, 40) || null;
    }
    if (updates.allowed_origins !== undefined) {
      // Accept full URLs or bare domains; store each as a clean origin.
      const list = Array.isArray(updates.allowed_origins) ? updates.allowed_origins : [];
      const origins = [...new Set(list.map(normalizeOrigin).filter(Boolean))];
      const invalid = list.filter((value) => String(value).trim() && !normalizeOrigin(value));
      if (invalid.length) {
        return res.status(400).json({ error: `Not a valid website address: ${invalid.join(', ')}` });
      }
      updates.allowed_origins = origins;
    }
    const { error } = await supabase.from('businesses').update(updates).eq('id', business.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
