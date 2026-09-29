# Linear/Asana Status Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** A read-only CRM card on `content_piece` records showing live Linear issue and Asana task status, flagging when either has drifted from the HubSpot pipeline stage.

**Architecture:** The card sends `objectId` to a new app function via `hubspot.serverless()`. The function reads the record, fetches the Linear issue and Asana task in parallel with failures isolated per source, computes drift using the pipeline-appropriate mapping table, and returns one JSON payload.

**Tech Stack:** TypeScript, `@hubspot/ui-extensions`, HubSpot Projects platformVersion 2026.03, Vitest, native `fetch`.

## Global Constraints

- platformVersion `2026.03` — never change it.
- Node 18+ built-ins only: `fetch`, `crypto`. Never add `node-fetch` or `axios`.
- Tests use Vitest, never jest. Path alias `@lib` resolves to `src/app/lib/`.
- Function entrypoints in `*-hsmeta.json` use the `.js` extension even though source is `.ts`.
- `PRIVATE_APP_ACCESS_TOKEN` is available in every serverless function; fall back to `HS_ACCESS_TOKEN`.
- **Read-only.** No writes to Linear, Asana, or HubSpot anywhere in this plan.
- Card calls the function **by uid** with `hubspot.serverless('task_status_api', { parameters })`, which resolves to `{ statusCode, body }` where `body` is a JSON **string**. Functions read inputs as `ctx.parameters?.[k] ?? ctx.query?.[k] ?? ctx.body?.[k]`. Both were hard-won in `da8f677` / `71a7997` — do not re-derive them.
- Drift comparison accepts **either** direction matching: `FORWARD[stage] === actual || REVERSE[actual] === stage`. The tables are many-to-one both ways; a single-direction check produces false drift.
- Card `location` is `crm.record.tab` — the only value confirmed in HubSpot's 2026.03 sample.

## Testing Note

`npm run validate` currently **fails** on a pre-existing lint error at `src/scripts/provision-app-settings.ts:53` (`Forbidden non-null assertion`), unrelated to this work. It short-circuits before typecheck and tests run. Until it is fixed, verify with `npm run typecheck` and `npm test` separately, and do not treat the `validate` failure as caused by these changes.

---

### Task 1: Drift comparison logic

Pure functions, no I/O. Fully unit tested before anything touches the network.

**Files:**
- Create: `src/app/lib/drift.ts`
- Test: `src/app/__tests__/drift.test.ts`

**Interfaces:**
- Consumes: `LINEAR_STATE_TO_CONTENT_STAGE`, `LINEAR_STATE_TO_CHANGELOG_STAGE`, `CONTENT_STAGE_TO_LINEAR_STATE`, `CHANGELOG_STAGE_TO_LINEAR_STATE`, `CONTENT_STAGE_TO_ASANA_STAGE`, `CHANGELOG_STAGE_TO_ASANA_STAGE`, `ASANA_STAGE_TO_CONTENT_STAGE`, `ASANA_STAGE_TO_CHANGELOG_STAGE` from `./mapping`; `PortalConfig` from `./portal-config`.
- Produces:
  - `type PipelineName = 'content' | 'changelog'`
  - `interface DriftResult { inSync: boolean; expectedState: string | null; actualState: string }`
  - `resolvePipeline(config: PortalConfig, hsPipelineId: string): PipelineName | null`
  - `stageNameFromId(config: PortalConfig, pipeline: PipelineName, stageId: string): string | null`
  - `computeLinearDrift(pipeline: PipelineName, stage: string, linearState: string): DriftResult | null`
  - `computeAsanaDrift(pipeline: PipelineName, stage: string, asanaStageGid: string): DriftResult | null`

- [x] **Step 1: Write the failing tests**

