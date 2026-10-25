import { API_ORIGIN } from './config.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const rupees = (n) => `₹${Math.round(n / 10) * 10}`;

const WEATHER_ICON = [
  [/thunder|storm/i, '⛈️'], [/heavy rain|downpour/i, '🌧️'], [/shower|drizzle|rain/i, '🌦️'],
  [/snow/i, '🌨️'], [/fog|mist|haze/i, '🌫️'], [/overcast|cloud/i, '⛅'], [/clear|sun/i, '☀️'],
];
const icon = (summary) => WEATHER_ICON.find(([re]) => re.test(summary))?.[1] ?? '🌡️';

const duration = (min) => {
  const h = Math.floor(min / 60);
  const m = Math.round((min % 60) / 5) * 5;
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${Math.max(m, 5)}m`;
};

const niceDate = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

// Per-browser conveniences only: storage can be blocked, so every access is guarded.
const store = {
  get(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(`${API_ORIGIN}/api/trip${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Can't reach the trip planner. Check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = Array.isArray(data.detail) ? data.detail.map((d) => d.msg).join('. ') : data.detail;
    throw new Error(data.error ?? detail ?? `The trip planner had a problem (${res.status}). Try again.`);
  }
  return data;
}

async function renderStatus() {
  const pill = (on, text) => `<span class="pill ${on ? 'on' : 'off'}">${esc(text)}</span>`;
  try {
    const s = await api('GET', '/status');
    $('#status').innerHTML = pill(s.status === 'ok', 'Planner online') + pill(false, `v${s.version}`);
  } catch {
    $('#status').innerHTML = pill(false, 'Planner offline');
  }
}

// A trip is the planner's reply as-is, plus when we got it.
const tripKey = (t) => `${t.location.name}|${t.recommendation.day}|${t.recommendation.place.name}`;
const TRIPS_KEY = 'sloth.trips';
const activeTab = new Map();

function saveTrip(trip) {
  const trips = store.get(TRIPS_KEY, []).filter((t) => tripKey(t) !== tripKey(trip));
  store.set(TRIPS_KEY, [trip, ...trips].slice(0, 5));
}

function forgetTrip(trip) {
  store.set(TRIPS_KEY, store.get(TRIPS_KEY, []).filter((t) => tripKey(t) !== tripKey(trip)));
}

function renderPlan(trip) {
  const r = trip.recommendation;
  const stops = r.plan
    .map((line) => {
      const [, time, text] = /^(\d{1,2}:\d{2})\s*[-–:]\s*(.*)$/.exec(line) ?? [, '', line];
      return `<li><span class="time">${esc(time)}</span><span class="pin"></span><div>${esc(text)}</div><span></span></li>`;
    })
    .join('');
  const backups = r.backups.length
    ? `<h4>If plans change</h4><ul class="backups">${r.backups
        .map((b) => `<li><strong>${esc(b.name)}</strong><span class="note">${esc(b.why)}</span></li>`)
        .join('')}</ul>`
    : '';
  return `<ol class="stops">${stops}</ol>${backups}`;
}

// The planner doesn't return routes yet, so these are rough options from straight-line distance.
const TRAVEL = [
  { max: 3, modes: [['Walk', '🚶', 4.5, 0, 0, 'walking'], ['Auto', '🛺', 18, 30, 15, 'driving']] },
  { max: 20, modes: [['Auto or cab', '🚕', 22, 50, 18, 'driving'], ['Metro or bus', '🚌', 18, 10, 2.5, 'transit']] },
  { max: 120, modes: [['Cab or own car', '🚗', 40, 100, 14, 'driving'], ['Bus', '🚌', 32, 20, 1.5, 'transit']] },
  { max: Infinity, modes: [['Train', '🚆', 55, 50, 1, 'transit'], ['Bus', '🚌', 45, 50, 1.6, 'transit'], ['Car', '🚗', 50, 0, 9, 'driving']] },
];

