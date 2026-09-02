const { getCurrentUser, hasApp } = require('../lib/_session');

const RAPIDAPI_HOST = 'real-time-news-data.p.rapidapi.com';
const CACHE_MS = 5 * 60 * 1000;
const LIMIT = 30;

let cache = { at: 0, articles: [] };

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  if (!hasApp(user, 'news')) {
    res.status(403).json({ error: 'You do not have access to this app.' });
    return;
  }

  if (Date.now() - cache.at < CACHE_MS && cache.articles.length) {
    res.status(200).json({ articles: cache.articles });
    return;
  }

  if (!process.env.RAPIDAPI_KEY) {
    res.status(502).json({ error: 'News is not configured.' });
    return;
  }

  try {
    const url = `https://${RAPIDAPI_HOST}/top-headlines?limit=${LIMIT}&country=US&lang=en`;
    const apiRes = await fetch(url, {
      headers: {
        'x-rapidapi-key': process.env.RAPIDAPI_KEY,
        'x-rapidapi-host': RAPIDAPI_HOST,
      },
    });
    if (!apiRes.ok) throw new Error('news api http ' + apiRes.status);
    const data = await apiRes.json();

    const articles = Array.isArray(data.data)
      ? data.data.map((a) => ({
          title: a.title,
          link: a.link,
          snippet: a.snippet || null,
          image: a.photo_url || a.thumbnail_url || null,
          publishedAt: a.published_datetime_utc || null,
          source: a.source_name || null,
          sourceIcon: a.source_favicon_url || null,
        }))
      : [];

    cache = { at: Date.now(), articles };
    res.status(200).json({ articles });
  } catch (err) {
    console.error('news: upstream fetch failed', err && err.message);
    if (cache.articles.length) {
      res.status(200).json({ articles: cache.articles });
    } else {
      res.status(502).json({ error: 'Unable to load news right now.' });
    }
  }
};
