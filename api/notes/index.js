const { sql, ensureSchema } = require('../_db');
const { getCurrentUser, hasApp } = require('../_session');

module.exports = async (req, res) => {
  await ensureSchema();

  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  if (!hasApp(user, 'notepad')) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  if (req.method === 'GET') {
    const { rows } = await sql`
      SELECT id, title, content, updated_at FROM notes WHERE user_id = ${user.id} ORDER BY updated_at DESC
    `;
    res.status(200).json({ notes: rows });
    return;
  }

  if (req.method === 'POST') {
    const { title, content } = req.body || {};
    const inserted = await sql`
      INSERT INTO notes (user_id, title, content)
      VALUES (${user.id}, ${title || 'Untitled'}, ${content || ''})
      RETURNING id, title, content, updated_at
    `;
    res.status(201).json({ note: inserted.rows[0] });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