function renderRoutes(trip) {
  const { place } = trip.recommendation;
  const road = place.distance_km * 1.3;
  const { modes } = TRAVEL.find((t) => place.distance_km <= t.max);
  const dirs = (mode) =>
    `https://www.google.com/maps/dir/?api=1&origin=${trip.location.lat},${trip.location.lon}&destination=${place.lat},${place.lon}&travelmode=${mode}`;
  const routes = modes
    .map(([mode, emoji, kmh, base, perKm, travelmode], i) => {
      const cost = base + perKm * road;
      return `<div class="route ${i === 0 ? 'best' : ''}">
        <span class="mode-icon">${emoji}</span>
        <div>
          <span class="mode">${esc(mode)}</span>${i === 0 ? '<span class="best-tag">BEST</span>' : ''}
          <a class="note" href="${esc(dirs(travelmode))}" target="_blank" rel="noopener">Open in Google Maps ↗</a>
        </div>
        <div class="facts"><strong>~${duration((road / kmh) * 60)}</strong>${cost ? `~${rupees(cost)}` : 'Free'}</div>
      </div>`;
    })
    .join('');
  return `
    <p class="send-note">About ${Math.round(road)} km by road from ${esc(trip.location.name)} to ${esc(place.name)}. Times and fares are rough estimates.</p>
    <div class="routes">${routes}</div>
    <a class="directions" href="${esc(dirs(modes[0][5]))}" target="_blank" rel="noopener">🗺️ Directions from ${esc(trip.location.name)}</a>`;
}

const ESSENTIALS = [
  { item: 'Water bottle', why: 'Stay hydrated on the way and at the spot', re: /water/i },
  { item: 'Wallet with some cash', why: 'Small shops, autos and entry tickets', re: /wallet|cash|money/i },
  { item: 'ID card', why: 'Entry gates, check-ins and emergencies', re: /\bid\b|identity|aadhaar/i },
  { item: 'Phone and power bank', why: 'Maps, tickets and photos all day', re: /phone|power ?bank|charger/i },
];

function packingList(trip) {
  const r = trip.recommendation;
  const day = trip.weather.find((d) => d.date === r.day);
  const extra = r.bring.filter((b) => !ESSENTIALS.some((e) => e.re.test(b))).map((item) => ({ item, why: 'For this place' }));
  if (day?.rain_chance >= 40 && !r.bring.some((b) => /umbrella|rain/i.test(b))) {
    extra.push({ item: 'Umbrella', why: `${day.rain_chance}% chance of rain` });
  }
  return [...ESSENTIALS, ...extra];
}

// The checklist lives in this browser, keyed by trip, so a new plan starts fresh.
function packingPanel(trip, onChange) {
  const key = `sloth.pack.${tripKey(trip)}`;
  const state = store.get(key, { done: [], custom: [] });
  const items = [...packingList(trip), ...state.custom.map((item) => ({ item, why: 'Added by you', custom: true }))];
  const el = document.createElement('div');
  const draw = () => {
    const done = items.filter((p) => state.done.includes(p.item)).length;
    el.innerHTML = `
      <div class="pack-head">
        <span>${done} of ${items.length} packed</span>
        <div class="progress"><span style="width:${items.length ? (done / items.length) * 100 : 0}%"></span></div>
      </div>
      <ul class="packing">${items
        .map(
          (p, i) => `<li><label>
            <input type="checkbox" data-i="${i}" ${state.done.includes(p.item) ? 'checked' : ''}>
            <span>${esc(p.item)}${p.why ? `<span class="why">${esc(p.why)}</span>` : ''}</span>
            ${p.custom ? `<button type="button" class="remove" data-i="${i}" aria-label="Remove ${esc(p.item)}">✕</button>` : '<span></span>'}
          </label></li>`,
        )
        .join('')}</ul>
      <form class="add-item">
        <input name="item" placeholder="Add something to carry…" aria-label="Add something to carry" maxlength="60">
        <button type="submit">Add</button>
      </form>
      ${items.length && done === items.length ? '<p class="all-packed">🎒 All packed. Time to go!</p>' : ''}`;
    onChange(done, items.length);
  };
  const save = () => {
    store.set(key, state);
    draw();
  };
  el.addEventListener('change', (e) => {
    const p = items[e.target.dataset.i];
    if (!p) return;
    state.done = e.target.checked ? [...state.done, p.item] : state.done.filter((x) => x !== p.item);
    save();
  });
  el.addEventListener('click', (e) => {
    if (!e.target.matches('.remove')) return;
    e.preventDefault();
    const [p] = items.splice(e.target.dataset.i, 1);
    state.custom = state.custom.filter((x) => x !== p.item);
    state.done = state.done.filter((x) => x !== p.item);
    save();
  });
  el.addEventListener('submit', (e) => {
    e.preventDefault();
    const item = e.target.item.value.trim();
    if (!item || items.some((p) => p.item.toLowerCase() === item.toLowerCase())) return;
    items.push({ item, why: 'Added by you', custom: true });
    state.custom.push(item);
    save();
    $('.add-item input', el).focus();
  });
  draw();
  return el;
}

