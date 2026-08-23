import type { Candidate, Config } from './types.js';

/**
 * Candidate scoring — deliberately dumb, fast, free, debuggable (Part I §10).
 * No model involved. Hard filters encode stated preferences ("exclude",
 * floors); the remaining score is plain weighted overlap.
 *
 * Score components (total 0..1):
 *   - interest tag overlap ratio            × 0.6
 *   - region match                          × 0.2
 *   - mode match (unknown mode: half credit)× 0.2
 *
 * Hard fails return 0 immediately:
 *   - any excluded tag (this beats ANY amount of overlap)
 *   - source platform not enabled
 *   - lead time below min_lead_days (too close to enter)
 *   - prize below min_prize_inr
 *   - mode outside cfg.mode (e.g. onsite-only when you want online)
 */

const INTEREST_WEIGHT = 0.6;
const REGION_WEIGHT = 0.2;
const MODE_WEIGHT = 0.2;

/**
 * Region tokens get light normalization: bare country codes are ambiguous as
 * substrings ("in" matches "florida"), so they map to word-boundary patterns;
 * "remote" also accepts online-mode events with no physical location.
 */
const REGION_PATTERNS: Record<string, RegExp> = {
  in: /\bindia\b/i,
  india: /\bindia\b/i,
  remote:
    /\bremote\b|\bonline\b|\bvirtual\b|\bworldwide\b|\beverywhere\b|\bglobal\b/i,
};

export function regionMatches(
  location: string | undefined,
  mode: Candidate['mode'],
  regions: string[],
): boolean {
  const loc = location ?? '';
  return regions.some((raw) => {
    const r = raw.trim().toLowerCase();
    const pattern = REGION_PATTERNS[r];
    if (pattern) {
      return pattern.test(loc) || (r === 'remote' && mode === 'online');
    }
    return loc.toLowerCase().includes(r);
  });
}

export function score(
  c: Candidate,
  cfg: Config,
  now: Date = new Date(),
): number {
  const tags = c.tags.map((t) => t.trim().toLowerCase());
  const exclude = new Set(cfg.exclude.map((t) => t.trim().toLowerCase()));

  // --- hard filters -------------------------------------------------------
  if (tags.some((t) => exclude.has(t))) return 0;
  if (!cfg.platforms.includes(c.source)) return 0;

  if (
    c.prize_inr !== undefined &&
    c.prize_inr !== null &&
    c.prize_inr < cfg.min_prize_inr
  ) {
    return 0;
  }

  if (c.ends_at) {
    const endMs = Date.parse(c.ends_at);
    if (!Number.isNaN(endMs)) {
      const leadDays = (endMs - now.getTime()) / 86_400_000;
      if (leadDays < cfg.min_lead_days) return 0;
    }
  }

  if (c.mode && !cfg.mode.includes(c.mode)) return 0;

  // --- soft score ---------------------------------------------------------
  const interests = new Set(cfg.interests.map((t) => t.trim().toLowerCase()));
  let overlap = 0;
  for (const t of new Set(tags)) {
    if (interests.has(t)) overlap++;
  }
  const overlapRatio =
    interests.size === 0 ? 0 : Math.min(overlap / interests.size, 1);

  const regionScore = regionMatches(c.location, c.mode, cfg.regions)
    ? REGION_WEIGHT
    : 0;

  let modeScore: number;
  if (!c.mode) {
    modeScore = MODE_WEIGHT / 2; // unknown: don't punish, don't reward
  } else {
    modeScore = cfg.mode.includes(c.mode) ? MODE_WEIGHT : 0;
  }

  return overlapRatio * INTEREST_WEIGHT + regionScore + modeScore;
}

export function passes(
  c: Candidate,
  cfg: Config,
  now: Date = new Date(),
): boolean {
  return score(c, cfg, now) >= 0.5;
}
