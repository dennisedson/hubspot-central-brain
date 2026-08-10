/**
 * Property mapping configuration between HubSpot and external systems.
 *
 * Each mapping defines:
 * - The HubSpot property name
 * - The external system's field name
 * - Which system "owns" the value (wins on conflict)
 * - A transform function if the value needs conversion
 */

export interface PropertyMapping {
  hubspot: string;
  external: string;
  owner: 'hubspot' | 'external';
  transform?: (value: unknown) => unknown;
}

export interface SyncConfig {
  system: 'linear' | 'asana' | 'fellow';
  objectType: 'content' | 'changelog' | 'video' | 'project';
  mappings: PropertyMapping[];
}

// Source tag used to prevent echo loops in bidirectional sync.
// Outbound updates include this tag; inbound webhooks skip processing
// if the tag is present.
export const SYNC_SOURCE_TAG = 'hubspot-central-brain';

export const linearChangelogMappings: PropertyMapping[] = [
  { hubspot: 'title', external: 'title', owner: 'external' },
  { hubspot: 'linear_issue_id', external: 'id', owner: 'external' },
  { hubspot: 'linear_issue_url', external: 'url', owner: 'external' },
  { hubspot: 'notes', external: 'description', owner: 'external' },
];

export const asanaContentMappings: PropertyMapping[] = [
  { hubspot: 'title', external: 'name', owner: 'hubspot' },
  { hubspot: 'asana_task_id', external: 'gid', owner: 'external' },
  { hubspot: 'asana_task_url', external: 'permalink_url', owner: 'external' },
];
