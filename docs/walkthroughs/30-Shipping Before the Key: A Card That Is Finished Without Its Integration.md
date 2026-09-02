## 🎬 YouTube Episode Guide: Shipping Before the Key — A Card That Is Finished Without Its Integration

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to build and deploy a third-party integration *before you have the API key* — an app function that treats 'not configured' as a normal success state, a client whose single unverified HTTP call is quarantined away from fully-tested pure logic, and a CRM card that looks deliberate and finished in all three of its states."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):** "Here's the situation every integration starts in: the feature is approved, the vendor is chosen, and the API key is stuck in someone's procurement queue for two weeks." Show the Enterpret Insights tab on a Content Piece record. It renders a friction theme, a quote count, and one calm line: *"Connect Enterpret to this app and the individual developer quotes behind the theme will be listed here."* No red banner. No spinner stuck forever. No "TODO". The pitch: this is deployed, in production, today — and switching it on later is a **one-line JSON edit**, not a code change.

*   **The Architecture (1:00 - 3:00):** Draw the trap first. In a HubSpot Project, an app function declares the secrets it wants in its `-hsmeta.json` under `secretKeys`. Declaring a secret the portal does not have **fails the deploy**. So the naive move — add `ENTERPRET_API_KEY` now, fill it in later — means you cannot ship at all until the key lands. Now draw the way out, three boxes. Box one: `secretKeys` lists only what actually exists. `process.env.ENTERPRET_API_KEY` is simply `undefined`, and a one-line `isEnterpretConfigured()` turns that into a boolean the whole system branches on. Box two: the **client**, where exactly one small function does HTTP and everything else is pure shaping — because we cannot test against a real Enterpret account, we make the untestable surface as small as we can draw it. Box three: the **card**, which has three real states — no theme, theme-but-not-connected, and connected — and all three must look like someone designed them. Land the principle: *absence of configuration is a first-class state, not an error path*.

*   **Step-by-Step Implementation (3:00 - 8:00):**

    *   **Step 1 — Write the tests first (`src/app/__tests__/enterpret-client.test.ts`).** Start with `isEnterpretConfigured`: true, missing, empty string, **and whitespace-only** — that last one is the case that bites you when someone pastes a key with a trailing newline into a secrets UI. Then the shaping tests. Point out on screen that these tests never touch the network, so they are the tests that will still be correct when the real API shows up. Run it, watch "Does the file exist?" fail.

    *   **Step 2 — Quarantine the guess (`src/app/lib/enterpret-client.ts`).** This is the heart of the episode. Show the file header comment that admits, in writing, that the endpoint could not be verified — Enterpret publicly documents a bulk CSV Export API, not a per-theme quote lookup. Then show `requestQuotes`: 15 lines, one `fetch`, throws on a bad status exactly like `linear-client.ts`. Everything else — `shapeQuotes`, `normaliseSentiment`, `summariseSentiment` — is pure and tested. Show `shapeQuotes` accepting `records` **or** `results` **or** `data`, and `text` **or** `verbatim` **or** `quote`. Say the quiet part: we are not guessing once, we are guessing tolerantly, so a near-miss on the response shape still renders.

    *   **Step 3 — Make "unconfigured" a 200 (`src/app/functions/EnterpretInsightsApi.ts` + its hsmeta).** Open the hsmeta and show `"secretKeys": ["HS_ACCESS_TOKEN"]` — one entry, deliberately. Then in the function, show the big comment block above `const apiKey = process.env.ENTERPRET_API_KEY;` that tells the next developer exactly what to add and where. Walk the control flow: read `enterpret_theme` and `enterpret_quote_count` off the record, build the payload with `configured: false`, and if there is no key **or no theme, return 200 right there**. When there is a key, the fetch goes through `Promise.allSettled` — same per-source isolation as `TaskStatusApi` — so an Enterpret outage sets `errors.enterpret` and *still* returns the stored theme and count.

    *   **Step 4 — Design the empty state like it matters (`src/app/cards/EnterpretInsightsCard.tsx`).** Show the three early returns in order. No theme: a clean prompt to set the property. Not configured: the theme in a tag, the stored count, a neutral `<Tag>Enterpret not connected</Tag>`, and one explanatory sentence — deliberately **not** an `<Alert variant="error">`, because nothing is wrong. Connected: sentiment summary plus verbatims. Repeat the two conventions that cost people an hour: `hubspot.serverless()` returns `{ statusCode, body }` where **body is a JSON string you must parse**, and card `objectTypes` uses the object name with a `p_` prefix (`p_content_piece`), never the numeric type id.

*   **Testing & Wrap-up (8:00 - 10:00):** Run `npx vitest run src/app/__tests__/enterpret-client.test.ts` — 27 passing, zero network calls. Run `npm run typecheck` — clean. Then the real proof: `npm run upload`, open a Content Piece, and show the finished-looking card with no key in the portal at all. Finish by demonstrating the activation: add the secret, add one string to `secretKeys`, redeploy, and the same card fills with quotes — no code diff. Summary: put the part you cannot verify in the smallest box you can draw, make "not configured" return 200, and design the empty state as carefully as the full one, because for the first two weeks the empty state *is* your feature.

