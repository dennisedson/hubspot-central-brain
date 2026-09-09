/**
 * YouTube (Google) OAuth for a HubSpot app.
 *
 * Ported from the Firebase `creator-console` project, which stored tokens in
 * Firestore. There is no database here and nothing hosted outside HubSpot, so
 * the storage model is different in a way that changes the flow itself:
 *
 *   REFRESH TOKEN  -> a HubSpot app secret (`YOUTUBE_REFRESH_TOKEN`).
 *   ACCESS TOKEN   -> never stored. Minted from the refresh token on demand and
 *                     memoised in module scope for the life of a warm function
 *                     container.
 *   PORTAL STATE   -> the `app_configs` custom object (channel id, channel
 *                     title, connection status, last sync). See
 *                     `YOUTUBE_CONFIG_PROPERTIES` and `portal-config.ts`.
 *
 * THE CONSEQUENCE, STATED PLAINLY
 * -------------------------------
 * A function can READ its secrets but cannot WRITE one. So the callback below
 * cannot finish the connection by itself the way the Firestore version did — it
 * exchanges the code, records the channel on `app_configs`, and hands the
 * refresh token back to the operator, who sets it with `hs secret add`. That is
 * a one-time, operator-run step per portal; nothing on the hot path needs it.
 *
 * WHY `prompt=consent` SURVIVES THE PORT
 * --------------------------------------
 * Google returns a `refresh_token` only on the FIRST authorisation for a
 * client/user pair. Without `prompt=consent` a re-authorisation returns an
 * access token and no refresh token — and since the refresh token is the entire
 * point of this flow (it is what becomes the secret), a silent re-auth would
 * produce a callback with nothing to store. Google also does NOT return a new
 * refresh token when refreshing, which is why `refreshAccessToken` carries the
 * caller's token through to the result rather than expecting one back.
 */

import crypto from 'crypto';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3';

/**
 * The endpoint path of `YouTubeAuth-hsmeta.json`. MUST match it: the redirect
 * URI Google is configured with is built from this, and a mismatch fails at the
 * consent screen with `redirect_uri_mismatch`. `youtube-auth.test.ts` asserts
 * the two agree so the drift cannot ship.
 */
export const YOUTUBE_AUTH_PATH = 'youtube-auth';

/**
 * Scopes carried over from the Firebase app unchanged. Each one is load-bearing
 * for a feature that already exists, so trimming this list is a product
 * decision, not a cleanup:
 *   youtube.readonly       read channel + video metrics
 *   youtube.upload         publish new videos
 *   youtube                update privacy/metadata on existing videos
 *   youtube.force-ssl      read captions for AI analysis
 *   yt-analytics.readonly  impressions, CTR, watch time
 */
export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
];

/**
 * Where per-portal YouTube state lives on `app_configs`.
 *
 * NOT YET PROVISIONED. `provision-app-settings.ts` creates `app_configs` with
 * the three Linear properties only; `asana_sync_token` and `fellow_last_sync`
 * were added later by their own scripts. These four need the same treatment
 * before a live portal will accept a write — until then HubSpot rejects the
 * PATCH with `PROPERTY_DOESNT_EXIST`. Names are centralised here so a
 * provisioning script can import them instead of restating them.
 */
export const YOUTUBE_CONFIG_PROPERTIES = {
  channelId: 'youtube_channel_id',
  channelTitle: 'youtube_channel_title',
  status: 'youtube_connection_status',
  lastSync: 'youtube_last_sync',
} as const;

/** Every property this module reads off `app_configs`, in read order. */
export const YOUTUBE_CONFIG_PROPERTY_LIST = Object.values(YOUTUBE_CONFIG_PROPERTIES);

/**
 * `pending_secret` is the state the Firestore version had no need for: the
 * channel is known and the code was exchanged, but `YOUTUBE_REFRESH_TOKEN` is
 * not set yet, so no API call can be made. It is a real, reachable state and
 * the UI should say so rather than claiming "connected".
 */
export type YouTubeConnectionStatus = 'connected' | 'pending_secret' | 'disconnected';

export interface YouTubeTokens {
  accessToken: string;
  /** Present on a first authorisation; null on a refresh (Google omits it). */
  refreshToken: string | null;
  /** Absolute epoch ms. Derived from `expires_in`, which is relative. */
  expiresAt: number;
  scope: string;
}

