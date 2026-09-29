## 🎬 YouTube Episode Guide: The Half-Working Webhook — When Verification Succeeds and Delivery Cannot

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to probe a serverless platform's request-handling limits *before* you trust an integration that depends on them — and you'll understand why a feature whose handshake succeeds but whose payload is rejected is more dangerous than one that fails outright."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 – 1:00):**
    Subscribe to a YouTube channel's WebSub feed from a HubSpot serverless function. The hub accepts it — 202. The verification challenge arrives and is echoed back perfectly — 200. Query the subscription: active, lease recorded, expiry ten days out. Every signal says this works. Then send the thing it exists to receive, an Atom notification, and watch it bounce: **415 Unsupported Media Type**. Not from our code — from the gateway, before a line of it runs. The feature is fully set up and structurally incapable of doing its job.

*   **The Architecture (1:00 – 3:00):**
    Plain English on WebSub: you POST the hub asking it to call you back; the hub GETs your callback with a challenge you must echo promptly; thereafter it POSTs you notifications as Atom XML. Three exchanges, and the crucial asymmetry — **the first two carry no body, the third does.** That's why this fails the way it does. Every handshake step passes because a query string is not a payload. Then state the platform fact this episode is really about: HubSpot's serverless gateway accepts only `application/json`. Any integration whose partner posts XML — and WebSub, SOAP callbacks and plenty of legacy webhooks all do — cannot be received directly, no matter how correct your handler is.

*   **Step-by-Step Implementation (3:00 – 8:00):**

    *   **Step 1 — Build it properly first (3:00 – 4:15).** Not wasted effort: you cannot discover this by reading docs, and the code is what proves the diagnosis. Show the pieces — subscribe, the challenge echo, the Atom parser — and the two design decisions worth stealing regardless of platform. Status is recorded as `pending` on a 202, never `active`, because the hub verifies *asynchronously* and claiming otherwise reports a subscription that may never verify. And an unknown video id is logged and ignored rather than creating a record: inventing CRM rows from an unauthenticated public endpoint is how a webhook becomes a spam vector.

    *   **Step 2 — Probe the limit in one loop (4:15 – 5:30).** The technique. Don't reason about what the gateway accepts — enumerate it. A six-line bash loop across `application/atom+xml`, `application/xml`, `text/xml`, `text/plain`, no header, and `application/json`. Five 415s and one 200. Thirty seconds of work produces a table you can hand to a platform team, and it's the difference between "I think XML doesn't work" and a reproducible boundary.

    *   **Step 3 — Recognise the dangerous failure shape (5:30 – 6:45).** The heart of it. If subscription had failed, you'd have known instantly. Instead the handshake succeeds, so the subscription sits there *looking* healthy — and "no notifications arriving" is indistinguishable from "no new videos". This is the same failure family as a `sed` that matches nothing, a secret in the wrong store, and a property group that doesn't exist: the system reports success while doing nothing. Name it as a family, because recognising the shape is what transfers.

    *   **Step 4 — Clean up, and decide what to keep (6:45 – 8:00).** Unsubscribe. An active subscription that cannot deliver is strictly worse than none — it's a standing lie in your configuration. Then the judgment call: keep the code or delete it? Keep it, with the measurement recorded at the call site, because the code is correct and the constraint may lift. But mark the feature blocked everywhere a human looks, so nobody spends an afternoon "fixing" something that isn't broken.

*   **Testing & Wrap-up (8:00 – 10:00):**
    Show the 23 unit tests still passing — they test your logic, which was never the problem, and that distinction is the point. Verify what genuinely works live: the challenge echo returns the bare token as `text/plain`; a second subscribe correctly reports "not due for renewal" rather than re-requesting. Close on the transferable rule: **before building on a platform primitive, spend thirty seconds measuring its edges.** A content-type loop, a size probe, a timeout test. The cost is trivial and the alternative is discovering the boundary after you've shipped something that looks finished.

**💻 Screen-Ready Code Snippets:**

**Probe the boundary — the whole diagnosis in one loop:**
```bash
BODY='<feed><entry><yt:videoId>abc</yt:videoId></entry></feed>'
for ct in "application/atom+xml" "application/xml" "text/xml" \
          "text/plain" "application/json" ""; do
  printf "%-24s " "${ct:-<none>}"
  curl -s -o /dev/null -X POST "$ENDPOINT" \
    ${ct:+-H "Content-Type: $ct"} --data-binary "$BODY" \
    -w "HTTP %{http_code}\n"
done
```
```
application/atom+xml     HTTP 415
application/xml          HTTP 415
text/xml                 HTTP 415
text/plain               HTTP 415
application/json         HTTP 200   ← the only one that reaches your code
<none>                   HTTP 415
```

**Why the handshake passes anyway — no body, no content type:**
```ts
// GET: the hub verifying. Echo first, ask questions never — the hub's
// timeout is short and a failed verification is silent on our side.
if (method === 'GET') {
  const challenge = param(context, 'hub.challenge');
  if (challenge && mode === 'subscribe') {
    return { statusCode: 200, body: challenge,
             headers: { 'Content-Type': 'text/plain' } };
  }
}
```

**Report what is true, not what you hope:**
```ts
// The hub verifies asynchronously, so 202 means "accepted", not "active".
// Claiming active here would report a subscription that may never verify.
return json(200, {
  ok: true, channelId, status: 'pending', expiresAt,
  note: 'The hub verifies asynchronously; status becomes active once it calls the webhook.',
});
```

**Renewal is just re-subscription — and must be idempotent:**
```bash
# first call
{"ok":true,"status":"pending","expiresAt":"2026-09-20T21:16:45.874Z"}

# second call, immediately after
{"skipped":true,"reason":"subscription is not due for renewal", ...}
```

**Then undo it, because a dead subscription is a standing lie:**
```bash
curl -X POST https://pubsubhubbub.appspot.com/subscribe \
  --data-urlencode "hub.mode=unsubscribe" \
  --data-urlencode "hub.callback=$CALLBACK" \
  --data-urlencode "hub.topic=$TOPIC" \
  --data-urlencode "hub.verify=async"
# HTTP 202
```
