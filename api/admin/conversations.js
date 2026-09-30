const { getSupabase } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/admin-auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const { business } = auth;
  const supabase = getSupabase();

  if (req.query.id) {
    // Only show a conversation if it belongs to this admin's business.
    const { data: convo } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', req.query.id)
      .eq('business_id', business.id)
      .maybeSingle();
    if (!convo) return res.status(404).json({ error: 'Conversation not found' });

    const { data: messages, error } = await supabase
      .from('messages')
      .select('role, content, created_at')
      .eq('conversation_id', req.query.id)
      .order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ messages });
  }

  const { data, error } = await supabase
    .from('conversations')
    .select('id, handoff_requested, created_at, last_message_at, messages(count)')
    .eq('business_id', business.id)
    .order('last_message_at', { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });

  const conversations = (data || []).map((c) => ({
    id: c.id,
    handoffRequested: c.handoff_requested,
    createdAt: c.created_at,
    lastMessageAt: c.last_message_at,
    messageCount: (c.messages && c.messages[0] && c.messages[0].count) || 0
  }));

  return res.status(200).json({ conversations });
};
