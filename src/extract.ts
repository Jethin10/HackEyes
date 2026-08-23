import { z } from 'zod';
import type { Round } from './types.js';
import { hasExplicitOffset } from './util/time.js';
import { httpPostJson } from './util/http.js';
import { MAX_TEXT_CHARS } from './util/html.js';

/**
 * OpenCode Zen client (Part I §5). One key, one base URL, OpenAI-compatible,
 * free models. Bounded extraction task — no frontier model needed, which is
 * what makes the whole project free.
 *
 * Hard rules encoded here (Part I §5 "Extraction contract"):
 *   1. NEVER invent a date. Unstated -> null -> needs_review.
 *   2. Deliverables are quoted, not summarized.
 *
 * This module never throws: every failure mode degrades to
 * { rounds: [], confidence: 0, needs_review: true }.
 */

export const ZEN_BASE_URL = 'https://opencode.ai/zen/v1';

const SYSTEM_PROMPT = `Extract the round structure of this hackathon.
Return ONLY JSON matching this schema — no prose, no markdown fences:
{"rounds":[{"n":1,"name":"string","opens_at":"ISO-with-offset-or-null","due_at":"ISO-with-offset-or-null","submit_url":"string-or-null","deliverables":[{"id":"short-slug","label":"string","kind":"slides|video|repo|build|text|other"}]}],"confidence":0.0}

Rules:
- Every timestamp needs an explicit UTC offset. Assume IST (+05:30) only if
  the page implies India; otherwise use null.
- If a deadline is not explicitly stated, emit null. NEVER infer, estimate,
  or guess a date.
- Deliverables: quote the requirement as stated, including format constraints
  (slide counts, durations, templates). Quote, do not summarize.
- Set confidence 0-1. Below 0.6 -> needs_review must be treated as true by
  you omitting uncertain data rather than guessing.`;

/** Lenient shape check of the MODEL's JSON payload before sanitizing. */
const llmDeliverable = z.object({
  id: z.string().optional(),
  label: z.string(),
  kind: z.string().optional(),
});

const llmRound = z.object({
  n: z.number().optional(),
  name: z.string(),
  opens_at: z.string().nullable().optional(),
  due_at: z.string().nullable().optional(),
  submit_url: z.string().nullable().optional(),
  deliverables: z.array(llmDeliverable).default([]),
});

const llmPayload = z.object({
  rounds: z.array(llmRound),
  confidence: z.number().optional(),
});

const apiEnvelope = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string() }) }))
    .min(1),
});

export interface ExtractResult {
  rounds: Round[];
  confidence: number;
  needs_review: boolean;
}

export interface ExtractOptions {
  /** Injectable for tests; defaults to the shared http helper. */
  fetchImpl?: typeof fetch;
  apiKey?: string;
  timeoutMs?: number;
}

function slugify(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || '';
}

/** A date is usable ONLY if it carries an explicit offset and parses. */
function sanitizeDate(
  raw: string | null | undefined,
): { iso: string | null; invented: boolean } {
  if (raw === null || raw === undefined) return { iso: null, invented: false };
  const trimmed = raw.trim();
  if (!trimmed) return { iso: null, invented: false };
  if (!hasExplicitOffset(trimmed)) return { iso: null, invented: true };
  if (Number.isNaN(Date.parse(trimmed))) return { iso: null, invented: true };
  return { iso: trimmed, invented: false };
}

export function parseModelContent(content: string): ExtractResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('model content is not valid JSON');
  }
  const checked = llmPayload.safeParse(parsed);
  if (!checked.success) throw new Error('model JSON does not match schema');

  let needsReview = false;
  let n = 0;
  const rounds: Round[] = checked.data.rounds.map((r) => {
    n += 1;
    const opens = sanitizeDate(r.opens_at);
    const due = sanitizeDate(r.due_at);
    if (opens.invented || due.invented) needsReview = true;
    return {
      n: r.n && Number.isInteger(r.n) && r.n > 0 ? r.n : n,
      name: r.name.trim() || `Round ${n}`,
      opens_at: opens.iso,
      due_at: due.iso,
      ...(r.submit_url ? { submit_url: r.submit_url } : {}),
      result: null,
      deliverables: r.deliverables.map((d, i) => ({
        id: slugify(d.id ?? d.label) || `item-${i + 1}`,
        label: d.label.trim(),
        kind: (d.kind ?? 'other').trim().toLowerCase() || 'other',
        done: false, // fresh extraction has no history to preserve
      })),
    };
  });

  const confidenceRaw = checked.data.confidence ?? 0;
  const confidence = Math.min(Math.max(confidenceRaw, 0), 1);
  if (confidence < 0.6) needsReview = true;
  if (rounds.length === 0) needsReview = true;

  return { rounds, confidence, needs_review: needsReview };
}

async function callZen(
  pageText: string,
  sourceUrl: string,
  model: string,
  apiKey: string,
  opts: ExtractOptions,
): Promise<string | null> {
  const trimmed =
    pageText.length > MAX_TEXT_CHARS
      ? pageText.slice(0, MAX_TEXT_CHARS)
      : pageText;
  const res = await httpPostJson(
    `${ZEN_BASE_URL}/chat/completions`,
    {
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `SOURCE URL: ${sourceUrl}\n\n${trimmed}` },
      ],
    },
    {
      fetchImpl: opts.fetchImpl,
      headers: { authorization: `Bearer ${apiKey}` },
      timeoutMs: opts.timeoutMs,
    },
  );
  if (res === null) throw new Error('zen request failed');
  const envelope = apiEnvelope.safeParse(JSON.parse(res));
  if (!envelope.success) throw new Error('zen response envelope unrecognized');
  return envelope.data.choices[0]!.message.content;
}

export function extractRounds(
  pageText: string,
  sourceUrl: string,
  model: string,
  opts: ExtractOptions = {},
): Promise<ExtractResult> {
  const run = async (): Promise<ExtractResult> => {
    const apiKey = opts.apiKey ?? process.env['OPENCODE_API_KEY'] ?? '';
    if (!apiKey) {
      console.warn('extract: OPENCODE_API_KEY missing — skipping deep-parse');
      return { rounds: [], confidence: 0, needs_review: true };
    }

    // One invalid response earns exactly one retry (Part I §7/T7).
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const content = await callZen(
          pageText,
          sourceUrl,
          model,
          apiKey,
          opts,
        );
        return parseModelContent(content!);
      } catch (err) {
        console.warn(
          `extract: attempt ${attempt + 1} failed: ${(err as Error).message}`,
        );
      }
    }
    return { rounds: [], confidence: 0, needs_review: true };
  };
  return run();
}
