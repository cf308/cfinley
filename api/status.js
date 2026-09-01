const { sql, ensureSchema } = require('../lib/_db');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let database = { ok: false, latencyMs: null };
  try {
    await ensureSchema();
    const start = Date.now();
    await sql`SELECT 1`;
    database = { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    database = { ok: false, latencyMs: null };
  }

  const integrations = {
    fileStorage: Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN_STORE_ID),
    hotelSearch: Boolean(process.env.RAPIDAPI_KEY),
    wordle: Boolean(process.env.RAPIDAPI_KEY),
    lifeSim: Boolean(process.env.ANTHROPIC_API_KEY),
  };

  res.status(200).json({
    operational: database.ok,
    checkedAt: new Date().toISOString(),
    database,
    integrations,
  });
};
