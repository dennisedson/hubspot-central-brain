/**
 * Adds the asana_sync_token property to the App Settings (App Config) custom object.
 * Safe to re-run — skips if the property already exists.
 *
 * This property stores the Asana Events API sync token between hourly poll runs.
 *
 * Usage:
 *   export HUBSPOT_PERSONAL_ACCESS_KEY=your-pak-here
 *   npm run provision:asana-sync-token
 *   PORTAL=staging npm run provision:asana-sync-token
 *   PORTAL=prod npm run provision:asana-sync-token
 */

import { Client } from '@hubspot/api-client';
import { loadEnv } from './script-env';

async function main() {
  const { personalKey, portal } = loadEnv();
  const client = new Client({ accessToken: personalKey });

  console.log(`[${portal}] Adding asana_sync_token to App Settings...`);

  const schemas = await (client.crm.schemas.coreApi as any).getAll(false);
  const appSettings = schemas.results?.find((s: any) => s.name === 'app_settings');

  if (!appSettings) {
    console.error('Could not find app_settings object — has this portal been provisioned? Run npm run provision:app-settings first.');
    process.exit(1);
  }

  console.log(`Found app_settings: ${appSettings.objectTypeId}`);

  const groupName = 'app_settingsinformation';

  try {
    await (client.crm.properties.coreApi as any).create(appSettings.objectTypeId, {
      name: 'asana_sync_token',
      label: 'Asana Sync Token',
      type: 'string',
      fieldType: 'text',
      groupName,
    });
    console.log('  ✓ Added asana_sync_token');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('already exists') || msg.includes('PROPERTY_EXISTS') || msg.includes('conflict')) {
      console.log('  – asana_sync_token already exists, skipping');
    } else {
      console.error('Failed to add property:', msg);
      process.exit(1);
    }
  }

  console.log('\nDone. The AsanaPoll workflow action will read and write this property hourly.');
}

main();
