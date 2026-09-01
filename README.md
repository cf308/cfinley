# C Finley

Static site. No build step, no backend, no dependencies.

## Structure

- `index.html` — homepage
- `portal.html` — decorative "Access Portal" login screen (no backend; nothing entered is transmitted, stored, or validated)
- `privacy.html`, `contact.html` — footer pages
- `styles.css` — shared styles

## Deploy (Vercel)

Import this repository in Vercel as a static site — no framework preset, no build command, output directory is the repo root. `vercel.json` sets clean URLs and basic security headers.
