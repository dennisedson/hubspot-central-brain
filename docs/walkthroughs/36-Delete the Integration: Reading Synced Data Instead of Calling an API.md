## 🎬 YouTube Episode Guide: Delete the Integration — Reading Synced Data Instead of Calling an API

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to replace a live third-party API call inside a HubSpot serverless function with a batch-synced CRM property — writing a total, never-throwing parser for untrusted stored JSON, and a regression test that proves the deleted credential can never come back."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):** Last episode we shipped a card that was finished *before* its API key arrived. This episode we admit the key is never arriving — we cannot get permission to create one — and the assistant that *does* have Enterpret access talks to it over **MCP**, which a deployed HubSpot function cannot reach: different runtime, different trust boundary, no MCP client. So the live call gets deleted. Demo: the same card, same quotes on screen, and a network panel showing exactly **one** request — the CRM record read. Nothing external at render time.
*   **The Architecture (1:00 - 3:00):** Two boxes, drawn as a before and after. Before: card → function → `ENTERPRET_API_KEY` → guessed Enterpret endpoint. After: an assistant on a laptop pulls verbatims over MCP and **batch-writes them into a `content_piece` property**, `enterpret_quotes` (a textarea holding a JSON array); the function only reads properties. Land the three wins: nothing to rotate, no third-party latency or outage on a card render, and an unverifiable guessed endpoint leaves the codebase entirely. Then land the new risk, because it is the whole design problem: **the writer is a sync, not an API contract**, so the stored string is untrusted — absent, empty, truncated, or an object where an array should be. Every one of those must mean "no quotes", never an error.
*   **Step-by-Step Implementation (3:00 - 8:00):**
    *   **Step 1 — Delete first (`src/app/lib/enterpret-client.ts`).** Show what goes: `getEnterpretQuotes`, its `fetch`, the guessed `QUOTES_PATH` constant, and `isEnterpretConfigured`. Point out that everything *left* is pure — `normaliseTheme`, `parseQuoteCount`, `normaliseSentiment`, `summariseSentiment` — and was already unit-tested against no network. Then rewrite the file header: it documented an HTTP contract that no longer exists, and a stale header is a lie the next developer will believe.
    *   **Step 2 — Repurpose the parser, and make it total.** Same `shapeQuotes` name, new input: a stored JSON string instead of an HTTP payload. Show `decodeStoredQuotes` — the `try/catch` around `JSON.parse`, the `Array.isArray` guard, the whitespace trim. Say the rule out loud: *this function has no failure mode, only an empty result.*
    *   **Step 3 — The function becomes a record read (`src/app/functions/EnterpretInsightsApi.ts`).** Add `enterpret_quotes` to the requested properties, delete the `Promise.allSettled` block and the `configured` flag, and note `secretKeys` stays `["HS_ACCESS_TOKEN"]`. `sentiment` is now `null` when there are no quotes to summarise, and `errors.enterpret` is kept but permanently null so the card's payload shape does not churn.
    *   **Step 4 — Two honest card states (`src/app/cards/EnterpretInsightsCard.tsx`).** With the `configured` flag gone, three states collapse to two: quotes synced, or not yet. Show deleting the "Enterpret not connected" tag — that framing is now *wrong*, there is nothing to connect — and replacing it with one quiet line about syncing.
*   **Testing & Wrap-up (8:00 - 10:00):** Two tests carry this change. First: assert the **exact** record URL and that `fetch` was called exactly once — that single assertion is what stops a live call sneaking back in. Second: the regression guard that walks every file under `src/` and asserts the credential name appears nowhere, with the name assembled at runtime (`['ENTERPRET','API','KEY'].join('_')`) so the test file cannot match its own scan. Run the suite: 513 → 516. Summary: when an integration cannot exist, the strongest move is to delete it and make the boring path — read a property — the whole feature.

**💻 Screen-Ready Code Snippets:**

**1. Decoding an untrusted stored property — every bad value is "no quotes"**
```ts
function decodeStoredQuotes(stored: unknown): unknown[] {
  if (Array.isArray(stored)) return stored;
  if (typeof stored !== 'string') return [];

  const trimmed = stored.trim();
  if (trimmed.length === 0) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? parsed : [];
}

export function shapeQuotes(stored: unknown, limit = DEFAULT_QUOTE_LIMIT): EnterpretQuote[] {
  const quotes: EnterpretQuote[] = [];
  for (const entry of decodeStoredQuotes(stored)) {
    const quote = toQuote(entry);
    if (quote) quotes.push(quote);
    if (quotes.length >= limit) break;
  }
  return quotes;
}
```

**2. The whole handler is now a record read**
```ts
const ENTERPRET_PROPS = ['enterpret_theme', 'enterpret_quote_count', 'enterpret_quotes'];

const url = `${HS_BASE}${objectPath(config.content.objectTypeId, objectId)}` +
            `?properties=${ENTERPRET_PROPS.join(',')}`;

const recordRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
if (!recordRes.ok) {
  return json(502, { error: `Could not read record ${objectId}: ${recordRes.status}` });
}
const record = (await recordRes.json()) as { properties: Record<string, string | null> };

const quotes = shapeQuotes(record.properties.enterpret_quotes, QUOTE_LIMIT);

return json(200, {
  theme: normaliseTheme(record.properties.enterpret_theme),
  quoteCount: parseQuoteCount(record.properties.enterpret_quote_count),
  quotes,
  sentiment: quotes.length > 0 ? summariseSentiment(quotes) : null,
  errors: { enterpret: null },
});
```

**3. The assertion that keeps the external call deleted**
```ts
it('makes exactly one fetch — the record read, and nothing external', async () => {
  mockRecord(SYNCED_RECORD);

  await main(makeContext());

  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(urls()).toEqual([READ_URL]);
});
```

**4. A regression guard that cannot match itself**
```ts
const KEY_NAME = ['ENTERPRET', 'API', 'KEY'].join('_');
const SRC = resolve(__dirname, '../..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out); else out.push(full);
  }
  return out;
}

it('no code path reads it from the environment', () => {
  const offenders = walk(SRC).filter(file =>
    /process\.env\.ENTERPRET/.test(readFileSync(file, 'utf8')),
  );
  expect(offenders).toEqual([]);
});
```

**5. Malformed stored JSON degrades the card, never breaks it**
```ts
for (const stored of [
  '[{"text": "truncated mid-sy',
  'not json at all',
  '{"text":"an object, not an array"}',
  '   ',
  'null',
]) {
  mockRecord({ ...SYNCED_RECORD, enterpret_quotes: stored });

  const body = JSON.parse((await main(makeContext())).body);
  expect(body.quotes).toEqual([]);
  expect(body.sentiment).toBeNull();
  expect(body.errors).toEqual({ enterpret: null });
  // The theme and count still come back — a bad sync costs only the quotes.
  expect(body.theme).toBe('Webhook reliability');
}
```
