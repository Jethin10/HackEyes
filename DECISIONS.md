# DECISIONS

Choices made during the build that Part I/II did not explicitly specify.
One line each: what, why, and where it lives.

1. **Repo location.** Scaffolded at `submission-window/` per §15, published to
   `github.com/Jethin10/HackEyes` (user instruction).

2. **`npm run build` = `tsc --noEmit`.** Nothing consumes emitted JS (runtime is
   `tsx`; dashboard is plain JS), so emitting `dist/` would be dead weight.

3. **Filter scoring weights.** Interest overlap ratio × 0.6 + region match 0.2 +
   mode match 0.2; unknown mode earns half credit (0.1); `passes()` is
   `score >= 0.5` exactly as contracted. Hard-fails (score 0): excluded tag,
   source not in `platforms`, prize below floor when stated, lead time below
   floor when `ends_at` known, mode outside `cfg.mode`.

4. **Online events earn "remote" region credit** even with a host city, because
   an online event is enterable from anywhere. A physical city without the word
   "India" does *not* earn "IN" credit (`\bindia\b` word match only — "Hyderabad"
   ≠ India token; avoids "in"-substring traps like "florida").

5. **Tokenized tag matching.** Sources format themes inconsistently ("AI",
   "Machine Learning/AI"); tags are split into alnum tokens before matching so
   `"Machine Learning/AI"` matches interest `ai`. Prevents "html" ⊃ "ml"
   substring false-positives by construction. (`src/filter.ts`)

6. **Tag synthesis for tag-less sources.** MLH listings carry no topic tags, so
   every MLH candidate would score ≤ 0.4 forever. The registry derives tags from
   titles via a dumb keyword regex map (ai/ml, agents, web3, fintech, devtools).
   No model involved. (`src/adapters/index.ts::synthesizeTags`, applied only to
   candidates whose source provided zero tags.)

7. **Prize currency conversion.** Devpost prizes are mostly USD. Fixed rates:
   USD→INR 90, EUR→INR 98; other currencies omit `prize_inr` entirely rather
   than misjudge the floor. Approximate by design — floors, not invoices.

8. **Devpost discovery dates are parsed at UTC midnight (`...T00:00:00Z`).**
   Devpost gives no timezone for "Jul 31 - Oct 01, 2026". These dates feed only
   lead-time filtering in discovery — never notifications — so a coarse but
   explicit offset is safe and keeps the no-naive-timestamps invariant.

9. **mergeRounds keeps more than it drops.** Existing rounds missing from
   incoming extraction are kept untouched (organizers renumber/edit pages);
   `result` always comes from existing (it's your outcome record, not page
   data); brand-new rounds force every deliverable `done:false` (only user
   history marks work done, even against a hallucinating model); a matched
   deliverable's `asset_url` falls back to the previous value when incoming
   omits one.

10. **Ladder bands, not bare thresholds.** Each urgency level fires only inside
    its own band (T−7d: 72<t≤168h, T−72h: 24<t≤72, T−24h: 6<t≤24, T−6h: 0<t≤6).
    At most one urgency nag per round per run → late registrars don't get four
    messages at once; twice-daily runs still escalate naturally. Past-due rounds
    never fire (grief ≠ action). `opens` fires only within 48h after opening.

11. **Naggable statuses = registered|active only.** Candidates have no rounds;
    done/missed/passed must stay silent. Enforced in `ladder.due`.

12. **Quiet hours evaluated in IST** (`Asia/Kolkata` via Intl) since deadlines
    and usage are India-centric; windows may wrap midnight (start > end).
    Suppressed messages are NOT recorded in the dedupe ledger, so the next run
    re-evaluates them in daylight instead of losing them forever.

13. **Urgent = T−6h only.** Final warnings break through quiet hours; everything
    else waits. Everything else can wait.

14. **Dedupe durability across the step order.** Spec order is PERSIST(6) then
    NOTIFY(7), but the ledger must survive sends or a second run re-nags.
    Resolution: persist runs where specified; after actual sends, `sent[]` is
    updated and state is saved a second time within the same run. Dry-run never
    writes. (`src/main.ts` step 7.)

15. **New-match digest.** New discoveries roll into ONE digest message (Part I
    §8: "never standalone"). Urgency nags send individually for lock-screen
    readability.

16. **Link-drop implemented as `scan.yml` dispatch input.** Part I §9 wants
    paste-a-URL tracking; the smallest honest mechanism was an optional
    `add_url` workflow input wired to `main.ts --add-url <url>`, which creates a
    manual/registered record that the same run deep-parses. No third workflow,
    no new infrastructure.

17. **ntfy topic from config OR env.** `config.notify.topic` wins over
    `NTFY_TOPIC` env (§10 shows topic in config; §16 defines the secret).
    Telegram credentials live only in env — they are true secrets. Missing
    values warn + skip, never throw.

18. **MLH scans current and next season years**, merged and de-duplicated by
    URL, because seasons span calendar years around autumn.

19. **Unstop block detection**: response null/non-JSON-ish head (`<!doctype`,
    `<html`, "just a moment", cf-challenge markers) ⇒ log `unstop: blocked`
    and return `[]`. Accepted outcome, no retries beyond http helper's own.

20. **Extraction contract injection param.** `extractRounds(pageText, sourceUrl,
    model)` gained a trailing optional `{ fetchImpl?, apiKey?, timeoutMs? }` so
    tests mock the HTTP layer without monkey-patching globals. Signature remains
    call-compatible with §17.

21. **Zen request shape.** `temperature: 0`, `response_format json_object`,
    page text capped again client-side to 30k chars, system prompt per §5 with
    explicit JSON schema echo. Invalid content gets exactly one retry (§18 T7),
    HTTP-level retries stay inside the shared http helper.

22. **Dashboard testability.** `web/app.js` exports pure render functions
    (string-in, string-out); DOM glue runs only behind a
    `typeof document !== 'undefined'` guard, so vitest covers rendering without
    a browser. `web/app.d.ts` is a minimal type shim so tsc can import the JS.

23. **State fetch path fallback.** The dashboard tries `../state.json`,
    `./state.json`, `/state.json` silently — works whether served from repo
    root (Vercel rewrite), web/ dir, or opened via a static server. Total
    failure renders a help card, never a console error storm.

24. **Vercel serving.** Deployed via Vercel CLI (project `hackeyes`, git-connected
    to Jethin10/HackEyes so every scan commit auto-redeploys the dashboard).
    vercel.json uses `outputDirectory: "."` (framework-less static) plus
    rewrites `/` → `/web/index.html` and `/app.js` → `/web/app.js` so the page
    works at both entry points while `/state.json` stays fetchable. Two gotchas
    hit live: Vercel Authentication (SSO protection) defaults ON for new
    projects — disabled via API so the tracker is publicly readable; and
    `cleanUrls: true` compiles broken backslash overrides for `.html` files on
    Windows, so it was dropped. Live at https://hackeyes.vercel.app

25. **`.gitattributes` forces LF** — `state.json` diffs are the audit log;
    CRLF churn on Windows would make them unreadable.

26. **engines.node >=22** while local verification ran on Node 25 — the CI
    workflow pins Node 22 LTS as specified; no version-specific APIs used
    beyond standard `fetch`/`AbortController`.
