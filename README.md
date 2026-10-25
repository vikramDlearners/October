# Sloth Trip Watcher 🦥

Tell the sloth where you are and how much time you have. It checks the weather, the places nearby and the local news, then gives you one plan for the weekend. The plan says where to go, when, how to get there and what to pack.

Built for the Hacktoberfest Open-Source AI Challenge, Week 3 ("Slow and Steady").

- **Frontend repo (this repo):** https://github.com/vikramDlearners/October
- **Backend repo (planner API, FastAPI + Gemma):** https://github.com/vikramDlearners/October_backend
- **Live frontend:** https://vikramdlearners.github.io/October/

## What you get

You can ask in two ways.

- **Plan my weekend.** Type a city or area, pick how much time you have (3 hours, half day, full day or whole weekend), and press **Find my trip**. A plan arrives in about half a minute. A sloth card with a seconds counter shows while you wait.
- **Or just chat.** The sloth asks where you are, then how long you have, and answers with the same plan.

Each plan becomes a trip card. The card opens with a **GO** verdict that gives the day, the time window and the reason for the pick. Seven tabs follow:

| Tab | What it shows |
| --- | --- |
| Plan | A timeline of stops, plus backup places under "If plans change". |
| How to go | Travel options chosen by distance (walk or auto, metro or bus, cab or bus, train). Each has a rough time, a fare in ₹ and a Google Maps directions link. These are estimates from straight-line distance, and the tab says so. |
| Things to carry | A tick-off checklist. Water, wallet, ID and phone are always on it. The planner adds its own items, and an umbrella is added when rain is likely. You can add your own items. Ticks are saved per trip. |
| Weather | The forecast strip with the chosen day highlighted, and its sunrise and sunset. |
| Nearby | Places with their kind, distance and description, and links to the map and Wikipedia. |
| News | What the news means for the trip, then the article links. |
| Send | Email the plan from your own mail app, copy it, or use your device's share sheet. |

The page also has these features:

- **Light and dark themes.** The ☀️ / 🌙 button in the header switches between them. Your choice is saved in the browser. Until you pick one, the page follows your system setting.
- **History.** Your last 5 trips, your location, your email and the tab you had open are kept in this browser's localStorage. Nothing about you is stored on a server.
- **Status pills.** The header shows "Planner online" with its version, or "Planner offline".
- **Mobile layout.** The page works at phone width (375px) without scrolling sideways.

## How it works

```
Browser ──▶ Node server (this repo) ──▶ Trip planner API (FastAPI)
            /api/trip/*  proxy           /status, /weekend/recommend, /weekend/chat
```

The page talks only to the Node server in this repo. The server forwards `/api/trip/*` to the trip planner API at `TRIP_API_URL`. That design does three things:

- The planner's address never appears in the page, its source, or the browser's network log.
- The planner sends no CORS headers, and the proxy adds them, so the browser can call it.
- The planner speaks plain `http`, which an `https` page such as GitHub Pages cannot call directly. The proxy runs on `https`.

