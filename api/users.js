const { sql, ensureSchema } = require('../lib/_db');
const { getSessionUserId, hashPassword } = require('../lib/_auth');

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

async function handleCollection(req, res) {
  if (req.method === 'GET') {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const { rows } = await sql`
      SELECT u.id, u.email, u.is_admin, u.permissions, u.created_at, u.last_login_at,
             COALESCE(r.balance, 1000) AS roulette_balance
      FROM users u
      LEFT JOIN roulette_balances r ON r.user_id = u.id
      ORDER BY u.created_at ASC
    `;

    const [{ count: totalFiles }] = (await sql`SELECT COUNT(*)::int AS count FROM files`).rows;
    const [{ count: totalNotes }] = (await sql`SELECT COUNT(*)::int AS count FROM notes`).rows;
    const [{ count: totalLifeSim }] = (await sql`SELECT COUNT(*)::int AS count FROM life_sim`).rows;
    const [{ count: activeLifeSim }] = (await sql`SELECT COUNT(*)::int AS count FROM life_sim WHERE alive = true`).rows;

    res.status(200).json({
      users: rows,
      stats: {
        totalUsers: rows.length,
        totalFiles,
        totalNotes,
        totalLifeSimCharacters: totalLifeSim,
        activeLifeSimCharacters: activeLifeSim,
      },
    });
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
}

async function handleItem(req, res, id) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method === 'PATCH') {
    const { isAdmin, permissions, password, rouletteBalance } = req.body || {};

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

    if (rouletteBalance !== undefined) {
      if (!Number.isInteger(rouletteBalance) || rouletteBalance < 0) {
        res.status(400).json({ error: 'Balance must be a non-negative whole number.' });
        return;
      }
      await sql`
        INSERT INTO roulette_balances (user_id, balance, updated_at) VALUES (${id}, ${rouletteBalance}, now())
        ON CONFLICT (user_id) DO UPDATE SET balance = ${rouletteBalance}, updated_at = now()
      `;
    }

    const { rows } = await sql`
      SELECT u.id, u.email, u.is_admin, u.permissions, u.created_at,
             COALESCE(r.balance, 1000) AS roulette_balance
      FROM users u
      LEFT JOIN roulette_balances r ON r.user_id = u.id
      WHERE u.id = ${id}
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
}

module.exports = async (req, res) => {
  await ensureSchema();

  const rawId = req.query.id;

  if (rawId === undefined) {
    await handleCollection(req, res);
    return;
  }

  const id = Number(rawId);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid user id' });
    return;
  }

  await handleItem(req, res, id);
};
