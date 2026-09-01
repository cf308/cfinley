const { getCurrentUser, hasApp } = require('./_session');

const RAPIDAPI_HOST = 'booking-com15.p.rapidapi.com';

async function rapidFetch(path, params) {
  const url = `https://${RAPIDAPI_HOST}${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, {
    headers: {
      'x-rapidapi-host': RAPIDAPI_HOST,
      'x-rapidapi-key': process.env.RAPIDAPI_KEY,
    },
  });
  if (!res.ok) {
    throw new Error(`Booking.com API error (${res.status})`);
  }
  return res.json();
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

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
  if (!hasApp(user, 'hotels')) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  if (!process.env.RAPIDAPI_KEY) {
    res.status(500).json({ error: 'Hotel search is not configured.' });
    return;
  }

  const city = (req.query.city || '').trim();
  if (!city) {
    res.status(400).json({ error: 'City is required.' });
    return;
  }

  try {
    const destData = await rapidFetch('/api/v1/hotels/searchDestination', { query: city });
    const destinations = (destData && destData.data) || [];
    const dest = destinations.find((d) => d.dest_type === 'city') || destinations[0];

    if (!dest) {
      res.status(404).json({ error: `No destinations found for "${city}".` });
      return;
    }

    const arrival = addDays(new Date(), 7);
    const departure = addDays(new Date(), 8);

    const hotelData = await rapidFetch('/api/v1/hotels/searchHotels', {
      dest_id: dest.dest_id,
      search_type: dest.dest_type.toUpperCase(),
      arrival_date: arrival,
      departure_date: departure,
      adults: '1',
      room_qty: '1',
      page_number: '1',
      units: 'metric',
      temperature_unit: 'c',
      languagecode: 'en-us',
      currency_code: 'USD',
    });

    const hotels = ((hotelData && hotelData.data && hotelData.data.hotels) || []).map((h) => {
      const p = h.property || {};
      const price = p.priceBreakdown && p.priceBreakdown.grossPrice;
      return {
        id: p.id,
        name: p.name,
        reviewScore: p.reviewScore || null,
        reviewScoreWord: p.reviewScoreWord || null,
        reviewCount: p.reviewCount || 0,
        stars: p.propertyClass || null,
        photo: (p.photoUrls && p.photoUrls[0]) || null,
        price: price ? price.value : null,
        currency: price ? price.currency : null,
      };
    });

    res.status(200).json({
      destination: { name: dest.name, label: dest.label, country: dest.country },
      checkin: arrival,
      checkout: departure,
      hotels,
    });
  } catch (err) {
    res.status(502).json({ error: 'Unable to reach the hotel search provider.' });
  }
};
