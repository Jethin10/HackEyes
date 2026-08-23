import type { Candidate } from '../types.js';
import { devpostAdapter } from './devpost.js';
import { mlhAdapter } from './mlh.js';
import { devfolioAdapter } from './devfolio.js';
import { unstopAdapter } from './unstop.js';

/**
 * Adapter registry (Part I §4). Each source is isolated behind one interface;
 * when Unstop breaks, the other three keep running and the failure is one
 * red line in the log — never a dead tracker.
 */

export interface Adapter {
  name: string;
  fetchListings(): Promise<Candidate[]>;
}

export function buildAdapters(): Adapter[] {
  return [
    devpostAdapter(),
    mlhAdapter(),
    devfolioAdapter(),
    unstopAdapter(),
  ];
}

export const adapters: Adapter[] = buildAdapters();

/**
 * Dumb, deterministic keyword synthesis for listings that carry no topic
 * tags (MLH season data has none). Without this, every MLH event would
 * score below the filter's bar forever. No model involved.
 */
const KEYWORDS: Array<[RegExp, string[]]> = [
  [/a\.?i\b|artificial intelligence|machine learning|deep learning|gen ?ai|\bllms?\b/i, ['ai', 'ml']],
  [/\bagents?\b|agentic/i, ['agents']],
  [/web ?3|blockchain|crypto|nft|solana|ethereum/i, ['web3']],
  [/fintech|fin-?tech|finance|payments?|banking|trading/i, ['fintech']],
  [/dev ?tools|developer tools|developer experience|open source|\bapis?\b|\bcli\b/i, ['devtools']],
];

export function synthesizeTags(name: string): string[] {
  const tags = new Set<string>();
  for (const [pattern, mapped] of KEYWORDS) {
    if (pattern.test(name)) {
      for (const t of mapped) tags.add(t);
    }
  }
  return [...tags];
}

function normalize(c: Candidate): Candidate {
  return c.tags.length > 0 ? c : { ...c, tags: synthesizeTags(c.name) };
}

/**
 * Runs every adapter. One failing adapter must NOT abort the others — its
 * name lands in `failures` and everything else still flows.
 */
export async function fetchAllFrom(
  list: Adapter[],
): Promise<{ candidates: Candidate[]; failures: string[] }> {
  const settled = await Promise.allSettled(list.map((a) => a.fetchListings()));
  const candidates: Candidate[] = [];
  const failures: string[] = [];
  settled.forEach((r, i) => {
    const name = list[i]!.name;
    if (r.status === 'fulfilled') {
      candidates.push(...r.value.map(normalize));
    } else {
      console.warn(`${name}: adapter rejected: ${String(r.reason)}`);
      failures.push(name);
    }
  });
  return { candidates, failures };
}

export function fetchAll(): Promise<{
  candidates: Candidate[];
  failures: string[];
}> {
  return fetchAllFrom(adapters);
}
