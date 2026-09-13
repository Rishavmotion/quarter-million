# Quarter Million

A private, one-person savings tracker: **$250,000 by December 2027**.
Installs to the iPhone home screen and the Mac Dock as a web app; every device reads the same number.

## How it's built

- `public/` — the app. Plain HTML/CSS/JS, no build step, served as Worker static assets.
- `src/index.js` — the Cloudflare Worker. `GET /api/tracker` returns the state, `POST` appends an entry.
- `wrangler.jsonc` — Worker config: assets directory and the KV binding.
- Data lives in a **Cloudflare KV** namespace (binding `TRACKER`) as one JSON document.
- Writes require a passphrase (`SAVE_TOKEN` secret). The app remembers it per device.
- `public/sw.js` caches the shell so it opens offline with the last-known numbers.

## Cloudflare setup (once)

1. **Storage & databases → KV → Create namespace** named `TRACKER`. Copy its ID into
   `wrangler.jsonc` (`kv_namespaces[0].id`) and push.
2. **Workers & Pages → Create application → Continue with GitHub** → pick this repo.
   Build command: *(empty)*. Deploy command: `npx wrangler deploy`. Deploy.
3. In the Worker: **Settings → Variables and Secrets → Add** → type *Secret*,
   name `SAVE_TOKEN`, value = your passphrase. Cloudflare redeploys with it.

Every push to `main` deploys automatically.

## Local development

```bash
npm install
npm run dev
```

Opens on http://localhost:8788 with a local KV. The local passphrase is in `.dev.vars`.
`npm run deploy` deploys from this machine (after `npx wrangler login`) if you ever need to bypass GitHub.

## Changing the goal

`POST /api/tracker` with `{"settings": {"target": 250000, "deadline": "2027-12-31", "start": "2026-01-01"}}`
and the `Authorization: Bearer <passphrase>` header. `start` may be `null` to use the first entry's date.
