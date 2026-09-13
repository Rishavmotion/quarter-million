# Quarter Million

A private, one-person savings tracker: **$250,000 by December 2027**.
Installs to the iPhone home screen and the Mac Dock as a web app; every device reads the same number.

## How it's built

- `public/` — the app. Plain HTML/CSS/JS, no build step.
- `functions/api/tracker.js` — a Cloudflare Pages Function. `GET` returns the state, `POST` appends an entry.
- Data lives in a **Cloudflare KV** namespace (binding `TRACKER`) as one JSON document.
- Writes require a passphrase (`SAVE_TOKEN` secret). The app remembers it per device.
- `public/sw.js` caches the shell so it opens offline with the last-known numbers.

## Cloudflare setup (once)

1. **Workers & Pages → Create → Pages → Connect to Git** → pick this repo.
   Framework preset: *None*. Build command: *(empty)*. Build output directory: `public`.
2. **Storage & Databases → KV → Create namespace** named `TRACKER`.
3. In the Pages project: **Settings → Bindings → Add → KV namespace**.
   Variable name `TRACKER`, namespace `TRACKER`.
4. **Settings → Variables and Secrets → Add** → type *Secret*, name `SAVE_TOKEN`, value = your passphrase.
5. **Deployments → Retry deployment** (bindings apply on the next deploy).

## Local development

```bash
npm install
npm run dev
```

Opens on http://localhost:8788 with a local KV. The local passphrase is in `.dev.vars`.

## Changing the goal

`POST /api/tracker` with `{"settings": {"target": 250000, "deadline": "2027-12-31", "start": "2026-01-01"}}`
and the `Authorization: Bearer <passphrase>` header. `start` may be `null` to use the first entry's date.
