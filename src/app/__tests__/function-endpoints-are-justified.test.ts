import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * An `endpoint` in a function's hsmeta publishes it at
 * `https://<portal>.hs-sites.com/hs/serverless/<path>` with no authentication
 * of any kind. Omit the field and the function is private: reachable only
 * through `hubspot.serverless('<uid>')` from inside a UI extension.
 *
 * For a long time every function here declared one, because the template did.
 * Seven of them had no caller that used the URL — the cards and the page all
 * call by uid — so the endpoint was pure exposure. Two of those seven,
 * `changelog_draft_api` and `video_ai_suggestions`, call Anthropic, which made
 * them an open door onto someone else's API bill.
 *
 * This test is the ratchet. A function may publish an endpoint only if a
 * caller named below genuinely needs the URL, and every entry has to say which
 * caller that is. Adding an endpoint without a reason fails here rather than
 * three months later.
 */

const FUNCTIONS_DIR = join(__dirname, '..', 'functions');

/**
 * uid -> why this one cannot be private.
 *
 * Keep the reason specific enough that the next person can check whether it is
 * still true. "It's needed" is not a reason.
 */
const PUBLIC_BY_DESIGN: Record<string, string> = {
  // Workflow actions post to actionUrl, which is an https URL in the
  // workflow-action hsmeta. .github/scripts/set-action-urls.sh rewrites the
  // portal id per deploy. All of these authenticate with SYNC_SHARED_SECRET.
  asana_poll: 'workflow-action actionUrl',
  associate_related_content_fn: 'workflow-action actionUrl',
  fellow_sync: 'workflow-action actionUrl',
  generate_social_draft: 'workflow-action actionUrl',
  rollup_doc_sync: 'workflow-action actionUrl',
  sync_to_asana: 'workflow-action actionUrl',
  sync_to_linear: 'workflow-action actionUrl',
  video_attribution: 'workflow-action actionUrl',
  youtube_sync: 'workflow-action actionUrl (also called by uid from VideoCard)',

  // Breeze agent tools are invoked by HubSpot's agent runtime over HTTP.
  breeze_content_pipeline: 'Breeze agent tool, called by URL',
  breeze_friction_finder: 'Breeze agent tool, called by URL',
  breeze_meeting_router: 'Breeze agent tool, called by URL',

  // The CMS theme fetches these from getServerSideProps, which runs on
  // HubSpot's render servers and has no hubspot.serverless(). See
  // src/theme/central-brain-dashboard/components/modules/Dashboard/index.jsx.
  // Neither is authenticated today — tracked separately.
  content_data_api: 'CMS dashboard theme fetches /content-data-api',
  app_settings_api: 'CMS dashboard theme fetches /settings-api',

  // Third parties hold these URLs; they cannot be asked to call by uid.
  youtube_auth: "Google redirects the browser here after OAuth consent",
  youtube_webhook: 'PubSubHubbub POSTs here',
  asana_webhook: 'Asana POSTs here',
  linear_webhook: 'Linear POSTs here',

  // Operator-run health probe, guarded by SYNC_SHARED_SECRET.
  app_health: 'src/scripts/health.ts calls it over HTTP',
};

type Hsmeta = { uid: string; config?: { endpoint?: { path?: string } } };

function allFunctions(): Hsmeta[] {
  return readdirSync(FUNCTIONS_DIR)
    .filter(f => f.endsWith('-hsmeta.json'))
    .map(f => JSON.parse(readFileSync(join(FUNCTIONS_DIR, f), 'utf8')) as Hsmeta);
}

describe('function endpoints are justified', () => {
  it('no function publishes an endpoint without a documented caller', () => {
    const unjustified = allFunctions()
      .filter(fn => fn.config?.endpoint)
      .map(fn => fn.uid)
      .filter(uid => !(uid in PUBLIC_BY_DESIGN));

    expect(unjustified).toEqual([]);
  });

  // A stale allowlist is how an exposure creeps back: the entry outlives the
  // caller, and the next person reads it as permission.
  it('every allowlist entry names a function that still exists', () => {
    const uids = new Set(allFunctions().map(fn => fn.uid));
    const stale = Object.keys(PUBLIC_BY_DESIGN).filter(uid => !uids.has(uid));

    expect(stale).toEqual([]);
  });

  // The control: the ones we deliberately closed stay closed.
  it.each([
    'changelog_draft_api',
    'video_card_api',
    'video_ai_suggestions',
    'task_status_api',
    'related_content_api',
    'meeting_intelligence_api',
    'enterpret_insights_api',
  ])('%s is private — the UI calls it by uid', uid => {
    const fn = allFunctions().find(f => f.uid === uid);

    expect(fn, `${uid} has no hsmeta`).toBeDefined();
    expect(fn?.config?.endpoint).toBeUndefined();
  });
});
