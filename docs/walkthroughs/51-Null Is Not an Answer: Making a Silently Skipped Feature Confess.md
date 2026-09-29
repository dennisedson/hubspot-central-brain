## 🎬 YouTube Episode Guide: Null Is Not an Answer — Making a Silently Skipped Feature Confess

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to add a status field that makes a silently-skipped step report itself — and why the field's *healthy* value is the one most likely to be invisible."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):**
    Open on three blank fields in a CRM record. Impressions, click-through rate, average view duration — empty for weeks. The sync returns `200`. `errors: []`. Nothing is wrong anywhere.

    Say the line that sets up the whole episode: **we assumed those fields were blank because the feature wasn't configured. They were blank because we were sending an invalid request every single time — and there was no way to tell the difference.**

    Show the payoff: one new field in the response, and the bug announces itself in a single run.

*   **The Architecture (1:00 - 3:00):**
    Draw the shape of the bug in plain English, because it's a shape that recurs everywhere.

    The sync had this: `if (channelId) { fetchAnalytics() }`. No else. When `channelId` was unset, analytics never ran, nothing was logged, and the response was byte-identical to a successful run on a channel with no data.

    Name the two distinct failures that collapse into one observation:
    1. Analytics ran and the channel genuinely has zero impressions.
    2. Analytics never ran at all.

    **Blank fields are consistent with both.** Any `if` with no `else` around an optional feature creates this, and it's invisible precisely because nothing failed.

    Then the second half of the architecture, and the reason this episode has a twist: where did `channelId` come from? A secret the operator had to set by hand — **even though the OAuth callback had already recorded the channel id.** The app knew the value and was asking a human to copy it into a second store that nothing validated and no setup doc mentioned. Configuration that exists only to be forgotten.

*   **Step-by-Step Implementation (3:00 - 8:00):**

    **Step 1 — Stop asking for what you already know (3:00 - 4:30).**
    Open `src/app/lib/hubspot-client.ts`. Write `readYouTubeChannelId`: read `app_configs`, treat the environment variable as an *override* rather than the source. Two details worth saying out loud: it returns `null` instead of throwing, because analytics are an enhancement and must never cost the statistics; and the override is checked first, so it short-circuits without touching HubSpot at all.

    **Step 2 — Give the skip a voice (4:30 - 5:45).**
    Open `src/app/functions/YouTubeSync.ts`. Add `analyticsStatus` to the outcome. Fill in the `else` that was never there. Stress that a missing channel is recorded but **not** pushed into `errors` — it isn't a failure, it's an unconfigured optional feature, and conflating the two trains people to ignore the error list.

    **Step 3 — Watch it immediately catch a real bug (5:45 - 7:00).**
    This is the best moment in the episode: deploy, run the sync, and read the new field out loud.

    `400 Unknown identifier (impressions) given in field parameters.metrics`

    Explain what that means — those metrics belong to YouTube Studio and the bulk Reporting API, not to `reports.query`. Then show the line that turned a partial failure into a total one: the two reports were awaited with `Promise.all`, so a guaranteed rejection **also discarded the watch-time report that worked.** That's why all three fields were blank instead of two. Delete the invalid metrics, drop to one report.

    **Step 4 — The twist: the success value was invisible (7:00 - 8:00).**
    Redeploy. The field is *gone from the response entirely*. Not wrong — absent.

    Walk through the diagnosis on screen, because it's a genuinely useful piece of platform knowledge: the field was `string | null`, success was `null`, and **HubSpot drops null properties when a handler returns `body` as an object.** The proof is sitting in another endpoint — `youtube-auth` returns `lastSync: null` just fine, because it calls `JSON.stringify` on its body itself.

    Fix: make it always a string. `'ok'`, `'skipped: …'`, `'failed: …'`.

