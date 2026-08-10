# Phase 1+2: Foundation + Linear Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the HubSpot Central Brain data model (Content, Changelog, Video custom objects) and wire bidirectional Linear sync so that Linear issues tagged `changelog` auto-create Changelog records in HubSpot, and HubSpot pipeline stage changes push back to Linear.

**Architecture:** Everything runs inside a single HubSpot Projects app (platformVersion 2026.03). Two public serverless functions handle inbound Linear webhooks and outbound sync. A custom workflow action in HubSpot's workflow editor triggers the outbound sync. No external hosting.

**Tech Stack:** TypeScript, Node 18, HubSpot Projects CLI v8.4+, `@hubspot/api-client` v12, Vitest, native `fetch` + `crypto` (no extra HTTP libs needed).

## Global Constraints

- platformVersion: `2026.03` — never downgrade or change this
- Node runtime: 18+ — use `fetch` and `crypto` built-ins; never install `node-fetch` or `axios`
- Public endpoints require Content Hub Enterprise in production; dev test accounts work for development
- Secrets are stored with `hs secret add` and accessed via `process.env.SECRET_NAME` — never put credentials in code or JSON
- All serverless function entrypoints use `.js` extension in `*-hsmeta.json` (even if source is `.ts`)
- `PRIVATE_APP_ACCESS_TOKEN` is automatically available in every serverless function for HubSpot API calls — no manual token setup needed
- Tests use Vitest; never use jest. Path alias `@lib` resolves to `src/app/lib/`
- `npm run validate` must pass before any PR

---

## File Map

```
src/
  app/
    app-hsmeta.json                        ← App display name, scopes, permitted URLs
    functions/
      package.json                         ← npm deps for deployed runtime (separate from root)
      LinearWebhook.ts                     ← Public POST: receives Linear issue webhooks
      linear-webhook-hsmeta.json           ← Config: public endpoint + secretKeys
      SyncToLinear.ts                      ← Public POST: called by HubSpot workflow action
      sync-to-linear-hsmeta.json           ← Config: public endpoint + secretKeys
    workflow-actions/
      sync-to-linear-hsmeta.json           ← Workflow action definition (calls SyncToLinear endpoint)
    lib/
      types.ts                             ← Shared TypeScript interfaces (no runtime deps)
      mapping.ts                           ← Stage name ↔ Linear state name tables
      portal-config.ts                     ← Object type IDs + stage IDs (filled after provisioning)
      hmac.ts                              ← HMAC-SHA256 signature verification
      hubspot-client.ts                    ← HubSpot CRM API wrapper (upsert logic)
      linear-client.ts                     ← Linear GraphQL API client
    __tests__/
      hmac.test.ts
      mapping.test.ts
      hubspot-client.test.ts
      linear-client.test.ts
      linear-webhook.test.ts
      sync-to-linear.test.ts
  scripts/
    provision-objects.ts                   ← One-time script: creates custom objects + pipelines in HubSpot
```

---

## Task 1: Directory scaffold + app config + types

**Files:**
- Create: all directories above
- Create: `src/app/app-hsmeta.json`
- Create: `src/app/functions/package.json`
- Create: `src/app/lib/types.ts`

**Interfaces:**
- Produces: `ContentStage`, `ChangelogStage`, `LinearWebhookPayload`, `LinearIssue`, `UpsertResult`, `SyncToLinearInput` — used by all later tasks

- [ ] **Step 1: Create directories**

```bash
mkdir -p src/app/functions
mkdir -p src/app/workflow-actions
mkdir -p src/app/lib
mkdir -p src/app/__tests__
mkdir -p src/app/extensions
mkdir -p src/scripts
```

- [ ] **Step 2: Write `src/app/app-hsmeta.json`**

```json
{
  "name": "HubSpot Central Brain",
  "description": "Syncs content, changelogs, and videos between HubSpot and Linear, Asana, Fellow",
  "auth": {
    "type": "static",
    "requiredScopes": [
      "crm.objects.custom.read",
      "crm.objects.custom.write",
      "crm.schemas.custom.read",
      "crm.schemas.custom.write",
      "crm.objects.contacts.read",
      "timeline",
      "automation"
    ]
  },
  "permittedUrls": {
    "fetch": [
      "https://api.linear.app",
      "https://app.asana.com",
      "https://api.fellow.app"
    ],
    "iframe": [],
    "img": []
  },
  "distribution": "PRIVATE"
}
```

- [ ] **Step 3: Write `src/app/functions/package.json`**

```json
{
  "name": "central-brain-functions",
  "version": "0.1.0",
  "dependencies": {
    "@hubspot/api-client": "^12.0.0"
  }
}
```

- [ ] **Step 4: Rewrite `src/app/lib/types.ts`**

> **Note:** The scaffold already has a `src/app/lib/types.ts` with `ContentStage`, `ChangelogStage`, and a basic `LinearWebhookPayload`. The plan's version is a superset — it adds `LinearIssue`, `LinearState`, `HubSpotRecord`, `UpsertResult`, `SyncToLinearInput`, and richer property interfaces. Replace the file entirely.

```typescript
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
  labels: { nodes: Array<{ name: string }> };
  url: string;
  team: { id: string; name: string };
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
  action: 'created' | 'updated';
}

export interface SyncToLinearInput {
  linearIssueId: string;
  hubspotStage: string;
  objectType: 'content' | 'changelog';
  linearTeamId: string;
}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npm run typecheck
```

Expected: no errors (only types.ts exists so far, no imports to fail)

- [ ] **Step 6: Commit**

```bash
git add src/app/app-hsmeta.json src/app/functions/package.json src/app/lib/types.ts docs/
git commit -m "scaffold: project structure, app config, and shared types"
```

---

## Task 2: HMAC verification utility

**Files:**
- Create: `src/app/lib/hmac.ts`
- Create: `src/app/__tests__/hmac.test.ts`

**Interfaces:**
- Produces: `verifyLinearSignature(body: unknown, signature: string | undefined, secret: string): boolean`
- Consumed by: `LinearWebhook.ts` (Task 6)

**Platform note:** HubSpot 2026.03 public functions receive `context.body` as a parsed Object, not raw bytes. For HMAC verification we re-stringify with `JSON.stringify(body)`. This works when Linear's JSON serialization order is stable (it is for their payloads) but is worth noting as a caveat.

- [ ] **Step 1: Write the failing test `src/app/__tests__/hmac.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { verifyLinearSignature } from '@lib/hmac';

const SECRET = 'test-secret-32-chars-xxxxxxxxxx';

function sign(body: unknown, secret: string): string {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

describe('verifyLinearSignature', () => {
  it('returns true for a valid signature over an object body', () => {
    const body = { action: 'create', type: 'Issue', data: { id: 'lin-1' } };
    expect(verifyLinearSignature(body, sign(body, SECRET), SECRET)).toBe(true);
  });

  it('returns false when signature does not match', () => {
    const body = { action: 'create' };
    expect(verifyLinearSignature(body, 'a'.repeat(64), SECRET)).toBe(false);
  });

  it('returns false when signature is undefined', () => {
    expect(verifyLinearSignature({}, undefined, SECRET)).toBe(false);
  });

  it('returns false for malformed hex (odd-length)', () => {
    expect(verifyLinearSignature({}, 'abc', SECRET)).toBe(false);
  });

  it('handles a raw string body', () => {
    const body = '{"foo":"bar"}';
    expect(verifyLinearSignature(body, sign(body, SECRET), SECRET)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- hmac
```

Expected: FAIL — `Cannot find module '@lib/hmac'`

- [ ] **Step 3: Write `src/app/lib/hmac.ts`**

```typescript
import crypto from 'crypto';

export function verifyLinearSignature(
  body: unknown,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) return false;
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const digest = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(digest, 'hex'),
      Buffer.from(signature, 'hex'),
    );
  } catch {
    // Buffer.from throws if signature is not valid hex
    return false;
  }
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npm test -- hmac
```

Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/lib/hmac.ts src/app/__tests__/hmac.test.ts
git commit -m "feat: HMAC-SHA256 verification utility for Linear webhooks"
```

---

## Task 3: Property mapping config

**Files:**
- Create: `src/app/lib/mapping.ts`
- Create: `src/app/__tests__/mapping.test.ts`

**Interfaces:**
- Produces: `LINEAR_STATE_TO_CONTENT_STAGE`, `LINEAR_STATE_TO_CHANGELOG_STAGE`, `CONTENT_STAGE_TO_LINEAR_STATE`, `CHANGELOG_STAGE_TO_LINEAR_STATE`, `LINEAR_CHANGELOG_LABEL`, `HS_SYNC_TAG`
- Consumed by: `hubspot-client.ts`, `LinearWebhook.ts`, `SyncToLinear.ts`

- [ ] **Step 1: Write the failing test `src/app/__tests__/mapping.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import {
  LINEAR_STATE_TO_CONTENT_STAGE,
  LINEAR_STATE_TO_CHANGELOG_STAGE,
  CONTENT_STAGE_TO_LINEAR_STATE,
  CHANGELOG_STAGE_TO_LINEAR_STATE,
  LINEAR_CHANGELOG_LABEL,
} from '@lib/mapping';

