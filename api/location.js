const { sql, ensureSchema } = require('../lib/_db');
const { getCurrentUser } = require('../lib/_session');

const DEFAULT_LOCATION = {
  label: 'CAPE COD, MA',
  geocodeQuery: 'Cape Cod, Massachusetts',
  latitude: 41.6688,
  longitude: -70.2962,
};

async function getLocation() {
  const { rows } = await sql`SELECT value FROM settings WHERE key = 'location'`;
  if (!rows[0]) return DEFAULT_LOCATION;
  try {
    return JSON.parse(rows[0].value);
  } catch {
    return DEFAULT_LOCATION;
  }
}

module.exports = async (req, res) => {
  await ensureSchema();

  if (req.method === 'GET') {
    const location = await getLocation();
    res.status(200).json(location);
    return;
  }

  if (req.method === 'PATCH') {
    const user = await getCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    if (!user.is_admin) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    const { label, geocodeQuery } = req.body || {};
    if (!label || !geocodeQuery) {
      res.status(400).json({ error: 'Display label and location are both required.' });
      return;
    }

    let coords;
    try {
      const geoRes = await fetch(
        'https://geocoding-api.open-meteo.com/v1/search?name=' +
          encodeURIComponent(geocodeQuery) +
          '&count=1&language=en&format=json'
      );
      if (!geoRes.ok) throw new Error('geocode http ' + geoRes.status);
      const geoData = await geoRes.json();
      const result = geoData && geoData.results && geoData.results[0];
      if (!result) throw new Error('no geocoding result');
      coords = { latitude: result.latitude, longitude: result.longitude };
    } catch (err) {
      res.status(502).json({ error: 'Unable to resolve that location via Open-Meteo.' });
      return;
    }

    const location = { label, geocodeQuery, latitude: coords.latitude, longitude: coords.longitude };
    const value = JSON.stringify(location);

    await sql`
      INSERT INTO settings (key, value) VALUES ('location', ${value})
      ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = now()
    `;

    res.status(200).json(location);
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
