const { sql, ensureSchema } = require('../lib/_db');

const DEFAULT_LOCATION = { latitude: 41.6688, longitude: -70.2962 };
const RADIUS_NM = 150;
const CACHE_MS = 12000;

let cache = { at: 0, aircraft: [] };

async function getCoords() {
  const { rows } = await sql`SELECT value FROM settings WHERE key = 'location'`;
  if (!rows[0]) return DEFAULT_LOCATION;
  try {
    const parsed = JSON.parse(rows[0].value);
    if (typeof parsed.latitude === 'number' && typeof parsed.longitude === 'number') {
      return { latitude: parsed.latitude, longitude: parsed.longitude };
    }
  } catch {
    // fall through to default
  }
  return DEFAULT_LOCATION;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (Date.now() - cache.at < CACHE_MS) {
    res.status(200).json({ aircraft: cache.aircraft });
    return;
  }

  await ensureSchema();
  const { latitude, longitude } = await getCoords();

  try {
    const url = `https://api.adsb.lol/v2/point/${latitude}/${longitude}/${RADIUS_NM}`;
    const apiRes = await fetch(url);
    if (!apiRes.ok) throw new Error('adsb.lol http ' + apiRes.status);
    const data = await apiRes.json();

    const aircraft = Array.isArray(data.ac)
      ? data.ac
          .filter((a) => typeof a.lat === 'number' && typeof a.lon === 'number')
          .map((a) => ({
            hex: a.hex,
            callsign: (a.flight || '').trim(),
            type: a.t || null,
            altitude: typeof a.alt_baro === 'number' ? a.alt_baro : null,
            track: typeof a.track === 'number' ? a.track : 0,
            lat: a.lat,
            lon: a.lon,
          }))
      : [];

    cache = { at: Date.now(), aircraft };
    res.status(200).json({ aircraft });
  } catch (err) {
    // Serve the last known-good positions rather than clearing the map;
    // the background is designed to keep working with zero aircraft anyway.
    res.status(200).json({ aircraft: cache.aircraft });
  }
};
