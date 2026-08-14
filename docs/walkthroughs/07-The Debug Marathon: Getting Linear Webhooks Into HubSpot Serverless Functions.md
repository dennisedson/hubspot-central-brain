## 🎬 YouTube Episode Guide: The Debug Marathon: Getting Linear Webhooks Into HubSpot Serverless Functions

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to receive external webhooks in a HubSpot 2026.03 serverless function, handle the undocumented runtime constraints around URL format, bundle dependencies with esbuild, authenticate your API calls, and work around HubSpot's header/query stripping."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):** "I'm going to show you the exact debug trail that took a working TypeScript function and turned it into a live Linear → HubSpot sync — including five separate layers of failure nobody documents. By the end you'll see a new Linear issue appear as a HubSpot Content Piece in real time."

*   **The Architecture (1:00 - 3:00):** A 2026.03 HubSpot app-function with a public `endpoint` config receives POST requests from Linear. The function validates the payload, maps Linear states to HubSpot pipeline stages, and upserts a custom object record. Simple concept — but five things have to be true simultaneously before it works.

*   **Step-by-Step Implementation (3:00 - 8:00):**
    1.  **Correct URL format** — It's NOT `api.hubspot.com/integrations/v1/{appId}/serverless/{path}`. It's `https://{portalId}.hs-sites.com/hs/serverless/{path}`. Public endpoints require Content Hub Enterprise. Show the hsmeta `endpoint` config.
    2.  **Bundle with esbuild, not tsc** — `tsc` compiles TypeScript but HubSpot only uploads non-gitignored files. Local lib files (`hmac.ts`, `hubspot-client.ts`) never arrive on the server. Switch the build script to `esbuild --bundle --external:@hubspot/api-client` — bundles all local code into one file while leaving the npm package for HubSpot to install.
    3.  **Authentication: use `HS_ACCESS_TOKEN`, not `PRIVATE_APP_ACCESS_TOKEN`** — `PRIVATE_APP_ACCESS_TOKEN` is reserved and can't be declared in `secretKeys`. For public endpoint functions it isn't auto-injected either. Add your portal's service key as `HS_ACCESS_TOKEN` via `hs secrets add`, then reference it in `createHubSpotClient`.
    4.  **Webhook verification is impossible** — HubSpot strips ALL custom headers (including `linear-signature`) AND query parameters from the function context. HMAC verification can't work. Document the constraint and rely on schema validation instead.

*   **Testing & Wrap-up (8:00 - 10:00):** Use `curl` directly against the endpoint URL to test without touching Linear — faster iteration loop. Show the response `{"ok":true,"id":"...","action":"created"}` then navigate to the HubSpot CRM to see the new Content Piece. Recap: right URL, esbuild bundling, correct secret name, no webhook auth possible.

**💻 Screen-Ready Code Snippets:**

```json
// linear-webhook-hsmeta.json
{
  "uid": "linear_webhook",
  "type": "app-function",
  "config": {
    "entrypoint": "/app/functions/LinearWebhook.js",
    "endpoint": {
      "path": "linear-webhook",
      "methods": ["POST"]
    },
    "secretKeys": ["LINEAR_WEBHOOK_SECRET", "HS_ACCESS_TOKEN"]
  }
}
```

```json
// package.json build script
"build": "esbuild src/app/functions/LinearWebhook.ts src/app/functions/SyncToLinear.ts --bundle --platform=node --target=node18 --outdir=src/app/functions --external:@hubspot/api-client"
```

```typescript
// hubspot-client.ts — use HS_ACCESS_TOKEN, fall back to auto-injected token
export function createHubSpotClient(token?: string): Client {
  return new Client({
    accessToken: token ?? process.env.HS_ACCESS_TOKEN ?? process.env.PRIVATE_APP_ACCESS_TOKEN
  });
}
```

```typescript
// LinearWebhook.ts — HubSpot strips headers and query params; can't verify HMAC
// HubSpot's function runtime strips both custom headers and query parameters,
// making standard webhook signature verification impossible. We rely on
// schema validation below to reject malformed requests.
void secret;

const payload = context.body;
if (payload.type !== 'Issue') {
  return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'not an Issue event' }) };
}
```

```bash
# Test your endpoint directly without needing a Linear issue
curl -s -X POST https://{portalId}.hs-sites.com/hs/serverless/linear-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "action": "create",
    "type": "Issue",
    "data": {
      "id": "test-001",
      "title": "Test issue",
      "state": { "id": "s1", "name": "Todo", "type": "unstarted" },
      "labels": { "nodes": [] },
      "url": "https://linear.app/test/issue/T-1",
      "team": { "id": "t1", "name": "Test" }
    },
    "organizationId": "org-1",
    "webhookTimestamp": 1234567890,
    "webhookId": "wh-1"
  }'
```
