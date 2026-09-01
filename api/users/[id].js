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

  const id = Number(req.query.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid user id' });
    return;
  }

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method === 'PATCH') {
    const { isAdmin, permissions, password } = req.body || {};

    if (id === admin.id && isAdmin === false) {
      res.status(400).json({ error: 'You cannot remove your own admin access.' });
      return;
    }

    if (password) {
      if (password.length < 8) {
        res.status(400).json({ error: 'Password must be at least 8 characters.' });
        return;
      }
      const passwordHash = await hashPassword(password);
      await sql`UPDATE users SET password_hash = ${passwordHash} WHERE id = ${id}`;
    }

    if (typeof isAdmin === 'boolean') {
      await sql`UPDATE users SET is_admin = ${isAdmin} WHERE id = ${id}`;
    }

    if (Array.isArray(permissions)) {
      const perms = permissions.filter(Boolean);
      await sql`UPDATE users SET permissions = ${perms}::text[] WHERE id = ${id}`;
    }

    const { rows } = await sql`
      SELECT id, email, is_admin, permissions, created_at FROM users WHERE id = ${id}
    `;
    if (!rows[0]) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.status(200).json({ user: rows[0] });
    return;
  }

  if (req.method === 'DELETE') {
    if (id === admin.id) {
      res.status(400).json({ error: 'You cannot delete your own account.' });
      return;
    }
    await sql`DELETE FROM users WHERE id = ${id}`;
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
