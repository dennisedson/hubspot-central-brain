/**
 * Adds Fellow sync properties to the App Config and Projects objects.
 * Safe to re-run — skips properties that already exist.
 *
 * Properties added:
 *  - App Config: fellow_last_sync (string) — ISO timestamp of last successful sync
 *  - Projects: fellow_action_item_id (string) — dedup key linking a project to a Fellow action item
 *
 * Usage:
 *   npm run provision:fellow-sync
 *   PORTAL=staging npm run provision:fellow-sync
 *   PORTAL=prod npm run provision:fellow-sync
 */

import { loadEnv } from './script-env';

const API = 'https://api.hubapi.com';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function hs(token: string, method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

async function ensureProperty(
  token: string,
  objectTypeId: string,
  groupName: string,
  property: { name: string; label: string },
): Promise<void> {
  try {
    await hs(token, 'POST', `/crm/v3/properties/${objectTypeId}`, {
      name: property.name,
      label: property.label,
      type: 'string',
      fieldType: 'text',
      groupName,
    });
    console.log(`  ✓ Added ${property.name} to ${objectTypeId}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('already exists') || msg.includes('PROPERTY_EXISTS') || msg.includes('409')) {
      console.log(`  – ${property.name} already exists, skipping`);
    } else {
      throw err;
    }
  }
}

async function main() {
  const { token, portal } = loadEnv();
  console.log(`[${portal}] Provisioning Fellow sync properties...`);

  // Find the App Config schema to get its group name
  const schemas = await hs(token, 'GET', '/crm/v3/schemas?limit=100');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const appSettings = (schemas.results ?? []).find((s: any) => s.name === 'app_configs' || s.name === 'app_settings');
  if (!appSettings) {
    console.error('Could not find app_configs/app_settings schema. Run npm run provision:app-settings first.');
    process.exit(1);
  }

  const appConfigObjectTypeId = appSettings.objectTypeId as string;
  const appConfigGroupName = `${appSettings.name}_information` as string;
  console.log(`App Config objectTypeId: ${appConfigObjectTypeId}`);

  // App Config: fellow_last_sync
  await ensureProperty(token, appConfigObjectTypeId, appConfigGroupName, {
    name: 'fellow_last_sync',
    label: 'Fellow Last Sync',
  });

  // Projects: fellow_action_item_id
  // Uses crm.schemas.projects.write scope (publicly available, unlike Tasks schema)
  await ensureProperty(token, 'projects', 'project_information', {
    name: 'fellow_action_item_id',
    label: 'Fellow Action Item ID',
  });

  console.log('\nDone. The FellowSync workflow action will read/write fellow_last_sync daily.');
}

main().catch(err => { console.error('\nFailed:', err.message); process.exit(1); });
