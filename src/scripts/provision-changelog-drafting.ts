/**
 * Properties the changelog drafting card needs, across two objects.
 *
 * On content_piece, per changelog record:
 *   changelog_draft       — the draft text itself
 *   changelog_draft_mode  — which shape it is: 'standalone' | 'rollup'
 *
 * On the App Config record, once per portal:
 *   changelog_prompt_standalone — override for the standalone system prompt
 *   changelog_prompt_rollup     — override for the digest-entry system prompt
 *
 * The drafts deliberately do NOT go in `notes`. That property holds the Linear
 * issue description and is rewritten on every webhook, so anything a person
 * wrote there would be destroyed the next time the issue moved.
 *
 * The prompt overrides start empty and are meant to stay empty. Resolution
 * falls back to the defaults in src/app/lib/changelog-prompts.ts, so a portal
 * that has not deliberately customised its wording keeps receiving
 * improvements to the shipped prompt. Writing the default into the property
 * would freeze that portal at today's text, silently.
 *
 * Safe to re-run — skips any property that already exists.
 *
 * Usage:
 *   PORTAL=dev npm run provision:changelog-drafting
 *   PORTAL=prod npm run provision:changelog-drafting
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
  if (!res.ok) throw new Error(`Could not read properties on ${objectTypeId}: ${res.status}`);
  const body = (await res.json()) as { results?: Array<{ name: string; groupName?: string }> };
  const groupName = (body.results ?? []).find(p => !p.name.startsWith('hs_') && p.groupName)?.groupName;
  if (!groupName) throw new Error(`Could not determine a property group on ${objectTypeId}.`);
  return groupName;
}

interface PropertySpec {
  name: string;
  label: string;
  fieldType: 'textarea' | 'select';
  type: 'string' | 'enumeration';
  options?: Array<{ label: string; value: string; displayOrder: number; hidden: boolean }>;
}

async function addProperties(objectTypeId: string, specs: PropertySpec[], token: string) {
  const groupName = await resolveGroupName(objectTypeId, token);
  console.log(`\n  ${objectTypeId} — property group: ${groupName}`);

  for (const spec of specs) {
    const res = await fetch(`${HS_BASE}${propertiesPath(objectTypeId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...spec, groupName }),
    });

    if (res.ok) { console.log(`    ✓ Added ${spec.name}`); continue; }
    const body = await res.text();
    if (res.status === 409 || body.includes('already exists') || body.includes('PROPERTY_ALREADY_EXISTS')) {
      console.log(`    – ${spec.name} already exists`); continue;
    }
    throw new Error(`Failed to add ${spec.name}: ${res.status} ${body.slice(0, 300)}`);
  }
}

async function main() {
  const { token, portalId, portal } = loadEnv();
  const config = getPortalConfig(portalId);

  console.log(`\n[${portal}] Provisioning changelog drafting on portal ${portalId}...`);

  await addProperties(config.content.objectTypeId, [
    {
      name: 'changelog_draft',
      label: 'Changelog Draft',
      type: 'string',
      // textarea: a standalone post runs to several paragraphs plus a meta
      // description and a checklist.
      fieldType: 'textarea',
    },
    {
      name: 'changelog_draft_mode',
      label: 'Changelog Draft Mode',
      type: 'enumeration',
      fieldType: 'select',
      options: [
        { label: 'Standalone post', value: 'standalone', displayOrder: 0, hidden: false },
        { label: 'Rollup entry', value: 'rollup', displayOrder: 1, hidden: false },
      ],
    },
  ], token);

  await addProperties(config.appConfig.objectTypeId, [
    { name: 'changelog_prompt_standalone', label: 'Changelog Prompt — Standalone', type: 'string', fieldType: 'textarea' },
    { name: 'changelog_prompt_rollup', label: 'Changelog Prompt — Rollup', type: 'string', fieldType: 'textarea' },
  ], token);

  console.log('\n✓ Done. Prompt overrides start empty on purpose — empty means "use the shipped default".\n');
}

main().catch(err => {
  console.error('\nFailed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
