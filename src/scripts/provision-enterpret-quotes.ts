/**
 * Adds the enterpret_quotes property to the Content custom object.
 *
 * Enterpret data reaches HubSpot out-of-band — synced from an Enterpret MCP
 * connection rather than fetched live by the serverless function. HubSpot's
 * runtime cannot reach an MCP server, and no Enterpret API key is obtainable,
 * so the card reads stored properties instead of calling out. See issue #12.
 *
 * The property holds a JSON array of quote objects:
 *   [{"text":"...","source":"...","sentiment":"negative","createdAt":"..."}]
 *
 * Safe to re-run — skips the property if it already exists.
 *
 * Usage:
 *   npx tsx src/scripts/provision-enterpret-quotes.ts
 *   PORTAL=staging npx tsx src/scripts/provision-enterpret-quotes.ts
 *   PORTAL=prod    npx tsx src/scripts/provision-enterpret-quotes.ts
 */

import { loadEnv } from './script-env';
import { getPortalConfig } from '../app/lib/portal-config';
import { HS_BASE, propertiesPath } from '../app/lib/hs-api';

const PROPERTY = {
  name: 'enterpret_quotes',
  label: 'Enterpret Quotes',
  description:
    'Developer quotes from Enterpret for this content piece, as a JSON array. Synced out-of-band; read by the Enterpret Insights card.',
  type: 'string',
  fieldType: 'textarea',
};

async function main(): Promise<void> {
  const { portal, portalId, token } = loadEnv();
  const objectTypeId = getPortalConfig(portalId).content.objectTypeId;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  console.log(`[${portal}] portal ${portalId} — content_piece ${objectTypeId}`);

  const existing = await fetch(
    `${HS_BASE}${propertiesPath(objectTypeId, PROPERTY.name)}`,
    { headers },
  );
  if (existing.ok) {
    console.log(`  – ${PROPERTY.name} already exists — nothing to do`);
    return;
  }
  if (existing.status !== 404) {
    console.error(`  ✗ Unexpected ${existing.status} reading property: ${await existing.text()}`);
    process.exit(1);
  }

  // Reuse whichever group the existing enterpret_theme property lives in, so
  // the new field lands beside it rather than in a group of its own.
  let groupName = 'content_pieceinformation';
  const sibling = await fetch(
    `${HS_BASE}${propertiesPath(objectTypeId, 'enterpret_theme')}`,
    { headers },
  );
  if (sibling.ok) {
    const body = (await sibling.json()) as { groupName?: string };
    if (body.groupName) groupName = body.groupName;
  }

  const res = await fetch(`${HS_BASE}${propertiesPath(objectTypeId)}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...PROPERTY, groupName }),
  });
  if (!res.ok) {
    console.error(`  ✗ Create failed ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  console.log(`  ✓ Created ${PROPERTY.name} in group "${groupName}"`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
