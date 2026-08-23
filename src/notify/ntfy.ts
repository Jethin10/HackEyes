import type { HttpOptions } from '../util/http.js';

/**
 * ntfy.sh delivery — no account at all: install the app, pick a hard-to-guess
 * topic, POST to it. Plain text so it reads cleanly on a lock screen.
 */

const NTFY_URL = 'https://ntfy.sh';

export interface SendResult {
  ok: boolean;
}

export async function sendNtfy(
  message: string,
  topic: string,
  opts: HttpOptions & { title?: string } = {},
): Promise<SendResult> {
  const { httpPostJson } = await import('../util/http.js');
  const res = await httpPostJson(`${NTFY_URL}/${topic}`, message, {
    ...opts,
    headers: {
      // JSON would need the "message" field; plain text keeps it simple.
      'content-type': 'text/plain',
      ...(opts.title ? { title: opts.title } : {}),
      ...(opts.headers ?? {}),
    },
  });
  return { ok: res !== null };
}
