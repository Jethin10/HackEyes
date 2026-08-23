/**
 * Submission Window dashboard — plain vanilla JS, no build step.
 * Renders state.json. Read-only apart from links (Part I §9 / T13).
 *
 * Render functions are pure and exported so vitest can cover them without a
 * browser; the DOM glue at the bottom only runs where `document` exists.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function esc(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** "2d 4h" style countdown plus an urgency class. */
export function countdown(dueIso, nowMs) {
  const t = new Date(dueIso).getTime() - nowMs;
  if (!Number.isFinite(t)) return { text: '', cls: 'u-ok' };
  if (t <= 0) return { text: 'closed', cls: 'u-danger' };
  const d = Math.floor(t / DAY);
  const h = Math.floor((t % DAY) / HOUR);
  const m = Math.floor((t % HOUR) / 60000);
  const text = d > 0 ? `in ${d}d ${h}h` : h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
  const cls = t <= 6 * HOUR ? 'u-danger' : t <= 72 * HOUR ? 'u-warn' : 'u-ok';
  return { text, cls };
}

function openItems(round) {
  return round.deliverables.filter((d) => !d.done);
}

/** The single most urgent round with open items across registered/active. */
export function nextUp(hackathons, nowMs) {
  let best = null;
  for (const h of hackathons) {
    if (h.status !== 'registered' && h.status !== 'active') continue;
    for (const round of h.rounds ?? []) {
      if (round.result === 'eliminated') continue;
      if (!round.due_at) continue;
      if (openItems(round).length === 0) continue;
      const due = new Date(round.due_at).getTime();
      if (due <= nowMs) continue; // past is grief, not action
      if (!best || due < best.dueMs) best = { h, round, dueMs: due };
    }
  }
  return best;
}

function checklist(deliverables) {
  return `<ul class="checklist">${deliverables
    .map(
      (d) =>
        `<li${d.done ? ' class="done"' : ''}>${esc(d.label)}</li>`,
    )
    .join('')}</ul>`;
}

function renderNextUp(state, nowMs) {
  const next = nextUp(state.hackathons ?? [], nowMs);
  if (!next) {
    return '<section id="next-up"><div class="card quiet-note">Nothing due — enjoy the silence.</div></section>';
  }
  const { text, cls } = countdown(next.round.due_at, nowMs);
  const submit = next.round.submit_url
    ? `<a class="submitlink" href="${esc(next.round.submit_url)}">Submit &rarr; ${esc(
        String(next.round.submit_url).replace(/^https?:\/\//, ''),
      )}</a>`
    : '';
  return `<section id="next-up">
    <div class="card nextup ${cls}">
      <div class="event">${esc(next.h.name)}</div>
      <div class="round">Round ${next.round.n} &ldquo;${esc(next.round.name)}&rdquo;</div>
      <div class="due">Closes ${new Date(next.round.due_at).toLocaleString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })} &mdash; <span class="in">${text}</span></div>
      ${checklist(openItems(next.round))}
      ${submit}
    </div>
  </section>`;
}

function renderBoard(state, nowMs) {
  const active = (state.hackathons ?? []).filter(
    (h) => h.status === 'registered' || h.status === 'active',
  );
  if (active.length === 0) {
    return '<section id="board"><p class="empty">No active hackathons yet. Registered for one?\n      Actions → <strong>scan</strong> → paste its URL into <strong>add_url</strong> — it lands here with\n      every round deadline and deliverable extracted.</p></section>';
  }
  const cards = active
    .map((h) => {
      const rail = (h.rounds ?? [])
        .map((r) => {
          const open = openItems(r).length;
          const total = r.deliverables.length;
          const cd = r.due_at ? countdown(r.due_at, nowMs) : null;
          const when = cd && cd.text !== 'closed' ? ` · ${cd.text}` : '';
          return `<li><span class="n">${r.n}</span><span class="rname">${esc(
            r.name,
          )}${when}<span class="chips">${r.deliverables
            .map(
              (d) =>
                `<span class="chip${d.done ? '' : ' open'}">${esc(d.id)}</span>`,
            )
            .join('')}</span></span></li>`;
        })
        .join('');
      const meta = [
        h.mode,
        h.location,
        h.prize_inr
          ? `₹${Intl.NumberFormat('en-IN').format(h.prize_inr)}`
          : null,
      ]
        .filter(Boolean)
        .map(esc)
        .join(' · ');
      return `<div class="card">
        <div class="event"><a href="${esc(h.url)}">${esc(h.name)}</a></div>
        <div class="meta">${meta || esc(h.source)}</div>
        <ol class="rail" style="list-style:none">${rail}</ol>
      </div>`;
    })
    .join('');
  return `<section id="board"><div class="board">${cards}</div></section>`;
}

