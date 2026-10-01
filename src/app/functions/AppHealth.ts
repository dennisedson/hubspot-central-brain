import { verifySharedSecret } from '../lib/shared-secret';
import { probe, overallStatus, type CredentialCheck } from '../lib/credential-health';
import { getPortalConfig } from '../lib/portal-config';
import { HS_BASE, objectSearchPath } from '../lib/hs-api';

/**
 * Whether this portal's credentials still work.
 *
 * Checked from inside the app on purpose. The credentials live in four
 * separate homes — `hs secrets`, `hs app secret`, local `.env` and GitHub
 * environment secrets — and validating a copy in CI proves nothing about the
 * one the running functions actually use. This probes the secrets the portal
 * itself holds.
 *
 * The endpoint is public, so it requires the shared secret: each probe costs a
 * real API call to a third party, and an unauthenticated version would let
 * anyone spend Anthropic credits and Linear rate limit on this portal's behalf.
 */

interface HealthContext {
  accountId?: number;
  params?: Record<string, string | string[] | undefined>;
  parameters?: Record<string, string | undefined>;
  query?: Record<string, string | undefined>;
  body?: Record<string, string | undefined>;
}

function param(ctx: HealthContext, key: string): string | undefined {
  const q = ctx.params?.[key];
  const fromQuery = Array.isArray(q) ? q[0] : q;
  return fromQuery ?? ctx.parameters?.[key] ?? ctx.query?.[key] ?? ctx.body?.[key];
}

async function statusAndBody(res: Response): Promise<{ status: number; body: string }> {
  return { status: res.status, body: await res.text() };
}

export async function main(context: HealthContext): Promise<{ statusCode: number; body: string }> {
  const expected = process.env.SYNC_SHARED_SECRET;
  if (!expected) {
    console.error('SYNC_SHARED_SECRET is not set');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfiguration' }) };
  }
  if (!verifySharedSecret(param(context, 'secret'), expected)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const portalId = context.accountId ?? parseInt(param(context, 'portalId') ?? '0', 10);

  const checks: CredentialCheck[] = await Promise.all([
    // One token, because a models listing would not catch an exhausted budget —
    // and an exhausted budget is exactly what a valid-looking key hides.
    probe('anthropic', process.env.ANTHROPIC_API_KEY, async key =>
      statusAndBody(await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-opus-5', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
      }))),

    probe('linear', process.env.LINEAR_API_KEY, async key =>
      statusAndBody(await fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: key },
        body: JSON.stringify({ query: '{ viewer { id } }' }),
      }))),

    probe('asana', process.env.ASANA_API_KEY, async key =>
      statusAndBody(await fetch('https://app.asana.com/api/1.0/users/me', {
        headers: { Authorization: `Bearer ${key}` },
      }))),

    // Fellow is REST at /hapi/v2 with Bearer auth — see fellow-client.ts. An
    // earlier version of this probe guessed /graphql, which answers with an
    // HTML page and reported a working credential as broken. A health check
    // that cries wolf is worse than none.
    //
    // A one-day window is the cheapest authenticated read: it exercises the
    // same path AsanaPoll's Fellow counterpart uses, and returns almost nothing.
    probe('fellow', process.env.FELLOW_API_KEY, async key => {
      const day = new Date().toISOString().slice(0, 10);
      return statusAndBody(await fetch(
        `https://api.fellow.app/hapi/v2/action_items?from_date=${day}&to_date=${day}`,
        { headers: { Authorization: `Bearer ${key}` } },
      ));
    }),

    // The refresh token is the thing that expires; exchanging it is the only
    // check that proves it. This one has already died once in production.
    probe('youtube', process.env.YOUTUBE_REFRESH_TOKEN, async refresh =>
      statusAndBody(await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.YOUTUBE_CLIENT_ID ?? '',
          client_secret: process.env.YOUTUBE_CLIENT_SECRET ?? '',
          refresh_token: refresh,
          grant_type: 'refresh_token',
        }).toString(),
      }))),

    // The portal's own token. It has died silently before and took a day to find.
    probe('hubspot', process.env.PRIVATE_APP_ACCESS_TOKEN ?? process.env.HS_ACCESS_TOKEN, async token => {
      let objectTypeId: string;
      try {
        objectTypeId = getPortalConfig(portalId).content.objectTypeId;
      } catch {
        return { status: 500, body: 'portal not in portal-config' };
      }
      return statusAndBody(await fetch(`${HS_BASE}${objectSearchPath(objectTypeId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ filterGroups: [], properties: ['hs_object_id'], limit: 1 }),
      }));
    }),
  ]);

  const status = overallStatus(checks);
  // 200 either way: the caller decides what to do about a degraded portal, and
  // a non-2xx here would be indistinguishable from the endpoint itself failing.
  return {
    statusCode: 200,
    body: JSON.stringify({ portalId, status, checkedAt: new Date().toISOString(), checks }),
  };
}
