/**
 * The YouTube OAuth endpoint — the HubSpot port of the Firebase project's
 * `initiateYouTubeAuth`, `youtubeCallback`, `getYouTubeToken` and
 * `disconnectYouTube`, collapsed into one app function.
 *
 * FOUR CLOUD FUNCTIONS, ONE APP FUNCTION
 * --------------------------------------
 * Google's redirect must land on an exact, registered URI, and an app function
 * owns exactly one path. So the four routes share this path and are told apart
 * by what arrives:
 *
 *   ?code=… (or ?error=…)   the callback   — Google's redirect, GET
 *   ?action=authorize       initiate       — returns the consent URL (default)
 *   ?action=status          status         — connection state for the UI
 *   ?action=disconnect      disconnect     — POST
 *
 * `getYouTubeToken` has NO route here, deliberately. In the Firebase app it
 * handed a live access token to a browser so an iframe on a foreign origin
 * could upload straight to YouTube. Inside HubSpot the callers are sibling app
 * functions in this same project, so they import `getYouTubeAccessToken()`
 * from `lib/youtube-auth` and the token never leaves the runtime. Publishing an
 * HTTP endpoint that returns a bearer token to anyone who asks would be a
 * regression, not a port.
 */

import { getPortalConfig } from '../lib/portal-config';
import { isRenewalDue, leaseExpiryFrom, requestSubscription } from '../lib/youtube-websub';
import { HS_BASE, objectPath, objectSearchPath } from '../lib/hs-api';
import {
  YOUTUBE_CONFIG_PROPERTIES,
  YOUTUBE_CONFIG_PROPERTY_LIST,
  YOUTUBE_SCOPES,
  buildAuthUrl,
  buildRedirectUri,
  exchangeCodeForTokens,
  getChannelInfo,
  readGoogleCredentials,
  readRefreshToken,
  revokeRefreshToken,
  signState,
  verifyState,
} from '../lib/youtube-auth';
import type { YouTubeConnectionStatus } from '../lib/youtube-auth';

interface YouTubeAuthContext {
  accountId?: number;
  params?: Record<string, string | string[] | undefined>;
  parameters?: Record<string, string | undefined>;
  query?: Record<string, string | undefined>;
  body?: Record<string, string | undefined>;
}

interface AppConfigRecord {
  id: string;
  properties: Record<string, string | null>;
}

function param(ctx: YouTubeAuthContext, key: string): string | undefined {
  // HubSpot delivers URL query params in `params`, and their values are
  // ARRAYS, not strings — reading one straight through yields e.g. ["status"],
  // which compares unequal to "status" and has no .split().
  const q = ctx.params?.[key];
  const fromQuery = Array.isArray(q) ? q[0] : q;
  return fromQuery ?? ctx.parameters?.[key] ?? ctx.query?.[key] ?? ctx.body?.[key];
}

function json(statusCode: number, payload: unknown) {
  return { statusCode, body: JSON.stringify(payload) };
}

function getHubSpotToken(): string | null {
  return process.env.PRIVATE_APP_ACCESS_TOKEN ?? process.env.HS_ACCESS_TOKEN ?? null;
}

// ---------------------------------------------------------------------------
// app_configs — the per-portal state that used to be a Firestore document
// ---------------------------------------------------------------------------

/**
 * The portal's single `app_configs` record, or null when none exists yet.
 * `limit: 1` and "take the first" mirror `readAppSettings` / `AppSettingsApi`:
 * there is one config record per portal by construction.
 */
