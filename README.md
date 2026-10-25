# Sloth Trip Watcher 🦥

Tell it once where you want to go, when, and how much you'll spend. It checks the weather and what's worth seeing on a schedule, and Gemma decides whether to tell you **GO** (with one timed, budgeted plan) or **NOT YET**. When the answer flips to GO, it messages you on Telegram.

Built for the Hacktoberfest Open-Source AI Challenge, Week 3 ("Slow and Steady").

## How it works

1. You create a *watch*: destination, origin, date window, budget per person, weekends only, no rain, vibe.
2. Every `CHECK_EVERY_HOURS` (default 12), and whenever you press **Check now**, the server:
   - pulls a 16-day forecast from [Open-Meteo](https://open-meteo.com) (free, no key) and keeps the days inside your window,
   - pulls top places at the destination from Google Maps via [SerpApi](https://serpapi.com),
   - asks Gemma (`gemma-4-31b-it` via the Gemini API) for a `GO` / `NOT_YET` verdict as JSON,
   - sends a Telegram alert the first time a given date becomes GO.
3. The page shows each watch's verdict, the forecast strip, and a GO plan in four tabs:
   - **Plan.** Timed stops with costs and how much of the budget they use.
   - **How to go.** Two or three ways to travel from your origin (bus, train, cab), best first, with duration, cost per person and a tip, plus a Google Maps directions link.
   - **Things to carry.** A tick-off checklist. Water, wallet, ID and phone are always on it, and Gemma adds items for the place and the day's weather (modest clothes for temples, an umbrella for rain). You can add your own. Ticks are saved in your browser per trip date.
   - **Send.** Emails the whole itinerary through your own mail API (see below).

### Send itinerary

`POST /api/watches/:id/send` with `{"email": "you@example.com"}` posts this JSON to `ITINERARY_API_URL`:

```json
{ "to": "you@example.com", "subject": "🦥 GO to …", "text": "plain-text itinerary", "itinerary": { "destination": "…", "date": "…", "howToGo": [], "stops": [], "packing": [], "directionsUrl": "…" } }
```

Point it at anything that sends mail: your own relay, or a Make, Zapier or n8n webhook. If `ITINERARY_API_KEY` is set, it goes as `Authorization: Bearer <key>`. Without `ITINERARY_API_URL`, the Send button is disabled.

Each integration is optional. Without `GEMINI_API_KEY`, a weather-only rule decides. Without `SERPAPI_KEY`, Gemma suggests places from its own knowledge. Without Telegram keys, the result only shows on the page. The status pills in the header show what's live.

## Run locally

Requires Node 22.9 or newer. There are no dependencies to install.

```bash
cp .env.example .env
npm run dev
```

Open http://localhost:3000. Run every watch's check once from the terminal with `npm run check`.

## Frontend on its own

`public/` is a static site with no build step. The backend serves it at `/`, and you can also host it anywhere else (Render static site, Netlify, nginx). Enter the backend URL in the **Backend** bar at the top, or open the page with `?api=https://your-backend`. The browser remembers it.

The backend sends CORS headers, so any origin can call it by default. Set `CORS_ORIGIN` to the frontend's origin to lock that down. An `https://` frontend can only talk to an `https://` backend, because browsers block http calls from https pages.

## Deploy to Render

`render.yaml` defines one web service with a 1 GB disk for `data/watches.json` and runs the schedule inside the process. Create a Blueprint from the repo on Render, then set `GEMINI_API_KEY`, `SERPAPI_KEY`, `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in the dashboard.

## Code map

- `src/server.js` serves the API and the static page, and runs the schedule.
- `src/sources.js` handles geocoding, the forecast and places.
- `src/decide.js` holds the Gemma prompt, the reply parser and the rule-based fallback.
- `src/check.js` runs one check end to end and sends the Telegram alert.
- `src/send.js` builds the itinerary and posts it to `ITINERARY_API_URL`.
- `src/store.js` keeps watches in a JSON file under `DATA_DIR`.
- `public/` is the vanilla HTML, CSS and JS frontend.
