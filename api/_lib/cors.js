// Cross-origin access for the embeddable widget (widget.js).
//
// The widget runs on clients' own websites, so the public endpoints it calls
// (/api/config, /api/chat, /api/leads) must answer requests from other
// origins. Each business can limit which websites may use its assistant via
// `businesses.allowed_origins`; an empty list means any website may (handy
// for demos). Requests from this app's own pages are always allowed.
//
// Note this stops other websites embedding a client's assistant in a browser;
// it isn't authentication — non-browser clients don't send Origin at all,
// which is why the rate limits still apply to every request.

function normalizeOrigin(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    // Accepts "https://school.co.uk", "https://school.co.uk/contact", etc.
    return new URL(text.includes('://') ? text : `https://${text}`).origin.toLowerCase();
  } catch {
    return '';
  }
}

function isSameSite(req, origin) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  try {
    return Boolean(host) && new URL(origin).host === host;
  } catch {
    return false;
  }
}

// Sets CORS response headers for any browser request that sends an Origin.
// Call first in a handler; returns true if it fully answered a preflight.
function handleCors(req, res) {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') {
    // Preflights carry no body, so the business isn't known yet; the real
    // request is checked against the business's allow-list.
    res.status(204).end();
    return true;
  }
  return false;
}

// Whether the requesting website may use this business's assistant.
function originAllowed(req, business) {
  const origin = req.headers.origin;
  if (!origin || isSameSite(req, origin)) return true;
  const allowed = (Array.isArray(business.allowed_origins) ? business.allowed_origins : [])
    .map(normalizeOrigin)
    .filter(Boolean);
  if (allowed.length === 0) return true;
  return allowed.includes(normalizeOrigin(origin));
}

const ORIGIN_NOT_ALLOWED = 'This website is not set up to use this assistant.';

module.exports = { handleCors, originAllowed, normalizeOrigin, ORIGIN_NOT_ALLOWED };
