const { sql, ensureSchema } = require('../lib/_db');
const { getCurrentUser } = require('../lib/_session');

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

  const integrationChecks = [
    { name: 'File Storage', ok: Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN_STORE_ID) },
    { name: 'Hotel Search', ok: Boolean(process.env.RAPIDAPI_KEY) },
    { name: 'Wordle', ok: Boolean(process.env.RAPIDAPI_KEY) },
    { name: 'Life Sim', ok: Boolean(process.env.ANTHROPIC_API_KEY) },
  ];

  const operational = database.ok;
  const user = await getCurrentUser(req).catch(() => null);

  const body = {
    operational,
    checkedAt: new Date().toISOString(),
    database: { ok: database.ok },
    authenticated: Boolean(user),
  };

  if (user) {
    body.database.latencyMs = database.latencyMs;
    body.services = integrationChecks;
  } else {
    body.services = { count: integrationChecks.length, healthy: integrationChecks.filter((s) => s.ok).length };
  }

  res.status(200).json(body);
};