describe('LINEAR_STATE_TO_CONTENT_STAGE', () => {
  it('maps "Done" to "published"', () =>
    expect(LINEAR_STATE_TO_CONTENT_STAGE['Done']).toBe('published'));
  it('maps "In Progress" to "drafting"', () =>
    expect(LINEAR_STATE_TO_CONTENT_STAGE['In Progress']).toBe('drafting'));
  it('maps "Backlog" to "idea"', () =>
    expect(LINEAR_STATE_TO_CONTENT_STAGE['Backlog']).toBe('idea'));
  it('maps "Cancelled" to "archived"', () =>
    expect(LINEAR_STATE_TO_CONTENT_STAGE['Cancelled']).toBe('archived'));
});

describe('CONTENT_STAGE_TO_LINEAR_STATE', () => {
  it('maps "published" to "Done"', () =>
    expect(CONTENT_STAGE_TO_LINEAR_STATE['published']).toBe('Done'));
  it('maps "editing" to "In Progress" (same bucket as drafting)', () =>
    expect(CONTENT_STAGE_TO_LINEAR_STATE['editing']).toBe('In Progress'));
  it('maps "archived" to "Cancelled"', () =>
    expect(CONTENT_STAGE_TO_LINEAR_STATE['archived']).toBe('Cancelled'));
});

describe('LINEAR_STATE_TO_CHANGELOG_STAGE', () => {
  it('maps "In Review" to "reviewing"', () =>
    expect(LINEAR_STATE_TO_CHANGELOG_STAGE['In Review']).toBe('reviewing'));
  it('maps "Done" to "published"', () =>
    expect(LINEAR_STATE_TO_CHANGELOG_STAGE['Done']).toBe('published'));
});

describe('CHANGELOG_STAGE_TO_LINEAR_STATE', () => {
  it('maps "published" to "Done"', () =>
    expect(CHANGELOG_STAGE_TO_LINEAR_STATE['published']).toBe('Done'));
  it('maps "reviewing" to "In Review"', () =>
    expect(CHANGELOG_STAGE_TO_LINEAR_STATE['reviewing']).toBe('In Review'));
});

