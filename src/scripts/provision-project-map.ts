/**
 * Adds the App Config property that holds the Linear project → record type map.
 *
 * Safe to re-run — skips the property if it already exists.
 *
 *   linear_project_map — JSON, Linear project id → 'content' | 'changelog' | 'ignore'
 *
 * Replaces a hardcoded project name in mapping.ts. Classification by label
 * alone was wrong for this workspace: 69 of 83 assigned issues are changelogs
 * by project and not one carries the changelog label.
 *
 * Usage:
 *   PORTAL=prod npm run provision:project-map
 */

import { loadEnv } from './script-env';
import { HS_BASE, propertiesPath } from '../app/lib/hs-api';
import { getPortalConfig } from '../app/lib/portal-config';

/** Read, never derived — the group differs per portal and an id-based guess
 *  matches nothing. See the troubleshooting table in the operator guide. */
async function resolveGroupName(objectTypeId: string, token: string): Promise<string> {
  const res = await fetch(`${HS_BASE}${propertiesPath(objectTypeId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Could not read properties: ${res.status}`);
  const body = (await res.json()) as { results?: Array<{ name: string; groupName?: string }> };
  const groupName = (body.results ?? []).find(p => !p.name.startsWith('hs_') && p.groupName)?.groupName;
  if (!groupName) throw new Error(`Could not determine a property group on ${objectTypeId}.`);
  return groupName;
}

async function main() {
  const { token, portalId, portal } = loadEnv();
  const objectTypeId = getPortalConfig(portalId).appConfig.objectTypeId;

  console.log(`\n[${portal}] Provisioning the project map on ${objectTypeId}...`);
  const groupName = await resolveGroupName(objectTypeId, token);
  console.log(`Property group: ${groupName}`);

  const res = await fetch(`${HS_BASE}${propertiesPath(objectTypeId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: 'linear_project_map',
      label: 'Linear Project Map',
      // textarea: the JSON outgrows a single-line text field once a workspace
      // has more than a handful of projects.
      type: 'string',
      fieldType: 'textarea',
      groupName,
    }),
  });

  if (res.ok) {
    console.log('  ✓ Added linear_project_map\n');
    return;
  }
  const body = await res.text();
  if (res.status === 409 || body.includes('already exists') || body.includes('PROPERTY_ALREADY_EXISTS')) {
    console.log('  – linear_project_map already exists\n');
    return;
  }
  throw new Error(`Failed: ${res.status} ${body.slice(0, 300)}`);
}

main().catch(err => {
  console.error('\nFailed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