The planner itself, a FastAPI service using Gemma with Open-Meteo, SerpApi and news search, lives in [October_backend](https://github.com/vikramDlearners/October_backend).

### API

All of these go through the proxy. Errors come back as `{"detail": "..."}`, or as `{"detail": [{"msg": "..."}]}` for validation errors. The page shows the message.

| Method and path | Body | Returns |
| --- | --- | --- |
| `GET /api/trip/status` | none | `{status, app, version, environment, uptime_seconds, timestamp}` |
| `POST /api/trip/weekend/recommend` | `{"location": "Chennai", "duration": "full day"}`. location is 2 to 200 characters, duration is 1 to 100. | A plan with `location`, `duration`, `hours`, `radius_km`, `weather[]`, `places[]`, `news[]`, `recommendation` and `summary`. It takes about 10 to 30 seconds. |
| `POST /api/trip/weekend/chat` | `{"session_id": "...", "message": "..."}`. Both are optional and the message is at most 300 characters. Send `{}` to start a chat. | `{session_id, stage, reply, plan}`. `stage` goes from `location` to `duration` to `done`. `plan` is set once the stage is `done`. |

`recommendation` holds `place`, `day`, `when`, `why`, `plan[]` (the timed stops), `bring[]`, `news_notes`, `backups[]` and `decided_by`.

The proxy only forwards `/status` and `/weekend/*`. Any other path under `/api/trip` returns 404. When the planner can't be reached, the proxy answers `502` with a friendly message. It waits up to 150 seconds for a reply.

Try it from a terminal:

```bash
curl -X POST http://localhost:3000/api/trip/weekend/recommend -H "content-type: application/json" -d '{"location":"Chennai","duration":"half day"}'
```

## Run locally

You need Node 22.9 or newer. There are no dependencies to install.

```bash
cp .env.example .env
npm run dev
```

Open http://localhost:3000. The server serves the page and the proxy from the same origin. `npm run dev` restarts the server when files in `src/` change. After you pull new server code, restart it if it was started before the pull.

`public/` is a static site with no build step. `public/config.js` decides where the page sends API calls:

| Page served from | API calls go to |
| --- | --- |
| The Node server (`localhost:3000`, Render) | The same origin |
| A static dev server on port 5173 | `http://<same host>:3000`, which must be running |
| `*.github.io` | `https://sloth-trip-watcher.onrender.com` |

### Environment

| Variable | Purpose |
| --- | --- |
| `TRIP_API_URL` | Where the proxy forwards `/api/trip/*`. This is the planner's address, and it stays on the server. |
| `CORS_ORIGIN` | The origin allowed to call the server from a separately hosted page, for example `https://vikramdlearners.github.io`. The default is `*`. |
| `PORT` | The port to listen on. The default is 3000. |

`.env.example` also lists keys for the older watch feature (`GEMINI_API_KEY`, `SERPAPI_KEY`, `TELEGRAM_*`, `ITINERARY_API_*`, `CHECK_EVERY_HOURS`). Each is optional, and the trip planner doesn't need any of them.

## Deploy

There are two parts. GitHub Pages hosts the page and Render hosts the Node proxy.

### Frontend on GitHub Pages

`.github/workflows/pages.yml` publishes `public/` to GitHub Pages on every push to `main` that touches `public/`. You can also start it by hand from the Actions tab. The repo's Pages source is set to **GitHub Actions**.

### Proxy on Render

`render.yaml` is a Render Blueprint for one web service named `sloth-trip-watcher`.

1. On https://dashboard.render.com, choose **New → Blueprint** and pick this repo.
2. Accept the service. `TRIP_API_URL` and `CORS_ORIGIN` are already filled in. The keys marked `sync: false` belong to the older watch feature and can stay empty.
3. Once it's live, open `https://sloth-trip-watcher.onrender.com/api/trip/status` and check for `"status":"ok"`.

If Render gives the service a different URL, put that URL in `public/config.js` and push. The Pages workflow redeploys the page.

A free Render service sleeps when idle. The first request after a sleep can take about a minute more, and the proxy waits long enough for it.

## Code map

- `src/server.js` runs the HTTP server. It serves `public/`, proxies `/api/trip/*` to the planner, and still hosts the older watch API (`/api/health`, `/api/watches*`).
- `public/index.html` holds the page layout and the head script that applies the saved theme before the first paint.
- `public/app.js` holds all of the page logic. It covers the form, the chat, the trip cards and tabs, the travel estimates, the checklist, sending, history and the theme toggle.
- `public/config.js` sets `API_ORIGIN`, the address of the proxy for each place the page is hosted.
- `public/styles.css` holds the styles. The colours are CSS variables, with a dark set used by `data-theme="dark"` or by the system setting.
- `render.yaml` is the Render Blueprint.
- `.github/workflows/pages.yml` is the GitHub Pages deploy.
- `src/sources.js`, `src/decide.js`, `src/check.js`, `src/check-all.js`, `src/send.js` and `src/store.js` belong to the older watch feature. That feature checks saved watches on a schedule, asks Gemma for a GO or NOT YET, and alerts on Telegram. The current page doesn't use it.

## Known issues

- **Place names can resolve to the wrong country.** Some names that exist in more than one country resolve abroad. "Bangalore", for example, resolves to a town in Pakistan. Adding a state, as in "Bengaluru, Karnataka", avoids this. The fix belongs in the planner's geocoder, by limiting the lookup to India.
- **Travel times and fares are estimates.** The page computes them from straight-line distance, because the planner doesn't return routes yet.
- **Send uses `mailto:`.** It opens your own mail app instead of sending from a server.
