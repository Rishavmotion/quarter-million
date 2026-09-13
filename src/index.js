// Quarter Million — Cloudflare Worker
//
// Static files in public/ are served by the assets binding; anything under /api/
// reaches this fetch handler.
//
// Storage: one JSON document in the TRACKER KV namespace under the key "state".
//   { settings: { target, start, deadline }, entries: [ { ts, amount, note } ] }
//
// Bindings (wrangler.jsonc): KV namespace TRACKER, assets ASSETS.
// Secret (dashboard):        SAVE_TOKEN — passphrase required for every write.

const KEY = 'state';
const MAX_NOTE = 200;
const MAX_AMOUNT = 1e9;

const DEFAULT_SETTINGS = {
  target: 250000,
  start: null, // null → the app uses the date of the first entry
  deadline: '2027-12-31'
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

async function readState(env) {
  const raw = await env.TRACKER.get(KEY, 'json');
  const settings = { ...DEFAULT_SETTINGS, ...(raw && raw.settings) };
  const entries = Array.isArray(raw && raw.entries) ? raw.entries : [];
  return { settings, entries };
}

function authorized(request, env) {
  if (!env.SAVE_TOKEN) return 'unconfigured';
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  return token && token === env.SAVE_TOKEN ? 'ok' : 'denied';
}

function isIsoDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
}

async function getTracker(env) {
  return json(await readState(env));
}

async function postTracker(request, env) {
  const auth = authorized(request, env);
  if (auth === 'unconfigured') return json({ error: 'SAVE_TOKEN is not configured.' }, 500);
  if (auth === 'denied') return json({ error: 'Wrong passphrase.' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body must be JSON.' }, 400);
  }

  const state = await readState(env);

  // Optional settings update: { settings: { target?, start?, deadline? } }
  if (body && body.settings && typeof body.settings === 'object') {
    const s = body.settings;
    if (s.target !== undefined) {
      const t = Number(s.target);
      if (!Number.isFinite(t) || t <= 0 || t > MAX_AMOUNT) return json({ error: 'Invalid target.' }, 400);
      state.settings.target = t;
    }
    if (s.deadline !== undefined) {
      if (!isIsoDate(s.deadline)) return json({ error: 'Invalid deadline (YYYY-MM-DD).' }, 400);
      state.settings.deadline = s.deadline;
    }
    if (s.start !== undefined) {
      if (s.start !== null && !isIsoDate(s.start)) return json({ error: 'Invalid start (YYYY-MM-DD or null).' }, 400);
      state.settings.start = s.start;
    }
  }

  // Optional new entry: { amount, note? }
  if (body && body.amount !== undefined) {
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > MAX_AMOUNT) {
      return json({ error: 'Amount must be a number from 0 up.' }, 400);
    }
    const note = String(body.note ?? '').trim().slice(0, MAX_NOTE);
    state.entries.push({
      ts: new Date().toISOString(),
      amount: Math.round(amount * 100) / 100,
      note
    });
  }

  if (!body || (body.amount === undefined && !body.settings)) {
    return json({ error: 'Nothing to save.' }, 400);
  }

  await env.TRACKER.put(KEY, JSON.stringify(state));
  return json(state);
}

// DELETE /api/tracker?ts=<entry timestamp> — remove one entry.
async function deleteEntry(request, env, url) {
  const auth = authorized(request, env);
  if (auth === 'unconfigured') return json({ error: 'SAVE_TOKEN is not configured.' }, 500);
  if (auth === 'denied') return json({ error: 'Wrong passphrase.' }, 401);

  const ts = url.searchParams.get('ts');
  if (!ts) return json({ error: 'Missing ts.' }, 400);

  const state = await readState(env);
  const kept = state.entries.filter(e => e.ts !== ts);
  if (kept.length === state.entries.length) return json({ error: 'Entry not found.' }, 404);
  state.entries = kept;

  await env.TRACKER.put(KEY, JSON.stringify(state));
  return json(state);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/tracker') {
      if (!env.TRACKER) return json({ error: 'KV binding TRACKER is not configured.' }, 500);
      if (request.method === 'GET') return getTracker(env);
      if (request.method === 'POST') return postTracker(request, env);
      if (request.method === 'DELETE') return deleteEntry(request, env, url);
      return json({ error: 'Method not allowed.' }, 405);
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found.' }, 404);

    return env.ASSETS.fetch(request);
  }
};
