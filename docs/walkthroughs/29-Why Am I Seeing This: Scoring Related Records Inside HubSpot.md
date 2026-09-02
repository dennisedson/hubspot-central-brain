## 🎬 YouTube Episode Guide: Why Am I Seeing This? Scoring Related Records Inside HubSpot

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to build a Related Content card for a HubSpot custom object — a pure, fully-tested scoring function that ranks records by shared topic tags and theme, an app function that feeds it from CRM search, and a card that shows the viewer *why* each result matched."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):** "Every content team eventually asks the same question: what else have we already published about this?" Open a Content Piece record in HubSpot, click the Related Content tab, and show three ranked results — each with a score and a row of tags reading "Matched on: api, crm, theme: Auth Pain". Then open a record with no tags and show the honest empty state: "Add topic tags or an Enterpret theme to this record and related content will show up here." The pitch: relevance you can explain, not a black box.

*   **The Architecture (1:00 - 3:00):** Draw three boxes. Box one is a **pure scoring library** — no network, no HubSpot, just objects in and ranked objects out. Two points per shared topic tag, three points for a matching Enterpret theme, drop anything scoring zero, sort descending. Because it touches nothing, it is trivially testable, which is why we write the tests first. Box two is an **app function** that does all the I/O: it reads the source record and runs a CRM search for up to 100 candidates *in parallel*, maps both into the library's shape, and returns the top five. Box three is the **card**, which is deliberately dumb — it calls the function, parses the JSON, and renders. Key insight to land: the interesting logic is the part with no dependencies, so that is the part that gets 31 unit tests.

*   **Step-by-Step Implementation (3:00 - 8:00):**

    *   **Step 1 — Write the tests first (`src/app/__tests__/related-content.test.ts`).** Show the `parseTopicTags` block. Explain the decision on screen: HubSpot multi-select properties serialize as `"api;crm;workflows"`, so semicolon is the real convention — but the `video.tags` property is free text where a human types commas, so we accept both. Then show the `scoreRelated` blocks: self-exclusion, zero-score exclusion, ordering. Run it and watch it fail with "Does the file exist?" — that is the point.

    *   **Step 2 — Write the pure library (`src/app/lib/related-content.ts`).** Walk through `parseTopicTags` (split, trim, drop empties, case-insensitive dedupe) and `scoreRelated`. Highlight two design choices: the source record's *spelling* of a tag is what gets reported back, so the card shows clean labels; and the sort is stable, so records tied on score keep the "most recently modified first" order the search gave us. Tests go green.

    *   **Step 3 — Feed it from HubSpot (`src/app/functions/RelatedContentApi.ts`).** Show the `TYPE_PROPERTIES` map and explain the trap: `content_piece` has `topic_tags` and `enterpret_theme`, but `video` only has a free-text `tags` and no theme at all — and asking CRM search for a property a schema does not have returns a 400. Then show the `Promise.allSettled` block: the source read and the candidate search do not depend on each other, so they run together, and a failed search degrades to an empty list instead of blanking the card.

    *   **Step 4 — Render the "why" (`src/app/cards/RelatedContentCard.tsx`).** Show the `hubspot.serverless(...)` call and the gotcha that costs everyone an hour: the result is `{ statusCode, body }` where **body is a JSON string** you must `JSON.parse` yourself. Then show `MatchReason` — the small component that turns `matchedTags` and `matchedTheme` into tags. Mention the card config detail: `objectTypes` uses the object *name* with a `p_` prefix (`p_content_piece`, `p_video`), never the numeric type id.

*   **Testing & Wrap-up (8:00 - 10:00):** Run `npx vitest run src/app/__tests__/related-content.test.ts` — 31 passing. Then prove it end to end: tag two Content Pieces `api;crm`, give one an Enterpret theme, reload the card, and show the record with both signals ranking above the record with only tags. Change a tag, reload, watch the ranking move. Summary: put your judgment in a pure function, put your I/O in a thin shell around it, and always show the user the reason behind a ranking.

**💻 Screen-Ready Code Snippets:**

**1. The parsing decision, documented in code**

