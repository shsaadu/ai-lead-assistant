const { getSupabase } = require('../_lib/supabase');
const { verifyPassword, DUMMY_HASH, setSessionCookie } = require('../_lib/admin-auth');
const rateLimit = require('../_lib/rate-limit');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  let supabase;
  try {
    supabase = getSupabase();
  } catch {
    return res.status(500).json({ error: 'Database is not configured yet — add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.' });
  }

  // Slow down password guessing: 10 attempts per IP per 15 minutes.
  const allowed = await rateLimit.allow(supabase, rateLimit.ipKey(req, 'login'), 15 * 60, 10);
  if (!allowed) {
    return res.status(429).json({ error: 'Too many login attempts. Please wait 15 minutes and try again.' });
  }

  try {
    const { data: user } = await supabase
      .from('admin_users')
      .select('id, password_hash')
      .eq('email', String(email).trim().toLowerCase())
      .maybeSingle();

    // Always run the hash check, even for unknown emails, so response timing
    // doesn't reveal which accounts exist.
    const valid = verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !valid) {
      return res.status(401).json({ error: 'Incorrect email or password' });
    }

    setSessionCookie(res, user.id);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Login error:', err.message || err);
    return res.status(500).json({ error: 'Could not sign in. Check that SESSION_SECRET is set on the server.' });
  }
};