describe('constants', () => {
  it('LINEAR_CHANGELOG_LABEL is "changelog"', () =>
    expect(LINEAR_CHANGELOG_LABEL).toBe('changelog'));
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- mapping
```

Expected: FAIL — `Cannot find module '@lib/mapping'`

- [ ] **Step 3: Rewrite `src/app/lib/mapping.ts`**

> **Note:** The scaffold has a `src/app/lib/mapping.ts` with a generic `PropertyMapping`/`SyncConfig` interface approach and a `SYNC_SOURCE_TAG` constant. The plan uses a different, simpler approach — direct lookup tables keyed by state name — which is all the functions actually need. Replace the file entirely; the `PropertyMapping`/`SyncConfig` types are not used anywhere in this plan.

```typescript
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
```

- [ ] **Step 4: Run tests to confirm both pass**

```bash
npm test -- hmac mapping
```

Expected: 14 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/lib/mapping.ts src/app/__tests__/mapping.test.ts
git commit -m "feat: pipeline stage ↔ Linear state mapping tables"
```

---

## Task 4: Portal config + HubSpot CRM client

**Files:**
- Create: `src/app/lib/portal-config.ts`
- Create: `src/app/lib/hubspot-client.ts`
- Create: `src/app/__tests__/hubspot-client.test.ts`

**Interfaces:**
- Consumes: `LinearWebhookPayload`, `UpsertResult`, `ContentStage`, `ChangelogStage` from `types.ts`; mapping tables from `mapping.ts`
- Produces: `createHubSpotClient(token?: string): Client`, `findByLinearId(client, objectTypeId, linearIssueId): Promise<string | null>`, `getCurrentStage(client, objectTypeId, linearIssueId): Promise<string | null>`, `upsertContent(client, payload): Promise<UpsertResult>`, `upsertChangelog(client, payload): Promise<UpsertResult>`

**About `portal-config.ts`:** This file is a placeholder that you fill in after running `npm run provision` in Task 8. The provision script prints the values to paste here.

- [ ] **Step 1: Write `src/app/lib/portal-config.ts`** (placeholder — updated after provisioning)

```typescript
// Filled in after running: npm run provision
// The provision script outputs the values to paste into this file.
export const PORTAL_CONFIG = {
  content: {
    objectTypeId: process.env.CONTENT_OBJECT_TYPE_ID ?? '2-FILL_IN',
    pipelineId: process.env.CONTENT_PIPELINE_ID ?? 'FILL_IN',
    stageIds: {
      idea: process.env.CONTENT_STAGE_IDEA ?? 'FILL_IN',
      outline: process.env.CONTENT_STAGE_OUTLINE ?? 'FILL_IN',
      drafting: process.env.CONTENT_STAGE_DRAFTING ?? 'FILL_IN',
      editing: process.env.CONTENT_STAGE_EDITING ?? 'FILL_IN',
      review: process.env.CONTENT_STAGE_REVIEW ?? 'FILL_IN',
      published: process.env.CONTENT_STAGE_PUBLISHED ?? 'FILL_IN',
      archived: process.env.CONTENT_STAGE_ARCHIVED ?? 'FILL_IN',
    },
  },
  changelog: {
    objectTypeId: process.env.CHANGELOG_OBJECT_TYPE_ID ?? '2-FILL_IN',
    pipelineId: process.env.CHANGELOG_PIPELINE_ID ?? 'FILL_IN',
    stageIds: {
      identified: process.env.CHANGELOG_STAGE_IDENTIFIED ?? 'FILL_IN',
      drafting: process.env.CHANGELOG_STAGE_DRAFTING_CL ?? 'FILL_IN',
      reviewing: process.env.CHANGELOG_STAGE_REVIEWING ?? 'FILL_IN',
      published: process.env.CHANGELOG_STAGE_PUBLISHED_CL ?? 'FILL_IN',
    },
  },
};
```

- [ ] **Step 2: Write the failing test `src/app/__tests__/hubspot-client.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findByLinearId, getCurrentStage, upsertContent, upsertChangelog } from '@lib/hubspot-client';
import type { LinearWebhookPayload } from '@lib/types';

const mockSearch = vi.fn();
const mockUpdate = vi.fn();
const mockCreate = vi.fn();

const mockClient = {
  crm: {
    objects: {
      searchApi: { doSearch: mockSearch },
      basicApi: { update: mockUpdate, create: mockCreate },
    },
  },
} as any;

const baseIssue: LinearWebhookPayload = {
  action: 'create',
  type: 'Issue',
  organizationId: 'org-1',
  webhookTimestamp: 1000000,
  webhookId: 'wh-1',
  data: {
    id: 'lin-123',
    identifier: 'ENG-1',
    title: 'Add API endpoint docs',
    state: { id: 'st-1', name: 'In Progress', type: 'started' },
    labels: { nodes: [] },
    url: 'https://linear.app/team/issue/ENG-1',
    team: { id: 't-1', name: 'Engineering' },
  },
};

beforeEach(() => vi.clearAllMocks());

describe('findByLinearId', () => {
  it('returns null when no records match', async () => {
    mockSearch.mockResolvedValue({ results: [] });
    expect(await findByLinearId(mockClient, '2-content', 'lin-999')).toBeNull();
    expect(mockSearch).toHaveBeenCalledWith('2-content', expect.objectContaining({
      filterGroups: [{ filters: [{ propertyName: 'linear_issue_id', operator: 'EQ', value: 'lin-999' }] }],
    }));
  });

  it('returns the id of the first matching record', async () => {
    mockSearch.mockResolvedValue({ results: [{ id: 'hs-456' }, { id: 'hs-789' }] });
    expect(await findByLinearId(mockClient, '2-content', 'lin-123')).toBe('hs-456');
  });
});

describe('getCurrentStage', () => {
  it('returns null when no record exists', async () => {
    mockSearch.mockResolvedValue({ results: [] });
    expect(await getCurrentStage(mockClient, '2-content', 'lin-999')).toBeNull();
  });

  it('returns the hs_pipeline_stage value from the matching record', async () => {
    mockSearch.mockResolvedValue({ results: [{ id: 'hs-1', properties: { hs_pipeline_stage: 'stage-abc' } }] });
    expect(await getCurrentStage(mockClient, '2-content', 'lin-123')).toBe('stage-abc');
  });

  it('returns null when the record has no stage set', async () => {
    mockSearch.mockResolvedValue({ results: [{ id: 'hs-1', properties: { hs_pipeline_stage: null } }] });
    expect(await getCurrentStage(mockClient, '2-content', 'lin-123')).toBeNull();
  });
});

describe('upsertContent', () => {
  it('creates a new record when no existing match, maps "In Progress" to "drafting"', async () => {
    mockSearch.mockResolvedValue({ results: [] });
    mockCreate.mockResolvedValue({ id: 'hs-new-1' });

    const result = await upsertContent(mockClient, baseIssue);

    expect(mockCreate).toHaveBeenCalledOnce();
    const createCall = mockCreate.mock.calls[0];
    expect(createCall[1].properties).toMatchObject({
      title: 'Add API endpoint docs',
      linear_issue_id: 'lin-123',
      linear_issue_url: 'https://linear.app/team/issue/ENG-1',
    });
    // Stage must be an ID (non-empty string) — actual value depends on portal-config
    expect(typeof createCall[1].properties.hs_pipeline_stage).toBe('string');
    expect(result).toEqual({ id: 'hs-new-1', action: 'created' });
  });

  it('maps description to the notes property', async () => {
    const issueWithDesc = { ...baseIssue, data: { ...baseIssue.data, description: 'Some notes here' } };
    mockSearch.mockResolvedValue({ results: [] });
    mockCreate.mockResolvedValue({ id: 'hs-new-2' });
    await upsertContent(mockClient, issueWithDesc);
    expect(mockCreate.mock.calls[0][1].properties.notes).toBe('Some notes here');
  });

  it('updates when a matching record exists', async () => {
    mockSearch.mockResolvedValue({ results: [{ id: 'hs-existing' }] });

    const result = await upsertContent(mockClient, baseIssue);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.any(String),
      'hs-existing',
      expect.objectContaining({ properties: expect.objectContaining({ title: 'Add API endpoint docs' }) }),
    );
    expect(result).toEqual({ id: 'hs-existing', action: 'updated' });
  });
});

describe('upsertChangelog', () => {
  it('creates a changelog record, maps "Done" to "published"', async () => {
    const doneIssue: LinearWebhookPayload = {
      ...baseIssue,
      data: { ...baseIssue.data, state: { id: 'st-done', name: 'Done', type: 'completed' } },
    };
    mockSearch.mockResolvedValue({ results: [] });
    mockCreate.mockResolvedValue({ id: 'hs-cl-1' });

    const result = await upsertChangelog(mockClient, doneIssue);

    expect(result.action).toBe('created');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ properties: expect.objectContaining({ linear_issue_id: 'lin-123' }) }),
    );
  });
});
```

- [ ] **Step 3: Run test to confirm it fails**

```bash
npm test -- hubspot-client
```

Expected: FAIL — `Cannot find module '@lib/hubspot-client'`

- [ ] **Step 4: Write `src/app/lib/hubspot-client.ts`**

```typescript
import { Client } from '@hubspot/api-client';
import type { LinearWebhookPayload, UpsertResult } from './types';
import { LINEAR_STATE_TO_CONTENT_STAGE, LINEAR_STATE_TO_CHANGELOG_STAGE } from './mapping';
import { PORTAL_CONFIG } from './portal-config';

export function createHubSpotClient(token?: string): Client {
  return new Client({ accessToken: token ?? process.env.PRIVATE_APP_ACCESS_TOKEN });
}

export async function findByLinearId(
  client: Client,
  objectTypeId: string,
  linearIssueId: string,
): Promise<string | null> {
  const response = await client.crm.objects.searchApi.doSearch(objectTypeId, {
    filterGroups: [{
      filters: [{
        propertyName: 'linear_issue_id',
        operator: 'EQ' as const,
        value: linearIssueId,
      }],
    }],
    properties: ['linear_issue_id'],
    limit: 1,
    sorts: [],
    query: '',
    after: '0',
  });
  return response.results[0]?.id ?? null;
}

export async function getCurrentStage(
  client: Client,
  objectTypeId: string,
  linearIssueId: string,
): Promise<string | null> {
  const response = await client.crm.objects.searchApi.doSearch(objectTypeId, {
    filterGroups: [{
      filters: [{
        propertyName: 'linear_issue_id',
        operator: 'EQ' as const,
        value: linearIssueId,
      }],
    }],
    properties: ['linear_issue_id', 'hs_pipeline_stage'],
    limit: 1,
    sorts: [],
    query: '',
    after: '0',
  });
  return response.results[0]?.properties?.hs_pipeline_stage ?? null;
}

export async function upsertContent(
  client: Client,
  payload: LinearWebhookPayload,
): Promise<UpsertResult> {
  const { data } = payload;
  const stageName = LINEAR_STATE_TO_CONTENT_STAGE[data.state.name] ?? 'idea';
  const stageId = PORTAL_CONFIG.content.stageIds[stageName] ?? stageName;
  const objectTypeId = PORTAL_CONFIG.content.objectTypeId;

  const properties: Record<string, string> = {
    title: data.title,
    linear_issue_id: data.id,
    linear_issue_url: data.url,
    hs_pipeline: PORTAL_CONFIG.content.pipelineId,
    hs_pipeline_stage: stageId,
    ...(data.description ? { notes: data.description } : {}),
  };

  const existingId = await findByLinearId(client, objectTypeId, data.id);
  if (existingId) {
    await client.crm.objects.basicApi.update(objectTypeId, existingId, { properties });
    return { id: existingId, action: 'updated' };
  }

  const created = await client.crm.objects.basicApi.create(objectTypeId, { properties });
  return { id: created.id, action: 'created' };
}

export async function upsertChangelog(
  client: Client,
  payload: LinearWebhookPayload,
): Promise<UpsertResult> {
  const { data } = payload;
  const stageName = LINEAR_STATE_TO_CHANGELOG_STAGE[data.state.name] ?? 'identified';
  const stageId = PORTAL_CONFIG.changelog.stageIds[stageName] ?? stageName;
  const objectTypeId = PORTAL_CONFIG.changelog.objectTypeId;

  const properties: Record<string, string> = {
    title: data.title,
    linear_issue_id: data.id,
    linear_issue_url: data.url,
    hs_pipeline: PORTAL_CONFIG.changelog.pipelineId,
    hs_pipeline_stage: stageId,
    ...(data.description ? { notes: data.description } : {}),
  };

  const existingId = await findByLinearId(client, objectTypeId, data.id);
  if (existingId) {
    await client.crm.objects.basicApi.update(objectTypeId, existingId, { properties });
    return { id: existingId, action: 'updated' };
  }

  const created = await client.crm.objects.basicApi.create(objectTypeId, { properties });
  return { id: created.id, action: 'created' };
}
```

- [ ] **Step 5: Run tests to confirm all pass**

```bash
npm test
```

Expected: 25+ tests PASS (hmac, mapping, hubspot-client suites)

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/app/lib/portal-config.ts src/app/lib/hubspot-client.ts src/app/__tests__/hubspot-client.test.ts
git commit -m "feat: portal config placeholder and HubSpot CRM client (upsert logic)"
```

---

## Task 5: Linear GraphQL client

**Files:**
- Create: `src/app/lib/linear-client.ts`
- Create: `src/app/__tests__/linear-client.test.ts`

**Interfaces:**
- Produces: `getLinearStates(apiKey, teamId): Promise<LinearState[]>`, `findStateIdByName(apiKey, teamId, stateName): Promise<string | null>`, `updateLinearIssueState(apiKey, issueId, stateId): Promise<void>`
- Consumed by: `SyncToLinear.ts` (Task 7)

- [ ] **Step 1: Write the failing test `src/app/__tests__/linear-client.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getLinearStates, findStateIdByName, updateLinearIssueState } from '@lib/linear-client';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const STATES = [
  { id: 'st-1', name: 'Backlog', type: 'backlog' },
  { id: 'st-2', name: 'In Progress', type: 'started' },
  { id: 'st-3', name: 'Done', type: 'completed' },
];

function mockStatesResponse() {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ data: { team: { states: { nodes: STATES } } } }),
  });
}

beforeEach(() => vi.clearAllMocks());

describe('getLinearStates', () => {
  it('returns the states array from the API', async () => {
    mockStatesResponse();
    const result = await getLinearStates('lin_key', 'team-1');
    expect(result).toEqual(STATES);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.linear.app/graphql',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'lin_key' }),
      }),
    );
  });
});

describe('findStateIdByName', () => {
  it('returns the id of a matching state', async () => {
    mockStatesResponse();
    expect(await findStateIdByName('lin_key', 'team-1', 'In Progress')).toBe('st-2');
  });

  it('returns null when no state matches', async () => {
    mockStatesResponse();
    expect(await findStateIdByName('lin_key', 'team-1', 'Nonexistent')).toBeNull();
  });
});

