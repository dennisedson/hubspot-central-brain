/**
 * Asserts that a portal's live schema matches what `portal-config.ts` expects,
 * BEFORE anything deploys to it.
 *
 * WHY THIS EXISTS
 * ---------------
 * This replaces the staging environment, removed in c4383b0.
 *
 * Staging's one genuine value was catching per-portal provisioning drift:
 * object type ids, pipeline ids, stage ids and properties all differ per
 * portal, so code that works on dev can fail on prod because a property was
 * never created there. Staging never actually caught it — it went unmaintained
 * for the life of the project and was itself misconfigured.
 *
 * A check is strictly better than an environment for this, for one reason: it
 * fails loudly. A stale environment fails silently, which is the failure mode
 * this codebase has been bitten by over and over — `sed` matching nothing and
 * exiting 0, a deploy reporting DONE while serving old code, a sync returning
 * 200 having written nothing.
 *
 * WHAT IT CHECKS
 * --------------
 *   1. Every object type id in portal-config exists on the portal.
 *   2. Every pipeline id exists, on the object it is configured under.
 *   3. Every stage id exists, within that pipeline.
 *   4. Every property the app reads or writes exists on its object.
 *
 * (4) is the one that would have caught the most real bugs. `youtube_url`,
 * `source_url` and `asana_task_id` were all provisioned-but-unwritten or
 * read-but-absent, and each was discovered by a human noticing something blank
 * rather than by anything failing.
 *
 * WHAT IT DELIBERATELY DOES NOT CHECK
 * -----------------------------------
 * Secrets. `hs project deploy` already validates those and names the missing
 * one; duplicating it here would mean a second list to keep in sync, and a
 * check that disagrees with the deploy is worse than no check.
 *
 * Usage:
 *   PORTAL=prod npm run preflight
 *   PORTAL=dev  npm run preflight
 */

import { loadEnv } from './script-env';
import { getPortalConfig } from '../app/lib/portal-config';
import { HS_BASE, pipelinesPath, propertiesPath, schemasPath } from '../app/lib/hs-api';

/**
 * Properties the app reads or writes, per object.
 *
 * Curated rather than derived. Deriving them from the handlers' constants would
 * couple this to every refactor and would still miss the ones built inline; a
 * list with a reason attached is easier to keep honest. Add to it whenever a
 * new property becomes load-bearing.
 */
const REQUIRED_PROPERTIES: Record<'content' | 'video' | 'appConfig', string[]> = {
  content: [
    'title',
    'content_type',
    'linear_id', // the unique key upserts match on
    'linear_issue_id',
    'linear_issue_url',
    'asana_task_url', // absence here means duplicate Asana tasks, silently
    'target_date',
    'source_url', // half the Obsidian linkage contract
    'enterpret_theme',
    'enterpret_quote_count',
    'enterpret_quotes',
  ],
  video: [
    'youtube_video_id',
    'youtube_url',
    'view_count',
    'like_count',
    'comment_count',
    'impressions',
    'click_through_rate',
    'average_view_duration',
    'published_at',
  ],
  appConfig: [
    'linear_team_id',
    'assignee_filter',
    'linear_assignee_id',
    'asana_sync_token',
    'youtube_channel_id', // the sync reads the channel from here, not a secret
    'youtube_channel_title',
    'youtube_connection_status',
    'youtube_last_sync',
  ],
};

interface Failure {
  area: string;
  detail: string;
}

const failures: Failure[] = [];
const checks: string[] = [];

function fail(area: string, detail: string) {
  failures.push({ area, detail });
}

function pass(detail: string) {
  checks.push(detail);
}

