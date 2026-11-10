# TP Notify app (timepiece-alerts)

The TP Notify web app: a phone/computer PWA that sends push alerts when club-night tickets (FIXR) go on sale, sell out or come back.
Live at https://lowballing-coding.github.io/timepiece-alerts/ via GitHub Pages from `main`. Its marketing site, sign-up and legal pages live in the sibling repo `../tp-notify-site`.

## Layout

- Plain HTML/CSS/JS, no build step, no framework, no package manager. Edit the files directly.
- `index.html` holds the markup and the styles; `app.js` is all the app logic; `sw.js` is the service worker (offline cache and push); `events.js` is shared by both (when an event is over).
- Backend is Supabase project `ddeapflekaecxqetayil` (edge functions such as `calendar` and `billing-portal`). Payments are Stripe Payment Links; spam checks are Cloudflare Turnstile. None of the backend code is in this repo.
- Only public keys belong in the code (VAPID public key, Supabase publishable key, Turnstile site key). Never add a secret key.

## Releasing: bump the version every time

Every change that ships bumps the version in two places, kept equal:
- `sw.js` line 1: `const CACHE = "timepiece-vNN";`
- `app.js`: `const APP_VERSION = NN;`

The app compares these to tell people an update is ready, so a missed bump means users keep the old version. Put the version in the commit/PR title, e.g. `Delete My Account in Settings (v93)`.

## Conventions

- Commit and PR titles are short, plain-English descriptions of what the user sees, not code terms.
- British English in all user-facing text. Title Case for buttons and setting names ("Check for Updates", "Delete My Account").
- Design system is "Afterglow": dark night colours, gold only for on sale now / live / best value, violet for anything tappable. Colours must match `../tp-notify-site/tokens.css`.
- Must work as an installed app on iPhone (Safari and Chrome), Android and desktop browsers. Watch out for in-app browsers (Instagram, Snapchat) and iOS PWA quirks.
- Anything about payments, cancellation rights or personal data has UK consumer-law and privacy implications. Keep the app's wording in step with Terms and Privacy on the website.
- Contact email is tpnotifyupdates@gmail.com.

## Checking a change

There are no tests. Preview it locally (`.claude/launch.json` serves the folder on port 8000), check it at phone width and desktop width, and check the browser console for errors. Push notifications and service-worker updates can't be fully tested locally, so say so when that matters. On localhost the Cloudflare Turnstile box shows "Unable to connect to website". That's expected (the key only allows the live domain) and isn't a bug.
