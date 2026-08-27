/**
 * Recreates linear_issue_id on content_piece with hasUniqueValue: true.
 * Deletes the existing property first (loses stored values on existing records),
 * then recreates it with the unique constraint.
 *
 * Usage:
 *   HUBSPOT_ACCESS_KEY=your-key npm run patch:unique-property
 *   HUBSPOT_ACCESS_KEY=your-key PORTAL=staging npm run patch:unique-property
 *   HUBSPOT_ACCESS_KEY=your-key PORTAL=prod npm run patch:unique-property
 */

const OBJECT_TYPE_IDS: Record<string, string> = {
  dev:     '2-67505887',
  staging: '2-67508770',
  prod:    '2-67508928',
};

const PROPERTY_NAME = 'linear_issue_id';
const API = 'https://api.hubapi.com';

async function hs(token: string, method: string, path: string, body?: unknown) {
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
  const token = process.env.HUBSPOT_ACCESS_KEY;
  if (!token) { console.error('HUBSPOT_ACCESS_KEY is not set.'); process.exit(1); }

  const portal = process.env.PORTAL ?? 'dev';
  const objectTypeId = OBJECT_TYPE_IDS[portal];
  if (!objectTypeId) { console.error(`Unknown portal "${portal}". Use PORTAL=dev|staging|prod`); process.exit(1); }

  console.log(`[${portal}] Recreating ${PROPERTY_NAME} on ${objectTypeId} with hasUniqueValue=true`);

  // 1. Remove from requiredProperties if present
  console.log('  Checking schema required properties...');
  const schema = await hs(token, 'GET', `/crm/v3/schemas/${objectTypeId}`);
  const required: string[] = schema.requiredProperties ?? [];
  if (required.includes(PROPERTY_NAME)) {
    const updated = required.filter((p: string) => p !== PROPERTY_NAME);
    await hs(token, 'PATCH', `/crm/v3/schemas/${objectTypeId}`, { requiredProperties: updated });
    console.log(`  ✓ Removed from requiredProperties`);
  } else {
    console.log(`  – Not in requiredProperties, skipping`);
  }

  // 2. Delete existing property
  console.log('  Deleting existing property...');
  await hs(token, 'DELETE', `/crm/v3/properties/${objectTypeId}/${PROPERTY_NAME}`);
  console.log('  ✓ Deleted');

  // 2. Recreate with hasUniqueValue: true
  console.log('  Recreating with hasUniqueValue: true...');
  const created = await hs(token, 'POST', `/crm/v3/properties/${objectTypeId}`, {
    name: PROPERTY_NAME,
    label: 'Linear Issue ID',
    type: 'string',
    fieldType: 'text',
    groupName: 'content_pieceinformation',
    hasUniqueValue: true,
  });
  console.log(`  ✓ Created: ${created.name} hasUniqueValue=${created.hasUniqueValue}`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
