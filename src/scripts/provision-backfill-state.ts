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

async function main() {
  const { token, portalId, portal } = loadEnv();
  const objectTypeId = getPortalConfig(portalId).appConfig.objectTypeId;

  console.log(`\n[${portal}] Provisioning backfill state on ${objectTypeId}...`);

  for (const property of PROPERTIES) {
    const res = await fetch(`${HS_BASE}${propertiesPath(objectTypeId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: property.name,
        label: property.label,
        type: 'string',
        fieldType: 'text',
        groupName: `${objectTypeId.replace('-', '')}information`,
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
