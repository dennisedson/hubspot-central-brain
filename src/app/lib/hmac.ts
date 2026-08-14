import crypto from 'crypto';

export function verifyLinearSignature(
  body: unknown,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) return false;
  // Strip any prefix (e.g. "sha256=") and whitespace
  const cleanSig = signature.replace(/^sha256=/, '').trim();
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const digest = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  console.log('[hmac] computed:', digest.slice(0, 8), '... received:', cleanSig.slice(0, 8), '...');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(digest, 'hex'),
      Buffer.from(cleanSig, 'hex'),
    );
  } catch {
    return false;
  }
}
