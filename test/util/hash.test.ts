import { describe, expect, it } from 'vitest';
import { sha256 } from '../../src/util/hash.js';

describe('sha256', () => {
  it('matches the known digest of "abc"', () => {
    expect(sha256('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('is deterministic and hex-encoded', () => {
    const a = sha256('state payload');
    const b = sha256('state payload');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs when input differs by one character', () => {
    expect(sha256('rounds v1')).not.toBe(sha256('rounds v2'));
  });
});
