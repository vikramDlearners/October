const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const rupees = (n) => (n == null || n === '' ? '' : `₹${Number(n).toLocaleString('en-IN')}`);

const WEATHER_ICON = [
  [0, '☀️'], [3, '⛅'], [48, '🌫️'], [67, '🌧️'], [77, '🌨️'], [82, '🌦️'], [99, '⛈️'],
];
const icon = (code) => WEATHER_ICON.find(([max]) => code <= max)?.[1] ?? '🌡️';

const MODE_ICON = [
  [/train|rail|metro/i, '🚆'], [/bus/i, '🚌'], [/cab|taxi|uber|ola/i, '🚕'], [/bike|scooter|two/i, '🏍️'],
  [/flight|air/i, '✈️'], [/ferry|boat/i, '⛴️'], [/car|drive|road/i, '🚗'],
];
const modeIcon = (mode) => MODE_ICON.find(([re]) => re.test(mode))?.[1] ?? '🧭';

const duration = (min) => {
  if (!min) return '';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
};

const mapsUrl = (w) =>
  `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(w.origin)}&destination=${w.place.lat},${w.place.lon}`;

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

// Blank means "the server that served this page". A URL points the page at a backend elsewhere.
const BASE_KEY = 'sloth.apiBase';
let apiBase = '';
let health = {};
const activeTab = new Map();

function savedBase() {
  const fromQuery = new URLSearchParams(location.search).get('api');
  if (fromQuery != null) return fromQuery;
  try {
    return localStorage.getItem(BASE_KEY) ?? '';
  } catch {
    return '';
  }
}

