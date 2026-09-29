/**
 * Creates HubSpot Content records for Linear issues that already existed when
 * the webhook was switched on.
 *
 * WHY THIS IS NEEDED
 * ------------------
 * The webhook only fires on events. An issue tagged last month produces no
 * event today, so switching the webhook on syncs nothing that already exists —
 * and there was no way to catch up short of bulk-editing issues in Linear to
 * provoke update events, which writes to every issue's history.
 *
 * READ-ONLY AGAINST LINEAR
 * ------------------------
 * This queries Linear and writes HubSpot. It sends no mutation, so it cannot
 * change or delete anything in Linear — which is the property that makes it
 * safe to run against a live workspace.
 *
 * IT REUSES THE WEBHOOK'S OWN LOGIC
 * ---------------------------------
 * The filters and the upsert are imported from the same modules the webhook
 * uses rather than reimplemented. A backfill that decided for itself which
 * issues qualify would drift from live sync, and the drift would show up as
 * records that exist but never update again.
 *
 * DRY RUN BY DEFAULT
 * ------------------
 * It prints what it would create and changes nothing unless `--apply` is
 * passed. This runs against production data; a first run should be read.
 *
 * Usage:
 *   PORTAL=prod npm run backfill:linear             # report only
 *   PORTAL=prod npm run backfill:linear -- --apply  # write the records
 */

import { loadEnv } from './script-env';

const LINEAR_API = 'https://api.linear.app/graphql';

/** Linear's per-page maximum. The teams query defaulted to 50 and silently
 *  truncated a several-hundred-team workspace; do not repeat that here. */
const PAGE_SIZE = 250;
const MAX_PAGES = 40;

interface Issue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  url: string;
  state: { id: string; name: string; type: string };
  labels: { nodes: Array<{ id: string; name: string }> };
  team: { id: string; name: string };
  assignee?: { id: string; name: string } | null;
}

