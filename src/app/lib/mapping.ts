import type { ContentStage, ChangelogStage } from './types';

// Linear state names → HubSpot Content pipeline stage names
export const LINEAR_STATE_TO_CONTENT_STAGE: Record<string, ContentStage> = {
  Backlog: 'idea',
  Todo: 'outline',
  'In Progress': 'drafting',
  'In Review': 'review',
  Done: 'published',
  Canceled: 'archived',
};

// Linear state names → HubSpot Changelog pipeline stage names
export const LINEAR_STATE_TO_CHANGELOG_STAGE: Record<string, ChangelogStage> = {
  Backlog: 'identified',
  Todo: 'identified',
  'In Progress': 'drafting',
  'In Review': 'reviewing',
  Done: 'published',
  Canceled: 'identified',
};

// HubSpot Content stage names → Linear state names
export const CONTENT_STAGE_TO_LINEAR_STATE: Record<ContentStage, string> = {
  idea: 'Backlog',
  outline: 'Todo',
  drafting: 'In Progress',
  editing: 'In Progress',
  review: 'In Review',
  published: 'Done',
  archived: 'Canceled',
};

// HubSpot Changelog stage names → Linear state names
export const CHANGELOG_STAGE_TO_LINEAR_STATE: Record<ChangelogStage, string> = {
  identified: 'Backlog',
  drafting: 'In Progress',
  reviewing: 'In Review',
  published: 'Done',
};

// The Linear label that marks an issue as a changelog entry (not a Content record)
export const LINEAR_CHANGELOG_LABEL = 'changelog';

/**
 * What a Linear project's issues become in HubSpot.
 *
 * `ignore` matters as much as the other two. Not every issue assigned to
 * someone is content — on the production workspace, 69 of 83 are rollout
 * changelogs and the remaining 14 are a mix of content and plain tasks. A map
 * with no way to say "none of these" forces the tasks in and leaves someone
 * pruning records by hand.
 */
export type ProjectKind = 'content' | 'changelog' | 'ignore';

/** Linear project id → what its issues become. Stored as JSON on app_configs. */
export type ProjectMap = Record<string, ProjectKind>;

/**
 * Parse the stored map, tolerating anything.
 *
 * It is operator-entered JSON in a text property, so it can be empty, stale or
 * malformed. A broken map must not take the sync down — it falls back to
 * "nothing is mapped", which means label-only classification, which is what
 * the code did before the map existed.
 */
export function parseProjectMap(raw: string | null | undefined): ProjectMap {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: ProjectMap = {};
    for (const [id, kind] of Object.entries(parsed as Record<string, unknown>)) {
      if (kind === 'content' || kind === 'changelog' || kind === 'ignore') out[id] = kind;
    }
    return out;
  } catch {
    return {};
  }
}

/** A project the sync has seen issues from but nobody has mapped yet. */
export interface UnmappedProject {
  id: string;
  name: string;
}

/** Parse the recorded list, tolerating anything, like the map itself. */
export function parseUnmappedProjects(raw: string | null | undefined): UnmappedProject[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is UnmappedProject =>
        !!x && typeof x === 'object' &&
        typeof (x as UnmappedProject).id === 'string' &&
        typeof (x as UnmappedProject).name === 'string',
    );
  } catch {
    return [];
  }
}

/**
 * What to do with an issue: which pipeline, or skip it.
 *
 * The project map wins where it has an opinion. The label is the fallback,
 * which keeps portals working that predate the map — the dev workspace
 * classifies by label and the production one has never used a single one.
 *
 * An unmapped project defaults to `content` rather than `ignore`, because
 * silently dropping issues is a worse failure than filing them in the obvious
 * place: one is visible and fixable, the other looks like the sync is broken.
 */
export function classifyIssue(
  labels: Array<{ name: string }>,
  projectId: string | null | undefined,
  map: ProjectMap = {},
): ProjectKind {
  if (projectId && map[projectId]) return map[projectId];
  if (labels.some(l => l.name === LINEAR_CHANGELOG_LABEL)) return 'changelog';
  return 'content';
}


