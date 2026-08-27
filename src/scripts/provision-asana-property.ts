/**
 * Adds the asana_task_url property to the existing Content and Changelog
 * custom objects in an already-provisioned HubSpot portal. Safe to re-run
 * — skips properties that already exist.
 *
 * Usage:
 *   export HUBSPOT_PERSONAL_ACCESS_KEY=your-pak-here
 *   npx tsx src/scripts/provision-asana-property.ts
 */

import { Client } from '@hubspot/api-client';
import { loadEnv } from './script-env';

async function addPropertyIfMissing(
  client: Client,
  objectTypeId: string,
  schemaName: string,
  objectLabel: string,
): Promise<void> {
  const groupName = `${schemaName}information`;

  try {
    await (client.crm.properties.coreApi as any).create(objectTypeId, {
      name: 'asana_task_url',
      label: 'Asana Task URL',
      type: 'string',
      fieldType: 'text',
      groupName,
    });
    console.log(`  ✓ Added asana_task_url to ${objectLabel}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('already exists') || msg.includes('PROPERTY_EXISTS') || msg.includes('conflict')) {
      console.log(`  – asana_task_url already exists on ${objectLabel}, skipping`);
    } else {
      throw err;
    }
  }
}

async function main() {
  const { personalKey } = loadEnv();
  const client = new Client({ accessToken: personalKey });

  console.log('Looking up custom object schemas...');
  const schemas = await (client.crm.schemas.coreApi as any).getAll(false);

  const content = schemas.results?.find((s: any) => s.name === 'content_piece');
  const changelog = schemas.results?.find((s: any) => s.name === 'changelog_entry');

  if (!content) {
    console.error('Could not find content_piece object — has this portal been provisioned?');
    process.exit(1);
  }
  if (!changelog) {
    console.error('Could not find changelog_entry object — has this portal been provisioned?');
    process.exit(1);
  }

  console.log(`Found content_piece: ${content.objectTypeId}`);
  console.log(`Found changelog_entry: ${changelog.objectTypeId}`);
  console.log('');

  await addPropertyIfMissing(client, content.objectTypeId, content.name, 'Content Piece');
  await addPropertyIfMissing(client, changelog.objectTypeId, changelog.name, 'Changelog Entry');

  console.log('\nDone.');
}

main();
