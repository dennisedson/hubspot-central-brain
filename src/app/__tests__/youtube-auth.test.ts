import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  YOUTUBE_AUTH_PATH,
  YOUTUBE_SCOPES,
  buildAuthUrl,
  buildRedirectUri,
  exchangeCodeForTokens,
  getChannelInfo,
  getYouTubeAccessToken,
  refreshAccessToken,
  resetAccessTokenCache,
  revokeRefreshToken,
  signState,
  verifyState,
} from '@lib/youtube-auth';
import { main } from '../functions/YouTubeAuth';
import hsmeta from '../functions/YouTubeAuth-hsmeta.json';

/**
 * YouTube OAuth, ported off Firebase.
 *
 * The three things this file is really guarding:
 *
 *   1. `access_type=offline` + `prompt=consent` stay on the auth URL. Without
 *      both, the callback succeeds and yields no refresh token — the one thing
 *      the whole flow exists to produce.
 *   2. A refresh never loses the refresh token. Google does not echo it back,
 *      so it has to be carried through; dropping it bricks the connection.
 *   3. The callback trusts nothing but a signed state. It is a public URL that
 *      writes to a CRM object, so an unsigned portal id would let anyone stamp
 *      a channel onto any portal.
 *
 * Real dev-portal ids from src/app/lib/portal-config.ts. `fetch` is mocked
 * everywhere — no test here reaches Google or HubSpot.
 */

const PORTAL_ID = 51869810;
const APP_CONFIG_TYPE = '2-68071489';
const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const CLIENT_SECRET = 'test-client-secret';
const REDIRECT_URI = `https://${PORTAL_ID}.hs-sites.com/hs/serverless/youtube-auth`;

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  resetAccessTokenCache();
  vi.stubEnv('YOUTUBE_CLIENT_ID', CLIENT_ID);
  vi.stubEnv('YOUTUBE_CLIENT_SECRET', CLIENT_SECRET);
  vi.stubEnv('YOUTUBE_REFRESH_TOKEN', '');
  vi.stubEnv('PRIVATE_APP_ACCESS_TOKEN', 'hs-test-token');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function googleTokenResponse(body: Record<string, unknown>, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
}

function channelResponse(id = 'UC_test_channel') {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      items: [
        {
          id,
          snippet: { title: 'Dev Advocacy' },
          contentDetails: { relatedPlaylists: { uploads: 'UU_test_uploads' } },
        },
      ],
    }),
    text: async () => '',
  };
}

function hsSearchResponse(results: unknown[]) {
  return { ok: true, status: 200, json: async () => ({ results }), text: async () => '' };
}

function hsWriteResponse() {
  return { ok: true, status: 200, json: async () => ({ id: '1' }), text: async () => '' };
}

function urls(): string[] {
  return mockFetch.mock.calls.map(c => String(c[0]));
}

function callBody(index: number): string {
  return String((mockFetch.mock.calls[index][1] as { body: string }).body);
}

// ---------------------------------------------------------------------------

describe('the redirect URI', () => {
  it('is portal-scoped and derived, not hardcoded', () => {
    expect(buildRedirectUri(PORTAL_ID)).toBe(REDIRECT_URI);
    expect(buildRedirectUri(22047910)).toBe(
      'https://22047910.hs-sites.com/hs/serverless/youtube-auth',
    );
  });

  // Google matches redirect URIs exactly. A query string of ours would have to
  // be registered character-for-character, so the callback is identified by the
  // `code` Google appends instead.
  it('carries no query string of its own', () => {
    expect(buildRedirectUri(PORTAL_ID)).not.toContain('?');
  });

  // A silent mismatch here fails at Google's consent screen, not at deploy.
  it('is built from the same path the hsmeta registers', () => {
    expect(hsmeta.config.endpoint.path).toBe(YOUTUBE_AUTH_PATH);
    expect(buildRedirectUri(PORTAL_ID)).toContain(`/${hsmeta.config.endpoint.path}`);
  });

  it('declares every secret the flow reads', () => {
    expect(hsmeta.config.secretKeys).toEqual(
      expect.arrayContaining([
        'YOUTUBE_CLIENT_ID',
        'YOUTUBE_CLIENT_SECRET',
        'YOUTUBE_REFRESH_TOKEN',
        'HS_ACCESS_TOKEN',
      ]),
    );
  });
});

