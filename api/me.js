const { sql, ensureSchema } = require('./_db');
const { getSessionUserId } = require('./_auth');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  await ensureSchema();

  const uid = getSessionUserId(req);
  if (!uid) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const { rows } = await sql`SELECT id, email, is_admin, permissions FROM users WHERE id = ${uid}`;
  const user = rows[0];
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  res.status(200).json({ id: user.id, email: user.email, isAdmin: user.is_admin, permissions: user.permissions });
};
