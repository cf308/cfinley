const { sql, ensureSchema } = require('../lib/_db');
const { verifyPassword, setSessionCookie } = require('../lib/_auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  await ensureSchema();

  const { email, password } = req.body || {};
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }

  const { rows } = await sql`
    SELECT id, password_hash, is_admin FROM users WHERE email = ${email.toLowerCase().trim()}
  `;
  const user = rows[0];
  const valid = await verifyPassword(password, user && user.password_hash);

  if (!user || !valid) {
    res.status(401).json({ error: 'Invalid credentials.' });
    return;
  }

  await sql`UPDATE users SET last_login_at = now() WHERE id = ${user.id}`;

  setSessionCookie(res, user.id);
  res.status(200).json({ ok: true, isAdmin: user.is_admin });
};