function renderWeather(trip) {
  const days = trip.weather
    .map(
      (d) => `<div class="day ${d.date === trip.recommendation.day ? 'picked' : ''}" title="${esc(d.summary)}">
        <span class="dname">${esc(d.weekday.slice(0, 3))}</span>
        <span>${esc(d.date.slice(8))}/${esc(d.date.slice(5, 7))}</span>
        <span class="wx">${icon(d.summary)}</span>
        <span>${Math.round(d.max_c)}° / ${Math.round(d.min_c)}°</span>
        <span class="rain">💧${d.rain_chance}%</span>
      </div>`,
    )
    .join('');
  const day = trip.weather.find((d) => d.date === trip.recommendation.day);
  return `<div class="days">${days}</div>
    ${day ? `<p class="send-note">${esc(niceDate(day.date))}: ${esc(day.summary)}. Sunrise ${esc(day.sunrise?.slice(-5))}, sunset ${esc(day.sunset?.slice(-5))}.</p>` : ''}`;
}

// Searching by name and town opens Google's place panel, which carries the rating and reviews; a lat,lon search only drops a pin.
const reviewsUrl = (place, trip) => {
  const town = trip.location.name.split(',')[0].trim();
  const query = place.name.toLowerCase().includes(town.toLowerCase()) ? place.name : `${place.name}, ${town}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
};

function renderNearby(trip) {
  const pick = trip.recommendation.place.name;
  return `<ul class="places">${trip.places
    .map(
      (p) => `<li class="${p.name === pick ? 'picked' : ''}">
        <div class="place-top">
          <strong>${esc(p.name)}</strong>
          <span class="chip">${esc(p.kind)} · ${p.distance_km.toFixed(1)} km</span>
        </div>
        ${p.description ? `<p class="note">${esc(p.description)}</p>` : ''}
        <div class="links">
          <a href="${esc(reviewsUrl(p, trip))}" target="_blank" rel="noopener">⭐ Ratings and reviews ↗</a>
          <a href="https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}" target="_blank" rel="noopener">Map ↗</a>
          ${p.wikipedia_url ? `<a href="${esc(p.wikipedia_url)}" target="_blank" rel="noopener">Wikipedia ↗</a>` : ''}
        </div>
      </li>`,
    )
    .join('')}</ul>`;
}

function renderNews(trip) {
  const notes = trip.recommendation.news_notes.map((n) => `<li>${esc(n)}</li>`).join('');
  const news = trip.news
    .map(
      (n) => `<li><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a>
        <span class="note">${esc(n.source)} · ${esc(new Date(n.published).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }))}</span></li>`,
    )
    .join('');
  return `${notes ? `<h4>What the news means for this trip</h4><ul class="news-notes">${notes}</ul>` : ''}
    ${news ? `<ul class="news">${news}</ul>` : '<p class="empty">No local news worth knowing about.</p>'}`;
}

function itineraryText(trip) {
  const r = trip.recommendation;
  return [
    `🦥 ${r.place.name}, ${niceDate(r.day)} (${r.when})`,
    r.why,
    '',
    ...r.plan.map((p) => `• ${p}`),
    '',
    `Carry: ${packingList(trip).map((p) => p.item).join(', ')}`,
    `Map: ${r.place.maps_url}`,
    `Ratings and reviews: ${reviewsUrl(r.place, trip)}`,
    ...(r.backups.length ? ['', `Backups: ${r.backups.map((b) => b.name).join(', ')}`] : []),
  ].join('\n');
}

function sendPanel(trip) {
  const el = document.createElement('div');
  const subject = `🦥 Trip: ${trip.recommendation.place.name} on ${niceDate(trip.recommendation.day)}`;
  el.innerHTML = `
    <p class="send-note">Email the plan to yourself or a friend, or copy it into any chat.</p>
    <form class="send-form">
      <input name="email" type="email" placeholder="you@example.com" required aria-label="Email address">
      <button type="submit">✉️ Email</button>
    </form>
    <div class="share-row">
      <button type="button" class="ghost copy">📋 Copy plan</button>
      ${navigator.share ? '<button type="button" class="ghost share">📤 Share</button>' : ''}
    </div>
    <p class="msg" role="status"></p>`;
  const form = $('form', el);
  const msg = $('.msg', el);
  form.email.value = store.get('sloth.email', '');
  form.onsubmit = (e) => {
    e.preventDefault();
    store.set('sloth.email', form.email.value);
    location.href = `mailto:${encodeURIComponent(form.email.value)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(itineraryText(trip))}`;
  };
  $('.copy', el).onclick = async () => {
    try {
      await navigator.clipboard.writeText(itineraryText(trip));
      msg.className = 'msg ok';
      msg.textContent = 'Copied. Paste it anywhere.';
    } catch {
      msg.className = 'msg error';
      msg.textContent = "Couldn't copy. Your browser blocked the clipboard.";
    }
  };
  const share = $('.share', el);
  if (share) share.onclick = () => navigator.share({ title: subject, text: itineraryText(trip) }).catch(() => {});
  return el;
}

const TABS = [
  ['plan', '🗓️ Plan', renderPlan],
  ['go', '🧭 How to go', renderRoutes],
  ['pack', '🎒 Things to carry', null],
  ['weather', '🌦️ Weather', renderWeather],
  ['nearby', '📍 Nearby', renderNearby],
  ['news', '📰 News', renderNews],
  ['send', '✉️ Send', null],
];

function renderTabs(trip) {
  const id = tripKey(trip);
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="tabs" role="tablist">${TABS.map(
    ([tab, label]) => `<button type="button" class="tab" role="tab" data-tab="${tab}">${label}${tab === 'pack' ? '<span class="count"></span>' : ''}</button>`,
  ).join('')}</div>`;
  const panels = {};
  for (const [tab, , render] of TABS) {
    panels[tab] =
      tab === 'pack'
        ? packingPanel(trip, (done, total) => {
            $('.count', wrap).textContent = `${done}/${total}`;
          })
        : tab === 'send'
          ? sendPanel(trip)
          : Object.assign(document.createElement('div'), { innerHTML: render(trip) });
    panels[tab].className = 'panel';
    panels[tab].setAttribute('role', 'tabpanel');
    wrap.append(panels[tab]);
  }
  const select = (tab) => {
    activeTab.set(id, tab);
    for (const t of wrap.querySelectorAll('.tab')) t.setAttribute('aria-selected', t.dataset.tab === tab);
    for (const [pid, panel] of Object.entries(panels)) panel.hidden = pid !== tab;
  };
  $('.tabs', wrap).onclick = (e) => e.target.closest('.tab') && select(e.target.closest('.tab').dataset.tab);
  select(activeTab.get(id) ?? 'plan');
  return wrap;
}

