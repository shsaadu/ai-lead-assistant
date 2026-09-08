// Server-only Supabase client using the service_role key — this bypasses
// row-level security, which is fine here because these functions run in
// Vercel's backend, never in the browser. Never expose the service_role key
// to the frontend.

const { createClient } = require('@supabase/supabase-js');

let client = null;

function getSupabase() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
  }
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

module.exports = { getSupabase };
