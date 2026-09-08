const { getSupabase } = require('../_lib/supabase');
const { requireAuth } = require('../_lib/admin-auth');

module.exports = async function handler(req, res) {
  if (!requireAuth(req, res)) return;

  const supabase = getSupabase();
  const slug = req.query.business || 'northstar-plumbing';

  const { data: business } = await supabase.from('businesses').select('id').eq('slug', slug).single();
  if (!business) return res.status(404).json({ error: 'Business not found' });

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('leads')
      .select('id, name, email, service_needed, budget, message, status, created_at, conversation_id')
      .eq('business_id', business.id)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ leads: data });
  }

  if (req.method === 'PATCH') {
    const { id, status } = req.body || {};
    if (!id || !status) return res.status(400).json({ error: 'id and status are required' });
    if (!['new', 'contacted', 'won', 'lost'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const { error } = await supabase.from('leads').update({ status }).eq('id', id).eq('business_id', business.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
