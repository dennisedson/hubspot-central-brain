import { describe, it, expect } from 'vitest';
import { verifySharedSecret } from '@lib/shared-secret';

describe('verifySharedSecret', () => {
  it('returns true when the provided secret matches the expected secret', () =>
    expect(verifySharedSecret('top-secret', 'top-secret')).toBe(true));

  it('returns false when the secrets differ', () =>
    expect(verifySharedSecret('wrong', 'top-secret')).toBe(false));

  it('returns false for secrets of differing length', () =>
    expect(verifySharedSecret('top-secret-longer', 'top-secret')).toBe(false));

  it('returns false when the provided secret is undefined', () =>
    expect(verifySharedSecret(undefined, 'top-secret')).toBe(false));

  it('returns false when the expected secret is undefined', () =>
    expect(verifySharedSecret('top-secret', undefined)).toBe(false));

  it('returns false when the provided secret is empty', () =>
    expect(verifySharedSecret('', 'top-secret')).toBe(false));
});
