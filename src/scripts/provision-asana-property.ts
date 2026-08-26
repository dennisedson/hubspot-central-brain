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

async function addPropertyIfMissing(
  client: Client,
  objectTypeId: string,
  objectLabel: string,
): Promise<void> {
  const groupName = `${objectTypeId.replace('-', '_')}information`;

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
  const pak = process.env.HUBSPOT_PERSONAL_ACCESS_KEY;
  if (!pak) {
    console.error('Error: HUBSPOT_PERSONAL_ACCESS_KEY is not set.');
    console.error('Export it first: export HUBSPOT_PERSONAL_ACCESS_KEY=your-pak-here');
    process.exit(1);
  }

  const client = new Client({ accessToken: pak });

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

  await addPropertyIfMissing(client, content.objectTypeId, 'Content Piece');
  await addPropertyIfMissing(client, changelog.objectTypeId, 'Changelog Entry');

  console.log('\nDone.');
}

main();