Create `src/app/__tests__/drift.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  resolvePipeline,
  stageNameFromId,
  computeLinearDrift,
  computeAsanaDrift,
} from '../lib/drift';
import type { PortalConfig } from '../lib/portal-config';

const config = {
  content: {
    objectTypeId: '2-1',
    pipelines: {
      content: {
        pipelineId: 'pipe-content',
        stageIds: { idea: 's1', outline: 's2', drafting: 's3', editing: 's4', review: 's5', published: 's6', archived: 's7' },
      },
      changelog: {
        pipelineId: 'pipe-changelog',
        stageIds: { identified: 'c1', drafting: 'c2', reviewing: 'c3', published: 'c4' },
      },
    },
  },
} as unknown as PortalConfig;

describe('resolvePipeline', () => {
  it('identifies the content pipeline', () => {
    expect(resolvePipeline(config, 'pipe-content')).toBe('content');
  });

  it('identifies the changelog pipeline', () => {
    expect(resolvePipeline(config, 'pipe-changelog')).toBe('changelog');
  });

  it('returns null for an unknown pipeline', () => {
    expect(resolvePipeline(config, 'pipe-nope')).toBeNull();
  });
});

describe('stageNameFromId', () => {
  it('reverses a content stage id to its name', () => {
    expect(stageNameFromId(config, 'content', 's4')).toBe('editing');
  });

  it('reverses a changelog stage id to its name', () => {
    expect(stageNameFromId(config, 'changelog', 'c3')).toBe('reviewing');
  });

  it('returns null for an unknown stage id', () => {
    expect(stageNameFromId(config, 'content', 'nope')).toBeNull();
  });
});

describe('computeLinearDrift', () => {
  it('reports in sync when forward mapping matches', () => {
    const r = computeLinearDrift('content', 'drafting', 'In Progress');
    expect(r).toEqual({ inSync: true, expectedState: 'In Progress', actualState: 'In Progress' });
  });

  // The many-to-one trap: 'editing' also maps forward to 'In Progress',
  // but reversing 'In Progress' yields 'drafting'. Must NOT report drift.
  it('reports in sync for editing vs In Progress', () => {
    const r = computeLinearDrift('content', 'editing', 'In Progress');
    expect(r?.inSync).toBe(true);
  });

  // The reverse-direction trap on the changelog pipeline: 'identified'
  // maps forward to 'Backlog', but 'Canceled' reverses to 'identified'.
  it('reports in sync for identified vs Canceled on changelog', () => {
    const r = computeLinearDrift('changelog', 'identified', 'Canceled');
    expect(r?.inSync).toBe(true);
  });

  it('reports drift on a genuine mismatch', () => {
    const r = computeLinearDrift('content', 'drafting', 'Done');
    expect(r).toEqual({ inSync: false, expectedState: 'In Progress', actualState: 'Done' });
  });

  // Uses the changelog table, not the content one. With the content table
  // 'reviewing' is not a key and this would misreport.
  it('uses the changelog table for changelog records', () => {
    const r = computeLinearDrift('changelog', 'reviewing', 'In Review');
    expect(r?.inSync).toBe(true);
  });

  it('returns null when the state maps nowhere', () => {
    expect(computeLinearDrift('content', 'drafting', 'Triage')).toBeNull();
  });
});

describe('computeAsanaDrift', () => {
  it('reports in sync when the enum gid matches', () => {
    const r = computeAsanaDrift('content', 'drafting', '1202184607667441');
    expect(r?.inSync).toBe(true);
  });

  it('reports in sync for editing, which shares the In Progress gid', () => {
    const r = computeAsanaDrift('content', 'editing', '1202184607667441');
    expect(r?.inSync).toBe(true);
  });

  it('reports drift on a genuine mismatch', () => {
    const r = computeAsanaDrift('content', 'drafting', '1202212684793528');
    expect(r?.inSync).toBe(false);
  });

  it('returns null for an unknown gid', () => {
    expect(computeAsanaDrift('content', 'drafting', '999')).toBeNull();
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/__tests__/drift.test.ts`
Expected: FAIL — cannot resolve `../lib/drift`.

- [x] **Step 3: Implement `drift.ts`**

Create `src/app/lib/drift.ts`:

