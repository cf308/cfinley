const { putFile } = require('../_blob');
const { sql, ensureSchema } = require('../_db');
const { getCurrentUser, hasApp } = require('../_session');

const MAX_UPLOAD_BYTES = 4.5 * 1024 * 1024;

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

  if (req.method === 'GET') {
    const { rows } = await sql`
      SELECT id, filename, blob_url, size, uploaded_by, created_at FROM files ORDER BY created_at DESC
    `;
    res.status(200).json({ files: rows });
    return;
  }

  if (req.method === 'POST') {
    let filename = 'upload.bin';
    try {
      filename = decodeURIComponent(req.headers['x-filename'] || filename);
    } catch {
      // keep default
    }

    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > MAX_UPLOAD_BYTES) {
        res.status(413).json({ error: 'File exceeds the 4.5MB upload limit.' });
        return;
      }
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    if (buffer.length === 0) {
      res.status(400).json({ error: 'Empty file.' });
      return;
    }

    const blob = await putFile(filename, buffer, { access: 'public', addRandomSuffix: true });

    const inserted = await sql`
      INSERT INTO files (filename, blob_url, size, uploaded_by)
      VALUES (${filename}, ${blob.url}, ${buffer.length}, ${user.email})
      RETURNING id, filename, blob_url, size, uploaded_by, created_at
    `;
    res.status(201).json({ file: inserted.rows[0] });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
