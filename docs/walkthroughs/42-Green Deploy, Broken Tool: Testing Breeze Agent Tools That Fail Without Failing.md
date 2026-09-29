## 🎬 YouTube Episode Guide: Green Deploy, Broken Tool: Testing Breeze Agent Tools That Fail Without Failing

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to write handler tests for a Breeze Agent tool that catch the three ways these tools fail while still returning HTTP 200 — a rejected CRM write, a keyword classifier matching inside the wrong word, and a search silently truncated at the page limit."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):** Ask the Breeze agent "route these meeting action items." It replies cheerfully: "Routed 3 action items — 1 content idea created." Open HubSpot. There is no record. The tool returned 200, the workflow is green, the deploy was green, and nothing was created. Then show a second one: ask "what's in the pipeline?" and get "12 active records" above a list of 4. We are going to make all of that impossible to ship again.

*   **The Architecture (1:00 - 3:00):** An agent tool is a serverless function that returns `{ outputFields: { key: "string" } }`. That contract is the whole problem. The status code describes the *HTTP call*, not the work — a CRM write can 400 inside your handler and you still return 200 with a friendly summary. And unlike a UI, there is no human reading the output critically: the LLM takes your strings as ground truth and repeats them to the user. So the failure mode is not a crash, it is a confident wrong answer. Three shapes of it: **a write that was rejected**, **a classification that matched the wrong thing**, and **a count that disagrees with the list under it**. None are visible from outside the function. All three are trivial to pin from inside, by asserting the exact request bodies your handler sends.

*   **Step-by-Step Implementation (3:00 - 8:00):**
    1.  **Pin the enum against its own source of truth** (`src/app/__tests__/breeze-meeting-router.test.ts`) — `content_type` is a provisioned enumeration. Writing `'blog post'` instead of `'blog_post'` makes HubSpot 400 *every* create, forever, while the tool keeps returning 200. Don't hardcode the valid value in the test — import `CONTENT_TYPE_VARIANTS` from `lib/social-draft.ts`, whose keys are the provisioned options, and assert membership. Now the test fails if the code drifts *or* if the schema does.
    2.  **Prove the classifier on the words that break it** (`BreezeMeetingRouter.ts`) — the router scored items with `lower.includes(keyword)`. Show the one-liner in Node that exposes it: `'pr'` matches "**Pr**iya" and "ap**pr**ove", `'ci'` matches "de**ci**sion", `'dev'` matches "**dev**ice", `'test'` matches "la**test**". Five ordinary follow-ups, all silently routed to engineering. Fix it with a word-boundary regex, and lock it with an `it.each` table of exactly those five strings.
    3.  **Make the count match the list** (`BreezeContentPipeline.ts`) — the header said `results.length` but the body listed only stages where `isClosed !== 'true'`, so every published record inflated the "active" number. Compute the count from the same `visibleStageIds` set the renderer uses; assert with a fixture of 2 active and 3 closed records that the header says 2.
    4.  **Say when you were truncated** (both GET_DATA tools) — the search sends `limit: 100` and never paginates. The response already carries `total`; nobody read it. Compare `total` against `results.length` and append a truncation line. Test it by returning `total: 250` with one result.

*   **Testing & Wrap-up (8:00 - 10:00):** Run `npx vitest run src/app/__tests__/breeze-*.test.ts` — before the fixes, three failures, each naming the exact wrong value (`expected [ 'blog_post', … ] to include 'blog post'`). That is the proof the tests are real. Then `npm run validate` for the full gate. Summary: these tools are the one place in a HubSpot app where a green status code means the least, because the consumer is a language model that cannot tell a confident summary from a correct one. Assert the request bodies, not the response codes.

**💻 Screen-Ready Code Snippets:**

**The enum assertion — tied to the schema, not to a literal:**
```typescript
import { CONTENT_TYPE_VARIANTS } from '../lib/social-draft';

it('writes a content_type that is one of the provisioned enum options', async () => {
  mockCreateOk('7001');

  await main(ctx('Write a blog post about webhook retries'));

  const written = JSON.parse(mockFetch.mock.calls[0][1].body).properties.content_type;
  expect(Object.keys(CONTENT_TYPE_VARIANTS)).toContain(written);
});
// FAILS: expected [ 'blog_post', 'video', …(5) ] to include 'blog post'
```

**The substring trap, and the fix:**
```typescript
// Before — 'pr' matches "Priya", 'ci' matches "decision", 'dev' matches "device"
const linearScore = LINEAR_KEYWORDS.filter(k => lower.includes(k)).length;

// After — \b anchors only the outer edges, so "pull request" still matches
function matchesKeyword(lower: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`).test(lower);
}
```

**Locking it with a table of the exact strings that broke:**
```typescript
it.each([
  ['Follow up with Priya about the offsite', 'pr inside "Priya"'],
  ['Make a decision on the vendor',          'ci inside "decision"'],
  ['Order a new device for Sam',             'dev inside "device"'],
  ['Review the latest numbers',              'test inside "latest"'],
  ['Approve the budget',                     'pr inside "approve"'],
])('does not route %j to Linear (%s)', async item => {
  const out = outputFields(await main(ctx(item)));

  expect(out.linearTasksSuggested).toBe('  (none)');
  expect(out.hubspotTasksSuggested).toContain(item);
});
```

**A count that cannot disagree with the list it heads:**
```typescript
// The header must count only what is actually listed below.
const visibleStageIds = new Set(visibleStages.map(s => s.id));
const shownCount = search.results.filter(r =>
  visibleStageIds.has(r.properties.hs_pipeline_stage ?? ''),
).length;

const scope = stageFilter ? `matching "${stageFilter}"` : 'active';
const lines = [`${label} Pipeline — ${shownCount} ${scope} record${shownCount !== 1 ? 's' : ''}\n`];
```

**Admitting the page limit instead of hiding behind it:**
```typescript
const PAGE_SIZE = 100; // the handler does not paginate

const matched = search.total ?? search.results.length;
if (matched > search.results.length) {
  lines.push(
    `\n(truncated: showing the first ${search.results.length} of ${matched} records in this pipeline — ` +
    'narrow the request with a stage filter for a complete list)',
  );
}
```

**And the date that reads as text to an LLM:**
```typescript
// HubSpot dates arrive as `YYYY-MM-DD` on some surfaces and epoch-ms on others.
// `new Date("1790812800000")` is an Invalid Date — which renders, literally, as
// "(target: Invalid Date)" straight into the agent's context.
function formatTargetDate(raw: string | null | undefined): string {
  if (!raw) return '';
  const when = /^\d+$/.test(raw) ? new Date(Number(raw)) : new Date(raw);
  if (Number.isNaN(when.getTime())) return '';
  const formatted = when.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return ` (target: ${formatted})`;
}
```
