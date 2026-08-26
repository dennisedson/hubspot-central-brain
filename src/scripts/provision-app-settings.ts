/**
 * Creates the App Settings custom object in a HubSpot portal.
 * Run once per portal (staging, prod) to get the objectTypeId for portal-config.ts.
 *
 * Usage:
 *   export HUBSPOT_PERSONAL_ACCESS_KEY=your-pak-here
 *   npx tsx src/scripts/provision-app-settings.ts
 */

import { Client } from '@hubspot/api-client';
import { ObjectTypePropertyCreateTypeEnum } from '@hubspot/api-client/lib/codegen/crm/schemas/models/ObjectTypePropertyCreate';

async function main() {
  const pak = process.env.HUBSPOT_PERSONAL_ACCESS_KEY;
  if (!pak) {
    console.error('Error: HUBSPOT_PERSONAL_ACCESS_KEY is not set.');
    console.error('Export it first: export HUBSPOT_PERSONAL_ACCESS_KEY=your-pak-here');
    process.exit(1);
  }

  const client = new Client({ accessToken: pak });

  console.log('Creating App Settings custom object...');

  let objectTypeId: string;

  try {
    const schema = await client.crm.schemas.coreApi.create({
      name: 'app_settings',
      labels: { singular: 'App Settings', plural: 'App Settings' },
      primaryDisplayProperty: 'linear_team_id',
      requiredProperties: [],
      properties: [
        {
          name: 'linear_team_id',
          label: 'Linear Team ID',
          type: ObjectTypePropertyCreateTypeEnum.String,
          fieldType: 'text',
          groupName: 'app_settingsinformation',
        },
        {
          name: 'assignee_filter',
          label: 'Assignee Filter',
          type: ObjectTypePropertyCreateTypeEnum.String,
          fieldType: 'text',
          groupName: 'app_settingsinformation',
        },
        {
          name: 'linear_assignee_id',
          label: 'Linear Assignee ID',
          type: ObjectTypePropertyCreateTypeEnum.String,
          fieldType: 'text',
          groupName: 'app_settingsinformation',
        },
      ],
      associatedObjects: [],
    });
    objectTypeId = schema.objectTypeId!;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('already exists') || msg.includes('OBJECT_TYPE_EXISTS')) {
      console.log('Object already exists — fetching existing objectTypeId...');
      const schemas = await client.crm.schemas.coreApi.getAll();
      const existing = schemas.results.find(s => s.name === 'app_settings');
      if (!existing?.objectTypeId) {
        console.error('Could not find existing app_settings object.');
        process.exit(1);
      }
      objectTypeId = existing.objectTypeId;
    } else {
      console.error('Failed to create schema:', msg);
      process.exit(1);
    }
  }

  console.log('\n✓ Done.\n');
  console.log('Paste this into src/app/lib/portal-config.ts for this portal:');
  console.log(`\n  appConfig: { objectTypeId: '${objectTypeId}' },\n`);
}

main();
