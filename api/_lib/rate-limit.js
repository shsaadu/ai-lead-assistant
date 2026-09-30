// Fixed-window rate limiting backed by the `hit_rate_limit` Postgres function
// (see supabase/schema.sql). Keeps bots from burning through the Gemini quota
// and slows down password guessing on the admin login.
//
// Visitor IPs are hashed before they're used as keys, so raw IP addresses are
// never stored in the database.

const crypto = require('crypto');

function clientIp(req) {
  // Vercel sets x-forwarded-for; the first entry is the original client.
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function hashIp(ip) {
  const salt = process.env.SESSION_SECRET || '';
  return crypto.createHash('sha256').update(salt + ip).digest('hex').slice(0, 32);
}

function ipKey(req, prefix) {
  return `${prefix}:ip:${hashIp(clientIp(req))}`;
}

// Returns true if the request is allowed. If the limiter itself fails (e.g.
// the migration hasn't been run yet), it fails open — a broken limiter
// shouldn't take the whole assistant down.
async function allow(supabase, key, windowSeconds, max) {
  try {
    const { data, error } = await supabase.rpc('hit_rate_limit', {
      p_key: key,
      p_window_seconds: windowSeconds,
      p_max: max
    });
    if (error) {
      console.error('Rate limiter error:', error.message);
      return true;
    }
    return data !== false;
  } catch (err) {
    console.error('Rate limiter error:', err.message || err);
    return true;
  }
}

function envInt(name, fallback) {
  const value = parseInt(process.env[name], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

module.exports = { allow, ipKey, envInt };
