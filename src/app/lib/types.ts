export type ContentStage =
  | 'idea'
  | 'outline'
  | 'drafting'
  | 'editing'
  | 'review'
  | 'published'
  | 'archived';

export type ChangelogStage = 'identified' | 'drafting' | 'reviewing' | 'published';

export interface ContentProperties {
  title: string;
  content_type?: string;
  hs_pipeline?: string;
  hs_pipeline_stage?: string;
  source_url?: string;
  published_url?: string;
  linear_issue_url?: string;
  linear_issue_id?: string;
  asana_task_url?: string;
  asana_task_id?: string;
  target_date?: string;
  actual_date?: string;
  topic_tags?: string;
  enterpret_theme?: string;
  enterpret_quote_count?: string;
  notes?: string;
  social_post_draft?: string;
  social_published_at?: string;
  social_post_url?: string;
  social_engagement_score?: string;
}

export interface ChangelogProperties {
  title: string;
  product_area?: string;
  change_type?: string;
  hs_pipeline?: string;
  hs_pipeline_stage?: string;
  linear_issue_url?: string;
  linear_issue_id?: string;
  published_url?: string;
  release_date?: string;
  publish_date?: string;
  developer_impact?: string;
  notes?: string;
  topic_tags?: string;
  enterpret_theme?: string;
}

export interface LinearState {
  id: string;
  name: string;
  type: string;
}

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  state: LinearState;
  labels: Array<{ id: string; name: string; color?: string }>;
  url: string;
  team: { id: string; name: string };
  assignee?: { id: string; name: string } | null;
}

export interface LinearWebhookPayload {
  action: 'create' | 'update' | 'remove';
  type: string;
  data: LinearIssue;
  organizationId: string;
  webhookTimestamp: number;
  webhookId: string;
}

export interface HubSpotRecord {
  id: string;
  properties: Record<string, string | null>;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

export interface UpsertResult {
  id: string;
  action: 'created' | 'updated' | 'skipped';
}

export interface SyncToLinearInput {
  linearIssueId: string;
  hubspotStage: string;
  objectType: 'content' | 'changelog';
  linearTeamId: string;
}