describe('updateLinearIssueState', () => {
  it('resolves when the API returns success: true', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { issueUpdate: { success: true, issue: { id: 'i-1', state: { name: 'Done' } } } } }),
    });
    await expect(updateLinearIssueState('lin_key', 'i-1', 'st-3')).resolves.toBeUndefined();
  });

  it('throws when the API returns success: false', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { issueUpdate: { success: false } } }),
    });
    await expect(updateLinearIssueState('lin_key', 'i-1', 'st-3')).rejects.toThrow('success: false');
  });

  it('throws when the API returns GraphQL errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ errors: [{ message: 'Not authorized' }] }),
    });
    await expect(updateLinearIssueState('lin_key', 'i-1', 'st-3')).rejects.toThrow('Not authorized');
  });

  it('throws when the HTTP request fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable' });
    await expect(updateLinearIssueState('lin_key', 'i-1', 'st-3')).rejects.toThrow('503');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- linear-client
```

Expected: FAIL — `Cannot find module '@lib/linear-client'`

- [ ] **Step 3: Write `src/app/lib/linear-client.ts`**

```typescript
import type { LinearState } from './types';

const LINEAR_API = 'https://api.linear.app/graphql';

interface GraphQLResponse<T> {
  data: T;
  errors?: Array<{ message: string }>;
}

async function gql<T>(apiKey: string, query: string, variables: Record<string, string>): Promise<T> {
  const response = await fetch(LINEAR_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Linear API HTTP error: ${response.status} ${response.statusText}`);
  }

  const result = await response.json() as GraphQLResponse<T>;
  if (result.errors?.length) {
    throw new Error(`Linear GraphQL error: ${result.errors[0].message}`);
  }
  return result.data;
}

export async function getLinearStates(apiKey: string, teamId: string): Promise<LinearState[]> {
  const query = `
    query GetTeamStates($teamId: String!) {
      team(id: $teamId) {
        states { nodes { id name type } }
      }
    }
  `;
  const data = await gql<{ team: { states: { nodes: LinearState[] } } }>(apiKey, query, { teamId });
  return data.team.states.nodes;
}

export async function findStateIdByName(
  apiKey: string,
  teamId: string,
  stateName: string,
): Promise<string | null> {
  const states = await getLinearStates(apiKey, teamId);
  return states.find(s => s.name === stateName)?.id ?? null;
}

export async function updateLinearIssueState(
  apiKey: string,
  issueId: string,
  stateId: string,
): Promise<void> {
  const mutation = `
    mutation UpdateIssueState($issueId: String!, $stateId: String!) {
      issueUpdate(id: $issueId, input: { stateId: $stateId }) {
        success
        issue { id state { name } }
      }
    }
  `;
  const data = await gql<{ issueUpdate: { success: boolean } }>(apiKey, mutation, { issueId, stateId });
  if (!data.issueUpdate.success) {
    throw new Error(`Linear issueUpdate returned success: false for issue ${issueId}`);
  }
}
```

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/lib/linear-client.ts src/app/__tests__/linear-client.test.ts
git commit -m "feat: Linear GraphQL client (states, issue state updates)"
```

---

## Task 6: Linear webhook function

**Files:**
- Create: `src/app/functions/LinearWebhook.ts`
- Create: `src/app/functions/linear-webhook-hsmeta.json`
- Create: `src/app/__tests__/linear-webhook.test.ts`

**Interfaces:**
- Consumes: `verifyLinearSignature` from `hmac.ts`; `createHubSpotClient`, `getCurrentStage`, `upsertContent`, `upsertChangelog` from `hubspot-client.ts`; `LINEAR_CHANGELOG_LABEL`, `HS_SYNC_TAG`, `LINEAR_STATE_TO_CONTENT_STAGE`, `LINEAR_STATE_TO_CHANGELOG_STAGE` from `mapping.ts`; `PORTAL_CONFIG` from `portal-config.ts`
- Produces: public POST endpoint at `/hs/serverless/api/linear-webhook` — registered with Linear as the webhook URL

- [ ] **Step 1: Write the failing test `src/app/__tests__/linear-webhook.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

let main: (ctx: any) => Promise<any>;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();

  vi.doMock('@lib/hmac', () => ({ verifyLinearSignature: vi.fn().mockReturnValue(true) }));
  vi.doMock('@lib/hubspot-client', () => ({
    createHubSpotClient: vi.fn(() => ({})),
    getCurrentStage: vi.fn().mockResolvedValue(null),
    upsertContent: vi.fn().mockResolvedValue({ id: 'hs-1', action: 'created' }),
    upsertChangelog: vi.fn().mockResolvedValue({ id: 'hs-2', action: 'created' }),
  }));
  vi.doMock('../lib/portal-config', () => ({
    PORTAL_CONFIG: {
      content: {
        objectTypeId: '2-content',
        pipelineId: 'pipe-1',
        stageIds: { idea: 'stage-idea', outline: 'stage-outline', drafting: 'stage-drafting', editing: 'stage-editing', review: 'stage-review', published: 'stage-published', archived: 'stage-archived' },
      },
      changelog: {
        objectTypeId: '2-changelog',
        pipelineId: 'pipe-2',
        stageIds: { identified: 'stage-identified', drafting: 'stage-drafting-cl', reviewing: 'stage-reviewing', published: 'stage-published-cl' },
      },
    },
  }));

  process.env.LINEAR_WEBHOOK_SECRET = 'test-secret';

  const mod = await import('../functions/LinearWebhook');
  main = mod.main;
});

const baseCtx = {
  method: 'POST',
  headers: { 'linear-signature': 'abc123' },
  query: {},
  accountId: 999,
  body: {
    action: 'create',
    type: 'Issue',
    organizationId: 'org-1',
    webhookTimestamp: 1000,
    webhookId: 'wh-1',
    data: {
      id: 'lin-1',
      identifier: 'ENG-1',
      title: 'Improve docs',
      state: { id: 'st-1', name: 'Backlog', type: 'backlog' },
      labels: { nodes: [] },
      url: 'https://linear.app/issue/ENG-1',
      team: { id: 't-1', name: 'Eng' },
    },
  },
};