```ts
import {
  LINEAR_STATE_TO_CONTENT_STAGE,
  LINEAR_STATE_TO_CHANGELOG_STAGE,
  CONTENT_STAGE_TO_LINEAR_STATE,
  CHANGELOG_STAGE_TO_LINEAR_STATE,
  CONTENT_STAGE_TO_ASANA_STAGE,
  CHANGELOG_STAGE_TO_ASANA_STAGE,
  ASANA_STAGE_TO_CONTENT_STAGE,
  ASANA_STAGE_TO_CHANGELOG_STAGE,
} from './mapping';
import type { PortalConfig } from './portal-config';

export type PipelineName = 'content' | 'changelog';

export interface DriftResult {
  inSync: boolean;
  expectedState: string | null;
  actualState: string;
}

export function resolvePipeline(config: PortalConfig, hsPipelineId: string): PipelineName | null {
  const { content, changelog } = config.content.pipelines;
  if (hsPipelineId === content.pipelineId) return 'content';
  if (hsPipelineId === changelog.pipelineId) return 'changelog';
  return null;
}

export function stageNameFromId(
  config: PortalConfig,
  pipeline: PipelineName,
  stageId: string,
): string | null {
  const stageIds = config.content.pipelines[pipeline].stageIds;
  const match = Object.entries(stageIds).find(([, id]) => id === stageId);
  return match ? match[0] : null;
}

// The mapping tables are many-to-one in BOTH directions, so a single-direction
// check produces false drift. Accept a match from either side.
function compare(
  forward: Record<string, string>,
  reverse: Record<string, string>,
  stage: string,
  actual: string,
): DriftResult | null {
  const expectedState = forward[stage] ?? null;
  const reversedStage = reverse[actual] ?? null;
  if (expectedState === null && reversedStage === null) return null;
  return {
    inSync: expectedState === actual || reversedStage === stage,
    expectedState,
    actualState: actual,
  };
}

export function computeLinearDrift(
  pipeline: PipelineName,
  stage: string,
  linearState: string,
): DriftResult | null {
  return pipeline === 'content'
    ? compare(CONTENT_STAGE_TO_LINEAR_STATE, LINEAR_STATE_TO_CONTENT_STAGE, stage, linearState)
    : compare(CHANGELOG_STAGE_TO_LINEAR_STATE, LINEAR_STATE_TO_CHANGELOG_STAGE, stage, linearState);
}

export function computeAsanaDrift(
  pipeline: PipelineName,
  stage: string,
  asanaStageGid: string,
): DriftResult | null {
  return pipeline === 'content'
    ? compare(CONTENT_STAGE_TO_ASANA_STAGE, ASANA_STAGE_TO_CONTENT_STAGE, stage, asanaStageGid)
    : compare(CHANGELOG_STAGE_TO_ASANA_STAGE, ASANA_STAGE_TO_CHANGELOG_STAGE, stage, asanaStageGid);
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/__tests__/drift.test.ts`
Expected: PASS, 16 tests.

- [x] **Step 5: Commit**

