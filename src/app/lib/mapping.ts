import type { ContentStage, ChangelogStage } from './types';

// Linear state names → HubSpot Content pipeline stage names
export const LINEAR_STATE_TO_CONTENT_STAGE: Record<string, ContentStage> = {
  Backlog: 'idea',
  Todo: 'outline',
  'In Progress': 'drafting',
  'In Review': 'review',
  Done: 'published',
  Cancelled: 'archived',
};

// Linear state names → HubSpot Changelog pipeline stage names
export const LINEAR_STATE_TO_CHANGELOG_STAGE: Record<string, ChangelogStage> = {
  Backlog: 'identified',
  Todo: 'identified',
  'In Progress': 'drafting',
  'In Review': 'reviewing',
  Done: 'published',
  Cancelled: 'identified',
};

// HubSpot Content stage names → Linear state names
export const CONTENT_STAGE_TO_LINEAR_STATE: Record<ContentStage, string> = {
  idea: 'Backlog',
  outline: 'Todo',
  drafting: 'In Progress',
  editing: 'In Progress',
  review: 'In Review',
  published: 'Done',
  archived: 'Cancelled',
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