function normalizeBase(input) {
  const s = input.trim().replace(/\/+$/, '');
  return !s || /^https?:\/\//i.test(s) ? s : `http://${s}`;
}

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(apiBase + path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    const where = apiBase || location.origin;
    const mixed = location.protocol === 'https:' && apiBase.startsWith('http:');
    throw new Error(
      mixed
        ? `This page is on HTTPS, so the browser blocks the http:// backend ${where}. Use an https:// URL.`
        : `Can't reach the backend at ${where}. Check the URL, that it's running, and that it allows CORS.`,
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

function renderStatus(h) {
  const pill = (on, label, off) => `<span class="pill ${on ? 'on' : 'off'}">${esc(on ? label : off)}</span>`;
  $('#status').innerHTML =
    pill(h.gemma, `Gemma · ${h.gemma}`, 'Gemma off (rules)') +
    pill(h.serpapi, 'Places', 'Places off') +
    pill(h.telegram, 'Telegram', 'Telegram off') +
    pill(h.itineraryApi, 'Email API', 'Email API off') +
    `<span class="pill">Every ${h.checkEveryHours}h</span>`;
}

function renderPlan(w, plan) {
  const stops = plan.stops
    .map(
      (s) => `<li>
        <span class="time">${esc(s.time)}</span>
        <span class="pin"></span>
        <div><strong>${esc(s.name)}</strong><span class="note">${esc(s.note)}</span></div>
        <span class="cost">${rupees(s.costInr)}</span>
      </li>`,
    )
    .join('');
  const pct = plan.totalInr ? Math.min(100, Math.round((plan.totalInr / w.budgetInr) * 100)) : 0;
  return `
    <p class="summary">${esc(plan.summary)}</p>
    <ol class="stops">${stops}</ol>
    ${
      plan.totalInr
        ? `<div class="total"><div style="flex:1">
            <div>Total ≈ <strong>${rupees(plan.totalInr)}</strong> of ${rupees(w.budgetInr)}</div>
            <div class="budget-bar"><span style="width:${pct}%"></span></div>
          </div></div>`
        : ''
    }`;
}

function renderRoutes(w, plan) {
  const routes = (plan.howToGo ?? [])
    .map(
      (r, i) => `<div class="route ${i === 0 ? 'best' : ''}">
        <span class="mode-icon">${modeIcon(r.mode)}</span>
        <div>
          <span class="mode">${esc(r.mode)}</span>${i === 0 ? '<span class="best-tag">BEST</span>' : ''}
          <span class="note">${esc(r.route)}</span>
          ${r.tip ? `<span class="tip">💡 ${esc(r.tip)}</span>` : ''}
        </div>
        <div class="facts">
          <strong>${duration(r.durationMin)}</strong>
          ${rupees(r.costInr)}${r.costInr ? ' pp' : ''}
        </div>
      </div>`,
    )
    .join('');
  return `
    <div class="routes">${routes}</div>
    <a class="directions" href="${esc(mapsUrl(w))}" target="_blank" rel="noopener">🗺️ Directions from ${esc(w.origin)}</a>`;
}

// The checklist lives in this browser, keyed by watch and trip date, so a new GO date starts fresh.
function packingPanel(w, plan, onChange) {
  const key = `sloth.pack.${w.id}.${plan.date}`;
  const state = store.get(key, { done: [], custom: [] });
  const items = [...plan.packing, ...state.custom.map((item) => ({ item, why: 'Added by you', custom: true }))];
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

function sendPanel(w) {
  const el = document.createElement('div');
  el.innerHTML = `
    <p class="send-note">${
      health.itineraryApi
        ? 'Sends the whole itinerary (plan, how to get there and the packing list) to your inbox.'
        : 'Sending is off on this backend. Set <code>ITINERARY_API_URL</code> on the server to turn it on.'
    }</p>
    <form class="send-form">
      <input name="email" type="email" placeholder="you@example.com" required aria-label="Email address">
      <button type="submit" ${health.itineraryApi ? '' : 'disabled'}>✉️ Send</button>
    </form>
    <p class="msg" role="status"></p>`;
  const form = $('form', el);
  form.email.value = store.get('sloth.email', '');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('button', form);
    const msg = $('.msg', el);
    btn.disabled = true;
    btn.textContent = 'Sending…';
    msg.className = 'msg';
    msg.textContent = '';
    try {
      const { to } = await api('POST', `/api/watches/${w.id}/send`, { email: form.email.value });
      store.set('sloth.email', to);
      msg.className = 'msg ok';
      msg.textContent = `Sent to ${to}.`;
    } catch (err) {
      msg.className = 'msg error';
      msg.textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = '✉️ Send';
    }
  };
  return el;
}

function renderTabs(w, plan) {
  const wrap = document.createElement('div');
  const tabs = [
    ['plan', '🗓️ Plan'],
    ['go', '🧭 How to go'],
    ['pack', '🎒 Things to carry'],
    ['send', '✉️ Send'],
  ];
  wrap.innerHTML = `<div class="tabs" role="tablist">${tabs
    .map(([id, label]) => `<button type="button" class="tab" role="tab" data-tab="${id}">${label}${id === 'pack' ? '<span class="count"></span>' : ''}</button>`)
    .join('')}</div>`;
  const panels = {
    plan: Object.assign(document.createElement('div'), { innerHTML: renderPlan(w, plan) }),
    go: Object.assign(document.createElement('div'), { innerHTML: renderRoutes(w, plan) }),
    pack: packingPanel(w, plan, (done, total) => {
      $('.count', wrap).textContent = `${done}/${total}`;
    }),
    send: sendPanel(w),
  };
  for (const [id, panel] of Object.entries(panels)) {
    panel.className = 'panel';
    panel.setAttribute('role', 'tabpanel');
    panel.dataset.panel = id;
    wrap.append(panel);
  }
  const select = (id) => {
    activeTab.set(w.id, id);
    for (const t of wrap.querySelectorAll('.tab')) t.setAttribute('aria-selected', t.dataset.tab === id);
    for (const [pid, panel] of Object.entries(panels)) panel.hidden = pid !== id;
  };
  $('.tabs', wrap).onclick = (e) => e.target.closest('.tab') && select(e.target.closest('.tab').dataset.tab);
  select(activeTab.get(w.id) ?? 'plan');
  return wrap;
}

function renderResult(w, box) {
  const check = w.lastCheck;
  if (!check) {
    box.innerHTML = '<p class="empty">Not checked yet. Hit “Check now”, or wait for the next scheduled check.</p>';
    return;
  }
  const go = check.verdict === 'GO';
  const days = check.days
    .map(
      (d) => `<div class="day ${check.plan?.date === d.date ? 'picked' : ''}">
        <span class="dname">${esc(d.weekday)}</span>
        <span>${esc(d.date.slice(8))}/${esc(d.date.slice(5, 7))}</span>
        <span class="wx">${icon(d.weatherCode)}</span>
        <span>${Math.round(d.tempMaxC)}°</span>
        <span class="rain">💧${d.rainChancePct}%</span>
      </div>`,
    )
    .join('');
  box.innerHTML = `
    <div class="verdict ${go ? 'go' : 'wait'}">
      <span class="big">${go ? '🎒' : '😴'}</span>
      <span class="badge">${go ? `GO · ${esc(new Date(check.plan.date).toDateString())}` : 'NOT YET'}</span>
      <p>${esc(check.reason)}</p>
    </div>
    ${days ? `<div class="days">${days}</div>` : ''}`;
  if (check.plan) box.append(renderTabs(w, check.plan));
  box.insertAdjacentHTML(
    'beforeend',
    `<p class="footnote">Checked ${new Date(check.at).toLocaleString()} · decided by ${esc(check.decidedBy)} · forecast to ${esc(check.horizon)}</p>
    ${check.alertError ? `<p class="error">Telegram alert not sent: ${esc(check.alertError)}</p>` : ''}`,
  );
}

function renderWatch(w) {
  const el = $('#watch-tpl').content.firstElementChild.cloneNode(true);
  $('.dest', el).textContent = `${w.place.name}, ${w.place.region.replace(/, India$/, '')}`;
  const chips = [
    `📍 from ${w.origin}`,
    `📅 ${w.from} → ${w.to}`,
    `💰 ${rupees(w.budgetInr)}`,
    w.weekendsOnly && 'Weekends',
    w.noRain && 'No rain',
    w.vibe && `✨ ${w.vibe}`,
  ].filter(Boolean);
  $('.chips', el).innerHTML = chips.map((c) => `<span class="chip">${esc(c)}</span>`).join('');
  renderResult(w, $('.result', el));

  $('.check-now', el).onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Asking Gemma…';
    try {
      el.replaceWith(renderWatch(await api('POST', `/api/watches/${w.id}/check`)));
    } catch (err) {
      $('.result', el).insertAdjacentHTML('afterbegin', `<p class="error">${esc(err.message)}</p>`);
      btn.disabled = false;
      btn.textContent = 'Check now';
    }
  };
  $('.delete', el).onclick = async () => {
    await api('DELETE', `/api/watches/${w.id}`);
    el.remove();
    if (!$('#watches').children.length) renderWatches([]);
  };
  return el;
}

function renderWatches(watches) {
  const list = $('#watches');
  list.replaceChildren(...watches.map(renderWatch));
  if (!watches.length) list.innerHTML = '<p class="empty card">Nothing watched yet. The sloth is waiting. 🦥</p>';
}

$('#watch-form').onsubmit = async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const errorEl = $('#form-error');
  errorEl.hidden = true;
  form.querySelector('button').disabled = true;
  try {
    const watch = await api('POST', '/api/watches', {
      ...data,
      budgetInr: Number(data.budgetInr),
      weekendsOnly: form.weekendsOnly.checked,
      noRain: form.noRain.checked,
    });
    $('.empty', $('#watches'))?.remove();
    $('#watches').prepend(renderWatch(watch));
    form.destination.value = '';
    form.vibe.value = '';
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  } finally {
    form.querySelector('button').disabled = false;
  }
};

