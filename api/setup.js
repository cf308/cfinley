const { sql, ensureSchema } = require('./_db');
const { hashPassword, setSessionCookie } = require('./_auth');

module.exports = async (req, res) => {
  await ensureSchema();

  if (req.method === 'GET') {
    const { rows } = await sql`SELECT COUNT(*)::int AS count FROM users`;
    res.status(200).json({ needsSetup: rows[0].count === 0 });
    return;
  }

  if (req.method === 'POST') {
    const setupToken = process.env.SETUP_TOKEN;
    if (!setupToken) {
      res.status(500).json({ error: 'Server is not configured for setup.' });
      return;
    }

    const { rows: countRows } = await sql`SELECT COUNT(*)::int AS count FROM users`;
    if (countRows[0].count > 0) {
      res.status(403).json({ error: 'Setup has already been completed.' });
      return;
    }

    const { email, password, token } = req.body || {};
    if (token !== setupToken) {
      res.status(403).json({ error: 'Invalid setup token.' });
      return;
    }
    if (!email || !password || password.length < 8) {
      res.status(400).json({ error: 'Email and a password of at least 8 characters are required.' });
      return;
    }

    const passwordHash = await hashPassword(password);
    const inserted = await sql`
      INSERT INTO users (email, password_hash, is_admin, permissions)
      VALUES (${email.toLowerCase().trim()}, ${passwordHash}, true, ${[]}::text[])
      RETURNING id
    `;

    setSessionCookie(res, inserted.rows[0].id);
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
