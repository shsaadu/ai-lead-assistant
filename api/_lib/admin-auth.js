// Per-business admin auth.
//
// Each business owner has their own account in `admin_users` (email + PBKDF2
// password hash). On login we set an HttpOnly cookie holding a signed,
// expiring session token: base64url(payload) + "." + HMAC-SHA256 signature,
// keyed by SESSION_SECRET. Every protected /api/admin/* route verifies the
// signature server-side and then re-loads the user from the database, so a
// deleted account loses access immediately.
//
// Which business an admin request acts on is decided HERE, from the logged-in
// user — never from a query parameter alone. Owners are locked to their own
// business; only a superadmin may pick one with ?business=<slug>.

const crypto = require('crypto');
const { getSupabase } = require('./supabase');

const COOKIE_NAME = 'admin_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

// ---- Password hashing ----
// PBKDF2-SHA256, stored as pbkdf2_sha256$<iterations>$<salt-hex>$<hash-hex>.
// Chosen over scrypt because Python's standard library can produce the exact
// same hashes (scripts/create_admin.py), so accounts can be created without
// Node installed.
const PBKDF2_ITERATIONS = 600000;
const PBKDF2_KEYLEN = 32;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(String(password), salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, 'sha256');
  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, iterationsStr, saltHex, hashHex] = String(stored || '').split('$');
  const iterations = parseInt(iterationsStr, 10);
  if (scheme !== 'pbkdf2_sha256' || !iterations || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.pbkdf2Sync(String(password), Buffer.from(saltHex, 'hex'), iterations, expected.length, 'sha256');
  return crypto.timingSafeEqual(actual, expected);
}

// Used when the email doesn't exist, so a failed login takes about as long
// whether or not the account is real (avoids revealing which emails exist).
// It never matches any password, but costs the same to check.
const DUMMY_HASH = `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${'0'.repeat(32)}$${'0'.repeat(PBKDF2_KEYLEN * 2)}`;

// ---- Signed session tokens ----

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be set to a random string of at least 32 characters');
  }
  return secret;
}

function sign(value) {
  return crypto.createHmac('sha256', getSecret()).update(value).digest('base64url');
}

function createToken(userId) {
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS })
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function readToken(token) {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature) return null;

  const expected = Buffer.from(sign(payload));
  const provided = Buffer.from(signature);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.uid || !data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

function readCookie(req) {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return match ? match[1] : null;
}

function cookieAttributes() {
  // `Secure` on deployed (HTTPS) environments; left off for plain-http local dev.
  const secure = process.env.VERCEL_ENV ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function setSessionCookie(res, userId) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${createToken(userId)}; ${cookieAttributes()}; Max-Age=${SESSION_TTL_SECONDS}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; ${cookieAttributes()}; Max-Age=0`);
}

// ---- Request helpers ----

// Returns the logged-in admin user row, or null.
async function getSessionUser(req) {
  const session = readToken(readCookie(req));
  if (!session) return null;

  const supabase = getSupabase();
  const { data: user } = await supabase
    .from('admin_users')
    .select('id, email, name, role, business_id')
    .eq('id', session.uid)
    .maybeSingle();
  return user || null;
}

// Resolves the business an admin request is allowed to act on.
async function resolveBusiness(req, user) {
  const supabase = getSupabase();
  const fields = 'id, slug, name';

  if (user.role === 'superadmin') {
    // Superadmins can switch businesses; default to the oldest one.
    if (req.query.business) {
      const { data } = await supabase.from('businesses').select(fields).eq('slug', req.query.business).maybeSingle();
      return data || null;
    }
    const { data } = await supabase.from('businesses').select(fields).order('created_at').limit(1).maybeSingle();
    return data || null;
  }

  // Owners: always their own business, whatever ?business= says.
  const { data } = await supabase.from('businesses').select(fields).eq('id', user.business_id).maybeSingle();
  return data || null;
}

// Guard for protected routes. On success returns { user, business }; on
// failure it has already sent the error response and returns null.
async function requireAdmin(req, res) {
  let user;
  try {
    user = await getSessionUser(req);
  } catch (err) {
    console.error('Admin auth error:', err.message || err);
    res.status(500).json({ error: 'Admin auth is not configured on the server.' });
    return null;
  }
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return null;
  }

  const business = await resolveBusiness(req, user);
  if (!business) {
    res.status(404).json({ error: 'Business not found' });
    return null;
  }
  return { user, business };
}

module.exports = {
  hashPassword,
  verifyPassword,
  DUMMY_HASH,
  setSessionCookie,
  clearSessionCookie,
  getSessionUser,
  resolveBusiness,
  requireAdmin
};
