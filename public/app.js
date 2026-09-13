// Quarter Million — client
// Data lives in Cloudflare KV behind /api/tracker (see functions/api/tracker.js).
// The page keeps a copy in localStorage so it opens instantly and works offline.

const $ = id => document.getElementById(id);
const API = '/api/tracker';
const STATE_KEY = 'qm:state';
const TOKEN_KEY = 'qm:token';
const THEME_KEY = 'qm:theme';
const DAY = 86400000;

let current = null; // derived view model
let busy = false;

const usd = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
const fmtDate = t => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const fmtTime = t => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const localMidnight = iso => new Date(iso + 'T00:00:00').getTime();
const dayOf = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

// ---------- storage helpers ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};
const cachedState = () => { try { return JSON.parse(store.get(STATE_KEY)); } catch { return null; } };
const cacheState = state => store.set(STATE_KEY, JSON.stringify({ state, at: Date.now() }));

// ---------- network ----------
async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const r = await fetch(path, { ...options, signal: controller.signal });
    let data = null;
    try { data = await r.json(); } catch {}
    if (!r.ok) {
      const err = Error((data && data.error) || 'Connection returned ' + r.status);
      err.status = r.status;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- derive everything the UI shows from raw state ----------
function derive(state) {
  const settings = state.settings || {};
  const target = Number(settings.target) > 0 ? Number(settings.target) : 250000;

  const entries = (state.entries || [])
    .map(e => ({ t: Date.parse(e.ts), amount: Number(e.amount), note: String(e.note || '') }))
    .filter(e => Number.isFinite(e.t) && Number.isFinite(e.amount))
    .sort((a, b) => a.t - b.t);

  const have = entries.length ? entries[entries.length - 1].amount : 0;
  const baseline = entries.length ? entries[0].amount : 0;

  const today = dayOf(Date.now());
  const start = settings.start ? localMidnight(settings.start) : (entries.length ? dayOf(entries[0].t) : today);
  const deadline = settings.deadline ? localMidnight(settings.deadline) : localMidnight('2027-12-31');
  const span = Math.max(DAY, deadline - start);
  const elapsed = Math.max(0, Math.min(span, today - start));

  const expected = baseline + (target - baseline) * (elapsed / span);
  const still = Math.max(0, target - have);
  const daysLeft = Math.max(0, Math.ceil((deadline - today) / DAY));
  const monthsExact = daysLeft / 30.4375;

  const history = entries.map((e, i) => ({
    ...e,
    delta: i === 0 ? null : e.amount - entries[i - 1].amount
  })).reverse();

  return {
    target, have, baseline, still, expected,
    pace_delta: have - expected,
    done: have >= target,
    days_left: daysLeft,
    months_left: Math.round(monthsExact),
    monthly_needed: daysLeft > 0 ? still / Math.max(1, monthsExact) : 0,
    start, deadline, today,
    entries, history
  };
}

// ---------- render ----------
function render(d) {
  const p = Math.max(0, Math.min(100, d.have / d.target * 100));
  $('balance').innerHTML = usd(d.have) + '<span>USD</span>';
  $('goal').textContent = usd(d.target);
  $('percent').textContent = p.toFixed(1) + '% complete';
  $('remaining').textContent = usd(d.still) + ' remaining';
  $('fill').style.width = p + '%';
  $('progress').setAttribute('aria-valuenow', p.toFixed(1));
  $('monthly').textContent = d.days_left > 0 ? usd(d.monthly_needed) : 'Deadline reached';
  $('days').textContent = d.days_left + ' days';
  $('months').textContent = d.months_left + ' months';
  $('pace').textContent = d.done
    ? 'Goal reached. Take a moment to enjoy it.'
    : (!d.entries.length
      ? 'Save your first balance to start the clock.'
      : (Math.abs(d.pace_delta) < 1
        ? 'Right on your target path.'
        : usd(Math.abs(d.pace_delta)) + (d.pace_delta >= 0 ? ' ahead of' : ' behind') + ' the even savings path.'));
  $('amount').value = d.entries.length ? d.have : '';
  drawChart(d);
  $('history').innerHTML = d.history.length
    ? '<table><thead><tr><th>DATE / NOTE</th><th>BALANCE</th><th>CHANGE</th></tr></thead><tbody>' +
      d.history.map(h =>
        '<tr><td>' + esc(fmtDate(h.t)) + ' · ' + esc(fmtTime(h.t)) +
        (h.note ? '<small>' + esc(h.note) + '</small>' : '') +
        '</td><td>' + usd(h.amount) + '</td><td>' +
        (h.delta === null ? '—' : (h.delta > 0 ? '+' : '') + usd(h.delta)) +
        '</td></tr>').join('') +
      '</tbody></table>'
    : '<p class="empty">Your story starts here. Save your first balance to begin a record of your progress.</p>';
}

function drawChart(d) {
  const { start, deadline: end, today } = d;
  const x = t => 48 + Math.max(0, Math.min(1, (t - start) / (end - start))) * 552;
  const ymax = Math.max(d.target, d.have);
  const y = v => 194 - Math.max(0, Math.min(1, v / ymax)) * 165;

  let svg = '<svg viewBox="0 0 630 235" role="img" aria-label="Recorded balances and a straight target path to the deadline">';
  for (let i = 0; i < 5; i++) {
    const yy = y(ymax * i / 4);
    svg += '<line x1="48" y1="' + yy + '" x2="600" y2="' + yy + '" stroke="var(--border)"/>' +
           '<text x="0" y="' + (yy + 4) + '" fill="var(--muted)" font-size="9">$' + Math.round(ymax * i / 4000) + 'k</text>';
  }
  svg += '<path d="M48 ' + y(d.baseline) + ' L600 ' + y(d.target) + '" stroke="#a6b39e" stroke-width="2" stroke-dasharray="5 6" fill="none"/>';

  const pts = d.entries.map(e => ({ t: e.t, v: e.amount }));
  pts.push({ t: today, v: d.have });
  if (pts.length > 1) {
    svg += '<polyline points="' + pts.map(p => x(p.t) + ',' + y(p.v)).join(' ') + '" fill="none" stroke="var(--accent)" stroke-width="2.5"/>';
  }
  const xx = x(today), yy = y(d.have);
  // Label sits below the marker while the target line still rises through it, above once there is headroom.
  const labelY = yy < 170 ? yy + 22 : Math.max(18, yy - 12);
  svg += '<line x1="' + xx + '" y1="25" x2="' + xx + '" y2="194" stroke="var(--border)" stroke-dasharray="3 4"/>' +
         '<circle cx="' + xx + '" cy="' + yy + '" r="7" fill="var(--surface)" stroke="var(--accent)" stroke-width="2.5"/>' +
         '<text x="' + Math.min(530, xx + 12) + '" y="' + labelY + '" fill="var(--accent)" font-size="10" font-weight="600">' + usd(d.have) + ' · now</text>';

  const endLabel = new Date(end).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }).toUpperCase();
  [[start, 'START'], [start + (end - start) * 0.5, 'MIDPOINT'], [end, endLabel]].forEach(([t, label]) => {
    svg += '<text x="' + x(t) + '" y="220" text-anchor="' + (t === start ? 'start' : t === end ? 'end' : 'middle') + '" fill="var(--muted)" font-size="9">' + label + '</text>';
  });
  $('chart').innerHTML = svg + '</svg>';
}

