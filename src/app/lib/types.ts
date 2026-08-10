/**
 * Shared type definitions for the Central Brain system.
 */

// --- Content pipeline stages ---
export type ContentStage =
  | 'idea'
  | 'outline'
  | 'drafting'
  | 'editing'
  | 'review'
  | 'published'
  | 'archived';

// --- Changelog pipeline stages ---
export type ChangelogStage =
  | 'identified'
  | 'drafting'
  | 'reviewing'
  | 'published';

// --- Video lifecycle statuses ---
export type VideoStatus = 'Draft' | 'Scheduled' | 'Public';

// --- Project types (native Projects object hs_type enum) ---
export type ProjectType =
  | 'content_production'
  | 'developer_relations'
  | 'internal'
  | 'speaking'
  | 'review'
  | 'community';

// --- Content types ---
export type ContentType =
  | 'blog_post'
  | 'video'
  | 'tutorial'
  | 'talk'
  | 'changelog'
  | 'documentation'
  | 'social';

// --- Webhook payload types ---
export interface WebhookContext {
  source: string;
  timestamp: number;
  signature?: string;
}

export interface LinearWebhookPayload {
  action: 'create' | 'update' | 'remove';
  type: 'Issue';
  data: {
    id: string;
    title: string;
    description?: string;
    state: { name: string };
    labels: { nodes: Array<{ name: string }> };
    url: string;
  };
}

export interface AsanaWebhookEvent {
  resource: {
    gid: string;
    resource_type: string;
  };
  action: string;
  parent?: { gid: string };
}