async function hsGet<T>(token: string, path: string): Promise<T | null> {
  const res = await fetch(`${HS_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`GET ${path} failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

async function checkObjectTypes(token: string, expected: Record<string, string>) {
  const body = await hsGet<{ results?: Array<{ objectTypeId?: string; name?: string }> }>(
    token,
    schemasPath(),
  );
  const live = new Set((body?.results ?? []).map((r) => r.objectTypeId).filter(Boolean));

  for (const [label, objectTypeId] of Object.entries(expected)) {
    if (!objectTypeId) {
      fail('object type', `${label} has no objectTypeId configured`);
    } else if (!live.has(objectTypeId)) {
      fail('object type', `${label} expects ${objectTypeId}, which does not exist on this portal`);
    } else {
      pass(`object ${label} → ${objectTypeId}`);
    }
  }
}

async function checkPipeline(
  token: string,
  label: string,
  objectTypeId: string,
  pipelineId: string,
  stageIds: Record<string, string>,
) {
  // An empty pipeline id is a real, known state — prod has no changelog
  // pipeline (#21) — so it is reported rather than thrown, and it fails the
  // check only because deploying code that writes to it would 400 at runtime.
  if (!pipelineId) {
    fail('pipeline', `${label} has no pipelineId configured (see issue #21)`);
    return;
  }

  const body = await hsGet<{ stages?: Array<{ id?: string; label?: string }> }>(
    token,
    pipelinesPath(objectTypeId, pipelineId),
  );

  if (!body) {
    fail('pipeline', `${label} expects pipeline ${pipelineId}, which does not exist`);
    return;
  }
  pass(`pipeline ${label} → ${pipelineId}`);

  const liveStages = new Set((body.stages ?? []).map((s) => s.id).filter(Boolean));
  for (const [stageName, stageId] of Object.entries(stageIds)) {
    if (!stageId) {
      fail('stage', `${label}.${stageName} has no id configured`);
    } else if (!liveStages.has(stageId)) {
      fail('stage', `${label}.${stageName} expects ${stageId}, absent from pipeline ${pipelineId}`);
    }
  }
  if (Object.keys(stageIds).length > 0) {
    pass(`  ${Object.keys(stageIds).length} stage(s) on ${label}`);
  }
}

async function checkProperties(
  token: string,
  label: string,
  objectTypeId: string,
  required: string[],
) {
  const body = await hsGet<{ results?: Array<{ name?: string }> }>(
    token,
    propertiesPath(objectTypeId),
  );
  const live = new Set((body?.results ?? []).map((r) => r.name).filter(Boolean));

  const missing = required.filter((name) => !live.has(name));
  if (missing.length > 0) {
    fail('property', `${label} is missing: ${missing.join(', ')}`);
  } else {
    pass(`${required.length} propert${required.length === 1 ? 'y' : 'ies'} on ${label}`);
  }
}

async function main() {
  const { token, portalId, portal } = loadEnv();
  const config = getPortalConfig(portalId);

  // Last four characters only. A rotated key has two homes — local .env and the
  // GitHub environment secret — and updating one leaves the other dead while the
  // local run goes green. Printing a fingerprint makes "same script, different
  // credential" visible instead of looking like flaky behaviour.
  const fingerprint = token.slice(-4);
  console.log(`\nPreflight — portal ${portalId} (${portal}), key …${fingerprint}\n`);

  await checkObjectTypes(token, {
    content: config.content.objectTypeId,
    video: config.video.objectTypeId,
    app_configs: config.appConfig.objectTypeId,
  });

  for (const [key, pipeline] of Object.entries(config.content.pipelines)) {
    await checkPipeline(token, `content/${key}`, config.content.objectTypeId, pipeline.pipelineId, pipeline.stageIds);
  }
  await checkPipeline(token, 'video', config.video.objectTypeId, config.video.pipelineId, config.video.stageIds);

  await checkProperties(token, 'content', config.content.objectTypeId, REQUIRED_PROPERTIES.content);
  await checkProperties(token, 'video', config.video.objectTypeId, REQUIRED_PROPERTIES.video);
  await checkProperties(token, 'app_configs', config.appConfig.objectTypeId, REQUIRED_PROPERTIES.appConfig);

  // The standard Projects object, which FellowSync writes to. Checked because
  // it was invisible here and cost an afternoon: on 22047910 it was DEACTIVATED,
  // which cannot be seen from the custom objects above and which fails an app
  // install outright — a scope against a deactivated object cannot be granted,
  // and one unfulfillable scope fails the whole install without naming itself.
  // A developer sandbox has it on by default; a real portal need not.
  try {
    const res = await fetch(`${HS_BASE}${propertiesPath('projects')}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 403 || res.status === 404) {
      fail('projects', 'the standard Projects object is not readable — check it is activated in the Data Model Builder, and that the service key has project scopes');
    } else if (!res.ok) {
      fail('projects', `Projects check returned ${res.status}`);
    } else {
      pass('standard Projects object is active and readable');
    }
  } catch (err) {
    fail('projects', `could not reach the Projects object: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Not reachable from HubSpot, but a blank gid means every Asana sync silently
  // targets nothing, so it is worth asserting it was configured at all.
  if (!config.asanaProjectGid) fail('asana', 'asanaProjectGid is empty');
  if (!config.asanaWorkspaceGid) fail('asana', 'asanaWorkspaceGid is empty');

  for (const line of checks) console.log(`  ok   ${line}`);

  if (failures.length > 0) {
    console.error(`\n${failures.length} problem(s) — this portal is NOT ready for a deploy:\n`);
    for (const f of failures) console.error(`  FAIL [${f.area}] ${f.detail}`);
    console.error('\nProvision the missing pieces before deploying. Deploying over drift');
    console.error('does not error — it produces records with blank properties and syncs');
    console.error('that report success while writing nothing.\n');
    process.exit(1);
  }

  console.log(`\nAll ${checks.length} check(s) passed. Portal ${portalId} matches portal-config.\n`);
}

main().catch((err) => {
  console.error('\nPreflight could not complete:', err instanceof Error ? err.message : err);
  process.exit(1);
});
