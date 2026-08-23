/**
 * Type surface of web/app.js for TypeScript consumers (tests).
 * The implementation intentionally stays dependency-free vanilla JS.
 */
export declare function esc(s: unknown): string;

export declare function countdown(
  dueIso: string,
  nowMs: number,
): { text: string; cls: string };

export interface DashHackathon {
  id?: string;
  name?: string;
  status?: string;
  url?: string;
  source?: string;
  mode?: string;
  location?: string;
  prize_inr?: number;
  tags?: string[];
  rounds?: Array<{
    n?: number;
    name?: string;
    due_at?: string | null;
    submit_url?: string;
    result?: string | null;
    deliverables?: Array<{ id: string; label: string; done: boolean }>;
  }>;
}

export declare function nextUp(
  hackathons: DashHackathon[],
  nowMs: number,
):
  | { h: DashHackathon; round: NonNullable<DashHackathon['rounds']>[number]; dueMs: number }
  | null;

export declare function renderApp(state: unknown, nowMs?: number): string;
