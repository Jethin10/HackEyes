import { z } from 'zod';

// ---------------------------------------------------------------------------
// Static types (Part II §17). The zod schemas below are typed against these,
// so any drift between schema and interface is a compile error.
// ---------------------------------------------------------------------------

export type Status =
  | 'candidate'
  | 'registered'
  | 'active'
  | 'done'
  | 'missed'
  | 'passed';

export type Mode = 'online' | 'onsite' | 'hybrid';

export interface Deliverable {
  /** Stable slug: "deck", "video", "repo". */
  id: string;
  /** Quoted from the source, not summarized. */
  label: string;
  /** slides | video | repo | build | text | other */
  kind: string;
  done: boolean;
  asset_url?: string;
}

export interface Round {
  n: number;
  name: string;
  /** ISO 8601 WITH explicit UTC offset, or null. Never a naive local time. */
  opens_at: string | null;
  due_at: string | null;
  submit_url?: string;
  result: null | 'advanced' | 'eliminated';
  deliverables: Deliverable[];
}

export interface Hackathon {
  id: string;
  name: string;
  organizer?: string;
  source: string;
  url: string;
  detected_by: 'discovery' | 'email' | 'manual';
  status: Status;
  mode?: Mode;
  location?: string;
  team_size?: [number, number];
  tags: string[];
  prize_inr?: number;
  registered_at?: string;
  rounds: Round[];
  extraction?: {
    model: string;
    confidence: number;
    needs_review: boolean;
    parsed_at: string;
  };
  /** sha256 of the stripped detail page; gates re-parsing. */
  source_hash?: string;
  last_seen: string;
  /**
   * Dedupe ledger for sent notifications, entries shaped "r2:T-72h".
   * Added in T10 — see Part I §7 step 5.
   */
  sent?: string[];
}

/** What an adapter returns. Deliberately thin — no model involved. */
export interface Candidate {
  source: string;
  name: string;
  url: string;
  tags: string[];
  mode?: Mode;
  location?: string;
  starts_at?: string | null;
  ends_at?: string | null;
  prize_inr?: number;
}

/** User preferences (Part I §10). One file, edited rarely. */
export interface Config {
  interests: string[];
  exclude: string[];
  mode: Mode[];
  regions: string[];
  team_size: { min: number; max: number };
  min_prize_inr: number;
  min_lead_days: number;
  platforms: string[];
  notify: {
    channel: 'ntfy' | 'telegram';
    topic?: string;
    quiet_hours?: [number, number];
  };
  model: string;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const isoWithOffset = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/,
    'must be ISO 8601 with an explicit UTC offset (e.g. 2026-09-02T23:59:00+05:30)',
  );

export const zDeliverable: z.ZodType<Deliverable> = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.string().min(1),
  done: z.boolean(),
  asset_url: z.string().optional(),
});

export const zRound: z.ZodType<Round> = z.object({
  n: z.number().int().positive(),
  name: z.string().min(1),
  // A timestamp without an explicit offset must NEVER enter state.json.
  opens_at: z.union([isoWithOffset, z.null()]),
  due_at: z.union([isoWithOffset, z.null()]),
  submit_url: z.string().optional(),
  result: z.union([z.null(), z.literal('advanced'), z.literal('eliminated')]),
  deliverables: z.array(zDeliverable),
});

export const zHackathon: z.ZodType<Hackathon> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  organizer: z.string().optional(),
  source: z.string().min(1),
  url: z.string().url(),
  detected_by: z.enum(['discovery', 'email', 'manual']),
  status: z.enum([
    'candidate',
    'registered',
    'active',
    'done',
    'missed',
    'passed',
  ]),
  mode: z.enum(['online', 'onsite', 'hybrid']).optional(),
  location: z.string().optional(),
  team_size: z.tuple([z.number(), z.number()]).optional(),
  tags: z.array(z.string()),
  prize_inr: z.number().optional(),
  registered_at: z.string().optional(),
  rounds: z.array(zRound),
  extraction: z
    .object({
      model: z.string(),
      confidence: z.number().min(0).max(1),
      needs_review: z.boolean(),
      parsed_at: z.string(),
    })
    .optional(),
  source_hash: z.string().optional(),
  last_seen: z.string(),
  sent: z.array(z.string()).optional(),
});

export const zCandidate: z.ZodType<Candidate> = z.object({
  source: z.string().min(1),
  name: z.string().min(1),
  url: z.string().url(),
  tags: z.array(z.string()),
  mode: z.enum(['online', 'onsite', 'hybrid']).optional(),
  location: z.string().optional(),
  starts_at: z.string().nullable().optional(),
  ends_at: z.string().nullable().optional(),
  prize_inr: z.number().optional(),
});

export const zConfig: z.ZodType<Config> = z.object({
  interests: z.array(z.string()),
  exclude: z.array(z.string()),
  mode: z.array(z.enum(['online', 'onsite', 'hybrid'])),
  regions: z.array(z.string()),
  team_size: z.object({ min: z.number(), max: z.number() }),
  min_prize_inr: z.number(),
  min_lead_days: z.number(),
  platforms: z.array(z.string()),
  notify: z.object({
    channel: z.enum(['ntfy', 'telegram']),
    topic: z.string().optional(),
    quiet_hours: z.tuple([z.number(), z.number()]).optional(),
  }),
  model: z.string().min(1),
});

const zState = z.object({ hackathons: z.array(zHackathon) });

/**
 * Validates the raw contents of state.json and returns the hackathon list.
 * Throws with a readable message listing every problem found — a corrupt
 * database must be loud, not silent.
 */
export function parseState(raw: unknown): Hackathon[] {
  const res = zState.safeParse(raw);
  if (!res.success) {
    const issues = res.error.issues
      .map((i) => `  - at ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`state.json failed validation:\n${issues}`);
  }
  return res.data.hackathons;
}
