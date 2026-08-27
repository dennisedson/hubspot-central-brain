/**
 * Marks linear_issue_id as a unique property on content_piece.
 * Run AFTER deleting any duplicate records — HubSpot rejects this if duplicates exist.
 *
 * Usage:
 *   HUBSPOT_ACCESS_KEY=your-key npm run patch:unique-property
 */

const OBJECT_TYPE_IDS: Record<string, string> = {
  dev: '2-67505887',
  staging: '2-67508770',
  prod: '2-67508928',
};

async function patchProperty(token: string, objectTypeId: string, portalName: string) {
  console.log(`\n[${portalName}] Patching linear_issue_id on ${objectTypeId}...`);
  const res = await fetch(
    `https://api.hubapi.com/crm/v3/properties/${objectTypeId}/linear_issue_id`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ hasUniqueValue: true }),
    },
  );
  const json = await res.json() as { name?: string; hasUniqueValue?: boolean; message?: string };
  if (!res.ok) {
    console.error(`  ✗ Failed (${res.status}): ${json.message}`);
    if (res.status === 409 || (json.message ?? '').toLowerCase().includes('duplicate')) {
      console.error('  → Delete duplicate records first, then re-run.');
    }
  } else {
    console.log(`  ✓ ${json.name} hasUniqueValue=${json.hasUniqueValue}`);
  }
}

async function main() {
  const token = process.env.HUBSPOT_ACCESS_KEY;
  if (!token) {
    console.error('HUBSPOT_ACCESS_KEY is not set.');
    process.exit(1);
  }

  const portal = process.env.PORTAL ?? 'dev';
  const objectTypeId = OBJECT_TYPE_IDS[portal];
  if (!objectTypeId) {
    console.error(`Unknown portal "${portal}". Use PORTAL=dev|staging|prod`);
    process.exit(1);
  }

  await patchProperty(token, objectTypeId, portal);
}

main();
