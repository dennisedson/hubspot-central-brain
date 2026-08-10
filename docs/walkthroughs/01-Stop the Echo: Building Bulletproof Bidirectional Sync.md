## 🎬 YouTube Episode Guide: Stop the Echo: Building Bulletproof Bidirectional Sync

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to implement bidirectional sync between two systems without causing infinite update loops — using a stage comparison pattern that's more reliable than description tags alone."

**⏱️ The 10-Minute Script Outline:**

- **Hook & Demo (0:00 - 1:00):** Show the problem — create an issue in Linear, it appears in HubSpot, move it in HubSpot, it updates back in Linear, which fires a webhook that updates HubSpot again. The record bounces forever. Then show the fixed version: the exact same actions, and the webhook fires once, checks "does HubSpot already know about this state change?" and silently skips.

- **The Architecture (1:00 - 3:00):** Draw the echo loop on a whiteboard. Two systems talking to each other. Every outbound sync triggers an inbound webhook. Three ways to break the loop: (1) tagging — write a breadcrumb in the source; (2) timestamp gating — skip if updated too recently; (3) state comparison — skip if the target already reflects the incoming change. Explain why option 3 is the most resilient: it works even if the tag gets stripped, and it's stateless.

- **Step-by-Step Implementation (3:00 - 8:00):**
  - Step 1: `getCurrentStage()` — show how we extend the existing search query to fetch `hs_pipeline_stage` alongside `linear_issue_id`.
  - Step 2: The mapping lookup — `stageMap[payload.data.state.name]` → stage name → stage ID from portal config.
  - Step 3: The guard in `LinearWebhook.ts` — five lines that compare `expectedStageId` to `currentStageId` and return early if they match.
  - Step 4: The test — mock `getCurrentStage` to return the matching stage ID, verify the response has `reason: 'stage already matches'`.

- **Testing & Wrap-up (8:00 - 10:00):** Run `npm test -- linear-webhook`, show the new test passing. Manually trigger both directions in the dev portal to confirm one-way propagation. Summarize: you now have two loop guards — the `[hs-sync]` description tag as a belt, and stage comparison as the suspenders.

**💻 Screen-Ready Code Snippets:**

```typescript
// getCurrentStage — extends the search to read the current pipeline stage
export async function getCurrentStage(
  client: Client,
  objectTypeId: string,
  linearIssueId: string,
): Promise<string | null> {
  const response = await client.crm.objects.searchApi.doSearch(objectTypeId, {
    filterGroups: [{ filters: [{ propertyName: 'linear_issue_id', operator: 'EQ', value: linearIssueId }] }],
    properties: ['linear_issue_id', 'hs_pipeline_stage'],
    limit: 1, sorts: [], query: '', after: '0',
  });
  return response.results[0]?.properties?.hs_pipeline_stage ?? null;
}
```

```typescript
// Echo guard in LinearWebhook.ts — runs before every upsert call
const config = isChangelog ? PORTAL_CONFIG.changelog : PORTAL_CONFIG.content;
const stageMap = isChangelog ? LINEAR_STATE_TO_CHANGELOG_STAGE : LINEAR_STATE_TO_CONTENT_STAGE;
const incomingStageName = stageMap[payload.data.state.name];
const expectedStageId = incomingStageName
  ? (config.stageIds as Record<string, string>)[incomingStageName]
  : undefined;
if (expectedStageId) {
  const currentStageId = await getCurrentStage(client, config.objectTypeId, payload.data.id);
  if (currentStageId === expectedStageId) {
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'stage already matches' }) };
  }
}
```