async function findAppConfigRecord(
  objectTypeId: string,
  token: string,
): Promise<AppConfigRecord | null> {
  const res = await fetch(`${HS_BASE}${objectSearchPath(objectTypeId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      filterGroups: [],
      properties: YOUTUBE_CONFIG_PROPERTY_LIST,
      limit: 1,
      sorts: [],
      query: '',
      after: '0',
    }),
  });
  if (!res.ok) throw new Error(`HubSpot search failed ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { results: AppConfigRecord[] };
  return data.results[0] ?? null;
}

/** Write the YouTube fields onto the config record, creating it if absent. */
async function writeYouTubeConfig(
  objectTypeId: string,
  token: string,
  properties: Record<string, string>,
): Promise<void> {
  const existing = await findAppConfigRecord(objectTypeId, token);

  const url = existing
    ? `${HS_BASE}${objectPath(objectTypeId, existing.id)}`
    : `${HS_BASE}${objectPath(objectTypeId)}`;
  const method = existing ? 'PATCH' : 'POST';
  const body = existing ? { properties } : { properties, associations: [] };

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`HubSpot ${method} on app_configs failed ${res.status}: ${await res.text()}`);
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** `initiateYouTubeAuth`. Returns the URL instead of issuing a 302: an app
 *  function is called by the UI extension over `hubspot.serverless()`, which
 *  cannot follow a redirect — the extension opens the URL itself. */
function handleAuthorize(portalId: number, clientId: string, clientSecret: string) {
  const redirectUri = buildRedirectUri(portalId);
  const state = signState(portalId, clientSecret);
  return json(200, {
    authUrl: buildAuthUrl(clientId, redirectUri, state),
    // Echoed so an operator can paste it straight into the Google Cloud console
    // as an Authorised redirect URI — the single most common setup failure.
    redirectUri,
    scopes: YOUTUBE_SCOPES,
  });
}

/**
 * `youtubeCallback`. Google's redirect lands here in the operator's browser.
 *
 * The Firebase version ended by storing tokens and bouncing to the app home. We
 * cannot store the refresh token — a function reads secrets, it cannot write
 * one — so this returns it once, in the response, with the command to set it.
 * That is a deliberate, documented trade: the alternative is no route at all
 * from "the operator consented" to "the app holds a refresh token".
 */
async function handleCallback(ctx: YouTubeAuthContext, clientSecret: string, hsToken: string) {
  const googleError = param(ctx, 'error');
  if (googleError) {
    // e.g. access_denied when the operator closes the consent screen.
    return json(400, { error: 'Google denied the authorisation', detail: googleError });
  }

  const code = param(ctx, 'code');
  if (!code) return json(400, { error: 'Missing code' });

  const portalId = verifyState(param(ctx, 'state'), clientSecret);
  if (!portalId) {
    // Unsigned, tampered, or from a different client secret. Refuse rather than
    // fall back to a portal id the caller supplied.
    return json(400, { error: 'Invalid or missing state' });
  }

  let objectTypeId: string;
  try {
    objectTypeId = getPortalConfig(portalId).appConfig.objectTypeId;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return json(500, { error: 'Portal not configured', detail });
  }

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code, buildRedirectUri(portalId));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('YouTube code exchange failed', detail);
    return json(502, { error: 'Could not exchange the authorisation code', detail });
  }

  let channel;
  try {
    channel = await getChannelInfo(tokens.accessToken);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('YouTube channel lookup failed', detail);
    return json(502, { error: 'Could not read the YouTube channel', detail });
  }

  // Already-set secret means this is a re-auth, and the app can call YouTube the
  // moment this returns. An unset one means the operator still has work to do.
  const status: YouTubeConnectionStatus = readRefreshToken() ? 'connected' : 'pending_secret';

  try {
    await writeYouTubeConfig(objectTypeId, hsToken, {
      [YOUTUBE_CONFIG_PROPERTIES.channelId]: channel.id,
      [YOUTUBE_CONFIG_PROPERTIES.channelTitle]: channel.title,
      [YOUTUBE_CONFIG_PROPERTIES.status]: status,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('Could not record the YouTube channel on app_configs', detail);
    return json(502, { error: 'Could not record the connection on app_configs', detail });
  }

  if (!tokens.refreshToken) {
    // Only reachable if `prompt=consent` were ever dropped from the auth URL.
    return json(502, {
      error: 'Google returned no refresh_token',
      detail: 'Revoke the app at myaccount.google.com/permissions and connect again.',
      channelId: channel.id,
    });
  }

  return json(200, {
    ok: true,
    channelId: channel.id,
    channelTitle: channel.title,
    uploadsPlaylistId: channel.uploadsPlaylistId,
    status,
    // Shown once, to the operator who just consented, and never logged.
    refreshToken: tokens.refreshToken,
    nextStep:
      'Set this as an app secret, then re-upload the project: ' +
      'hs secret add YOUTUBE_REFRESH_TOKEN',
  });
}

/** `status`. Cheap by design — stored state plus "is the secret set", no call
 *  to Google, so a card can render it on every open. */
/**
 * Start or renew the WebSub subscription for the connected channel.
 *
 * Re-subscribing IS renewal — there is no separate call, the lease is simply
 * extended. So this is safe to run on a daily schedule, and `force` exists only
 * to re-subscribe before the renewal window opens.
 *
 * The hub verifies asynchronously, so a 202 means "accepted", not "active". The
 * status recorded here is `pending` until the hub's challenge reaches
 * youtube-webhook and is echoed back — claiming `active` on a 202 would report
 * a subscription that may never verify.
 */
async function handleSubscribe(
  objectTypeId: string,
  hsToken: string,
  portalId: number,
  force: boolean,
) {
  let record: AppConfigRecord | null;
  try {
    record = await findAppConfigRecord(objectTypeId, hsToken);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return json(502, { error: 'Could not read app_configs', detail });
  }

  const props = record?.properties ?? {};
  const channelId = props[YOUTUBE_CONFIG_PROPERTIES.channelId] ?? null;
  if (!channelId) {
    return json(409, { error: 'No channel connected — authorise before subscribing' });
  }

  const expires = props[YOUTUBE_CONFIG_PROPERTIES.subscriptionExpires] ?? null;
  if (!force && !isRenewalDue(expires)) {
    return json(200, {
      skipped: true,
      reason: 'subscription is not due for renewal',
      channelId,
      expiresAt: expires,
    });
  }

  const result = await requestSubscription(channelId, portalId);
  if (!result.accepted) {
    return json(502, {
      error: 'The WebSub hub rejected the subscription request',
      status: result.status,
      detail: result.body.slice(0, 300),
    });
  }

  const expiresAt = leaseExpiryFrom();
  try {
    await writeYouTubeConfig(objectTypeId, hsToken, {
      [YOUTUBE_CONFIG_PROPERTIES.subscriptionStatus]: 'pending',
      [YOUTUBE_CONFIG_PROPERTIES.subscriptionExpires]: expiresAt,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return json(502, { error: 'Subscribed, but could not record it on app_configs', detail });
  }

  return json(200, {
    ok: true,
    channelId,
    status: 'pending',
    expiresAt,
    note: 'The hub verifies asynchronously; status becomes active once it calls youtube-webhook.',
  });
}

async function handleStatus(objectTypeId: string, hsToken: string) {
  let record: AppConfigRecord | null;
  try {
    record = await findAppConfigRecord(objectTypeId, hsToken);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return json(502, { error: 'Could not read app_configs', detail });
  }

  const props = record?.properties ?? {};
  const channelId = props[YOUTUBE_CONFIG_PROPERTIES.channelId] ?? null;
  const hasSecret = readRefreshToken() !== null;

  // The stored status is a record of the last thing that happened; whether the
  // secret is set is the truth about whether a call can be made right now. When
  // they disagree, the secret wins.
  let status: YouTubeConnectionStatus = 'disconnected';
  if (channelId) status = hasSecret ? 'connected' : 'pending_secret';

  return json(200, {
    status,
    connected: status === 'connected',
    hasRefreshTokenSecret: hasSecret,
    channelId,
    channelTitle: props[YOUTUBE_CONFIG_PROPERTIES.channelTitle] ?? null,
    lastSync: props[YOUTUBE_CONFIG_PROPERTIES.lastSync] ?? null,
  });
}

/**
 * `disconnectYouTube`. Clears the portal state and revokes the grant at Google.
 *
 * The secret itself outlives this call — nothing in the runtime can delete it —
 * so revoking is what actually ends access, and `secretRemovalRequired` tells
 * the operator the one step left.
 */
async function handleDisconnect(objectTypeId: string, hsToken: string) {
  const refreshToken = readRefreshToken();
  const revoked = refreshToken ? await revokeRefreshToken(refreshToken) : false;

  try {
    await writeYouTubeConfig(objectTypeId, hsToken, {
      [YOUTUBE_CONFIG_PROPERTIES.channelId]: '',
      [YOUTUBE_CONFIG_PROPERTIES.channelTitle]: '',
      [YOUTUBE_CONFIG_PROPERTIES.status]: 'disconnected',
      [YOUTUBE_CONFIG_PROPERTIES.lastSync]: '',
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return json(502, { error: 'Could not clear the connection on app_configs', detail });
  }

  return json(200, {
    ok: true,
    revoked,
    secretRemovalRequired: refreshToken !== null,
    nextStep: refreshToken
      ? 'Remove the now-dead secret: hs secret delete YOUTUBE_REFRESH_TOKEN'
      : null,
  });
}

// ---------------------------------------------------------------------------

export async function main(context: YouTubeAuthContext): Promise<{ statusCode: number; body: string }> {
  const credentials = readGoogleCredentials();
  if (!credentials) {
    return json(500, { error: 'YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET are not set' });
  }

  const hsToken = getHubSpotToken();
  if (!hsToken) return json(500, { error: 'No HubSpot access token available' });

  // Google's redirect is the one caller that cannot be given an `action`, so it
  // is identified by what Google appends. Checked first for that reason.
  if (param(context, 'code') ?? param(context, 'error')) {
    return handleCallback(context, credentials.clientSecret, hsToken);
  }

  // Google's redirect carries no portal context beyond the signed state, which
  // is why the callback resolves its own portal id above rather than here.
  const portalId = context.accountId ?? parseInt(param(context, 'portalId') ?? '0', 10);
  if (!portalId) return json(400, { error: 'Missing portalId' });

  let objectTypeId: string;
  try {
    objectTypeId = getPortalConfig(portalId).appConfig.objectTypeId;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return json(500, { error: 'Portal not configured', detail });
  }
  if (!objectTypeId) {
    return json(500, { error: 'App config object type not configured' });
  }

  const action = param(context, 'action') ?? 'authorize';

  if (action === 'authorize') {
    return handleAuthorize(portalId, credentials.clientId, credentials.clientSecret);
  }
  if (action === 'status') {
    return handleStatus(objectTypeId, hsToken);
  }
  if (action === 'disconnect') {
    return handleDisconnect(objectTypeId, hsToken);
  }
  if (action === 'subscribe') {
    return handleSubscribe(objectTypeId, hsToken, portalId, param(context, 'force') === 'true');
  }

  return json(400, { error: `Unknown action: ${action}` });
}
