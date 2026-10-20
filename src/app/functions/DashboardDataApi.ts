import { verifySharedSecret } from '../lib/shared-secret';
import { main as contentData } from './ContentDataApi';
import { main as appSettings } from './AppSettingsApi';

/**
 * The one public door the CMS dashboard theme is allowed through.
 *
 * WHY THIS EXISTS
 * ---------------
 * The theme in `src/theme/` server-renders in HubSpot's CMS, where
 * `hubspot.serverless()` does not exist, so it can only reach data over an
 * HTTP URL. For months that meant `content_data_api` and `app_settings_api`
 * published unauthenticated endpoints — and `app_settings_api` answers
 * `saveSettings` and `backfill`, so anyone who knew the path could write to
 * the portal.
 *
 * Those two could not simply require a secret, because the CRM cards and the
 * Content Command Center page call them too, through `hubspot.serverless()`,
 * and a UI extension runs in the user's browser with nowhere safe to keep one.
 *
 * So the surfaces are split. Those two are private now, reachable only by uid.
 * This function is the only thing with a URL, it is read-only, and it demands
 * a shared secret that the theme reads via `getSecret()` during SSR.
 */

interface DashboardContext {
  accountId?: number;
  params?: Record<string, string | string[] | undefined>;
  parameters?: Record<string, string | undefined>;
  query?: Record<string, string | undefined>;
  body?: Record<string, string | undefined>;
}

function param(ctx: DashboardContext, key: string): string | undefined {
  // HubSpot delivers URL query params in `params` as ARRAYS, not strings.
  const q = ctx.params?.[key];
  const fromQuery = Array.isArray(q) ? q[0] : q;
  return fromQuery ?? ctx.parameters?.[key] ?? ctx.query?.[key] ?? ctx.body?.[key];
}

export async function main(context: DashboardContext): Promise<{ statusCode: number; body: string }> {
  const expected = process.env.DASHBOARD_SHARED_SECRET;
  if (!expected) {
    // Never fail open. A missing secret is a broken deploy, not permission.
    console.error('DASHBOARD_SHARED_SECRET is not set');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfiguration' }) };
  }
  if (!verifySharedSecret(param(context, 'secret'), expected)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const portalId = param(context, 'portalId') ?? String(context.accountId ?? '');
  if (!portalId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'portalId is required' }) };
  }

  // Called in-process rather than over HTTP: these are now private functions
  // with no URL to call, and a round trip would spend the 20s budget twice.
  const [pipeline, settings] = await Promise.all([
    contentData({ parameters: { portalId } }),
    appSettings({ parameters: { action: 'getSettings', portalId } }),
  ]);

  // The dashboard renders both panels together, so a half answer is a wrong
  // answer — it would paint "0 active records" as though that were the truth.
  if (pipeline.statusCode !== 200) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Content pipeline unavailable' }) };
  }
  if (settings.statusCode !== 200) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Settings unavailable' }) };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      pipeline: JSON.parse(pipeline.body) as unknown,
      settings: JSON.parse(settings.body) as unknown,
    }),
  };
}
