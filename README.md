# C Finley

Static front end + a small set of Vercel serverless functions for real authentication, user management, and permissions. No framework, no bundler.

## Structure

- `index.html` — homepage
- `portal.html` — login screen, posts to `/api/login`
- `setup.html` — one-time screen to create the first admin account
- `dashboard.html` — placeholder page shown to any signed-in user (email + assigned permissions)
- `admin.html` — admin panel: add users, edit permissions/admin flag, reset passwords, delete users
- `privacy.html`, `contact.html` — footer pages
- `styles.css` — shared styles
- `api/` — serverless functions (`login`, `logout`, `me`, `setup`, `users`, `users/[id]`)

## Requirements

- A Postgres database attached to the Vercel project (Storage → Postgres in the Vercel dashboard). This sets `POSTGRES_URL` and friends automatically — nothing to configure by hand.
- Two environment variables, set in the Vercel project before your first deploy:
  - `SESSION_SECRET` — long random string used to sign session cookies (e.g. `openssl rand -base64 48`)
  - `SETUP_TOKEN` — one-time token required to create the first admin account; without it, `/setup.html` refuses to create anyone

See `.env.example`.

## First-time setup

1. Deploy with `SESSION_SECRET` and `SETUP_TOKEN` set and a Postgres database attached.
2. Visit `/setup.html`, enter the setup token plus an admin email/password. This creates the first (admin) user and signs you in.
3. From then on `/setup.html` refuses further use — manage additional users from `/admin.html`.
4. Optionally remove or rotate `SETUP_TOKEN` after setup; it's only checked when the users table is empty.

## Notes

- Passwords are hashed with bcrypt; nothing is stored or logged in plaintext.
- Sessions are a signed, `HttpOnly`/`Secure`/`SameSite=Strict` cookie carrying only a user id — permissions and admin status are re-read from the database on every request, so changes made in the admin panel take effect immediately, without waiting for re-login.
- Permissions are free-form tags (comma-separated in the UI, `text[]` in Postgres) — there's no fixed permission list to edit in code.
- The homepage and its "Access Portal" framing are unchanged; login is now fully functional rather than decorative.
