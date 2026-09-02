# C Finley

Static front end + a small set of Vercel serverless functions for authentication, per-app permissions, and a couple of small internal apps. No framework, no bundler.

## Structure

- `index.html` — homepage
- `portal.html` — login screen, posts to `/api/login`
- `setup.html` — one-time screen to create the first admin account
- `dashboard.html` — home screen; a desktop-style row of floating icon+label launchers (hand-drawn inline SVGs, no icon library) for each app the signed-in user has access to
- `admin.html` — Control Panel: a stat dashboard (users/files/notes/active Life Sim characters), add users, grant/deny per-app access via checkboxes, toggle admin, reset passwords, delete users, see each user's last-active time
- `files.html` — File Storage app: shared upload/download/delete (requires the `files` permission)
- `notepad.html` — Notepad app: private per-user notes (requires the `notepad` permission)
- `hotels.html` — Hotel Search app: search hotels by city via the Booking.com API on RapidAPI (requires the `hotels` permission)
- `wordle.html` — Wordle app: daily word puzzle, word fetched once per day from the Wordle API on RapidAPI and cached in Postgres; the guessing game itself runs client-side (requires the `wordle` permission)
- `lifesim.html` — Life Sim app: single-player, AI-driven BitLife-style life simulator with a persistent Relationships/Career/Assets/Activities menu alongside the yearly AI-generated story event (requires the `lifesim` permission)
- `news.html` — News app: top US headlines via the Real-Time News Data API on RapidAPI, refreshed server-side every 5 minutes (requires the `news` permission)
- `privacy.html`, `contact.html`, `server-status.html` — footer pages. Server Status is public (no login) and always shows the vague "operational/degraded" read, regardless of whether the visitor happens to be logged in — see the `status` API entry below for why. The detailed version (live DB ping latency, which optional integrations are configured) lives in the "Server Status" section of `/admin.html` instead
- `styles.css` — shared styles
- `status.js` — location/time/weather status bar shown at the top of every page except `portal.html`; uses Open-Meteo only (no key, no account). Location is fetched from `/api/location` and editable site-wide from the "Site Settings" section in `/admin.html`.
- `adsb-map.js` — homepage-only: renders the live ADS-B background map behind the login UI on `index.html`. Uses MapLibre GL JS + OpenFreeMap + adsb.fi only (no key, no account). See "ADS-B background map" in Notes below.
- `api/` — serverless functions (14 total; the project is on Vercel Pro, which doesn't impose the Hobby plan's hard 12-function-per-deployment cap, so this is no longer a hard constraint on new features — collection+item routes still stay merged into one file each out of habit, and shared helpers still live in `lib/` instead of `api/` so they aren't counted as functions themselves). Collection/item routes take the item id as a `?id=` query param (e.g. `/api/users?id=5`) rather than a path segment — Vercel's optional-catch-all filename convention (`[[...id]].js`) is a Next.js-specific routing feature and doesn't reliably work for plain Vercel Serverless Functions, which is what caused the admin user list to silently break after that merge:
  - `login`, `logout`, `me`, `setup` — auth
  - `users` — admin user management (`/api/users` list/create — the list response also carries the Control Panel's stat dashboard counts and each user's `last_login_at` — `/api/users?id=:id` update/delete)
  - `files` — file storage, backed by Vercel Blob (`/api/files` list/upload, `/api/files?id=:id` delete)
  - `notes` — notepad (`/api/notes` list/create, `/api/notes?id=:id` update/delete)
  - `hotels` — hotel search (proxies the Booking.com API on RapidAPI; the key stays server-side)
  - `wordle` — daily word (proxies the Wordle API on RapidAPI, cached per day in the `wordle_words` table)
  - `location` — status bar location: public `GET` (used by `status.js`, including for anonymous visitors on the public pages), admin-only `PATCH` that geocodes the new location via Open-Meteo and stores it in the `settings` table
  - `lifesim` — Life Sim: calls the Anthropic API (Claude Haiku 4.5) once per year advanced to generate the next event + 3 choices (with optional relationship effects, a new relationship, or an achievement) as JSON; everything else — relationships (spend time/gift/propose/have a child), career (apply/work harder/quit), college enrollment, buying/selling houses and cars, gym/doctor/study — is deterministic server-side logic with no AI call. Saves the character to the `life_sim` table (one row per user, overwritten on restart)
  - `status` — public (no login required), response detail still depends on whether the request carries a valid session: a session gets the real picture (DB ping latency, each integration named and whether it's configured), no session gets only a vague "operational / degraded" read and an unlabeled "N / M nominal" count. `/server-status.html` deliberately fetches with `credentials: 'omit'` so it never sends the visitor's cookie even if they're logged in, and always renders the vague view — otherwise the page would flip between detail levels depending on the viewer's live session state (login, 12h session expiry, viewing from a preview URL vs. the custom domain), which just reads as flaky. `/admin.html`'s "Server Status" section calls the same endpoint normally (cookie included) for the real picture
  - `news` — top US headlines via the Real-Time News Data API on RapidAPI (`/top-headlines`, requires the `news` permission), trimmed to `title`, `link`, `snippet`, `image`, `publishedAt`, `source`, `sourceIcon`. Responses are cached in memory for 5 minutes to conserve the RapidAPI plan's quota; on an upstream failure it serves the last known-good list if there is one, otherwise a real error (unlike the ADS-B feed, an empty news list isn't a legitimate state worth hiding)
  - `adsb` — public `GET`, backs the homepage's background map: reads the same admin-configured location as `/api/location` and proxies adsb.fi's `lat/lon/dist` lookup for aircraft within range, returning a small trimmed shape (`hex`, `callsign`, `type`, `altitude`, `track`, `lat`, `lon`). Responses are cached in memory for 12 seconds; on an upstream failure it serves the last known-good list (or an empty one) rather than erroring, since the map is designed to keep working with zero aircraft
- `lib/` — shared helpers imported by the functions above, kept out of `api/` so they don't count against the function limit: `_db.js`, `_auth.js`, `_session.js`, `_blob.js`

## Apps and permissions

Each app is gated by a permission id stored per-user (`permissions text[]` on the `users` table): `files`, `notepad`, `hotels`, `wordle`, `lifesim`, `news`, and `adsb` (reserved for a future ADS-B Exchange integration — the tile shows on the home screen as "Coming soon" and isn't wired to a page yet). Admins implicitly have access to every app regardless of their permission list. Grant/revoke access per user from the checkboxes in `/admin.html`; changes apply immediately since permissions are re-read from the database on every request, not cached in the session.

## Requirements

- A Postgres database attached to the Vercel project (Storage → Postgres, any provider — the code uses the plain `pg` driver against whatever `POSTGRES_URL` points to, pooled or direct).
- A Blob store attached to the Vercel project (Storage → Blob), for the File Storage app. Depending on the store type this sets either `BLOB_READ_WRITE_TOKEN` or a store id + OIDC-based auth automatically — see `api/_blob.js`.
- Four environment variables, set in the Vercel project before your first deploy:
  - `SESSION_SECRET` — long random string used to sign session cookies (e.g. `openssl rand -base64 48`)
  - `SETUP_TOKEN` — one-time token required to create the first admin account; without it, `/setup.html` refuses to create anyone
  - `RAPIDAPI_KEY` — your RapidAPI key, subscribed to the `booking-com15`, `wordle-api3`, and `real-time-news-data` APIs, for the Hotel Search, Wordle, and News apps
  - `ANTHROPIC_API_KEY` — your Anthropic API key (from console.anthropic.com, billing required — no free tier) for the Life Sim app

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
- News shows US/English headlines only for now (no country/language picker, no topic browsing, no search) — deliberately kept simple for the first version. The 5-minute server-side cache is shared across every visitor, so opening the News app doesn't cost a fresh API call per page load.
- The homepage and its "Access Portal" framing are unchanged; login is fully functional rather than decorative.
- The status bar's location (display label + coordinates) lives in the `settings` table, set once via geocoding when an admin saves it in `/admin.html` — `status.js` just reads the stored coordinates from `/api/location` on each page load, no client-side geocoding. Weather refreshes every 10 minutes; the clock re-renders every 30 seconds off the cached timezone. If Open-Meteo or `/api/location` is unreachable, the bar just removes itself — the rest of the page is unaffected.
- Life Sim spends one Anthropic API call per turn (starting a life, or advancing a year) — real, ongoing cost, not a free tier. Menu actions (relationships, career, assets, activities, college) never call the AI. Each character is a single row in `life_sim`; starting a new life overwrites the previous one rather than keeping multiple saves. Money going negative (debt) is allowed; college tuition currently must be paid up front rather than financed.
- **ADS-B background map** (`index.html` only): an atmospheric, non-interactive MapLibre GL JS map sits behind the login UI, centered on the same admin-configured location as the status bar. The style is OpenFreeMap's free `dark` style (vector tiles, no key, no account, no signup — `https://tiles.openfreemap.org/styles/dark`), stripped at runtime to just land vs. water: every style layer is hidden except the base `background` fill and the `water` source-layer, so there are no roads, buildings, boundaries, POIs, or labels — just a landmass silhouette. An extra low-opacity `background`-type layer is then added on top of what's left so geography reads as barely-there; aircraft markers and their hover tooltips are DOM elements layered above the WebGL canvas, so they stay legible regardless of that dim layer. Aircraft positions come from `/api/adsb` (adsb.fi, no key, no account) polled every 15 seconds; markers are tracked by ICAO hex and updated/added/removed in place rather than the map or marker set being rebuilt on every poll, with a slow CSS transition on each marker's transform so movement reads as a drift rather than a jump. All map interaction is disabled (`interactive: false` — no drag/zoom/click/rotate) so it behaves as a background, not an application; the actual login UI keeps normal pointer events via an explicit override, everything else is click-through so hovering an aircraft works even "through" the wordmark or empty space. If `/api/location` or the map itself fails, the page just keeps its plain dark background with no map; if `/api/adsb` fails, the map keeps running with whatever aircraft it last had (or none) — neither failure touches the Access Portal button. (An earlier version of this used Leaflet + CARTO's raster tiles; CARTO's anonymous free tier started requiring an API key, and CARTO doesn't fit the no-signup/no-key constraint this project holds everywhere else, so the whole tile layer was swapped for OpenFreeMap on MapLibre instead. Aircraft data started on ADSB.lol; when its `/v2/point` endpoint stopped returning aircraft reliably, it was swapped for adsb.fi's `/api/v3/lat/.../lon/.../dist/...` endpoint instead, which is compatible with the same ADSBExchange v2 response schema so only the URL construction in `api/adsb.js` changed.)
