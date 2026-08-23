/**
 * One-tap "I did it" endpoint.
 *
 * POST /api/tick   body: { hackathon_id, deliverable_id }  ("ALL" supported)
 * Header/Query:    x-tick-key: <TICK_KEY>  (shared secret — this is a
 *                  single-user tracker, the key is what keeps strangers out)
 *
 * Dispatches the tick.yml GitHub workflow, which flips the deliverable in
 * state.json, commits (audit log), and the commit auto-redeploys this very
 * dashboard. Expect ~1–2 minutes from tap to visible.
 */

export const config = { maxDuration: 15 };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  const key = req.headers['x-tick-key'] || req.query.key || '';
  if (!process.env.TICK_KEY || key !== process.env.TICK_KEY) {
    res.status(401).json({ error: 'invalid or missing tick key' });
    return;
  }

  const { hackathon_id, deliverable_id } = req.body ?? {};
  if (!hackathon_id || !deliverable_id) {
    res
      .status(400)
      .json({ error: 'hackathon_id and deliverable_id are required' });
    return;
  }

  const repo = process.env.GH_REPO;
  const token = process.env.GH_TOKEN;
  if (!repo || !token) {
    res.status(500).json({ error: 'server not configured (GH_REPO/GH_TOKEN)' });
    return;
  }

  try {
    const r = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/tick.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          ref: 'main',
          inputs: {
            hackathon_id: String(hackathon_id),
            deliverable_id: String(deliverable_id),
          },
        }),
      },
    );
    if (!r.ok) {
      const detail = await r.text();
      res
        .status(502)
        .json({ error: `github dispatch failed (${r.status})`, detail });
      return;
    }
    res.status(200).json({
      ok: true,
      note: 'queued — refresh in ~1-2 min once the workflow commits state.json',
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}
