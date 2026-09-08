const { setSessionCookie } = require('../_lib/admin-auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password } = req.body || {};
  const expected = process.env.ADMIN_PASSWORD;

  if (!expected) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD is not set on the server yet.' });
  }
  if (!password || password !== expected) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  setSessionCookie(res);
  return res.status(200).json({ success: true });
};