describe('buildAuthUrl', () => {
  it('asks for offline access with a forced consent screen', () => {
    const url = new URL(buildAuthUrl(CLIENT_ID, REDIRECT_URI, 'state-123'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    // Together these are the only reason a refresh_token comes back.
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('response_type')).toBe('code');
  });

  it('passes the client id, redirect and state through', () => {
    const url = new URL(buildAuthUrl(CLIENT_ID, REDIRECT_URI, 'state-123'));
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(url.searchParams.get('state')).toBe('state-123');
  });

  it('requests all five YouTube scopes the app depends on', () => {
    const url = new URL(buildAuthUrl(CLIENT_ID, REDIRECT_URI, 's'));
    const scopes = (url.searchParams.get('scope') ?? '').split(' ');
    expect(scopes).toEqual(YOUTUBE_SCOPES);
    expect(scopes).toContain('https://www.googleapis.com/auth/yt-analytics.readonly');
  });
});

describe('the signed state', () => {
  it('round-trips the portal id', () => {
    const state = signState(PORTAL_ID, CLIENT_SECRET);
    expect(verifyState(state, CLIENT_SECRET)).toBe(PORTAL_ID);
  });

  it('is unique per call, so two authorisations never share a state', () => {
    expect(signState(PORTAL_ID, CLIENT_SECRET)).not.toBe(signState(PORTAL_ID, CLIENT_SECRET));
  });

  // The attack the Firebase version was open to: state was the bare portal id.
  it('rejects a swapped portal id', () => {
    const state = signState(PORTAL_ID, CLIENT_SECRET);
    const forged = state.replace(String(PORTAL_ID), '22047910');
    expect(verifyState(forged, CLIENT_SECRET)).toBeNull();
  });

  it('rejects a signature from a different secret', () => {
    expect(verifyState(signState(PORTAL_ID, 'other-secret'), CLIENT_SECRET)).toBeNull();
  });

  it('rejects malformed and missing states', () => {
    expect(verifyState(String(PORTAL_ID), CLIENT_SECRET)).toBeNull();
    expect(verifyState('', CLIENT_SECRET)).toBeNull();
    expect(verifyState(undefined, CLIENT_SECRET)).toBeNull();
  });
});

describe('exchangeCodeForTokens', () => {
  it('form-posts an authorization_code grant to Google', async () => {
    mockFetch.mockResolvedValueOnce(
      googleTokenResponse({
        access_token: 'ya29.access',
        refresh_token: '1//refresh',
        expires_in: 3600,
        scope: YOUTUBE_SCOPES.join(' '),
      }),
    );

    const tokens = await exchangeCodeForTokens('auth-code', REDIRECT_URI);

    expect(urls()[0]).toBe('https://oauth2.googleapis.com/token');
    const init = mockFetch.mock.calls[0][1] as { method: string; headers: Record<string, string> };
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');

    const sent = new URLSearchParams(callBody(0));
    expect(sent.get('grant_type')).toBe('authorization_code');
    expect(sent.get('code')).toBe('auth-code');
    expect(sent.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(sent.get('client_secret')).toBe(CLIENT_SECRET);

    expect(tokens.accessToken).toBe('ya29.access');
    expect(tokens.refreshToken).toBe('1//refresh');
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());
  });

  it('surfaces Google’s error_description rather than a bare status', async () => {
    mockFetch.mockResolvedValueOnce(
      googleTokenResponse(
        { error: 'invalid_grant', error_description: 'Code was already redeemed.' },
        false,
        400,
      ),
    );
    await expect(exchangeCodeForTokens('used-code', REDIRECT_URI)).rejects.toThrow(
      'Code was already redeemed.',
    );
  });

  it('throws when the client credentials are not set', async () => {
    vi.stubEnv('YOUTUBE_CLIENT_ID', '');
    await expect(exchangeCodeForTokens('c', REDIRECT_URI)).rejects.toThrow('YOUTUBE_CLIENT_ID');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('refreshAccessToken', () => {
  // Google omits refresh_token on a refresh. Losing it here would leave nothing
  // able to refresh again — the connection would silently brick in an hour.
  it('carries the refresh token through a response that omits it', async () => {
    mockFetch.mockResolvedValueOnce(
      googleTokenResponse({ access_token: 'ya29.new', expires_in: 3599 }),
    );

    const tokens = await refreshAccessToken('1//refresh');

    expect(new URLSearchParams(callBody(0)).get('grant_type')).toBe('refresh_token');
    expect(tokens.accessToken).toBe('ya29.new');
    expect(tokens.refreshToken).toBe('1//refresh');
  });

  it('defaults the expiry when Google omits expires_in', async () => {
    mockFetch.mockResolvedValueOnce(googleTokenResponse({ access_token: 'ya29.new' }));
    const tokens = await refreshAccessToken('1//refresh');
    expect(tokens.expiresAt).toBeGreaterThan(Date.now() + 3500 * 1000);
  });
});

describe('getYouTubeAccessToken', () => {
  it('refuses when YOUTUBE_REFRESH_TOKEN has never been set', async () => {
    await expect(getYouTubeAccessToken()).rejects.toThrow('YOUTUBE_REFRESH_TOKEN is not set');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // The whole replacement for the Firestore token document.
  it('mints once and reuses the token while it is fresh', async () => {
    vi.stubEnv('YOUTUBE_REFRESH_TOKEN', '1//refresh');
    mockFetch.mockResolvedValueOnce(
      googleTokenResponse({ access_token: 'ya29.cached', expires_in: 3600 }),
    );

    expect(await getYouTubeAccessToken()).toBe('ya29.cached');
    expect(await getYouTubeAccessToken()).toBe('ya29.cached');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // Proactive refresh, kept from the Firebase version: a token with less than
  // the skew window left is treated as already expired.
  it('re-mints a token that expires inside the skew window', async () => {
    vi.stubEnv('YOUTUBE_REFRESH_TOKEN', '1//refresh');
    mockFetch
      .mockResolvedValueOnce(googleTokenResponse({ access_token: 'ya29.short', expires_in: 300 }))
      .mockResolvedValueOnce(googleTokenResponse({ access_token: 'ya29.fresh', expires_in: 3600 }));

    expect(await getYouTubeAccessToken()).toBe('ya29.short');
    expect(await getYouTubeAccessToken()).toBe('ya29.fresh');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe('getChannelInfo', () => {
  it('reads the authenticated user’s own channel', async () => {
    mockFetch.mockResolvedValueOnce(channelResponse());

    const channel = await getChannelInfo('ya29.access');

    expect(urls()[0]).toBe(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&mine=true',
    );
    const init = mockFetch.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe('Bearer ya29.access');
    expect(channel).toEqual({
      id: 'UC_test_channel',
      title: 'Dev Advocacy',
      uploadsPlaylistId: 'UU_test_uploads',
    });
  });

  // A Google account that has never created a channel. Real, and not our bug.
  it('throws a specific error when the account has no channel', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ items: [] }),
      text: async () => '',
    });
    await expect(getChannelInfo('ya29.access')).rejects.toThrow('No YouTube channel found');
  });

  it('throws on an HTTP failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({}),
      text: async () => 'insufficientPermissions',
    });
    await expect(getChannelInfo('ya29.access')).rejects.toThrow('403');
  });
});

describe('revokeRefreshToken', () => {
  it('posts the token to Google’s revoke endpoint', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '' });
    expect(await revokeRefreshToken('1//refresh')).toBe(true);
    expect(urls()[0]).toBe('https://oauth2.googleapis.com/revoke');
    expect(new URLSearchParams(callBody(0)).get('token')).toBe('1//refresh');
  });

  // Disconnect must still clear local state when Google is unreachable.
  it('reports failure instead of throwing', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network down'));
    expect(await revokeRefreshToken('1//refresh')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The handler
// ---------------------------------------------------------------------------

describe('YouTubeAuth — authorize', () => {
  it('returns a consent URL and the redirect URI to register', async () => {
    const res = await main({ parameters: { portalId: String(PORTAL_ID) } });
    const body = JSON.parse(res.body) as { authUrl: string; redirectUri: string };

    expect(res.statusCode).toBe(200);
    expect(body.redirectUri).toBe(REDIRECT_URI);
    const url = new URL(body.authUrl);
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(verifyState(url.searchParams.get('state') ?? '', CLIENT_SECRET)).toBe(PORTAL_ID);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('is the default action', async () => {
    const res = await main({ accountId: PORTAL_ID });
    expect(JSON.parse(res.body)).toHaveProperty('authUrl');
  });

  it('fails loudly when the Google credentials are missing', async () => {
    vi.stubEnv('YOUTUBE_CLIENT_SECRET', '');
    const res = await main({ accountId: PORTAL_ID });
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toContain('YOUTUBE_CLIENT_SECRET');
  });

  it('rejects an unknown action', async () => {
    const res = await main({ accountId: PORTAL_ID, parameters: { action: 'nonsense' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('YouTubeAuth — callback', () => {
  function callbackContext(overrides: Record<string, string> = {}) {
    return {
      query: {
        code: 'auth-code',
        state: signState(PORTAL_ID, CLIENT_SECRET),
        ...overrides,
      },
    };
  }

  it('exchanges the code, records the channel, and hands back the refresh token', async () => {
    mockFetch
      .mockResolvedValueOnce(
        googleTokenResponse({
          access_token: 'ya29.access',
          refresh_token: '1//refresh',
          expires_in: 3600,
        }),
      )
      .mockResolvedValueOnce(channelResponse())
      .mockResolvedValueOnce(hsSearchResponse([]))
      .mockResolvedValueOnce(hsWriteResponse());

    const res = await main(callbackContext());
    const body = JSON.parse(res.body) as Record<string, string>;

    expect(res.statusCode).toBe(200);
    expect(body.channelId).toBe('UC_test_channel');
    // The secret cannot be written from here, so the operator gets the token
    // and the command once, and the portal sits in pending_secret until then.
    expect(body.refreshToken).toBe('1//refresh');
    expect(body.status).toBe('pending_secret');
    expect(body.nextStep).toContain('hs secret add YOUTUBE_REFRESH_TOKEN');
  });

  it('writes the channel onto app_configs on the dated CRM path', async () => {
    mockFetch
      .mockResolvedValueOnce(
        googleTokenResponse({ access_token: 'ya29.access', refresh_token: '1//refresh' }),
      )
      .mockResolvedValueOnce(channelResponse())
      .mockResolvedValueOnce(hsSearchResponse([{ id: '801', properties: {} }]))
      .mockResolvedValueOnce(hsWriteResponse());

    await main(callbackContext());

    expect(urls()[2]).toBe(
      `https://api.hubapi.com/crm/objects/2026-03/${APP_CONFIG_TYPE}/search`,
    );
    // An existing config record is patched, never duplicated.
    expect(urls()[3]).toBe(`https://api.hubapi.com/crm/objects/2026-03/${APP_CONFIG_TYPE}/801`);
    expect((mockFetch.mock.calls[3][1] as { method: string }).method).toBe('PATCH');
    expect(JSON.parse(callBody(3)).properties).toEqual({
      youtube_channel_id: 'UC_test_channel',
      youtube_channel_title: 'Dev Advocacy',
      youtube_connection_status: 'pending_secret',
    });
  });

  it('creates the config record when the portal has none', async () => {
    mockFetch
      .mockResolvedValueOnce(
        googleTokenResponse({ access_token: 'ya29.access', refresh_token: '1//refresh' }),
      )
      .mockResolvedValueOnce(channelResponse())
      .mockResolvedValueOnce(hsSearchResponse([]))
      .mockResolvedValueOnce(hsWriteResponse());

    await main(callbackContext());

    expect(urls()[3]).toBe(`https://api.hubapi.com/crm/objects/2026-03/${APP_CONFIG_TYPE}`);
    expect((mockFetch.mock.calls[3][1] as { method: string }).method).toBe('POST');
  });

  it('reports connected when the secret is already in place (re-auth)', async () => {
    vi.stubEnv('YOUTUBE_REFRESH_TOKEN', '1//existing');
    mockFetch
      .mockResolvedValueOnce(
        googleTokenResponse({ access_token: 'ya29.access', refresh_token: '1//refresh' }),
      )
      .mockResolvedValueOnce(channelResponse())
      .mockResolvedValueOnce(hsSearchResponse([]))
      .mockResolvedValueOnce(hsWriteResponse());

    const res = await main(callbackContext());
    expect(JSON.parse(res.body).status).toBe('connected');
  });

  // The public-URL problem: refuse before spending an authorisation code.
  it('refuses a forged state without calling Google', async () => {
    const res = await main({ query: { code: 'auth-code', state: '51869810.abc.badsig' } });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('state');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('refuses a callback with no state at all', async () => {
    const res = await main({ query: { code: 'auth-code' } });
    expect(res.statusCode).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('reports a denied consent screen', async () => {
    const res = await main({ query: { error: 'access_denied' } });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).detail).toBe('access_denied');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 502 with Google’s reason when the exchange fails', async () => {
    mockFetch.mockResolvedValueOnce(
      googleTokenResponse(
        { error: 'redirect_uri_mismatch', error_description: 'Bad Request' },
        false,
        400,
      ),
    );
    const res = await main(callbackContext());
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).detail).toContain('Bad Request');
  });

  it('does not report success when app_configs cannot be written', async () => {
    mockFetch
      .mockResolvedValueOnce(
        googleTokenResponse({ access_token: 'ya29.access', refresh_token: '1//refresh' }),
      )
      .mockResolvedValueOnce(channelResponse())
      .mockResolvedValueOnce(hsSearchResponse([]))
      .mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'PROPERTY_DOESNT_EXIST' });

    const res = await main(callbackContext());
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).detail).toContain('PROPERTY_DOESNT_EXIST');
  });

  it('says so plainly when Google returns no refresh token', async () => {
    mockFetch
      .mockResolvedValueOnce(googleTokenResponse({ access_token: 'ya29.access' }))
      .mockResolvedValueOnce(channelResponse())
      .mockResolvedValueOnce(hsSearchResponse([]))
      .mockResolvedValueOnce(hsWriteResponse());

    const res = await main(callbackContext());
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error).toContain('no refresh_token');
  });
});

describe('YouTubeAuth — status', () => {
  function statusContext() {
    return { accountId: PORTAL_ID, parameters: { action: 'status' } };
  }

  it('is disconnected when nothing has been connected', async () => {
    mockFetch.mockResolvedValueOnce(hsSearchResponse([]));
    const res = await main(statusContext());
    expect(JSON.parse(res.body)).toMatchObject({
      status: 'disconnected',
      connected: false,
      channelId: null,
    });
  });

  // The state the Firestore version could not have: consented, but the secret
  // was never set, so no call to YouTube can succeed.
  it('is pending_secret when a channel is recorded but the secret is unset', async () => {
    mockFetch.mockResolvedValueOnce(
      hsSearchResponse([
        {
          id: '801',
          properties: {
            youtube_channel_id: 'UC_test_channel',
            youtube_channel_title: 'Dev Advocacy',
          },
        },
      ]),
    );
    const res = await main(statusContext());
    expect(JSON.parse(res.body)).toMatchObject({
      status: 'pending_secret',
      connected: false,
      hasRefreshTokenSecret: false,
      channelId: 'UC_test_channel',
    });
  });

  it('is connected when the channel and the secret agree', async () => {
    vi.stubEnv('YOUTUBE_REFRESH_TOKEN', '1//refresh');
    mockFetch.mockResolvedValueOnce(
      hsSearchResponse([
        {
          id: '801',
          properties: {
            youtube_channel_id: 'UC_test_channel',
            youtube_connection_status: 'connected',
            youtube_last_sync: '2026-09-08T10:00:00Z',
          },
        },
      ]),
    );
    const res = await main(statusContext());
    expect(JSON.parse(res.body)).toMatchObject({
      status: 'connected',
      connected: true,
      lastSync: '2026-09-08T10:00:00Z',
    });
  });

  // Stored status is history; the secret is the present tense.
  it('downgrades a stored "connected" when the secret has gone', async () => {
    mockFetch.mockResolvedValueOnce(
      hsSearchResponse([
        {
          id: '801',
          properties: {
            youtube_channel_id: 'UC_test_channel',
            youtube_connection_status: 'connected',
          },
        },
      ]),
    );
    const res = await main(statusContext());
    expect(JSON.parse(res.body).status).toBe('pending_secret');
  });

  it('never calls Google', async () => {
    mockFetch.mockResolvedValueOnce(hsSearchResponse([]));
    await main(statusContext());
    expect(urls().every(u => u.startsWith('https://api.hubapi.com'))).toBe(true);
  });
});

describe('YouTubeAuth — disconnect', () => {
  function disconnectContext() {
    return { accountId: PORTAL_ID, body: { action: 'disconnect' } };
  }

  it('revokes at Google and clears the portal state', async () => {
    vi.stubEnv('YOUTUBE_REFRESH_TOKEN', '1//refresh');
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => '' })
      .mockResolvedValueOnce(hsSearchResponse([{ id: '801', properties: {} }]))
      .mockResolvedValueOnce(hsWriteResponse());

    const res = await main(disconnectContext());
    const body = JSON.parse(res.body) as Record<string, unknown>;

    expect(urls()[0]).toBe('https://oauth2.googleapis.com/revoke');
    expect(body.revoked).toBe(true);
    expect(JSON.parse(callBody(2)).properties).toEqual({
      youtube_channel_id: '',
      youtube_channel_title: '',
      youtube_connection_status: 'disconnected',
      youtube_last_sync: '',
    });
  });

  // Revoking is the only part that truly ends access; the secret outlives the
  // call because nothing in the runtime can delete it.
  it('tells the operator the secret still has to go', async () => {
    vi.stubEnv('YOUTUBE_REFRESH_TOKEN', '1//refresh');
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => '' })
      .mockResolvedValueOnce(hsSearchResponse([]))
      .mockResolvedValueOnce(hsWriteResponse());

    const body = JSON.parse((await main(disconnectContext())).body) as Record<string, unknown>;
    expect(body.secretRemovalRequired).toBe(true);
    expect(body.nextStep).toContain('hs secret delete YOUTUBE_REFRESH_TOKEN');
  });

  it('still clears state when there is no token to revoke', async () => {
    mockFetch
      .mockResolvedValueOnce(hsSearchResponse([]))
      .mockResolvedValueOnce(hsWriteResponse());

    const res = await main(disconnectContext());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).revoked).toBe(false);
    expect(urls()).not.toContain('https://oauth2.googleapis.com/revoke');
  });

  it('still clears state when Google refuses the revoke', async () => {
    vi.stubEnv('YOUTUBE_REFRESH_TOKEN', '1//refresh');
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'invalid_token' })
      .mockResolvedValueOnce(hsSearchResponse([]))
      .mockResolvedValueOnce(hsWriteResponse());

    const res = await main(disconnectContext());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).revoked).toBe(false);
  });
});
