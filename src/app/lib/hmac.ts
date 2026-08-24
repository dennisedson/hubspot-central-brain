import crypto from 'crypto';

export function verifyLinearSignature(
  body: unknown,
  signature: string | undefined,
  secret: string,
): { valid: boolean; computed: string; received: string } {
  if (!signature) return { valid: false, computed: '', received: '' };
  const cleanSig = signature.replace(/^sha256=/, '').trim();
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const digest = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  let valid = false;
  try {
    valid = crypto.timingSafeEqual(
      Buffer.from(digest, 'hex'),
      Buffer.from(cleanSig, 'hex'),
    );
  } catch {
    // invalid hex
  }
  return { valid, computed: digest.slice(0, 16), received: cleanSig.slice(0, 16) };
}
