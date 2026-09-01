const { sql } = require('./_db');
const { getSessionUserId } = require('./_auth');

async function getCurrentUser(req) {
  const uid = getSessionUserId(req);
  if (!uid) return null;
  const { rows } = await sql`SELECT id, email, is_admin, permissions FROM users WHERE id = ${uid}`;
  return rows[0] || null;
}

function hasApp(user, appId) {
  return Boolean(user && (user.is_admin || (user.permissions || []).includes(appId)));
}

module.exports = { getCurrentUser, hasApp };