export interface YouTubeChannel {
  id: string;
  title: string;
  /** The channel's "uploads" playlist — how the sync enumerates videos. */
  uploadsPlaylistId: string | null;
}

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface YouTubeChannelListResponse {
  items?: Array<{
    id?: string;
    snippet?: { title?: string };
    contentDetails?: { relatedPlaylists?: { uploads?: string } };
  }>;
}

/** Google's default when `expires_in` is absent from a token response. */
const DEFAULT_EXPIRY_SECONDS = 3600;

/**
 * Refresh this long before expiry rather than on it. Carried over from the
 * Firebase version: a token that expires mid-request fails the request, and a
 * function that starts a 40-second upload with 30 seconds of token left has
 * already lost.
 */
const REFRESH_SKEW_MS = 10 * 60 * 1000;

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * Read at call time, never at module load — the tests stub the environment per
 * case, and a serverless container's secrets are injected before invocation
 * rather than before import.
 */
export function readGoogleCredentials(): GoogleCredentials | null {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function requireGoogleCredentials(): GoogleCredentials {
  const creds = readGoogleCredentials();
  if (!creds) {
    throw new Error('YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET are not set');
  }
  return creds;
}

/** The stored refresh token, or null when the secret has not been set yet. */
export function readRefreshToken(): string | null {
  const token = process.env.YOUTUBE_REFRESH_TOKEN;
  return token ? token : null;
}

// ---------------------------------------------------------------------------
// The redirect URI
// ---------------------------------------------------------------------------

/**
 * The public URL of this app function in one portal — the value that must be
 * registered as an Authorised redirect URI in the Google Cloud console.
 *
 * Derived, never hardcoded: the same portal-scoped `hs-sites.com` shape the
 * workflow actions already use. It deliberately carries NO query string, so
 * Google's exact-match check has nothing to disagree about; the callback is
 * recognised by the `code` Google itself appends.
 */
export function buildRedirectUri(portalId: number): string {
  return `https://${portalId}.hs-sites.com/hs/serverless/${YOUTUBE_AUTH_PATH}`;
}

// ---------------------------------------------------------------------------
// OAuth state
// ---------------------------------------------------------------------------

/**
 * The `state` parameter, signed.
 *
 * The Firebase version put the bare portal id in `state` and trusted it on the
 * way back. Here the callback is a public URL that writes to a CRM object, so
 * an unauthenticated caller could otherwise name any portal and have us stamp a
 * channel onto it. Signing with the client secret — already required for the
 * flow, so no new secret to provision — makes the portal id tamper-evident and
 * proves the callback belongs to an authorisation this app started.
 */
export function signState(portalId: number, clientSecret: string, nonce?: string): string {
  const n = nonce ?? crypto.randomBytes(9).toString('base64url');
  const payload = `${portalId}.${n}`;
  const sig = crypto.createHmac('sha256', clientSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/** The portal id from a valid state, or null if absent, malformed or forged. */
export function verifyState(state: string | undefined, clientSecret: string): number | null {
  if (!state) return null;
  const parts = state.split('.');
  if (parts.length !== 3) return null;
  const [portalPart, noncePart, sig] = parts;

  const expected = crypto
    .createHmac('sha256', clientSecret)
    .update(`${portalPart}.${noncePart}`)
    .digest('base64url');

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;

  const portalId = Number(portalPart);
  return Number.isInteger(portalId) && portalId > 0 ? portalId : null;
}

// ---------------------------------------------------------------------------
// Step 1 — the consent URL
// ---------------------------------------------------------------------------

/**
 * The Google consent screen URL.
 *
 * `access_type=offline` + `prompt=consent` together are what guarantee a
 * `refresh_token` comes back. Drop either and the callback can succeed while
 * producing nothing worth keeping.
 */
export function buildAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: YOUTUBE_SCOPES.join(' '),
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Step 2 — token endpoint
// ---------------------------------------------------------------------------

async function googleTokenRequest(params: Record<string, string>): Promise<GoogleTokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });

  // Google returns its error detail as a JSON body on a 4xx, so read the body
  // before deciding — `res.ok` alone loses the only useful part of the failure.
  let data: GoogleTokenResponse;
  try {
    data = (await res.json()) as GoogleTokenResponse;
  } catch {
    throw new Error(`Google token endpoint returned ${res.status} with an unreadable body`);
  }

  if (!res.ok || data.error) {
    const detail = data.error_description ?? data.error ?? `HTTP ${res.status}`;
    throw new Error(`Google token request failed: ${detail}`);
  }
  if (!data.access_token) {
    throw new Error('Google token response contained no access_token');
  }
  return data;
}

