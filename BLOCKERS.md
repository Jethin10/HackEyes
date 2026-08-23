# BLOCKERS

Tasks that failed three times, or external services that misbehaved during the
build. Per §13: written down honestly, never blocking the rest of the build.

---

## BLOCKER-1 — Devfolio public listing API unavailable

- **Task:** T6 (adapters)
- **Symptom:** Every known Devfolio API path answers
  `{"error":{"type":"NotFoundError","status":404,...}}`:
  - `GET  https://api.devfolio.co/api/v2/hackathons`
  - `GET  https://api.devfolio.co/api/v2/hackathons/search`
  - `POST https://api.devfolio.co/api/v2/hackathons/search`
    (tried with browser-like User-Agent, `Origin: https://devfolio.co`,
    `Referer: https://devfolio.co/hackathons`)
  The devfolio.co SPA itself is client-rendered and serves no usable listing
  JSON to plain fetches.
- **What we tried:** the three endpoints above with and without browser headers.
- **Resolution:** adapter shipped anyway (`src/adapters/devfolio.ts`) against
  Devfolio's documented v2 search response shape, covered offline by
  `fixtures/devfolio-search.json` (tolerant parser accepts `hackathons`, `data`,
  `results`, or a bare array). Live discovery from Devfolio currently logs one
  warning and contributes zero candidates — an accepted outcome per Part I §4,
  since link-drop covers anything you register for manually.
- **Unblock condition:** when Devfolio exposes a public listing endpoint again,
  update `SEARCH_URL` / parser fields; tests already pin the response shape.

## BLOCKER-2 — Unstop blocked by Cloudflare (expected, accepted)

- **Task:** T6 verification run (`npm run scan:dry`)
- **Symptom:** server-side fetch of
  `https://unstop.com/api/public/hackathons` returns challenge content;
  adapter logged `unstop: blocked` exactly as designed and returned `[]`.
- **What we tried:** plain server-side fetch with realistic headers (the
  spec's fallback #1). Per §18 T6: no headless browser, ≤3 attempts, move on.
- **Impact:** none for the product — registered events arrive via link-drop /
  inbox (Phase 3), and the other adapters kept running (74 candidates in the
  same run).
- **Standing mitigation:** the inbox route (Phase 3) makes Unstop scraping
  unnecessary for events you actually enter.

---

Nothing else failed three times. All fourteen tasks completed green.
