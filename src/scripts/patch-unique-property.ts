/**
 * Ensures content_piece has a unique `linear_id` property for atomic upserts.
 * Also restores `linear_issue_id` (non-unique) if it was deleted by a previous run.
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

async function ensureProperty(
  token: string,
  objectTypeId: string,
  name: string,
  label: string,
  unique: boolean,
) {
  try {
    const existing = await hs(token, 'GET', `/crm/v3/properties/${objectTypeId}/${name}`);
    if (existing.hasUniqueValue === unique) {
      console.log(`  – ${name} already exists (hasUniqueValue=${existing.hasUniqueValue})`);
    } else {
      console.log(`  ! ${name} exists but hasUniqueValue=${existing.hasUniqueValue} (wanted ${unique}) — cannot change on existing property`);
    }
  } catch {
    const created = await hs(token, 'POST', `/crm/v3/properties/${objectTypeId}`, {
      name,
      label,
      type: 'string',
      fieldType: 'text',
      groupName: 'content_pieceinformation',
      hasUniqueValue: unique,
    });
    console.log(`  ✓ Created ${created.name} (hasUniqueValue=${created.hasUniqueValue})`);
  }
}

async function main() {
  const token = process.env.HUBSPOT_ACCESS_KEY;
  if (!token) { console.error('HUBSPOT_ACCESS_KEY is not set.'); process.exit(1); }

  const portal = process.env.PORTAL ?? 'dev';
  const objectTypeId = OBJECT_TYPE_IDS[portal];
  if (!objectTypeId) { console.error(`Unknown portal "${portal}". Use PORTAL=dev|staging|prod`); process.exit(1); }

  console.log(`[${portal}] Ensuring unique linear_id property on ${objectTypeId}`);

  // Restore linear_issue_id (non-unique) if missing
  await ensureProperty(token, objectTypeId, 'linear_issue_id', 'Linear Issue ID', false);

  // Create linear_id (unique) — the atomic upsert key
  await ensureProperty(token, objectTypeId, 'linear_id', 'Linear ID (unique)', true);

  console.log('\nDone.');
}

main().catch(err => { console.error(err.message); process.exit(1); });