// ---------- state flow ----------
function show(state, syncText) {
  current = derive(state);
  render(current);
  $('sync').textContent = syncText;
  $('amount').disabled = false;
  $('note').disabled = false;
  $('save').disabled = false;
}

async function load() {
  if (busy) return;
  $('refresh').disabled = true;
  $('sync').textContent = 'Syncing…';
  try {
    const state = await request(API);
    if (!state || !state.settings) throw Error('Tracker returned an unexpected response.');
    cacheState(state);
    show(state, '● Synced · ' + fmtTime(Date.now()));
  } catch (e) {
    const cached = cachedState();
    const reason = e.name === 'AbortError' ? 'Connection timed out.' : e.message;
    if (cached && cached.state) {
      show(cached.state, 'Offline · showing copy from ' + fmtDate(cached.at) + ' ' + fmtTime(cached.at));
    } else {
      $('sync').textContent = reason + ' Use Refresh to reconnect.';
    }
  } finally {
    $('refresh').disabled = false;
  }
}

// ---------- save ----------
function needPassphrase(message) {
  $('pass-wrap').hidden = false;
  if (message) $('form-msg').textContent = message;
  $('pass').focus();
}

$('update').onsubmit = async e => {
  e.preventDefault();
  if (busy || !current) return;

  const raw = $('amount').value.trim();
  const amount = Number(raw);
  if (raw === '' || !Number.isFinite(amount) || amount < 0) {
    $('form-msg').textContent = 'Enter a valid balance of zero or more.';
    return;
  }
  const token = store.get(TOKEN_KEY) || $('pass').value.trim();
  if (!token) { needPassphrase('Enter your passphrase to save.'); return; }

  busy = true;
  $('save').disabled = true;
  $('refresh').disabled = true;
  $('form-msg').textContent = 'Saving your balance…';
  try {
    const state = await request(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ amount, note: $('note').value })
    });
    store.set(TOKEN_KEY, token);
    $('pass').value = '';
    $('pass-wrap').hidden = true;
    $('note').value = '';
    cacheState(state);
    show(state, '● Synced · ' + fmtTime(Date.now()));
    $('form-msg').textContent = 'Your update is saved.';
  } catch (err) {
    if (err.status === 401) {
      store.del(TOKEN_KEY);
      needPassphrase('That passphrase was not accepted. Try again.');
    } else {
      $('form-msg').textContent = err.name === 'AbortError'
        ? 'Save timed out. Refresh and check your balance before trying again.'
        : (navigator.onLine === false ? 'You are offline. Your balance was not saved.' : err.message + ' Refresh to check whether it saved.');
    }
  } finally {
    busy = false;
    $('save').disabled = false;
    $('refresh').disabled = false;
  }
};

// ---------- export ----------
$('export').onclick = e => {
  e.preventDefault();
  if (!current) return;
  const rows = [['date', 'balance_usd', 'change_usd', 'note']]
    .concat(current.entries.map((en, i) => [
      new Date(en.t).toISOString(),
      en.amount,
      i === 0 ? '' : en.amount - current.entries[i - 1].amount,
      '"' + en.note.replace(/"/g, '""') + '"'
    ]));
  const blob = new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'quarter-million.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

// ---------- theme ----------
function applyTheme() {
  const saved = store.get(THEME_KEY);
  const dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', dark);
  const meta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (meta) meta.content = dark ? '#111b17' : '#f5f7f3';
}
$('theme').onclick = () => {
  const dark = !document.documentElement.classList.contains('dark');
  store.set(THEME_KEY, dark ? 'dark' : 'light');
  applyTheme();
};
$('refresh').onclick = load;

// ---------- boot ----------
applyTheme();
if (!store.get(TOKEN_KEY)) $('pass-wrap').hidden = false;
const cached = cachedState();
if (cached && cached.state) show(cached.state, 'Showing saved copy · updating…');
load();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
