import crypto from 'crypto';

export function verifyLinearSignature(
  body: unknown,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) return false;
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const digest = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(digest, 'hex'),
      Buffer.from(signature, 'hex'),
    );
  } catch {
    // Buffer.from throws if signature is not valid hex
    return false;
  }
}
