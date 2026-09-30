const { getSupabase } = require('../_lib/supabase');
const { getSessionUser, resolveBusiness } = require('../_lib/admin-auth');

// Tells the dashboard who is logged in and which business they're viewing.
// Superadmins also get the list of all businesses for the switcher.
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  let user;
  try {
    user = await getSessionUser(req);
  } catch {
    return res.status(200).json({ authenticated: false });
  }
  if (!user) return res.status(200).json({ authenticated: false });

  const business = await resolveBusiness(req, user);

  let businesses;
  if (user.role === 'superadmin') {
    const { data } = await getSupabase().from('businesses').select('slug, name').order('created_at');
    businesses = data || [];
  }

  return res.status(200).json({
    authenticated: true,
    user: { email: user.email, name: user.name, role: user.role },
    business: business ? { slug: business.slug, name: business.name } : null,
    businesses
  });
};