function renderFeed(state) {
  const candidates = (state.hackathons ?? []).filter(
    (h) => h.status === 'candidate',
  );
  if (candidates.length === 0) {
    return '<section id="feed"><p class="empty">No new matches in the discovery feed.</p></section>';
  }
  const rows = candidates
    .map(
      (h) => `<div class="card">
        <div class="event"><a href="${esc(h.url)}">${esc(h.name)}</a></div>
        <div class="meta">${esc([h.source, h.location].filter(Boolean).join(' · '))}</div>
        ${
          h.tags?.length
            ? `<div class="tagrow">${h.tags
                .map((t) => `<span class="chip">${esc(t)}</span>`)
                .join('')}</div>`
            : ''
        }
      </div>`,
    )
    .join('');
  return `<section id="feed"><p class="feednote">Found <em>for</em> you — you haven't registered for these.
    Interested? Sign up on its page, then track it via <strong>Actions → scan → add_url</strong>
    so it moves to your Active board.</p><div class="board">${rows}</div></section>`;
}

function renderReview(state) {
  const flagged = (state.hackathons ?? []).filter(
    (h) =>
      h.extraction?.needs_review === true ||
      ((h.status === 'registered' || h.status === 'active') &&
        (h.rounds ?? []).length === 0),
  );
  if (flagged.length === 0) {
    return '<section id="review" hidden><h2>Needs review</h2></section>';
  }
  const rows = flagged
    .map((h) => {
      const reason =
        h.extraction?.needs_review
          ? `low extraction confidence (${Math.round(
              (h.extraction.confidence ?? 0) * 100,
            )}%) or a missing date`
          : 'no rounds extracted yet';
      return `<li>${esc(h.name)} — ${reason}. <a href="${esc(h.url)}">Check the page</a>, then tick or fix via Actions.</li>`;
    })
    .join('');
  return `<section id="review">
    <h2>Needs review</h2>
    <div class="card"><ul>${rows}</ul></div>
  </section>`;
}

function renderAddLink() {
  return `<section id="add-link">
    <h2>Add by link</h2>
    <div class="card">
      Paste any hackathon URL into <strong>Actions → scan → Run workflow →
      add_url</strong>. It gets registered and deep-parsed on the next run —
      the escape hatch for WhatsApp-group finds on sites no adapter covers.
    </div>
  </section>`;
}

/** Full page body from parsed state.json. Pure. */
export function renderApp(state, nowMs = Date.now()) {
  const updated = state.generated_note
    ? esc(state.generated_note)
    : `${(state.hackathons ?? []).length} event(s) tracked`;
  return `
    <h2>Next up</h2>
    ${renderNextUp(state, nowMs)}
    <h2>Active board</h2>
    ${renderBoard(state, nowMs)}
    <h2>Discovery feed</h2>
    ${renderFeed(state)}
    ${renderReview(state)}
    ${renderAddLink()}
  `.trim();
}

async function loadState() {
  // Works served from repo root (/state.json), web/ dir (../state.json),
  // or a copied sibling (./state.json). Silent fallbacks by design.
  for (const path of ['../state.json', './state.json', '/state.json']) {
    try {
      const res = await fetch(path);
      if (res.ok) return await res.json();
    } catch {
      // try next path
    }
  }
  return null;
}

if (typeof document !== 'undefined') {
  const app = document.getElementById('app');
  loadState()
    .then((state) => {
      if (!state) {
        app.innerHTML =
          '<div class="card">Could not load <code>state.json</code>. Serve the repo root over HTTP (e.g. <code>npx serve</code>) or deploy per README.</div>';
        return;
      }
      app.innerHTML = renderApp(state);
      const stamp = document.getElementById('updated');
      if (stamp) stamp.textContent = `${(state.hackathons ?? []).length} event(s) tracked`;
    })
    .catch(() => {
      app.innerHTML = '<div class="card">Failed to render the dashboard.</div>';
    });
}