const iso = (d) => d.toISOString().slice(0, 10);
const today = new Date();
$('#watch-form').from.value = iso(today);
$('#watch-form').to.value = iso(new Date(today.getTime() + 14 * 86400000));

let attempt = 0;

async function connect(base) {
  // A slow failed attempt must not overwrite a newer one that already connected.
  const mine = ++attempt;
  apiBase = normalizeBase(base);
  try {
    localStorage.setItem(BASE_KEY, apiBase);
  } catch {}
  $('#api-base').value = apiBase;
  const conn = $('#conn');
  const dot = $('#conn-dot');
  conn.textContent = 'Connecting…';
  dot.className = 'dot';
  try {
    const h = await api('GET', '/api/health');
    const watches = await api('GET', '/api/watches');
    if (mine !== attempt) return;
    health = h;
    renderStatus(h);
    renderWatches(watches);
    dot.className = 'dot ok';
    conn.textContent = `Connected to ${apiBase || location.origin}`;
  } catch (err) {
    if (mine !== attempt) return;
    if (err.message === 'Request failed (404)') {
      err.message = `${apiBase || location.origin} answered, but it isn't a Sloth Trip Watcher backend (no /api/health).`;
    }
    $('#status').innerHTML = '';
    $('#watches').innerHTML = '<p class="empty card">Not connected. Open “Backend” above and enter your server URL.</p>';
    dot.className = 'dot bad';
    conn.textContent = err.message;
    $('.backend').open = true;
  }
}

$('#connect-form').onsubmit = (e) => {
  e.preventDefault();
  connect($('#api-base').value);
};

connect(savedBase());
