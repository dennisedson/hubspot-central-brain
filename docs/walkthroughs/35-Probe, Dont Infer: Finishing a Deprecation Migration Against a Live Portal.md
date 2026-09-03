## 🎬 YouTube Episode Guide: Probe, Don't Infer — Finishing a Deprecation Migration Against a Live Portal

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to finish an API deprecation migration safely: probe each API family against a live portal before flipping it, diff the response shapes rather than trusting the path pattern, and know when to stop and leave one family behind."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):**
    "Last episode I built the switch and deliberately didn't pull it, because I couldn't verify it. Today I have credentials. Watch what happens when I stop guessing and start asking the API."
    Show the probe output landing in seconds:
    ```
    PROPERTIES   v3 200  |  dated 200  identical
    PIPELINES    v3 200  |  dated 200  identical
    SCHEMAS      v3 200  |  dated 404  ← no dated equivalent
    ```
    "Three families ready, one that doesn't exist yet. If I'd inferred the pattern instead of probing it, I'd have shipped a 404 into production code and CI would have gone green anyway."

*   **The Architecture (1:00 - 3:00):**
    Restate the trap from last episode in one line: these are serverless functions that deploy *without ever calling* the APIs they use, so a green pipeline proves nothing about a URL change.
    Then the method, which is almost embarrassingly simple: **call both surfaces and diff the response shapes.**
    ```
    GET /crm/v3/<family>/...        →  status + sorted keys
    GET /crm/<family>/2026-03/...   →  status + sorted keys
    ```
    Same status, same keys, and you have evidence rather than a hunch. Different, and you've just avoided an outage.
    "A dated version is a new API version. The path moving is the obvious half. The response shape changing is the half that actually hurts, and it's the half a path-only check can never see."

*   **Step-by-Step Implementation (3:00 - 8:00):**

    **Step 1 — Probe every family (3:00 - 4:30).**
    Show the small shell function that fetches a URL and prints status plus sorted top-level keys. Run it across properties, pipelines, schemas, associations.
    Focus on the two surprises, because they're the whole reason to probe:
    - **Associations do not live under `/crm/associations/`.** `/crm/v4/objects/{t}/{id}/associations/{t}` becomes `/crm/objects/2026-03/{t}/{id}/associations/{t}` — it hangs off the *objects* family. `/crm/associations/2026-03/` exists too, but it's for label *definitions*. Two different things that both read as "associations".
    - **Schemas has no dated equivalent.** `/crm/schemas/2026-03`, `/crm/schemas/2026-03/{type}`, `/crm/custom-objects/2026-03/schemas` — 404, 404, 404.
    "Both of those are inferences I would confidently have got wrong."

    **Step 2 — Probe the writes too, not just the reads (4:30 - 5:30).**
    A GET returning 200 does not mean the PUT works. Show the write probe against the dated association path — `PUT` returns **201**, then `DELETE` returns **204** to clean up immediately.
    "Test data on a real portal is a debt you pay back in the same command you incurred it. Write the delete before you run the write."

    **Step 3 — Flip, and read the failures as a manifest (5:30 - 7:00).**
    Four prefix constants change. Then the suite reports **43 failures**, each naming an old and new URL:
    ```
    /crm/v3/properties/2-67505887   ->  /crm/properties/2026-03/2-67505887
    /crm/v4/associations/{a}/{b}/labels -> /crm/associations/2026-03/{a}/{b}/labels
    ```
    "These aren't errors. This is the migration telling you exactly what it touched. Update them deliberately — never with a blanket find-and-replace you didn't read."

    **Step 4 — Leave one family behind, on purpose, in writing (7:00 - 8:00).**
    Schemas keeps its legacy prefix, and the comment records *why*, *what was tried*, and *when*:
    ```ts
    /** STILL LEGACY — no dated equivalent exists yet. Verified 2026-09-03: all of
     *  /crm/schemas/2026-03, /crm/schemas/2026-03/{type} and
     *  /crm/custom-objects/2026-03/schemas return 404. Recheck on a later version. */
    ```
    "An undocumented decision gets re-litigated by the next person, or worse, silently 'fixed' into a 404. The date matters — it tells them how stale the finding is."

*   **Testing & Wrap-up (8:00 - 10:00):**
    Deploy. Then the real proof: call the deployed function end to end and watch it associate two records through entirely dated paths.
    Recap:
    1. **Probe, don't infer.** The pattern was wrong twice out of five.
    2. **Diff response shapes, not just status codes.** A new API version can change the body.
    3. **Probe writes separately**, and clean up in the same breath.
    4. **Failing URL assertions are a manifest**, not a chore.
    5. **Document the family you didn't migrate**, with evidence and a date.

**💻 Screen-Ready Code Snippets:**

**The whole probe — this is all it takes:**

```bash
probe () {  # $1 label, $2 path
  code=$(curl -s -o /tmp/p.json -w "%{http_code}" \
    -H "Authorization: Bearer $TOKEN" "https://api.hubapi.com/$2")
  keys=$(python3 -c "
import json
d=json.load(open('/tmp/p.json'))
r=d['results'][0] if isinstance(d.get('results'),list) and d['results'] else d
print(','.join(sorted(r.keys()))[:70])")
  printf "  %-7s %-3s %s\n" "$1" "$code" "$keys"
}

probe "v3"    "crm/v3/properties/$OT"
probe "dated" "crm/properties/2026-03/$OT"
```

**What it found — two of five were not what the pattern predicted:**

| Family | Dated path | Result |
|---|---|---|
| objects | `/crm/objects/2026-03/{type}` | 200, identical |
| associations | `/crm/objects/2026-03/{t}/{id}/associations/{t}` | GET 200 · PUT 201 · DELETE 204 |
| assoc labels | `/crm/associations/2026-03/{a}/{b}/labels` | 200, identical |
| properties | `/crm/properties/2026-03/{type}` | 200, identical |
| pipelines | `/crm/pipelines/2026-03/{type}` | 200, identical |
| **schemas** | *none found* | **404 at every variant** |

**Probe the write, and clean up in the same command:**

```bash
# PUT → 201
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '[{"associationCategory":"USER_DEFINED","associationTypeId":99}]' \
  "https://api.hubapi.com/crm/objects/2026-03/$OT/$A/associations/$OT/$B"

# DELETE → 204, immediately
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  "https://api.hubapi.com/crm/objects/2026-03/$OT/$A/associations/$OT/$B"
```

**The flip — four lines, 43 named failures:**

```ts
const ASSOCIATION_OBJECTS_V4 = OBJECTS_DATED;                      // not /crm/associations/ !
const ASSOCIATIONS_V4        = `/crm/associations/${HS_API_VERSION}`;
const PROPERTIES_V3          = `/crm/properties/${HS_API_VERSION}`;
const PIPELINES_V3           = `/crm/pipelines/${HS_API_VERSION}`;

// STILL LEGACY — no dated equivalent exists yet. Verified 2026-09-03.
const SCHEMAS_V3             = '/crm/v3/schemas';
```

**End-to-end proof, through the deployed function:**

```
POST https://{portal}.hs-sites.com/hs/serverless/associate-related-content
{"inputFields":{"objectId":"60962462621","objectType":"content", ...}}

{"outputFields":{"associationStatus":"success","associationsCreated":1,
                 "relatedTitles":"changelog3"}}
```

> Every path in that request chain — record read, CRM search, label lookup, association write — is now dated. The green CI run said nothing about any of it. This one call said everything.
