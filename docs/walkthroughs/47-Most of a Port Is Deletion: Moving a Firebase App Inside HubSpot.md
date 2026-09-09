## 🎬 YouTube Episode Guide: Most of a Port Is Deletion — Moving a Firebase App Inside HubSpot

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to port an externally-hosted integration into HubSpot by first identifying which of its functions exist only to compensate for being outside HubSpot — and deleting those instead of translating them — and how to catch the class of bug where your code reads a CRM property that was never provisioned."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 – 1:00):**
    Open on the old project: ~30 Firebase functions, roughly 2,900 lines in one `index.ts`. The instinct is to estimate the port by that number. Don't. Scroll the export list and start crossing things out live — `initiateHubSpotAuth`, `hubspotCallback`, `getServiceAccountEmail`, `getObjectTypeId`, `storeYouTubeTokens`, `updateVideoRecord`. Every one of those exists *because the code was outside HubSpot*. Move inside and they don't get rewritten, they stop existing. The demo we build toward is the surviving third actually running as HubSpot serverless functions.

*   **The Architecture (1:00 – 3:00):**
    Plain English, three columns on screen: what the old app used, what replaces it, and what simply disappears. Firestore → a HubSpot custom object. An app object awaiting a ten-business-day approval → a plain custom object with no approval at all. External hosting → serverless functions in the Projects app. Gemini → Claude. Then the key idea to name explicitly: **an integration's size is mostly a function of the distance between the code and the data.** Close that distance and the plumbing evaporates. The real porting work is only the part that talks to the genuinely-foreign system — in this case Google's OAuth and the YouTube APIs, which is irreducible no matter where you host.

*   **Step-by-Step Implementation (3:00 – 8:00):**

    *   **Step 1 — Triage by asking "why does this exist?" (3:00 – 4:15).** Go function by function and sort into three buckets: *deleted* (existed only to bridge the gap), *collapsed* (becomes one call inside an existing handler), *ported* (genuinely talks to the foreign system). Show `updateVideoRecord` — a whole HTTP endpoint whose entire job was writing one CRM record — collapsing into a single `hsUpdate` line. That's the shape of the win.

    *   **Step 2 — Verify the target schema before writing a line against it (4:15 – 5:45).** The most valuable ten minutes of the port. `GET` the custom object's properties and read the real names. Two opposite outcomes on screen: every metrics property the sync needed *did* exist, so that code was safe; and four properties the OAuth module read did **not** exist. Land why that second one is nasty — the properties API doesn't error on an unknown property, it just omits it. Your code reads `undefined`, reports "disconnected", and a channel that connected perfectly looks broken with no error anywhere.

    *   **Step 3 — Provision the gap, and don't derive names you can read (5:45 – 7:00).** Write the provisioning script. Then hit the bug that makes this step worth filming: deriving the property group from the object name gives `app_configsinformation`, and the real group is `app_configs_information`. HubSpot rejects a property whose group doesn't exist rather than creating it. The fix is the general lesson — **read the group off an existing property instead of constructing it**, which is both correct today and survives a future rename.

    *   **Step 4 — Decide what the AI is allowed to touch (7:00 – 8:00).** The original had an `applyAIOptimizations` endpoint that wrote the model's title straight onto the record. Don't port that. Two reasons, and show both: the codebase already has a never-clobber rule for human-authored content, and there is no suggestions property to write to — so "just write it somewhere" would mean provisioning schema from inside a request handler. Return the suggestions instead. A person accepts them.

*   **Testing & Wrap-up (8:00 – 10:00):**
    Run the gate: typecheck, zero lint errors, the full test suite, the build, and the workflow-action URL check. Then be honest on camera about what green does *not* mean here — every test mocks its boundary, so not one real Google or Anthropic call has been made. Say that out loud, and say it in the commit message too. Close on the reframe: when someone asks how long it takes to port an integration, the useful first question isn't "how many functions?" but "how many of them only exist because the code lives somewhere else?"

**💻 Screen-Ready Code Snippets:**

**The triage — three buckets, not one:**
```
DELETED  (existed only to bridge the gap)
  initiateHubSpotAuth, hubspotCallback, getServiceAccountEmail,
  getObjectTypeId, health          → Projects apps have native auth

COLLAPSED  (becomes a line, not an endpoint)
  storeYouTubeTokens, getYouTubeToken  → app secrets + app_configs
  updateVideoRecord, updateRecordStatus → one hsUpdate call

PORTED  (genuinely foreign — irreducible)
  initiateYouTubeAuth, youtubeCallback, refreshAccessToken,
  dailySync/triggerSync, subscribeToChannel/youtubeWebhook
```

**Verify the schema before coding against it:**
```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  https://api.hubapi.com/crm/properties/2026-03/2-68071489 \
  | jq -r '.results[] | select(.name|startswith("hs_")|not) | .name'
# asana_sync_token, assignee_filter, fellow_last_sync,
# linear_assignee_id, linear_team_id
#   ...and none of the four youtube_* names the code reads
```

**The bug: a derived group name that looks right and isn't:**
```ts
// WRONG — plausible, and rejected by the API
const groupName = `${appConfig.name}information`;   // app_configsinformation

// RIGHT — read what is actually there
const existing = await hs(token, 'GET', propertiesPath(objectTypeId));
const groupName = (existing.results ?? []).find(
  (prop) => !prop.name.startsWith('hs_') && prop.groupName,
)?.groupName;                                        // app_configs_information
```

**Idempotence, proven by re-running:**
```
$ PORTAL=dev npm run provision:youtube-config
  ✓ Added youtube_channel_id
  ✓ Added youtube_channel_title
  ✓ Added youtube_connection_status
  ✓ Added youtube_last_sync

$ PORTAL=dev npm run provision:youtube-config      # again
  – youtube_channel_id already exists, skipping
  – youtube_channel_title already exists, skipping
  – youtube_connection_status already exists, skipping
  – youtube_last_sync already exists, skipping
```

**Suggest, never overwrite:**
```ts
// The original wrote straight onto the record. This returns instead —
// `video` has 23 custom properties and none of them is a suggestions field,
// so the only writable targets are the human's own title and description.
export interface SuggestionResponse extends SuggestionResult {
  recordId: string;
  basedOn: VideoFacts;   // echoed, so a reviewer sees what it judged
}
```