```ts
export function parseTopicTags(raw: string | null | undefined): string[] {
  if (!raw) return [];

  const seen = new Set<string>();
  const tags: string[] = [];

  for (const segment of raw.split(/[;,]/)) {
    const tag = segment.trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }

  return tags;
}
```

**2. The whole ranking, in one pure function**

```ts
export const TAG_WEIGHT = 2;
export const THEME_WEIGHT = 3;

export function scoreRelated<T extends RelatedCandidate>(
  source: RelatedCandidate,
  candidates: T[],
): RankedCandidate<T>[] {
  const sourceTheme = normalizeTheme(source.enterpretTheme);

  const sourceTags = new Map<string, string>();
  for (const tag of source.topicTags) {
    const key = tag.trim().toLowerCase();
    if (key && !sourceTags.has(key)) sourceTags.set(key, tag.trim());
  }

  const ranked: RankedCandidate<T>[] = [];

  for (const candidate of candidates) {
    if (candidate.id === source.id) continue;          // never match yourself

    const matchedKeys = new Set<string>();
    for (const tag of candidate.topicTags) {
      const key = tag.trim().toLowerCase();
      if (key && sourceTags.has(key)) matchedKeys.add(key);
    }

    const themeMatched =
      sourceTheme !== null && normalizeTheme(candidate.enterpretTheme) === sourceTheme;

    const score = matchedKeys.size * TAG_WEIGHT + (themeMatched ? THEME_WEIGHT : 0);
    if (score === 0) continue;                          // no signal, no result

    ranked.push({
      candidate,
      score,
      matchedTags: [...sourceTags.entries()]
        .filter(([key]) => matchedKeys.has(key))
        .map(([, spelling]) => spelling),
      matchedTheme: themeMatched ? (source.enterpretTheme as string).trim() : null,
    });
  }

  return ranked.sort((a, b) => b.score - a.score);      // stable: ties keep input order
}
```

**3. Two schemas, two property lists — the 400 you avoid**

```ts
// `video` has no theme property and only a free-text `tags`. Asking CRM search
// for a property a schema does not have returns a 400.
const TYPE_PROPERTIES = {
  content: { tagProp: 'topic_tags', themeProp: 'enterpret_theme' },
  video:   { tagProp: 'tags',       themeProp: null },
};
```

**4. Independent fetches, run together, failing independently**

```ts
const [sourceOutcome, candidateOutcome] = await Promise.allSettled([
  (async () => {
    const res = await fetch(
      `${HS_BASE}/crm/v3/objects/${objectTypeId}/${objectId}?properties=${properties.join(',')}`,
      { headers },
    );
    if (!res.ok) throw new Error(`Could not read record ${objectId}: ${res.status}`);
    return await res.json() as HsRecord;
  })(),
  (async () => {
    const res = await fetch(`${HS_BASE}/crm/v3/objects/${objectTypeId}/search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        filterGroups: [],
        properties,
        sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }],
        limit: 100,
        after: '0',
      }),
    });
    if (!res.ok) throw new Error(`Candidate search failed ${res.status}`);
    const data = await res.json() as { results?: HsRecord[] };
    return data.results ?? [];
  })(),
]);

// A failed search returns an empty candidate list — the card degrades, never blanks.
```

**5. The card: parse the body string, then show the reason**

```tsx
const result = await hubspot.serverless('related_content_api', {
  parameters: { objectId, objectTypeId },
});
const parsed = JSON.parse(result.body);   // body is a JSON *string*

// ...

function MatchReason({ item }: { item: RelatedItem }) {
  if (item.matchedTags.length === 0 && !item.matchedTheme) return null;
  return (
    <Flex direction="row" gap="extra-small" align="center">
      <Text format={{ fontWeight: 'demibold' }}>Matched on</Text>
      {item.matchedTags.map(tag => <Tag key={tag}>{tag}</Tag>)}
      {item.matchedTheme && <Tag variant="warning">theme: {item.matchedTheme}</Tag>}
    </Flex>
  );
}
```

**6. The card config that trips everyone up**

```json
{
  "uid": "related_content_card",
  "type": "card",
  "config": {
    "name": "Related Content",
    "location": "crm.record.tab",
    "entrypoint": "/app/cards/RelatedContentCard.tsx",
    "objectTypes": ["p_content_piece", "p_video"]
  }
}
```
