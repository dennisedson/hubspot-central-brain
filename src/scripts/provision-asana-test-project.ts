/**
 * Mirrors sections and custom fields from BuildRel | Advocacy Content Factory
 * into the Dennis-Staging test project.
 *
 * Usage:
 *   ASANA_API_KEY=your-pat npm run provision:asana-test-project
 */

import { loadEnv } from './script-env';

const TEST_PROJECT_GID = '1217881318437204';

const SECTIONS_TO_CREATE = [
  'Community-Led',
  'Developer Website',
  'Developer Blog',
  'Developer YouTube',
  'Developer Changelog',
  'Backlog',
  'Completed',
];

// Workspace-level custom field GIDs to add from the real project
const FIELDS_TO_ADD = [
  { gid: '1202184607659964', name: 'Pipeline Stage' },
  { gid: '1213736210804469', name: 'Linear Issue URL' },
  { gid: '1202184607689324', name: 'Editorial Approach' },
  { gid: '1202184607769116', name: 'Platforms of Engagement' },
  { gid: '1204414681846303', name: 'Associated Advocate' },
  { gid: '1213736254001606', name: 'Priority Range' },
  { gid: '1213740248897014', name: 'Request Type' },
  { gid: '1213315034956656', name: 'Launch Stage' },
  { gid: '1213739365989760', name: 'Guest Post' },
  { gid: '1202341796873286', name: 'Published URL' },
  { gid: '1203652224515274', name: 'Final URL' },
  { gid: '1216763729007303', name: 'Audience' },
];

async function asana(apiKey: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`https://app.asana.com/api/1.0${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify({ data: body }) : undefined,
  });
  const json = await res.json() as any;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json)}`);
  return json.data;
}

async function main() {
  const { asanaApiKey: apiKey } = loadEnv();

  // 1. Get existing sections so we don't duplicate
  console.log('Fetching existing sections...');
  const existingSections = await asana(apiKey, 'GET', `/projects/${TEST_PROJECT_GID}/sections`) as any[];
  const existingNames = new Set(existingSections.map((s: any) => s.name));
  console.log(`  Found: ${[...existingNames].join(', ')}`);

  // 2. Create missing sections
  console.log('\nCreating sections...');
  const sectionGids: Record<string, string> = {};
  for (const s of existingSections) sectionGids[s.name] = s.gid;

  for (const name of SECTIONS_TO_CREATE) {
    if (existingNames.has(name)) {
      console.log(`  – "${name}" already exists (${sectionGids[name]})`);
    } else {
      const created = await asana(apiKey, 'POST', `/projects/${TEST_PROJECT_GID}/sections`, { name }) as any;
      sectionGids[name] = created.gid;
      console.log(`  ✓ Created "${name}" (${created.gid})`);
    }
  }

  // 3. Add custom fields
  console.log('\nAdding custom fields...');
  for (const field of FIELDS_TO_ADD) {
    const res = await fetch(`https://app.asana.com/api/1.0/projects/${TEST_PROJECT_GID}/addCustomFieldSetting`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { custom_field: field.gid, is_important: true } }),
    });
    const json = await res.json() as any;
    if (!res.ok) {
      const msg = JSON.stringify(json);
      if (msg.includes('already') || msg.includes('duplicate')) {
        console.log(`  – "${field.name}" already on project`);
      } else {
        console.error(`  ✗ "${field.name}" failed: ${msg}`);
      }
    } else {
      console.log(`  ✓ Added "${field.name}"`);
    }
  }

  // 4. Print section GID map for portal-config
  console.log('\n--- Section GIDs (add to portal-config) ---');
  for (const name of ['Queue', ...SECTIONS_TO_CREATE]) {
    if (sectionGids[name]) console.log(`  ${name}: '${sectionGids[name]}'`);
  }
  console.log('\nDone.');
}

main();