describe('LinearWebhook.main', () => {
  it('returns 401 when signature is invalid', async () => {
    const { verifyLinearSignature: mockVerify } = await import('@lib/hmac');
    vi.mocked(mockVerify).mockReturnValue(false);
    const result = await main(baseCtx);
    expect(result.statusCode).toBe(401);
  });

  it('skips non-Issue events and returns 200', async () => {
    const ctx = { ...baseCtx, body: { ...baseCtx.body, type: 'Comment' } };
    const result = await main(ctx);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).skipped).toBe(true);
  });

  it('calls upsertContent for issues without the changelog label', async () => {
    const { upsertContent: mockUpsert } = await import('@lib/hubspot-client');
    await main(baseCtx);
    expect(mockUpsert).toHaveBeenCalledOnce();
  });

  it('calls upsertChangelog for issues with the "changelog" label', async () => {
    const { upsertChangelog: mockUpsert } = await import('@lib/hubspot-client');
    const ctx = {
      ...baseCtx,
      body: {
        ...baseCtx.body,
        data: { ...baseCtx.body.data, labels: { nodes: [{ name: 'changelog' }] } },
      },
    };
    await main(ctx);
    expect(mockUpsert).toHaveBeenCalledOnce();
  });

  it('returns 200 and ok:true on success', async () => {
    const result = await main(baseCtx);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).ok).toBe(true);
  });

  it('skips when incoming Linear state already matches the current HubSpot stage (echo prevention)', async () => {
    const { getCurrentStage: mockGetStage } = await import('@lib/hubspot-client');
    // baseCtx state is 'Backlog' → maps to 'idea' → stageId 'stage-idea' in the mock config
    vi.mocked(mockGetStage).mockResolvedValue('stage-idea');
    const result = await main(baseCtx);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).reason).toBe('stage already matches');
  });

  it('returns 500 when LINEAR_WEBHOOK_SECRET is missing', async () => {
    delete process.env.LINEAR_WEBHOOK_SECRET;
    const result = await main(baseCtx);
    expect(result.statusCode).toBe(500);
  });

  it('returns 500 when upsert throws', async () => {
    const { upsertContent: mockUpsert } = await import('@lib/hubspot-client');
    vi.mocked(mockUpsert).mockRejectedValue(new Error('API down'));
    const result = await main(baseCtx);
    expect(result.statusCode).toBe(500);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- linear-webhook
```

Expected: FAIL — `Cannot find module '../functions/LinearWebhook'`

- [ ] **Step 3: Write `src/app/functions/LinearWebhook.ts`**

```typescript
import { verifyLinearSignature } from '../lib/hmac';
import { createHubSpotClient, getCurrentStage, upsertContent, upsertChangelog } from '../lib/hubspot-client';
import type { LinearWebhookPayload } from '../lib/types';
import {
  LINEAR_CHANGELOG_LABEL,
  HS_SYNC_TAG,
  LINEAR_STATE_TO_CONTENT_STAGE,
  LINEAR_STATE_TO_CHANGELOG_STAGE,
} from '../lib/mapping';
import { PORTAL_CONFIG } from '../lib/portal-config';

interface PublicFunctionContext {
  method: string;
  body: LinearWebhookPayload;
  headers: Record<string, string>;
  query: Record<string, string>;
  accountId: number;
}

export async function main(context: PublicFunctionContext): Promise<{ statusCode: number; body: string }> {
  const secret = process.env.LINEAR_WEBHOOK_SECRET;
  if (!secret) {
    console.error('LINEAR_WEBHOOK_SECRET is not set');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfiguration' }) };
  }

  if (!verifyLinearSignature(context.body, context.headers['linear-signature'], secret)) {
    console.warn('Rejected webhook: invalid Linear signature');
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid signature' }) };
  }

  const payload = context.body;

  if (payload.type !== 'Issue') {
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'not an Issue event' }) };
  }

  // Explicit tag: skip payloads that originated from our own sync
  if (payload.data.description?.includes(HS_SYNC_TAG)) {
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'hs-sync echo' }) };
  }

  const labels = payload.data.labels?.nodes?.map(l => l.name) ?? [];
  const isChangelog = labels.includes(LINEAR_CHANGELOG_LABEL);
  const client = createHubSpotClient();

  // Stage comparison: skip if HubSpot already reflects the incoming Linear state (prevents echo loops)
  const config = isChangelog ? PORTAL_CONFIG.changelog : PORTAL_CONFIG.content;
  const stageMap = isChangelog ? LINEAR_STATE_TO_CHANGELOG_STAGE : LINEAR_STATE_TO_CONTENT_STAGE;
  const incomingStageName = stageMap[payload.data.state.name];
  const expectedStageId = incomingStageName
    ? (config.stageIds as Record<string, string>)[incomingStageName]
    : undefined;
  if (expectedStageId) {
    const currentStageId = await getCurrentStage(client, config.objectTypeId, payload.data.id);
    if (currentStageId === expectedStageId) {
      console.log(`Skipping echo for Linear ${payload.data.id}: stage already matches`);
      return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'stage already matches' }) };
    }
  }

  try {
    const result = isChangelog
      ? await upsertChangelog(client, payload)
      : await upsertContent(client, payload);

    console.log(`${result.action} ${isChangelog ? 'changelog' : 'content'} ${result.id} for Linear ${payload.data.id}`);
    return { statusCode: 200, body: JSON.stringify({ ok: true, ...result }) };
  } catch (err) {
    console.error('Upsert failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal error' }) };
  }
}
```

- [ ] **Step 4: Write `src/app/functions/linear-webhook-hsmeta.json`**

```json
{
  "uid": "linear_webhook",
  "type": "app-function",
  "config": {
    "entrypoint": "/app/functions/LinearWebhook.js",
    "endpoint": {
      "path": "linear-webhook",
      "methods": ["POST"]
    },
    "secretKeys": ["LINEAR_WEBHOOK_SECRET"]
  }
}
```

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: all suites PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/functions/LinearWebhook.ts src/app/functions/linear-webhook-hsmeta.json src/app/__tests__/linear-webhook.test.ts
git commit -m "feat: Linear webhook receiver function with HMAC verification and changelog routing"
```

---

## Task 7: Sync-to-Linear function + workflow action config

**Files:**
- Create: `src/app/functions/SyncToLinear.ts`
- Create: `src/app/functions/sync-to-linear-hsmeta.json`
- Create: `src/app/workflow-actions/sync-to-linear-hsmeta.json`
- Create: `src/app/__tests__/sync-to-linear.test.ts`

**Interfaces:**
- Consumes: `findStateIdByName`, `updateLinearIssueState` from `linear-client.ts`; mapping tables from `mapping.ts`
- Produces: public POST endpoint at `/hs/serverless/api/sync-to-linear` — used as the `actionUrl` in the workflow action config

**Note on `actionUrl`:** The workflow action hsmeta.json requires the full deployed URL of the SyncToLinear function. You won't have this until after the first `hs project upload`. In this task, use `"https://REPLACE_AFTER_DEPLOY"` as a placeholder and update it in Task 9.

- [ ] **Step 1: Write the failing test `src/app/__tests__/sync-to-linear.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

let main: (ctx: any) => Promise<any>;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();

  vi.doMock('@lib/linear-client', () => ({
    findStateIdByName: vi.fn().mockResolvedValue('st-done'),
    updateLinearIssueState: vi.fn().mockResolvedValue(undefined),
  }));

  process.env.LINEAR_API_KEY = 'lin_test_key';

  const mod = await import('../functions/SyncToLinear');
  main = mod.main;
});

const baseCtx = {
  method: 'POST',
  headers: {},
  query: {},
  accountId: 999,
  body: {
    callbackId: 'cb-1',
    hs_object_id: 'hs-456',
    inputFields: {
      linearIssueId: 'lin-123',
      hubspotStage: 'published',
      objectType: 'content',
      linearTeamId: 'team-1',
    },
  },
};

describe('SyncToLinear.main', () => {
  it('returns 200 and syncStatus "success" when everything works', async () => {
    const result = await main(baseCtx);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.outputFields.syncStatus).toBe('success');
    expect(body.outputFields.linearStateName).toBe('Done');
  });

  it('calls updateLinearIssueState with the resolved state ID', async () => {
    const { updateLinearIssueState } = await import('@lib/linear-client');
    await main(baseCtx);
    expect(updateLinearIssueState).toHaveBeenCalledWith('lin_test_key', 'lin-123', 'st-done');
  });

  it('returns 400 for an unknown HubSpot stage', async () => {
    const ctx = {
      ...baseCtx,
      body: { ...baseCtx.body, inputFields: { ...baseCtx.body.inputFields, hubspotStage: 'unknown_stage' } },
    };
    const result = await main(ctx);
    expect(result.statusCode).toBe(400);
  });

  it('returns 404 when the Linear state name is not found in the team', async () => {
    const { findStateIdByName } = await import('@lib/linear-client');
    vi.mocked(findStateIdByName).mockResolvedValue(null);
    const result = await main(baseCtx);
    expect(result.statusCode).toBe(404);
  });

  it('returns 500 when LINEAR_API_KEY is missing', async () => {
    delete process.env.LINEAR_API_KEY;
    const result = await main(baseCtx);
    expect(result.statusCode).toBe(500);
  });

  it('handles changelog objectType, mapping "reviewing" → "In Review"', async () => {
    const { findStateIdByName } = await import('@lib/linear-client');
    const ctx = {
      ...baseCtx,
      body: {
        ...baseCtx.body,
        inputFields: { ...baseCtx.body.inputFields, hubspotStage: 'reviewing', objectType: 'changelog' },
      },
    };
    await main(ctx);
    expect(findStateIdByName).toHaveBeenCalledWith('lin_test_key', 'team-1', 'In Review');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- sync-to-linear
```

Expected: FAIL — `Cannot find module '../functions/SyncToLinear'`

- [ ] **Step 3: Write `src/app/functions/SyncToLinear.ts`**

```typescript
import { findStateIdByName, updateLinearIssueState } from '../lib/linear-client';
import { CONTENT_STAGE_TO_LINEAR_STATE, CHANGELOG_STAGE_TO_LINEAR_STATE } from '../lib/mapping';

interface SyncToLinearBody {
  callbackId: string;
  hs_object_id: string;
  inputFields: {
    linearIssueId: string;
    hubspotStage: string;
    objectType: 'content' | 'changelog';
    linearTeamId: string;
  };
}

interface SyncToLinearContext {
  method: string;
  body: SyncToLinearBody;
  headers: Record<string, string>;
  query: Record<string, string>;
  accountId: number;
}

export async function main(context: SyncToLinearContext): Promise<{ statusCode: number; body: string }> {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    console.error('LINEAR_API_KEY is not set');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfiguration' }) };
  }

  const { linearIssueId, hubspotStage, objectType, linearTeamId } = context.body.inputFields;

  const stageMap = objectType === 'changelog'
    ? CHANGELOG_STAGE_TO_LINEAR_STATE
    : CONTENT_STAGE_TO_LINEAR_STATE;

  const targetStateName = (stageMap as Record<string, string>)[hubspotStage];
  if (!targetStateName) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Unknown HubSpot stage: "${hubspotStage}" for objectType "${objectType}"` }),
    };
  }

  const stateId = await findStateIdByName(apiKey, linearTeamId, targetStateName);
  if (!stateId) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: `Linear state "${targetStateName}" not found in team ${linearTeamId}` }),
    };
  }

  await updateLinearIssueState(apiKey, linearIssueId, stateId);

  console.log(`Synced Linear issue ${linearIssueId} → "${targetStateName}" (${stateId})`);
  return {
    statusCode: 200,
    body: JSON.stringify({
      outputFields: {
        syncStatus: 'success',
        linearStateName: targetStateName,
      },
    }),
  };
}
```

- [ ] **Step 4: Write `src/app/functions/sync-to-linear-hsmeta.json`**

```json
{
  "uid": "sync_to_linear",
  "type": "app-function",
  "config": {
    "entrypoint": "/app/functions/SyncToLinear.js",
    "endpoint": {
      "path": "sync-to-linear",
      "methods": ["POST"]
    },
    "secretKeys": ["LINEAR_API_KEY"]
  }
}
```

- [ ] **Step 5: Write `src/app/workflow-actions/sync-to-linear-hsmeta.json`**

Replace `https://REPLACE_AFTER_DEPLOY` with the actual function URL after Task 9.