```bash
git add src/app/lib/drift.ts src/app/__tests__/drift.test.ts
git commit -m "feat(drift): pipeline-aware drift comparison for Linear and Asana

Accepts a match from either mapping direction. The tables are many-to-one
both ways — drafting and editing both map to Linear In Progress, and both
Backlog and Canceled map to changelog identified — so a single-direction
check reports false drift on ordinary records.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Read functions for Linear and Asana

**Files:**
- Modify: `src/app/lib/linear-client.ts` (append)
- Modify: `src/app/lib/asana-client.ts` (append)
- Test: `src/app/__tests__/task-status-clients.test.ts`

**Interfaces:**
- Consumes: the private `gql()` helper in `linear-client.ts`; the `ASANA_API` constant and `ASANA_PIPELINE_STAGE_FIELD_GID` in `asana-client.ts`.
- Produces:
  - `interface LinearIssueDetail { identifier: string; title: string; state: string; assignee: string | null; updatedAt: string; url: string }`
  - `getLinearIssue(apiKey: string, issueId: string): Promise<LinearIssueDetail | null>`
  - `interface AsanaTaskDetail { name: string; stageGid: string | null; assignee: string | null; url: string }`
  - `getAsanaTask(apiKey: string, taskGid: string): Promise<AsanaTaskDetail | null>`

Both return `null` when the remote record does not exist, and throw on transport or auth failure. The caller distinguishes "not found" from "broken".

- [x] **Step 1: Write the failing tests**

Create `src/app/__tests__/task-status-clients.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getLinearIssue } from '../lib/linear-client';
import { getAsanaTask } from '../lib/asana-client';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(payload: unknown, ok = true, status = 200) {
  const fn = vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: 'x',
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('getLinearIssue', () => {
  it('maps a Linear issue to the detail shape', async () => {
    stubFetch({
      data: {
        issue: {
          identifier: 'DAD-142',
          title: 'Add webhook retry',
          updatedAt: '2026-09-02T18:04:00.000Z',
          url: 'https://linear.app/x/issue/DAD-142',
          state: { name: 'In Progress' },
          assignee: { displayName: 'dennis' },
        },
      },
    });
    const issue = await getLinearIssue('key', 'abc');
    expect(issue).toEqual({
      identifier: 'DAD-142',
      title: 'Add webhook retry',
      state: 'In Progress',
      assignee: 'dennis',
      updatedAt: '2026-09-02T18:04:00.000Z',
      url: 'https://linear.app/x/issue/DAD-142',
    });
  });

  it('returns null when the issue does not exist', async () => {
    stubFetch({ data: { issue: null } });
    expect(await getLinearIssue('key', 'gone')).toBeNull();
  });

  it('tolerates an unassigned issue', async () => {
    stubFetch({
      data: {
        issue: {
          identifier: 'DAD-1', title: 't', updatedAt: 'u', url: 'l',
          state: { name: 'Todo' }, assignee: null,
        },
      },
    });
    expect((await getLinearIssue('key', 'a'))?.assignee).toBeNull();
  });

  it('throws on a transport failure', async () => {
    stubFetch({}, false, 500);
    await expect(getLinearIssue('key', 'a')).rejects.toThrow(/Linear API HTTP error/);
  });
});

describe('getAsanaTask', () => {
  it('maps an Asana task to the detail shape', async () => {
    stubFetch({
      data: {
        name: 'Draft blog post',
        permalink_url: 'https://app.asana.com/0/1/2',
        assignee: { name: 'dennis' },
        custom_fields: [
          { gid: '1202184607659964', enum_value: { gid: '1202184607667441' } },
        ],
      },
    });
    expect(await getAsanaTask('key', '2')).toEqual({
      name: 'Draft blog post',
      stageGid: '1202184607667441',
      assignee: 'dennis',
      url: 'https://app.asana.com/0/1/2',
    });
  });

  it('returns null when the task is gone', async () => {
    stubFetch({ errors: [{ message: 'Not Found' }] }, false, 404);
    expect(await getAsanaTask('key', 'gone')).toBeNull();
  });

  it('tolerates a task with no pipeline stage field', async () => {
    stubFetch({
      data: { name: 't', permalink_url: 'u', assignee: null, custom_fields: [] },
    });
    const task = await getAsanaTask('key', '2');
    expect(task?.stageGid).toBeNull();
    expect(task?.assignee).toBeNull();
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/__tests__/task-status-clients.test.ts`
Expected: FAIL — `getLinearIssue` / `getAsanaTask` are not exported.

- [x] **Step 3: Add `getLinearIssue` to `src/app/lib/linear-client.ts`**

Append:

```ts
export interface LinearIssueDetail {
  identifier: string;
  title: string;
  state: string;
  assignee: string | null;
  updatedAt: string;
  url: string;
}

interface LinearIssueNode {
  identifier: string;
  title: string;
  updatedAt: string;
  url: string;
  state: { name: string } | null;
  assignee: { displayName: string } | null;
}

export async function getLinearIssue(apiKey: string, issueId: string): Promise<LinearIssueDetail | null> {
  const query = `
    query GetIssue($issueId: String!) {
      issue(id: $issueId) {
        identifier
        title
        updatedAt
        url
        state { name }
        assignee { displayName }
      }
    }
  `;
  const data = await gql<{ issue: LinearIssueNode | null }>(apiKey, query, { issueId });
  if (!data.issue) return null;
  return {
    identifier: data.issue.identifier,
    title: data.issue.title,
    state: data.issue.state?.name ?? 'Unknown',
    assignee: data.issue.assignee?.displayName ?? null,
    updatedAt: data.issue.updatedAt,
    url: data.issue.url,
  };
}
```

- [x] **Step 4: Add `getAsanaTask` to `src/app/lib/asana-client.ts`**

Append:

```ts
export interface AsanaTaskDetail {
  name: string;
  stageGid: string | null;
  assignee: string | null;
  url: string;
}

export async function getAsanaTask(apiKey: string, taskGid: string): Promise<AsanaTaskDetail | null> {
  const res = await fetch(
    `${ASANA_API}/tasks/${taskGid}?opt_fields=name,permalink_url,assignee.name,custom_fields.gid,custom_fields.enum_value.gid`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Asana GET task failed ${res.status}: ${await res.text()}`);
  const json = await res.json() as {
    data: {
      name: string;
      permalink_url: string;
      assignee?: { name: string } | null;
      custom_fields: Array<{ gid: string; enum_value?: { gid: string } | null }>;
    };
  };
  const field = json.data.custom_fields.find(f => f.gid === ASANA_PIPELINE_STAGE_FIELD_GID);
  return {
    name: json.data.name,
    stageGid: field?.enum_value?.gid ?? null,
    assignee: json.data.assignee?.name ?? null,
    url: json.data.permalink_url,
  };
}
```

- [x] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/app/__tests__/task-status-clients.test.ts`
Expected: PASS, 7 tests.

- [x] **Step 6: Confirm nothing else broke**

Run: `npm test && npm run typecheck`
Expected: all suites PASS, typecheck exits 0.

- [x] **Step 7: Commit**

```bash
git add src/app/lib/linear-client.ts src/app/lib/asana-client.ts src/app/__tests__/task-status-clients.test.ts
git commit -m "feat(clients): add single-record reads for Linear and Asana

linear-client was write-only. Both readers return null for a missing remote
record and throw on transport failure, so the caller can tell 'not linked'
from 'broken'.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: TaskStatusApi function

**Files:**
- Create: `src/app/functions/TaskStatusApi.ts`
- Create: `src/app/functions/TaskStatusApi-hsmeta.json`

**Interfaces:**
- Consumes: `getLinearIssue`, `getAsanaTask` (Task 2); `resolvePipeline`, `stageNameFromId`, `computeLinearDrift`, `computeAsanaDrift` (Task 1); `getPortalConfig` from `../lib/portal-config`.
- Produces: uid `task_status_api`, called as `hubspot.serverless('task_status_api', { parameters: { objectId } })`, returning `{ statusCode, body }` where `body` is the JSON string documented in the spec's response contract.

- [x] **Step 1: Create the hsmeta**

Create `src/app/functions/TaskStatusApi-hsmeta.json`:

```json
{
  "uid": "task_status_api",
  "type": "app-function",
  "config": {
    "entrypoint": "/app/functions/TaskStatusApi.js",
    "endpoint": {
      "path": "task-status-api",
      "methods": ["GET", "POST"]
    },
    "secretKeys": ["HS_ACCESS_TOKEN", "LINEAR_API_KEY", "ASANA_API_KEY"]
  }
}
```

- [x] **Step 2: Implement the function**

Create `src/app/functions/TaskStatusApi.ts`:

```ts
import { getPortalConfig } from '../lib/portal-config';
import { getLinearIssue } from '../lib/linear-client';
import { getAsanaTask } from '../lib/asana-client';
import {
  resolvePipeline,
  stageNameFromId,
  computeLinearDrift,
  computeAsanaDrift,
} from '../lib/drift';

const HS_BASE = 'https://api.hubapi.com';

interface TaskStatusContext {
  accountId?: number;
  parameters?: Record<string, string | undefined>;
  query?: Record<string, string | undefined>;
  body?: Record<string, string | undefined>;
}

function param(ctx: TaskStatusContext, key: string): string | undefined {
  return ctx.parameters?.[key] ?? ctx.query?.[key] ?? ctx.body?.[key];
}

function json(statusCode: number, payload: unknown) {
  return { statusCode, body: JSON.stringify(payload) };
}

export async function main(context: TaskStatusContext) {
  const token = process.env.PRIVATE_APP_ACCESS_TOKEN ?? process.env.HS_ACCESS_TOKEN;
  const objectId = param(context, 'objectId');
  const portalId = context.accountId;

  if (!token) return json(500, { error: 'No HubSpot access token' });
  if (!objectId) return json(400, { error: 'objectId is required' });
  if (!portalId) return json(400, { error: 'accountId missing from context' });

  const config = getPortalConfig(portalId);
  const props = ['linear_issue_id', 'asana_task_id', 'hs_pipeline', 'hs_pipeline_stage'];
  const url = `${HS_BASE}/crm/v3/objects/${config.content.objectTypeId}/${objectId}?properties=${props.join(',')}`;

  const recordRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!recordRes.ok) {
    return json(502, { error: `Could not read record ${objectId}: ${recordRes.status}` });
  }
  const record = await recordRes.json() as { properties: Record<string, string | null> };

  const linearId = record.properties.linear_issue_id || null;
  const asanaId = record.properties.asana_task_id || null;
  const pipelineId = record.properties.hs_pipeline || '';
  const stageId = record.properties.hs_pipeline_stage || '';

  const pipeline = resolvePipeline(config, pipelineId);
  const stage = pipeline ? stageNameFromId(config, pipeline, stageId) : null;

  const [linearOutcome, asanaOutcome] = await Promise.allSettled([
    linearId ? getLinearIssue(process.env.LINEAR_API_KEY ?? '', linearId) : Promise.resolve(null),
    asanaId ? getAsanaTask(process.env.ASANA_API_KEY ?? '', asanaId) : Promise.resolve(null),
  ]);

  const errors: { linear: string | null; asana: string | null } = { linear: null, asana: null };

  let linear = null;
  if (linearOutcome.status === 'rejected') {
    errors.linear = String(linearOutcome.reason?.message ?? linearOutcome.reason);
  } else if (linearOutcome.value) {
    const issue = linearOutcome.value;
    linear = {
      ...issue,
      drift: pipeline && stage ? computeLinearDrift(pipeline, stage, issue.state) : null,
    };
  }

  let asana = null;
  if (asanaOutcome.status === 'rejected') {
    errors.asana = String(asanaOutcome.reason?.message ?? asanaOutcome.reason);
  } else if (asanaOutcome.value) {
    const task = asanaOutcome.value;
    asana = {
      ...task,
      drift:
        pipeline && stage && task.stageGid
          ? computeAsanaDrift(pipeline, stage, task.stageGid)
          : null,
    };
  }

  return json(200, { linear, asana, pipeline, stageLabel: stage, errors });
}
```

- [x] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [x] **Step 4: Commit**

```bash
git add src/app/functions/TaskStatusApi.ts src/app/functions/TaskStatusApi-hsmeta.json
git commit -m "feat(api): add task_status_api endpoint

Reads the record, fetches Linear and Asana in parallel via Promise.allSettled
so one failing source never blanks the other, and attaches pipeline-aware
drift to each.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The card, and deploy

**Files:**
- Create: `src/app/cards/task-status-hsmeta.json`
- Create: `src/app/cards/TaskStatusCard.tsx`
- Create: `src/app/cards/package.json`
- Create: `src/app/cards/tsconfig.json`
- Modify: `.github/workflows/deploy-dev.yml`, `deploy-staging.yml`, `deploy-prod.yml`

**Interfaces:**
- Consumes: uid `task_status_api` and its response contract (Task 3).
- Produces: card component uid `task_status_card`.

- [x] **Step 1: Create the card package files**

`src/app/cards/package.json`:

```json
{
  "name": "central-brain-cards",
  "version": "0.1.0",
  "license": "MIT",
  "dependencies": {
    "@hubspot/ui-extensions": "latest",
    "react": "^18.2.0"
  },
  "devDependencies": {
    "typescript": "^5.3.3"
  }
}
```

`src/app/cards/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM"],
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["."]
}
```

`src/app/cards/task-status-hsmeta.json` — note the placeholder, substituted per portal in Step 4:

```json
{
  "uid": "task_status_card",
  "type": "card",
  "config": {
    "name": "Linear / Asana Status",
    "location": "crm.record.tab",
    "entrypoint": "/app/cards/TaskStatusCard.tsx",
    "objectTypes": ["${CONTENT_OBJECT_TYPE_ID}"]
  }
}
```

- [x] **Step 2: Implement the card**

Create `src/app/cards/TaskStatusCard.tsx`:

```tsx
import { useEffect, useState, useCallback } from 'react';
import {
  hubspot,
  Alert,
  Divider,
  Flex,
  Link,
  LoadingSpinner,
  Tag,
  Text,
} from '@hubspot/ui-extensions';

interface Drift {
  inSync: boolean;
  expectedState: string | null;
  actualState: string;
}

interface LinearStatus {
  identifier: string;
  title: string;
  state: string;
  assignee: string | null;
  updatedAt: string;
  url: string;
  drift: Drift | null;
}

interface AsanaStatus {
  name: string;
  stageGid: string | null;
  assignee: string | null;
  url: string;
  drift: Drift | null;
}

interface StatusPayload {
  linear: LinearStatus | null;
  asana: AsanaStatus | null;
  pipeline: string | null;
  stageLabel: string | null;
  errors: { linear: string | null; asana: string | null };
}

type ServerlessResult = { statusCode: number; body: string };

function formatWhen(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

function DriftNotice({ drift, system }: { drift: Drift | null; system: string }) {
  if (!drift || drift.inSync) return null;
  return (
    <Alert title="Out of sync" variant="warning">
      <Text>
        {system} shows {drift.actualState}; this record&apos;s stage expects{' '}
        {drift.expectedState ?? 'an unmapped state'}.
      </Text>
    </Alert>
  );
}

const Card = ({ context }: { context: { crm: { objectId: string | number } } }) => {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await (hubspot.serverless as unknown as (
        uid: string,
        opts: { parameters: Record<string, string> },
      ) => Promise<ServerlessResult>)('task_status_api', {
        parameters: { objectId: String(context.crm.objectId) },
      });
      if (!result || result.statusCode === undefined) {
        throw new Error(`Unexpected serverless result: ${JSON.stringify(result)}`);
      }
      const parsed = JSON.parse(result.body) as StatusPayload & { error?: string };
      if (result.statusCode !== 200) throw new Error(parsed.error ?? `HTTP ${result.statusCode}`);
      setData(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load status');
    } finally {
      setLoading(false);
    }
  }, [context.crm.objectId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <LoadingSpinner label="Loading task status" />;
  if (error) return <Alert title="Could not load status" variant="error"><Text>{error}</Text></Alert>;
  if (!data) return null;

  const nothingLinked = !data.linear && !data.asana && !data.errors.linear && !data.errors.asana;
  if (nothingLinked) {
    return <Text>This record is not linked to a Linear issue or an Asana task.</Text>;
  }

  return (
    <Flex direction="column" gap="medium">
      <Flex direction="column" gap="extra-small">
        <Text format={{ fontWeight: 'bold' }}>Linear</Text>
        {data.errors.linear && (
          <Alert title="Linear unavailable" variant="error"><Text>{data.errors.linear}</Text></Alert>
        )}
        {!data.errors.linear && !data.linear && <Text>Not linked to Linear.</Text>}
        {data.linear && (
          <>
            <Flex direction="row" gap="small" align="center">
              <Link href={data.linear.url}>{data.linear.identifier}</Link>
              <Tag>{data.linear.state}</Tag>
            </Flex>
            <Text>{data.linear.title}</Text>
            <Text format={{ fontWeight: 'demibold' }}>
              {data.linear.assignee ?? 'Unassigned'} · updated {formatWhen(data.linear.updatedAt)}
            </Text>
            <DriftNotice drift={data.linear.drift} system="Linear" />
          </>
        )}
      </Flex>

      <Divider />

      <Flex direction="column" gap="extra-small">
        <Text format={{ fontWeight: 'bold' }}>Asana</Text>
        {data.errors.asana && (
          <Alert title="Asana unavailable" variant="error"><Text>{data.errors.asana}</Text></Alert>
        )}
        {!data.errors.asana && !data.asana && <Text>Not linked to Asana.</Text>}
        {data.asana && (
          <>
            <Link href={data.asana.url}>{data.asana.name}</Link>
            <Text format={{ fontWeight: 'demibold' }}>
              {data.asana.assignee ?? 'Unassigned'}
            </Text>
            <DriftNotice drift={data.asana.drift} system="Asana" />
          </>
        )}
      </Flex>
    </Flex>
  );
};

hubspot.extend<'crm.record.tab'>(({ context }) => <Card context={context as never} />);
```

- [x] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exits 0. The root `tsconfig.json` may not include `src/app/cards`; if the card is not covered, that is acceptable — it is typechecked by the HubSpot build at upload time, the same as `src/app/pages`.

- [x] **Step 4: Add the per-portal substitution to all three workflows**

In `.github/workflows/deploy-dev.yml`, immediately after the existing "Set sync function URL" step, add:

```yaml
      - name: Set content object type ID
        run: sed -i 's|${CONTENT_OBJECT_TYPE_ID}|2-67505887|g' src/app/cards/task-status-hsmeta.json
```

In `deploy-staging.yml`, the same step with `2-67508770`.
In `deploy-prod.yml`, the same step with `2-67508928`.

- [x] **Step 5: Commit**

```bash
git add src/app/cards .github/workflows
git commit -m "feat(card): add Linear/Asana status card on content_piece

Read-only crm.record.tab card. Renders each system independently so one
failing source never blanks the other, and surfaces drift per system.

objectTypes is substituted per portal by the deploy workflows, matching the
existing SYNC_TO_LINEAR_URL mechanism — content_piece has a different type
id in each of the three portals.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [x] **Step 6: Push and confirm the deploy is green**

```bash
git push origin develop
```

Then poll until complete and verify **all three** signals:

```bash
gh run list --branch develop --limit 1 \
  --json databaseId,status,conclusion -q '.[0] | "\(.databaseId) \(.status) \(.conclusion)"'
```

Then, with that run id:

```bash
gh run view <id> --log \
  | grep -iE "(task_status_api|task_status_card) +\.\.\. (DONE|FAILED)" | sort -u
```

Required: both components `DONE`, **and** the run conclusion is `success`. A `DONE` line inside a failed run means nothing — that was the entire lesson of walkthrough 26.

- [ ] **Step 7: If the deploy rejects `crm.record.tab` or the card location**

Change `location` in `task-status-hsmeta.json` to `crm.record.sidebar`, commit, and redeploy. Do not change anything else in the same commit — one variable per deploy.

---

## Self-Review

**Spec coverage:**
- Live fetch of both systems → Task 2 (readers), Task 3 (parallel fetch)
- Pipeline-aware drift → Task 1 (`resolvePipeline`, table selection), tested with the changelog case
- Many-to-one tolerance rule → Task 1 `compare()`, tested with the editing and Canceled cases
- Response contract → Task 3 Step 2 returns exactly the documented keys
- Per-source error isolation → Task 3 `Promise.allSettled`, Task 4 independent render blocks
- Empty states → Task 4 (`Not linked to…`, and the combined `nothingLinked` state)
- Per-portal objectTypes → Task 4 Step 4, all three workflows
- `crm.record.tab` location → Task 4 Step 1, with the sidebar fallback as Step 7
- Read-only → no write call appears in any task
- Verification incl. run conclusion → Task 4 Step 6

No spec requirement is unimplemented.

**Placeholder scan:** No TBD/TODO. Every code step carries complete content. The only literal `${...}` is the intentional `${CONTENT_OBJECT_TYPE_ID}` placeholder, which Task 4 Step 4 substitutes.

**Type consistency:** `DriftResult` fields (`inSync`, `expectedState`, `actualState`) are identical in Task 1's implementation, Task 3's passthrough, and Task 4's `Drift` interface. `LinearIssueDetail` / `AsanaTaskDetail` field names from Task 2 are spread unchanged in Task 3 and consumed under the same names in Task 4 — note the card reads `stageGid` on Asana and `identifier`/`state`/`updatedAt`/`url` on Linear, all of which Task 2 produces. The uid `task_status_api` is identical in Task 3's hsmeta and Task 4's call.
