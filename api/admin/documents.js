const { getSupabase } = require('../_lib/supabase');
const { requireAuth } = require('../_lib/admin-auth');
const { embedTexts } = require('../_lib/gemini');
const { chunkText } = require('../_lib/chunk');

module.exports = async function handler(req, res) {
  if (!requireAuth(req, res)) return;

  const supabase = getSupabase();
  const slug = req.query.business || 'northstar-plumbing';
  const { data: business } = await supabase.from('businesses').select('id').eq('slug', slug).single();
  if (!business) return res.status(404).json({ error: 'Business not found' });

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('documents')
      .select('id, name, created_at, chunks(count)')
      .eq('business_id', business.id)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    const documents = (data || []).map((d) => ({
      id: d.id,
      name: d.name,
      createdAt: d.created_at,
      chunkCount: (d.chunks && d.chunks[0] && d.chunks[0].count) || 0
    }));
    return res.status(200).json({ documents });
  }

  if (req.method === 'POST') {
    const { name, content } = req.body || {};
    if (!name || !content) return res.status(400).json({ error: 'name and content are required' });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY is not set on the server.' });

    try {
      const { data: doc, error: docError } = await supabase
        .from('documents')
        .insert({ business_id: business.id, name, content })
        .select('id')
        .single();
      if (docError) throw docError;

      const chunks = chunkText(content);
      const embeddings = await embedTexts(apiKey, chunks, 'RETRIEVAL_DOCUMENT');

      const rows = chunks.map((text, i) => ({
        document_id: doc.id,
        business_id: business.id,
        content: text,
        embedding: embeddings[i]
      }));
      const { error: chunkError } = await supabase.from('chunks').insert(rows);
      if (chunkError) throw chunkError;

      return res.status(200).json({ success: true, documentId: doc.id, chunkCount: chunks.length });
    } catch (err) {
      console.error('Document indexing error:', err.message || err);
      return res.status(500).json({ error: 'Failed to index document: ' + (err.message || String(err)) });
    }
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const { error } = await supabase.from('documents').delete().eq('id', id).eq('business_id', business.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
