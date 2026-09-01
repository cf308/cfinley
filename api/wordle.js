const { sql, ensureSchema } = require('../lib/_db');
const { getCurrentUser, hasApp } = require('../lib/_session');

const RAPIDAPI_HOST = 'wordle-api3.p.rapidapi.com';

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  await ensureSchema();

  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  if (!hasApp(user, 'wordle')) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  if (!process.env.RAPIDAPI_KEY) {
    res.status(500).json({ error: 'Wordle is not configured.' });
    return;
  }

  const today = new Date().toISOString().slice(0, 10);

  const { rows: cached } = await sql`SELECT word FROM wordle_words WHERE date = ${today}`;
  if (cached[0]) {
    res.status(200).json({ date: today, word: cached[0].word.toLowerCase() });
    return;
  }

  try {
    const url = `https://${RAPIDAPI_HOST}/getwordfor/${today}`;
    const apiRes = await fetch(url, {
      headers: {
        'x-rapidapi-host': RAPIDAPI_HOST,
        'x-rapidapi-key': process.env.RAPIDAPI_KEY,
      },
    });
    if (!apiRes.ok) {
      throw new Error(`Wordle API error (${apiRes.status})`);
    }
    const data = await apiRes.json();
    const word = (data.word || '').toLowerCase().trim();
    if (!word) {
      throw new Error('No word returned');
    }

    await sql`
      INSERT INTO wordle_words (date, word) VALUES (${today}, ${word})
      ON CONFLICT (date) DO NOTHING
    `;

    res.status(200).json({ date: today, word });
  } catch (err) {
    console.error('Wordle fetch failed:', err);
    res.status(502).json({ error: 'Unable to reach the Wordle provider.', detail: String(err && err.message) });
  }
};
