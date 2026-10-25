import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { listWatches, getWatch, addWatch, deleteWatch } from './store.js';
import { geocode, serpapiEnabled } from './sources.js';
import { gemmaEnabled, GEMMA_MODEL } from './decide.js';
import { runCheck, checkAll, telegramEnabled } from './check.js';
import { itineraryApiEnabled, sendItinerary } from './send.js';

const PORT = Number(process.env.PORT) || 3000;
const CHECK_EVERY_HOURS = Number(process.env.CHECK_EVERY_HOURS) || 12;
const PUBLIC_DIR = join(process.cwd(), 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Lets a frontend hosted on another origin call the API. Set CORS_ORIGIN to that origin to lock it down.
const CORS = {
  'access-control-allow-origin': process.env.CORS_ORIGIN || '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try {
    return JSON.parse(raw || '{}');
  } catch {
    throw new HttpError(400, 'Body must be JSON.');
  }
}

async function parseWatch(body) {
  const destination = String(body.destination ?? '').trim();
  const origin = String(body.origin ?? '').trim();
  const budgetInr = Number(body.budgetInr);
  if (!destination || !origin) throw new HttpError(400, 'Destination and origin are required.');
  if (!DATE.test(body.from) || !DATE.test(body.to) || body.from > body.to) {
    throw new HttpError(400, 'Dates must be YYYY-MM-DD with "from" on or before "to".');
  }
  if (!(budgetInr > 0)) throw new HttpError(400, 'Budget must be a positive number.');
  const place = await geocode(destination);
  if (!place) throw new HttpError(400, `Couldn't find "${destination}" on the map.`);
  return {
    place,
    origin,
    from: body.from,
    to: body.to,
    budgetInr,
    weekendsOnly: Boolean(body.weekendsOnly),
    noRain: body.noRain !== false,
    vibe: String(body.vibe ?? '').trim(),
  };
}

const routes = {
  'GET /api/health': async () => ({
    gemma: gemmaEnabled() ? GEMMA_MODEL : null,
    serpapi: serpapiEnabled(),
    telegram: telegramEnabled(),
    itineraryApi: itineraryApiEnabled(),
    checkEveryHours: CHECK_EVERY_HOURS,
  }),
  'GET /api/watches': () => listWatches(),
  'POST /api/watches': async (req) => addWatch(await parseWatch(await readBody(req))),
  'DELETE /api/watches/:id': async (req, id) => {
    if (!(await deleteWatch(id))) throw new HttpError(404, 'No such watch.');
    return { ok: true };
  },
  'POST /api/watches/:id/check': async (req, id) => {
    const watch = await getWatch(id);
    if (!watch) throw new HttpError(404, 'No such watch.');
    return runCheck(watch);
  },
  'POST /api/watches/:id/send': async (req, id) => {
    const watch = await getWatch(id);
    if (!watch) throw new HttpError(404, 'No such watch.');
    const email = String((await readBody(req)).email ?? '').trim();
    if (!EMAIL.test(email)) throw new HttpError(400, 'Enter a valid email address.');
    if (watch.lastCheck?.verdict !== 'GO') throw new HttpError(409, 'There is no GO plan to send yet.');
    if (!itineraryApiEnabled()) throw new HttpError(503, 'Sending is off. Set ITINERARY_API_URL on the server.');
    return sendItinerary(watch, email);
  },
};

function matchRoute(method, pathname) {
  const parts = pathname.split('/');
  for (const [key, handler] of Object.entries(routes)) {
    const [m, pattern] = key.split(' ');
    const pp = pattern.split('/');
    if (m !== method || pp.length !== parts.length) continue;
    const params = [];
    if (pp.every((p, i) => (p.startsWith(':') ? params.push(decodeURIComponent(parts[i])) : p === parts[i]))) {
      return (req) => handler(req, ...params);
    }
  }
  return null;
}

async function serveStatic(pathname, res) {
  const file = normalize(join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC_DIR)) return false;
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

function send(res, status, data) {
  res.writeHead(status, { ...CORS, 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }
  try {
    const handler = matchRoute(req.method, pathname);
    if (handler) return send(res, 200, await handler(req));
    if (req.method === 'GET' && (await serveStatic(pathname, res))) return;
    send(res, 404, { error: 'Not found.' });
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    send(res, err.status ?? 502, { error: err.message });
  }
}).listen(PORT, () => {
  console.log(`Sloth Trip Watcher on http://localhost:${PORT}`);
  console.log(`gemma: ${gemmaEnabled() ? GEMMA_MODEL : 'off'}, serpapi: ${serpapiEnabled() ? 'on' : 'off'}, telegram: ${telegramEnabled() ? 'on' : 'off'}, itinerary api: ${itineraryApiEnabled() ? 'on' : 'off'}`);
});

setInterval(checkAll, CHECK_EVERY_HOURS * 3600 * 1000);
