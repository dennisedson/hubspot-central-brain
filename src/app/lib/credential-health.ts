/**
 * Is each external credential still alive?
 *
 * Nothing in this project would notice a credential dying. Preflight runs
 * thirteen checks and every one is structural — object ids, pipelines, stages,
 * properties. A revoked key passes all of them, and the first anyone hears is
 * a confusing error from whoever happens to use the feature next.
 *
 * That has already happened three times: the HubSpot service key died silently
 * and took a day to find, the YouTube refresh token came back "Token has been
 * expired or revoked", and ANTHROPIC_API_KEY turned out to be invalid in
 * .env and on both portals at once — unnoticed because the card that uses it
 * was the first thing ever to call Anthropic for real.
 *
 * Each probe is the cheapest authenticated call the API offers, and reports
 * only a verdict. No credential value is ever returned, logged, or echoed.
 */

export type CredentialStatus = 'ok' | 'invalid' | 'unconfigured' | 'error';

export interface CredentialCheck {
  name: string;
  status: CredentialStatus;
  /** Short, safe-to-display reason. Never contains the credential. */
  detail: string;
  /** HTTP status where there was one, for telling 401 apart from 500. */
  httpStatus?: number;
}

/** Distinguishes "they rejected us" from "we could not reach them". */
export function classify(httpStatus: number): CredentialStatus {
  if (httpStatus === 401 || httpStatus === 403) return 'invalid';
  if (httpStatus >= 200 && httpStatus < 300) return 'ok';
  return 'error';
}

/**
 * An HTML body means the host answered as a website, not an API.
 *
 * `<!doctype html>` truncated to 140 characters tells nobody anything. It
 * usually means the base URL is wrong or the API has moved — a different
 * problem from a rejected credential, and one that would otherwise be read as
 * "the key is broken" and send someone to rotate a key that is fine.
 */
export function looksLikeHtml(body: string): boolean {
  return /^\s*<(!doctype|html)\b/i.test(body);
}

/**
 * Truncated and stripped of anything that looks like a token.
 *
 * A failing provider often echoes the request back, so the body is not
 * automatically safe to surface.
 */
export function safeDetail(body: string, limit = 140): string {
  if (looksLikeHtml(body)) {
    return 'endpoint returned HTML, not an API response — the base URL may have moved';
  }
  return body
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|lin_api_[A-Za-z0-9]{8,}|pat-[A-Za-z0-9-]{8,}|[A-Za-z0-9_-]{40,})\b/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

/** Runs a probe, turning any throw into a result rather than failing the batch. */
export async function probe(
  name: string,
  secret: string | undefined,
  call: (secret: string) => Promise<{ status: number; body: string }>,
): Promise<CredentialCheck> {
  if (!secret) {
    return { name, status: 'unconfigured', detail: 'not set on this portal' };
  }
  try {
    const { status, body } = await call(secret);
    const verdict = classify(status);
    return {
      name,
      status: verdict,
      httpStatus: status,
      detail: verdict === 'ok' ? 'authenticated' : safeDetail(body),
    };
  } catch (err) {
    return {
      name,
      status: 'error',
      detail: safeDetail(err instanceof Error ? err.message : String(err)),
    };
  }
}

/** The whole batch's verdict: anything not ok or unconfigured is a failure. */
export function overallStatus(checks: CredentialCheck[]): 'ok' | 'degraded' {
  return checks.some(c => c.status === 'invalid' || c.status === 'error') ? 'degraded' : 'ok';
}