function renderTrip(trip) {
  const r = trip.recommendation;
  const el = document.createElement('article');
  el.className = 'card trip';
  el.innerHTML = `
    <div class="watch-head">
      <div>
        <h3>${esc(r.place.name)}</h3>
        <div class="chips">
          <span class="chip">📍 ${esc(r.place.distance_km.toFixed(1))} km from ${esc(trip.location.name)}</span>
          <span class="chip">⏱️ ${esc(trip.duration)}</span>
          <span class="chip">🏷️ ${esc(r.place.kind)}</span>
          <a class="chip" href="${esc(reviewsUrl(r.place, trip))}" target="_blank" rel="noopener">⭐ Ratings and reviews ↗</a>
        </div>
      </div>
      <div class="actions"><button class="delete ghost" title="Remove this trip" aria-label="Remove this trip">✕</button></div>
    </div>
    <div class="verdict go">
      <span class="big">🎒</span>
      <span class="badge">GO · ${esc(niceDate(r.day))} · ${esc(r.when)}</span>
      <p>${esc(r.why)}</p>
    </div>`;
  el.append(renderTabs(trip));
  el.insertAdjacentHTML(
    'beforeend',
    `<p class="footnote">Planned ${esc(new Date(trip.savedAt).toLocaleString('en-IN'))} · searched ${esc(trip.radius_km)} km around ${esc(trip.location.name)} · decided by ${esc(r.decided_by)}</p>`,
  );
  $('.delete', el).onclick = () => {
    forgetTrip(trip);
    el.remove();
    if (!$('#trips').children.length) renderTrips();
  };
  return el;
}

