/**
 * Adds the YouTube connection properties to the App Config custom object.
 * Safe to re-run — skips properties that already exist.
 *
 * WHY THIS EXISTS
 * ---------------
 * `src/app/lib/youtube-auth.ts` reads four properties off `app_configs` to know
 * which channel is connected and whether the connection is usable. None of them
 * existed when that module was written, so every read returned undefined and the
 * OAuth flow reported "disconnected" on a portal that had connected fine. The
 * failure is silent in the worst way: the properties API does not error on a
 * read of a property that does not exist, it simply omits it from the response.
 *
 * Properties added:
 *  - youtube_channel_id          — the connected channel's id
 *  - youtube_channel_title       — display name, so the UI need not call YouTube
 *  - youtube_connection_status   — connected | pending_secret | disconnected
 *  - youtube_last_sync           — ISO timestamp of the last successful sync
 *
 * `pending_secret` is why status is stored rather than derived: the channel can
 * be known while YOUTUBE_REFRESH_TOKEN is still unset, and that state must not
 * render as "connected".
 *
 * Usage:
 *   PORTAL=dev npm run provision:youtube-config
 */

import { loadEnv } from './script-env';
import { propertiesPath, schemasPath, HS_BASE } from '../app/lib/hs-api';

interface Schema {
  name: string;
  objectTypeId: string;
}

async function hs(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${HS_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

const PROPERTIES = [
  { name: 'youtube_channel_id', label: 'YouTube Channel ID' },
  { name: 'youtube_channel_title', label: 'YouTube Channel Title' },
  { name: 'youtube_connection_status', label: 'YouTube Connection Status' },
  { name: 'youtube_last_sync', label: 'YouTube Last Sync' },
];

async function ensureProperty(
  token: string,
  objectTypeId: string,
  groupName: string,
  property: { name: string; label: string },
): Promise<void> {
  try {
    await hs(token, 'POST', propertiesPath(objectTypeId), {
      name: property.name,
      label: property.label,
      type: 'string',
      fieldType: 'text',
      groupName,
    });
    console.log(`  ✓ Added ${property.name}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('already exists') || msg.includes('PROPERTY_EXISTS') || msg.includes('409')) {
      console.log(`  – ${property.name} already exists, skipping`);
    } else {
      throw err;
    }
  }
}

async function main(): Promise<void> {
  const { token, portal } = loadEnv();
  console.log(`[${portal}] Provisioning YouTube config properties...`);

  const schemas = (await hs(token, 'GET', `${schemasPath()}?limit=100`)) as unknown as {
    results?: Schema[];
  };
  const list = schemas.results ?? [];
  // Prefer the canonical name, as the other App Config scripts do — a single
  // find() across both names returns whichever the API listed first.
  const appConfig =
    list.find((s) => s.name === 'app_configs') ?? list.find((s) => s.name === 'app_settings');

  if (!appConfig?.objectTypeId) {
    console.error('Could not find app_configs/app_settings. Run npm run provision:app-settings first.');
    process.exit(1);
  }

  console.log(`App Config objectTypeId: ${appConfig.objectTypeId}`);

  // Read the group off an existing property rather than deriving it from the
  // object name. Deriving gives `app_configsinformation`; the real group is
  // `app_configs_information`, and HubSpot rejects a property whose group does
  // not exist rather than creating it. Reading also survives the app_settings
  // -> app_configs rename without a second special case.
  const existing = (await hs(
    token,
    'GET',
    propertiesPath(appConfig.objectTypeId),
  )) as unknown as { results?: Array<{ name: string; groupName?: string }> };
  const groupName = (existing.results ?? []).find(
    (prop) => !prop.name.startsWith('hs_') && prop.groupName,
  )?.groupName;

  if (!groupName) {
    console.error(`Could not determine a property group on ${appConfig.objectTypeId}.`);
    process.exit(1);
  }
  console.log(`Property group: ${groupName}`);

  for (const property of PROPERTIES) {
    await ensureProperty(token, appConfig.objectTypeId, groupName, property);
  }

  console.log('\nDone. youtube-auth.ts can now read and write the connection state.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
