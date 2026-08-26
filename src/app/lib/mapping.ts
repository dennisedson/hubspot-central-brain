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

// Tag added to Linear issue descriptions by our sync to prevent echo loops
export const HS_SYNC_TAG = '[hs-sync]';

// Asana project GID for the Advocacy Content Factory
export const ASANA_PROJECT_GID = '1202179514576728';

// Asana custom field GIDs
export const ASANA_PIPELINE_STAGE_FIELD_GID = '1202184607659964';
export const ASANA_LINEAR_ISSUE_URL_FIELD_GID = '1213736210804469';

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
