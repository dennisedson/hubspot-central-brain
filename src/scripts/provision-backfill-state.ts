/**
 * Adds the two App Config properties the resumable Linear import stores its
 * position in.
 *
 * Safe to re-run — skips properties that already exist.
 *
 *   linear_backfill_cursor — Linear's endCursor for the next page, or empty
 *                            when the import has finished
 *   linear_backfill_count  — how many records the import has written so far
 *
 * The cursor is what makes the import resumable: a browser closed halfway
 * leaves it set, and the next run continues from there rather than starting
 * over or re-walking pages it has already done.
 *
 * Usage:
 *   PORTAL=prod npm run provision:backfill-state
 */

import { loadEnv } from './script-env';
import { HS_BASE, propertiesPath } from '../app/lib/hs-api';
import { getPortalConfig } from '../app/lib/portal-config';

const PROPERTIES = [
  { name: 'linear_backfill_cursor', label: 'Linear Backfill Cursor' },
  { name: 'linear_backfill_count', label: 'Linear Backfill Count' },
];

/**
 * The property group to create these in, READ rather than derived.
 *
 * Deriving it is a documented trap on this project: the group is
 * `app_configs_information`, not `app_configsinformation`, and an id-based
 * guess like `268071489information` does not exist at all. Reading the group
 * off an existing non-`hs_` property also survives the portals where the object
 * is named `app_settings` rather than `app_configs`.
 */
async function resolveGroupName(objectTypeId: string, token: string): Promise<string> {
  const res = await fetch(`${HS_BASE}${propertiesPath(objectTypeId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Could not read properties: ${res.status} ${(await res.text()).slice(0, 200)}`);

  const body = (await res.json()) as { results?: Array<{ name: string; groupName?: string }> };
  const groupName = (body.results ?? []).find(p => !p.name.startsWith('hs_') && p.groupName)?.groupName;
  if (!groupName) throw new Error(`Could not determine a property group on ${objectTypeId}.`);
  return groupName;
}

async function main() {
  const { token, portalId, portal } = loadEnv();
  const objectTypeId = getPortalConfig(portalId).appConfig.objectTypeId;

  console.log(`\n[${portal}] Provisioning backfill state on ${objectTypeId}...`);
  const groupName = await resolveGroupName(objectTypeId, token);
  console.log(`Property group: ${groupName}`);

  for (const property of PROPERTIES) {
    const res = await fetch(`${HS_BASE}${propertiesPath(objectTypeId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: property.name,
        label: property.label,
        type: 'string',
        fieldType: 'text',
        groupName,
      }),
    });

    if (res.ok) {
      console.log(`  ✓ Added ${property.name}`);
      continue;
    }

    const body = await res.text();
    if (res.status === 409 || body.includes('already exists') || body.includes('PROPERTY_ALREADY_EXISTS')) {
      console.log(`  – ${property.name} already exists`);
      continue;
    }
    throw new Error(`Failed to add ${property.name}: ${res.status} ${body.slice(0, 300)}`);
  }

  console.log('\nDone.\n');
}

main().catch(err => {
  console.error('\nFailed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
