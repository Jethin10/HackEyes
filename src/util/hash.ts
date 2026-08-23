import { createHash } from 'node:crypto';

/** sha256 hex digest of a UTF-8 string. Gates model re-parsing (source_hash). */
export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
