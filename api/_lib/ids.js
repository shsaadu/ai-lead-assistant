// Supabase/Postgres rejects malformed UUIDs with an error, so IDs coming from
// the browser are checked before being used in a query.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

module.exports = { isUuid };