/**
 * Stored in `linear_team_id` to mean "every team, filtered by assignee".
 *
 * A sentinel rather than an empty string because `linear_team_id` is the App
 * Config object's PRIMARY DISPLAY PROPERTY, which HubSpot requires. Clearing it
 * fails:
 *
 *   Error updating app_settings. Some required properties were cleared.
 *   "properties": ["linear_team_id"]
 *
 * So "no team" cannot be expressed as an absent value on this object. The
 * alternative was changing the primary display property on two live portals to
 * work around a constraint that only exists because configuration is stored in
 * a CRM record at all — see issue #62.
 */
export const ANY_TEAM = 'any';

/** True when the configuration means "every team". Accepts the empty string
 *  as well, since portals configured before the sentinel existed store that. */
export function isAnyTeam(linearTeamId: string): boolean {
  return !linearTeamId || linearTeamId === ANY_TEAM;
}

// Tag added to Linear issue descriptions by our sync to prevent echo loops
export const HS_SYNC_TAG = '[hs-sync]';

// Asana project GID for the Advocacy Content Factory
export const ASANA_PROJECT_GID = '1202179514576728';

// Asana custom field GIDs
export const ASANA_PIPELINE_STAGE_FIELD_GID = '1202184607659964';
export const ASANA_LINEAR_ISSUE_URL_FIELD_GID = '1213736210804469';

/**
 * "Draft File" on BuildRel | Advocacy Content Factory — where the Google Doc
 * link goes.
 *
 * Present on the PROD project only. Dennis-Staging carries 8 of that project's
 * 21 fields and this is not one, so the write has to be conditional on the
 * value existing rather than assumed — otherwise dev fails on a field it does
 * not have.
 */
export const ASANA_DRAFT_FILE_FIELD_GID = '1202184607656856';

// HubSpot Content stage names → Asana Pipeline Stage enum option GIDs
export const CONTENT_STAGE_TO_ASANA_STAGE: Record<ContentStage, string> = {
  idea: '1212751789107073',     // New Idea
  outline: '1213736254001623',  // Assigned
  drafting: '1202184607667441', // In Progress
  editing: '1202184607667441',  // In Progress
  review: '1202184607668470',   // Peer Review
  published: '1202212684793528', // Published
  archived: '1202184607671632', // Canceled
};

// HubSpot Changelog stage names → Asana Pipeline Stage enum option GIDs
export const CHANGELOG_STAGE_TO_ASANA_STAGE: Record<ChangelogStage, string> = {
  identified: '1212751789107073', // New Idea
  drafting: '1202184607667441',   // In Progress
  reviewing: '1202184607668470',  // Peer Review
  published: '1202212684793528',  // Published
};

// Asana Pipeline Stage enum option GIDs → HubSpot Content stage names
// Note: both 'drafting' and 'editing' forward-map to In Progress; reverse uses 'drafting' as canonical
export const ASANA_STAGE_TO_CONTENT_STAGE: Record<string, ContentStage> = {
  '1212751789107073': 'idea',      // New Idea
  '1213736254001623': 'outline',   // Assigned
  '1202184607667441': 'drafting',  // In Progress
  '1202184607668470': 'review',    // Peer Review
  '1202212684793528': 'published', // Published
  '1202184607671632': 'archived',  // Canceled
};

// Asana Pipeline Stage enum option GIDs → HubSpot Changelog stage names
export const ASANA_STAGE_TO_CHANGELOG_STAGE: Record<string, ChangelogStage> = {
  '1212751789107073': 'identified', // New Idea
  '1202184607667441': 'drafting',   // In Progress
  '1202184607668470': 'reviewing',  // Peer Review
  '1202212684793528': 'published',  // Published
};

/**
 * The Content stages at which work fans out into Linear and Asana.
 *
 * The vault is the idea stage. A note that nobody has promoted is a thought,
 * and a thought has no business occupying a slot in an issue tracker or
 * somebody's task list — so nothing is created below Outline. Outline is the
 * threshold at which the work becomes real, and it is the same threshold for
 * both systems deliberately: two different thresholds would mean a record that
 * has a Linear issue but no Asana task, and no way to tell whether that was
 * the rule or a failure.
 *
 * `archived` is absent on purpose. It is not "later than Outline", it is off
 * to the side — creating a Linear issue for work that arrived already dead
 * would be noise.
 */
export const FANOUT_STAGES: readonly ContentStage[] = [
  'outline',
  'drafting',
  'editing',
  'review',
  'published',
];

export function isFanoutStage(stageName: string | undefined): boolean {
  return FANOUT_STAGES.includes(stageName as ContentStage);
}
