const { sql, ensureSchema } = require('../lib/_db');
const { getCurrentUser, hasApp } = require('../lib/_session');

async function handleCollection(req, res, user) {
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
}

async function handleItem(req, res, user, id) {
  const { rows: existingRows } = await sql`SELECT id FROM notes WHERE id = ${id} AND user_id = ${user.id}`;
  if (!existingRows[0]) {
    res.status(404).json({ error: 'Note not found' });
    return;
  }

  if (req.method === 'PATCH') {
    const { title, content } = req.body || {};
    const updated = await sql`
      UPDATE notes SET title = ${title || ''}, content = ${content || ''}, updated_at = now()
      WHERE id = ${id}
      RETURNING id, title, content, updated_at
    `;
    res.status(200).json({ note: updated.rows[0] });
    return;
  }

  if (req.method === 'DELETE') {
    await sql`DELETE FROM notes WHERE id = ${id}`;
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}

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

  const rawId = req.query.id;

  if (rawId === undefined) {
    await handleCollection(req, res, user);
    return;
  }

  const id = Number(rawId);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid note id' });
    return;
  }

  await handleItem(req, res, user, id);
};