*   **Testing & Wrap-up (8:00 - 10:00):**
    The test that matters most is the one pinning the metric list — re-adding `impressions` doesn't degrade analytics, it removes them entirely, so that assertion is a guard rail rather than a style preference. Mention that `fetchVideoAnalytics` had **zero** test coverage before this, which is precisely how a guaranteed-400 request shipped and survived.

    Then the deploy lesson, which cost real time: `hs project upload` prints "Deploying … DONE" while the new build is still `BUILDING`, and even after a build reads `[deployed]` the running containers lagged **~60 seconds**. Verifying once, immediately, looks exactly like a failed deploy. Poll the postcondition until it flips.

    Close on the general rule: **an optional feature that can silently not run needs a field that says it didn't — and that field's healthy value must be something you can actually see.** A success signal you cannot observe is the same bug you set out to fix.

**💻 Screen-Ready Code Snippets:**

**1. Read what the app already knows** — `src/app/lib/hubspot-client.ts`

```ts
/**
 * The connected YouTube channel id, as the OAuth callback recorded it.
 * YOUTUBE_CHANNEL_ID overrides it — an override, not the source.
 */
export async function readYouTubeChannelId(portalId: number): Promise<string | null> {
  const override = process.env.YOUTUBE_CHANNEL_ID?.trim();
  if (override) return override;

  const objectTypeId = getPortalConfig(portalId).appConfig.objectTypeId;
  if (!objectTypeId) return null;

  try {
    const response = await hsSearch(objectTypeId, [], ['youtube_channel_id']);
    return response.results[0]?.properties.youtube_channel_id || null;
  } catch {
    // Analytics are an enhancement. Failing to find a channel must not cost
    // the statistics.
    return null;
  }
}
```

**2. The `else` that was never there** — `src/app/functions/YouTubeSync.ts`

```ts
const channelId = await readYouTubeChannelId(portalId);

if (!channelId) {
  // Not an error — an unconfigured optional feature. But recorded, because
  // blank analytics are otherwise indistinguishable from a channel with no data.
  outcome.analyticsStatus =
    'skipped: no channel id — authorise YouTube, or set YOUTUBE_CHANNEL_ID to override';
} else {
  try {
    analytics = await fetchVideoAnalytics(accessToken, channelId, [...byYouTubeId.keys()]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    outcome.analyticsStatus = `failed: ${message}`;
    outcome.errors.push(`analytics unavailable: ${message}`);
  }
}
```

**3. Never let null be the success case**

```ts
/**
 * ALWAYS A STRING, NEVER NULL. HubSpot serialises a handler that returns `body`
 * as an OBJECT by dropping null properties, so a null success case vanishes
 * from the response and looks identical to a stale deploy.
 */
analyticsStatus: string;   // 'ok' | 'skipped: …' | 'failed: …'
```

**4. One report, and only metrics the API serves** — `src/app/lib/youtube-client.ts`

```ts
/** Everything reports.query will actually serve for a channel's videos. */
const ANALYTICS_METRICS = 'views,averageViewDuration';

// Previously: two reports in Promise.all, the second asking for
// `impressions,impressionsClickThroughRate` — a guaranteed 400 that took the
// working report down with it.
const watchTime = await runAnalyticsReport(
  accessToken, channelId, batch, startDate, endDate, ANALYTICS_METRICS,
);
```

**5. The guard rail, not a style preference**

```ts
it('never asks for impressions — the API rejects the whole request', async () => {
  mockReport({ columnHeaders: [{ name: 'video' }], rows: [] });
  await fetchVideoAnalytics('tok', 'UC123', ['v1']);

  const url = String(mockFetch.mock.calls[0][0]);
  const metrics = new URL(url).searchParams.get('metrics') ?? '';
  expect(metrics).not.toContain('impressions');
  expect(metrics).toContain('averageViewDuration');
});

it('omits impressions rather than defaulting them to zero', () => {
  // "Zero impressions" is a claim YouTube never made.
  const props = mapAnalyticsToProperties({ averageViewDuration: 42 });
  expect(props).toEqual({ average_view_duration: '42' });
});
```