```json
{
  "uid": "sync_to_linear_action",
  "type": "workflow-action",
  "config": {
    "actionUrl": "https://REPLACE_AFTER_DEPLOY",
    "isPublished": false,
    "supportedClients": [{ "client": "WORKFLOWS" }],
    "objectTypes": [],
    "inputFields": [
      {
        "typeDefinition": {
          "name": "linearIssueId",
          "type": "string",
          "fieldType": "text"
        },
        "supportedValueTypes": ["OBJECT_PROPERTY"],
        "isRequired": true
      },
      {
        "typeDefinition": {
          "name": "hubspotStage",
          "type": "string",
          "fieldType": "text"
        },
        "supportedValueTypes": ["OBJECT_PROPERTY"],
        "isRequired": true
      },
      {
        "typeDefinition": {
          "name": "objectType",
          "type": "enumeration",
          "fieldType": "select",
          "options": [
            { "value": "content", "label": "Content" },
            { "value": "changelog", "label": "Changelog Entry" }
          ]
        },
        "supportedValueTypes": ["STATIC_VALUE"],
        "isRequired": true
      },
      {
        "typeDefinition": {
          "name": "linearTeamId",
          "type": "string",
          "fieldType": "text"
        },
        "supportedValueTypes": ["STATIC_VALUE"],
        "isRequired": true
      }
    ],
    "outputFields": [
      {
        "typeDefinition": { "name": "syncStatus", "type": "string", "fieldType": "text" }
      },
      {
        "typeDefinition": { "name": "linearStateName", "type": "string", "fieldType": "text" }
      }
    ],
    "labels": {
      "en": {
        "actionName": "Sync Status to Linear",
        "appDisplayName": "Central Brain",
        "actionDescription": "Pushes the current HubSpot pipeline stage to the linked Linear issue",
        "actionCardContent": "Sync to Linear → {{objectType}}",
        "inputFieldLabels": {
          "linearIssueId": "Linear Issue ID",
          "hubspotStage": "HubSpot Pipeline Stage",
          "objectType": "Object Type",
          "linearTeamId": "Linear Team ID"
        },
        "inputFieldDescriptions": {
          "linearIssueId": "The linear_issue_id property from the HubSpot record",
          "hubspotStage": "The hs_pipeline_stage property from the HubSpot record",
          "objectType": "Whether this is a Content or Changelog Entry record",
          "linearTeamId": "Your Linear team ID — find it in Linear Settings > API"
        },
        "outputFieldLabels": {
          "syncStatus": "Sync Status",
          "linearStateName": "Linear State Set"
        }
      }
    }
  }
}
```

- [ ] **Step 6: Run all tests**

```bash
npm test
```

Expected: all suites PASS

- [ ] **Step 7: Validate project config**

```bash
npm run validate
```

Expected: lint PASS, typecheck PASS, tests PASS, project-validate will run after first upload

- [ ] **Step 8: Commit**

```bash
git add src/app/functions/SyncToLinear.ts src/app/functions/sync-to-linear-hsmeta.json src/app/workflow-actions/sync-to-linear-hsmeta.json src/app/__tests__/sync-to-linear.test.ts
git commit -m "feat: Sync-to-Linear serverless function and workflow action definition"
```

---

## Task 8: Portal provisioning script

**Files:**
- Modify: `package.json` (add `tsx` dev dep + `provision` script)
- Create: `src/scripts/provision-objects.ts`

**What it does:** Creates the Content, Changelog, and Video custom objects in your HubSpot dev portal — including all properties and pipelines. Run it once. It outputs values to paste into `portal-config.ts`.

**Pre-requisite:** You need a HubSpot Personal Access Token (PAK) with `crm.schemas.custom.write` scope. Set it in `.env` as `HUBSPOT_DEV_PERSONAL_ACCESS_KEY`, then export it before running.

- [ ] **Step 1: Add `tsx` dev dependency and `provision` script**

In `package.json`, add to `devDependencies`:
```json
"tsx": "^4.0.0"
```

Add to `scripts`:
```json
"provision": "tsx src/scripts/provision-objects.ts"
```

Install it:
```bash
npm install
```

- [ ] **Step 2: Write `src/scripts/provision-objects.ts`**

