const { del } = require('@vercel/blob');
const { sql, ensureSchema } = require('../_db');
const { getCurrentUser, hasApp } = require('../_session');

module.exports = async (req, res) => {
  await ensureSchema();

  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  if (!hasApp(user, 'files')) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  const id = Number(req.query.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid file id' });
    return;
  }

  if (req.method === 'DELETE') {
    const { rows } = await sql`SELECT id, blob_url, uploaded_by FROM files WHERE id = ${id}`;
    const file = rows[0];
    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    if (!user.is_admin && file.uploaded_by !== user.email) {
      res.status(403).json({ error: 'You can only delete files you uploaded.' });
      return;
    }

    await del(file.blob_url);
    await sql`DELETE FROM files WHERE id = ${id}`;
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
