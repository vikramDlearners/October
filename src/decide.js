export const GEMMA_MODEL = process.env.GEMMA_MODEL || 'gemma-4-31b-it';
export const gemmaEnabled = () => Boolean(process.env.GEMINI_API_KEY);

const RAINY = (d) => d.rainChancePct >= 40 || d.rainMm >= 2;

export async function decide(watch, days, places) {
  if (!gemmaEnabled()) return ruleDecision(watch, days, places, 'rules (no GEMINI_API_KEY)');
  let reply;
  try {
    reply = await callGemma(buildPrompt(watch, days, places));
  } catch (err) {
    return ruleDecision(watch, days, places, `rules (${err.message})`);
  }
  const parsed = parseDecision(reply);
  if (!parsed) return ruleDecision(watch, days, places, `rules (${GEMMA_MODEL} reply was not valid JSON)`);
  if (parsed.plan) parsed.plan = completePlan(parsed.plan, watch, days, places);
  return { ...parsed, decidedBy: GEMMA_MODEL };
}

// Always carried, wherever you go. Gemma adds the place- and weather-specific items on top.
const ESSENTIALS = [
  { item: 'Water bottle', why: 'Stay hydrated between stops.' },
  { item: 'Wallet with some cash', why: 'Small shops, autos and entry tickets often want cash or UPI.' },
  { item: 'ID card', why: 'Needed for tickets, hotels and checkpoints.' },
  { item: 'Phone and power bank', why: 'Maps, tickets and photos drain the battery.' },
];

function rulePacking(day, places) {
  const items = [];
  if (day && (day.rainChancePct >= 30 || day.rainMm >= 1)) items.push({ item: 'Umbrella or raincoat', why: `${day.rainChancePct}% chance of rain.` });
  if (day && day.tempMaxC >= 30) {
    items.push({ item: 'Sunscreen', why: `Up to ${Math.round(day.tempMaxC)}°C.` }, { item: 'Cap or hat', why: 'Shade for the hottest hours.' });
  }
  if (day && day.tempMaxC <= 18) items.push({ item: 'Warm jacket', why: `Only ${Math.round(day.tempMaxC)}°C at the warmest.` });
  const types = places.map((p) => `${p.name} ${p.type ?? ''}`.toLowerCase()).join(' ');
  if (/beach|sea|shore/.test(types)) items.push({ item: 'Towel and spare clothes', why: 'For the beach.' }, { item: 'Flip-flops', why: 'Sand and wet feet.' });
  if (/temple|church|mosque|shrine/.test(types)) items.push({ item: 'Modest clothes', why: 'Temples ask for covered shoulders and knees.' });
  if (/hill|peak|trek|falls|forest|park/.test(types)) items.push({ item: 'Comfortable walking shoes', why: 'Trails and uneven paths.' });
  return items;
}

