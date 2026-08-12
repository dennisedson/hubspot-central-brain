import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { verifyLinearSignature } from '@lib/hmac';

const SECRET = 'test-secret-32-chars-xxxxxxxxxx';

function sign(body: unknown, secret: string): string {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

describe('verifyLinearSignature', () => {
  it('returns true for a valid signature over an object body', () => {
    const body = { action: 'create', type: 'Issue', data: { id: 'lin-1' } };
    expect(verifyLinearSignature(body, sign(body, SECRET), SECRET)).toBe(true);
  });

  it('returns false when signature does not match', () => {
    const body = { action: 'create' };
    expect(verifyLinearSignature(body, 'a'.repeat(64), SECRET)).toBe(false);
  });

  it('returns false when signature is undefined', () => {
    expect(verifyLinearSignature({}, undefined, SECRET)).toBe(false);
  });

  it('returns false for malformed hex (odd-length)', () => {
    expect(verifyLinearSignature({}, 'abc', SECRET)).toBe(false);
  });

  it('handles a raw string body', () => {
    const body = '{"foo":"bar"}';
    expect(verifyLinearSignature(body, sign(body, SECRET), SECRET)).toBe(true);
  });
});
