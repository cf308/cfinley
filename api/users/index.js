const { sql, ensureSchema } = require('../_db');
const { getSessionUserId, hashPassword } = require('../_auth');

async function requireAdmin(req, res) {
  const uid = getSessionUserId(req);
  if (!uid) {
    res.status(401).json({ error: 'Not authenticated' });
    return null;
  }
  const { rows } = await sql`SELECT id, is_admin FROM users WHERE id = ${uid}`;
  const user = rows[0];
  if (!user || !user.is_admin) {
    res.status(403).json({ error: 'Admin access required' });
    return null;
  }
  return user;
}

module.exports = async (req, res) => {
  await ensureSchema();

  if (req.method === 'GET') {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const { rows } = await sql`
      SELECT id, email, is_admin, permissions, created_at FROM users ORDER BY created_at ASC
    `;
    res.status(200).json({ users: rows });
    return;
  }

  if (req.method === 'POST') {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { email, password, isAdmin, permissions } = req.body || {};
    if (!email || !password || password.length < 8) {
      res.status(400).json({ error: 'Email and a password of at least 8 characters are required.' });
      return;
    }

    const perms = Array.isArray(permissions) ? permissions.filter(Boolean) : [];
    const passwordHash = await hashPassword(password);

    try {
      const inserted = await sql`
        INSERT INTO users (email, password_hash, is_admin, permissions)
        VALUES (${email.toLowerCase().trim()}, ${passwordHash}, ${Boolean(isAdmin)}, ${perms}::text[])
        RETURNING id, email, is_admin, permissions, created_at
      `;
      res.status(201).json({ user: inserted.rows[0] });
    } catch (err) {
      if (String(err.message).includes('duplicate key')) {
        res.status(409).json({ error: 'A user with that email already exists.' });
        return;
      }
      throw err;
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
