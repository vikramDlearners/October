const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const serpapiEnabled = () => Boolean(process.env.SERPAPI_KEY);

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`);
  return res.json();
}

export async function geocode(name) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?count=10&language=en&name=${encodeURIComponent(name)}`;
  const results = (await getJson(url)).results ?? [];
  // Prefer populated places, so "Pondicherry" resolves to the town rather than its airport.
  const place = results.find((r) => r.feature_code?.startsWith('PPL')) ?? results[0];
  if (!place) return null;
  return {
    name: place.name,
    region: [place.admin1, place.country].filter(Boolean).join(', '),
    lat: place.latitude,
    lon: place.longitude,
  };
}

// Open-Meteo forecasts 16 days ahead, so days past that horizon are never candidates.
export async function candidateDays(watch) {
  const { lat, lon } = watch.place;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&timezone=auto&forecast_days=16` +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max';
  const { daily } = await getJson(url);

  const days = daily.time.map((date, i) => ({
    date,
    weekday: WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()],
    tempMaxC: daily.temperature_2m_max[i],
    tempMinC: daily.temperature_2m_min[i],
    rainMm: daily.precipitation_sum[i],
    rainChancePct: daily.precipitation_probability_max[i],
    weatherCode: daily.weather_code[i],
  }));

  const horizon = days.at(-1).date;
  const inWindow = days.filter(
    (d) =>
      d.date >= watch.from &&
      d.date <= watch.to &&
      (!watch.weekendsOnly || d.weekday === 'Sat' || d.weekday === 'Sun'),
  );
  return { days: inWindow, horizon };
}

export async function nearbyPlaces(watch) {
  if (!serpapiEnabled()) return [];
  const { lat, lon, name } = watch.place;
  const query = watch.vibe ? `${watch.vibe} places in ${name}` : `things to do in ${name}`;
  const url =
    `https://serpapi.com/search.json?engine=google_maps&type=search&hl=en` +
    `&q=${encodeURIComponent(query)}&ll=${encodeURIComponent(`@${lat},${lon},13z`)}` +
    `&api_key=${process.env.SERPAPI_KEY}`;
  const results = (await getJson(url)).local_results ?? [];
  return results.slice(0, 8).map((p) => ({
    name: p.title,
    type: p.type,
    rating: p.rating,
    reviews: p.reviews,
    price: p.price,
    address: p.address,
  }));
}