```typescript
import { Client } from '@hubspot/api-client';

const client = new Client({ accessToken: process.env.HUBSPOT_DEV_PERSONAL_ACCESS_KEY });

async function createContentObject() {
  console.log('\n--- Creating Content custom object ---');
  const schema = await client.crm.schemas.coreApi.create({
    name: 'content',
    labels: { singular: 'Content', plural: 'Content' },
    primaryDisplayProperty: 'title',
    properties: [
      { name: 'title', label: 'Title', type: 'string', fieldType: 'text', groupName: 'contentinformation' },
      { name: 'content_type', label: 'Content Type', type: 'enumeration', fieldType: 'select', groupName: 'contentinformation',
        options: [
          { label: 'Blog Post', value: 'blog_post', displayOrder: 0, hidden: false },
          { label: 'Video', value: 'video', displayOrder: 1, hidden: false },
          { label: 'Tutorial', value: 'tutorial', displayOrder: 2, hidden: false },
          { label: 'Talk', value: 'talk', displayOrder: 3, hidden: false },
          { label: 'Changelog', value: 'changelog', displayOrder: 4, hidden: false },
          { label: 'Documentation', value: 'documentation', displayOrder: 5, hidden: false },
          { label: 'Social', value: 'social', displayOrder: 6, hidden: false },
        ]
      },
      { name: 'source_url', label: 'Source URL', type: 'string', fieldType: 'text', groupName: 'contentinformation' },
      { name: 'published_url', label: 'Published URL', type: 'string', fieldType: 'text', groupName: 'contentinformation' },
      { name: 'linear_issue_url', label: 'Linear Issue URL', type: 'string', fieldType: 'text', groupName: 'contentinformation' },
      { name: 'linear_issue_id', label: 'Linear Issue ID', type: 'string', fieldType: 'text', groupName: 'contentinformation' },
      { name: 'asana_task_url', label: 'Asana Task URL', type: 'string', fieldType: 'text', groupName: 'contentinformation' },
      { name: 'asana_task_id', label: 'Asana Task ID', type: 'string', fieldType: 'text', groupName: 'contentinformation' },
      { name: 'target_date', label: 'Target Date', type: 'date', fieldType: 'date', groupName: 'contentinformation' },
      { name: 'actual_date', label: 'Actual Publish Date', type: 'date', fieldType: 'date', groupName: 'contentinformation' },
      { name: 'topic_tags', label: 'Topic Tags', type: 'enumeration', fieldType: 'checkbox', groupName: 'contentinformation',
        options: [
          { label: 'API', value: 'api', displayOrder: 0, hidden: false },
          { label: 'CRM', value: 'crm', displayOrder: 1, hidden: false },
          { label: 'Workflows', value: 'workflows', displayOrder: 2, hidden: false },
          { label: 'UI Extensions', value: 'ui_extensions', displayOrder: 3, hidden: false },
          { label: 'Integrations', value: 'integrations', displayOrder: 4, hidden: false },
          { label: 'Developer Platform', value: 'developer_platform', displayOrder: 5, hidden: false },
        ]
      },
      { name: 'enterpret_theme', label: 'Enterpret Theme', type: 'string', fieldType: 'text', groupName: 'contentinformation' },
      { name: 'enterpret_quote_count', label: 'Enterpret Quote Count', type: 'number', fieldType: 'number', groupName: 'contentinformation' },
      { name: 'notes', label: 'Notes', type: 'string', fieldType: 'textarea', groupName: 'contentinformation' },
      { name: 'social_post_draft', label: 'Social Post Draft', type: 'string', fieldType: 'textarea', groupName: 'contentinformation' },
      { name: 'social_published_at', label: 'Social Published At', type: 'datetime', fieldType: 'date', groupName: 'contentinformation' },
      { name: 'social_post_url', label: 'Social Post URL', type: 'string', fieldType: 'text', groupName: 'contentinformation' },
      { name: 'social_engagement_score', label: 'Social Engagement Score', type: 'number', fieldType: 'number', groupName: 'contentinformation' },
    ],
    associatedObjects: ['CONTACT', 'COMPANY'],
  });

  console.log('  Created schema. objectTypeId:', schema.objectTypeId);

  const pipeline = await client.crm.pipelines.pipelinesApi.create(schema.objectTypeId, {
    label: 'Content Lifecycle',
    displayOrder: 0,
    stages: [
      { label: 'Idea', displayOrder: 0, metadata: { probability: '0.1' } },
      { label: 'Outline', displayOrder: 1, metadata: { probability: '0.2' } },
      { label: 'Drafting', displayOrder: 2, metadata: { probability: '0.4' } },
      { label: 'Editing', displayOrder: 3, metadata: { probability: '0.6' } },
      { label: 'Review', displayOrder: 4, metadata: { probability: '0.8' } },
      { label: 'Published', displayOrder: 5, metadata: { probability: '1.0' } },
      { label: 'Archived', displayOrder: 6, metadata: { probability: '0.0' } },
    ],
  });

  console.log('  Created pipeline. pipelineId:', pipeline.id);
  console.log('  Stage IDs:');
  pipeline.stages.forEach(s => console.log(`    ${s.label}: ${s.id}`));

  console.log('\n  Paste this into src/app/lib/portal-config.ts → content:');
  console.log(`    objectTypeId: '${schema.objectTypeId}',`);
  console.log(`    pipelineId: '${pipeline.id}',`);
  console.log(`    stageIds: {`);
  pipeline.stages.forEach(s => console.log(`      ${s.label.toLowerCase()}: '${s.id}',`));
  console.log(`    },`);

  return { objectTypeId: schema.objectTypeId, pipelineId: pipeline.id, stages: pipeline.stages };
}

async function createChangelogObject() {
  console.log('\n--- Creating Changelog Entry custom object ---');
  const schema = await client.crm.schemas.coreApi.create({
    name: 'changelog_entry',
    labels: { singular: 'Changelog Entry', plural: 'Changelog Entries' },
    primaryDisplayProperty: 'title',
    properties: [
      { name: 'title', label: 'Title', type: 'string', fieldType: 'text', groupName: 'changelog_entryinformation' },
      { name: 'product_area', label: 'Product Area', type: 'enumeration', fieldType: 'select', groupName: 'changelog_entryinformation',
        options: [
          { label: 'CRM', value: 'crm', displayOrder: 0, hidden: false },
          { label: 'Marketing', value: 'marketing', displayOrder: 1, hidden: false },
          { label: 'Sales', value: 'sales', displayOrder: 2, hidden: false },
          { label: 'Service', value: 'service', displayOrder: 3, hidden: false },
          { label: 'Operations', value: 'operations', displayOrder: 4, hidden: false },
          { label: 'Developer Platform', value: 'developer_platform', displayOrder: 5, hidden: false },
        ]
      },
      { name: 'change_type', label: 'Change Type', type: 'enumeration', fieldType: 'select', groupName: 'changelog_entryinformation',
        options: [
          { label: 'New Feature', value: 'new_feature', displayOrder: 0, hidden: false },
          { label: 'Improvement', value: 'improvement', displayOrder: 1, hidden: false },
          { label: 'Deprecation', value: 'deprecation', displayOrder: 2, hidden: false },
          { label: 'Bug Fix', value: 'bug_fix', displayOrder: 3, hidden: false },
          { label: 'Breaking Change', value: 'breaking_change', displayOrder: 4, hidden: false },
        ]
      },
      { name: 'linear_issue_url', label: 'Linear Issue URL', type: 'string', fieldType: 'text', groupName: 'changelog_entryinformation' },
      { name: 'linear_issue_id', label: 'Linear Issue ID', type: 'string', fieldType: 'text', groupName: 'changelog_entryinformation' },
      { name: 'published_url', label: 'Published URL', type: 'string', fieldType: 'text', groupName: 'changelog_entryinformation' },
      { name: 'release_date', label: 'Release Date', type: 'date', fieldType: 'date', groupName: 'changelog_entryinformation' },
      { name: 'publish_date', label: 'Publish Date', type: 'date', fieldType: 'date', groupName: 'changelog_entryinformation' },
      { name: 'developer_impact', label: 'Developer Impact', type: 'enumeration', fieldType: 'select', groupName: 'changelog_entryinformation',
        options: [
          { label: 'Breaking', value: 'breaking', displayOrder: 0, hidden: false },
          { label: 'Action Required', value: 'action_required', displayOrder: 1, hidden: false },
          { label: 'Informational', value: 'informational', displayOrder: 2, hidden: false },
        ]
      },
      { name: 'notes', label: 'Notes', type: 'string', fieldType: 'textarea', groupName: 'changelog_entryinformation' },
      { name: 'topic_tags', label: 'Topic Tags', type: 'enumeration', fieldType: 'checkbox', groupName: 'changelog_entryinformation',
        options: [
          { label: 'API', value: 'api', displayOrder: 0, hidden: false },
          { label: 'CRM', value: 'crm', displayOrder: 1, hidden: false },
          { label: 'Workflows', value: 'workflows', displayOrder: 2, hidden: false },
          { label: 'UI Extensions', value: 'ui_extensions', displayOrder: 3, hidden: false },
          { label: 'Integrations', value: 'integrations', displayOrder: 4, hidden: false },
          { label: 'Developer Platform', value: 'developer_platform', displayOrder: 5, hidden: false },
        ]
      },
      { name: 'enterpret_theme', label: 'Enterpret Theme', type: 'string', fieldType: 'text', groupName: 'changelog_entryinformation' },
    ],
    associatedObjects: ['CONTACT', 'COMPANY'],
  });

  console.log('  Created schema. objectTypeId:', schema.objectTypeId);

  const pipeline = await client.crm.pipelines.pipelinesApi.create(schema.objectTypeId, {
    label: 'Changelog Lifecycle',
    displayOrder: 0,
    stages: [
      { label: 'Identified', displayOrder: 0, metadata: { probability: '0.2' } },
      { label: 'Drafting', displayOrder: 1, metadata: { probability: '0.5' } },
      { label: 'Reviewing', displayOrder: 2, metadata: { probability: '0.8' } },
      { label: 'Published', displayOrder: 3, metadata: { probability: '1.0' } },
    ],
  });

  console.log('  Created pipeline. pipelineId:', pipeline.id);
  console.log('\n  Paste this into src/app/lib/portal-config.ts → changelog:');
  console.log(`    objectTypeId: '${schema.objectTypeId}',`);
  console.log(`    pipelineId: '${pipeline.id}',`);
  console.log(`    stageIds: {`);
  pipeline.stages.forEach(s => console.log(`      ${s.label.toLowerCase()}: '${s.id}',`));
  console.log(`    },`);

  return { objectTypeId: schema.objectTypeId };
}

async function main() {
  if (!process.env.HUBSPOT_DEV_PERSONAL_ACCESS_KEY) {
    console.error('Error: HUBSPOT_DEV_PERSONAL_ACCESS_KEY environment variable is not set.');
    console.error('Export it first: export HUBSPOT_DEV_PERSONAL_ACCESS_KEY=your-pak-here');
    process.exit(1);
  }

  try {
    await createContentObject();
    await createChangelogObject();
    console.log('\n✓ Provisioning complete. Update portal-config.ts with the values above.');
  } catch (err: any) {
    console.error('Provisioning failed:', err?.message ?? err);
    process.exit(1);
  }
}

main();
```

- [ ] **Step 3: Set your dev portal PAK and run the provision script**

```bash
export HUBSPOT_DEV_PERSONAL_ACCESS_KEY=your-pak-here
npm run provision
```

Expected: the script prints objectTypeId, pipelineId, and stageIds for both objects.

- [ ] **Step 4: Paste the provisioning output into `src/app/lib/portal-config.ts`**

The script prints a ready-to-paste block. Replace every `FILL_IN` in portal-config.ts with the actual values.

- [ ] **Step 5: Commit the updated portal-config**

```bash
git add src/scripts/provision-objects.ts src/app/lib/portal-config.ts package.json package-lock.json
git commit -m "feat: portal provisioning script; update portal-config with dev sandbox IDs"
```

---

## Task 9: Deploy to dev portal + wire up end-to-end

This task deploys the app, gets the function URLs, and configures Linear to send webhooks.

**Pre-requisites:**
- Run `npx hs init` and select your dev portal if you haven't already
- Your dev portal PAK is in `.env` as `HUBSPOT_DEV_PERSONAL_ACCESS_KEY`

- [ ] **Step 1: Add app secrets for the deployed functions**

```bash
npx hs secret add LINEAR_WEBHOOK_SECRET
# When prompted, paste the webhook secret from your Linear settings (Settings > API > Webhooks)

npx hs secret add LINEAR_API_KEY
# When prompted, paste your Linear personal API key (Settings > API > Personal API Keys)
```

