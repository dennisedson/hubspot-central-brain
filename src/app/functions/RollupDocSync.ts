import { listRollupReleases } from '../lib/linear-client';
import { searchAll, batchUpdate, BATCH_UPDATE_LIMIT, type HsRow } from '../lib/hubspot-client';
import { planSweep, decideEntry, type SweepPlan } from '../lib/rollup-doc';
import { verifySharedSecret } from '../lib/shared-secret';
import { getPortalConfig } from '../lib/portal-config';

/**
 * The daily rollup sweep: puts each rollup release's name and digest doc on my
 * entries in it, and clears the ones that have gone stale. A rollup release is
 * any release in Linear's "Monthly Changelog Rollups" pipeline — monthly
 * rollups and Spotlights alike.
 *
 * WHY A SWEEP AS WELL AS THE WEBHOOK
 * ---------------------------------
 * The webhook hears about an issue when the issue changes. Two things change
 * the answer without touching any issue: the digest owner attaching the doc to
 * the release, and a scheduled release completing and moving its unfinished
 * issues on to the next one. Nothing reports either, so once a day this reads
 * every rollup release and makes the entries match.
 *
 * It never creates a record. It considers only entries that already exist —
 * those whose linear_id Linear reports in a rollup, plus every entry already
 * carrying a rollup field — and writes only changelog_doc_url and
 * changelog_rollup.
 *
 * See docs/superpowers/specs/2026-10-20-rollup-doc-link-design.md.
 */

/** HubSpot kills an app function at 20s. Leave room to say what happened. */
const BUDGET_MS = 16_000;
/** Values per IN filter. */
const IN_CHUNK = 100;
const PROPERTIES = ['linear_id', 'changelog_doc_url', 'changelog_rollup'];

interface RollupDocSyncContext {
  accountId: number;
  body?: { inputFields?: { sharedSecret?: string } };
}

interface Result {
  statusCode: number;
  body: string;
}

interface Counts {
  updated: number;
  cleared: number;
  skipped: string[];
}

/**
 * Workflow actions answer 200 for anything recoverable: a non-2xx makes HubSpot
 * retry and eventually park the enrollment. The status says what happened.
 */
function outcome(syncStatus: 'ok' | 'partial' | 'error', counts: Counts, detail = ''): Result {
  const notes = [detail, ...counts.skipped].filter(Boolean).join('; ');
  return {
    statusCode: 200,
    body: JSON.stringify({
      outputFields: {
        syncStatus,
        updated: String(counts.updated),
        cleared: String(counts.cleared),
        skipped: String(counts.skipped.length),
        detail: notes.slice(0, 1000),
      },
    }),
  };
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function findEntries(objectTypeId: string, issueIds: string[]): Promise<HsRow[]> {
  const byId = new Map<string, HsRow>();
  for (let i = 0; i < issueIds.length; i += IN_CHUNK) {
    const rows = await searchAll(
      objectTypeId,
      [[{ propertyName: 'linear_id', operator: 'IN', values: issueIds.slice(i, i + IN_CHUNK) }]],
      PROPERTIES,
    );
    for (const row of rows) byId.set(row.id, row);
  }
  // Entries written before whose issue may since have left every rollup. Found
  // by what they carry, because Linear no longer lists them anywhere.
  const carrying = await searchAll(
    objectTypeId,
    [
      [{ propertyName: 'changelog_doc_url', operator: 'HAS_PROPERTY' }],
      [{ propertyName: 'changelog_rollup', operator: 'HAS_PROPERTY' }],
    ],
    PROPERTIES,
  );
  for (const row of carrying) byId.set(row.id, row);
  return [...byId.values()];
}

export async function main(context: RollupDocSyncContext): Promise<Result> {
  const expected = process.env.SYNC_SHARED_SECRET;
  if (!expected) {
    console.error('SYNC_SHARED_SECRET is not set');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfiguration' }) };
  }
  if (!verifySharedSecret(context.body?.inputFields?.sharedSecret, expected)) {
    console.warn('Rejected RollupDocSync request: invalid shared secret');
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    console.error('LINEAR_API_KEY is not set');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfiguration' }) };
  }

  const deadline = Date.now() + BUDGET_MS;
  const objectTypeId = getPortalConfig(context.accountId).content.objectTypeId;
  const counts: Counts = { updated: 0, cleared: 0, skipped: [] };

  // Every read, before any write. A partial read makes an issue look as though
  // it left its rollup, so any failure ends the run with nothing written.
  let plan: SweepPlan;
  let entries: HsRow[];
  try {
    plan = planSweep(await listRollupReleases(apiKey));
    entries = await findEntries(objectTypeId, [...plan.issueRollups.keys()]);
  } catch (err) {
    console.error(`RollupDocSync: read failed: ${reason(err)}`);
    return outcome('error', counts, `nothing written: ${reason(err)}`);
  }

  const updates: Array<{ id: string; properties: Record<string, string> }> = [];
  for (const entry of entries) {
    const linearId = entry.properties.linear_id;
    // Not tracked from Linear, so "its issue is in no rollup" is not known.
    if (!linearId) continue;
    const decision = decideEntry(
      {
        changelog_doc_url: entry.properties.changelog_doc_url ?? '',
        changelog_rollup: entry.properties.changelog_rollup ?? '',
      },
      plan.issueRollups.get(linearId) ?? [],
      plan.rollupDocIds,
    );
    if (decision.skipped) counts.skipped.push(`${linearId}: ${decision.skipped}`);
    if (Object.keys(decision.changes).length > 0) {
      updates.push({ id: entry.id, properties: decision.changes as Record<string, string> });
    }
  }

  for (let i = 0; i < updates.length; i += BATCH_UPDATE_LIMIT) {
    if (Date.now() > deadline) {
      return outcome('partial', counts, `out of time with ${updates.length - i} update(s) left; the next run finishes them`);
    }
    const chunk = updates.slice(i, i + BATCH_UPDATE_LIMIT);
    try {
      await batchUpdate(objectTypeId, chunk);
    } catch (err) {
      console.error(`RollupDocSync: write failed: ${reason(err)}`);
      return outcome('error', counts, `write failed: ${reason(err)}`);
    }
    counts.updated += chunk.length;
    counts.cleared += chunk.filter(u => u.properties.changelog_doc_url === '').length;
  }

  console.log(
    `RollupDocSync: ${counts.updated} updated, ${counts.cleared} doc link(s) cleared, ${counts.skipped.length} skipped`,
  );
  return outcome('ok', counts);
}
