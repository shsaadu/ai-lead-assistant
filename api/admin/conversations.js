const { getSupabase } = require('../_lib/supabase');
const { requireAdmin } = require('../_lib/admin-auth');

// Start of a calendar month in UK time, as a UTC instant. offsetMonths: 0 = this month, -1 = last month.
function londonMonthStart(now, offsetMonths) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: 'numeric' }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === 'year').value);
  const month = Number(parts.find((p) => p.type === 'month').value) - 1 + offsetMonths;
  const guess = Date.UTC(year, month, 1); // Date.UTC rolls months over or back across years
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hourCycle: 'h23' }).format(new Date(guess)));
  // 01:00 in London at 00:00 UTC means British Summer Time, so local midnight was an hour earlier.
  return new Date(hour === 1 ? guess - 3600000 : guess);
}

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

  const listConversations = (fields) =>
    supabase
      .from('conversations')
      .select(fields)
      .eq('business_id', business.id)
      .order('last_message_at', { ascending: false })
      .limit(50);

  const baseFields = 'id, handoff_requested, created_at, last_message_at, messages(count)';
  let { data, error } = await listConversations(`${baseFields}, language, intent, summary`);
  if (error) {
    // Insight columns missing (migration 003 not run yet) — list without them.
    ({ data, error } = await listConversations(baseFields));
  }
  if (error) return res.status(500).json({ error: error.message });

  const conversations = (data || []).map((c) => ({
    id: c.id,
    handoffRequested: c.handoff_requested,
    createdAt: c.created_at,
    lastMessageAt: c.last_message_at,
    messageCount: (c.messages && c.messages[0] && c.messages[0].count) || 0,
    language: c.language || null,
    intent: c.intent || null,
    summary: c.summary || ''
  }));

  // Conversations started this and last calendar month (UK time), so staff can
  // see how close a client is to their plan's monthly allowance.
  const now = new Date();
  const thisStart = londonMonthStart(now, 0);
  const lastStart = londonMonthStart(now, -1);
  const countFrom = (from, before) => {
    let query = supabase
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', business.id)
      .gte('created_at', from.toISOString());
    if (before) query = query.lt('created_at', before.toISOString());
    return query;
  };
  const [thisMonth, lastMonth] = await Promise.all([countFrom(thisStart), countFrom(lastStart, thisStart)]);
  const usage = thisMonth.error || lastMonth.error
    ? null
    : {
        conversationsThisMonth: thisMonth.count || 0,
        conversationsLastMonth: lastMonth.count || 0,
        monthStart: thisStart.toISOString()
      };

  return res.status(200).json({ conversations, usage });
};
