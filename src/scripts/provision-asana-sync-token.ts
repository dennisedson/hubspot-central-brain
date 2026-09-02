/**
 * Adds the asana_sync_token property to the App Settings (App Config) custom object.
 * Safe to re-run — skips if the property already exists.
 *
 * This property stores the Asana Events API sync token between daily poll runs.
 *
 * Usage:
 *   npm run provision:asana-sync-token
 *   PORTAL=staging npm run provision:asana-sync-token
 *   PORTAL=prod npm run provision:asana-sync-token
 */

import { loadEnv } from './script-env';
import { HS_BASE, propertiesPath, schemasPath } from '../app/lib/hs-api';

const API = HS_BASE;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function hs(token: string, method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  return json;
}

async function main() {
  const { token, portal } = loadEnv();

  console.log(`[${portal}] Adding asana_sync_token to App Settings...`);

  const schemas = await hs(token, 'GET', `${schemasPath()}?limit=100`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const appSettings = (schemas.results ?? []).find((s: any) => s.name === 'app_configs' || s.name === 'app_settings');

  if (!appSettings) {
    console.error('Could not find app_configs/app_settings object — has this portal been provisioned? Run npm run provision:app-settings first.');
    process.exit(1);
  }

  const objectTypeId = appSettings.objectTypeId;
  console.log(`Found app_settings: ${objectTypeId}`);

  try {
    await hs(token, 'POST', propertiesPath(objectTypeId), {
      name: 'asana_sync_token',
      label: 'Asana Sync Token',
      type: 'string',
      fieldType: 'text',
      groupName: `${appSettings.name}_information`,
    });
    console.log('  ✓ Added asana_sync_token');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('already exists') || msg.includes('PROPERTY_EXISTS') || msg.includes('409')) {
      console.log('  – asana_sync_token already exists, skipping');
    } else {
      console.error('Failed to add property:', msg);
      process.exit(1);
    }
  }

  console.log('\nDone. The AsanaPoll workflow action will read and write this property daily.');
}

main().catch(err => { console.error('\nFailed:', err.message); process.exit(1); });
