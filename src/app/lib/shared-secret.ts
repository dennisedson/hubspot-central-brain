import crypto from 'crypto';

// Constant-time comparison of a provided secret against the expected secret.
// Both inputs are hashed to a fixed-length digest first so that timingSafeEqual
// can be used even when the inputs differ in length (it throws on length
// mismatch otherwise) without leaking length information via timing.
export function verifySharedSecret(
  provided: string | undefined,
  expected: string | undefined,
): boolean {
  if (!provided || !expected) return false;
  const providedHash = crypto.createHash('sha256').update(provided).digest();
  const expectedHash = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(providedHash, expectedHash);
}
