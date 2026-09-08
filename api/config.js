const { getSupabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const slug = req.query.business || 'northstar-plumbing';

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('businesses')
      .select('slug, name, tagline, brand_color, services')
      .eq('slug', slug)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Business not found' });
    return res.status(200).json(data);
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
