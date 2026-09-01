# C Finley

Static front end + a small set of Vercel serverless functions for authentication, per-app permissions, and a couple of small internal apps. No framework, no bundler.

## Structure

- `index.html` — homepage
- `portal.html` — login screen, posts to `/api/login`
- `setup.html` — one-time screen to create the first admin account
- `dashboard.html` — home screen; shows an app tile for each app the signed-in user has access to
- `admin.html` — admin panel: add users, grant/deny per-app access via checkboxes, toggle admin, reset passwords, delete users
- `files.html` — File Storage app: shared upload/download/delete (requires the `files` permission)
- `notepad.html` — Notepad app: private per-user notes (requires the `notepad` permission)
- `hotels.html` — Hotel Search app: search hotels by city via the Booking.com API on RapidAPI (requires the `hotels` permission)
- `wordle.html` — Wordle app: daily word puzzle, word fetched once per day from the Wordle API on RapidAPI and cached in Postgres; the guessing game itself runs client-side (requires the `wordle` permission)
- `privacy.html`, `contact.html` — footer pages
- `styles.css` — shared styles
- `status.js` — location/time/weather status bar shown at the top of every page except `portal.html`; uses Open-Meteo only (no key, no account). Location is fetched from `/api/location` and editable site-wide from the "Site Settings" section in `/admin.html`.
- `api/` — serverless functions (10 total; Vercel's Hobby plan caps a deployment at 12, so collection+item routes are merged into one optional-catch-all file each rather than split, and shared helpers live in `lib/` instead of `api/` so they aren't counted as functions themselves):
  - `login`, `logout`, `me`, `setup` — auth
  - `users/[[...params]]` — admin user management (`/api/users` list/create, `/api/users/:id` update/delete)
  - `files/[[...params]]` — file storage, backed by Vercel Blob (`/api/files` list/upload, `/api/files/:id` delete)
  - `notes/[[...params]]` — notepad (`/api/notes` list/create, `/api/notes/:id` update/delete)
  - `hotels` — hotel search (proxies the Booking.com API on RapidAPI; the key stays server-side)
  - `wordle` — daily word (proxies the Wordle API on RapidAPI, cached per day in the `wordle_words` table)
  - `location` — status bar location: public `GET` (used by `status.js`, including for anonymous visitors on the public pages), admin-only `PATCH` that geocodes the new location via Open-Meteo and stores it in the `settings` table
- `lib/` — shared helpers imported by the functions above, kept out of `api/` so they don't count against the function limit: `_db.js`, `_auth.js`, `_session.js`, `_blob.js`

## Apps and permissions

Each app is gated by a permission id stored per-user (`permissions text[]` on the `users` table): `files`, `notepad`, `hotels`, `wordle`, and `adsb` (reserved for a future ADS-B Exchange integration — the tile shows on the home screen as "Coming soon" and isn't wired to a page yet). Admins implicitly have access to every app regardless of their permission list. Grant/revoke access per user from the checkboxes in `/admin.html`; changes apply immediately since permissions are re-read from the database on every request, not cached in the session.

## Requirements

- A Postgres database attached to the Vercel project (Storage → Postgres, any provider — the code uses the plain `pg` driver against whatever `POSTGRES_URL` points to, pooled or direct).
- A Blob store attached to the Vercel project (Storage → Blob), for the File Storage app. Depending on the store type this sets either `BLOB_READ_WRITE_TOKEN` or a store id + OIDC-based auth automatically — see `api/_blob.js`.
- Three environment variables, set in the Vercel project before your first deploy:
  - `SESSION_SECRET` — long random string used to sign session cookies (e.g. `openssl rand -base64 48`)
  - `SETUP_TOKEN` — one-time token required to create the first admin account; without it, `/setup.html` refuses to create anyone
  - `RAPIDAPI_KEY` — your RapidAPI key, subscribed to the `booking-com15` and `wordle-api3` APIs, for the Hotel Search and Wordle apps

See `.env.example`.

## First-time setup

1. Deploy with `SESSION_SECRET` and `SETUP_TOKEN` set, and Postgres + Blob attached.
2. Visit `/setup.html`, enter the setup token plus an admin email/password. This creates the first (admin) user and signs you in.
3. From then on `/setup.html` refuses further use — manage additional users from `/admin.html`.
4. Optionally remove or rotate `SETUP_TOKEN` after setup; it's only checked when the users table is empty.

## Notes

- Passwords are hashed with bcrypt; nothing is stored or logged in plaintext.
- Sessions are a signed, `HttpOnly`/`Secure`/`SameSite=Strict` cookie carrying only a user id — permissions and admin status are re-read from the database on every request, so changes made in the admin panel take effect immediately, without waiting for re-login.
- File uploads go through the serverless function body, so they're capped at 4.5MB (Vercel's function body limit). Files are stored with `access: 'public'` in Blob — the URL is unguessable/unlisted but not itself authenticated, so anyone with a direct link can fetch it.
- The Booking.com free tier on RapidAPI is capped (check your plan's monthly quota — it was 50 requests/month at the time this was built). Each hotel search costs 2 API calls (a destination lookup, then the hotel search), so the app only calls out on explicit form submit, never as-you-type.
- The homepage and its "Access Portal" framing are unchanged; login is fully functional rather than decorative.
- The status bar's location (display label + coordinates) lives in the `settings` table, set once via geocoding when an admin saves it in `/admin.html` — `status.js` just reads the stored coordinates from `/api/location` on each page load, no client-side geocoding. Weather refreshes every 10 minutes; the clock re-renders every 30 seconds off the cached timezone. If Open-Meteo or `/api/location` is unreachable, the bar just removes itself — the rest of the page is unaffected.