// Fills gaps in Gemma's plan and guarantees the essentials, so the checklist never comes back empty.
function completePlan(plan, watch, days, places) {
  const day = days.find((d) => d.date === plan.date);
  const extra = Array.isArray(plan.packing) && plan.packing.length ? plan.packing : rulePacking(day, places);
  const seen = new Set();
  const packing = [...ESSENTIALS, ...extra]
    .map((p) => (typeof p === 'string' ? { item: p, why: '' } : { item: String(p.item ?? ''), why: String(p.why ?? '') }))
    .filter((p) => {
      const key = p.item.toLowerCase().replace(/[^a-z]/g, '');
      if (!p.item || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const howToGo = Array.isArray(plan.howToGo) && plan.howToGo.length
    ? plan.howToGo
    : [{ mode: 'Road', route: `${watch.origin} to ${watch.place.name}`, durationMin: null, costInr: null, tip: 'Open the map for live directions and traffic.' }];
  return { ...plan, stops: plan.stops ?? [], howToGo, packing };
}

function buildPrompt(watch, days, places) {
  return `You are Sloth Trip Watcher, a travel planner for a lazy traveller in India.
Decide whether to tell them to GO on a trip now, or to wait.

Their watch rule:
- Destination: ${watch.place.name}, ${watch.place.region}
- Travelling from: ${watch.origin}
- Only days between ${watch.from} and ${watch.to}${watch.weekendsOnly ? ', weekends only' : ''}
- Total budget per person, all-in (travel, food, entry): INR ${watch.budgetInr}
- Must avoid rain: ${watch.noRain ? 'yes' : 'no'}
- Vibe: ${watch.vibe || 'anything good'}

Forecast for the candidate days:
${JSON.stringify(days)}

Places at the destination, from Google Maps:
${places.length ? JSON.stringify(places) : 'None available. Suggest well-known places from your own knowledge.'}

Rules:
- Say GO only if a candidate day fits the weather rule and a realistic plan fits the budget.
- Pick exactly one day and one plan. Never offer alternatives.
- The plan has 3 to 5 stops in visiting order, each with a start time.
- Costs are realistic INR estimates.
- "howToGo" lists 2 or 3 ways to travel from the origin (bus, train, cab, own car or bike), best option first, with realistic duration and per-person INR cost, the actual route or station names, and one practical tip each.
- "packing" lists 5 to 8 things to carry that are specific to this place, these stops and this day's weather (for example swimwear for a beach, modest clothes for a temple, an umbrella for rain). Skip generic items like water, wallet, ID and phone; those are added automatically.
- If NOT_YET, the reason says what would have to change.

Reply with only a JSON object and nothing else, in this shape:
{"verdict":"GO or NOT_YET","reason":"one sentence","plan":null or {"date":"YYYY-MM-DD","summary":"one sentence","gettingThere":"one line on the best way to travel there","howToGo":[{"mode":"Bus","route":"...","durationMin":0,"costInr":0,"tip":"..."}],"stops":[{"time":"09:00","name":"...","note":"why go","costInr":0}],"packing":[{"item":"...","why":"..."}],"totalInr":0}}`;
}

async function callGemma(prompt) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMMA_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      // Gemma 4 thinks by default, which pushed replies past a minute. "minimal" switches it off.
      generationConfig: { temperature: 0.3, thinkingConfig: { thinkingLevel: 'minimal' } },
    }),
    signal: AbortSignal.timeout(120000),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Gemma call failed: ${body.error?.message ?? res.status}`);
  const parts = body.candidates?.[0]?.content?.parts ?? [];
  return parts.filter((p) => !p.thought).map((p) => p.text).join('');
}

// Gemma on the Gemini API has no JSON mode, so the reply may arrive wrapped in prose or code fences.
function parseDecision(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const d = JSON.parse(text.slice(start, end + 1));
    if (d.verdict !== 'GO' && d.verdict !== 'NOT_YET') return null;
    if (d.verdict === 'GO' && !d.plan?.date) return null;
    return { verdict: d.verdict, reason: String(d.reason ?? ''), plan: d.verdict === 'GO' ? d.plan : null };
  } catch {
    return null;
  }
}

function ruleDecision(watch, days, places, decidedBy) {
  const day = days.find((d) => !watch.noRain || !RAINY(d));
  if (!day) {
    return {
      verdict: 'NOT_YET',
      reason: days.length
        ? `Every candidate day in the forecast looks wet (${days.map((d) => `${d.date}: ${d.rainChancePct}%`).join(', ')}).`
        : 'None of your dates are inside the 16-day forecast yet.',
      plan: null,
      decidedBy,
    };
  }
  const decision = {
    verdict: 'GO',
    reason: watch.noRain
      ? `${day.weekday} ${day.date} looks dry (${day.rainChancePct}% rain chance, ${day.tempMaxC}°C).`
      : `${day.weekday} ${day.date} is your first open day (${day.rainChancePct}% rain chance, ${day.tempMaxC}°C, rain allowed).`,
    plan: {
      date: day.date,
      summary: gemmaEnabled()
        ? `Weather fits. Gemma couldn't plan this time, so here are the top places.`
        : 'Weather fits. Add a GEMINI_API_KEY for a timed, budgeted plan.',
      gettingThere: `From ${watch.origin}.`,
      stops: places.slice(0, 4).map((p) => ({ time: '', name: p.name, note: p.type ?? '', costInr: null })),
      totalInr: null,
    },
    decidedBy,
  };
  decision.plan = completePlan(decision.plan, watch, days, places);
  return decision;
}