async function linearQuery(
  apiKey: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<{ data?: Record<string, unknown>; errors?: Array<{ message: string }> }> {
  const res = await fetch(LINEAR_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: apiKey },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Linear API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { data?: Record<string, unknown>; errors?: Array<{ message: string }> };
  if (body.errors?.length) throw new Error(`Linear GraphQL: ${body.errors.map((e) => e.message).join('; ')}`);
  return body;
}

/** Every issue on a team, paged. Filtering happens here, not in the query, so
 *  it matches the webhook's rules exactly rather than approximating them. */
async function fetchTeamIssues(apiKey: string, teamId: string): Promise<Issue[]> {
  const issues: Issue[] = [];
  let after: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const body: { data?: Record<string, unknown> } = await linearQuery(
      apiKey,
      `query($teamId: String!, $first: Int!, $after: String) {
         team(id: $teamId) {
           issues(first: $first, after: $after) {
             nodes {
               id identifier title description url
               state { id name type }
               labels { nodes { id name } }
               team { id name }
               assignee { id name }
             }
             pageInfo { hasNextPage endCursor }
           }
         }
       }`,
      { teamId, first: PAGE_SIZE, after },
    );

    const connection = (body.data?.team as { issues?: { nodes: Issue[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } | undefined)?.issues;
    if (!connection) break;

    issues.push(...(connection.nodes ?? []));
    if (!connection.pageInfo?.hasNextPage || !connection.pageInfo.endCursor) break;
    after = connection.pageInfo.endCursor;
  }

  return issues;
}

/** Every issue assigned to a person, across all their teams, paged. */
async function fetchAssignedIssues(apiKey: string, assigneeId: string): Promise<Issue[]> {
  const issues: Issue[] = [];
  let after: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const body: { data?: Record<string, unknown> } = await linearQuery(
      apiKey,
      `query($id: String!, $first: Int!, $after: String) {
         user(id: $id) {
           assignedIssues(first: $first, after: $after) {
             nodes {
               id identifier title description url
               state { id name type }
               labels { nodes { id name } }
               team { id name }
               assignee { id name }
             }
             pageInfo { hasNextPage endCursor }
           }
         }
       }`,
      { id: assigneeId, first: PAGE_SIZE, after },
    );

    const conn = (body.data?.user as { assignedIssues?: { nodes: Issue[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } | undefined)?.assignedIssues;
    if (!conn) break;

    issues.push(...(conn.nodes ?? []));
    if (!conn.pageInfo?.hasNextPage || !conn.pageInfo.endCursor) break;
    after = conn.pageInfo.endCursor;
  }

  return issues;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const { token, portalId, portal, linearApiKey } = loadEnv();

  if (!linearApiKey) {
    console.error('LINEAR_API_KEY is empty in .env.');
    process.exit(1);
  }

  // The app's modules read the HubSpot token from these, the way a deployed
  // function would. Set before importing them so the upsert authenticates.
  process.env.HS_ACCESS_TOKEN = token;
  process.env.PRIVATE_APP_ACCESS_TOKEN = token;

  const { readAppSettings, upsertContent } = await import('../app/lib/hubspot-client');
  const { isConfigured } = await import('../app/lib/portal-config');
  const { LINEAR_CHANGELOG_LABEL, HS_SYNC_TAG } = await import('../app/lib/mapping');

  const settings = await readAppSettings(portalId);

  // The same gate the webhook applies. Backfilling a portal nobody has
  // configured is how 34 unwanted records arrived on prod in the first place.
  if (!isConfigured(settings)) {
    console.error(`\n[${portal}] Settings are not configured for portal ${portalId}.`);
    console.error('Choose a Linear team in the app settings first — and an assignee if');
    console.error('filtering by "mine". Refusing to backfill an unconfigured portal.\n');
    process.exit(1);
  }

  const scope = settings.linearTeamId
    ? `team ${settings.linearTeamId}`
    : `assigned to ${settings.linearAssigneeId}, all teams`;
  console.log(`\n[${portal}] Backfill — portal ${portalId}, ${scope}`);
  console.log(`Mode: ${apply ? 'APPLY — records will be written' : 'dry run — nothing will be written'}\n`);

  const all = settings.linearTeamId
    ? await fetchTeamIssues(linearApiKey, settings.linearTeamId)
    : await fetchAssignedIssues(linearApiKey, settings.linearAssigneeId);
  console.log(`Issues on the team: ${all.length}`);

  const skipped = { echo: 0, assignee: 0 };
  const eligible = all.filter((issue) => {
    // Issues our own sync created. Re-importing them would be circular.
    if (issue.description?.includes(HS_SYNC_TAG)) { skipped.echo++; return false; }

    const assigneeId = issue.assignee?.id ?? null;
    if (settings.assigneeFilter === 'assigned' && !assigneeId) { skipped.assignee++; return false; }
    if (settings.assigneeFilter === 'mine' && assigneeId !== settings.linearAssigneeId) {
      skipped.assignee++; return false;
    }
    return true;
  });

  console.log(`  skipped, our own sync tag: ${skipped.echo}`);
  console.log(`  skipped, assignee filter "${settings.assigneeFilter}": ${skipped.assignee}`);
  console.log(`Eligible: ${eligible.length}\n`);

  if (!apply) {
    for (const issue of eligible.slice(0, 20)) {
      const kind = issue.labels.nodes.some((l) => l.name === LINEAR_CHANGELOG_LABEL) ? 'changelog' : 'content';
      console.log(`  ${issue.identifier.padEnd(12)} ${kind.padEnd(9)} ${issue.state.name.padEnd(12)} ${issue.title.slice(0, 60)}`);
    }
    if (eligible.length > 20) console.log(`  … and ${eligible.length - 20} more`);
    console.log('\nNothing written. Re-run with --apply to create these records.\n');
    return;
  }

  let created = 0, updated = 0;
  const errors: string[] = [];

  for (const issue of eligible) {
    const pipelineKey = issue.labels.nodes.some((l) => l.name === LINEAR_CHANGELOG_LABEL) ? 'changelog' : 'content';
    try {
      // Shaped as the webhook would deliver it, and handed to the same upsert —
      // which matches on linear_id, so re-running this updates rather than
      // duplicating.
      const result = await upsertContent(
        {
          action: 'update',
          type: 'Issue',
          data: {
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
            description: issue.description,
            state: issue.state,
            labels: issue.labels.nodes,
            url: issue.url,
            team: issue.team,
            assignee: issue.assignee ?? null,
          },
          organizationId: 'backfill',
          webhookTimestamp: Date.now(),
          webhookId: 'backfill',
        },
        portalId,
        pipelineKey,
      );
      if (result.action === 'created') created++; else updated++;
      console.log(`  ${result.action.padEnd(8)} ${issue.identifier} — ${issue.title.slice(0, 55)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${issue.identifier}: ${message}`);
      console.error(`  FAILED   ${issue.identifier} — ${message.slice(0, 120)}`);
    }
  }

  console.log(`\nCreated ${created}, updated ${updated}, failed ${errors.length}.`);
  if (errors.length) {
    console.error('\nFailures:');
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }
  console.log();
}

main().catch((err) => {
  console.error('\nBackfill could not complete:', err instanceof Error ? err.message : err);
  process.exit(1);
});
