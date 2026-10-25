export const itineraryApiEnabled = () => Boolean(process.env.ITINERARY_API_URL);

export const mapsUrl = (watch) =>
  `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(watch.origin)}` +
  `&destination=${watch.place.lat},${watch.place.lon}`;

export function buildItinerary(watch) {
  const { reason, plan } = watch.lastCheck;
  return {
    destination: `${watch.place.name}, ${watch.place.region}`,
    origin: watch.origin,
    date: plan.date,
    reason,
    summary: plan.summary,
    howToGo: plan.howToGo ?? [],
    directionsUrl: mapsUrl(watch),
    stops: plan.stops,
    totalInr: plan.totalInr,
    budgetInr: watch.budgetInr,
    packing: plan.packing ?? [],
  };
}

function itineraryText(it) {
  const inr = (n) => (n ? ` (₹${n})` : '');
  return [
    `🦥 Your trip to ${it.destination} on ${it.date}`,
    it.reason,
    '',
    it.summary,
    '',
    'How to get there',
    ...it.howToGo.map((h) => `• ${h.mode}: ${h.route}${h.durationMin ? `, ~${Math.round(h.durationMin)} min` : ''}${inr(h.costInr)}${h.tip ? `. ${h.tip}` : ''}`),
    `Directions: ${it.directionsUrl}`,
    '',
    'Plan',
    ...it.stops.map((s) => `• ${s.time ? `${s.time} ` : ''}${s.name}${inr(s.costInr)}${s.note ? `. ${s.note}` : ''}`),
    it.totalInr ? `Total ≈ ₹${it.totalInr} of your ₹${it.budgetInr} budget` : '',
    '',
    'Things to carry',
    ...it.packing.map((p) => `☐ ${p.item}${p.why ? `. ${p.why}` : ''}`),
  ].join('\n');
}

// POSTs the itinerary as JSON to whatever mail service ITINERARY_API_URL points at.
export async function sendItinerary(watch, to) {
  const itinerary = buildItinerary(watch);
  const res = await fetch(process.env.ITINERARY_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(process.env.ITINERARY_API_KEY && { authorization: `Bearer ${process.env.ITINERARY_API_KEY}` }),
    },
    body: JSON.stringify({
      to,
      subject: `🦥 GO to ${itinerary.destination} on ${itinerary.date}`,
      text: itineraryText(itinerary),
      itinerary,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Itinerary API responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { ok: true, to, status: res.status };
}