**💻 Screen-Ready Code Snippets:**

**1. The whole configuration check**

```ts
/**
 * Whether an Enterpret API key is available to this runtime.
 * False is the expected state today and is never an error.
 */
export function isEnterpretConfigured(): boolean {
  const key = process.env.ENTERPRET_API_KEY;
  return typeof key === 'string' && key.trim().length > 0;
}
```

**2. The one unverified thing, quarantined**

```ts
const ENTERPRET_API_BASE = 'https://api.enterpret.com';
const QUOTES_PATH = '/external/v2/feedback-records/query'; // ASSUMED — see file header

async function requestQuotes(apiKey: string, theme: string, limit: number): Promise<unknown> {
  const response = await fetch(`${ENTERPRET_API_BASE}${QUOTES_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ filter: { reason: theme }, limit }),
  });

  if (!response.ok) {
    throw new Error(`Enterpret API HTTP error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}
```

**3. Shaping that tolerates being wrong about the field names**

```ts
const LIST_KEYS = ['records', 'results', 'data', 'feedbackRecords', 'items', 'quotes'];

function toQuote(raw: unknown): EnterpretQuote | null {
  if (!isRecord(raw)) return null;

  const text = pickString(raw, ['text', 'quote', 'verbatim', 'body', 'content', 'snippet']);
  if (!text) return null; // no usable verbatim — drop it rather than render a blank row

  return {
    id: pickString(raw, ['id', 'recordId', 'feedbackRecordId']),
    text,
    source: extractSource(raw),
    sentiment: normaliseSentiment(raw.sentiment ?? raw.sentimentLabel ?? raw.sentimentScore),
    createdAt: pickString(raw, ['createdAt', 'created_at', 'occurredAt', 'timestamp']),
    url: pickString(raw, ['url', 'permalink', 'link', 'sourceUrl']),
  };
}

/** A malformed payload yields [] rather than an exception. */
export function shapeQuotes(payload: unknown, limit = DEFAULT_QUOTE_LIMIT): EnterpretQuote[] {
  const quotes: EnterpretQuote[] = [];
  for (const entry of extractList(payload)) {
    const quote = toQuote(entry);
    if (quote) quotes.push(quote);
    if (quotes.length >= limit) break;
  }
  return quotes;
}
```

**4. "Not configured" is a 200, and the note that makes activation a one-liner**

```ts
const payload: InsightsPayload = {
  configured: false,
  theme,
  quoteCount,
  quotes: [],
  sentiment: null,
  errors: { enterpret: null },
};

// ---------------------------------------------------------------------
// ENTERPRET_API_KEY is NOT declared in EnterpretInsightsApi-hsmeta.json.
// Declaring a missing secret fails the project deploy, so this reads as
// `undefined` today and isEnterpretConfigured() is simply false.
//
// WHEN THE SECRET IS PROVISIONED, add it to `secretKeys`:
//   "secretKeys": ["HS_ACCESS_TOKEN", "ENTERPRET_API_KEY"]
// No other change is required.
// ---------------------------------------------------------------------
const apiKey = process.env.ENTERPRET_API_KEY;

if (!isEnterpretConfigured() || !theme) {
  return json(200, payload);
}

// Per-source isolation: an Enterpret outage must never cost the caller
// the fields we already have on the record.
const [outcome] = await Promise.allSettled([
  getEnterpretQuotes(apiKey ?? '', theme, QUOTE_LIMIT),
]);

payload.configured = true;

if (outcome.status === 'rejected') {
  payload.errors.enterpret = reason(outcome.reason);
} else {
  payload.quotes = outcome.value;
  payload.sentiment = summariseSentiment(outcome.value);
}

return json(200, payload);
```

**5. An empty state that looks like a decision, not a bug**

```tsx
// Enterpret is not connected. This is today's default, and it is a finished
// state: the stored theme and count still carry real information.
if (!data.configured) {
  return (
    <Flex direction="column" gap="medium">
      <ThemeHeader theme={data.theme} quoteCount={data.quoteCount} />
      <Divider />
      <Flex direction="column" gap="extra-small">
        <Flex direction="row" gap="small" align="center">
          <Tag>Enterpret not connected</Tag>
        </Flex>
        <Text>
          This theme and its quote count came from Enterpret when the record was created.
          Connect Enterpret to this app and the individual developer quotes behind the theme
          will be listed here, alongside their source and sentiment.
        </Text>
      </Flex>
    </Flex>
  );
}
```

**6. The activation diff, in full**

```diff
  {
    "uid": "enterpret_insights_api",
    "type": "app-function",
    "config": {
      "entrypoint": "/app/functions/EnterpretInsightsApi.js",
      "endpoint": { "path": "enterpret-insights-api", "methods": ["GET", "POST"] },
-     "secretKeys": ["HS_ACCESS_TOKEN"]
+     "secretKeys": ["HS_ACCESS_TOKEN", "ENTERPRET_API_KEY"]
    }
  }
```