function renderTrips() {
  const trips = store.get(TRIPS_KEY, []);
  $('#trips').replaceChildren(...trips.map(renderTrip));
  if (!trips.length) $('#trips').innerHTML = '<p class="empty card">No trips yet. Tell the sloth where you are. 🦥</p>';
}

function addTrip(reply) {
  const trip = { ...reply, savedAt: new Date().toISOString() };
  saveTrip(trip);
  $('.empty', $('#trips'))?.remove();
  const el = renderTrip(trip);
  $('#trips').prepend(el);
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// The planner takes about half a minute, so the wait gets a visible, ticking placeholder.
function showThinking(where) {
  const el = document.createElement('div');
  el.className = 'card thinking';
  el.innerHTML = `<span class="sloth">🦥</span><div><strong>Checking ${esc(where)}…</strong>
    <span class="note">Weather, nearby places and local news, then picking the best spot. <span class="secs">0s</span></span></div>`;
  $('.empty', $('#trips'))?.remove();
  $('#trips').prepend(el);
  const started = Date.now();
  const timer = setInterval(() => {
    $('.secs', el).textContent = `${Math.round((Date.now() - started) / 1000)}s`;
  }, 1000);
  return () => {
    clearInterval(timer);
    el.remove();
    if (!$('#trips').children.length) renderTrips();
  };
}

$('#trip-form').onsubmit = async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const { location: where, duration: time } = Object.fromEntries(new FormData(form));
  const btn = $('button[type=submit]', form);
  const errorEl = $('#form-error');
  errorEl.hidden = true;
  btn.disabled = true;
  btn.textContent = 'Asking the sloth…';
  store.set('sloth.location', where);
  const done = showThinking(where);
  try {
    const reply = await api('POST', '/weekend/recommend', { location: where.trim(), duration: time });
    done();
    addTrip(reply);
  } catch (err) {
    done();
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Find my trip';
  }
};

const GREETING = "What should you do this weekend? Let's find out. Where are you? (a city or area)";
let chatSession = null;

function say(who, text) {
  const li = document.createElement('li');
  li.className = `bubble ${who}`;
  li.textContent = text;
  $('#chat-log').append(li);
  li.scrollIntoView({ block: 'nearest' });
  return li;
}

$('#chat-form').onsubmit = async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const message = form.message.value.trim();
  if (!message) return;
  form.message.value = '';
  say('me', message);
  const typing = say('bot typing', '…');
  form.message.disabled = true;
  $('button', form).disabled = true;
  try {
    // The planner greets before it listens, so a new conversation opens with an empty turn.
    chatSession ??= (await api('POST', '/weekend/chat', {})).session_id;
    const reply = await api('POST', '/weekend/chat', { session_id: chatSession, message });
    typing.remove();
    if (reply.stage === 'done' && reply.plan) {
      say('bot', `Done. Your plan for ${reply.plan.recommendation.place.name} is under Your trips. Want another? Tell me where you are.`);
      addTrip(reply.plan);
      chatSession = null;
    } else {
      chatSession = reply.session_id;
      say('bot', reply.reply);
    }
  } catch (err) {
    typing.remove();
    say('bot error', err.message);
  } finally {
    form.message.disabled = false;
    $('button', form).disabled = false;
    form.message.focus({ preventScroll: true });
  }
};

// The head script applies a saved theme before paint; with none saved, the system setting decides.
const systemDark = matchMedia('(prefers-color-scheme: dark)');
const currentTheme = () => document.documentElement.dataset.theme ?? (systemDark.matches ? 'dark' : 'light');
const themeToggle = $('#theme-toggle');
const paintToggle = () => {
  const dark = currentTheme() === 'dark';
  themeToggle.textContent = dark ? '☀️' : '🌙';
  themeToggle.title = themeToggle.ariaLabel = dark ? 'Switch to light theme' : 'Switch to dark theme';
};
themeToggle.onclick = () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  store.set('sloth.theme', next);
  paintToggle();
};
systemDark.addEventListener('change', paintToggle);
paintToggle();

$('#trip-form').location.value = store.get('sloth.location', '');
say('bot', GREETING);
renderTrips();
renderStatus();