function toTokens(data: GoogleTokenResponse, fallbackRefreshToken: string | null): YouTubeTokens {
  const expiresIn = data.expires_in ?? DEFAULT_EXPIRY_SECONDS;
  return {
    accessToken: data.access_token ?? '',
    refreshToken: data.refresh_token ?? fallbackRefreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    scope: data.scope ?? '',
  };
}

/** Exchange the one-time `code` from Google's redirect for a token set. */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<YouTubeTokens> {
  const { clientId, clientSecret } = requireGoogleCredentials();
  const data = await googleTokenRequest({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  return toTokens(data, null);
}

/**
 * Mint a fresh access token from a refresh token.
 *
 * Google does not echo the refresh token back, so it is carried through from
 * the argument. Losing it here is how the Firebase version's earliest bug
 * worked: a refresh overwrote the stored document and erased the only thing
 * that could refresh again.
 */
export async function refreshAccessToken(refreshToken: string): Promise<YouTubeTokens> {
  const { clientId, clientSecret } = requireGoogleCredentials();
  const data = await googleTokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  return toTokens(data, refreshToken);
}

// ---------------------------------------------------------------------------
// The access token every other YouTube caller wants
// ---------------------------------------------------------------------------

/**
 * Module-scope, therefore per warm container. This is the whole replacement for
 * the Firestore token document: within one container the token is reused, and a
 * cold start simply mints another. No shared store, nothing to keep consistent,
 * and no way for a stale write to clobber a good token.
 */
let cachedToken: { token: string; expiresAt: number } | null = null;

/** Test seam. Production code has no reason to call this. */
export function resetAccessTokenCache(): void {
  cachedToken = null;
}

/**
 * A usable access token, refreshing when the cached one is inside the skew
 * window. Throws when the portal has never been connected — callers should
 * treat that as "not connected", not as an outage.
 */
export async function getYouTubeAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - REFRESH_SKEW_MS) {
    return cachedToken.token;
  }

  const refreshToken = readRefreshToken();
  if (!refreshToken) {
    throw new Error(
      'YOUTUBE_REFRESH_TOKEN is not set — run the YouTubeAuth connect flow for this portal',
    );
  }

  const tokens = await refreshAccessToken(refreshToken);
  cachedToken = { token: tokens.accessToken, expiresAt: tokens.expiresAt };
  return tokens.accessToken;
}

// ---------------------------------------------------------------------------
// Channel identity
// ---------------------------------------------------------------------------

/**
 * The channel behind an access token (`mine=true`), which is how a portal gets
 * linked to a channel id. A Google account with no channel returns zero items —
 * a real case, not a failure of ours, so it gets its own message.
 */
export async function getChannelInfo(accessToken: string): Promise<YouTubeChannel> {
  const res = await fetch(`${YOUTUBE_API}/channels?part=snippet,contentDetails&mine=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`YouTube channels lookup failed ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as YouTubeChannelListResponse;
  const channel = data.items?.[0];
  if (!channel?.id) {
    throw new Error('No YouTube channel found for this Google account');
  }

  return {
    id: channel.id,
    title: channel.snippet?.title ?? '',
    uploadsPlaylistId: channel.contentDetails?.relatedPlaylists?.uploads ?? null,
  };
}

// ---------------------------------------------------------------------------
// Disconnect
// ---------------------------------------------------------------------------

/**
 * Revoke a refresh token at Google.
 *
 * The Firebase version's disconnect only deleted its Firestore document, which
 * left the grant live on Google's side. Here the token lives in a secret this
 * function cannot delete, so revoking is the only part of "disconnect" that
 * actually severs access — the secret is then a dead string the operator
 * removes at their leisure.
 *
 * Returns whether Google accepted it. A failure is reported, never thrown: the
 * local state must still be cleared or the UI would claim "still connected"
 * about a connection the user just ended.
 */
export async function revokeRefreshToken(refreshToken: string): Promise<boolean> {
  try {
    const res = await fetch(GOOGLE_REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }).toString(),
    });
    return res.ok;
  } catch (err) {
    console.error('YouTube token revoke failed', err instanceof Error ? err.message : String(err));
    return false;
  }
}