- [ ] **Step 2: Upload the project to your dev portal**

```bash
npm run upload:dev
```

Expected: all files upload successfully, no validation errors.

- [ ] **Step 3: Get the function endpoint URLs**

In HubSpot, navigate to **Settings > Private Apps > Central Brain > Features > Functions**. Copy the public endpoint URLs for:
- `linear-webhook` function → note as `WEBHOOK_URL`
- `sync-to-linear` function → note as `SYNC_URL`

Or use the CLI to list function URLs:
```bash
npx hs project logs --function=linear_webhook
```

The URL format is: `https://{your-domain}.hs-sites.com/hs/serverless/api/{path}`

- [ ] **Step 4: Update the workflow action `actionUrl`**

Edit `src/app/workflow-actions/sync-to-linear-hsmeta.json`, replace `"https://REPLACE_AFTER_DEPLOY"` with the actual `SYNC_URL` from Step 3.

- [ ] **Step 5: Re-upload after the actionUrl update**

```bash
npm run upload:dev
```

- [ ] **Step 6: Configure Linear webhook**

In Linear: **Settings > API > Webhooks > Create webhook**
- URL: your `WEBHOOK_URL` from Step 3
- Resource types: Issues (created, updated, removed)
- Copy the signing secret shown by Linear

Confirm the secret you added in Step 1 (`LINEAR_WEBHOOK_SECRET`) matches what Linear shows.

- [ ] **Step 7: Configure HubSpot workflow for outbound sync**

In HubSpot Workflows, create a new workflow:
- Object type: Content (or Changelog Entry)
- Enrollment trigger: "Pipeline stage changes"
- Action: "Sync Status to Linear" (your custom action)
- Input values:
  - Linear Issue ID → `[linear_issue_id]` (map from property)
  - HubSpot Pipeline Stage → `[hs_pipeline_stage]` (map from property)
  - Object Type → `content` or `changelog` (static)
  - Linear Team ID → your Linear team ID (static — find in Linear Settings > API)

- [ ] **Step 8: End-to-end test**

**Test A: Linear → HubSpot**
1. In Linear, create a new issue (label it `changelog` if you want a Changelog record)
2. Within a few seconds, check HubSpot for a new Content (or Changelog Entry) record with the `linear_issue_id` set

**Test B: HubSpot → Linear**
1. In HubSpot, find the record created in Test A
2. Move it to the next pipeline stage
3. In Linear, confirm the issue state updated to match

- [ ] **Step 9: Commit final state**

```bash
git add src/app/workflow-actions/sync-to-linear-hsmeta.json
git commit -m "deploy: update sync-to-linear actionUrl with dev portal endpoint"
```

---

## Phase 1+2 Milestone

At this point:
- Content, Changelog Entry, and Video custom objects exist in your dev portal with pipelines
- Linear issues tagged `changelog` auto-create Changelog records in HubSpot
- All other Linear issues create Content records
- Moving a record through the HubSpot pipeline updates the linked Linear issue
- All sync logic is tested with Vitest (no mocks skipped, no placeholder tests)
- The app validates cleanly with `npm run validate`

**Next:** Plan Phase 3 (Asana + Fellow + Enterpret + behavioral events). Start that plan when Phase 2 is deployed and working.

---

## Appendix A: Phase 1 UI-only tasks (no code required)

These Phase 1 items from the strategy doc are done in HubSpot Settings or Cowork — not in this codebase:

| Task | Where |
|---|---|
| Configure pipeline automation (auto-set dates, follow-up tasks on stage change) | HubSpot Settings > Objects > Pipelines > Automate |
| Configure pipeline rules (require `source_url` before Editing, etc.) | HubSpot Settings > Objects > Pipelines > Rules |
| Set up rollup properties (Content count on Projects, Content count on Contacts) | HubSpot Settings > Properties > Rollup |
| Enable stage calculated properties on Content + Changelog pipelines | HubSpot Settings > Objects > Pipelines (opt-in toggle) |
| Create `idea_to_publish_days` calculation property | HubSpot Settings > Properties > Calculation |
| Activate native Projects object and configure `hs_type` enum | HubSpot Data Model > Settings |
| Set up Project associations to Content, Video, Changelog, Contact | HubSpot Data Model |
| Manually create 5–10 Content records for current projects | HubSpot CRM |
| Connect Obsidian vault as a folder in Cowork | Cowork |
| Create Obsidian templates for meetings, content briefs, changelogs | Obsidian |
| Run `npx hs mcp setup` to connect AI coding agent to dev portal | Terminal |

## Appendix B: Video custom object provision (add to Task 8 provision script)

The `createVideoObject()` function below follows the same pattern as `createContentObject()` in Task 8. Call it from `main()` after `createChangelogObject()`.

```typescript
async function createVideoObject() {
  console.log('\n--- Creating Video custom object ---');
  const schema = await client.crm.schemas.coreApi.create({
    name: 'video',
    labels: { singular: 'Video', plural: 'Videos' },
    primaryDisplayProperty: 'title',
    properties: [
      // Identity
      { name: 'title', label: 'Title', type: 'string', fieldType: 'text', groupName: 'videoinformation' },
      { name: 'youtube_video_id', label: 'YouTube Video ID', type: 'string', fieldType: 'text', groupName: 'videoinformation' },
      { name: 'youtube_url', label: 'YouTube URL', type: 'string', fieldType: 'text', groupName: 'videoinformation' },
      // Content
      { name: 'video_description', label: 'Description', type: 'string', fieldType: 'textarea', groupName: 'videoinformation' },
      { name: 'thumbnail_url', label: 'Thumbnail URL', type: 'string', fieldType: 'text', groupName: 'videoinformation' },
      { name: 'tags', label: 'Tags', type: 'string', fieldType: 'text', groupName: 'videoinformation' },
      // Lifecycle
      { name: 'published_at', label: 'Published At', type: 'datetime', fieldType: 'date', groupName: 'videoinformation' },
      { name: 'scheduled_publish_at', label: 'Scheduled Publish At', type: 'datetime', fieldType: 'date', groupName: 'videoinformation' },
      // Metrics
      { name: 'view_count', label: 'View Count', type: 'number', fieldType: 'number', groupName: 'videoinformation' },
      { name: 'like_count', label: 'Like Count', type: 'number', fieldType: 'number', groupName: 'videoinformation' },
      { name: 'comment_count', label: 'Comment Count', type: 'number', fieldType: 'number', groupName: 'videoinformation' },
      // Analytics
      { name: 'impressions', label: 'Impressions', type: 'number', fieldType: 'number', groupName: 'videoinformation' },
      { name: 'click_through_rate', label: 'Click Through Rate', type: 'number', fieldType: 'number', groupName: 'videoinformation' },
      { name: 'average_view_duration', label: 'Avg View Duration (sec)', type: 'number', fieldType: 'number', groupName: 'videoinformation' },
      // Attribution
      { name: 'utm_link', label: 'UTM Link', type: 'string', fieldType: 'text', groupName: 'videoinformation' },
      { name: 'website_url', label: 'Website URL', type: 'string', fieldType: 'text', groupName: 'videoinformation' },
      { name: 'campaign_name', label: 'Campaign Name', type: 'string', fieldType: 'text', groupName: 'videoinformation' },
      // Content Studio
      { name: 'series_name', label: 'Series Name', type: 'string', fieldType: 'text', groupName: 'videoinformation' },
      { name: 'series_order', label: 'Series Order', type: 'number', fieldType: 'number', groupName: 'videoinformation' },
      { name: 'google_doc_url', label: 'Script / Google Doc URL', type: 'string', fieldType: 'text', groupName: 'videoinformation' },
    ],
    associatedObjects: ['CONTACT', 'COMPANY'],
  });

  console.log('  Created schema. objectTypeId:', schema.objectTypeId);

  const pipeline = await client.crm.pipelines.pipelinesApi.create(schema.objectTypeId, {
    label: 'Video Lifecycle',
    displayOrder: 0,
    stages: [
      { label: 'Draft', displayOrder: 0, metadata: { probability: '0.2' } },
      { label: 'Scheduled', displayOrder: 1, metadata: { probability: '0.5' } },
      { label: 'Public', displayOrder: 2, metadata: { probability: '1.0' } },
    ],
  });

  console.log('  Created pipeline. pipelineId:', pipeline.id);
  console.log('\n  Add this to src/app/lib/portal-config.ts → video: { objectTypeId, pipelineId, stageIds }');
  console.log(`    objectTypeId: '${schema.objectTypeId}'`);
  console.log(`    pipelineId: '${pipeline.id}'`);
  pipeline.stages.forEach(s => console.log(`    ${s.label.toLowerCase()}: '${s.id}'`));
}
```
