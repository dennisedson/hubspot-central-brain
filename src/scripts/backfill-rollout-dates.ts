/**
 * Writes rollout dates onto changelog records that predate the properties.
 *
 * New syncs carry them automatically. The records already in HubSpot do not,
 * and nothing re-syncs an issue that has not changed — so without this the
 * pipeline would stay unsorted until each issue happened to be touched.
 *
 * Dry run by default. Nothing is written without --apply.
 *
 * Usage:
 *   PORTAL=prod npm run backfill:rollout-dates
 *   PORTAL=prod npm run backfill:rollout-dates -- --apply
 */

import { loadEnv } from './script-env';
import { HS_BASE, objectPath, objectSearchPath } from '../app/lib/hs-api';
import { getPortalConfig } from '../app/lib/portal-config';
import { rolloutProperties } from '../app/lib/changelog-source';

interface Record_ { id: string; properties: Record<string, string | null> }

async function readAll(objectTypeId: string, pipelineId: string, token: string): Promise<Record_[]> {
  const out: Record_[] = [];
  let after = '0';
  for (;;) {
    const res = await fetch(`${HS_BASE}${objectSearchPath(objectTypeId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: 'hs_pipeline', operator: 'EQ', value: pipelineId }] }],
        properties: ['title', 'notes', 'rollout_priority_date'],
        limit: 100,
        after,
      }),
    });
    if (!res.ok) throw new Error(`Search failed ${res.status}: ${await res.text()}`);
    const body = await res.json() as { results: Record_[]; paging?: { next?: { after: string } } };
    out.push(...body.results);
    const next = body.paging?.next?.after;
    if (!next) break;
    after = next;
  }
  return out;
}

async function main() {
  const { token, portalId, portal } = loadEnv();
  const apply = process.argv.includes('--apply');
  const config = getPortalConfig(portalId);

  const records = await readAll(
    config.content.objectTypeId,
    config.content.pipelines.changelog.pipelineId,
    token,
  );

  console.log(`\n[${portal}] ${records.length} changelog record(s)${apply ? '' : ' — DRY RUN'}\n`);

  let toWrite = 0, unchanged = 0, noDates = 0;
  const planned: Array<{ id: string; title: string; props: Record<string, string> }> = [];

  for (const record of records) {
    const props = rolloutProperties(record.properties.notes);
    const title = (record.properties.title ?? '').slice(0, 44);

    // null means the notes carry no dates. Skipping rather than writing blanks
    // is what keeps this from erasing a date typed into HubSpot by hand.
    if (!props || !props.rollout_priority_date) { noDates++; continue; }
    // Already correct — do not spend a write on it.
    if (record.properties.rollout_priority_date?.slice(0, 10) === props.rollout_priority_date) {
      unchanged++; continue;
    }
    toWrite++;
    planned.push({ id: record.id, title, props });
    console.log(`  ${props.rollout_priority_date}  ${props.rollout_priority_stage.padEnd(18)} ${title}`);
  }

  console.log(`\n  to write: ${toWrite}   already correct: ${unchanged}   no usable date: ${noDates}`);

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to write.\n');
    return;
  }

  let written = 0;
  const errors: string[] = [];
  for (const item of planned) {
    const res = await fetch(`${HS_BASE}${objectPath(config.content.objectTypeId, item.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ properties: item.props }),
    });
    if (res.ok) written++;
    else errors.push(`${item.title}: ${res.status} ${(await res.text()).slice(0, 120)}`);
  }

  console.log(`\n  written: ${written}`);
  for (const e of errors) console.log(`  FAILED ${e}`);
  console.log();
}

main().catch(err => {
  console.error('\nFailed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
