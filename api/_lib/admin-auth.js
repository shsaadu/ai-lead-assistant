// Minimal admin auth: the admin password (set as an env var, never stored in
// the database) is hashed into a session token and set as an HttpOnly cookie
// on login. Every protected /api/admin/* route checks this cookie server-side
// — the dashboard UI being hidden client-side is not what actually protects
// the data.

const crypto = require('crypto');

function getExpectedToken() {
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) return null;
  return crypto.createHash('sha256').update(secret).digest('hex');
}

function isAuthed(req) {
  const expected = getExpectedToken();
  if (!expected) return false;
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/(?:^|;\s*)admin_session=([^;]+)/);
  if (!match) return false;
  // Constant-time comparison to avoid leaking the token via response-timing.
  const provided = Buffer.from(match[1]);
  const expectedBuf = Buffer.from(expected);
  if (provided.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(provided, expectedBuf);
}

function setSessionCookie(res) {
  const token = getExpectedToken();
  res.setHeader(
    'Set-Cookie',
    `admin_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'admin_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

function requireAuth(req, res) {
  if (!isAuthed(req)) {
    res.status(401).json({ error: 'Not authenticated' });
    return false;
  }
  return true;
}

module.exports = { isAuthed, setSessionCookie, clearSessionCookie, requireAuth };
