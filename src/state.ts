import { readFile, writeFile } from 'node:fs/promises';
import type { Deliverable, Hackathon, Round } from './types.js';
import { parseState } from './types.js';

/**
 * Loads and validates state.json. A missing file is an empty database,
 * not an error — first run must work out of the box. A corrupt file is
 * loud (parseState throws with a readable message).
 */
export async function load(path: string): Promise<Hackathon[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  return parseState(JSON.parse(raw));
}

/**
 * Pretty-printed, 2-space, trailing newline. The git diff of this file IS
 * the audit log — keep it clean and reviewable.
 */
export async function save(path: string, list: Hackathon[]): Promise<void> {
  await writeFile(path, JSON.stringify({ hackathons: list }, null, 2) + '\n', 'utf8');
}

/**
 * THE RULE THAT PROTECTS YOU (Part I §7): merges freshly-extracted
 * deliverables into an existing list. `done:true` survives every re-parse;
 * a re-parse must never silently un-check finished work.
 *
 * - Match by id. Take label/kind/asset_url from incoming (freshest truth),
 *   falling back to the previous asset_url when incoming omits one.
 * - `done` ALWAYS comes from existing when the id existed before.
 * - Unknown ids arrive with done:false — only your own history can mark
 *   work complete, never a page re-parse.
 * - Deliverables that vanish from incoming are KEPT: organizers edit pages
 *   carelessly, and dropping a completed item is worse than keeping a
 *   stale one.
 */
function mergeDeliverables(
  existing: Deliverable[],
  incoming: Deliverable[],
): Deliverable[] {
  const byId = new Map(existing.map((d) => [d.id, d]));
  const merged: Deliverable[] = incoming.map((inc) => {
    const prev = byId.get(inc.id);
    if (!prev) return { ...inc, done: false };
    return { ...inc, done: prev.done, asset_url: inc.asset_url ?? prev.asset_url };
  });
  const incomingIds = new Set(incoming.map((d) => d.id));
  for (const prev of existing) {
    if (!incomingIds.has(prev.id)) merged.push(prev);
  }
  return merged;
}

/**
 * Merges freshly-extracted rounds into an existing hackathon's rounds.
 * - Match rounds by `n`; deliverables inside via mergeDeliverables.
 * - `result` is yours, not the page's — always preserved from existing.
 * - Existing rounds missing from incoming are KEPT (same reasoning as
 *   deliverables), then everything is returned sorted by `n`.
 */
export function mergeRounds(existing: Round[], incoming: Round[]): Round[] {
  const byN = new Map(existing.map((r) => [r.n, r]));

  const merged: Round[] = incoming.map((inc) => {
    const prev = byN.get(inc.n);
    if (!prev) {
      // Brand-new round: no history exists, nothing can be done yet.
      return {
        ...inc,
        deliverables: inc.deliverables.map((d) => ({ ...d, done: false })),
      };
    }
    return {
      ...inc,
      result: prev.result,
      deliverables: mergeDeliverables(prev.deliverables, inc.deliverables),
    };
  });

  const incomingNs = new Set(incoming.map((r) => r.n));
  for (const prev of existing) {
    if (!incomingNs.has(prev.n)) merged.push(prev);
  }

  return merged.sort((a, b) => a.n - b.n);
}
