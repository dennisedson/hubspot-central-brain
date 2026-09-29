/**
 * Finds or creates the App Config custom object, and prints the objectTypeId
 * for portal-config.ts.
 *
 * The canonical name is `app_configs` — that is what portal-config.ts maps
 * `appConfig` to and what the deployed app reads. Portals provisioned before
 * the rename carry `app_settings`, so both names are accepted when looking,
 * `app_configs` is preferred when both somehow exist, and only a portal with
 * neither gets a new object.
 *
 * Reads before it writes. The previous version created first and inspected the
 * failure, which had two consequences: a portal that already had the object
 * still attempted a create, and any error that was not literally "already
 * exists" — a 401, say — surfaced as a creation failure rather than as what it
 * was. It also created `app_settings` while the app read `app_configs`, so a
 * freshly provisioned portal got an object nothing ever looked at.
 *
 * Usage:
 *   PORTAL=dev npm run provision:app-settings
 */

import { Client } from '@hubspot/api-client';
import { ObjectTypePropertyCreateTypeEnum } from '@hubspot/api-client/lib/codegen/crm/schemas/models/ObjectTypePropertyCreate';
import { loadEnv } from './script-env';

async function main() {
  const { token, portal } = loadEnv();
  const client = new Client({ accessToken: token });
  console.log(`[${portal}] Resolving App Config custom object...`);

  const schemas = await client.crm.schemas.coreApi.getAll();
  const results = schemas.results ?? [];
  // Prefer the canonical name explicitly. A single find() over both names would
  // return whichever the API happened to list first.
  const existing =
    results.find(s => s.name === 'app_configs') ??
    results.find(s => s.name === 'app_settings');

  let objectTypeId: string;

  if (existing?.objectTypeId) {
    objectTypeId = existing.objectTypeId;
    console.log(`  - ${existing.name} already exists - nothing to create.`);
  } else {
    console.log('  Creating app_configs...');
    const schema = await client.crm.schemas.coreApi.create({
      name: 'app_configs',
      labels: { singular: 'App Config', plural: 'App Configs' },
      primaryDisplayProperty: 'linear_team_id',
      requiredProperties: [],
      properties: [
        {
          name: 'linear_team_id',
          label: 'Linear Team ID',
          type: ObjectTypePropertyCreateTypeEnum.String,
          fieldType: 'text',
          groupName: 'app_configsinformation',
        },
        {
          name: 'assignee_filter',
          label: 'Assignee Filter',
          type: ObjectTypePropertyCreateTypeEnum.String,
          fieldType: 'text',
          groupName: 'app_configsinformation',
        },
        {
          name: 'linear_assignee_id',
          label: 'Linear Assignee ID',
          type: ObjectTypePropertyCreateTypeEnum.String,
          fieldType: 'text',
          groupName: 'app_configsinformation',
        },
      ],
      associatedObjects: [],
    });
    if (!schema.objectTypeId) {
      console.error('Schema created but objectTypeId was not returned.');
      process.exit(1);
    }
    objectTypeId = schema.objectTypeId;
  }

  console.log('\n✓ Done.\n');
  console.log('Paste this into src/app/lib/portal-config.ts for this portal:');
  console.log(`\n  appConfig: { objectTypeId: '${objectTypeId}' },\n`);
}

main();
